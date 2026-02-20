import {Flags} from '@oclif/core'
import {input} from '@inquirer/prompts'
import {BaseCommand} from '../base-command.js'
import {getPublicClient, parseAddress, parsePrivateKey} from '../lib/chain.js'
import {ERC6551_REGISTRY_ABI} from '../lib/contracts.js'
import {addressFromPrivateKey} from '../lib/context.js'
import {resolveTokenId} from '../lib/binding.js'
import {statePath} from '../lib/state.js'
import {withSpinner} from '../lib/spinner.js'
import {entryPoint07Address, formatUserOperationRequest, type UserOperation} from 'viem/account-abstraction'
import {
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  hexToBigInt,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {randomBytes} from 'node:crypto'

// 默认使用 singleton factory 部署 minimal 4337 账户。
const SINGLETON_FACTORY_ADDRESS = '0xce0042B868300000d44A59004Da54A005ffdcf9f' as const
const MAX_UINT128 = (1n << 128n) - 1n
const SALT_ZERO = '0x0000000000000000000000000000000000000000000000000000000000000000' as const

const SINGLETON_FACTORY_ABI = parseAbi([
  'function deploy(bytes initCode, bytes32 salt) payable returns (address createdContract)',
])

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

// 统一在 init 里生成私钥，保持“keys-first”体验。
function generatePrivateKey(): `0x${string}` {
  return `0x${randomBytes(32).toString('hex')}` as `0x${string}`
}

// 兼容用户输入带/不带 0x 的字节码字符串。
function normalizeHex(input: string): Hex {
  const value = input.trim()
  if (!value) throw new Error('empty hex data')
  const hex = value.startsWith('0x') ? value : (`0x${value}` as const)
  if (!/^0x[0-9a-fA-F]*$/.test(hex)) throw new Error('invalid hex data')
  return hex as Hex
}

// 在多个可能路径查找 forge 产物，减少目录结构变化造成的易碎性。
function loadMinimal4337Bytecode(): Hex {
  const relCandidates = [
    ['out', 'src', 'mocks', 'Minimal4337Account.sol', 'Minimal4337Account.json'],
    ['out', 'Minimal4337Account.sol', 'Minimal4337Account.json'],
  ]
  const candidates = [
    ...relCandidates.map((rel) => join(process.cwd(), ...rel)),
    ...relCandidates.map((rel) => join(process.cwd(), '..', ...rel)),
    ...relCandidates.map((rel) => join(process.cwd(), '..', '..', ...rel)),
  ]

  for (const p of candidates) {
    if (!existsSync(p)) continue
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as {
      bytecode?: {object?: string} | string
    }
    const maybe = typeof parsed.bytecode === 'string' ? parsed.bytecode : parsed.bytecode?.object
    if (!maybe) continue
    return normalizeHex(maybe)
  }

  throw new Error(
    'missing Minimal4337Account artifact. Run `forge build` first so init can auto-deploy AA account.',
  )
}

// salt 绑定 entrypoint + owner，保证同配置下地址可预测且稳定。
function computeAaSalt(entryPoint: `0x${string}`, aaOwnerAddress: `0x${string}`): `0x${string}` {
  return keccak256(
    encodePacked(
      ['string', 'address', 'address'],
      ['aba-minimal-4337-v1', entryPoint, aaOwnerAddress],
    ),
  )
}

// 本地计算 create2 地址，用于“先预测再检查是否已部署”。
function computeCreate2Address(
  deployer: `0x${string}`,
  salt: `0x${string}`,
  initCode: Hex,
): `0x${string}` {
  const initCodeHash = keccak256(initCode)
  const digest = keccak256(`0xff${deployer.slice(2)}${salt.slice(2)}${initCodeHash.slice(2)}` as Hex)
  return parseAddress(`0x${digest.slice(-40)}`, 'aa-account')
}

// EntryPoint 需要的 bytes32 打包工具。
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

// bundler receipt -> 最终链上 txHash。
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

async function bundlerRequest<T>(
  bundlerRpcUrl: string,
  method: string,
  params: unknown[],
): Promise<T> {
  // init / bind / send 都复用该 RPC 出口，行为保持一致。
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export default class Init extends BaseCommand<typeof Init> {
  static override description =
    '[AGENT] initialize aba runtime config and bind NFT. Required: --rpc-url, --aa-bundler-rpc-url, --nft-ca, and either --token-id or --owner-address.'

  static override flags = {
    ...BaseCommand.baseFlags,
    'rpc-url': Flags.string({
      description: 'rpc url for sepolia',
      required: true,
    }),
    registry: Flags.string({
      description: 'erc6551 registry address',
    }),
    implementation: Flags.string({
      description: 'agent6551 implementation address',
    }),
    'aa-account': Flags.string({
      description: 'AA smart account address',
    }),
    'aa-bundler-rpc-url': Flags.string({
      description: 'AA bundler/paymaster RPC URL',
      required: true,
    }),
    'aa-sponsorship-policy-id': Flags.string({
      description: 'AA sponsorship policy id',
    }),
    'aa-entrypoint': Flags.string({
      description: `AA entrypoint address (default: ${entryPoint07Address})`,
    }),
    'auto-deploy-aa': Flags.boolean({
      description: 'auto deploy AA account when aa-account is not set',
      default: true,
      allowNo: true,
    }),
    'aa-factory': Flags.string({
      description: `AA account factory address for UserOp deployment (default: ${SINGLETON_FACTORY_ADDRESS})`,
    }),
    'nft-ca': Flags.string({
      description: 'NFT contract address (required)',
      required: true,
    }),
    'token-id': Flags.string({
      description: 'token id (optional if --owner-address provided)',
    }),
    'owner-address': Flags.string({
      description: 'owner address for auto-discovering tokenId',
    }),
    interactive: Flags.boolean({
      description: 'enable interactive prompts for missing inputs',
      default: true,
      allowNo: true,
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Init)
    const json = flags.json
    const spinnerEnabled = !json
    const interactive = flags.interactive && !json

    const state = this.getState()
    // 兼容旧字段：历史上可能存在 ownerPrivateKey，这里统一清理。
    if ('ownerPrivateKey' in (state as Record<string, unknown>)) {
      delete (state as {ownerPrivateKey?: string}).ownerPrivateKey
    }

    // CLI 参数覆盖本地状态，保持“显式输入优先”。
    if (flags['rpc-url']) state.rpcUrl = flags['rpc-url']
    if (flags.registry) state.registryAddress = flags.registry as `0x${string}`
    if (flags.implementation) state.implementationAddress = flags.implementation as `0x${string}`
    if (flags['aa-account']) state.aaAccountAddress = parseAddress(flags['aa-account'], 'aa-account')
    if (flags['aa-bundler-rpc-url']) state.aaBundlerRpcUrl = flags['aa-bundler-rpc-url']
    if (flags['aa-sponsorship-policy-id']) state.aaSponsorshipPolicyId = flags['aa-sponsorship-policy-id']
    if (flags['aa-entrypoint']) state.aaEntrypointAddress = parseAddress(flags['aa-entrypoint'], 'aa-entrypoint')

    let generatedAaOwnerKey = false
    let generatedAgentSignerKey = false
    // keys-first：缺什么补什么，避免用户第一次运行就被密钥配置阻塞。
    if (!state.aaOwnerPrivateKey) {
      state.aaOwnerPrivateKey = generatePrivateKey()
      generatedAaOwnerKey = true
    }
    if (!state.agentSignerPrivateKey) {
      let next = generatePrivateKey()
      while (next.toLowerCase() === state.aaOwnerPrivateKey.toLowerCase()) {
        next = generatePrivateKey()
      }
      state.agentSignerPrivateKey = next
      generatedAgentSignerKey = true
    }
    state.agentSignerAddress = addressFromPrivateKey(state.agentSignerPrivateKey)

    if (interactive && !state.aaAccountAddress) {
      const value = await input({
        message: 'AA smart account address (optional, press enter to skip):',
      })
      const trimmed = value.trim()
      if (trimmed) state.aaAccountAddress = parseAddress(trimmed, 'aa-account')
    }

    if (interactive && !state.aaBundlerRpcUrl) {
      const value = await input({
        message: 'AA bundler RPC URL (optional, press enter to skip):',
      })
      const trimmed = value.trim()
      if (trimmed) state.aaBundlerRpcUrl = trimmed
    }

    if (interactive && !state.aaSponsorshipPolicyId) {
      const value = await input({
        message: 'AA sponsorship policy id (optional, press enter to skip):',
      })
      const trimmed = value.trim()
      if (trimmed) state.aaSponsorshipPolicyId = trimmed
    }

    if (interactive && !state.aaEntrypointAddress) {
      const value = await input({
        message: `AA entrypoint (optional, press enter for default ${entryPoint07Address}):`,
      })
      const trimmed = value.trim()
      if (trimmed) state.aaEntrypointAddress = parseAddress(trimmed, 'aa-entrypoint')
    }

    let aaDeployTxHash: `0x${string}` | null = null
    let aaDeployUserOpHash: `0x${string}` | null = null
    const entryPointAddress = state.aaEntrypointAddress ?? entryPoint07Address
    // 没有显式 aa-account 时，自动尝试部署 minimal 4337 账户。
    if (flags['auto-deploy-aa'] && !state.aaAccountAddress) {
      const publicClient = getPublicClient()
      const bundlerRpcUrl = state.aaBundlerRpcUrl
      if (!bundlerRpcUrl) throw new Error('AA bundler rpc is required (set --aa-bundler-rpc-url)')
      const sponsorshipPolicyId = state.aaSponsorshipPolicyId || null

      const factoryAddress = flags['aa-factory']
        ? parseAddress(flags['aa-factory'], 'aa-factory')
        : SINGLETON_FACTORY_ADDRESS

      const aaOwnerPk = parsePrivateKey(state.aaOwnerPrivateKey!)
      const aaOwnerAccount = privateKeyToAccount(aaOwnerPk)
      const aaOwnerAddress = aaOwnerAccount.address
      const bytecode = loadMinimal4337Bytecode()
      const constructorArgs = encodeAbiParameters(
        [{type: 'address'}, {type: 'address'}],
        [entryPointAddress, aaOwnerAddress],
      )
      const createCode = `${bytecode}${constructorArgs.slice(2)}` as Hex
      const salt = computeAaSalt(entryPointAddress, aaOwnerAddress)
      const predictedAaAddress = computeCreate2Address(factoryAddress, salt, createCode)

      // 先检查预测地址是否已有代码，已部署则直接复用。
      const code = await withSpinner(
        'Checking AA account deployment status...',
        () => publicClient.getBytecode({address: predictedAaAddress}),
        {enabled: spinnerEnabled},
      )
      const needsCreate = !code || code === '0x'

      if (needsCreate) {
        const nonce = (await withSpinner(
          'Reading AA account nonce...',
          () =>
            publicClient.readContract({
              address: entryPointAddress,
              abi: ENTRY_POINT_GET_NONCE_ABI,
              functionName: 'getNonce',
              args: [predictedAaAddress, 0n],
            }) as Promise<bigint>,
          {enabled: spinnerEnabled},
        )) as bigint

        const factoryData = encodeFunctionData({
          abi: SINGLETON_FACTORY_ABI,
          functionName: 'deploy',
          args: [createCode, salt],
        })

        const accountCallData = encodeFunctionData({
          abi: SIMPLE_ACCOUNT_EXECUTE_ABI,
          functionName: 'execute',
          args: [aaOwnerAddress, 0n, '0x'],
        })

        let maxPriorityFeePerGas = 1_000_000_000n
        let maxFeePerGas = maxPriorityFeePerGas * 2n
        // gas 参数优先拿 bundler 建议，失败再回退公共 RPC 估算。
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
          sender: predictedAaAddress,
          nonce,
          factory: factoryAddress,
          factoryData,
          callData: accountCallData,
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

        const sent = await withSpinner(
          'Submitting user operation...',
          async () => {
            const request = formatUserOperationRequest(userOp)
            const hash = await bundlerRequest<`0x${string}`>(
              bundlerRpcUrl,
              'eth_sendUserOperation',
              [request, entryPointAddress],
            )

            const started = Date.now()
            const timeoutMs = 120_000
            while (Date.now() - started < timeoutMs) {
              const receipt = await bundlerRequest<unknown>(
                bundlerRpcUrl,
                'eth_getUserOperationReceipt',
                [hash],
              )
              const resolved = extractUserOpTxHash(receipt)
              if (resolved) return {hash, txHash: resolved}
              await sleep(2_000)
            }
            return {hash, txHash: null}
          },
          {enabled: spinnerEnabled},
        )

        aaDeployUserOpHash = sent.hash
        aaDeployTxHash = sent.txHash
        if (!aaDeployTxHash) {
          throw new Error('AA deploy userOp submitted but no receipt txHash within timeout')
        }

        const deployedCode = await withSpinner(
          'Verifying AA account deployment on-chain...',
          () => publicClient.getBytecode({address: predictedAaAddress}),
          {enabled: spinnerEnabled},
        )
        if (!deployedCode || deployedCode === '0x') {
          throw new Error('AA account code still empty after deploy userOp execution')
        }
      }

      state.aaAccountAddress = predictedAaAddress
    }

    // ========== TBA 绑定逻辑 ==========
    const publicClient = getPublicClient()
    let tbaAddress: `0x${string}` | null = null
    let tbaCreated = false
    let tbaCreateTxHash: `0x${string}` | null = null
    let tbaCreateUserOpHash: `0x${string}` | null = null

    // --nft-ca is now required
    const nftContract = parseAddress(flags['nft-ca'], 'nft-ca')

    // Either --token-id or --owner-address is required
    if (!flags['token-id'] && !flags['owner-address']) {
      throw new Error('either --token-id or --owner-address is required')
    }

    // Determine owner address
    const ownerAddress = flags['owner-address']
      ? parseAddress(flags['owner-address'], 'owner-address')
      : null

    // Determine tokenId
    let tokenId: bigint
    if (flags['token-id'] && flags['token-id'] !== 'auto') {
      // Explicit token ID provided
      tokenId = BigInt(flags['token-id'])
    } else {
      // Auto-discover: either --token-id=auto or only --owner-address
      const effectiveOwner = ownerAddress ?? (state.agentSignerAddress ?? null)
      if (!effectiveOwner) {
        throw new Error('--owner-address is required when --token-id is not provided')
      }
      tokenId = await withSpinner(
        'Resolving tokenId from on-chain data...',
        () => resolveTokenId(publicClient, nftContract, effectiveOwner, 'auto', interactive),
        {enabled: spinnerEnabled},
      )
    }

    // 计算 TBA 地址
    tbaAddress = (await withSpinner(
      'Computing TBA address...',
      () =>
        publicClient.readContract({
          address: state.registryAddress,
          abi: ERC6551_REGISTRY_ABI,
          functionName: 'account',
          args: [state.implementationAddress, SALT_ZERO, BigInt(state.chainId), nftContract, tokenId],
        }) as Promise<`0x${string}`>,
      {enabled: spinnerEnabled},
    )) as `0x${string}`

    // 检查 TBA 是否已部署
    const tbaCode = await withSpinner(
      'Checking TBA deployment status...',
      () => publicClient.getBytecode({address: tbaAddress!}),
      {enabled: spinnerEnabled},
    )
    const needsTbaCreate = !tbaCode || tbaCode === '0x'

    if (needsTbaCreate && state.aaAccountAddress && state.aaOwnerPrivateKey && state.aaBundlerRpcUrl) {
      const aaOwnerPk = parsePrivateKey(state.aaOwnerPrivateKey)
      const aaOwnerAccount = privateKeyToAccount(aaOwnerPk)
      const bundlerRpcUrl = state.aaBundlerRpcUrl
      const sponsorshipPolicyId = state.aaSponsorshipPolicyId || null

        const nonce = (await withSpinner(
          'Reading AA account nonce...',
          () =>
            publicClient.readContract({
              address: entryPointAddress,
              abi: ENTRY_POINT_GET_NONCE_ABI,
              functionName: 'getNonce',
              args: [state.aaAccountAddress!, 0n],
            }) as Promise<bigint>,
          {enabled: spinnerEnabled},
        )) as bigint

        const createAccountCalldata = encodeFunctionData({
          abi: ERC6551_REGISTRY_ABI,
          functionName: 'createAccount',
          args: [state.implementationAddress, SALT_ZERO, BigInt(state.chainId), nftContract!, tokenId!],
        })

        const smartAccountCallData = encodeFunctionData({
          abi: SIMPLE_ACCOUNT_EXECUTE_ABI,
          functionName: 'execute',
          args: [state.registryAddress, 0n, createAccountCalldata],
        })

        let maxPriorityFeePerGas = 1_000_000_000n
        let maxFeePerGas = maxPriorityFeePerGas * 2n
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
          sender: state.aaAccountAddress,
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
          userOp = await estimateUserOpGas(userOp, 'Estimating TBA creation gas (baseline)...')
        } catch (error) {
          baselineEstimateError = error
        }

        const sponsorResult = (await withSpinner(
          'Requesting paymaster sponsorship for TBA creation...',
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

        if (!hasUserOpGas(userOp)) {
          userOp = await estimateUserOpGas(userOp, 'Estimating TBA creation gas (sponsored)...')
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

        const sent = await withSpinner(
          'Submitting TBA creation user operation...',
          async () => {
            const request = formatUserOperationRequest(userOp)
            const hash = await bundlerRequest<`0x${string}`>(
              bundlerRpcUrl,
              'eth_sendUserOperation',
              [request, entryPointAddress],
            )

            const started = Date.now()
            const timeoutMs = 120_000
            while (Date.now() - started < timeoutMs) {
              const receipt = await bundlerRequest<unknown>(
                bundlerRpcUrl,
                'eth_getUserOperationReceipt',
                [hash],
              )
              const resolved = extractUserOpTxHash(receipt)
              if (resolved) return {hash, txHash: resolved}
              await sleep(2_000)
            }
            return {hash, txHash: null}
          },
          {enabled: spinnerEnabled},
        )

        tbaCreateUserOpHash = sent.hash
        tbaCreateTxHash = sent.txHash
        if (!tbaCreateTxHash) {
          throw new Error('TBA create userOp submitted but no receipt txHash within timeout')
        }

        const tbaDeployedCode = await withSpinner(
          'Verifying TBA deployment on-chain...',
          () => publicClient.getBytecode({address: tbaAddress!}),
          {enabled: spinnerEnabled},
        )
        if (!tbaDeployedCode || tbaDeployedCode === '0x') {
          throw new Error('TBA code still empty after createAccount userOp execution')
        }
        tbaCreated = true
      }

    // 保存绑定
    state.binding = {
      nftContract,
      tokenId,
      tbaAddress: tbaAddress!,
      updatedAt: new Date().toISOString(),
    }

    // 所有变更一次性落盘，避免中间状态污染。
    await withSpinner(
      'Saving runtime configuration...',
      async () => {
        this.setState(state)
      },
      {enabled: spinnerEnabled},
    )

    this.render(
      json,
      {
        ok: true,
        statePath: statePath(),
        network: state.network,
        chainId: state.chainId,
        registryAddress: state.registryAddress,
        implementationAddress: state.implementationAddress,
        agentSignerAddress: state.agentSignerAddress ?? null,
        aaOwnerAddress: state.aaOwnerPrivateKey ? addressFromPrivateKey(state.aaOwnerPrivateKey) : null,
        aaAccountAddress: state.aaAccountAddress ?? null,
        hasAaOwnerKey: Boolean(state.aaOwnerPrivateKey),
        hasAgentSignerKey: Boolean(state.agentSignerPrivateKey),
        aaBundlerRpcUrl: state.aaBundlerRpcUrl ?? null,
        aaSponsorshipPolicyId: state.aaSponsorshipPolicyId ?? null,
        aaEntrypointAddress: entryPointAddress,
        aaFactoryAddress: flags['aa-factory'] ?? SINGLETON_FACTORY_ADDRESS,
        aaDeployUserOpHash,
        aaDeployTxHash,
        generatedAaOwnerKey,
        generatedAgentSignerKey,
        // TBA 绑定信息
        nftContract,
        tokenId: tokenId?.toString() ?? null,
        tbaAddress,
        tbaCreated,
        tbaCreateTxHash,
        tbaCreateUserOpHash,
      },
      [
        'Initialized aba runtime.',
        `state: ${statePath()}`,
        `network: ${state.network} (${state.chainId})`,
        `registry: ${state.registryAddress}`,
        `implementation: ${state.implementationAddress}`,
        `agent signer key: ${state.agentSignerPrivateKey ? `configured${generatedAgentSignerKey ? ' (generated)' : ''}` : 'not set'}`,
        `agent signer: ${state.agentSignerAddress ?? '(not set)'}`,
        `aa account: ${state.aaAccountAddress ?? '(not set)'}`,
        `aa owner key: ${state.aaOwnerPrivateKey ? `configured${generatedAaOwnerKey ? ' (generated)' : ''}` : 'not set'}`,
        `aa owner: ${state.aaOwnerPrivateKey ? addressFromPrivateKey(state.aaOwnerPrivateKey) : '(not set)'}`,
        `aa bundler rpc: ${state.aaBundlerRpcUrl ?? '(not set)'}`,
        `aa sponsorship policy: ${state.aaSponsorshipPolicyId ?? '(not set)'}`,
        `aa entrypoint: ${entryPointAddress}`,
        `aa deploy userOp: ${aaDeployUserOpHash ?? '(skipped)'}`,
        `aa deploy tx: ${aaDeployTxHash ?? '(skipped)'}`,
        ...(tbaAddress
          ? [
              '',
              `nft: ${nftContract} #${tokenId}`,
              `tba: ${tbaAddress}`,
              `tba created: ${tbaCreated}`,
              `tba create tx: ${tbaCreateTxHash ?? '(skipped)'}`,
            ]
          : []),
      ].join('\n'),
    )
  }
}
