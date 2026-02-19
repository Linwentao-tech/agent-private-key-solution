import type {Address} from 'viem'
import type {AbaState} from './types.js'

type RequireBindingOptions = {
  requirePolicyCreated?: boolean
}

export function requireBinding(
  state: AbaState,
  options: RequireBindingOptions = {},
): {nftContract: Address; tokenId: bigint; tbaAddress: Address} {
  if (!state.binding) {
    throw new Error('no binding found. Run `aba bind` first')
  }
  if (options.requirePolicyCreated && !state.binding.policyCreatedAt) {
    throw new Error('policy not created yet. Run `aba policy create` first')
  }

  return {
    nftContract: state.binding.nftContract,
    tokenId: BigInt(state.binding.tokenId),
    tbaAddress: state.binding.tbaAddress,
  }
}
