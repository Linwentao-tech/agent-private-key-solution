import {Flags} from '@oclif/core'
import {BaseCommand} from '../base-command.js'
import {getPublicClient} from '../lib/chain.js'
import {
  POLICY_CONFIGURED_EVENT,
  POLICY_EXECUTED_EVENT,
  POLICY_REVOKED_EVENT,
  POLICY_UPDATED_EVENT,
} from '../lib/contracts.js'
import {requireBinding} from '../lib/require.js'
import {withSpinner} from '../lib/spinner.js'

const LOG_RPC_RETRIES = 3
const LOG_RPC_RETRY_DELAY_MS = 350
const LOG_MAX_BLOCK_RANGE_PER_QUERY = 10n
const LOG_LOOKBACK_BLOCKS = 500n

// 简单 sleep，配合 RPC 重试做退避。
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 只把“可恢复”的网络错误标记为 transient，避免把业务错误当成可重试。
function isTransientRpcError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  return (
    message.includes('http request failed') ||
    message.includes('fetch failed') ||
    message.includes('timeout') ||
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('429') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('504')
  )
}

async function withRpcRetry<T>(task: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < LOG_RPC_RETRIES; attempt += 1) {
    try {
      return await task()
    } catch (error) {
      lastError = error
      if (!isTransientRpcError(error) || attempt === LOG_RPC_RETRIES - 1) break
      await delay(LOG_RPC_RETRY_DELAY_MS * (attempt + 1))
    }
  }
  throw lastError
}

// 按区块窗口切片查询日志，规避节点对大范围 getLogs 的限制。
async function getLogsChunked<T>(
  fromBlock: bigint,
  toBlock: bigint,
  fetchChunk: (chunkFrom: bigint, chunkTo: bigint) => Promise<T[]>,
): Promise<T[]> {
  const out: T[] = []
  let cursor = fromBlock

  while (cursor <= toBlock) {
    const end = cursor + (LOG_MAX_BLOCK_RANGE_PER_QUERY - 1n) > toBlock
      ? toBlock
      : cursor + (LOG_MAX_BLOCK_RANGE_PER_QUERY - 1n)
    const part = await withRpcRetry(() => fetchChunk(cursor, end))
    out.push(...part)
    cursor = end + 1n
  }

  return out
}

export default class Logs extends BaseCommand<typeof Logs> {
  static override description =
    'show recent policy logs. Required inputs: existing binding and created policy.'

  static override flags = {
    ...BaseCommand.baseFlags,
    last: Flags.integer({description: 'number of latest logs', default: 20}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Logs)
    const json = flags.json
    const state = this.getState()
    const {tbaAddress} = requireBinding(state, {requirePolicyCreated: true})
    const spinnerEnabled = !json

    const publicClient = getPublicClient()
    const latest = await withSpinner(
      'Loading latest block...',
      () => publicClient.getBlockNumber(),
      {enabled: spinnerEnabled},
    )
    const fromBlock = latest > LOG_LOOKBACK_BLOCKS ? latest - LOG_LOOKBACK_BLOCKS : 0n

    // 四类事件分开抓取，最后再合并排序，便于后面单独扩展某一类事件。
    const {configured, updated, executed, revoked} = await withSpinner(
      'Loading policy logs...',
      async () => {
        const configured = await getLogsChunked(fromBlock, latest, (chunkFrom, chunkTo) =>
          publicClient.getLogs({
            address: tbaAddress,
            event: POLICY_CONFIGURED_EVENT,
            fromBlock: chunkFrom,
            toBlock: chunkTo,
          }),
        )
        const updated = await getLogsChunked(fromBlock, latest, (chunkFrom, chunkTo) =>
          publicClient.getLogs({
            address: tbaAddress,
            event: POLICY_UPDATED_EVENT,
            fromBlock: chunkFrom,
            toBlock: chunkTo,
          }),
        )
        const executed = await getLogsChunked(fromBlock, latest, (chunkFrom, chunkTo) =>
          publicClient.getLogs({
            address: tbaAddress,
            event: POLICY_EXECUTED_EVENT,
            fromBlock: chunkFrom,
            toBlock: chunkTo,
          }),
        )
        const revoked = await getLogsChunked(fromBlock, latest, (chunkFrom, chunkTo) =>
          publicClient.getLogs({
            address: tbaAddress,
            event: POLICY_REVOKED_EVENT,
            fromBlock: chunkFrom,
            toBlock: chunkTo,
          }),
        )
        return {configured, updated, executed, revoked}
      },
      {enabled: spinnerEnabled},
    )

    const entries = [
      ...configured.map((x) => ({event: 'PolicyConfigured', blockNumber: x.blockNumber, txHash: x.transactionHash, args: x.args})),
      ...updated.map((x) => ({event: 'PolicyUpdated', blockNumber: x.blockNumber, txHash: x.transactionHash, args: x.args})),
      ...executed.map((x) => ({event: 'PolicyExecuted', blockNumber: x.blockNumber, txHash: x.transactionHash, args: x.args})),
      ...revoked.map((x) => ({event: 'PolicyRevoked', blockNumber: x.blockNumber, txHash: x.transactionHash, args: x.args})),
    ]
      // 统一按区块排序后截断“最后 N 条”，保证结果稳定。
      .sort((a, b) => {
        if (a.blockNumber === b.blockNumber) return 0
        return a.blockNumber > b.blockNumber ? 1 : -1
      })
      .slice(-Math.max(1, flags.last))

    this.render(
      json,
      {tbaAddress, count: entries.length, entries},
      [
        `tba: ${tbaAddress}`,
        `logs: ${entries.length}`,
        ...entries.map((entry) => `${entry.blockNumber.toString()} ${entry.event} ${entry.txHash}`),
      ].join('\n'),
    )
  }
}
