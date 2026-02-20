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

/**
 * @title IERC721OwnerOf
 * @notice Minimal interface for ERC-721 ownerOf function
 */
interface IERC721OwnerOf {
    function ownerOf(uint256 tokenId) external view returns (address owner);
}

/**
 * @title Agent6551Account
 * @notice ERC-6551 Token Bound Account with Agent Policy authorization
 * @dev
 *   This contract implements a Token Bound Account (TBA) that can be controlled by:
 *   1. The NFT owner (full control)
 *   2. An authorized Agent (limited control via Policy)
 *
 *   Architecture:
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │                     NFT Owner                               │
 *   │                   (Full Control)                            │
 *   │        configurePolicy / updatePolicy / execute             │
 *   └─────────────────────────┬───────────────────────────────────┘
 *                             │ authorizes
 *                             ▼
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │                     Policy                                  │
 *   │   - signer: Agent address who can execute                   │
 *   │   - validUntil: Expiration timestamp                        │
 *   │   - maxTotal: Maximum budget in token units                 │
 *   │   - spent: Accumulated spending                             │
 *   │   - budgetToken: Token used for budget tracking             │
 *   │   - active: Whether policy is enabled                       │
 *   │   - targets[]: Whitelisted contract addresses               │
 *   └─────────────────────────┬───────────────────────────────────┘
 *                             │ restricts
 *                             ▼
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │                     Agent                                   │
 *   │               (Limited Control)                             │
 *   │              executeWithPolicy                              │
 *   │   - Must be policy.signer                                   │
 *   │   - Can only call whitelisted targets                       │
 *   │   - Spending limited by maxTotal                            │
 *   │   - Cannot exceed validUntil                                │
 *   └─────────────────────────────────────────────────────────────┘
 */
