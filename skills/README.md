# ABA Agentic Wallet Skills

[Agent Skills](https://agentskills.io) for Agent Bound Account operations. These skills enable AI agents to initialize wallet, bind NFTs, send tokens, and manage policy-controlled wallet operations.

## Available Skills

| Skill | Description |
| ----- | ----------- |
| [aba-init](./aba-init/SKILL.md) | Initialize ABA runtime, deploy AA account, and optionally bind NFT to TBA |
| [aba-send](./aba-send/SKILL.md) | Send USDT to Ethereum addresses or ENS names |
| [aba-status](./aba-status/SKILL.md) | Show runtime, network, and binding status |
| [aba-balance](./aba-balance/SKILL.md) | Query balances in active ABA context |
| [aba-policy](./aba-policy/SKILL.md) | Read current on-chain policy |
| [aba-logs](./aba-logs/SKILL.md) | Read recent execution logs |
| [aba-doctor](./aba-doctor/SKILL.md) | Run runtime diagnostics |
| [aba-resolve-policy](./aba-resolve-policy/SKILL.md) | Resolve structured policy details |

## Installation

Install with [Vercel's Skills CLI](https://skills.sh):

```bash
npx skills add <repo-url>
```

## Usage

Skills are automatically available once installed. The agent will use them when relevant tasks are detected.

**Examples:**

```text
Initialize my ABA wallet with NFT 0x1234...abcd token 443
```

```text
Send 5 USDT to vitalik.eth
```

## Architecture

```
┌─────────────┐                  ┌─────────────┐
│    Owner    │                  │    Agent    │
│  (Backend)  │                  │   (Skills)  │
│             │                  │             │
│ Owner API   │──── authorize ──▶│ aba init   │
│ /create-    │                  │ aba send    │
│  policy     │                  │ aba balance │
│ /approve    │                  │ ...         │
└─────────────┘                  └─────────────┘
       │                                │
       └────────────────┬───────────────┘
                        │
                        ▼
                 ┌─────────────┐
                 │     TBA     │
                 │  (ERC-6551) │
                 │             │
                 │   Policy:   │
                 │   - signer  │
                 │   - budget  │
                 │   - targets │
                 └─────────────┘
```

## Prerequisites

- Node.js >= 20
- Sepolia RPC URL (e.g., Alchemy)
- Pimlico Bundler RPC URL (for AA paymaster)

## License

MIT
