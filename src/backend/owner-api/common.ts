import {parseAddress, parsePrivateKey} from '../../lib/chain.js'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

export function parseOwnerPrivateKey(input: string | undefined): `0x${string}` {
  if (!input) {
    throw new Error('owner private key not found. pass --owner-privatekey')
  }
  return parsePrivateKey(input)
}

export function isPolicyConfigured(policy: readonly [`0x${string}`, bigint, bigint, bigint, `0x${string}`, boolean]): boolean {
  return policy[0].toLowerCase() !== ZERO_ADDRESS && policy[4].toLowerCase() !== ZERO_ADDRESS && policy[2] > 0n
}

export function parseTargetsInput(raw: unknown, budgetToken: `0x${string}`): `0x${string}`[] {
  if (raw === undefined || raw === null || raw === '') return [budgetToken]
  const items = Array.isArray(raw)
    ? raw.map((x) => String(x).trim()).filter(Boolean)
    : String(raw)
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)

  const parsed = items.map((x) => parseAddress(x, 'target'))
  const map = new Map<string, `0x${string}`>()
  for (const item of parsed) map.set(item.toLowerCase(), item)
  if (!map.has(budgetToken.toLowerCase())) map.set(budgetToken.toLowerCase(), budgetToken)
  if (map.size === 0) throw new Error('targets cannot be empty')
  return [...map.values()]
}

export function parseTargetsWithoutAuto(raw: unknown, fallback: `0x${string}`[]): `0x${string}`[] {
  if (raw === undefined || raw === null || raw === '') return fallback
  const items = Array.isArray(raw)
    ? raw.map((x) => String(x).trim()).filter(Boolean)
    : String(raw)
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
  return items.map((x) => parseAddress(x, 'target'))
}
