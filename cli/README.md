# ABA CLI

Agent Bound Account CLI - 基于 ERC-6551 的智能钱包命令行工具，支持 Agent 授权执行。

> **注意：目前仅支持 Sepolia 测试网 (chainId: 11155111)**

---

## 目录

- [架构流程图](#架构流程图)
- [快速开始](#快速开始)
- [环境配置](#环境配置)
- [Agent CLI 命令](#agent-cli-命令)
- [Owner API](#owner-api)
- [错误码](#错误码)
- [注意事项](#注意事项)

---

## 架构流程图

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              ABA 架构流程                                        │
└─────────────────────────────────────────────────────────────────────────────────┘

   AGENT                                           OWNER
     │                                               │
     │  ┌────────────────────────────────┐          │
     │  │ ① aba init                     │          │
     │  │    --nft-ca <NFT>              │          │
     │  │    --token-id <ID>             │          │
     │  │                                │          │
     │  │ 生成密钥、部署AA、绑定NFT        │          │
     │  │ 输出: agentSignerAddress       │           │
     │  └───────────────┬────────────────┘          │
     │                  │                           │
     │                  ▼                           │
     │  ─────────────────────────────────────────►  │  ┌─────────────────────────────┐
     │                告诉 Owner                     │ │ ② 启动 Owner API             │
     │                                               │ │    npm run owner:api        │
     │                                               │ └───────────────┬─────────────┘
     │                                               │                 │
     │                                               │                 ▼
     │                                               │  ┌─────────────────────────────┐
     │                                               │  │ ③ POST /create-policy       │
     │                                               │  │    绑定 Agent 到 TBA        │
     │                                               │  │    设置预算和白名单          │
     │                                               │  └───────────────┬─────────────┘
     │                                               │                  │
     │                                               │                  ▼
     │                                               │  ┌─────────────────────────────┐
     │                                               │  │ ④ POST /approve             │
     │                                               │  │    授权 USDT 给 TBA          │
     │                                               │  └───────────────┬─────────────┘
     │                                               │                  │
     │  ┌────────────────────────────────┐          │                  │
     │  │ ⑤ aba send / aba call          │◄─────────┼──────────────────┘
     │  │    --to <address>              │          │
     │  │    --data <hex>                │          │
     │  │    --pull-amount <units>       │          │
     │  │                                │          │
     │  │ 执行转账/合约调用               │          │
     │  │ AA Paymaster 付 gas            │          │
     │  └───────────────┬────────────────┘          │
     │                  │                           │
     │                  ▼                           │
     │  ┌────────────────────────────────┐          │  ┌─────────────────────────────┐
     │  │ ⑥ aba status/balance/policy    │          │  │ ⑦ POST /adjust-policy       │
     │  │    查询状态                     │          │  │    调整预算/更换 Agent (可选)│
     │  └────────────────────────────────┘          │  └─────────────────────────────┘
     │                                               │
     ▼                                               ▼
   ┌────────────────────────────────────────────────────────────────────────────┐
   │                              TBA (Agent6551Account)                         │
   │                                                                             │
   │   Policy: { signer, validUntil, maxTotal, spent, budgetToken, active,     │
   │             targets[] }                                                    │
   │                                                                             │
   └────────────────────────────────────────────────────────────────────────────┘
```

---

## 快速开始

### 1. 安装与构建

```bash
cd cli
npm install
npm run build
```

### 2. 核心流程

```
1. Agent: aba init --nft-ca <NFT> (--token-id <ID> | --owner-address <ADDR>)
   → 生成密钥、部署 AA、绑定 NFT、部署 TBA

2. User:  启动 Owner API
   npm run owner:api -- --listen localhost:3000 --owner-privatekey <PK>

3. User:  POST /create-policy
   → 配置 Policy (signer = agentSignerAddress)

4. User:  POST /approve
   → 授权代币给 TBA

5. Agent: aba send <amount> <recipient>
   → 执行转账

   或: aba call --to <address> --data <hex> --pull-amount <units>
   → 执行合约调用

6. Agent: aba status/balance/policy/logs/doctor
   → 查看状态

7. User:  POST /adjust-policy
   → 调整 Policy (可选)
```

### 3. 命令速查

**AGENT 命令:**

| 命令 | 说明 |
|------|------|
| `aba init` | 初始化：生成密钥、部署 AA、绑定 NFT |
| `aba send` | 发送代币：转账 USDT |
| `aba call` | 合约调用：执行任意合约调用 |
| `aba status` | 查看状态 |
| `aba balance` | 查看余额 |
| `aba policy` | 查看 Policy |
| `aba logs` | 查看日志 |
| `aba doctor` | 诊断环境 |

**OWNER API 端点:**

| 端点 | 说明 |
|------|------|
| `POST /create-policy` | 创建 Policy |
| `POST /adjust-policy` | 调整 Policy |
| `POST /approve` | 授权代币 |

---

## 环境配置

### .env 文件

在 `cli/` 目录下创建 `.env` 文件：

```bash
# Owner 私钥 (用于 Owner API 签名交易)
PRIVATE_KEY=0x你的私钥

# Sepolia RPC URL
RPC_URL=https://eth-sepolia.g.alchemy.com/v2/你的API_KEY

# Pimlico Bundler RPC URL (AA 4337)
PIMLICO_RPC_URL=https://api.pimlico.io/v2/11155111/rpc?apikey=你的PIMLICO_KEY
```

### 获取配置

| 配置项 | 获取方式 |
|--------|---------|
| `PRIVATE_KEY` | 从钱包导出私钥 |
| `RPC_URL` | [Alchemy](https://alchemy.com) 或 [Infura](https://infura.io) |
| `PIMLICO_RPC_URL` | [Pimlico](https://pimlico.io) 注册获取 API Key |

### 状态文件

默认保存在 `./.aba/` 目录：

| 文件 | 内容 | Git |
|------|------|-----|
| `config.json` | 配置：地址、chainId、binding、RPC URLs (含 API keys) | 忽略 |
| `secrets.json` | 私钥：agentSignerPrivateKey, aaOwnerPrivateKey | 忽略 |

> **安全说明：** 两个文件都已自动加入 `.gitignore`，切勿提交到版本控制。`config.json` 包含 RPC URLs 和 API keys，`secrets.json` 包含私钥。

---

## Agent CLI 命令

### aba init

初始化 ABA 运行时环境，生成密钥、部署 AA 账户，并绑定 NFT 到 TBA。

```bash
node ./bin/run.js init --rpc-url <RPC_URL> --aa-bundler-rpc-url <BUNDLER_URL> --nft-ca <NFT_ADDRESS> (--token-id <ID> | --owner-address <ADDR>) [options]
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--rpc-url` | ✅ | RPC URL |
| `--aa-bundler-rpc-url` | ✅ | AA Bundler RPC URL |
| `--nft-ca` | ✅ | NFT 合约地址 |
| `--token-id` | ⚠️ | Token ID（与 `--owner-address` 二选一） |
| `--owner-address` | ⚠️ | Owner 地址，自动发现 tokenId（与 `--token-id` 二选一） |
| `--registry` | | ERC-6551 Registry 地址 |
| `--implementation` | | Agent6551 实现地址 |
| `--aa-account` | | AA 账户地址 (不提供则自动部署) |
| `--json` | | JSON 输出 |

> ⚠️ `--token-id` 和 `--owner-address` 必须提供其中之一。如果只提供 `--owner-address`，会自动发现该地址拥有的 tokenId。

**示例:**
```bash
# 指定 tokenId
node ./bin/run.js init \
  --rpc-url https://eth-sepolia.g.alchemy.com/v2/xxx \
  --aa-bundler-rpc-url https://api.pimlico.io/v2/11155111/rpc?apikey=xxx \
  --nft-ca 0x3d0172a432A1E861Df1434E44F815D32E9bed5cC \
  --token-id 443 \
  --json

# 指定 owner 地址，自动发现 tokenId
node ./bin/run.js init \
  --rpc-url <RPC> \
  --aa-bundler-rpc-url <BUNDLER> \
  --nft-ca 0x3d0172a432A1E861Df1434E44F815D32E9bed5cC \
  --owner-address 0x93c7629916a53DE8a7D46609a0585fD7FeDF3B45 \
  --json
```

---

### aba send

发送代币 (核心操作)。

```bash
node ./bin/run.js send <amount> <recipient> [options]
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `amount` | ✅ | 金额: `1`, `0.50`, `'$5.00'` |
| `recipient` | ✅ | 地址或 ENS 名称 |
| `--token` | | 代币地址 (默认: USDT) |
| `--dry-run` | | 模拟执行，不广播 |
| `--json` | | JSON 输出 |

**示例:**
```bash
# 发送 1 USDT
node ./bin/run.js send 1 0x1234...abcd --json

# 模拟执行
node ./bin/run.js send 1 0x1234...abcd --dry-run --json
```

---

### aba call

执行任意合约调用 (核心操作)。支持自动 approve 和预算检查。

```bash
node ./bin/run.js call --to <address> --data <hex> [options]
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `--to` | ✅ | 目标合约地址 |
| `--data` | ✅ | 调用数据 (hex 字符串) |
| `--pull-amount` | | 从 Owner 拉取代币数量 (token units) |
| `--value` | | ETH 数量 (wei) |
| `--dry-run` | | 模拟执行，不广播 |
| `--json` | | JSON 输出 |

**自动 Approve 机制:**

当指定 `--pull-amount` 时，CLI 会自动：
1. **预算检查**: 验证 `pullAmount <= maxTotal - spent`
2. **Allowance 检查**: 读取 TBA 对目标合约的授权额度
3. **自动调整**: 如果授权额度 ≠ pullAmount，自动调整为 pullAmount
4. **执行调用**: 完成目标合约调用

这确保 approve 金额 = 实际花费金额，防止过度授权。

**示例:**
```bash
# 购买商品 (自动 approve + pull + call)
node ./bin/run.js call \
  --to 0xShop \
  --data 0xd6febde8... \
  --pull-amount 1000000 \
  --json

# 不涉及代币的调用
node ./bin/run.js call --to 0xContract --data 0xabcdef --json
```

---

### aba status / balance / policy / logs / doctor

查询命令。

```bash
node ./bin/run.js status [--json]     # 网络状态、绑定、Policy
node ./bin/run.js balance [--json]    # Owner 和 TBA 余额
node ./bin/run.js policy [--json]     # Policy 详情
node ./bin/run.js logs [--last 20]    # 执行日志
node ./bin/run.js doctor [--json]     # 环境诊断
```

---

## Owner API

Owner API 是供 NFT Owner 使用的后端服务，用于授权 Agent 操作。

### 启动服务

```bash
npm run owner:api -- --listen localhost:3000 --owner-privatekey <PK>
```

| 参数 | 说明 |
|------|------|
| `--listen` | 监听地址 (默认: localhost:8787) |
| `--owner-privatekey` | NFT Owner 私钥 |

**启动成功输出:**
```
Owner API started.
listen: http://localhost:3000
owner: 0x93c7629916a53DE8a7D46609a0585fD7FeDF3B45
auth: none
```

### API 端点

#### GET /health

健康检查。

```bash
curl http://localhost:3000/health
```

#### GET /owner/capabilities

列出可用端点。

```bash
curl http://localhost:3000/owner/capabilities
```

#### POST /owner/create-policy

创建 Policy，绑定 Agent 到 TBA。

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

| 参数 | 必填 | 说明 |
|------|------|------|
| `policySigner` | | Agent 地址 (默认: state.agentSignerAddress) |
| `budgetToken` | | 预算代币 (默认: USDT) |
| `maxTotal` | | 最大预算 (默认: 100) |
| `validUntil` | | 过期时间戳 (默认: 2030年) |
| `targets` | | 白名单合约数组 |
| `active` | | 是否激活 (默认: true) |
| `dryRun` | | 模拟执行 |

#### POST /owner/adjust-policy

调整 Policy 参数或更换 Agent。

```bash
# 调整预算
curl -X POST http://localhost:3000/owner/adjust-policy \
  -H "Content-Type: application/json" \
  -d '{"maxTotal": "200"}'

# 更换 Agent
curl -X POST http://localhost:3000/owner/adjust-policy \
  -H "Content-Type: application/json" \
  -d '{"signer": "0xNewAgentAddress"}'
```

| 参数 | 说明 |
|------|------|
| `signer` | 新 Agent 地址 (更换 Agent) |
| `maxTotal` | 新最大预算 |
| `validUntil` | 新过期时间戳 |
| `targets` | 新白名单 |
| `active` | 是否激活 |
| `dryRun` | 模拟执行 |

#### POST /owner/approve

授权代币给 TBA。

```bash
curl -X POST http://localhost:3000/owner/approve \
  -H "Content-Type: application/json" \
  -d '{"amount": "100"}'
```

| 参数 | 说明 |
|------|------|
| `token` | 代币地址 (默认: USDT) |
| `amount` | 授权数量 |
| `max` | 授权最大值 (默认: true) |
| `dryRun` | 模拟执行 |

---

## 错误码

| 错误码 | 说明 | 解决方案 |
|--------|------|---------|
| `NO_BINDING` | 未绑定 NFT | 运行 `aba init` |
| `POLICY_CREATE_REQUIRED` | Policy 未创建 | Owner API 创建 Policy |
| `POLICY_INACTIVE` | Policy 未激活 | Owner API 激活 Policy |
| `INVALID_SIGNER` | Agent 签名者不匹配 | 检查 agentSigner 私钥 |
| `TARGET_NOT_ALLOWED` | 目标不在白名单 | 更新 Policy targets |
| `BUDGET_EXCEEDED` | 预算不足 | 减少 pull-amount 或增加 maxTotal |
| `BUDGET_OR_ALLOWANCE` | 预算或授权不足 | 增加 Policy 预算或 allowance |

---

## 注意事项

- 链默认为 Sepolia (`chainId=11155111`)
- `aba init --nft-ca --token-id` 可直接覆盖绑定
- `aba send` / `aba call` 通过 AA + Paymaster 执行，无需 Agent 支付 gas
- 所有命令支持 `--json` 输出
- Owner API 的 `/approve` 使用安全授权模式：非零授权时先重置为 0
- `.aba/config.json` 和 `.aba/secrets.json` 都已加入 `.gitignore`，切勿提交

---

## Skills

Agent Skills 位于 `cli/skills/` 目录，遵循 [Agent Skills 规范](https://agentskills.io)。

详见: [skills/README.md](./skills/README.md)
