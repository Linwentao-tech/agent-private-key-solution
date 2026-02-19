// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal ERC-4337 account used for CLI integration testing on Sepolia.
/// @dev Supports:
/// - validateUserOp(PackedUserOperation,bytes32,uint256)
/// - execute(address,uint256,bytes)
contract Minimal4337Account {
    struct PackedUserOperation {
        address sender;
        uint256 nonce;
        bytes initCode;
        bytes callData;
        bytes32 accountGasLimits;
        uint256 preVerificationGas;
        bytes32 gasFees;
        bytes paymasterAndData;
        bytes signature;
    }

    error NotAuthorized(address caller);
    error CallFailed(bytes data);

    address public immutable entryPoint;
    address public immutable owner;

    constructor(address entryPoint_, address owner_) {
        require(entryPoint_ != address(0), "entryPoint=0");
        require(owner_ != address(0), "owner=0");
        entryPoint = entryPoint_;
        owner = owner_;
    }

    receive() external payable {}

    function execute(address dest, uint256 value, bytes calldata func) external {
        if (msg.sender != owner && msg.sender != entryPoint) {
            revert NotAuthorized(msg.sender);
        }

        (bool ok, bytes memory data) = dest.call{value: value}(func);
        if (!ok) revert CallFailed(data);
    }

    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external returns (uint256 validationData) {
        if (msg.sender != entryPoint) {
            revert NotAuthorized(msg.sender);
        }

        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", userOpHash));
        address signer = _recover(digest, userOp.signature);
        if (signer != owner) {
            // Compatibility fallback: accept direct hash signatures too.
            signer = _recover(userOpHash, userOp.signature);
        }
        validationData = signer == owner ? 0 : 1; // SIG_VALIDATION_FAILED

        if (missingAccountFunds > 0) {
            (bool sent,) = payable(msg.sender).call{value: missingAccountFunds}("");
            sent;
        }

        return validationData;
    }

    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address signer) {
        if (signature.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        signer = ecrecover(digest, v, r, s);
    }
}
