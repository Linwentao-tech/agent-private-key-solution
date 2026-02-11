---
name: aa-session-worker
description: Execute on-chain actions inside an Agent6551Account session on Sepolia using ERC-4337 (AA pays gas). Prompts are natural language plus tba + sessionId; the agent handles EIP-712 signing, allowance, and UserOps.
metadata:
  short-description: AA session executor
---

# AA Session Worker (Sepolia) — Execute On-Chain Actions Inside a Session (AA Pays Gas)

## Goal

On Sepolia, given a `tba` + `sessionId`, the agent must:

1. Check the session status (exists / not expired / not revoked / correct budget token).
2. If the session is not activated yet (`signer == address(0)`), activate it via `activateSessionBySig`.
3. Compile your natural-language request into one or more on-chain steps (auto-handle ERC-20 allowance when needed).
4. Send ERC-4337 UserOperations (bundler + optional paymaster) so the AA account pays gas.
5. Execute everything through the single entrypoint: `tba.executeWithSession(...)`.

## Prompt Requirements (Must Include)

Your prompt MUST include:

- `tba=0x...` (the deployed Agent6551Account instance address, i.e. the TBA address)
- `sessionId=0x...` (bytes32: `0x` + 64 hex chars)
- A natural-language description of what contract function(s) to call, and how much to spend / max spend (e.g. `Spend 1 USDT` or `Spend up to 5 USDT`)

You do NOT need to provide `calldata`; the agent should encode calls using ABI(s).

## Key Management (Agent Must Generate & Persist)

The agent must generate and securely persist **two distinct private keys** (do not reuse user wallet keys):

- **Session key**: used ONLY for EIP-712 business signatures (`SessionActivation` and `SessionCall`). This corresponds to `SESSION_SIGNER_PRIVATE_KEY`.
- **AA owner key**: used to control the ERC-4337 smart account by signing UserOperations. This corresponds to `AA_OWNER_PRIVATE_KEY`.

Requirements:

- Keys MUST be stable across runs (persisted in secret storage or env); otherwise session activation and nonce tracking will break.
- Never print or exfiltrate private keys; only surface the derived public addresses when needed.

## Environment Variables (Required For AA Gas Payment)

- `SEPOLIA_RPC_URL` or `RPC_URL`
- `PIMLICO_RPC_URL` (or `AA_BUNDLER_RPC_URL`) (environment variable)
- Optional `PIMLICO_SPONSORSHIP_POLICY_ID` (if present, try sponsored mode)
- `ENTRYPOINT_VERSION=0.7` (default to v0.7 EntryPoint; also ensure the EntryPoint bytecode exists on-chain)
- `AA_OWNER_PRIVATE_KEY` (signs the UserOperation)
- `SESSION_SIGNER_PRIVATE_KEY` (signs EIP-712: SessionActivation / SessionCall)
- `USDT_ADDRESS=0x7169D38820dfd117C3FA1f22a697dBA58d90BA06` (fixed budget token on Sepolia, 6 decimals; 1 USDT = 1_000_000)

Example (bash):

```bash
export PIMLICO_RPC_URL="https://...your-bundler-rpc..."
```

## Typed Data Reference (Must Match Exactly)

Below are the **meaning and shape** of the two EIP-712 typed-data payloads used by this contract. (In real signing, replace `<...>` placeholders with real values.)

## Deadline Rule (Must Follow Session Expiry)

Both EIP-712 signatures include a `deadline` (unix seconds). The contract will revert if `block.timestamp > deadline`.

Additionally, every session has an on-chain expiry `validUntil`. The contract will revert if `block.timestamp > validUntil`.

Therefore, the agent MUST set:

- `deadline <= sessions(sessionId).validUntil`

Recommended default:

- Use `deadline = sessions(sessionId).validUntil` (or a shorter time window if you want tighter safety).

### 1) SessionActivation (Signature For `activateSessionBySig`)

Use case: when `sessions(sessionId).signer == 0x0`, the agent must activate the session first.

Key points:

- `verifyingContract` MUST be the **TBA address** (the Agent6551Account instance you are calling), not the Registry / Implementation.
- `chainId` MUST match the current network (Sepolia = `11155111`).
- `message.signer` is the session signer address derived from `SESSION_SIGNER_PRIVATE_KEY`; verification requires `recovered == signer`.
- `deadline` is the signature expiry (unix seconds). The contract checks `block.timestamp <= deadline`.

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

Activation call:

- `tba.activateSessionBySig(sessionId, signer, deadline, signature)`

### 2) SessionCall (Signature For `executeWithSession`)

Use case: every on-chain action executed under the session requires a session-signer signature over a `SessionCall`, then a call to `executeWithSession`.

Key points:

- `verifyingContract` MUST again be the **TBA address**.
- The signature covers `dataHash = keccak256(data)`, NOT the raw `data` bytes.
- `nonce` must be unique per `sessionId`, otherwise the contract reverts with `NonceAlreadyUsed`.
- `deadline` is the signature expiry (unix seconds).
- `pullAmount` is how much budget token (e.g. USDT) the contract is allowed to pull from the NFT owner into the TBA before executing. Internally it performs `safeTransferFrom(owner, tba, pullAmount)` (only if `pullAmount > 0`).

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

Execution call:

- `tba.executeWithSession(req, signature)`
- `req.data` is the real calldata, but the signature is over `dataHash`.

## Allowance (General Auto-Handling)

If a step requires some contract (a spender) to spend ERC-20 from the TBA (router / marketplace / any spender):

1. Read `allowance(tba, spender)`.
2. If insufficient, do **exact approve** based on the spend you described in the prompt:
   - If needed, first `approve(spender, 0)` then `approve(spender, requiredAmount)`.
3. Then perform the main call.

## Outputs

After execution, the agent should return:

- Whether activation was needed, plus userOpHash / txHash
- For each step: userOpHash / txHash / status
- Final `sessions(sessionId).spent/maxTotal` (also display in USDT units)
