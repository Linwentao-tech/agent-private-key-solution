type SpinnerOptions = {
  enabled?: boolean
  intervalMs?: number
}

function padRight(text: string, min = 8): string {
  const pad = Math.max(0, min - text.length)
  return text + ' '.repeat(pad)
}

export async function withSpinner<T>(
  label: string,
  task: () => Promise<T>,
  options: SpinnerOptions = {},
): Promise<T> {
  const enabled = Boolean(options.enabled) && Boolean(process.stderr.isTTY)
  if (!enabled) return task()

  const frames = ['◐', '◓', '◑', '◒']
  const intervalMs = options.intervalMs ?? 90
  let idx = 0

  const render = (prefix: string): void => {
    process.stderr.write(`\r${prefix} ${label}`)
  }

  render(frames[idx])
  const timer = setInterval(() => {
    idx = (idx + 1) % frames.length
    render(frames[idx])
  }, intervalMs)

  try {
    const out = await task()
    clearInterval(timer)
    process.stderr.write(`\r${padRight('ok')} ${label}\n`)
    return out
  } catch (error) {
    clearInterval(timer)
    process.stderr.write(`\r${padRight('fail')} ${label}\n`)
    throw error
  }
}
