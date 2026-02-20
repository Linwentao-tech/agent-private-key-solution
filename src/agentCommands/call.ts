import {Flags} from '@oclif/core'
import {BaseCommand} from '../base-command.js'
import {getPublicClient, parseAddress, parsePrivateKey} from '../lib/chain.js'
import {AGENT6551_ABI, ERC20_ABI} from '../lib/contracts.js'
import {requireBinding} from '../lib/require.js'
import {withSpinner} from '../lib/spinner.js'
import {privateKeyToAccount} from 'viem/accounts'
import {
  encodeFunctionData,
  hexToBigInt,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
} from 'viem'
import {
  entryPoint07Address,
  formatUserOperationRequest,
  type UserOperation,
} from 'viem/account-abstraction'
import {randomBytes} from 'node:crypto'

const MAX_UINT128 = (1n << 128n) - 1n

const SIMPLE_ACCOUNT_EXECUTE_ABI = parseAbi([
  'function execute(address dest, uint256 value, bytes func)',
])

const ENTRY_POINT_GET_NONCE_ABI = parseAbi([
  'function getNonce(address sender, uint192 key) view returns (uint256)',
])

const ENTRY_POINT_GET_USER_OP_HASH_ABI = parseAbi([
  'function getUserOpHash((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp) view returns (bytes32)',
])

type UserOpGasEstimate = {
  preVerificationGas: Hex
  verificationGasLimit: Hex
  callGasLimit: Hex
}

type UserOpGasPriceResult = {
  fast: {maxFeePerGas: Hex; maxPriorityFeePerGas: Hex}
}

type SponsorUserOperationResult = {
  paymaster?: `0x${string}`
  paymasterData?: Hex
  paymasterVerificationGasLimit?: Hex
  paymasterPostOpGasLimit?: Hex
  callGasLimit?: Hex
  verificationGasLimit?: Hex
  preVerificationGas?: Hex
  maxFeePerGas?: Hex
  maxPriorityFeePerGas?: Hex
}

async function bundlerRequest<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params}),
  })
  if (!response.ok) throw new Error(`${method} failed with HTTP ${response.status}`)
  const payload = (await response.json()) as {result?: T; error?: {message?: string}}
  if (payload.error) throw new Error(`${method} failed: ${payload.error.message ?? 'unknown'}`)
  if (!('result' in payload)) throw new Error(`${method} returned empty result`)
  return payload.result as T
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

function packTwoUint128(high: bigint, low: bigint): Hex {
  return `0x${high.toString(16).padStart(32, '0')}${low.toString(16).padStart(32, '0')}` as Hex
}

function getInitCode(userOp: UserOperation<'0.7'>): Hex {
  if (!userOp.factory || !userOp.factoryData) return '0x'
  return `${userOp.factory}${userOp.factoryData.slice(2)}` as Hex
}

function getPaymasterAndData(userOp: UserOperation<'0.7'>): Hex {
  if (!userOp.paymaster) return '0x'
  const v = userOp.paymasterVerificationGasLimit ?? 0n
  const p = userOp.paymasterPostOpGasLimit ?? 0n
  const d = userOp.paymasterData ?? '0x'
  return `0x${userOp.paymaster.slice(2)}${v.toString(16).padStart(32, '0')}${p.toString(16).padStart(32, '0')}${d.slice(2)}` as Hex
}

type PolicyCallParams = {
  to: Address
  value: bigint
  data: Hex
  pullAmount: bigint
}

type ExecuteContext = {
  tbaAddress: Address
  aaAccountAddress: Address
  aaOwnerPrivateKey: Hex
  policySignerPrivateKey: Hex
  chainId: number
  bundlerRpcUrl: string
  entryPointAddress: Address
  sponsorshipPolicyId: string | null
}

