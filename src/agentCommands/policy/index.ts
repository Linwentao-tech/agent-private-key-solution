import {BaseCommand} from '../../base-command.js'
import {getPublicClient} from '../../lib/chain.js'
import {AGENT6551_ABI} from '../../lib/contracts.js'
import {requireBinding} from '../../lib/require.js'
import {withSpinner} from '../../lib/spinner.js'

// policy 子命令中的“只读总览”：一次拉取 policy + targets 并统一输出。
export default class Policy extends BaseCommand<typeof Policy> {
  static override description = 'show current agent policy. Required inputs: existing binding and created policy.'

  static override flags = {
    ...BaseCommand.baseFlags,
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Policy)
    const json = flags.json
    const state = this.getState()
    const {tbaAddress} = requireBinding(state, {requirePolicyCreated: true})
    const spinnerEnabled = !json

    const publicClient = getPublicClient()
    // 这里并发读取两个只读调用，减少一次网络往返。
    const {policy, targets} = await withSpinner(
      'Loading policy and targets...',
      async () => {
        const policy = await publicClient.readContract({
          address: tbaAddress,
          abi: AGENT6551_ABI,
          functionName: 'policy',
        })

        const targets = await publicClient.readContract({
          address: tbaAddress,
          abi: AGENT6551_ABI,
          functionName: 'getPolicyTargets',
        })

        return {policy, targets}
      },
      {enabled: spinnerEnabled},
    )

    this.render(
      json,
      {tbaAddress, policy, targets},
      [
        `tba: ${tbaAddress}`,
        `policy: ${JSON.stringify(policy, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}`,
        `targets: ${(targets as string[]).join(', ')}`,
      ].join('\n'),
    )
  }
}
