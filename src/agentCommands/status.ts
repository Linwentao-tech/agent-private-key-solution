import {BaseCommand} from '../base-command.js'
import {getPublicClient} from '../lib/chain.js'
import {AGENT6551_ABI} from '../lib/contracts.js'
import {withSpinner} from '../lib/spinner.js'

// status 负责把“本地状态 + 链上可验证信息”拼成一份诊断视图。
export default class Status extends BaseCommand<typeof Status> {
  static override description = 'show current binding/network/runtime status. Required inputs: none.'

  static override flags = {
    ...BaseCommand.baseFlags,
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Status)
    const json = flags.json
    const state = this.getState()
    const spinnerEnabled = !json

    const out: Record<string, unknown> = {
      network: state.network,
      chainId: state.chainId,
      rpcUrl: state.rpcUrl || '(default public rpc)',
      registryAddress: state.registryAddress,
      implementationAddress: state.implementationAddress,
      binding: state.binding ?? null,
      policyCreated: Boolean(state.binding?.policyCreatedAt),
      policyCreatedAt: state.binding?.policyCreatedAt ?? null,
    }

    if (!state.binding) {
      // 没有绑定时也保持一致的 spinner 体验，便于 CLI 输出风格统一。
      await withSpinner(
        'Loading local runtime status...',
        async () => {},
        {enabled: spinnerEnabled},
      )
    }

    if (state.binding) {
      const binding = state.binding
      try {
        const publicClient = getPublicClient()
        // 先看 bytecode 是否存在，再决定是否继续读取 policy（避免空地址读合约报错）。
        const code = await withSpinner(
          'Checking bound TBA bytecode...',
          () => publicClient.getBytecode({address: binding.tbaAddress}),
          {enabled: spinnerEnabled},
        )
        const deployed = Boolean(code && code !== '0x')

        out.tbaDeployed = deployed

        if (deployed) {
          const policy = await withSpinner(
            'Loading bound TBA policy...',
            () =>
              publicClient.readContract({
                address: binding.tbaAddress,
                abi: AGENT6551_ABI,
                functionName: 'policy',
              }),
            {enabled: spinnerEnabled},
          )
          out.policy = policy
        }
      } catch (error) {
        out.onchainError = error instanceof Error ? error.message : String(error)
      }
    }

    const text = [
      `network: ${String(out.network)} (${String(out.chainId)})`,
      `registry: ${String(out.registryAddress)}`,
      `implementation: ${String(out.implementationAddress)}`,
      `binding: ${state.binding ? `${state.binding.nftContract} #${state.binding.tokenId.toString()} -> ${state.binding.tbaAddress}` : 'none'}`,
      `policy created: ${state.binding?.policyCreatedAt ? `yes (${state.binding.policyCreatedAt})` : 'no'}`,
      `tba deployed: ${String(out.tbaDeployed ?? false)}`,
    ].join('\n')

    this.render(json, out, text)
  }
}
