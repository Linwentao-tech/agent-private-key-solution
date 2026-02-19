import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {DEFAULT_CHAIN_ID, DEFAULT_IMPLEMENTATION_ADDRESS, DEFAULT_NETWORK, DEFAULT_REGISTRY_ADDRESS} from './constants.js'
import type {AbaState, AbaConfig, AbaSecrets} from './types.js'

function resolveConfigPath(): string {
  return join(process.cwd(), '.aba', 'config.json')
}

function resolveSecretsPath(): string {
  return join(process.cwd(), '.aba', 'secrets.json')
}

function ensureDir(path: string): void {
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, {recursive: true})
}

export function defaultConfig(): AbaConfig {
  return {
    version: 1,
    network: DEFAULT_NETWORK,
    chainId: DEFAULT_CHAIN_ID,
    registryAddress: DEFAULT_REGISTRY_ADDRESS,
    implementationAddress: DEFAULT_IMPLEMENTATION_ADDRESS,
  }
}

export function defaultSecrets(): AbaSecrets {
  return {version: 1}
}

export function loadState(): AbaState {
  const configPath = resolveConfigPath()
  const secretsPath = resolveSecretsPath()

  let config = defaultConfig()
  let secrets = defaultSecrets()

  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, 'utf8')
    const parsed = JSON.parse(raw) as AbaConfig
    config = {...defaultConfig(), ...parsed}
  }

  if (existsSync(secretsPath)) {
    const raw = readFileSync(secretsPath, 'utf8')
    const parsed = JSON.parse(raw) as AbaSecrets
    secrets = {...defaultSecrets(), ...parsed}
  }

  return {...config, ...secrets}
}

export function saveState(next: AbaState): void {
  const configPath = resolveConfigPath()
  const secretsPath = resolveSecretsPath()

  ensureDir(configPath)

  const secrets: AbaSecrets = {
    version: 1,
    agentSignerPrivateKey: next.agentSignerPrivateKey,
    aaOwnerPrivateKey: next.aaOwnerPrivateKey,
  }

  const config: AbaConfig = {
    version: next.version,
    network: next.network,
    chainId: next.chainId,
    rpcUrl: next.rpcUrl,
    registryAddress: next.registryAddress,
    implementationAddress: next.implementationAddress,
    agentSignerAddress: next.agentSignerAddress,
    aaAccountAddress: next.aaAccountAddress,
    aaBundlerRpcUrl: next.aaBundlerRpcUrl,
    aaSponsorshipPolicyId: next.aaSponsorshipPolicyId,
    aaEntrypointAddress: next.aaEntrypointAddress,
    binding: next.binding,
  }

  const stringify = (obj: unknown) =>
    JSON.stringify(obj, (_key, v) => (typeof v === 'bigint' ? v.toString() : v), 2)

  writeFileSync(configPath, stringify(config) + '\n', 'utf8')
  writeFileSync(secretsPath, stringify(secrets) + '\n', 'utf8')
}

export function statePath(): string {
  return resolveConfigPath()
}

export function secretsPath(): string {
  return resolveSecretsPath()
}
