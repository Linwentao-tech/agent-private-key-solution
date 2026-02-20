export type ParsedCliError = {
  code: string
  message: string
  hint?: string
  raw?: string
}

function asErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function matchAny(source: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(source))
}

export function parseCliError(err: unknown): ParsedCliError {
  const raw = asErrorMessage(err)
  const lower = raw.toLowerCase()

  if (matchAny(raw, [/no binding found/i])) {
    return {
      code: 'NO_BINDING',
      message: '当前没有绑定记录。',
      hint: '先执行 `aba bind --nft-ca <address>`。',
      raw,
    }
  }

  if (matchAny(raw, [/policy not created yet/i])) {
    return {
      code: 'POLICY_CREATE_REQUIRED',
      message: '当前绑定尚未创建 policy。',
      hint: '先执行 `aba policy create`。',
      raw,
    }
  }

  if (matchAny(raw, [/missing nft contract\/token id/i])) {
    return {
      code: 'MISSING_NFT_INPUT',
      message: '缺少 NFT 合约或 tokenId 参数。',
      hint: '传入 `--nft-ca` 和 `--token-id`，或先执行 `aba bind`。',
      raw,
    }
  }

  if (matchAny(raw, [/token-id=auto failed/i, /transfer log scan timed out/i, /cannot auto-discover owner NFTs on-chain/i])) {
    return {
      code: 'TOKEN_ID_DISCOVERY_FAILED',
      message: '自动解析 tokenId 失败。',
      hint: '可直接传 `--token-id <id>`，或检查 RPC 质量后重试。',
      raw,
    }
  }

  if (matchAny(raw, [/token-id=auto requires --owner-address/i])) {
    return {
      code: 'OWNER_ADDRESS_REQUIRED',
      message: '自动解析 tokenId 需要 owner 地址。',
      hint: '传入 `--owner-address <0x...>`，或直接传 `--token-id <id>`。',
      raw,
    }
  }

  const missingFlagMatch = raw.match(/Missing required flag ([\w-]+)/i)
  if (missingFlagMatch?.[1]) {
    return {
      code: 'MISSING_REQUIRED_FLAG',
      message: `缺少必填参数: --${missingFlagMatch[1]}`,
      hint: '使用 `--help` 查看完整参数说明。',
      raw,
    }
  }

  const missingArgMatch = raw.match(/Missing 1 required arg:\s*([\w-]+)/i)
  if (missingArgMatch?.[1]) {
    return {
      code: 'MISSING_REQUIRED_ARG',
      message: `缺少必填参数: ${missingArgMatch[1]}`,
      hint: '使用 `--help` 查看完整参数说明。',
      raw,
    }
  }

  const missingArgsMatch = raw.match(/Missing (\d+) required args?:([\s\S]*?)See more help/i)
  if (missingArgsMatch) {
    const names = missingArgsMatch[2]
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => x.split(/\s+/)[0])
      .filter(Boolean)
    return {
      code: 'MISSING_REQUIRED_ARGS',
      message: `缺少必填参数: ${names.join(', ')}`,
      hint: '使用 `--help` 查看完整参数说明。',
      raw,
    }
  }

  const unexpectedArgMatch = raw.match(/Unexpected argument:\s*([^\n]+)/i)
  if (unexpectedArgMatch?.[1]) {
    return {
      code: 'UNEXPECTED_ARGUMENT',
      message: `存在未预期参数: ${unexpectedArgMatch[1].trim()}`,
      hint: '检查命令与参数顺序，必要时使用 `--help`。',
      raw,
    }
  }

  if (matchAny(raw, [/Nonexistent flag/i])) {
    return {
      code: 'UNKNOWN_FLAG',
      message: '存在未识别的参数标记。',
      hint: '请检查参数拼写，或使用 `--help` 查看可用参数。',
      raw,
    }
  }

  if (matchAny(raw, [/Address \".+\" is invalid/i, /must be a valid 0x address/i])) {
    return {
      code: 'INVALID_ADDRESS',
      message: '地址格式不合法。',
      hint: '请使用完整 42 位 0x 地址。',
      raw,
    }
  }

  const parsingFlagMatch = raw.match(/Parsing\s+(--[\w-]+)[\s\S]*Expected ([^\n]+)/i)
  if (parsingFlagMatch?.[1]) {
    return {
      code: 'INVALID_FLAG_VALUE',
      message: `${parsingFlagMatch[1]} 参数格式错误：${parsingFlagMatch[2].trim()}`,
      hint: '请按该参数要求的类型重新输入。',
      raw,
    }
  }

  if (matchAny(raw, [/cannot also be provided when using/i])) {
    const lines = raw
      .split('\n')
      .map((x) => x.trim())
      .filter((x) => x.includes('cannot also be provided when using'))
    return {
      code: 'CONFLICTING_FLAGS',
      message: lines[0] ?? '参数冲突',
      hint: '互斥参数不能同时传入，请二选一。',
      raw,
    }
  }

  if (matchAny(raw, [/NotTokenOwner/i, /owner-only/i, /caller is not the owner/i])) {
    return {
      code: 'OWNER_ONLY',
      message: '当前操作仅允许 NFT 当前 owner 执行。',
      hint: '请确认你在 `aba init` 配置的私钥就是该 NFT 的 owner。',
      raw,
    }
  }

  if (matchAny(raw, [/InvalidSigner/i, /policy signer mismatch/i])) {
    return {
      code: 'INVALID_SIGNER',
      message: '签名者无权限执行该操作。',
      hint: '确认 agent/policy signer 私钥与链上 policy signer 一致。',
      raw,
    }
  }

  if (matchAny(raw, [/PolicyNotConfigured/i, /(?:0x)?3f70126b/i])) {
    return {
      code: 'POLICY_NOT_CONFIGURED',
      message: '当前 TBA 尚未配置 policy。',
      hint: '先执行 `aba policy create` 完成策略配置。',
      raw,
    }
  }

  if (matchAny(raw, [/PolicyNotActive/i, /policy is inactive/i, /(?:0x)?8966b51f/i])) {
    return {
      code: 'POLICY_NOT_ACTIVE',
      message: 'policy 当前处于禁用状态。',
      hint: '使用 owner 权限重新启用 policy。',
      raw,
    }
  }

  if (matchAny(raw, [/PolicyExpired/i, /SignatureExpired/i, /(?:0x)?41540bfd/i, /(?:0x)?cd21db4f/i])) {
    return {
      code: 'POLICY_EXPIRED',
      message: 'policy 或签名已过期。',
      hint: '更新 validUntil/deadline 后重试。',
      raw,
    }
  }

  if (matchAny(raw, [/NonceAlreadyUsed/i, /(?:0x)?91cab504/i])) {
    return {
      code: 'NONCE_ALREADY_USED',
      message: 'nonce 已被使用，触发防重放保护。',
      hint: '请使用新的 nonce 重新签名。',
      raw,
    }
  }

  if (matchAny(raw, [/TargetNotAllowed/i, /is not in policy whitelist/i, /token target not allowed by policy/i, /(?:0x)?e356c1d3/i])) {
    return {
      code: 'TARGET_NOT_ALLOWED',
      message: '目标地址不在 policy 白名单中。',
      hint: '先更新 policy targets，再执行调用。',
      raw,
    }
  }

  if (matchAny(raw, [/BudgetExceeded/i, /budget exceeded/i, /(?:0x)?29a8b5f0/i, /insufficient allowance/i, /owner allowance is insufficient for pullamount/i, /owner token balance is insufficient for pullamount/i, /transfer amount exceeds/i])) {
    return {
      code: 'BUDGET_OR_ALLOWANCE',
      message: '预算或代币授权不足，执行被拒绝。',
      hint: '检查 policy 预算、owner 余额以及 ERC20 allowance。',
      raw,
    }
  }

  if (matchAny(raw, [/PolicyMaxTotalBelowSpent/i])) {
    return {
      code: 'INVALID_POLICY_MAX_TOTAL',
      message: 'maxTotal 不能低于已花费金额 spent。',
      hint: '将 maxTotal 调整到不小于当前 spent。',
      raw,
    }
  }

  if (matchAny(raw, [/InvalidPolicy/i, /InvalidPolicySigner/i, /InvalidPolicyBudgetToken/i, /InvalidPolicyTargets/i])) {
    return {
      code: 'INVALID_POLICY_CONFIG',
      message: 'policy 参数不合法。',
      hint: '检查 signer/budgetToken/validUntil/maxTotal/targets 参数。',
      raw,
    }
  }

  if (matchAny(raw, [/binding already exists/i])) {
    return {
      code: 'BINDING_EXISTS',
      message: '当前已存在绑定，不能重复 bind。',
      hint: '先执行 `aba unbind` 再重新绑定。',
      raw,
    }
  }

  if (matchAny(raw, [/owner private key is required/i, /owner private key not found/i])) {
    return {
      code: 'OWNER_KEY_REQUIRED',
      message: '缺少 owner 私钥。',
      hint: '请通过命令参数传入 owner 私钥（例如 `--owner-privatekey` 或 `--privatekey`）。',
      raw,
    }
  }

  if (matchAny(raw, [/policy\/agent signer private key is required/i, /agent signer keys are required in init/i])) {
    return {
      code: 'AGENT_SIGNER_KEY_REQUIRED',
      message: '缺少 agent/policy signer 私钥。',
      hint: '先执行 `aba init`（会自动生成并持久化 agent signer key），或显式传 `--agent-signer-privatekey`。',
      raw,
    }
  }

  if (matchAny(raw, [/missing minimal4337account artifact/i])) {
    return {
      code: 'AA_DEPLOY_ARTIFACT_MISSING',
      message: '缺少 AA 部署工件。',
      hint: '先在仓库根目录执行 `forge build`，再重试 `aba init`。',
      raw,
    }
  }

  if (matchAny(raw, [/missing deployer key for aa auto-deploy/i])) {
    return {
      code: 'AA_DEPLOY_CONFIG_MISSING',
      message: 'AA 自动部署配置不完整。',
      hint: '检查 `--aa-bundler-rpc-url` 与 paymaster 配置后重试。',
      raw,
    }
  }

  if (matchAny(raw, [/aa deploy tx has no contractaddress/i, /aa deploy userop submitted but no receipt txhash/i, /aa account code still empty after deploy userop execution/i])) {
    return {
      code: 'AA_DEPLOY_FAILED',
      message: 'AA 账户部署失败。',
      hint: '检查 bundler/paymaster 可用性与 sponsorship 配置后重试。',
      raw,
    }
  }

  if (
    matchAny(raw, [
      /aa_bundler_rpc_url is required/i,
      /aa bundler rpc is required/i,
      /aa_account_address is required/i,
      /aa_owner_private_key is required/i,
      /aa-account is required/i,
      /aa-owner-privatekey is required/i,
    ])
  ) {
    return {
      code: 'AA_CONFIG_MISSING',
      message: '缺少 AA 运行配置。',
      hint: '先执行 `aba init --rpc-url <...> --aa-bundler-rpc-url <...>` 完成 AA 初始化。',
      raw,
    }
  }

  if (matchAny(raw, [/cannot resolve ens name/i])) {
    return {
      code: 'ENS_RESOLVE_FAILED',
      message: 'ENS 地址解析失败。',
      hint: '请检查 ENS 名称，或改用 0x 地址。',
      raw,
    }
  }

  if (matchAny(raw, [/aa20 account not deployed/i])) {
    return {
      code: 'AA_ACCOUNT_NOT_DEPLOYED',
      message: 'AA 账户尚未部署。',
      hint: '请先执行 `aba init` 自动部署 AA，或在 state 中配置正确的 AA 账户地址。',
      raw,
    }
  }

  if (matchAny(raw, [/AA34 signature error/i])) {
    return {
      code: 'AA_PAYMASTER_SIGNATURE_INVALID',
      message: 'Paymaster 签名校验失败（AA34）。',
      hint: '请确认 paymaster 赞助策略允许当前 userOp，并检查 bundler/paymaster RPC 配置。',
      raw,
    }
  }

  if (matchAny(raw, [/AA21 didn't pay prefund/i])) {
    return {
      code: 'AA_PREFUND_REQUIRED',
      message: 'AA 账户预充值不足，userOp 模拟失败（AA21）。',
      hint: '检查 paymaster 赞助是否生效并重试。',
      raw,
    }
  }

  if (matchAny(raw, [/owner token balance is insufficient for pullAmount/i])) {
    return {
      code: 'OWNER_BALANCE_INSUFFICIENT',
      message: 'owner 代币余额不足，无法完成 pullAmount。',
      hint: '请先给 owner 地址充值预算代币，或降低本次 send amount。',
      raw,
    }
  }

  if (matchAny(raw, [/owner allowance is insufficient for pullamount/i])) {
    return {
      code: 'OWNER_ALLOWANCE_INSUFFICIENT',
      message: 'owner 对 TBA 的代币授权不足。',
      hint: '请先补充授权额度后再重试。',
      raw,
    }
  }

  if (matchAny(raw, [/contract function "approve" reverted/i, /contract function 'approve' reverted/i])) {
    return {
      code: 'TOKEN_APPROVE_REVERTED',
      message: '代币授权交易被合约拒绝。',
      hint: '该代币可能要求先将 allowance 置 0，再设置新的非 0 值（safe approve）。',
      raw,
    }
  }

  if (matchAny(raw, [/agent send does not support owner pullamount path/i])) {
    return {
      code: 'AGENT_OWNER_PATH_DISABLED',
      message: 'agent send 不支持 owner pull 路径。',
      hint: '请使用默认 `--pull-amount 0`，并确保资金在 TBA 内。',
      raw,
    }
  }

  if (matchAny(raw, [/maxFeePerGas must be at least/i])) {
    return {
      code: 'AA_GAS_PRICE_TOO_LOW',
      message: 'AA userOp gas 费率过低。',
      hint: '重试命令（CLI 会优先拉取 bundler 的 gas price），或稍后再试。',
      raw,
    }
  }

  if (lower.includes('fetch failed') || lower.includes('http request failed') || lower.includes('temporary failure in name resolution')) {
    return {
      code: 'RPC_UNAVAILABLE',
      message: 'RPC/网络请求失败。',
      hint: '检查网络连通性并确认 `rpc-url` 可用。',
      raw,
    }
  }

  if (matchAny(raw, [/The following errors? occurred:/i])) {
    const lines = raw
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean)
      .filter((x) => !/^the following errors? occurred:$/i.test(x))
      .filter((x) => x.toLowerCase() !== 'see more help with --help')
    const message = lines[0] ?? '命令参数错误'
    return {
      code: 'CLI_ARGUMENT_ERROR',
      message,
      hint: '使用 `--help` 查看完整参数说明。',
      raw,
    }
  }

  return {
    code: 'UNKNOWN',
    message:
      raw
        .split('\n')
        .map((x) => x.trim())
        .find((x) => x.length > 0 && x.toLowerCase() !== 'the following error occurred:') || '未知错误',
    raw,
  }
}
