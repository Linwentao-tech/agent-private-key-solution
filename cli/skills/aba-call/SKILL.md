---
name: aba-call
description: Execute arbitrary contract calls via AA paymaster. Use when the user wants to interact with smart contracts, swap tokens, buy items, or perform any contract function call under policy controls. Automatically handles token approval when pull-amount is specified.
user-invocable: true
disable-model-invocation: false
allowed-tools: ["Bash(node ./bin/run.js call*)", "Bash(node ./bin/run.js status*)", "Bash(node ./bin/run.js policy*)", "Bash(node ./bin/run.js balance*)", "Bash(node ./bin/run.js logs*)"]
---

# Executing Contract Calls with ABA

Use `node ./bin/run.js call` to execute arbitrary smart contract calls from the TBA via AA paymaster.

## Prerequisites

- Must be initialized (`node ./bin/run.js init`)
- Must have active policy created (via Owner API)
- Target contract must be in policy whitelist
- If using `--pull-amount`, budgetToken must also be in policy whitelist

## Command Syntax

```bash
node ./bin/run.js call --to <address> --data <hex> [--pull-amount <units>] [--json]
```

## Arguments

| Argument | Description |
| -------- | ----------- |
| `--to` | Target contract address (required) |
| `--data` | Calldata hex string (required) |

## Options

| Option | Description |
| ------ | ----------- |
| `--pull-amount` | Amount of budgetToken to pull from owner (in token units) |
| `--value` | ETH value in wei (default: 0) |
| `--dry-run` | Simulate without broadcasting |
| `--json` | Output as JSON |

## Auto-Approve Behavior

When `--pull-amount` is specified, the command automatically:
1. **Budget Check**: Validates `pullAmount <= maxTotal - spent`
2. **Allowance Check**: Reads current TBA allowance to target contract
3. **Auto-Approve**: Adjusts allowance to exactly match `pullAmount`
4. **Execute Call**: Runs the target contract call

This ensures approve amount always equals actual spending, preventing over-authorization.

## Examples

```bash
# Buy item for 1 USDT (auto-approve + pull from owner)
node ./bin/run.js call \
  --to 0xShop \
  --data 0xd6febde8... \
  --pull-amount 1000000 \
  --json

# Call without token transfer
node ./bin/run.js call \
  --to 0xContract \
  --data 0xabcdef \
  --json

# Dry run (simulation)
node ./bin/run.js call --to 0xShop --data 0x... --pull-amount 1000000 --dry-run --json
```

## Encoding Calldata

Use tools to encode calldata:
- `cast calldata "buy(uint256,uint256)" 1 1000000` (foundry)
- `ethers.Interface.encodeFunctionData()` (ethers.js)

## Policy Restrictions

Calls are subject to policy controls:
- **Target whitelist**: Only addresses in policy targets can be called
- **Budget limit**: pullAmount cannot exceed `maxTotal - spent`
- **Signer verification**: Agent signer must match policy signer

## Error Handling

| Error | Solution |
| ----- | -------- |
| NO_BINDING | Run `aba init` first |
| POLICY_INACTIVE | Create/activate policy via Owner API |
| INVALID_SIGNER | Check agent signer matches policy |
| TARGET_NOT_ALLOWED | Add target to policy whitelist |
| BUDGET_EXCEEDED | Reduce pull-amount or increase maxTotal |
| CALL_REVERTED | Check calldata and contract state |
