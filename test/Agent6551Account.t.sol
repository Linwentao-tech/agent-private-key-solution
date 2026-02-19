// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {ERC6551Registry} from "erc6551/ERC6551Registry.sol";

import {Agent6551Account} from "../src/core/Agent6551Account.sol";
import {MockCharacterNFT} from "../src/mocks/MockCharacterNFT.sol";
import {MockShop} from "../src/mocks/MockShop.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

contract Agent6551AccountTest is Test {
    bytes32 internal constant POLICY_CALL_TYPEHASH = keccak256(
        "PolicyCall(address to,uint256 value,bytes32 dataHash,uint256 nonce,uint256 deadline,uint256 pullAmount)"
    );
    bytes32 internal constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    uint256 internal constant POLICY_SIGNER_PK = 0xA11CE;
    uint256 internal constant NEW_POLICY_SIGNER_PK = 0xC0FFEE;
    uint256 internal constant OWNER_PK = 0xB0B;

    ERC6551Registry internal registry;
    Agent6551Account internal implementation;
    MockCharacterNFT internal nft;
    MockERC20 internal token;
    MockShop internal shop;

    address internal tba;
    address internal nftOwner;
    address internal policySigner;

    function setUp() public {
        registry = new ERC6551Registry();
        implementation = new Agent6551Account();
        nft = new MockCharacterNFT("Character", "CHAR");
        token = new MockERC20("Mock USDT", "USDT", 6);
        shop = new MockShop(token);

        nftOwner = vm.addr(OWNER_PK);
        uint256 tokenId = nft.mint(nftOwner);

        tba = registry.createAccount(address(implementation), bytes32(0), block.chainid, address(nft), tokenId);

        token.mint(nftOwner, 200e6);

        vm.prank(nftOwner);
        token.approve(tba, type(uint256).max);

        vm.prank(nftOwner);
        Agent6551Account(payable(tba))
            .execute(address(token), 0, abi.encodeCall(token.approve, (address(shop), type(uint256).max)), 0);

        policySigner = vm.addr(POLICY_SIGNER_PK);

        address[] memory targets = new address[](1);
        targets[0] = address(shop);

        vm.prank(nftOwner);
        Agent6551Account(payable(tba))
            .configurePolicy(policySigner, uint64(block.timestamp + 1 days), address(token), 100e6, targets, true);
    }

    function testExecuteWithPolicySuccess() public {
        uint256 price = 1e6;

        Agent6551Account.PolicyCallRequest memory req = Agent6551Account.PolicyCallRequest({
            to: address(shop),
            value: 0,
            data: abi.encodeCall(shop.buy, (1, price)),
            nonce: 1,
            deadline: block.timestamp + 1 hours,
            pullAmount: price
        });

        bytes memory signature = _signRequest(req, POLICY_SIGNER_PK);

        Agent6551Account(payable(tba)).executeWithPolicy(req, signature);

        assertEq(token.balanceOf(address(shop)), price);
        (,,, uint256 spent,,) = Agent6551Account(payable(tba)).policy();
        assertEq(spent, price);
    }

    function testExecuteWithPolicyNonceReplayReverts() public {
        uint256 price = 1e6;

        Agent6551Account.PolicyCallRequest memory req = Agent6551Account.PolicyCallRequest({
            to: address(shop),
            value: 0,
            data: abi.encodeCall(shop.buy, (1, price)),
            nonce: 2,
            deadline: block.timestamp + 1 hours,
            pullAmount: price
        });

        bytes memory signature = _signRequest(req, POLICY_SIGNER_PK);
        Agent6551Account(payable(tba)).executeWithPolicy(req, signature);

        vm.expectRevert(abi.encodeWithSelector(Agent6551Account.NonceAlreadyUsed.selector, 2));
        Agent6551Account(payable(tba)).executeWithPolicy(req, signature);
    }

    function testExecuteWithPolicyExpiredReverts() public {
        uint256 price = 1e6;

        Agent6551Account.PolicyCallRequest memory req = Agent6551Account.PolicyCallRequest({
            to: address(shop),
            value: 0,
            data: abi.encodeCall(shop.buy, (1, price)),
            nonce: 3,
            deadline: block.timestamp + 2 days,
            pullAmount: price
        });

        vm.warp(block.timestamp + 1 days + 1);

        vm.expectRevert(abi.encodeWithSelector(Agent6551Account.PolicyExpired.selector, uint64(block.timestamp - 1)));
        Agent6551Account(payable(tba)).executeWithPolicy(req, _signRequest(req, POLICY_SIGNER_PK));
    }

    function testExecuteWithPolicyTargetNotAllowedReverts() public {
        Agent6551Account.PolicyCallRequest memory req = Agent6551Account.PolicyCallRequest({
            to: address(token),
            value: 0,
            data: abi.encodeCall(token.transfer, (address(0xBEEF), 1e6)),
            nonce: 4,
            deadline: block.timestamp + 1 hours,
            pullAmount: 0
        });

        bytes memory signature = _signRequest(req, POLICY_SIGNER_PK);

        vm.expectRevert(abi.encodeWithSelector(Agent6551Account.TargetNotAllowed.selector, address(token)));
        Agent6551Account(payable(tba)).executeWithPolicy(req, signature);
    }

    function testExecuteWithPolicyBudgetExceededReverts() public {
        uint256 price = 101e6;

        Agent6551Account.PolicyCallRequest memory req = Agent6551Account.PolicyCallRequest({
            to: address(shop),
            value: 0,
            data: abi.encodeCall(shop.buy, (1, price)),
            nonce: 5,
            deadline: block.timestamp + 1 hours,
            pullAmount: price
        });

        bytes memory signature = _signRequest(req, POLICY_SIGNER_PK);

        vm.expectRevert(abi.encodeWithSelector(Agent6551Account.BudgetExceeded.selector, 101e6, 100e6));
        Agent6551Account(payable(tba)).executeWithPolicy(req, signature);
    }

    function testConfigurePolicyOnlyOwner() public {
        address[] memory targets = new address[](1);
        targets[0] = address(shop);

        vm.expectRevert(abi.encodeWithSelector(Agent6551Account.NotTokenOwner.selector, address(this)));
        Agent6551Account(payable(tba))
            .configurePolicy(policySigner, uint64(block.timestamp + 1 days), address(token), 100e6, targets, true);
    }

    function testUpdatePolicyOnlyOwner() public {
        address[] memory targets = new address[](1);
        targets[0] = address(shop);

        vm.expectRevert(abi.encodeWithSelector(Agent6551Account.NotTokenOwner.selector, address(this)));
        Agent6551Account(payable(tba)).updatePolicy(uint64(block.timestamp + 2 days), 200e6, targets, true);
    }

    function testUpdatePolicyReplacesTargets() public {
        address[] memory targets = new address[](1);
        targets[0] = address(token);

        vm.prank(nftOwner);
        Agent6551Account(payable(tba)).updatePolicy(uint64(block.timestamp + 2 days), 120e6, targets, true);

        assertTrue(Agent6551Account(payable(tba)).policyTargetAllowed(address(token)));
        assertFalse(Agent6551Account(payable(tba)).policyTargetAllowed(address(shop)));

        Agent6551Account.PolicyCallRequest memory req = Agent6551Account.PolicyCallRequest({
            to: address(shop),
            value: 0,
            data: abi.encodeCall(shop.buy, (1, 1e6)),
            nonce: 6,
            deadline: block.timestamp + 1 hours,
            pullAmount: 1e6
        });

        vm.expectRevert(abi.encodeWithSelector(Agent6551Account.TargetNotAllowed.selector, address(shop)));
        Agent6551Account(payable(tba)).executeWithPolicy(req, _signRequest(req, POLICY_SIGNER_PK));
    }

    function testRotatePolicySigner() public {
        address newSigner = vm.addr(NEW_POLICY_SIGNER_PK);

        vm.prank(nftOwner);
        Agent6551Account(payable(tba)).rotatePolicySigner(newSigner);

        Agent6551Account.PolicyCallRequest memory req = Agent6551Account.PolicyCallRequest({
            to: address(shop),
            value: 0,
            data: abi.encodeCall(shop.buy, (1, 1e6)),
            nonce: 7,
            deadline: block.timestamp + 1 hours,
            pullAmount: 1e6
        });

        bytes memory oldSig = _signRequest(req, POLICY_SIGNER_PK);
        vm.expectRevert(abi.encodeWithSelector(Agent6551Account.InvalidSigner.selector, policySigner));
        Agent6551Account(payable(tba)).executeWithPolicy(req, oldSig);

        bytes memory newSig = _signRequest(req, NEW_POLICY_SIGNER_PK);
        Agent6551Account(payable(tba)).executeWithPolicy(req, newSig);

        assertEq(token.balanceOf(address(shop)), 1e6);
    }

    function testRevokePolicyDisablesExecution() public {
        vm.prank(nftOwner);
        Agent6551Account(payable(tba)).revokePolicy();

        Agent6551Account.PolicyCallRequest memory req = Agent6551Account.PolicyCallRequest({
            to: address(shop),
            value: 0,
            data: abi.encodeCall(shop.buy, (1, 1e6)),
            nonce: 8,
            deadline: block.timestamp + 1 hours,
            pullAmount: 1e6
        });

        vm.expectRevert(Agent6551Account.PolicyNotActive.selector);
        Agent6551Account(payable(tba)).executeWithPolicy(req, _signRequest(req, POLICY_SIGNER_PK));
    }

    function testUpdatePolicyBelowSpentReverts() public {
        Agent6551Account.PolicyCallRequest memory req = Agent6551Account.PolicyCallRequest({
            to: address(shop),
            value: 0,
            data: abi.encodeCall(shop.buy, (1, 2e6)),
            nonce: 9,
            deadline: block.timestamp + 1 hours,
            pullAmount: 2e6
        });

        Agent6551Account(payable(tba)).executeWithPolicy(req, _signRequest(req, POLICY_SIGNER_PK));

        address[] memory targets = new address[](1);
        targets[0] = address(shop);

        vm.prank(nftOwner);
        vm.expectRevert(abi.encodeWithSelector(Agent6551Account.PolicyMaxTotalBelowSpent.selector, 2e6, 1e6));
        Agent6551Account(payable(tba)).updatePolicy(uint64(block.timestamp + 2 days), 1e6, targets, true);
    }

    function _signRequest(Agent6551Account.PolicyCallRequest memory req, uint256 pk)
        internal
        view
        returns (bytes memory signature)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                POLICY_CALL_TYPEHASH, req.to, req.value, keccak256(req.data), req.nonce, req.deadline, req.pullAmount
            )
        );

        bytes32 domainSeparator = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH, keccak256(bytes("Agent6551Account")), keccak256(bytes("1")), block.chainid, tba
            )
        );

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        signature = abi.encodePacked(r, s, v);
    }
}
