---
name: aba-send
description: Send USDT to an Ethereum address or ENS name. Use when the user wants to send money, pay someone, transfer funds, tip, donate, or send USDT to a wallet address. Covers phrases like "send $5 to", "pay 0x...", or "transfer to vitalik.eth".
user-invocable: true
disable-model-invocation: false
allowed-tools: ["Bash(node ./bin/run.js send*)", "Bash(node ./bin/run.js status*)", "Bash(node ./bin/run.js policy*)", "Bash(node ./bin/run.js balance*)", "Bash(node ./bin/run.js logs*)"]
---

# Sending USDT with ABA

Use `node ./bin/run.js send` to transfer USDT from the TBA to any Ethereum address or ENS name.

## Prerequisites

- Must be initialized (`node ./bin/run.js init`)
- Must have active policy created (via Owner API)
- Owner must have approved USDT to TBA
- Policy must have sufficient budget

## Command Syntax

```bash
node ./bin/run.js send <amount> <recipient> [--json]
```

## Arguments

| Argument | Description |
| -------- | ----------- |
| `amount` | Amount to send: '1.00', '$5.00', or atomic units (1000000 = 1 USDT). Always single-quote amounts with `$` to prevent bash variable expansion. |
| `recipient` | Ethereum address (0x...) or ENS name (vitalik.eth) |

## Options

| Option | Description |
| ------ | ----------- |
| `--token` | Token address (default: USDT) |
| `--dry-run` | Simulate without broadcasting |
| `--json` | Output as JSON |

## Examples

```bash
# Send 1 USDT to an address
node ./bin/run.js send 1 0x1234...abcd

# Send $5.00 to an ENS name (note single quotes)
node ./bin/run.js send '$5.00' vitalik.eth

# Send 0.5 USDT with JSON output
node ./bin/run.js send 0.5 0x1234...abcd --json

# Dry run (simulation)
node ./bin/run.js send 1 0x1234...abcd --dry-run --json
```

## ENS Resolution

ENS names are automatically resolved to addresses via Ethereum mainnet. The command will:
1. Detect ENS names (any string containing a dot that isn't a hex address)
2. Resolve the name to an address
3. Display both the ENS name and resolved address in the output

## Policy Controls

Transfers are subject to policy restrictions:
- **Budget limit**: Total spent cannot exceed `maxTotal`
- **Signer verification**: Agent signer must match policy signer
- **Target whitelist**: USDT must be in policy targets

## Error Handling

| Error | Solution |
| ----- | -------- |
| NO_BINDING | Run `aba init` first |
| POLICY_INACTIVE | Create/activate policy via Owner API |
| INVALID_SIGNER | Check agent signer matches policy |
| BUDGET_EXCEEDED | Reduce amount or increase policy budget |
| TARGET_NOT_ALLOWED | USDT not in policy whitelist |
