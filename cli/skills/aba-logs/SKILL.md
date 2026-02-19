---
name: aba-logs
description: Read recent ABA execution logs from the TBA. Use for auditing transaction history, verifying send/call results, or debugging execution issues.
user-invocable: true
disable-model-invocation: false
allowed-tools: ["Bash(node ./bin/run.js logs*)", "Bash(node ./bin/run.js status*)"]
---

# Reading ABA Logs

Use `node ./bin/run.js logs` to inspect recent execution entries from the TBA.

## Prerequisites

- Must be initialized (`node ./bin/run.js init`)
- Must have active binding

## Command Syntax

```bash
node ./bin/run.js logs [--last <count>] [--json]
```

## Options

| Option | Description |
| ------ | ----------- |
| `--last <n>` | Number of entries to show (default: 20) |
| `--json` | Output as JSON |

## Examples

```bash
# Show last 20 logs
node ./bin/run.js logs

# Show last 50 logs
node ./bin/run.js logs --last 50

# JSON output
node ./bin/run.js logs --last 20 --json
```

## Output Fields

Each log entry includes:
- `event` - Event name (PolicyConfigured, PolicyExecuted, PolicyUpdated)
- `blockNumber` - Block number
- `txHash` - Transaction hash
- `args` - Event arguments

## Event Types

| Event | Description |
| ----- | ----------- |
| PolicyConfigured | Policy created |
| PolicyUpdated | Policy modified |
| PolicyExecuted | Transaction executed via policy |
