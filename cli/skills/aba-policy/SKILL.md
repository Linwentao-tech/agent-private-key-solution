---
name: aba-policy
description: Read current on-chain policy for active binding. Use to check agent authorization, budget limits, spending status, or verify policy configuration before executing send/call operations.
user-invocable: true
disable-model-invocation: false
allowed-tools: ["Bash(node ./bin/run.js policy*)", "Bash(node ./bin/run.js resolve-policy*)"]
---

# Reading ABA Policy

Use `node ./bin/run.js policy` for read-only policy inspection.

## Prerequisites

- Must be initialized (`node ./bin/run.js init`)
- Must have active binding
- Policy should be created (via Owner API) for meaningful output

## Command Syntax

```bash
node ./bin/run.js policy [--json]
```

## Options

| Option | Description |
| ------ | ----------- |
| `--json` | Output as JSON |

## Examples

```bash
# Check policy
node ./bin/run.js policy

# JSON output
node ./bin/run.js policy --json
```

## Output Fields

| Field | Description |
| ----- | ----------- |
| tbaAddress | TBA address |
| policy | Policy tuple [signer, validUntil, maxTotal, spent, budgetToken, active] |
| targets | Whitelisted contract addresses |

## Policy Tuple

| Index | Field | Description |
| ----- | ----- | ----------- |
| 0 | signer | Agent signer address |
| 1 | validUntil | Expiration timestamp |
| 2 | maxTotal | Maximum budget in token units |
| 3 | spent | Already spent in token units |
| 4 | budgetToken | Budget token address |
| 5 | active | Whether policy is active |

## Error Handling

| Error | Solution |
| ----- | -------- |
| NO_BINDING | Run `aba init` first |
