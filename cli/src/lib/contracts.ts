import {parseAbi} from 'viem'

export const ERC6551_REGISTRY_ABI = parseAbi([
  'function createAccount(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId) returns (address)',
  'function account(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId) view returns (address)',
])

export const ERC721_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
])

export const ERC20_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function transfer(address to, uint256 amount) returns (bool)',
])

export const AGENT6551_ABI = parseAbi([
  'error InvalidSigner(address signer)',
  'error InvalidOperation(uint8 operation)',
  'error NotTokenOwner(address caller)',
  'error PolicyNotConfigured()',
  'error PolicyNotActive()',
  'error PolicyExpired(uint64 validUntil)',
  'error SignatureExpired(uint256 deadline)',
  'error NonceAlreadyUsed(uint256 nonce)',
  'error TargetNotAllowed(address target)',
  'error BudgetExceeded(uint256 attempted, uint256 maxAllowed)',
  'error PolicyMaxTotalBelowSpent(uint256 spent, uint256 maxTotal)',
  'error InvalidPolicySigner(address signer)',
  'error InvalidPolicyBudgetToken()',
  'error InvalidPolicyValidUntil(uint64 validUntil)',
  'error InvalidPolicyMaxTotal(uint256 maxTotal)',
  'error InvalidPolicyTargets()',
  'error InvalidPolicyTarget(address target)',
  'function configurePolicy(address signer, uint64 validUntil, address budgetToken, uint256 maxTotal, address[] targets, bool active)',
  'function updatePolicy(uint64 validUntil, uint256 maxTotal, address[] targets, bool active)',
  'function rotatePolicySigner(address newSigner)',
  'function revokePolicy()',
  'function policy() view returns (address signer, uint64 validUntil, uint256 maxTotal, uint256 spent, address budgetToken, bool active)',
  'function policyTargetCount() view returns (uint256)',
  'function getPolicyTargets() view returns (address[] targets)',
  'function executeWithPolicy((address to,uint256 value,bytes data,uint256 nonce,uint256 deadline,uint256 pullAmount) req, bytes signature) payable returns (bytes)',
  'function execute(address to, uint256 value, bytes data, uint8 operation) payable returns (bytes)',
  'function owner() view returns (address)',
])

export const POLICY_CONFIGURED_EVENT = parseAbi([
  'event PolicyConfigured(address indexed signer, uint64 validUntil, address budgetToken, uint256 maxTotal, bool active)',
])[0]

export const POLICY_UPDATED_EVENT = parseAbi([
  'event PolicyUpdated(address indexed signer, uint64 validUntil, address budgetToken, uint256 maxTotal, bool active)',
])[0]

export const POLICY_EXECUTED_EVENT = parseAbi([
  'event PolicyExecuted(uint256 indexed nonce, uint256 spend, uint256 totalSpent)',
])[0]

export const POLICY_REVOKED_EVENT = parseAbi(['event PolicyRevoked()'])[0]
