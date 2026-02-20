# Repository Guidelines

## Project Structure & Module Organization
```
/
├── contracts/               # Solidity contracts
│   ├── src/                # Core contracts
│   │   ├── core/           # Agent6551Account.sol
│   │   ├── interfaces/     # ERC-6551 interfaces
│   │   └── mocks/          # Mock contracts for testing
│   ├── test/               # Foundry test suites
│   ├── lib/                # External dependencies (OpenZeppelin, forge-std)
│   └── script/             # Deployment scripts
├── src/                    # CLI source code
│   ├── agentCommands/      # Agent CLI commands
│   ├── backend/            # Owner API backend
│   └── lib/                # Shared utilities
├── skills/                 # Agent skills documentation
├── bin/                    # CLI entry point
└── dist/                   # Compiled CLI output
```

## Build, Test, and Development Commands

### Contracts (Foundry)
```bash
cd contracts
forge build --sizes        # Compile contracts
forge test -vvv            # Run tests with verbose traces
forge fmt --check          # Check formatting
```

### CLI
```bash
npm install                # Install dependencies
npm run build              # Compile TypeScript
node ./bin/run.js --help   # Show CLI help
npm run owner:api          # Start Owner API
```

## Coding Style & Naming Conventions
- **Solidity**: 4-space indentation; run `forge fmt` before submitting
- **TypeScript**: ESLint enforced; keep components typed
- **Naming**: 
  - Contracts/libraries: `PascalCase`
  - Functions/variables: `camelCase`
  - Constants: `UPPER_SNAKE_CASE`

## Testing Guidelines
- Contracts: Foundry (`forge-std/Test.sol`)
- Add tests for success paths, revert paths, and permission checks
- Before PR: `forge fmt --check && forge build --sizes && forge test -vvv`

## Commit & Pull Request Guidelines
- Use Conventional Commits:
  - `feat(cli): add new command`
  - `fix(contracts): fix policy check`
  - `docs: update README`
- Keep commits scoped: `cli`, `contracts`, `docs`, etc.

## Security
- Never commit private keys, secrets, or `.env` files
- `.aba/config.json` and `.aba/secrets.json` contain sensitive data
- For Sepolia deployment, set `RPC_URL` and `PRIVATE_KEY` in `.env`
