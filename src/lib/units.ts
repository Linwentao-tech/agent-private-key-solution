export function parseDecimalToUnits(input: string, decimals: number): bigint {
  const value = input.trim()
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new Error(`invalid decimal amount: ${input}`)
  }

  const [whole, fracRaw = ''] = value.split('.')
  const frac = (fracRaw + '0'.repeat(decimals)).slice(0, decimals)
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac || '0')
}

export function formatUnits(value: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals)
  const whole = value / base
  const frac = value % base
  if (frac === 0n) return whole.toString()
  const fracString = frac.toString().padStart(decimals, '0').replace(/0+$/, '')
  return `${whole.toString()}.${fracString}`
}
