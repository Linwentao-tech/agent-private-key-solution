import {BaseCommand} from '../base-command.js'
import {getPublicClient} from '../lib/chain.js'
import {AGENT6551_ABI} from '../lib/contracts.js'
import {requireBinding} from '../lib/require.js'
import {withSpinner} from '../lib/spinner.js'

// 该命令显式把链上的 policy tuple 转成具名对象，方便阅读和后续扩展。
export default class ResolvePolicy extends BaseCommand<typeof ResolvePolicy> {
  static override description =
    'resolve current single agent policy. Required inputs: existing binding and created policy.'

  static override flags = {
    ...BaseCommand.baseFlags,
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ResolvePolicy)
    const json = flags.json
    const state = this.getState()
    const {tbaAddress} = requireBinding(state, {requirePolicyCreated: true})
    const spinnerEnabled = !json
    const publicClient = getPublicClient()

    // 合约返回 tuple，先按索引接，再映射成语义化字段。
    const policyTuple = (await withSpinner(
      'Loading policy...',
      () =>
        publicClient.readContract({
          address: tbaAddress,
          abi: AGENT6551_ABI,
          functionName: 'policy',
        }) as Promise<readonly [`0x${string}`, bigint, bigint, bigint, `0x${string}`, boolean]>,
      {enabled: spinnerEnabled},
    )) as readonly [`0x${string}`, bigint, bigint, bigint, `0x${string}`, boolean]
    const policy = {
      signer: policyTuple[0],
      validUntil: policyTuple[1],
      maxTotal: policyTuple[2],
      spent: policyTuple[3],
      budgetToken: policyTuple[4],
      active: policyTuple[5],
    }

    // targets 独立查询，输出时与 policy 并列，便于前端或脚本直接消费。
    const targets = (await withSpinner(
      'Loading policy targets...',
      () =>
        publicClient.readContract({
          address: tbaAddress,
          abi: AGENT6551_ABI,
          functionName: 'getPolicyTargets',
        }) as Promise<`0x${string}`[]>,
      {enabled: spinnerEnabled},
    )) as `0x${string}`[]

    this.render(
      json,
      {tbaAddress, policy, targets},
      [
        `tba: ${tbaAddress}`,
        `active: ${policy.active}`,
        `signer: ${policy.signer}`,
        `validUntil: ${policy.validUntil.toString()}`,
        `budgetToken: ${policy.budgetToken}`,
        `spent/max: ${policy.spent.toString()} / ${policy.maxTotal.toString()}`,
        `targets: ${targets.length ? targets.join(', ') : '(none)'}`,
      ].join('\n'),
    )
  }
}
