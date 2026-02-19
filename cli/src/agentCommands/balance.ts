import {Flags} from '@oclif/core'
import {BaseCommand} from '../base-command.js'
import {getPublicClient, parseAddress} from '../lib/chain.js'
import {AGENT6551_ABI, ERC20_ABI} from '../lib/contracts.js'
import {requireBinding} from '../lib/require.js'
import {formatUnits} from '../lib/units.js'
import {DEFAULT_USDT_ADDRESS} from '../lib/constants.js'
import {withSpinner} from '../lib/spinner.js'

// 把用户输入统一成“链上地址”或 ETH（null），后续逻辑只处理一种形态。
function resolveTokenAddress(tokenFlag: string | undefined): `0x${string}` | null {
  if (!tokenFlag) return null
  const normalized = tokenFlag.trim().toUpperCase()
  if (normalized === 'ETH') return null
  if (normalized === 'USDT') return DEFAULT_USDT_ADDRESS
  return parseAddress(tokenFlag, 'token')
}

export default class Balance extends BaseCommand<typeof Balance> {
  static override description =
    'query holder/tba balances. Required inputs: existing binding and created policy.'

  static override flags = {
    ...BaseCommand.baseFlags,
    token: Flags.string({description: 'token symbol or address'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Balance)
    const json = flags.json
    const state = this.getState()
    // balance 依赖已经绑定并创建过 policy 的 TBA。
    const {tbaAddress} = requireBinding(state, {requirePolicyCreated: true})

    const publicClient = getPublicClient()
    const ownerAddress = (await withSpinner(
      'Resolving NFT owner address from TBA...',
      () =>
        publicClient.readContract({
          address: tbaAddress,
          abi: AGENT6551_ABI,
          functionName: 'owner',
        }) as Promise<`0x${string}`>,
      {enabled: !json},
    )) as `0x${string}`
    const tokenAddress = resolveTokenAddress(flags.token)
    const spinnerEnabled = !json

    if (!tokenAddress) {
      // token 为空时按 ETH 走原生余额查询。
      const {ownerEth, tbaEth} = await withSpinner(
        'Fetching ETH balances...',
        async () => ({
          ownerEth: await publicClient.getBalance({address: ownerAddress}),
          tbaEth: await publicClient.getBalance({address: tbaAddress}),
        }),
        {enabled: spinnerEnabled},
      )

      this.render(
        json,
        {
          asset: 'ETH',
          ownerAddress,
          ownerBalanceWei: ownerEth,
          tbaAddress,
          tbaBalanceWei: tbaEth,
        },
        [
          'asset: ETH',
          `owner: ${ownerAddress} ${ownerEth.toString()} wei`,
          `tba: ${tbaAddress} ${tbaEth.toString()} wei`,
        ].join('\n'),
      )
      return
    }

    const {symbol, decimalsRaw} = await withSpinner(
      'Fetching token metadata...',
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

    // ERC20 路径：同一套 balanceOf 分别查 owner 和 tba。
    const {ownerToken, tbaToken} = await withSpinner(
      'Fetching token balances...',
      async () => ({
        ownerToken: (await publicClient.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [ownerAddress],
        })) as bigint,
        tbaToken: (await publicClient.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [tbaAddress],
        })) as bigint,
      }),
      {enabled: spinnerEnabled},
    )

    this.render(
      json,
      {
        asset: symbol,
        tokenAddress,
        decimals,
        ownerAddress,
        ownerBalance: ownerToken,
        tbaAddress,
        tbaBalance: tbaToken,
      },
      [
        `asset: ${symbol} (${tokenAddress})`,
        `owner: ${ownerAddress} ${formatUnits(ownerToken, decimals)}`,
        `tba: ${tbaAddress} ${formatUnits(tbaToken, decimals)}`,
      ].join('\n'),
    )
  }
}