async function executePolicyCall(
  publicClient: ReturnType<typeof getPublicClient>,
  ctx: ExecuteContext,
  params: PolicyCallParams,
  spinnerEnabled: boolean,
): Promise<{userOpHash: `0x${string}`; txHash: `0x${string}`}> {
  const aaOwnerAccount = privateKeyToAccount(ctx.aaOwnerPrivateKey)
  const policySignerAccount = privateKeyToAccount(ctx.policySignerPrivateKey)

  const nonce = (await publicClient.readContract({
    address: ctx.entryPointAddress,
    abi: ENTRY_POINT_GET_NONCE_ABI,
    functionName: 'getNonce',
    args: [ctx.aaAccountAddress, 0n],
  })) as bigint

  const policyNonce = BigInt(`0x${randomBytes(32).toString('hex')}`)
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600)

  const signature = await policySignerAccount.signTypedData({
    domain: {name: 'Agent6551Account', version: '1', chainId: ctx.chainId, verifyingContract: ctx.tbaAddress},
    types: {
      PolicyCall: [
        {name: 'to', type: 'address'},
        {name: 'value', type: 'uint256'},
        {name: 'dataHash', type: 'bytes32'},
        {name: 'nonce', type: 'uint256'},
        {name: 'deadline', type: 'uint256'},
        {name: 'pullAmount', type: 'uint256'},
      ],
    },
    primaryType: 'PolicyCall',
    message: {
      to: params.to,
      value: params.value,
      dataHash: keccak256(params.data),
      nonce: policyNonce,
      deadline,
      pullAmount: params.pullAmount,
    },
  })

  const policyCallData = encodeFunctionData({
    abi: AGENT6551_ABI,
    functionName: 'executeWithPolicy',
    args: [{...params, nonce: policyNonce, deadline}, signature],
  })

  const smartAccountCallData = encodeFunctionData({
    abi: SIMPLE_ACCOUNT_EXECUTE_ABI,
    functionName: 'execute',
    args: [ctx.tbaAddress, 0n, policyCallData],
  })

  let maxPriorityFeePerGas = 1_000_000_000n
  let maxFeePerGas = maxPriorityFeePerGas * 2n
  try {
    const gasPrice = await bundlerRequest<UserOpGasPriceResult>(ctx.bundlerRpcUrl, 'pimlico_getUserOperationGasPrice', [])
    maxPriorityFeePerGas = hexToBigInt(gasPrice.fast.maxPriorityFeePerGas)
    maxFeePerGas = hexToBigInt(gasPrice.fast.maxFeePerGas)
  } catch {}

  let userOp: UserOperation<'0.7'> = {
    sender: ctx.aaAccountAddress,
    nonce,
    factory: undefined,
    factoryData: undefined,
    callData: smartAccountCallData,
    callGasLimit: 0n,
    verificationGasLimit: 0n,
    preVerificationGas: 0n,
    maxFeePerGas,
    maxPriorityFeePerGas,
    paymaster: undefined,
    paymasterData: '0x',
    paymasterVerificationGasLimit: undefined,
    paymasterPostOpGasLimit: undefined,
    signature: '0x',
  }

  const estimate = async (op: UserOperation<'0.7'>) => {
    const est = await bundlerRequest<UserOpGasEstimate>(ctx.bundlerRpcUrl, 'eth_estimateUserOperationGas', [formatUserOperationRequest(op), ctx.entryPointAddress])
    return {...op, callGasLimit: hexToBigInt(est.callGasLimit), verificationGasLimit: hexToBigInt(est.verificationGasLimit), preVerificationGas: hexToBigInt(est.preVerificationGas)}
  }

  try { userOp = await estimate(userOp) } catch {}

  const sponsorParams: unknown[] = [formatUserOperationRequest(userOp), ctx.entryPointAddress]
  if (ctx.sponsorshipPolicyId) sponsorParams.push({sponsorshipPolicyId: ctx.sponsorshipPolicyId})
  const sponsor = await bundlerRequest<SponsorUserOperationResult>(ctx.bundlerRpcUrl, 'pm_sponsorUserOperation', sponsorParams)

  userOp = {
    ...userOp,
    paymaster: sponsor.paymaster,
    paymasterData: sponsor.paymasterData,
    paymasterVerificationGasLimit: sponsor.paymasterVerificationGasLimit ? hexToBigInt(sponsor.paymasterVerificationGasLimit) : undefined,
    paymasterPostOpGasLimit: sponsor.paymasterPostOpGasLimit ? hexToBigInt(sponsor.paymasterPostOpGasLimit) : undefined,
    callGasLimit: sponsor.callGasLimit ? hexToBigInt(sponsor.callGasLimit) : userOp.callGasLimit,
    verificationGasLimit: sponsor.verificationGasLimit ? hexToBigInt(sponsor.verificationGasLimit) : userOp.verificationGasLimit,
    preVerificationGas: sponsor.preVerificationGas ? hexToBigInt(sponsor.preVerificationGas) : userOp.preVerificationGas,
    maxFeePerGas: sponsor.maxFeePerGas ? hexToBigInt(sponsor.maxFeePerGas) : userOp.maxFeePerGas,
    maxPriorityFeePerGas: sponsor.maxPriorityFeePerGas ? hexToBigInt(sponsor.maxPriorityFeePerGas) : userOp.maxPriorityFeePerGas,
  }

  if (userOp.callGasLimit === 0n) userOp = await estimate(userOp)

  const packed = {
    sender: userOp.sender,
    nonce: userOp.nonce,
    initCode: getInitCode(userOp),
    callData: userOp.callData,
    accountGasLimits: packTwoUint128(userOp.verificationGasLimit, userOp.callGasLimit),
    preVerificationGas: userOp.preVerificationGas,
    gasFees: packTwoUint128(userOp.maxPriorityFeePerGas, userOp.maxFeePerGas),
    paymasterAndData: getPaymasterAndData(userOp),
    signature: '0x' as `0x${string}`,
  }

  const hashForSign = await publicClient.readContract({
    address: ctx.entryPointAddress,
    abi: ENTRY_POINT_GET_USER_OP_HASH_ABI,
    functionName: 'getUserOpHash',
    args: [packed],
  }) as Hex

  const aaSig = await aaOwnerAccount.signMessage({message: {raw: hashForSign}})
  userOp = {...userOp, signature: aaSig}

  const userOpHash = await bundlerRequest<`0x${string}`>(ctx.bundlerRpcUrl, 'eth_sendUserOperation', [formatUserOperationRequest(userOp), ctx.entryPointAddress])

  const started = Date.now()
  while (Date.now() - started < 120_000) {
    const receipt = await bundlerRequest<any>(ctx.bundlerRpcUrl, 'eth_getUserOperationReceipt', [userOpHash])
    if (receipt?.receipt?.transactionHash) {
      return {userOpHash, txHash: receipt.receipt.transactionHash}
    }
    await sleep(2000)
  }
  throw new Error('userOp submitted but no receipt txHash within timeout')
}

