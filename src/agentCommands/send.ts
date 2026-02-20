import {Args, Flags} from '@oclif/core'
import {BaseCommand} from '../base-command.js'
import {getPublicClient, parseAddress, parsePrivateKey, resolveRpcUrl} from '../lib/chain.js'
import {AGENT6551_ABI, ERC20_ABI} from '../lib/contracts.js'
import {DEFAULT_USDT_ADDRESS} from '../lib/constants.js'
import {requireBinding} from '../lib/require.js'
import {parseDecimalToUnits, formatUnits} from '../lib/units.js'
import {withSpinner} from '../lib/spinner.js'
import {privateKeyToAccount} from 'viem/accounts'
import {
  createPublicClient,
  encodeFunctionData,
  hexToBigInt,
  http,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
} from 'viem'
import {sepolia, mainnet} from 'viem/chains'
import {
  entryPoint07Address,
  formatUserOperationRequest,
  type UserOperation,
} from 'viem/account-abstraction'
import {randomBytes} from 'node:crypto'
import {spawnSync} from 'node:child_process'

// EntryPoint 里 gas 打包字段是 uint128，这里用于边界校验。
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

type ParsedSendAmount = {
  raw: string
  kind: 'usd' | 'token'
  normalized: string
}

type ParsedRecipient = {
  raw: string
  kind: 'address' | 'ens'
  normalized: string
}

type UserOpGasEstimate = {
  preVerificationGas: Hex
  verificationGasLimit: Hex
  callGasLimit: Hex
}

type UserOpGasPriceTier = {
  maxFeePerGas: Hex
  maxPriorityFeePerGas: Hex
}

type UserOpGasPriceResult = {
  slow: UserOpGasPriceTier
  standard: UserOpGasPriceTier
  fast: UserOpGasPriceTier
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

type JsonRpcError = {
  code?: number
  message?: string
  data?: unknown
}

// 兼容子进程 stdout 中夹杂日志的情况：尽量提取最后一个 JSON 对象。
function parseLastJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // fall through
  }

  const start = trimmed.lastIndexOf('\n{')
  const candidate = start >= 0 ? trimmed.slice(start + 1) : trimmed
  try {
    const parsed = JSON.parse(candidate)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // ignore
  }
  return null
}

// 允许 `1` / `0.5` / `$5` 三种输入，统一为后续可计算格式。
function parseSendAmount(rawInput: string): ParsedSendAmount {
  const raw = rawInput.trim()
  if (!raw) throw new Error('amount is required')

  if (raw.startsWith('$')) {
    const body = raw.slice(1)
    if (!/^\d+(\.\d+)?$/.test(body)) {
      throw new Error("amount with '$' prefix must be numeric, e.g. '$1' or '$5.00'")
    }
    return {raw, kind: 'usd', normalized: body}
  }

  if (/^\d+(\.\d+)?$/.test(raw)) {
    return {raw, kind: 'token', normalized: raw}
  }

  throw new Error("amount must be '1', '0.50', or '$5.00' style")
}

// recipient 支持地址和 ENS，先做结构化再进入链上解析。
function parseRecipient(value: string): ParsedRecipient {
  const raw = value.trim()
  if (!raw) throw new Error('recipient is required')

  if (/^0x[a-fA-F0-9]{40}$/.test(raw)) {
    return {
      raw,
      kind: 'address',
      normalized: parseAddress(raw, 'recipient'),
    }
  }

  if (/^[^\s.]+\.[^\s]+$/.test(raw)) {
    return {
      raw,
      kind: 'ens',
      normalized: raw.toLowerCase(),
    }
  }

  throw new Error('recipient must be a valid 0x address or ENS name')
}

// 显式校验“必须存在的地址配置”。
function parseHexAddressEnv(value: string | undefined, label: string): `0x${string}` {
  if (!value) throw new Error(`${label} is required`)
  return parseAddress(value, label)
}

// 显式校验“必须存在的私钥配置”。
function parseRequiredPrivateKey(value: string | undefined, label: string): `0x${string}` {
  if (!value) throw new Error(`${label} is required`)
  return parsePrivateKey(value)
}

