---
name: aba-resolve-policy
description: Resolve policy details with structured output. Use when you need policy information in a structured format, for display purposes, or when the raw tuple format is not convenient.
user-invocable: true
disable-model-invocation: false
allowed-tools: ["Bash(node ./bin/run.js resolve-policy*)", "Bash(node ./bin/run.js policy*)"]
---

# Resolving ABA Policy

Use `node ./bin/run.js resolve-policy` for structured policy resolution output.

## Prerequisites

- Must be initialized (`node ./bin/run.js init`)
- Must have active binding
- Policy should be created (via Owner API)

## Command Syntax

```bash
node ./bin/run.js resolve-policy [--json]
```

## Options

| Option | Description |
| ------ | ----------- |
| `--json` | Output as JSON |

## Examples

```bash
# Resolve policy
node ./bin/run.js resolve-policy

# JSON output
node ./bin/run.js resolve-policy --json
```

## Output Fields

| Field | Description |
| ----- | ----------- |
| tbaAddress | TBA address |
| policy | Structured policy object |
| targets | Whitelisted contracts |

## Policy Object

| Field | Description |
| ----- | ----------- |
| signer | Agent signer address |
| validUntil | Expiration timestamp |
| maxTotal | Maximum budget in token units |
| spent | Already spent in token units |
| budgetToken | Budget token address |
| active | Whether policy is active |
