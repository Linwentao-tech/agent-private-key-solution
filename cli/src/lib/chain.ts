import {privateKeyToAccount} from 'viem/accounts'
import {createPublicClient, createWalletClient, http, type Address, type PublicClient, type WalletClient} from 'viem'
import {sepolia} from 'viem/chains'
import {loadState} from './state.js'

export function resolveRpcUrl(): string {
  const state = loadState()
  return state.rpcUrl || 'https://ethereum-sepolia-rpc.publicnode.com'
}

export function getPublicClient(): PublicClient {
  return createPublicClient({
    chain: sepolia,
    transport: http(resolveRpcUrl()),
  })
}

export function getWalletFromPrivateKey(pk: `0x${string}`): {account: ReturnType<typeof privateKeyToAccount>; wallet: WalletClient} {
  const account = privateKeyToAccount(pk)
  const wallet = createWalletClient({
    account,
    chain: sepolia,
    transport: http(resolveRpcUrl()),
  })

  return {account, wallet}
}

export function parseAddress(value: string, label: string): Address {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`${label} must be a valid 0x address`)
  }
  return value as Address
}

export function parsePrivateKey(value: string): `0x${string}` {
  if (!/^0x[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error('private key must be 0x + 64 hex chars')
  }

  return value as `0x${string}`
}
