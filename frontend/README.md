# AgentBoundAccount Frontend

This Next.js app is the demo operator UI for the AgentBoundAccount flow.
It helps the NFT owner configure session permissions for an ERC-6551 account, while letting agent-side execution stay bounded by on-chain policy.

## What This UI Does

1. Provide a ready-to-use skill message for user's agent.
2. Connect wallet on Sepolia.
3. Load owner NFTs and pick one token.
4. Resolve (and deploy if needed) the NFT's Token Bound Account (TBA).
5. Set USDT allowance from owner wallet to the TBA.
6. Create session policy (`validUntil`, `maxTotal`, `targets`).
7. Generate session prompt context for agent handoff.
8. List/revoke sessions.
9. Inspect session logs with decoded function names (including AA paths).

## Prerequisites

- Node.js 20+
- npm
- Deployed contracts on Sepolia:
  - ERC-6551 Registry: `0xf480116f21052c3385fa200ae6f86f65be1ddd96`
  - `Agent6551Account` implementation: `0x1bF255cB626B9157A1c94FEec3f120B452b0D9C8`

If you are running your own deployment, replace these with your own contract addresses.

## Environment Variables

Create `frontend/.env.local`:

```bash
NEXT_PUBLIC_REGISTRY_ADDRESS=0x...
NEXT_PUBLIC_IMPLEMENTATION_ADDRESS=0x1bF255cB626B9157A1c94FEec3f120B452b0D9C8
NEXT_PUBLIC_RPC_URL=...
NEXT_PUBLIC_ALCHEMY_API_KEY=...
```

Notes:

1. `NEXT_PUBLIC_REGISTRY_ADDRESS` and `NEXT_PUBLIC_IMPLEMENTATION_ADDRESS` are required for TBA resolution/deployment.
2. NFT loading relies on Alchemy NFT API (`NEXT_PUBLIC_ALCHEMY_API_KEY` or an Alchemy `NEXT_PUBLIC_RPC_URL`).

## Run Locally

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`.

## End-to-End Flow (UI)

### Step 1: Share Skill Message with Agent

Use the **Send Your AI Agent This Skill** block first.
Owner can directly copy the provided skill message and send it to the agent.

### Step 2: Connect Wallet

Connect an EOA wallet and switch network to Sepolia.

### Step 3: Select NFT

Use the NFT panel to load collections/tokens and pick one NFT.
The app computes the corresponding TBA from ERC-6551 registry + implementation.

### Step 4: Deploy TBA (if needed)

If the computed TBA has no code, click deploy.
Once deployed, the session panel becomes actionable.

### Step 5: Approve Budget to TBA

Set the owner-to-TBA USDT allowance ("agent wallet amount").
This allowance is the source budget for session execution.

### Step 6: Create Session

In **Create Session**:

1. Set label and session validity (minutes).
2. Set max total spend (USDT).
3. Set target allowlist (one or multiple addresses).
4. Submit `createSession`.

After creation, the UI shows session details and a prompt payload that can be passed to your agent runtime.

### Step 7: Share Session Prompt with Agent

Use the session prompt block as a generated example.
It is a reference template, and the user can edit the prompt intent before sending it to the agent.

The example prompt includes:

1. session context (for example `tba=...`, `sessionId=...`)
2. an intent text that the user can modify based on the actual task

### Step 8: Monitor / Revoke

In **Your Sessions**, review active sessions and revoke when needed.

### Step 9: Inspect Session Log

In **Session Log**:

1. Choose a session ID.
2. Load recent logs.
3. Review:
   - block number
   - event type
   - decoded function name (including target function when available)
   - details (for example, spend amount)
   - tx hash


## On-Chain Call Flow (Reference)

Typical call sequence triggered from this UI:

1. `registry.account(...)` to resolve TBA
2. `registry.createAccount(...)` if TBA not deployed
3. `ERC20.approve(tba, amount)` to set allowance
4. `Agent6551Account.createSession(...)`
5. `Agent6551Account.getActiveSessionIds(...)` and `sessions(...)` for listing
6. `Agent6551Account.revokeSession(...)` when revoking
7. Optional AA path:
   `EntryPoint.handleOps(...) -> account.execute(...) -> Agent6551Account.executeWithSession(...)`
8. Event reads:
   `SessionCreated`, `SessionActivated`, `SessionExecuted`, `SessionRevoked`

## Important Behavior

1. Only the NFT owner can create/revoke sessions.
2. Session listing/logs are refreshed and polled in the UI.
3. Function names in logs are decoded from tx input; for inner calls, the app attempts best-effort selector/signature resolution.
4. For AA transactions, the UI decodes `handleOps` wrappers and tries to recover inner TBA/target function calls.

## Troubleshooting

### "Missing NEXT*PUBLIC*\* env"

Set `NEXT_PUBLIC_REGISTRY_ADDRESS` and `NEXT_PUBLIC_IMPLEMENTATION_ADDRESS` in `frontend/.env.local`.

### NFT list cannot load

Configure `NEXT_PUBLIC_ALCHEMY_API_KEY` (or use Alchemy `NEXT_PUBLIC_RPC_URL`).

### Cannot create session

Check:

1. wallet is connected to Sepolia
2. selected wallet is the NFT owner
3. TBA is deployed
4. allowance is set and max total does not exceed allowance

### Logs show selector instead of full function signature

This is expected when signature lookup cannot be resolved; the UI falls back to 4-byte selector.

### Agent cannot run AA flow

Make sure your agent environment has a bundler RPC configured (for example `PIMLICO_RPC_URL`) and that the agent account has the required AA setup.
