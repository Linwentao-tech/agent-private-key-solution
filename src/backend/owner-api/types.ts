import type {AbaState} from '../../lib/types.js'

export type Json = Record<string, unknown>

export type CreatePolicyBody = {
  policySigner?: string
  budgetToken?: string
  maxTotal?: string
  validUntil?: string | number
  targets?: string[] | string
  active?: boolean
  dryRun?: boolean
}

export type AdjustPolicyBody = {
  signer?: string
  maxTotal?: string
  validUntil?: string | number
  targets?: string[] | string
  active?: boolean
  dryRun?: boolean
}

export type ApproveBody = {
  token?: string
  spender?: string
  amount?: string
  amountUnits?: string | number
  max?: boolean
  resetFirst?: boolean
  dryRun?: boolean
}

export type OwnerApiRuntime = {
  ownerPk: `0x${string}`
  ownerAddress: `0x${string}`
  authToken: string | null
  getState: () => AbaState
  setState: (next: AbaState) => void
}

