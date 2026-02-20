# ABA CLI

Agent Bound Account CLI - an ERC-6551 smart wallet command-line tool with Agent-authorized execution.

> **Note: Sepolia testnet only for now (chainId: 11155111)**

---

## Table of Contents

- [Architecture Flow](#architecture-flow)
- [Quick Start](#quick-start)
- [Environment Setup](#environment-setup)
- [Agent CLI Commands](#agent-cli-commands)
- [Owner API](#owner-api)
- [Error Codes](#error-codes)
- [Notes](#notes)

---

## Architecture Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              ABA Architecture Flow                              │
└─────────────────────────────────────────────────────────────────────────────────┘

   AGENT                                           OWNER
     │                                              │
     │  ┌────────────────────────────────┐          │
     │  │ 1) aba init                    │          │
     │  │    --nft-ca <NFT>              │          │
     │  │    (--token-id <ID>            │          │
     │  │    or --owner-address <ADDR>)  │          │
     │  │                                │          │
     │  │ Generate keys, deploy AA,      │          │
     │  │ bind NFT, output               │          │
     │  │ agentSignerAddress             │          │
     │  └───────────────┬────────────────┘          │
     │                  │                           │
     │                  ▼                           │
     │  ─────────────────────────────────────────►  │ ┌─────────────────────────────┐
     │            Send info to Owner                │ │ 2) Start Owner API          │
     │                                              │ │    npm run owner:api        │
     │                                              │ └───────────────┬─────────────┘
     │                                              │                 │
     │                                              │                 ▼
     │                                              │  ┌─────────────────────────────┐
     │                                              │  │ 3) POST /create-policy      │
     │                                              │  │    Bind Agent to TBA        │
     │                                              │  │    Set budget and whitelist │
     │                                              │  └───────────────┬─────────────┘
     │                                              │                  │
     │                                              │                  ▼
     │                                              │  ┌─────────────────────────────┐
     │                                              │  │ 4) POST /approve            │
     │                                              │  │    Approve USDT for TBA     │
     │                                              │  └───────────────┬─────────────┘
     │                                              │                  │
     │  ┌────────────────────────────────┐          │                  │
     │  │ 5) aba send / aba call         │◄─────────┼──────────────────┘
     │  │    --to <address>              │          │
     │  │    --data <hex>                │          │
     │  │    --pull-amount <units>       │          │
     │  │                                │          │
     │  │ Execute transfer/contract call │          │
     │  │ AA Paymaster covers gas        │          │
     │  └───────────────┬────────────────┘          │
     │                  │                           │
     │                  ▼                           │
     │  ┌────────────────────────────────┐          │  ┌─────────────────────────────┐
     │  │ 6) aba status/balance/policy   │          │  │ 7) POST /adjust-policy      │
     │  │    Query runtime state         │          │  │    Update budget/signer     │
     │  └────────────────────────────────┘          │  └─────────────────────────────┘
     │                                               │
     ▼                                               ▼
   ┌────────────────────────────────────────────────────────────────────────────┐
   │                              TBA (Agent6551Account)                        │
   │                                                                            │
   │   Policy: { signer, validUntil, maxTotal, spent, budgetToken, active,      │
   │             targets[] }                                                    │
   │                                                                            │
   └────────────────────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### 1. Install and Build

```bash
cd cli
npm install
npm run build
```

### 2. Core Flow

```
1. Agent: aba init --nft-ca <NFT> (--token-id <ID> | --owner-address <ADDR>)
   -> Generate keys, deploy AA, bind NFT, deploy TBA

2. User:  Start Owner API
   npm run owner:api -- --listen localhost:3000 --owner-privatekey <PK>

3. User:  POST /create-policy
   -> Configure policy (signer = agentSignerAddress)

4. User:  POST /approve
   -> Approve token allowance for TBA

5. Agent: aba send <amount> <recipient>
   -> Execute transfer

   Or: aba call --to <address> --data <hex> --pull-amount <units>
   -> Execute contract call

6. Agent: aba status/balance/policy/logs/doctor
   -> Inspect runtime state

7. User:  POST /adjust-policy
   -> Adjust policy (optional)
```

### 3. Command Quick Reference

**AGENT commands:**

| Command | Description |
|------|------|
| `aba init` | Initialize runtime: generate keys, deploy AA, bind NFT |
| `aba send` | Send token: transfer USDT |
| `aba call` | Contract call: execute arbitrary calldata |
| `aba status` | Show runtime status |
| `aba balance` | Show balances |
| `aba policy` | Show policy |
| `aba logs` | Show execution logs |
| `aba doctor` | Diagnose environment |

**OWNER API endpoints:**

| Endpoint | Description |
|------|------|
| `POST /create-policy` | Create policy |
| `POST /adjust-policy` | Adjust policy |
| `POST /approve` | Approve token allowance |

---

## Environment Setup

### `.env` file

