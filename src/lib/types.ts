export type NetworkName = 'sepolia'

export type AbaBinding = {
  nftContract: `0x${string}`
  tokenId: bigint
  tbaAddress: `0x${string}`
  policyCreatedAt?: string
  updatedAt: string
}

export type AbaConfig = {
  version: 1
  network: NetworkName
  chainId: number
  rpcUrl?: string
  registryAddress: `0x${string}`
  implementationAddress: `0x${string}`
  agentSignerAddress?: `0x${string}`
  aaAccountAddress?: `0x${string}`
  aaBundlerRpcUrl?: string
  aaSponsorshipPolicyId?: string
  aaEntrypointAddress?: `0x${string}`
  binding?: AbaBinding
}

export type AbaSecrets = {
  version: 1
  agentSignerPrivateKey?: `0x${string}`
  aaOwnerPrivateKey?: `0x${string}`
}

export type AbaState = AbaConfig & AbaSecrets
