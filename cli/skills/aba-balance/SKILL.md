---
name: aba-balance
description: Query ETH and token balances for Owner and TBA. Use before and after send/call operations to check wallet state, verify sufficient funds, or debug balance issues.
user-invocable: true
disable-model-invocation: false
allowed-tools: ["Bash(node ./bin/run.js balance*)", "Bash(node ./bin/run.js policy*)"]
---

# Querying ABA Balance

Use `node ./bin/run.js balance` to inspect ETH balances for Owner and TBA.

## Prerequisites

- Must be initialized (`node ./bin/run.js init`)
- Must have active binding

## Command Syntax

```bash
node ./bin/run.js balance [--json]
```

## Options

| Option | Description |
| ------ | ----------- |
| `--json` | Output as JSON |

## Examples

```bash
# Check balance
node ./bin/run.js balance

# JSON output
node ./bin/run.js balance --json
```

## Output Fields

| Field | Description |
| ----- | ----------- |
| asset | Token symbol (ETH) |
| ownerAddress | NFT owner address |
| ownerBalanceWei | Owner ETH balance |
| tbaAddress | TBA address |
| tbaBalanceWei | TBA ETH balance |

## Error Handling

| Error | Solution |
| ----- | -------- |
| NO_BINDING | Run `aba init` first |
