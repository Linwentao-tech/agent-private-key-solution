---
name: aba-status
description: Show ABA runtime status including network, binding, and policy state. Use before any operation to verify state, when debugging issues, or to check if initialization and policy creation are complete.
user-invocable: true
disable-model-invocation: false
allowed-tools: ["Bash(node ./bin/run.js status*)"]
---

# Checking ABA Status

Use `node ./bin/run.js status` for a quick, read-only snapshot of current ABA state.

## Prerequisites

None. This is a read-only command.

## Command Syntax

```bash
node ./bin/run.js status [--json]
```

## Options

| Option | Description |
| ------ | ----------- |
| `--json` | Output as JSON |

## Examples

```bash
# Basic status
node ./bin/run.js status

# JSON output
node ./bin/run.js status --json
```

## Output Fields

| Field | Description |
| ----- | ----------- |
| network | Network name (sepolia) |
| chainId | Chain ID |
| rpcUrl | RPC URL |
| binding | Current NFT binding (or null) |
| policyCreated | Whether policy is configured |
| tbaDeployed | Whether TBA is deployed on-chain |
| policy | Policy tuple (if exists) |