// ENS 优先走当前 RPC（常见是 sepolia），失败后回退到 mainnet 公共 RPC。
async function resolveEnsAddress(name: string, rpcUrl: string): Promise<`0x${string}` | null> {
  const sepoliaClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  })
  const sepoliaResolved = await sepoliaClient.getEnsAddress({name})
  if (sepoliaResolved) return sepoliaResolved

  const mainnetClient = createPublicClient({
    chain: mainnet,
    transport: http('https://ethereum-rpc.publicnode.com'),
  })
  return mainnetClient.getEnsAddress({name})
}

// policy nonce 用随机数，避免同 payload 被重放。
function randomNonce(): bigint {
  return BigInt(`0x${randomBytes(12).toString('hex')}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// deadline 取“现在 + 10 分钟”和 policy 过期时间中的较小值。
function pickDeadline(policyValidUntil: bigint): bigint {
  const now = BigInt(Math.floor(Date.now() / 1000))
  if (policyValidUntil <= now) {
    throw new Error(`policy already expired at ${policyValidUntil.toString()}`)
  }
  const preferred = now + 10n * 60n
  return preferred < policyValidUntil ? preferred : policyValidUntil
}

// 统一适配 paymaster 返回结构；当前 CLI 仅支持 entryPoint v0.7 的字段。
function unwrapSponsorResult(raw: unknown): SponsorUserOperationResult {
  if (!raw || typeof raw !== 'object') {
    throw new Error('pm_sponsorUserOperation returned invalid result')
  }
  const result = raw as Record<string, unknown>
  if (result.paymaster && result.paymasterData) {
    return {
      paymaster: result.paymaster as `0x${string}`,
      paymasterData: result.paymasterData as Hex,
      paymasterVerificationGasLimit: (result.paymasterVerificationGasLimit as Hex | undefined) ?? undefined,
      paymasterPostOpGasLimit: (result.paymasterPostOpGasLimit as Hex | undefined) ?? undefined,
      callGasLimit: (result.callGasLimit as Hex | undefined) ?? undefined,
      verificationGasLimit: (result.verificationGasLimit as Hex | undefined) ?? undefined,
      preVerificationGas: (result.preVerificationGas as Hex | undefined) ?? undefined,
      maxFeePerGas: (result.maxFeePerGas as Hex | undefined) ?? undefined,
      maxPriorityFeePerGas: (result.maxPriorityFeePerGas as Hex | undefined) ?? undefined,
    }
  }
  if (result.paymasterAndData) {
    throw new Error('paymasterAndData response is not supported for entryPoint v0.7 in this CLI')
  }
  throw new Error('pm_sponsorUserOperation did not return paymaster fields')
}

// 从 bundler receipt 里抽取最终链上 txHash（可能暂时为空）。
function extractUserOpTxHash(receipt: unknown): `0x${string}` | null {
  if (!receipt || typeof receipt !== 'object') return null
  const r = receipt as Record<string, unknown>
  if (!r.receipt || typeof r.receipt !== 'object') return null
  const txHash = (r.receipt as Record<string, unknown>).transactionHash
  if (typeof txHash === 'string' && /^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return txHash as `0x${string}`
  }
  return null
}

// EntryPoint 需要把两个 uint128 打包成 bytes32，这里做集中处理。
function packTwoUint128(high: bigint, low: bigint): Hex {
  if (high < 0n || low < 0n || high > MAX_UINT128 || low > MAX_UINT128) {
    throw new Error(`uint128 overflow while packing gas fields: high=${high.toString()} low=${low.toString()}`)
  }
  return `0x${high.toString(16).padStart(32, '0')}${low.toString(16).padStart(32, '0')}` as Hex
}

function getInitCode(userOp: UserOperation<'0.7'>): Hex {
  if (!userOp.factory || !userOp.factoryData) return '0x'
  return `${userOp.factory}${userOp.factoryData.slice(2)}` as Hex
}

function getPaymasterAndData(userOp: UserOperation<'0.7'>): Hex {
  if (!userOp.paymaster) return '0x'
  const verificationGas = userOp.paymasterVerificationGasLimit ?? 0n
  const postOpGas = userOp.paymasterPostOpGasLimit ?? 0n
  const paymasterData = userOp.paymasterData ?? '0x'
  return `0x${userOp.paymaster.slice(2)}${verificationGas.toString(16).padStart(32, '0')}${postOpGas
    .toString(16)
    .padStart(32, '0')}${paymasterData.slice(2)}` as Hex
}

type PackedUserOperationForHash = {
  sender: Address
  nonce: bigint
  initCode: Hex
  callData: Hex
  accountGasLimits: Hex
  preVerificationGas: bigint
  gasFees: Hex
  paymasterAndData: Hex
  signature: Hex
}

async function bundlerRequest<T>(
  bundlerRpcUrl: string,
  method: string,
  params: unknown[],
): Promise<T> {
  // 所有 bundler RPC 走同一出口，方便后续做统一埋点/重试策略。
  const response = await fetch(bundlerRpcUrl, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  })

  if (!response.ok) {
    throw new Error(`${method} request failed with HTTP ${response.status}`)
  }

  const payload = (await response.json()) as {result?: T; error?: JsonRpcError}
  if (payload.error) {
    const message = payload.error.message ?? 'unknown rpc error'
    throw new Error(`${method} failed: ${message}`)
  }
  if (!('result' in payload)) {
    throw new Error(`${method} returned empty result`)
  }
  return payload.result as T
}

export default class Send extends BaseCommand<typeof Send> {
  static override description =
    '[AGENT] send usdt via AA paymaster: send <amount> <recipient>. Required inputs: AMOUNT + RECIPIENT, existing bind+policy, AA owner key, agent signer key, and bundler RPC (no owner private key fallback).'

  static override flags = {
    ...BaseCommand.baseFlags,
    token: Flags.string({
      description: 'erc20 token address (default: USDT)',
    }),
    'agent-signer-privatekey': Flags.string({
      description: 'agent/policy signer private key (fallback: state)',
    }),
    'policy-privatekey': Flags.string({
      description: 'policy signer private key (legacy alias, same as --agent-signer-privatekey)',
    }),
    'aa-owner-privatekey': Flags.string({
      description: 'AA smart account owner private key (fallback: state)',
    }),
    'aa-account': Flags.string({
      description: 'AA smart account address (fallback: state)',
    }),
    'bundler-rpc-url': Flags.string({
      description: 'AA bundler/paymaster RPC URL (fallback: state)',
    }),
    'entrypoint': Flags.string({
      description: `entrypoint address (default: ${entryPoint07Address})`,
    }),
    'sponsorship-policy-id': Flags.string({
      description: 'paymaster sponsorship policy id (fallback: state)',
    }),
    'pull-amount': Flags.string({
      description: "owner->TBA pull amount (decimal). default 'auto': same as send amount for budget token, else 0",
      default: 'auto',
    }),
    'wait-timeout-sec': Flags.integer({
      description: 'seconds to wait for userOp receipt',
      default: 120,
    }),
    'dry-run': Flags.boolean({
      description: 'prepare/sign/sponsor userOp but do not send',
      default: false,
    }),
  }

  static override args = {
    amount: Args.string({description: "amount ('1' | '0.50' | '$5.00')", required: true}),
    recipient: Args.string({description: 'recipient address or ENS name', required: true}),
  }

  async run(): Promise<void> {
    const {flags, args} = await this.parse(Send)
    const json = flags.json
    const spinnerEnabled = !json

    const state = this.getState()
    // send 依赖已绑定且已有 policy，避免把“发送逻辑”和“初始化逻辑”耦合在一起。
    const {tbaAddress} = requireBinding(state, {requirePolicyCreated: true})
    const publicClient = getPublicClient()

    const amount = parseSendAmount(args.amount)
    const recipient = parseRecipient(args.recipient)

    const [policyTuple, policyTargets] = (await withSpinner(
      'Resolving policy and targets...',
      async () => {
        const [policy, targets] = await Promise.all([
          publicClient.readContract({
            address: tbaAddress,
            abi: AGENT6551_ABI,
            functionName: 'policy',
          }) as Promise<readonly [`0x${string}`, bigint, bigint, bigint, `0x${string}`, boolean]>,
          publicClient.readContract({
            address: tbaAddress,
            abi: AGENT6551_ABI,
            functionName: 'getPolicyTargets',
          }) as Promise<`0x${string}`[]>,
        ])
        return [policy, targets] as const
      },
      {enabled: spinnerEnabled},
    )) as readonly [
      readonly [`0x${string}`, bigint, bigint, bigint, `0x${string}`, boolean],
      `0x${string}`[],
    ]

    const policy = {
      signer: policyTuple[0],
      validUntil: policyTuple[1],
      maxTotal: policyTuple[2],
      spent: policyTuple[3],
      budgetToken: policyTuple[4],
      active: policyTuple[5],
    }

    if (!policy.active) throw new Error('policy is inactive')
    if (policy.validUntil <= BigInt(Math.floor(Date.now() / 1000))) {
      throw new Error(`policy expired at ${policy.validUntil.toString()}`)
    }

    const tokenAddress = flags.token
      ? parseAddress(flags.token, 'token')
      : DEFAULT_USDT_ADDRESS

    const targetAllowed = policyTargets.some((x) => x.toLowerCase() === tokenAddress.toLowerCase())
    if (!targetAllowed) {
      throw new Error(`token target not allowed by policy: ${tokenAddress}`)
    }

    const {symbol, decimalsRaw} = await withSpinner(
      'Loading token metadata...',
      async () => ({
        symbol: (await publicClient.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'symbol',
        })) as string,
        decimalsRaw: await publicClient.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'decimals',
        }),
      }),
      {enabled: spinnerEnabled},
    )
    const decimals = typeof decimalsRaw === 'bigint' ? Number(decimalsRaw) : Number(decimalsRaw)
    const amountUnits = parseDecimalToUnits(amount.normalized, decimals)

    // ENS 在这里解析成最终地址，后续签名和 calldata 都只处理 address。
    const recipientAddress = recipient.kind === 'address'
      ? (recipient.normalized as `0x${string}`)
      : await withSpinner(
          'Resolving ENS recipient...',
          async () => {
            const resolved = await resolveEnsAddress(recipient.normalized, resolveRpcUrl())
            if (!resolved) throw new Error(`cannot resolve ENS name: ${recipient.normalized}`)
            return resolved
          },
          {enabled: spinnerEnabled},
        )

    const pullAmount = (() => {
      if (flags['pull-amount'] === 'auto') {
        return tokenAddress.toLowerCase() === policy.budgetToken.toLowerCase() ? amountUnits : 0n
      }
      return parseDecimalToUnits(flags['pull-amount'], decimals)
    })()

    // pullAmount 只允许作用在 budgetToken 上，避免绕过预算设计。
    if (pullAmount > 0n && tokenAddress.toLowerCase() !== policy.budgetToken.toLowerCase()) {
      throw new Error('pullAmount > 0 requires token to be the policy budget token')
    }

    if (pullAmount > 0n) {
      const ownerAddress = (await withSpinner(
        'Checking owner allowance/balance for pullAmount...',
        async () =>
          (await publicClient.readContract({
            address: tbaAddress,
            abi: AGENT6551_ABI,
            functionName: 'owner',
          })) as `0x${string}`,
        {enabled: spinnerEnabled},
      )) as `0x${string}`

      const [ownerBalance, ownerAllowance] = (await withSpinner(
        'Loading owner token balance and allowance...',
        async () => {
          const [balance, allowance] = await Promise.all([
            publicClient.readContract({
              address: policy.budgetToken,
              abi: ERC20_ABI,
              functionName: 'balanceOf',
              args: [ownerAddress],
            }) as Promise<bigint>,
            publicClient.readContract({
              address: policy.budgetToken,
              abi: ERC20_ABI,
              functionName: 'allowance',
              args: [ownerAddress, tbaAddress],
            }) as Promise<bigint>,
          ])
          return [balance, allowance] as const
        },
        {enabled: spinnerEnabled},
      )) as readonly [bigint, bigint]

      if (ownerBalance < pullAmount) {
        throw new Error(
          `owner token balance is insufficient for pullAmount: required=${pullAmount.toString()}, balance=${ownerBalance.toString()}`,
        )
      }

      if (ownerAllowance < pullAmount) {
        throw new Error(
          `owner allowance is insufficient for pullAmount: required=${pullAmount.toString()}, allowance=${ownerAllowance.toString()}`,
        )
      }
    }

    const policyPk = flags['agent-signer-privatekey']
      ? parsePrivateKey(flags['agent-signer-privatekey'])
      : flags['policy-privatekey']
        ? parsePrivateKey(flags['policy-privatekey'])
        : state.agentSignerPrivateKey
          ? parsePrivateKey(state.agentSignerPrivateKey)
          : (() => {
              throw new Error('policy/agent signer private key is required (set --agent-signer-privatekey or run aba init)')
            })()

    const policySignerAccount = privateKeyToAccount(policyPk)
    const policySignerAddress = policySignerAccount.address
    // 强校验签名者和链上 policy signer 一致，防止“签得出来但链上不认”。
    if (policySignerAddress.toLowerCase() !== policy.signer.toLowerCase()) {
      throw new Error(
        `policy signer mismatch: on-chain=${policy.signer}, provided=${policySignerAddress}. pass correct --agent-signer-privatekey`,
      )
    }
    const erc20TransferData = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [recipientAddress, amountUnits],
    })

    const policyCall = {
      to: tokenAddress,
      value: 0n,
      data: erc20TransferData,
      nonce: randomNonce(),
      deadline: pickDeadline(policy.validUntil),
      pullAmount,
    }

    const policySignature = await withSpinner(
      'Signing executeWithPolicy payload...',
      () =>
        policySignerAccount.signTypedData({
          domain: {
            name: 'Agent6551Account',
            version: '1',
            chainId: state.chainId,
            verifyingContract: tbaAddress,
          },
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
            to: policyCall.to,
            value: policyCall.value,
            dataHash: keccak256(policyCall.data),
            nonce: policyCall.nonce,
            deadline: policyCall.deadline,
            pullAmount: policyCall.pullAmount,
          },
        }),
      {enabled: spinnerEnabled},
    )

    const tbaCallData = encodeFunctionData({
      abi: AGENT6551_ABI,
      functionName: 'executeWithPolicy',
      args: [policyCall, policySignature],
    })

    const aaOwnerPk = parseRequiredPrivateKey(
      flags['aa-owner-privatekey'] || state.aaOwnerPrivateKey,
      'aa-owner-privatekey',
    )
    const aaOwnerAccount = privateKeyToAccount(aaOwnerPk)
    const aaAccountFromFlag = flags['aa-account'] ? parseAddress(flags['aa-account'], 'aa-account') : null
    let aaAccountAddress = parseHexAddressEnv(
      flags['aa-account'] || state.aaAccountAddress || aaOwnerAccount.address,
      'aa-account',
    )

    const bundlerRpcUrl =
      flags['bundler-rpc-url'] || state.aaBundlerRpcUrl
    if (!bundlerRpcUrl) throw new Error('AA bundler rpc is required (set --bundler-rpc-url or run aba init)')
    const rpcUrlForInit = resolveRpcUrl()
    const entryPointAddress = flags.entrypoint
      ? parseAddress(flags.entrypoint, 'entrypoint')
      : state.aaEntrypointAddress
        ? parseAddress(state.aaEntrypointAddress, 'aa-entrypoint')
        : entryPoint07Address

    const ensureAaAccountDeployed = async (): Promise<void> => {
      // 发送前先确保 AA 账户已部署；若是“陈旧地址”则自动触发 init 恢复流程。
      const code = await withSpinner(
        'Checking AA account deployment...',
        () => publicClient.getBytecode({address: aaAccountAddress}),
        {enabled: spinnerEnabled},
      )
      if (code && code !== '0x') return

      if (aaAccountFromFlag) {
        throw new Error(`configured AA account is not deployed: ${aaAccountAddress}`)
      }

      await withSpinner(
        'AA account not deployed. Running `aba init` auto-recovery...',
        async () => {
          const beforeRecover = this.getState()
          const hadStaleAaInState = Boolean(beforeRecover.aaAccountAddress)
          if (hadStaleAaInState) {
            const next = {...beforeRecover}
            delete next.aaAccountAddress
            this.setState(next)
          }

          try {
            const cliEntrypoint = process.argv[1]
            if (!cliEntrypoint) throw new Error('cannot resolve CLI entrypoint for AA auto-recovery')
            const recovered = spawnSync(
              process.execPath,
              [
                cliEntrypoint,
                'init',
                '--json',
                '--no-interactive',
                '--rpc-url',
                rpcUrlForInit,
                '--aa-bundler-rpc-url',
                bundlerRpcUrl,
                '--aa-entrypoint',
                entryPointAddress,
              ],
              {
                cwd: process.cwd(),
                encoding: 'utf8',
              },
            )

            if (recovered.status !== 0) {
              throw new Error(
                `AA auto-recovery failed: ${recovered.stderr?.trim() || recovered.stdout?.trim() || `exit ${recovered.status}`}`,
              )
            }

            const parsed = parseLastJsonObject(recovered.stdout || '')
            if (parsed && typeof parsed.aaAccountAddress === 'string') {
              aaAccountAddress = parseAddress(parsed.aaAccountAddress, 'aa-account')
            } else {
              const nextState = this.getState()
              if (!nextState.aaAccountAddress) {
                throw new Error('AA auto-recovery completed but aaAccountAddress is still missing in state')
              }
              aaAccountAddress = parseAddress(nextState.aaAccountAddress, 'aa-account')
            }
          } catch (error) {
            if (hadStaleAaInState) {
              this.setState(beforeRecover)
            }
            throw error
          }
        },
        {enabled: spinnerEnabled},
      )

      const deployedCode = await withSpinner(
        'Verifying recovered AA account deployment...',
        () => publicClient.getBytecode({address: aaAccountAddress}),
        {enabled: spinnerEnabled},
      )
      if (!deployedCode || deployedCode === '0x') {
        throw new Error(`AA account recovery did not produce deployed code: ${aaAccountAddress}`)
      }
    }

    await ensureAaAccountDeployed()

    const nonce = (await withSpinner(
      'Reading AA account nonce...',
      () =>
        publicClient.readContract({
          address: entryPointAddress,
          abi: ENTRY_POINT_GET_NONCE_ABI,
          functionName: 'getNonce',
          args: [aaAccountAddress, 0n],
        }) as Promise<bigint>,
      {enabled: spinnerEnabled},
    )) as bigint

    const smartAccountCallData = encodeFunctionData({
      abi: SIMPLE_ACCOUNT_EXECUTE_ABI,
      functionName: 'execute',
      args: [tbaAddress, 0n, tbaCallData],
    })

    let maxPriorityFeePerGas = 1_000_000_000n
    let maxFeePerGas = maxPriorityFeePerGas * 2n
    // 优先取 bundler 推荐 gas，拿不到再回退到公共 RPC 估算。
    const gasPriceFromBundler = await withSpinner(
      'Fetching userOp gas price from bundler...',
      async () => {
        try {
          return await bundlerRequest<UserOpGasPriceResult>(
            bundlerRpcUrl,
            'pimlico_getUserOperationGasPrice',
            [],
          )
        } catch {
          return null
        }
      },
      {enabled: spinnerEnabled},
    )
    if (gasPriceFromBundler) {
      maxPriorityFeePerGas = hexToBigInt(gasPriceFromBundler.fast.maxPriorityFeePerGas)
      maxFeePerGas = hexToBigInt(gasPriceFromBundler.fast.maxFeePerGas)
    } else {
      const fees = await withSpinner(
        'Estimating gas fee params...',
        () => publicClient.estimateFeesPerGas(),
        {enabled: spinnerEnabled},
      )
      maxPriorityFeePerGas = fees.maxPriorityFeePerGas ?? 1_000_000_000n
      maxFeePerGas = fees.maxFeePerGas ?? (fees.gasPrice ? fees.gasPrice * 2n : maxPriorityFeePerGas * 2n)
    }

    let userOp: UserOperation<'0.7'> = {
      sender: aaAccountAddress,
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

    const sponsorshipPolicyId =
      flags['sponsorship-policy-id'] || state.aaSponsorshipPolicyId
    let sponsored = false

    const hasUserOpGas = (op: UserOperation<'0.7'>): boolean =>
      op.callGasLimit > 0n && op.verificationGasLimit > 0n && op.preVerificationGas > 0n

    const estimateUserOpGas = async (
      op: UserOperation<'0.7'>,
      label: string,
    ): Promise<UserOperation<'0.7'>> => {
      const estimatedGas = (await withSpinner(
        label,
        async () => {
          const request = formatUserOperationRequest(op)
          return await bundlerRequest<UserOpGasEstimate>(
            bundlerRpcUrl,
            'eth_estimateUserOperationGas',
            [request, entryPointAddress],
          )
        },
        {enabled: spinnerEnabled},
      )) as UserOpGasEstimate

      return {
        ...op,
        callGasLimit: hexToBigInt(estimatedGas.callGasLimit),
        verificationGasLimit: hexToBigInt(estimatedGas.verificationGasLimit),
        preVerificationGas: hexToBigInt(estimatedGas.preVerificationGas),
      }
    }

    let baselineEstimateError: unknown = null
    try {
      userOp = await estimateUserOpGas(userOp, 'Estimating user operation gas (baseline)...')
    } catch (error) {
      baselineEstimateError = error
    }

    const sponsorResult = (await withSpinner(
      'Requesting paymaster sponsorship...',
      async () => {
        const request = formatUserOperationRequest(userOp)
        const params: unknown[] = [request, entryPointAddress]
        if (sponsorshipPolicyId) {
          params.push({sponsorshipPolicyId})
        }
        const raw = await bundlerRequest<unknown>(bundlerRpcUrl, 'pm_sponsorUserOperation', params)
        return unwrapSponsorResult(raw)
      },
      {enabled: spinnerEnabled},
    )) as SponsorUserOperationResult

    userOp = {
      ...userOp,
      paymaster: sponsorResult.paymaster,
      paymasterData: sponsorResult.paymasterData,
      paymasterVerificationGasLimit: sponsorResult.paymasterVerificationGasLimit
        ? hexToBigInt(sponsorResult.paymasterVerificationGasLimit)
        : undefined,
      paymasterPostOpGasLimit: sponsorResult.paymasterPostOpGasLimit
        ? hexToBigInt(sponsorResult.paymasterPostOpGasLimit)
        : undefined,
      callGasLimit: sponsorResult.callGasLimit ? hexToBigInt(sponsorResult.callGasLimit) : userOp.callGasLimit,
      verificationGasLimit: sponsorResult.verificationGasLimit
        ? hexToBigInt(sponsorResult.verificationGasLimit)
        : userOp.verificationGasLimit,
      preVerificationGas: sponsorResult.preVerificationGas
        ? hexToBigInt(sponsorResult.preVerificationGas)
        : userOp.preVerificationGas,
      maxFeePerGas: sponsorResult.maxFeePerGas ? hexToBigInt(sponsorResult.maxFeePerGas) : userOp.maxFeePerGas,
      maxPriorityFeePerGas: sponsorResult.maxPriorityFeePerGas
        ? hexToBigInt(sponsorResult.maxPriorityFeePerGas)
        : userOp.maxPriorityFeePerGas,
    }
    sponsored = true

    if (!hasUserOpGas(userOp)) {
      userOp = await estimateUserOpGas(userOp, 'Estimating user operation gas (sponsored)...')
    }
    if (!hasUserOpGas(userOp) && baselineEstimateError) {
      throw baselineEstimateError
    }

    const packedUserOpForHash: PackedUserOperationForHash = {
      sender: userOp.sender,
      nonce: userOp.nonce,
      initCode: getInitCode(userOp),
      callData: userOp.callData,
      accountGasLimits: packTwoUint128(userOp.verificationGasLimit, userOp.callGasLimit),
      preVerificationGas: userOp.preVerificationGas,
      gasFees: packTwoUint128(userOp.maxPriorityFeePerGas, userOp.maxFeePerGas),
      paymasterAndData: getPaymasterAndData(userOp),
      signature: '0x',
    }
    const userOpHashForSign = await withSpinner(
      'Computing entrypoint userOp hash...',
      () =>
        publicClient.readContract({
          address: entryPointAddress,
          abi: ENTRY_POINT_GET_USER_OP_HASH_ABI,
          functionName: 'getUserOpHash',
          args: [packedUserOpForHash],
        }) as Promise<Hex>,
      {enabled: spinnerEnabled},
    )

    const aaSignature = await withSpinner(
      'Signing user operation...',
      () => aaOwnerAccount.signMessage({message: {raw: userOpHashForSign}}),
      {enabled: spinnerEnabled},
    )
    userOp = {...userOp, signature: aaSignature}

    let userOpHash: `0x${string}` | null = null
    let txHash: `0x${string}` | null = null

    if (!flags['dry-run']) {
      // submit + 轮询 receipt 抽成局部函数，便于后续复用到其他命令。
      const submitAndWait = async (op: UserOperation<'0.7'>): Promise<{hash: `0x${string}`; tx: `0x${string}` | null}> => {
        const hash = await withSpinner(
          'Submitting user operation...',
          async () => {
            const request = formatUserOperationRequest(op)
            return await bundlerRequest<`0x${string}`>(
              bundlerRpcUrl,
              'eth_sendUserOperation',
              [request, entryPointAddress],
            )
          },
          {enabled: spinnerEnabled},
        )

        const timeoutMs = Math.max(15, flags['wait-timeout-sec']) * 1000
        const started = Date.now()
        const tx = await withSpinner(
          'Waiting for user operation receipt...',
          async () => {
            while (Date.now() - started < timeoutMs) {
              const receipt = await bundlerRequest<unknown>(
                bundlerRpcUrl,
                'eth_getUserOperationReceipt',
                [hash],
              )
              const resolved = extractUserOpTxHash(receipt)
              if (resolved) return resolved
              await sleep(2000)
            }
            return null
          },
          {enabled: spinnerEnabled},
        )
        return {hash, tx}
      }

      const sent = await submitAndWait(userOp)
      userOpHash = sent.hash
      txHash = sent.tx
    }

    this.render(
      json,
      {
        ok: true,
        mode: 'aa-paymaster',
        tbaAddress,
        aaAccountAddress,
        entryPointAddress,
        tokenAddress,
        symbol,
        decimals,
        amount: amount.raw,
        amountKind: amount.kind,
        amountUnits,
        paymasterMode: 'required',
        sponsored,
        sponsorshipPolicyId: sponsorshipPolicyId ?? null,
        recipientInput: recipient.raw,
        recipientAddress,
        policySigner: policy.signer,
        policyNonce: policyCall.nonce,
        policyDeadline: policyCall.deadline,
        policyPullAmount: policyCall.pullAmount,
        userOpHash,
        txHash,
        dryRun: flags['dry-run'],
      },
      [
        'Send completed via AA paymaster.',
        `asset: ${symbol} (${tokenAddress})`,
        `amount: ${formatUnits(amountUnits, decimals)} (${amountUnits.toString()} units)`,
        `recipient: ${recipientAddress}`,
        `aa account: ${aaAccountAddress}`,
        `paymaster mode: required (${sponsored ? 'sponsored' : 'not sponsored'})`,
        `paymaster policy: ${sponsorshipPolicyId ?? '(none)'}`,
        `entrypoint: ${entryPointAddress}`,
        `userOp: ${userOpHash ?? '(dry-run)'}`,
        `tx: ${txHash ?? (flags['dry-run'] ? '(dry-run)' : '(pending)')}`,
      ].join('\n'),
    )
  }
}
