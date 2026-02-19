---
name: aa-session-worker
description: Execute on-chain actions inside Agent6551Account sessions on Sepolia using ERC-4337 (AA pays gas). Prompts are natural language only; the agent auto-resolves active session context.
metadata:
  short-description: AA session executor
---

# AA Session Worker (Sepolia) — Single-Session Runtime, Natural-Language Prompts

## Goal

On Sepolia, the agent must execute on-chain intents with these properties:

1. User prompts are natural language only (no `tba`, no `sessionId` in prompt text).
2. Session context is resolved automatically on-chain by the runtime.
3. Execution uses `Agent6551Account.executeWithSession(...)` (directly or through ERC-4337).
4. Session safety checks remain enforced on-chain (expiry/revoke/nonce/allowlist/budget/signature).

## Runtime Mode (Single-Session First)

This skill runs in single-session mode to keep UX deterministic:

1. Keep exactly one usable active session for this runtime/signer.
2. If multiple active sessions are found, treat it as policy violation and stop with a clear error.
3. Operator should revoke old sessions and keep one active session.

This avoids requiring users to pass routing context in prompts.

## Prompt Requirements

Prompt should contain only natural-language intent, for example:

- "What's my balance?"
- "Buy item1 for 20 USDT."
- "Spend up to 5 USDT to execute this action."

Do not require `tba=...` or `sessionId=...` in prompt text.

## Key Management (Agent Must Generate & Persist)

The agent must generate and securely persist two distinct private keys (do not reuse user wallet keys):

- Session key: used only for EIP-712 signatures (`SessionActivation` and `SessionCall`).
- AA owner key: used to sign ERC-4337 UserOperations.

Requirements:

- Keys must be stable across runs (persisted in secure storage or env).
- Never print or exfiltrate private keys; only surface the derived public addresses when needed.

## Environment Variables

- `SEPOLIA_RPC_URL` or `RPC_URL`
- `PIMLICO_RPC_URL` (or `AA_BUNDLER_RPC_URL`)
- Optional `PIMLICO_SPONSORSHIP_POLICY_ID` (if present, try sponsored mode)
- `ENTRYPOINT_VERSION=0.7`
- `AA_OWNER_PRIVATE_KEY`
- `SESSION_SIGNER_PRIVATE_KEY`
- `USDT_ADDRESS=0x7169D38820dfd117C3FA1f22a697dBA58d90BA06` (Sepolia, 6 decimals)

## Session Auto-Resolution (No Prompt Context)

Before each execution:

1. Derive `sessionSigner` from `SESSION_SIGNER_PRIVATE_KEY`.
2. Query `SessionActivated(sessionId, signer)` logs where `signer == sessionSigner`.
3. For each log:
   - `tba = log.address`
   - `sessionId = log.args.sessionId`
4. Read `sessions(sessionId)` on each `tba` and keep only sessions that are:
   - `signer == sessionSigner`
   - `revoked == false`
   - `validUntil >= now`
   - `budgetToken == USDT_ADDRESS` (if this runtime is USDT-scoped)
5. Apply single-session invariant:
   - If exactly one candidate remains: use it.
   - If none: return `NoUsableSession`.
   - If more than one: return `AmbiguousSession` and stop.

Do not ask users to provide `tba` or `sessionId` in prompt.

## Execution Flow

1. Resolve active session via the procedure above.
2. Convert natural-language intent into one or more on-chain calls.
3. Auto-handle ERC-20 allowance when needed.
4. Sign `SessionCall` and invoke `executeWithSession`.
5. Send through ERC-4337 bundler/paymaster when available.

Note: in this auto-resolution mode, sessions are discovered from `SessionActivated` logs, so they are expected to be already activated.

## Deadline Rule

For both `SessionActivation` and `SessionCall` signatures:

- `deadline <= sessions(sessionId).validUntil`
- Contract reverts if `block.timestamp > deadline`

Recommended default: `deadline = sessions(sessionId).validUntil` (or slightly earlier).

## Typed Data Reference (Must Match Contract)

### 1) SessionActivation (`activateSessionBySig`)

Use when `sessions(sessionId).signer == 0x0`.

Rules:

- `verifyingContract` must be the TBA (`Agent6551Account` instance).
- `chainId` must be `11155111` (Sepolia).
- `message.signer` must equal derived session signer address.

```bash
activateSessionBySig(sessionId, signer, deadline, signature)
```

```json
{
  "domain": {
    "name": "Agent6551Account",
    "version": "1",
    "chainId": 11155111,
    "verifyingContract": "<TBA_ADDRESS>"
  },
  "types": {
    "SessionActivation": [
      { "name": "sessionId", "type": "bytes32" },
      { "name": "signer", "type": "address" },
      { "name": "deadline", "type": "uint256" }
    ]
  },
  "message": {
    "sessionId": "<SESSION_ID_BYTES32>",
    "signer": "<SESSION_SIGNER_ADDRESS>",
    "deadline": "<DEADLINE_UNIX_SEC>"
  }
}
```

### 2) SessionCall (`executeWithSession`)

Rules:

- `verifyingContract` must be the same resolved TBA.
- Signature covers `dataHash = keccak256(data)`, not raw bytes.
- `nonce` must be unique per `sessionId`.
- `pullAmount` controls pre-execution owner->TBA token pull.

```json
{
  "domain": {
    "name": "Agent6551Account",
    "version": "1",
    "chainId": 11155111,
    "verifyingContract": "<TBA_ADDRESS>"
  },
  "types": {
    "SessionCall": [
      { "name": "sessionId", "type": "bytes32" },
      { "name": "to", "type": "address" },
      { "name": "value", "type": "uint256" },
      { "name": "dataHash", "type": "bytes32" },
      { "name": "nonce", "type": "uint256" },
      { "name": "deadline", "type": "uint256" },
      { "name": "pullAmount", "type": "uint256" }
    ]
  }
}
```

Call:

```bash
executeWithSession(req, signature)
```

## Allowance (General Auto-Handling)

If a step requires an external spender to use TBA funds:

1. Read `allowance(tba, spender)`.
2. If insufficient, do exact approve:
   - optionally `approve(spender, 0)` then `approve(spender, requiredAmount)`.
3. Then perform the main call.

## Outputs

After execution, the agent should return:

- Resolved `tba` and `sessionId` (for audit visibility)
- Whether activation was needed
- `userOpHash` / `txHash` and status per step
- Final `sessions(sessionId).spent/maxTotal` (also display in USDT units)
