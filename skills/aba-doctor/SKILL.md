---
name: aba-doctor
description: Run ABA runtime diagnostics to verify environment readiness. Use when commands fail unexpectedly, after setup issues, or to verify all components are properly configured.
user-invocable: true
disable-model-invocation: false
allowed-tools: ["Bash(node ./bin/run.js doctor*)", "Bash(node ./bin/run.js status*)", "Bash(node ./bin/run.js init*)"]
---

# Running ABA Doctor

Use `node ./bin/run.js doctor` to diagnose runtime and dependency readiness.

## Prerequisites

None. This is a diagnostic command.

## Command Syntax

```bash
node ./bin/run.js doctor [--json]
```

## Options

| Option | Description |
| ------ | ----------- |
| `--json` | Output as JSON |

## Examples

```bash
# Run diagnostics
node ./bin/run.js doctor

# JSON output
node ./bin/run.js doctor --json
```

## Checks Performed

| Check | Description |
| ----- | ----------- |
| state-file | Config file exists and is valid |
| rpc | RPC connection works |
| registry-code | ERC-6551 registry is deployed |
| implementation-code | Agent6551 implementation is deployed |
| binding-tba-code | TBA is deployed (if bound) |

## Error Handling

| Check Failing | Solution |
| ------------- | -------- |
| state-file | Run `aba init` |
| rpc | Check RPC URL in config |
| registry-code | Verify registry address |
| implementation-code | Verify implementation address |
| binding-tba-code | Run `aba init` or wait for TBA deployment |
