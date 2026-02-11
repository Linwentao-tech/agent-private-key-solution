# Repository Guidelines

## Project Structure & Module Organization
- `src/core/`: core account logic (`Agent6551Account.sol`).
- `src/interfaces/`: shared interfaces for ERC-6551 account behavior.
- `src/mocks/`: local mock contracts (`MockERC20`, `MockShop`, `MockCharacterNFT`) used in tests and demos.
- `test/`: Forge tests (`*.t.sol`), currently centered on `Agent6551Account.t.sol`.
- `script/`: deployment and demo scripts (`Deploy.s.sol`, `demo.js`, `demo.md`).
- `lib/`: external dependencies (OpenZeppelin, forge-std, ERC-6551 libs).

## Build, Test, and Development Commands
- `forge build --sizes`: compile contracts and show bytecode sizes.
- `forge test -vvv`: run the full Solidity test suite with verbose traces.
- `forge fmt --check`: verify formatting matches CI rules.
- `forge script script/Deploy.s.sol:Deploy --rpc-url $SEPOLIA_RPC_URL --private-key $PRIVATE_KEY --broadcast`: deploy demo contracts.
- `node script/demo.js`: run Sepolia end-to-end session flow demo.
- `npm install`: install JS dependency (`ethers`) used by scripts.

## Coding Style & Naming Conventions
- Solidity version: keep `pragma` in `^0.8.24+` range as used in repo.
- Formatting is enforced by `forge fmt`; use 4-space indentation and standard Foundry style.
- Contracts/libraries: `PascalCase`; functions/variables: `camelCase`; constants: `UPPER_SNAKE_CASE`.
- Test files must use `.t.sol` suffix and keep one primary contract per file when possible.

## Testing Guidelines
- Framework: Foundry (`forge-std/Test.sol`).
- Add unit tests for new logic, reverts, and authorization paths.
- Prefer descriptive test names like `testExecuteWithSessionBudgetExceededReverts`.
- Run `forge test -vvv` locally before opening a PR.

## Commit & Pull Request Guidelines
- This branch currently has no commit history, so no project-specific pattern is established yet.
- Use Conventional Commits moving forward (e.g., `feat: add session target selector checks`, `fix: prevent nonce reuse`).
- PRs should include: scope summary, test evidence (`forge test` output), related issue/reference, and deployment/network notes if scripts or addresses change.

## Security & Configuration Tips
- Never commit `.env` or private keys.
- Required env vars for live scripts: `SEPOLIA_RPC_URL` (or `RPC_URL`) and `PRIVATE_KEY`.
- Treat addresses in scripts/docs as environment-specific; validate before broadcast.
