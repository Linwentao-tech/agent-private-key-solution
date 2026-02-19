import {BaseCommand} from '../base-command.js'
import {getPublicClient} from '../lib/chain.js'
import {statePath} from '../lib/state.js'
import {requireBinding} from '../lib/require.js'
import {withSpinner} from '../lib/spinner.js'

// doctor 采用“检查项数组”模式：每一步只追加结果，最终统一汇总。
export default class Doctor extends BaseCommand<typeof Doctor> {
  static override description = 'check runtime and dependencies health. Required inputs: none.'

  static override flags = {
    ...BaseCommand.baseFlags,
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Doctor)
    const json = flags.json
    const state = this.getState()
    const spinnerEnabled = !json

    const checks: Array<{name: string; ok: boolean; detail: string}> = []

    // 先检查最基础的本地状态文件路径是否可解析。
    checks.push({name: 'state-file', ok: true, detail: statePath()})

    let publicClient: ReturnType<typeof getPublicClient> | undefined
    try {
      const client = getPublicClient()
      publicClient = client
      const chainId = await withSpinner(
        'Checking RPC connectivity...',
        () => client.getChainId(),
        {enabled: spinnerEnabled},
      )
      checks.push({name: 'rpc', ok: chainId === state.chainId, detail: `rpc chainId=${chainId}`})
    } catch (error) {
      checks.push({
        name: 'rpc',
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      })
    }

    if (publicClient) {
      // 只有 RPC 可用时才继续做链上 bytecode 检查，避免连锁报错干扰定位。
      try {
        const registryCode = await withSpinner(
          'Checking registry bytecode...',
          () => publicClient.getBytecode({address: state.registryAddress}),
          {enabled: spinnerEnabled},
        )
        checks.push({name: 'registry-code', ok: Boolean(registryCode && registryCode !== '0x'), detail: state.registryAddress})
      } catch (error) {
        checks.push({name: 'registry-code', ok: false, detail: error instanceof Error ? error.message : String(error)})
      }

      try {
        const implCode = await withSpinner(
          'Checking implementation bytecode...',
          () => publicClient.getBytecode({address: state.implementationAddress}),
          {enabled: spinnerEnabled},
        )
        checks.push({
          name: 'implementation-code',
          ok: Boolean(implCode && implCode !== '0x'),
          detail: state.implementationAddress,
        })
      } catch (error) {
        checks.push({
          name: 'implementation-code',
          ok: false,
          detail: error instanceof Error ? error.message : String(error),
        })
      }
    }

    if (state.binding && publicClient) {
      try {
        const {tbaAddress} = requireBinding(state)
        const tbaCode = await withSpinner(
          'Checking bound TBA bytecode...',
          () => publicClient.getBytecode({address: tbaAddress}),
          {enabled: spinnerEnabled},
        )
        checks.push({name: 'binding-tba-code', ok: Boolean(tbaCode && tbaCode !== '0x'), detail: tbaAddress})
      } catch (error) {
        checks.push({name: 'binding-tba-code', ok: false, detail: error instanceof Error ? error.message : String(error)})
      }
    }

    const ok = checks.every((check) => check.ok)

    this.render(
      json,
      {ok, checks},
      [
        `doctor: ${ok ? 'ok' : 'issues detected'}`,
        ...checks.map((check) => `${check.ok ? '[ok]' : '[x]'} ${check.name}: ${check.detail}`),
      ].join('\n'),
    )
  }
}
