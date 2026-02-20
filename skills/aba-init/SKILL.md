---
name: aba-init
description: Initialize ABA runtime and bind NFT to TBA. Use when setting up for the first time, creating a new agent wallet, or binding a different NFT. Covers phrases like "initialize wallet", "setup agent", "bind NFT", or "create new binding".
user-invocable: true
disable-model-invocation: false
allowed-tools: ["Bash(node ./bin/run.js init*)", "Bash(node ./bin/run.js doctor*)", "Bash(node ./bin/run.js status*)"]
---

# Initializing ABA Runtime

Use `node ./bin/run.js init` to bootstrap local ABA runtime state and bind an NFT to its TBA (Token Bound Account).

## Prerequisites

- RPC URL for Sepolia network
- AA bundler/paymaster RPC URL (e.g., Pimlico)
- NFT contract address
- Either token ID or owner address for token discovery

## Command Syntax

```bash
node ./bin/run.js init --rpc-url <RPC_URL> --aa-bundler-rpc-url <BUNDLER_URL> --nft-ca <NFT_ADDRESS> (--token-id <ID> | --owner-address <ADDR>)
```

## Arguments

| Argument | Description |
| -------- | ----------- |
| `--rpc-url` | RPC URL for Sepolia network (required) |
| `--aa-bundler-rpc-url` | AA bundler/paymaster RPC URL (required) |
| `--nft-ca` | NFT contract address (required) |
| `--token-id` | Token ID to bind (mutually exclusive with --owner-address) |
| `--owner-address` | Owner address for auto-discovering tokenId (mutually exclusive with --token-id) |

## Options

| Option | Description |
| ------ | ----------- |
| `--registry` | ERC-6551 registry address |
| `--implementation` | Agent6551 implementation address |
| `--aa-account` | AA smart account address |
| `--no-auto-deploy-aa` | Skip auto AA deployment |
| `--json` | Output as JSON |

## Examples

```bash
# With explicit tokenId
node ./bin/run.js init \
  --rpc-url https://eth-sepolia.g.alchemy.com/v2/xxx \
  --aa-bundler-rpc-url https://api.pimlico.io/v2/11155111/rpc?apikey=xxx \
  --nft-ca 0x3d0172a432A1E861Df1434E44F815D32E9bed5cC \
  --token-id 443 \
  --json

# With owner address (auto-discover tokenId)
node ./bin/run.js init \
  --rpc-url <RPC> \
  --aa-bundler-rpc-url <BUNDLER> \
  --nft-ca 0x3d0172a432A1E861Df1434E44F815D32E9bed5cC \
  --owner-address 0x93c7629916a53DE8a7D46609a0585fD7FeDF3B45 \
  --json
```

## Token ID Resolution

When using `--owner-address`, the command:
1. Discovers all NFTs owned by the address
2. If single NFT found: auto-selects it
3. If multiple NFTs found: prompts for selection (interactive mode)

## Output

- `agentSignerAddress` - Agent's public key (share with Owner for Policy creation)
- `aaAccountAddress` - AA smart account address
- `tbaAddress` - TBA address
- `tbaCreated` - Whether TBA was newly deployed

## Generated Files

| File | Content | Git |
| ---- | ------- | --- |
| `.aba/config.json` | Config: addresses, chainId, binding, RPC URLs (contains API keys) | Ignored |
| `.aba/secrets.json` | Secrets: agentSignerPrivateKey, aaOwnerPrivateKey | Ignored |

**Security Note:** Both files are automatically added to `.gitignore`. Never commit them.

## Error Handling

| Error | Solution |
| ----- | -------- |
| Missing required flag | Provide --nft-ca and either --token-id or --owner-address |
| Token discovery failed | Use --token-id directly if NFT doesn't support enumeration |
| AA deployment failed | Check bundler RPC URL and sponsorship policy |
