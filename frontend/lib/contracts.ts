import { Abi, parseAbi } from "viem";

export const ERC6551_REGISTRY_ABI = parseAbi([
  "function createAccount(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId) returns (address)",
  "function account(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId) view returns (address)",
]) as Abi;

export const ERC721_ABI = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]) as Abi;

export const ERC20_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]) as Abi;

// Local demo token contract (MockERC20.sol). Not a real USDT.
// Some variants expose mint() while others expose _mint(); support both.
export const MOCK_ERC20_ABI = parseAbi([
  "function mint(address to, uint256 amount)",
  "function _mint(address to, uint256 amount)",
]) as Abi;

export const AGENT6551_ABI = parseAbi([
  "function createSession(bytes32 sessionId, uint64 validUntil, address budgetToken, uint256 maxTotal, address[] targets)",
  "function activateSession(bytes32 sessionId)",
  "function activateSessionBySig(bytes32 sessionId, address signer, uint256 deadline, bytes signature)",
  "function revokeSession(bytes32 sessionId)",
  "function execute(address to, uint256 value, bytes data, uint8 operation) payable returns (bytes)",
  "function executeWithSession((bytes32 sessionId,address to,uint256 value,bytes data,uint256 nonce,uint256 deadline,uint256 pullAmount) req, bytes signature) payable returns (bytes)",
  "function sessionCount() view returns (uint256)",
  "function getSessionIds(uint256 offset, uint256 limit) view returns (bytes32[] ids)",
  "function getActiveSessionIds(uint256 offset, uint256 limit) view returns (bytes32[] ids)",
  "function sessions(bytes32 sessionId) view returns (address signer, uint64 validUntil, uint256 maxTotal, uint256 spent, address budgetToken, bool revoked)",
  "event SessionCreated(bytes32 indexed sessionId, address indexed signer, uint64 validUntil, address budgetToken, uint256 maxTotal)",
  "event SessionActivated(bytes32 indexed sessionId, address indexed signer)",
  "event SessionRevoked(bytes32 indexed sessionId)",
  "event SessionExecuted(bytes32 indexed sessionId, uint256 indexed nonce, uint256 spend, uint256 totalSpent)",
]) as Abi;
