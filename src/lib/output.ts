export function printResult<T>(opts: {json: boolean; data: T; text: string}): void {
  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        opts.data,
        (_k, v) => {
          if (typeof v === 'bigint') return v.toString()
          return v
        },
        2,
      ) + '\n',
    )
    return
  }

  process.stdout.write(`${opts.text}\n`)
}

export function fail(message: string): never {
  throw new Error(message)
}
