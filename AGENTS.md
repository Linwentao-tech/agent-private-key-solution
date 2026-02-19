# Repository Guidelines

## Project Structure & Module Organization
- `src/core/`: core account logic (`Agent6551Account.sol`).
- `src/interfaces/`: ERC-6551 account/executable interfaces shared by contracts.
- `src/mocks/`: local mock contracts (`MockERC20`, `MockShop`, `MockCharacterNFT`) used in tests and demos.
- `test/`: Foundry test suites (`*.t.sol`), currently centered on `Agent6551Account.t.sol`.
- `frontend/`: Next.js operator UI for wallet connect, NFT selection, TBA management, and session operations.
- `docs/`: project docs (for example commit-topic guidance).
- `lib/`: external dependencies (OpenZeppelin, forge-std, ERC-6551 reference libs).

## Build, Test, and Development Commands
- `forge build --sizes`: compile Solidity contracts and show bytecode sizes.
- `forge test -vvv`: run the full contract test suite with verbose traces.
- `forge fmt --check`: validate Solidity formatting (CI-enforced).
- `npm install`: install root JS dependencies used by scripts.
- `cd frontend && npm install`: install frontend dependencies.
- `cd frontend && npm run dev`: run local UI at `http://localhost:3000`.
- `cd frontend && npm run build`: production build check for the frontend.

## Coding Style & Naming Conventions
- Solidity: 4-space indentation; run `forge fmt` before submitting.
- Naming: contracts/libraries in `PascalCase`, functions/variables in `camelCase`, constants in `UPPER_SNAKE_CASE`.
- Keep test files suffixed with `.t.sol` and prefer one primary test contract per file.
- Frontend uses TypeScript + ESLint (`frontend/eslint.config.mjs`); keep components typed and lint-clean.

## Testing Guidelines
- Framework: Foundry (`forge-std/Test.sol`) for contract tests.
- Add tests for success paths, revert paths, and permission checks (owner/session signer behavior).
- Prefer descriptive names, e.g. `testExecuteWithSessionBudgetExceededReverts`.
- Before opening a PR, run: `forge fmt --check && forge build --sizes && forge test -vvv`.

## Commit & Pull Request Guidelines
- Use Conventional Commits (see `docs/git-topics.md`), e.g.:
  - `feat(core): add session target selector checks`
  - `fix(test): align revert expectation for nonce reuse`
- Keep commits scoped and focused (`core`, `test`, `frontend`, `build`, etc.).
- PRs should include:
  - clear scope summary
  - test evidence (command output or checklist)
  - linked issue/reference
  - network/deployment notes when addresses or scripts change

## Security & Configuration Tips
- Never commit private keys, secrets, or `.env` files.
- For Sepolia scripts, set `SEPOLIA_RPC_URL` (or `RPC_URL`) and `PRIVATE_KEY`.
- Treat contract addresses in docs/UI as environment-specific and verify before broadcast.