export default class Call extends BaseCommand<typeof Call> {
  static override description = '[AGENT] execute arbitrary contract call via AA paymaster.'

  static override flags = {
    ...BaseCommand.baseFlags,
    to: Flags.string({description: 'target contract address', required: true}),
    data: Flags.string({description: 'calldata (hex string)', required: true}),
    value: Flags.string({description: 'ETH value to send (in wei)', default: '0'}),
    'pull-amount': Flags.string({description: 'amount of budgetToken to pull from owner (in token units)', default: '0'}),
    'agent-signer-privatekey': Flags.string({description: 'agent/policy signer private key (fallback: state)'}),
    'dry-run': Flags.boolean({description: 'simulate without broadcasting', default: false}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Call)
    const json = flags.json
    const spinnerEnabled = !json

    const state = this.getState()
    const {tbaAddress} = requireBinding(state, {requirePolicyCreated: true})
    const publicClient = getPublicClient()
    const to = parseAddress(flags.to, 'to')
    const data = flags.data.startsWith('0x') ? (flags.data as Hex) : (`0x${flags.data}` as Hex)
    const value = BigInt(flags.value)
    const pullAmount = BigInt(flags['pull-amount'])

    if (!/^0x[0-9a-fA-F]*$/.test(data)) throw new Error('data must be a valid hex string')

    const policyPk = flags['agent-signer-privatekey']
      ? parsePrivateKey(flags['agent-signer-privatekey'])
      : state.agentSignerPrivateKey
        ? parsePrivateKey(state.agentSignerPrivateKey)
        : (() => { throw new Error('agent signer private key is required') })()

    const policySignerAccount = privateKeyToAccount(policyPk)

    const policy = (await withSpinner(
      'Reading on-chain policy...',
      () => publicClient.readContract({address: tbaAddress, abi: AGENT6551_ABI, functionName: 'policy'}) as Promise<[Address, bigint, bigint, bigint, Address, boolean]>,
      {enabled: spinnerEnabled},
    )) as [Address, bigint, bigint, bigint, Address, boolean]

    if (!policy[5]) throw new Error('policy is inactive')
    if (policy[1] > 0n && policy[1] < BigInt(Math.floor(Date.now() / 1000))) throw new Error('policy expired')
    if (policySignerAccount.address.toLowerCase() !== policy[0].toLowerCase()) {
      throw new Error(`policy signer mismatch: on-chain=${policy[0]}, provided=${policySignerAccount.address}`)
    }

    const maxTotal = policy[2]
    const spent = policy[3]
    const remaining = maxTotal - spent
    if (pullAmount > remaining) {
      throw new Error(`budget exceeded: pullAmount=${pullAmount.toString()}, remaining=${remaining.toString()} (maxTotal=${maxTotal.toString()}, spent=${spent.toString()})`)
    }

    const budgetToken = policy[4]
    const targets = (await withSpinner(
      'Reading policy targets...',
      () => publicClient.readContract({address: tbaAddress, abi: AGENT6551_ABI, functionName: 'getPolicyTargets'}) as Promise<Address[]>,
      {enabled: spinnerEnabled},
    )) as Address[]

    const targetAllowed = targets.some((t) => t.toLowerCase() === to.toLowerCase())
    if (!targetAllowed) throw new Error(`target ${to} is not in policy whitelist`)

    // Check if budgetToken is also whitelisted (for approve operations)
    const budgetTokenAllowed = targets.some((t) => t.toLowerCase() === budgetToken.toLowerCase())

    if (flags['dry-run']) {
      this.render(json, {ok: true, dryRun: true, tbaAddress, to, data, value: value.toString(), policySigner: policySignerAccount.address}, `Dry-run successful. Target: ${to}`)
      return
    }

    const ctx: ExecuteContext = {
      tbaAddress,
      aaAccountAddress: state.aaAccountAddress!,
      aaOwnerPrivateKey: parsePrivateKey(state.aaOwnerPrivateKey!),
      policySignerPrivateKey: policyPk,
      chainId: state.chainId,
      bundlerRpcUrl: state.aaBundlerRpcUrl!,
      entryPointAddress: state.aaEntrypointAddress ?? entryPoint07Address,
      sponsorshipPolicyId: state.aaSponsorshipPolicyId || null,
    }

    const results: {type: string; userOpHash: `0x${string}`; txHash: `0x${string}`}[] = []

    // Handle approve if pullAmount > 0
    if (pullAmount > 0n) {
      if (!budgetTokenAllowed) {
        throw new Error(`budgetToken ${budgetToken} is not in policy whitelist, cannot approve`)
      }

      const allowance = (await withSpinner(
        'Checking allowance...',
        () => publicClient.readContract({address: budgetToken, abi: ERC20_ABI, functionName: 'allowance', args: [tbaAddress, to]}) as Promise<bigint>,
        {enabled: spinnerEnabled},
      )) as bigint

      if (allowance !== pullAmount) {
        // Need to adjust allowance: reset to 0 first if needed, then set to pullAmount
        if (allowance > 0n) {
          const resetData = encodeFunctionData({abi: ERC20_ABI, functionName: 'approve', args: [to, 0n]})
          const result = await withSpinner('Resetting allowance to 0...', () => executePolicyCall(publicClient, ctx, {to: budgetToken, value: 0n, data: resetData, pullAmount: 0n}, spinnerEnabled), {enabled: spinnerEnabled})
          results.push({type: 'approve-reset', ...result})
        }

        const approveData = encodeFunctionData({abi: ERC20_ABI, functionName: 'approve', args: [to, pullAmount]})
        const result = await withSpinner(`Approving ${pullAmount.toString()} tokens...`, () => executePolicyCall(publicClient, ctx, {to: budgetToken, value: 0n, data: approveData, pullAmount: 0n}, spinnerEnabled), {enabled: spinnerEnabled})
        results.push({type: 'approve', ...result})
      }
    }

    // Execute the main call
    const mainResult = await withSpinner(
      'Executing call...',
      () => executePolicyCall(publicClient, ctx, {to, value, data, pullAmount}, spinnerEnabled),
      {enabled: spinnerEnabled},
    )
    results.push({type: 'call', ...mainResult})

    this.render(
      json,
      {ok: true, mode: 'aa-paymaster', tbaAddress, results, to, data, value: value.toString(), pullAmount: pullAmount.toString(), policySigner: policySignerAccount.address},
      ['Call executed successfully.', ...results.map(r => `${r.type}: tx ${r.txHash}`)].join('\n'),
    )
  }
}
