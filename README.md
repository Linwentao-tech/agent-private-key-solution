# AgentBoundAccount

This repository presents a full solution for the agent private-key problem.
`AgentBoundAccount` is the smart-contract component in that solution, focused on enforcing bounded, revocable execution permissions on-chain.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Agent Handoff Flow](#agent-handoff-flow)
4. [AA (ERC-4337) Flow](#aa-erc-4337-flow)
5. [Security Model](#security-model)
6. [Repository Structure](#repository-structure)
7. [Getting Started](#getting-started)
8. [Testing](#testing)
9. [Use Cases](#use-cases)
10. [Current Limitations](#current-limitations)
11. [License](#license)

## Overview

### Problem

In many agent-wallet designs, the agent directly controls a spend-capable private key.
If that key is leaked, over-scoped, or misused by adversarial input, assets are exposed.

### Approach

This project enforces a split-responsibility model:

1. Owner key: configures policy (session creation/revocation).
2. Session key: executes actions within policy constraints.
3. On-chain guards: enforce budget, expiry, allowlist, and replay protection.

## Architecture

The system combines ERC-6551 (NFT-bound wallets), session-based authorization, and ERC-4337 account abstraction:

1. A user owns an NFT.
2. The NFT maps to a Token Bound Account (TBA).
3. The owner creates a session policy on the TBA:
   `validUntil`, `budgetToken`, `maxTotal`, `targets`.
4. The agent activates a signer for that session:
   `activateSession` or `activateSessionBySig`.
5. Execution is sent through the AA bundler flow (`EntryPoint.handleOps`).
6. The TBA enforces policy via `executeWithSession`.
7. The owner can revoke immediately with `revokeSession`.

Design principle: the owner key configures and revokes permissions, while the session key only authorizes requests within those permissions.

## Agent Handoff Flow

High-level handoff flow:

1. Owner sends the agent setup instructions (skill message).
2. Agent prepares runtime and AA bundler RPC configuration (for example `PIMLICO_RPC_URL`).
3. Owner creates a bounded session policy on the TBA.
4. Owner sends session context (`tba`, `sessionId`, intent in natural language) to the agent.
5. Agent signs and submits requests through AA.
6. All execution is enforced by on-chain session constraints.

For operator-level UI details and exact frontend actions, see `frontend/README.md`.

## AA (ERC-4337) Flow

Execution path:

1. UserOperation is submitted to `EntryPoint.handleOps(...)`.
2. Account `callData` routes into TBA calls.
3. Execution reaches `Agent6551Account.executeWithSession(...)`.

Session policy enforcement happens in `Agent6551Account`.

## Security Model

Current protections in `Agent6551Account`:

1. EIP-712 signature verification.
2. Deadline/expiry checks.
3. Per-session nonce replay protection.
4. Target-address allowlist enforcement.
5. Session total-spend cap (`maxTotal`).
6. Owner-triggered emergency revocation.

Auditability is provided via events:
`SessionCreated`, `SessionActivated`, `SessionExecuted`, `SessionRevoked`.

## Repository Structure

- `src/core/Agent6551Account.sol`: core ERC-6551 + session authorization logic.
- `src/interfaces/`: account and executable interfaces.
- `src/mocks/MockCharacterNFT.sol`: demo NFT.
- `src/mocks/MockERC20.sol`: demo ERC-20 budget token.
- `src/mocks/MockShop.sol`: demo target contract.
- `test/Agent6551Account.t.sol`: Foundry unit tests for session constraints.
- `frontend/`: Next.js UI for session creation, activation flow, and log inspection.

## Getting Started

### Prerequisites

- Node.js + npm
- Foundry (`forge`)

### Install Dependencies

```bash
npm install
cd frontend && npm install
```

### Build and Test Contracts

```bash
forge build --sizes
forge test -vvv
forge fmt --check
```

### Run Frontend

Create `frontend/.env.local`:

```bash
NEXT_PUBLIC_REGISTRY_ADDRESS=0x...
NEXT_PUBLIC_IMPLEMENTATION_ADDRESS=0x1bF255cB626B9157A1c94FEec3f120B452b0D9C8
# Optional (NFT discovery):
NEXT_PUBLIC_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/...
NEXT_PUBLIC_ALCHEMY_API_KEY=...
```

Start the app:

```bash
cd frontend
npm run dev
```

## Testing

`test/Agent6551Account.t.sol` validates:

1. successful session execution
2. nonce replay rejection
3. expired session rejection
4. non-allowlisted target rejection
5. budget overflow rejection
6. `activateSessionBySig` success/failure paths
7. owner-only access to session enumeration APIs

## Use Cases

1. on-chain game agents (automated purchases/actions with spend limits)
2. strategy wallets (bounded delegated execution)
3. AI-agent workflows requiring revocable authority

## Current Limitations

1. Allowlisting is at target-address level (not selector-level).
2. This repository is a reference implementation and should be independently reviewed before production use.

## License

MIT (see SPDX headers in source files).