Create a `.env` file under `cli/`:

```bash
# Owner private key (used by Owner API to sign transactions)
PRIVATE_KEY=0xyour_private_key

# Sepolia RPC URL
RPC_URL=https://eth-sepolia.g.alchemy.com/v2/your_api_key

# Pimlico Bundler RPC URL (AA 4337)
PIMLICO_RPC_URL=https://api.pimlico.io/v2/11155111/rpc?apikey=your_pimlico_key
```

### How to obtain values

| Config | Source |
|--------|---------|
| `PRIVATE_KEY` | Export from your wallet |
| `RPC_URL` | [Alchemy](https://alchemy.com) or [Infura](https://infura.io) |
| `PIMLICO_RPC_URL` | Register at [Pimlico](https://pimlico.io) and get an API key |

### State files

Stored by default in `./.aba/`:

| File | Content | Git |
|------|------|-----|
| `config.json` | Addresses, chainId, binding, RPC URLs (includes API keys) | Ignored |
| `secrets.json` | Private keys: `agentSignerPrivateKey`, `aaOwnerPrivateKey` | Ignored |

> **Security note:** Both files are already in `.gitignore`. Never commit them. `config.json` contains RPC URLs and API keys, and `secrets.json` contains private keys.

---

## Agent CLI Commands

### `aba init`

Initialize ABA runtime, generate keys, deploy the AA account, and bind NFT to TBA.

```bash
node ./bin/run.js init --rpc-url <RPC_URL> --aa-bundler-rpc-url <BUNDLER_URL> --nft-ca <NFT_ADDRESS> (--token-id <ID> | --owner-address <ADDR>) [options]
```

| Parameter | Required | Description |
|------|------|------|
| `--rpc-url` | Yes | RPC URL |
| `--aa-bundler-rpc-url` | Yes | AA Bundler RPC URL |
| `--nft-ca` | Yes | NFT contract address |
| `--token-id` | Either | Token ID (use this or `--owner-address`) |
| `--owner-address` | Either | Owner address, auto-discovers tokenId (use this or `--token-id`) |
| `--registry` | No | ERC-6551 Registry address |
| `--implementation` | No | Agent6551 implementation address |
| `--aa-account` | No | AA account address (auto-deployed if omitted) |
| `--json` | No | JSON output |

> `--token-id` or `--owner-address` must be provided. If only `--owner-address` is provided, tokenId is discovered automatically.

**Examples:**
```bash
# Specify tokenId directly
node ./bin/run.js init \
  --rpc-url https://eth-sepolia.g.alchemy.com/v2/xxx \
  --aa-bundler-rpc-url https://api.pimlico.io/v2/11155111/rpc?apikey=xxx \
  --nft-ca 0x3d0172a432A1E861Df1434E44F815D32E9bed5cC \
  --token-id 443 \
  --json

# Specify owner address and auto-discover tokenId
node ./bin/run.js init \
  --rpc-url <RPC> \
  --aa-bundler-rpc-url <BUNDLER> \
  --nft-ca 0x3d0172a432A1E861Df1434E44F815D32E9bed5cC \
  --owner-address 0x93c7629916a53DE8a7D46609a0585fD7FeDF3B45 \
  --json
```

---

### `aba send`

Send token (core operation).

```bash
node ./bin/run.js send <amount> <recipient> [options]
```

| Parameter | Required | Description |
|------|------|------|
| `amount` | Yes | Amount: `1`, `0.50`, `'$5.00'` |
| `recipient` | Yes | Address or ENS name |
| `--token` | No | Token address (default: USDT) |
| `--dry-run` | No | Simulate only, do not broadcast |
| `--json` | No | JSON output |

**Examples:**
```bash
# Send 1 USDT
node ./bin/run.js send 1 0x1234...abcd --json

# Simulation only
node ./bin/run.js send 1 0x1234...abcd --dry-run --json
```

---

### `aba call`

Execute any contract call (core operation). Supports automatic `approve` and budget checks.

```bash
node ./bin/run.js call --to <address> --data <hex> [options]
```

| Parameter | Required | Description |
|------|------|------|
| `--to` | Yes | Target contract address |
| `--data` | Yes | Calldata (hex string) |
| `--pull-amount` | No | Token amount pulled from Owner (token units) |
| `--value` | No | ETH value (wei) |
| `--dry-run` | No | Simulate only, do not broadcast |
| `--json` | No | JSON output |

**Automatic approve flow:**

When `--pull-amount` is specified, CLI will automatically:
1. **Budget check:** validate `pullAmount <= maxTotal - spent`
2. **Allowance check:** read TBA allowance to target contract
3. **Auto-adjust:** if allowance does not equal `pullAmount`, adjust it to `pullAmount`
4. **Execute call:** run the target contract call

This keeps approved amount equal to actual spend and avoids over-approval.

**Examples:**
```bash
# Purchase flow (auto approve + pull + call)
node ./bin/run.js call \
  --to 0xShop \
  --data 0xd6febde8... \
  --pull-amount 1000000 \
  --json

# Call without token pull
node ./bin/run.js call --to 0xContract --data 0xabcdef --json
```

---

### `aba status / balance / policy / logs / doctor`

Query commands.

```bash
node ./bin/run.js status [--json]     # network status, binding, policy
node ./bin/run.js balance [--json]    # owner and TBA balances
node ./bin/run.js policy [--json]     # policy details
node ./bin/run.js logs [--last 20]    # execution logs
node ./bin/run.js doctor [--json]     # environment diagnostics
```

---

## Owner API

Owner API is a backend service for NFT owners to authorize Agent operations.

### Start service

```bash
npm run owner:api -- --listen localhost:3000 --owner-privatekey <PK>
```

| Parameter | Description |
|------|------|
| `--listen` | Listen address (default: `localhost:8787`) |
| `--owner-privatekey` | NFT owner private key |

**Successful startup output:**
```
Owner API started.
listen: http://localhost:3000
owner: 0x93c7629916a53DE8a7D46609a0585fD7FeDF3B45
auth: none
```

### API endpoints

#### `GET /health`

Health check.

```bash
curl http://localhost:3000/health
```

#### `GET /owner/capabilities`

List available endpoints.

```bash
curl http://localhost:3000/owner/capabilities
```

#### `POST /owner/create-policy`

Create policy and bind Agent to TBA.

```bash
curl -X POST http://localhost:3000/owner/create-policy \
  -H "Content-Type: application/json" \
  -d '{
    "policySigner": "0xAgentAddress",
    "budgetToken": "0xUSDTAddress",
    "maxTotal": "100",
    "validUntil": 1893456000,
    "targets": ["0xUSDT", "0xShop"],
    "active": true
  }'
```

| Parameter | Required | Description |
|------|------|------|
| `policySigner` | No | Agent address (default: `state.agentSignerAddress`) |
| `budgetToken` | No | Budget token (default: USDT) |
| `maxTotal` | No | Maximum budget (default: `100`) |
| `validUntil` | No | Expiration timestamp (default: year 2030) |
| `targets` | No | Whitelisted contract array |
| `active` | No | Whether policy is active (default: `true`) |
| `dryRun` | No | Simulation mode |

#### `POST /owner/adjust-policy`

Adjust policy parameters or replace Agent signer.

```bash
# Adjust budget
curl -X POST http://localhost:3000/owner/adjust-policy \
  -H "Content-Type: application/json" \
  -d '{"maxTotal": "200"}'

# Replace Agent signer
curl -X POST http://localhost:3000/owner/adjust-policy \
  -H "Content-Type: application/json" \
  -d '{"signer": "0xNewAgentAddress"}'
```

| Parameter | Description |
|------|------|
| `signer` | New Agent address (replace signer) |
| `maxTotal` | New max budget |
| `validUntil` | New expiration timestamp |
| `targets` | New whitelist |
| `active` | Whether policy is active |
| `dryRun` | Simulation mode |

#### `POST /owner/approve`

Approve token allowance for TBA.

```bash
curl -X POST http://localhost:3000/owner/approve \
  -H "Content-Type: application/json" \
  -d '{"amount": "100"}'
```

| Parameter | Description |
|------|------|
| `token` | Token address (default: USDT) |
| `amount` | Approval amount |
| `max` | Approve max amount (default: `true`) |
| `dryRun` | Simulation mode |

---

## Error Codes

| Error Code | Description | Suggested Fix |
|--------|------|---------|
| `NO_BINDING` | NFT is not bound | Run `aba init` |
| `POLICY_CREATE_REQUIRED` | Policy has not been created | Create policy via Owner API |
| `POLICY_INACTIVE` | Policy is inactive | Reactivate policy via Owner API |
| `INVALID_SIGNER` | Agent signer mismatch | Check `agentSigner` private key |
| `TARGET_NOT_ALLOWED` | Target not in whitelist | Update policy targets |
| `BUDGET_EXCEEDED` | Insufficient budget | Reduce `pull-amount` or increase `maxTotal` |
| `BUDGET_OR_ALLOWANCE` | Budget or allowance insufficient | Increase policy budget or allowance |

---

## Notes

- Default network is Sepolia (`chainId=11155111`)
- `aba init --nft-ca --token-id` can directly overwrite existing binding
- `aba send` / `aba call` runs through AA + Paymaster, so Agent does not pay gas
- All commands support `--json` output
- Owner API `/approve` uses safe-approval mode: resets non-zero allowance to `0` first
- `.aba/config.json` and `.aba/secrets.json` are in `.gitignore`; never commit them

---

## Skills

Agent Skills are located in `cli/skills/` and follow the [Agent Skills specification](https://agentskills.io).

See: [skills/README.md](./skills/README.md)
