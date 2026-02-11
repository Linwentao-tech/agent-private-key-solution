// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IERC6551Account} from "erc6551/interfaces/IERC6551Account.sol";
import {IERC6551Executable} from "erc6551/interfaces/IERC6551Executable.sol";

interface IERC721OwnerOf {
    /// @dev 只保留 ownerOf 最小接口，避免引入完整 IERC721 依赖。
    function ownerOf(uint256 tokenId) external view returns (address owner);
}

/// @title Agent6551Account
/// @notice ERC-6551 账户 + Session 授权执行
/// @dev 设计目标：
/// 1) owner 只做一次性策略配置（额度、白名单、有效期）
/// 2) agent 自己激活并使用 session key 执行后续操作
/// 3) 资金来源是 owner，对外执行主体是 TBA
contract Agent6551Account is IERC165, IERC1271, IERC6551Account, IERC6551Executable, EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;
    error InvalidSigner(address signer);
    error InvalidOperation(uint8 operation);
    error NotTokenOwner(address caller);
    error SessionNotFound(bytes32 sessionId);
    error SessionNotActivated(bytes32 sessionId);
    error SessionAlreadyExists(bytes32 sessionId);
    error SessionAlreadyActivated(bytes32 sessionId);
    error SessionIsRevoked(bytes32 sessionId);
    error SessionExpired(bytes32 sessionId);
    error SignatureExpired(uint256 deadline);
    error NonceAlreadyUsed(bytes32 sessionId, uint256 nonce);
    error TargetNotAllowed(bytes32 sessionId, address target);
    error BudgetExceeded(bytes32 sessionId, uint256 attempted, uint256 maxAllowed);
    error InvalidSessionBudgetToken();
    error InvalidSessionValidUntil(uint64 validUntil);
    error InvalidSessionMaxTotal(uint256 maxTotal);
    error InvalidSessionTargets();
    error InvalidSessionTarget(address target);

    /// @dev EIP-712 结构定义哈希，前后端必须严格一致。
    bytes32 public constant SESSION_CALL_TYPEHASH = keccak256(
        "SessionCall(bytes32 sessionId,address to,uint256 value,bytes32 dataHash,uint256 nonce,uint256 deadline,uint256 pullAmount)"
    );
    bytes32 public constant SESSION_ACTIVATION_TYPEHASH =
        keccak256("SessionActivation(bytes32 sessionId,address signer,uint256 deadline)");

    /// @dev Session 状态：
    /// signer      会话签名者（agent 激活后绑定）
    /// validUntil  到期时间（unix 秒）
    /// maxTotal    总预算上限
    /// spent       已消费累计
    /// budgetToken 预算币种（如 USDT）
    /// revoked     owner 是否已撤销
    struct Session {
        address signer;
        uint64 validUntil;
        uint256 maxTotal;
        uint256 spent;
        address budgetToken;
        bool revoked;
    }

    /// @dev 一次 session 执行请求的数据结构。
    /// data 使用 bytes，签名里只放 keccak256(data) 以减少 EIP-712 消息体体积。
    struct SessionCallRequest {
        bytes32 sessionId;
        address to;
        uint256 value;
        bytes data;
        uint256 nonce;
        uint256 deadline;
        uint256 pullAmount;
    }

    /// @dev 建议每次状态变化递增，符合 ERC-6551 对 state() 的预期语义。
    uint256 public state;

    /// @dev sessionId => Session 配置
    mapping(bytes32 => Session) public sessions;
    /// @dev sessionId => 目标合约地址白名单（to）
    mapping(bytes32 => mapping(address => bool)) public sessionTargetAllowed;
    /// @dev sessionId => nonce 是否已使用（防重放）
    mapping(bytes32 => mapping(uint256 => bool)) public usedSessionNonce;

    /// @dev 链上可枚举的 sessionId 索引（mapping 本身不可枚举，所以需要额外数组）。
    /// 只允许 NFT owner 读取，用于前端跨设备恢复 “我在这个 TBA 上创建过哪些 session”。
    /// 注意：链上数据本质公开，这个限制只能阻止“通过 ABI 直接调用”，不提供真正隐私。
    bytes32[] private _sessionIndex;
    mapping(bytes32 => bool) private _sessionIndexed;

    event SessionCreated(
        bytes32 indexed sessionId, address indexed signer, uint64 validUntil, address budgetToken, uint256 maxTotal
    );
    event SessionActivated(bytes32 indexed sessionId, address indexed signer);
    event SessionRevoked(bytes32 indexed sessionId);
    event SessionExecuted(bytes32 indexed sessionId, uint256 indexed nonce, uint256 spend, uint256 totalSpent);

    constructor() EIP712("Agent6551Account", "1") {}

    receive() external payable {}

    modifier onlyTokenOwner() {
        _onlyTokenOwner();
        _;
    }

    /// @notice owner 创建“模板 session”，定义后续 agent 行为的规则和预算，但不绑定具体 signer。
    function createSession(
        bytes32 sessionId,
        uint64 validUntil,
        address budgetToken,
        uint256 maxTotal,
        address[] calldata targets
    ) external onlyTokenOwner {
        if (budgetToken == address(0)) revert InvalidSessionBudgetToken();
        if (validUntil <= block.timestamp) revert InvalidSessionValidUntil(validUntil);
        if (maxTotal == 0) revert InvalidSessionMaxTotal(maxTotal);
        if (targets.length == 0) revert InvalidSessionTargets();

        // Prevent re-creating a sessionId. Otherwise, old targets/nonces could remain,
        // which becomes a security foot-gun.
        Session storage s = sessions[sessionId];
        if (s.budgetToken != address(0)) revert SessionAlreadyExists(sessionId);

        // Index this sessionId for on-chain enumeration (dedup).
        if (!_sessionIndexed[sessionId]) {
            _sessionIndexed[sessionId] = true;
            _sessionIndex.push(sessionId);
        }
        // 模板阶段 signer 固定为 0，直到 agent 调用 activateSession 绑定。
        // 定义初始化参数，后续 agent 激活时会继承这些参数。
        s.signer = address(0);
        s.validUntil = validUntil;
        s.maxTotal = maxTotal;
        s.spent = 0;
        s.budgetToken = budgetToken;
        s.revoked = false;

        uint256 len = targets.length; //白名单允许的合约地址数量
        for (uint256 i = 0; i < len; ++i) {
            if (targets[i] == address(0)) revert InvalidSessionTarget(targets[i]);
            sessionTargetAllowed[sessionId][targets[i]] = true;
        }

        emit SessionCreated(sessionId, address(0), validUntil, budgetToken, maxTotal);
    }

    /// @notice 返回该 TBA 上已创建过的 session 数量（仅 NFT owner 可读）。
    function sessionCount() external view onlyTokenOwner returns (uint256) {
        return _sessionIndex.length;
    }

    /// @notice 分页读取该 TBA 上已创建过的 sessionId（仅 NFT owner 可读）。
    /// @dev limit=0 会返回空数组；offset 超出范围也返回空数组。
    function getSessionIds(uint256 offset, uint256 limit) external view onlyTokenOwner returns (bytes32[] memory ids) {
        uint256 len = _sessionIndex.length;
        if (limit == 0 || offset >= len) return new bytes32[](0);

        uint256 end = offset + limit;
        if (end > len) end = len;

        uint256 outLen = end - offset;
        ids = new bytes32[](outLen);
        for (uint256 i = 0; i < outLen; ++i) {
            ids[i] = _sessionIndex[offset + i];
        }
    }

    /// @notice 分页读取“未过期且未撤销”的 sessionId（仅 NFT owner 可读）。
    /// @dev 这是对 _sessionIndex 的过滤视图：
    /// - 不过期：block.timestamp <= validUntil
    /// - 未撤销：revoked == false
    /// - 存在：budgetToken != address(0)
    /// offset/limit 是针对“过滤后的列表”做分页。
    function getActiveSessionIds(uint256 offset, uint256 limit)
        external
        view
        onlyTokenOwner
        returns (bytes32[] memory ids)
    {
        if (limit == 0) return new bytes32[](0);

        uint256 len = _sessionIndex.length;
        if (len == 0) return new bytes32[](0);

        // Allocate max possible and shrink at the end.
        ids = new bytes32[](limit);
        uint256 skipped = 0;
        uint256 out = 0;

        for (uint256 i = 0; i < len; ++i) {
            bytes32 sid = _sessionIndex[i];
            Session storage s = sessions[sid];
            if (s.budgetToken == address(0)) continue;
            if (s.revoked) continue;
            if (block.timestamp > s.validUntil) continue;

            if (skipped < offset) {
                unchecked {
                    ++skipped;
                }
                continue;
            }

            ids[out] = sid;
            unchecked {
                ++out;
            }
            if (out == limit) break;
        }

        assembly ("memory-safe") {
            mstore(ids, out)
        }
    }

    /// @notice agent 自激活 session，把自己地址绑定为 signer(msg.sender)
    /// @dev 这样 owner 无需直接管理 session key，只管理策略模板即可，实现agent接管。
    function activateSession(bytes32 sessionId) external {
        Session storage s = sessions[sessionId];
        if (s.budgetToken == address(0)) revert SessionNotFound(sessionId);
        if (s.revoked) revert SessionIsRevoked(sessionId);
        if (block.timestamp > s.validUntil) revert SessionExpired(sessionId);
        if (s.signer != address(0)) revert SessionAlreadyActivated(sessionId);
        s.signer = msg.sender;
        emit SessionActivated(sessionId, msg.sender);
    }

    /// @notice 通过 session key 的 EIP-712 签名激活 session，允许由任意 relayer/AA 代发。
    /// @dev 这样激活交易 gas 可由 paymaster 赞助，同时保持 signer 仍是 session key 对应地址。
    function activateSessionBySig(bytes32 sessionId, address signer, uint256 deadline, bytes calldata signature)
        external
    {
        Session storage s = sessions[sessionId];
        if (s.budgetToken == address(0)) revert SessionNotFound(sessionId);
        if (s.revoked) revert SessionIsRevoked(sessionId);
        if (block.timestamp > s.validUntil) revert SessionExpired(sessionId);
        if (s.signer != address(0)) revert SessionAlreadyActivated(sessionId);
        if (block.timestamp > deadline) revert SignatureExpired(deadline);
        if (signer == address(0)) revert InvalidSigner(signer);

        bytes32 digest =
            _hashTypedDataV4(keccak256(abi.encode(SESSION_ACTIVATION_TYPEHASH, sessionId, signer, deadline)));
        address recovered = ECDSA.recover(digest, signature);
        if (recovered != signer) revert InvalidSigner(recovered);

        s.signer = signer;
        emit SessionActivated(sessionId, signer);
    }

    /// @notice owner 随时撤销 session
    function revokeSession(bytes32 sessionId) external onlyTokenOwner {
        Session storage s = sessions[sessionId];
        if (s.budgetToken == address(0)) revert SessionNotFound(sessionId);
        s.revoked = true;
        emit SessionRevoked(sessionId);
    }

    /// @notice owner 直控执行入口，作为人工干预手段，优先级高于 session 执行路径。
    /// @dev 当前仅允许 operation=0（CALL），不开放 delegatecall/create。
    function execute(address to, uint256 value, bytes calldata data, uint8 operation)
        external
        payable
        returns (bytes memory result)
    {
        if (!_isValidSigner(msg.sender)) revert InvalidSigner(msg.sender);
        if (operation != 0) revert InvalidOperation(operation);

        unchecked {
            ++state;
        }

        (bool success, bytes memory ret) = to.call{value: value}(data);
        if (!success) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        return ret;
    }

    /// @notice session key 执行入口
    /// @dev 执行顺序：
    /// 1) 检查 session 状态（存在/激活/未撤销/未过期）
    /// 2) 检查 deadline、白名单、nonce
    /// 3) EIP-712 验签
    /// 4) 可选owner -> TBA（pullAmount）
    /// 5) 调用目标合约
    /// 6) 依据 owner 余额变化记账并校验预算上限
    function executeWithSession(SessionCallRequest calldata req, bytes calldata signature)
        external
        payable
        nonReentrant
        returns (bytes memory result)
    {
        Session storage s = sessions[req.sessionId];
        if (s.budgetToken == address(0)) revert SessionNotFound(req.sessionId);
        if (s.signer == address(0)) revert SessionNotActivated(req.sessionId);
        if (s.revoked) revert SessionIsRevoked(req.sessionId);
        if (block.timestamp > s.validUntil) revert SessionExpired(req.sessionId);
        if (block.timestamp > req.deadline) revert SignatureExpired(req.deadline);
        if (!sessionTargetAllowed[req.sessionId][req.to]) revert TargetNotAllowed(req.sessionId, req.to);
        if (usedSessionNonce[req.sessionId][req.nonce]) revert NonceAlreadyUsed(req.sessionId, req.nonce);

        // 签名覆盖 to/value/dataHash/nonce/deadline/pullAmount，防止请求内容被篡改。
        bytes32 structHash = _sessionCallStructHash(
            req.sessionId, req.to, req.value, keccak256(req.data), req.nonce, req.deadline, req.pullAmount
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = ECDSA.recover(digest, signature);
        if (recovered != s.signer) revert InvalidSigner(recovered);

        usedSessionNonce[req.sessionId][req.nonce] = true;

        address accountOwner = owner();
        uint256 beforeBal = IERC20(s.budgetToken).balanceOf(accountOwner);
        if (req.pullAmount > 0) {
            // 关键：消费资金来自 owner，TBA 只作为执行中转账户。
            IERC20(s.budgetToken).safeTransferFrom(accountOwner, address(this), req.pullAmount);
        }

        unchecked {
            ++state;
        }

        (bool success, bytes memory ret) = req.to.call{value: req.value}(req.data);
        if (!success) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }

        // 预算采用 owner 余额前后差值，确保和owner出资语义一致。
        uint256 afterBal = IERC20(s.budgetToken).balanceOf(accountOwner);
        uint256 spend = beforeBal > afterBal ? beforeBal - afterBal : 0;
        //如果超预算就revert，避免先执行后发现超预算的尴尬情况。
        uint256 totalSpent = s.spent + spend;
        if (totalSpent > s.maxTotal) revert BudgetExceeded(req.sessionId, totalSpent, s.maxTotal);
        s.spent = totalSpent;

        emit SessionExecuted(req.sessionId, req.nonce, spend, totalSpent);
        return ret;
    }

    /// @inheritdoc IERC6551Account
    /// @dev 从账户运行时代码尾部读取 (chainId, tokenContract, tokenId)。
    ///ERC-6551 reference。
    function token() public view returns (uint256, address, uint256) {
        bytes memory footer = new bytes(0x60);
        assembly {
            extcodecopy(address(), add(footer, 0x20), 0x4d, 0x60)
        }
        return abi.decode(footer, (uint256, address, uint256));
    }

    /// @notice TBA 的 owner 由绑定 NFT 的 ownerOf(tokenId) 动态决定。
    /// @dev NFT 转移后，TBA 控制权会自动跟着转移。
    function owner() public view returns (address) {
        (uint256 chainId, address tokenContract, uint256 tokenId) = token();
        if (chainId != block.chainid) return address(0);
        return IERC721OwnerOf(tokenContract).ownerOf(tokenId);
    }

    /// @inheritdoc IERC6551Account
    function isValidSigner(address signer, bytes calldata) external view returns (bytes4 magicValue) {
        if (_isValidSigner(signer)) return IERC6551Account.isValidSigner.selector;
        return bytes4(0);
    }

    /// @inheritdoc IERC1271
    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4 magicValue) {
        bool ok = SignatureChecker.isValidSignatureNow(owner(), hash, signature);
        if (ok) return IERC1271.isValidSignature.selector;
        return bytes4(0);
    }

    /// @notice 声明接口支持：IERC165 / IERC6551Account / IERC6551Executable
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC165).interfaceId || interfaceId == type(IERC6551Account).interfaceId
            || interfaceId == type(IERC6551Executable).interfaceId;
    }

    function _isValidSigner(address signer) internal view returns (bool) {
        return signer == owner();
    }

    function _onlyTokenOwner() internal view {
        if (msg.sender != owner()) revert NotTokenOwner(msg.sender);
    }

    /// @dev 组装 SessionCall 的 structHash（等价于 keccak256(abi.encode(...))）。
    /// 使用 assembly 是为了减少 gas 和避免多余内存分配。
    function _sessionCallStructHash(
        bytes32 sessionId,
        address to,
        uint256 value,
        bytes32 dataHash,
        uint256 nonce,
        uint256 deadline,
        uint256 pullAmount
    ) internal pure returns (bytes32 result) {
        bytes32 typeHash = SESSION_CALL_TYPEHASH;
        //等价于 keccak256(abi.encode(typeHash, sessionId, to, value, dataHash, nonce, deadline, pullAmount))
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, typeHash)
            mstore(add(ptr, 0x20), sessionId)
            mstore(add(ptr, 0x40), and(to, 0xffffffffffffffffffffffffffffffffffffffff))
            mstore(add(ptr, 0x60), value)
            mstore(add(ptr, 0x80), dataHash)
            mstore(add(ptr, 0xa0), nonce)
            mstore(add(ptr, 0xc0), deadline)
            mstore(add(ptr, 0xe0), pullAmount)
            result := keccak256(ptr, 0x100)
        }
    }
}