contract Agent6551Account is IERC165, IERC1271, IERC6551Account, IERC6551Executable, EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Errors ============

    /// @dev Invalid signer for operation
    error InvalidSigner(address signer);

    /// @dev Invalid operation type (only CALL=0 supported)
    error InvalidOperation(uint8 operation);

    /// @dev Caller is not the NFT owner
    error NotTokenOwner(address caller);

    /// @dev Policy has not been configured
    error PolicyNotConfigured();

    /// @dev Policy is not active
    error PolicyNotActive();

    /// @dev Policy has expired
    error PolicyExpired(uint64 validUntil);

    /// @dev Signature deadline has passed
    error SignatureExpired(uint256 deadline);

    /// @dev Nonce already used (replay protection)
    error NonceAlreadyUsed(uint256 nonce);

    /// @dev Target address not in whitelist
    error TargetNotAllowed(address target);

    /// @dev Spending would exceed budget
    error BudgetExceeded(uint256 attempted, uint256 maxAllowed);

    /// @dev New maxTotal is below already spent amount
    error PolicyMaxTotalBelowSpent(uint256 spent, uint256 maxTotal);

    /// @dev Invalid policy signer (zero address)
    error InvalidPolicySigner(address signer);

    /// @dev Invalid budget token (zero address)
    error InvalidPolicyBudgetToken();

    /// @dev Invalid validUntil (must be future)
    error InvalidPolicyValidUntil(uint64 validUntil);

    /// @dev Invalid maxTotal (must be > 0)
    error InvalidPolicyMaxTotal(uint256 maxTotal);

    /// @dev Empty targets array
    error InvalidPolicyTargets();

    /// @dev Invalid target address (zero address)
    error InvalidPolicyTarget(address target);

    // ============ Constants ============

    /**
     * @dev EIP-712 typehash for PolicyCall struct
     * Used for typed data signing by the Agent
     */
    bytes32 public constant POLICY_CALL_TYPEHASH = keccak256(
        "PolicyCall(address to,uint256 value,bytes32 dataHash,uint256 nonce,uint256 deadline,uint256 pullAmount)"
    );

    // ============ Structs ============

    /**
     * @notice Policy configuration for Agent authorization
     * @param signer        Agent address authorized to execute via policy
     * @param validUntil    Timestamp when policy expires
     * @param maxTotal      Maximum total spending allowed (in token units)
     * @param spent         Accumulated spending so far
     * @param budgetToken   Token address used for budget tracking
     * @param active        Whether policy is currently enabled
     */
    struct Policy {
        address signer;
        uint64 validUntil;
        uint256 maxTotal;
        uint256 spent;
        address budgetToken;
        bool active;
    }

    /**
     * @notice Request structure for policy-gated execution
     * @param to            Target contract address
     * @param value         ETH value to send
     * @param data          Calldata to execute
     * @param nonce         Unique nonce for replay protection
     * @param deadline      Signature expiration timestamp
     * @param pullAmount    Amount of budgetToken to pull from owner
     */
    struct PolicyCallRequest {
        address to;
        uint256 value;
        bytes data;
        uint256 nonce;
        uint256 deadline;
        uint256 pullAmount;
    }

    // ============ State Variables ============

    /// @dev State counter for tracking account mutations
    uint256 public state;

    /// @dev Single policy configuration (replaces session model)
    Policy public policy;

    /// @dev Mapping of whitelisted target addresses
    mapping(address => bool) public policyTargetAllowed;

    /// @dev Mapping of used nonces for replay protection
    mapping(uint256 => bool) public usedPolicyNonce;

    /// @dev Array of policy targets for enumeration
    address[] private _policyTargets;

    /// @dev Mapping to track indexed targets
    mapping(address => bool) private _policyTargetIndexed;

    // ============ Events ============

    /**
     * @notice Emitted when policy is configured
     * @param signer        Agent address
     * @param validUntil    Expiration timestamp
     * @param budgetToken   Token for budget tracking
     * @param maxTotal      Maximum spending
     * @param active        Whether enabled
     */
    event PolicyConfigured(
        address indexed signer, uint64 validUntil, address budgetToken, uint256 maxTotal, bool active
    );

    /**
     * @notice Emitted when policy is updated
     */
    event PolicyUpdated(address indexed signer, uint64 validUntil, address budgetToken, uint256 maxTotal, bool active);

    /**
     * @notice Emitted when policy signer is rotated
     * @param previousSigner    Old agent address
     * @param newSigner         New agent address
     */
    event PolicySignerRotated(address indexed previousSigner, address indexed newSigner);

    /**
     * @notice Emitted when policy is revoked
     */
    event PolicyRevoked();

    /**
     * @notice Emitted when policy execution occurs
     * @param nonce         Unique identifier for this execution
     * @param spend         Amount spent in this execution
     * @param totalSpent    Total accumulated spending
     */
    event PolicyExecuted(uint256 indexed nonce, uint256 spend, uint256 totalSpent);

    // ============ Constructor ============

    /**
     * @notice Initialize EIP-712 domain separator
     */
    constructor() EIP712("Agent6551Account", "1") {}

    // ============ Receive ============

    /// @dev Receive ETH
    receive() external payable {}

    // ============ Modifiers ============

    /// @dev Restricts access to NFT owner only
    modifier onlyTokenOwner() {
        _onlyTokenOwner();
        _;
    }

    // ============ Policy Management (Owner Only) ============

    /**
     * @notice Configure a new policy for Agent authorization
     * @dev Only callable by NFT owner. Replaces any existing policy.
     * @param signer         Agent address to authorize
     * @param validUntil     Expiration timestamp (must be future)
     * @param budgetToken    Token for budget tracking
     * @param maxTotal       Maximum spending allowed
     * @param targets        Whitelisted contract addresses
     * @param active         Whether to enable immediately
     */
    function configurePolicy(
        address signer,
        uint64 validUntil,
        address budgetToken,
        uint256 maxTotal,
        address[] calldata targets,
        bool active
    ) external onlyTokenOwner {
        if (signer == address(0)) revert InvalidPolicySigner(signer);
        if (budgetToken == address(0)) revert InvalidPolicyBudgetToken();
        if (validUntil <= block.timestamp) revert InvalidPolicyValidUntil(validUntil);
        if (maxTotal == 0) revert InvalidPolicyMaxTotal(maxTotal);

        _replacePolicyTargets(targets);

        policy.signer = signer;
        policy.validUntil = validUntil;
        policy.maxTotal = maxTotal;
        policy.spent = 0;
        policy.budgetToken = budgetToken;
        policy.active = active;

        emit PolicyConfigured(signer, validUntil, budgetToken, maxTotal, active);
    }

    /**
     * @notice Update existing policy parameters
     * @dev Only callable by NFT owner. Cannot set maxTotal below spent.
     * @param validUntil    New expiration timestamp
     * @param maxTotal      New maximum spending
     * @param targets       New whitelisted addresses
     * @param active        Enable/disable policy
     */
    function updatePolicy(uint64 validUntil, uint256 maxTotal, address[] calldata targets, bool active)
        external
        onlyTokenOwner
    {
        Policy storage p = policy;
        if (p.budgetToken == address(0)) revert PolicyNotConfigured();
        if (validUntil <= block.timestamp) revert InvalidPolicyValidUntil(validUntil);
        if (maxTotal == 0) revert InvalidPolicyMaxTotal(maxTotal);
        if (maxTotal < p.spent) revert PolicyMaxTotalBelowSpent(p.spent, maxTotal);

        _replacePolicyTargets(targets);

        p.validUntil = validUntil;
        p.maxTotal = maxTotal;
        p.active = active;

        emit PolicyUpdated(p.signer, validUntil, p.budgetToken, maxTotal, active);
    }

    /**
     * @notice Rotate the policy signer to a new Agent
     * @dev Only callable by NFT owner. Useful for key rotation.
     * @param newSigner    New Agent address
     */
    function rotatePolicySigner(address newSigner) external onlyTokenOwner {
        Policy storage p = policy;
        if (p.budgetToken == address(0)) revert PolicyNotConfigured();
        if (newSigner == address(0)) revert InvalidPolicySigner(newSigner);

        address previousSigner = p.signer;
        p.signer = newSigner;

        emit PolicySignerRotated(previousSigner, newSigner);
    }

    /**
     * @notice Revoke the policy (disable Agent access)
     * @dev Only callable by NFT owner. Sets active=false.
     */
    function revokePolicy() external onlyTokenOwner {
        Policy storage p = policy;
        if (p.budgetToken == address(0)) revert PolicyNotConfigured();
        p.active = false;
        emit PolicyRevoked();
    }

    // ============ Policy View Functions ============

    /**
     * @notice Get count of whitelisted targets
     * @return Number of targets in the whitelist
     */
    function policyTargetCount() external view returns (uint256) {
        return _policyTargets.length;
    }

    /**
     * @notice Get all whitelisted target addresses
     * @return targets    Array of whitelisted addresses
     */
    function getPolicyTargets() external view returns (address[] memory targets) {
        uint256 len = _policyTargets.length;
        targets = new address[](len);
        for (uint256 i = 0; i < len; ++i) {
            targets[i] = _policyTargets[i];
        }
    }

    // ============ Execution (Owner) ============

    /**
     * @notice Execute a call directly as the NFT owner
     * @dev Only callable by NFT owner. Full control, no restrictions.
     * @param to           Target contract address
     * @param value        ETH value to send
     * @param data         Calldata to execute
     * @param operation    Operation type (only CALL=0 supported)
     * @return result      Return data from the call
     */
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

    // ============ Execution (Agent via Policy) ============

    /**
     * @notice Execute a call as an authorized Agent via Policy
     * @dev Callable by anyone with valid signature from policy.signer
     *      Subject to policy restrictions:
     *      - Policy must be configured and active
     *      - Current time must be before validUntil
     *      - Target must be in whitelist
     *      - Total spending must not exceed maxTotal
     *      - Signature must be valid and not expired
     *
     * @param req          Execution request parameters
     * @param signature    EIP-712 signature from policy.signer
     * @return result      Return data from the call
     */
    function executeWithPolicy(PolicyCallRequest calldata req, bytes calldata signature)
        external
        payable
        nonReentrant
        returns (bytes memory result)
    {
        Policy storage p = policy;

        // === Policy State Checks ===
        if (p.budgetToken == address(0)) revert PolicyNotConfigured();
        if (!p.active) revert PolicyNotActive();
        if (block.timestamp > p.validUntil) revert PolicyExpired(p.validUntil);

        // === Request Validity Checks ===
        if (block.timestamp > req.deadline) revert SignatureExpired(req.deadline);
        if (!policyTargetAllowed[req.to]) revert TargetNotAllowed(req.to);
        if (usedPolicyNonce[req.nonce]) revert NonceAlreadyUsed(req.nonce);

        // === Signature Verification ===
        bytes32 structHash =
            _policyCallStructHash(req.to, req.value, keccak256(req.data), req.nonce, req.deadline, req.pullAmount);
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = ECDSA.recover(digest, signature);
        if (recovered != p.signer) revert InvalidSigner(recovered);

        // === Mark Nonce Used ===
        usedPolicyNonce[req.nonce] = true;

        // === Pull Tokens from Owner (if needed) ===
        address accountOwner = owner();
        uint256 beforeBal = IERC20(p.budgetToken).balanceOf(accountOwner);
        if (req.pullAmount > 0) {
            IERC20(p.budgetToken).safeTransferFrom(accountOwner, address(this), req.pullAmount);
        }

        // === Execute Call ===
        unchecked {
            ++state;
        }

        (bool success, bytes memory ret) = req.to.call{value: req.value}(req.data);
        if (!success) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }

        // === Budget Tracking ===
        uint256 afterBal = IERC20(p.budgetToken).balanceOf(accountOwner);
        uint256 spend = beforeBal > afterBal ? beforeBal - afterBal : 0;
        uint256 totalSpent = p.spent + spend;
        if (totalSpent > p.maxTotal) revert BudgetExceeded(totalSpent, p.maxTotal);
        p.spent = totalSpent;

        emit PolicyExecuted(req.nonce, spend, totalSpent);
        return ret;
    }

    // ============ ERC-6551 Account Interface ============

    /**
     * @notice Get the bound NFT information
     * @return chainId        Chain ID where NFT exists
     * @return tokenContract  NFT contract address
     * @return tokenId        NFT token ID
     */
    function token() public view returns (uint256, address, uint256) {
        bytes memory footer = new bytes(0x60);
        assembly {
            extcodecopy(address(), add(footer, 0x20), 0x4d, 0x60)
        }
        return abi.decode(footer, (uint256, address, uint256));
    }

    /**
     * @notice Get the current owner of this TBA
     * @dev Returns the owner of the bound NFT
     * @return NFT owner address, or zero if wrong chain
     */
    function owner() public view returns (address) {
        (uint256 chainId, address tokenContract, uint256 tokenId) = token();
        if (chainId != block.chainid) return address(0);
        return IERC721OwnerOf(tokenContract).ownerOf(tokenId);
    }

    /**
     * @notice Check if an address is a valid signer
     * @param signer      Address to check
     * @return magicValue IERC6551Account.isValidSigner selector if valid
     */
    function isValidSigner(address signer, bytes calldata) external view returns (bytes4 magicValue) {
        if (_isValidSigner(signer)) return IERC6551Account.isValidSigner.selector;
        return bytes4(0);
    }

    /**
     * @notice Validate an ERC-1271 signature
     * @param hash        Message hash
     * @param signature   Signature bytes
     * @return magicValue IERC1271.isValidSignature selector if valid
     */
    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4 magicValue) {
        bool ok = SignatureChecker.isValidSignatureNow(owner(), hash, signature);
        if (ok) return IERC1271.isValidSignature.selector;
        return bytes4(0);
    }

    /**
     * @notice Check interface support
     * @param interfaceId    Interface identifier
     * @return Whether interface is supported
     */
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC165).interfaceId || interfaceId == type(IERC6551Account).interfaceId
            || interfaceId == type(IERC6551Executable).interfaceId;
    }

    // ============ Internal Functions ============

    /**
     * @dev Check if signer is the NFT owner
     */
    function _isValidSigner(address signer) internal view returns (bool) {
        return signer == owner();
    }

    /**
     * @dev Revert if caller is not NFT owner
     */
    function _onlyTokenOwner() internal view {
        if (msg.sender != owner()) revert NotTokenOwner(msg.sender);
    }

    /**
     * @dev Replace all policy targets with new list
     * @param targets    New target addresses to whitelist
     */
    function _replacePolicyTargets(address[] calldata targets) internal {
        if (targets.length == 0) revert InvalidPolicyTargets();

        // Clear old targets
        uint256 oldLen = _policyTargets.length;
        for (uint256 i = 0; i < oldLen; ++i) {
            address oldTarget = _policyTargets[i];
            policyTargetAllowed[oldTarget] = false;
            _policyTargetIndexed[oldTarget] = false;
        }
        delete _policyTargets;

        // Add new targets
        uint256 len = targets.length;
        for (uint256 i = 0; i < len; ++i) {
            address target = targets[i];
            if (target == address(0)) revert InvalidPolicyTarget(target);
            if (_policyTargetIndexed[target]) continue;
            _policyTargetIndexed[target] = true;
            policyTargetAllowed[target] = true;
            _policyTargets.push(target);
        }

        if (_policyTargets.length == 0) revert InvalidPolicyTargets();
    }

    /**
     * @dev Compute EIP-712 struct hash for PolicyCall
     */
    function _policyCallStructHash(
        address to,
        uint256 value,
        bytes32 dataHash,
        uint256 nonce,
        uint256 deadline,
        uint256 pullAmount
    ) internal pure returns (bytes32 result) {
        bytes32 typeHash = POLICY_CALL_TYPEHASH;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, typeHash)
            mstore(add(ptr, 0x20), and(to, 0xffffffffffffffffffffffffffffffffffffffff))
            mstore(add(ptr, 0x40), value)
            mstore(add(ptr, 0x60), dataHash)
            mstore(add(ptr, 0x80), nonce)
            mstore(add(ptr, 0xa0), deadline)
            mstore(add(ptr, 0xc0), pullAmount)
            result := keccak256(ptr, 0xe0)
        }
    }
}
