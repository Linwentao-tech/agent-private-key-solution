import {input, select} from '@inquirer/prompts'
import {ERC721_ABI} from './contracts.js'
import {parseAbiItem, type Address, type PublicClient} from 'viem'

const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)')
const LOG_SCAN_WINDOW_BLOCKS = 200_000n
const LOG_SCAN_TIMEOUT_MS = 12_000

async function promptTokenIdManually(promptText: string): Promise<bigint> {
  const manual = await input({
    message: promptText,
    validate: (v) => (/^\d+$/.test(v.trim()) ? true : 'tokenId must be an integer'),
  })
  return BigInt(manual)
}

async function discoverOwnedTokenIds(
  client: PublicClient,
  nftContract: Address,
  owner: Address,
): Promise<bigint[]> {
  try {
    const balanceRaw = (await client.readContract({
      address: nftContract,
      abi: ERC721_ABI,
      functionName: 'balanceOf',
      args: [owner],
    })) as bigint

    if (balanceRaw === 0n) return []

    const tokenIds: bigint[] = []
    for (let i = 0n; i < balanceRaw; i += 1n) {
      const tokenId = (await client.readContract({
        address: nftContract,
        abi: ERC721_ABI,
        functionName: 'tokenOfOwnerByIndex',
        args: [owner, i],
      })) as bigint
      tokenIds.push(tokenId)
    }

    return tokenIds
  } catch (enumerationError) {
    const enumReason = enumerationError instanceof Error ? enumerationError.message : String(enumerationError)

    try {
      const latest = await client.getBlockNumber()
      const fromBlock = latest > LOG_SCAN_WINDOW_BLOCKS ? latest - LOG_SCAN_WINDOW_BLOCKS : 0n
      const deadlineMs = Date.now() + LOG_SCAN_TIMEOUT_MS

      const tokenIds = await discoverOwnedTokenIdsFromTransferLogs(
        client,
        nftContract,
        owner,
        fromBlock,
        latest,
        deadlineMs,
      )
      if (tokenIds.length > 0) return tokenIds

      throw new Error(
        `no owned token found from recent Transfer logs (scanned blocks ${fromBlock.toString()}..${latest.toString()})`,
      )
    } catch (logsError) {
      const logsReason = logsError instanceof Error ? logsError.message : String(logsError)
      throw new Error(
        `cannot enumerate via tokenOfOwnerByIndex (${enumReason}); transfer-log fallback failed (${logsReason})`,
      )
    }
  }
}

type TransferLog = {
  args: {
    from: Address
    to: Address
    tokenId: bigint
  }
  blockNumber: bigint
  transactionIndex: number
  logIndex: number
}

async function fetchTransferLogsRange(
  client: PublicClient,
  nftContract: Address,
  owner: Address,
  fromBlock: bigint,
  toBlock: bigint,
  side: 'from' | 'to',
  deadlineMs: number,
  depth = 0,
): Promise<TransferLog[]> {
  if (Date.now() > deadlineMs) {
    throw new Error('transfer log scan timed out')
  }

  if (depth > 32) {
    throw new Error('transfer log scan recursion limit reached')
  }

  try {
    const args = side === 'from' ? {from: owner} : {to: owner}
    return (await client.getLogs({
      address: nftContract,
      event: TRANSFER_EVENT,
      args,
      fromBlock,
      toBlock,
      strict: true,
    })) as TransferLog[]
  } catch {
    if (Date.now() > deadlineMs) {
      throw new Error('transfer log scan timed out')
    }

    if (fromBlock >= toBlock) return []
    const mid = (fromBlock + toBlock) / 2n
    const left = await fetchTransferLogsRange(client, nftContract, owner, fromBlock, mid, side, deadlineMs, depth + 1)
    const right = await fetchTransferLogsRange(
      client,
      nftContract,
      owner,
      mid + 1n,
      toBlock,
      side,
      deadlineMs,
      depth + 1,
    )
    return [...left, ...right]
  }
}

function sortLogs(logs: TransferLog[]): TransferLog[] {
  return [...logs].sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1
    if (a.transactionIndex !== b.transactionIndex) return a.transactionIndex < b.transactionIndex ? -1 : 1
    if (a.logIndex !== b.logIndex) return a.logIndex < b.logIndex ? -1 : 1
    return 0
  })
}

async function discoverOwnedTokenIdsFromTransferLogs(
  client: PublicClient,
  nftContract: Address,
  owner: Address,
  fromBlock: bigint,
  latestBlock: bigint,
  deadlineMs: number,
): Promise<bigint[]> {
  if (latestBlock < fromBlock) return []

  const [inLogs, outLogs] = await Promise.all([
    fetchTransferLogsRange(client, nftContract, owner, fromBlock, latestBlock, 'to', deadlineMs),
    fetchTransferLogsRange(client, nftContract, owner, fromBlock, latestBlock, 'from', deadlineMs),
  ])

  const ownerLower = owner.toLowerCase()
  const merged = sortLogs([...inLogs, ...outLogs])
  const owned = new Set<string>()

  for (const log of merged) {
    const fromLower = log.args.from.toLowerCase()
    const toLower = log.args.to.toLowerCase()
    const tokenId = log.args.tokenId.toString()

    if (toLower === ownerLower && fromLower !== ownerLower) {
      owned.add(tokenId)
      continue
    }

    if (fromLower === ownerLower && toLower !== ownerLower) {
      owned.delete(tokenId)
    }
  }

  return [...owned]
    .map((x) => BigInt(x))
    .sort((a, b) => (a < b ? -1 : 1))
}

export async function resolveTokenId(
  client: PublicClient,
  nftContract: Address,
  owner: Address,
  tokenIdInput: string,
  interactive: boolean,
): Promise<bigint> {
  if (tokenIdInput !== 'auto') {
    return BigInt(tokenIdInput)
  }

  let ownedTokenIds: bigint[]
  try {
    ownedTokenIds = await discoverOwnedTokenIds(client, nftContract, owner)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    if (!interactive) {
      throw new Error(
        `token-id=auto failed: cannot auto-discover owner NFTs on-chain. ${reason}`,
      )
    }
    return promptTokenIdManually(`Cannot auto-discover tokenId on-chain (${reason}). Enter tokenId manually:`)
  }

  if (ownedTokenIds.length === 0) {
    if (!interactive) {
      throw new Error('token-id=auto failed: owner holds 0 NFTs for this contract')
    }
    return promptTokenIdManually('No owned token found for this contract. Enter tokenId manually:')
  }

  if (ownedTokenIds.length === 1) return ownedTokenIds[0]

  if (!interactive) {
    const preview = ownedTokenIds.slice(0, 8).map((x) => x.toString()).join(', ')
    throw new Error(
      `token-id=auto is ambiguous: owner has ${ownedTokenIds.length} NFTs in contract; pass --token-id (examples: ${preview})`,
    )
  }

  const selected = await select<string>({
    message: `Found ${ownedTokenIds.length} NFTs. Select tokenId to bind:`,
    choices: ownedTokenIds.map((tokenId) => ({
      name: `#${tokenId.toString()}`,
      value: tokenId.toString(),
    })),
  })
  return BigInt(selected)
}
