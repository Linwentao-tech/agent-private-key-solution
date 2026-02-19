import {input, confirm} from '@inquirer/prompts'
import {privateKeyToAccount} from 'viem/accounts'
import type {Address} from 'viem'
import {parseAddress, parsePrivateKey} from './chain.js'

export async function resolveOwnerPrivateKey(flagsPk?: string, interactive = true): Promise<`0x${string}`> {
  if (flagsPk) return parsePrivateKey(flagsPk)

  if (!interactive) {
    throw new Error('owner private key not found. Pass --privatekey')
  }

  const entered = await input({
    message: 'Owner private key (0x...)',
    validate: (v) => (/^0x[a-fA-F0-9]{64}$/.test(v) ? true : 'must be 0x + 64 hex chars'),
  })

  const ok = await confirm({message: 'Use this key in local test mode?', default: true})
  if (!ok) throw new Error('cancelled')

  return parsePrivateKey(entered)
}

export function addressFromPrivateKey(pk: `0x${string}`): Address {
  return privateKeyToAccount(pk).address
}

export async function resolveAddressInput(raw: string | undefined, label: string, interactive: boolean): Promise<Address> {
  if (raw) return parseAddress(raw, label)
  if (!interactive) throw new Error(`${label} is required`)

  const entered = await input({
    message: `${label} (0x...)`,
    validate: (v) => (/^0x[a-fA-F0-9]{40}$/.test(v) ? true : 'must be a valid 0x address'),
  })
  return parseAddress(entered, label)
}
