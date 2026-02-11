// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {ERC6551Registry} from "erc6551/ERC6551Registry.sol";

import {Agent6551Account} from "../src/core/Agent6551Account.sol";
import {MockCharacterNFT} from "../src/mocks/MockCharacterNFT.sol";
import {MockShop} from "../src/mocks/MockShop.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

contract Agent6551AccountTest is Test {
    bytes32 internal constant SESSION_CALL_TYPEHASH = keccak256(
        "SessionCall(bytes32 sessionId,address to,uint256 value,bytes32 dataHash,uint256 nonce,uint256 deadline,uint256 pullAmount)"
    );
    bytes32 internal constant SESSION_ACTIVATION_TYPEHASH =
        keccak256("SessionActivation(bytes32 sessionId,address signer,uint256 deadline)");
    bytes32 internal constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    uint256 internal constant SESSION_PK = 0xA11CE;
    uint256 internal constant OWNER_PK = 0xB0B;

    ERC6551Registry internal registry;
    Agent6551Account internal implementation;
    MockCharacterNFT internal nft;
    MockERC20 internal token;
    MockShop internal shop;

    address internal tba;
    address internal nftOwner;
    address internal sessionSigner;
    bytes32 internal sessionId;

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

        sessionSigner = vm.addr(SESSION_PK);
        sessionId = keccak256("session-1");

        address[] memory targets = new address[](1);
        targets[0] = address(shop);

        vm.prank(nftOwner);
        Agent6551Account(payable(tba))
            .createSession(sessionId, uint64(block.timestamp + 1 days), address(token), 100e6, targets);

        vm.prank(sessionSigner);
        Agent6551Account(payable(tba)).activateSession(sessionId);
    }

    function testExecuteWithSessionSuccess() public {
        uint256 price = 1e6;

        Agent6551Account.SessionCallRequest memory req = Agent6551Account.SessionCallRequest({
            sessionId: sessionId,
            to: address(shop),
            value: 0,
            data: abi.encodeCall(shop.buy, (1, price)),
            nonce: 1,
            deadline: block.timestamp + 1 hours,
            pullAmount: price
        });

        bytes memory signature = _signRequest(req);

        Agent6551Account(payable(tba)).executeWithSession(req, signature);

        assertEq(token.balanceOf(address(shop)), price);
        (,,, uint256 spent,,) = Agent6551Account(payable(tba)).sessions(sessionId);
        assertEq(spent, price);
    }

    function testExecuteWithSessionNonceReplayReverts() public {
        uint256 price = 1e6;

        Agent6551Account.SessionCallRequest memory req = Agent6551Account.SessionCallRequest({
            sessionId: sessionId,
            to: address(shop),
            value: 0,
            data: abi.encodeCall(shop.buy, (1, price)),
            nonce: 2,
            deadline: block.timestamp + 1 hours,
            pullAmount: price
        });

        bytes memory signature = _signRequest(req);
        Agent6551Account(payable(tba)).executeWithSession(req, signature);

        vm.expectRevert(abi.encodeWithSelector(Agent6551Account.NonceAlreadyUsed.selector, sessionId, 2));
        Agent6551Account(payable(tba)).executeWithSession(req, signature);
    }

    function testExecuteWithSessionExpiredReverts() public {
        uint256 price = 1e6;

        Agent6551Account.SessionCallRequest memory req = Agent6551Account.SessionCallRequest({
            sessionId: sessionId,
            to: address(shop),
            value: 0,
            data: abi.encodeCall(shop.buy, (1, price)),
            nonce: 3,
            deadline: block.timestamp + 2 days,
            pullAmount: price
        });

        vm.warp(block.timestamp + 1 days + 1);

        bytes memory signature = _signRequest(req);

        vm.expectRevert(abi.encodeWithSelector(Agent6551Account.SessionExpired.selector, sessionId));
        Agent6551Account(payable(tba)).executeWithSession(req, signature);
    }

    function testExecuteWithSessionTargetNotAllowedReverts() public {
        Agent6551Account.SessionCallRequest memory req = Agent6551Account.SessionCallRequest({
            sessionId: sessionId,
            to: address(token),
            value: 0,
            data: abi.encodeCall(token.transfer, (address(0xBEEF), 1e6)),
            nonce: 4,
            deadline: block.timestamp + 1 hours,
            pullAmount: 0
        });

        bytes memory signature = _signRequest(req);

        vm.expectRevert(abi.encodeWithSelector(Agent6551Account.TargetNotAllowed.selector, sessionId, address(token)));
        Agent6551Account(payable(tba)).executeWithSession(req, signature);
    }

    function testExecuteWithSessionBudgetExceededReverts() public {
        uint256 price = 101e6;

        Agent6551Account.SessionCallRequest memory req = Agent6551Account.SessionCallRequest({
            sessionId: sessionId,
            to: address(shop),
            value: 0,
            data: abi.encodeCall(shop.buy, (1, price)),
            nonce: 5,
            deadline: block.timestamp + 1 hours,
            pullAmount: price
        });

        bytes memory signature = _signRequest(req);

        vm.expectRevert(abi.encodeWithSelector(Agent6551Account.BudgetExceeded.selector, sessionId, 101e6, 100e6));
        Agent6551Account(payable(tba)).executeWithSession(req, signature);
    }

    function testActivateSessionBySigSuccess() public {
        bytes32 sid = keccak256("session-by-sig-ok");
        address[] memory targets = new address[](1);
        targets[0] = address(shop);

        vm.prank(nftOwner);
        Agent6551Account(payable(tba))
            .createSession(sid, uint64(block.timestamp + 1 days), address(token), 100e6, targets);

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _signActivation(sid, sessionSigner, deadline, SESSION_PK);

        vm.prank(address(0xCAFE));
        Agent6551Account(payable(tba)).activateSessionBySig(sid, sessionSigner, deadline, sig);

        (address signer,,,,,) = Agent6551Account(payable(tba)).sessions(sid);
        assertEq(signer, sessionSigner);
    }

    function testActivateSessionBySigBadSignatureReverts() public {
        bytes32 sid = keccak256("session-by-sig-bad");
        address[] memory targets = new address[](1);
        targets[0] = address(shop);

        vm.prank(nftOwner);
        Agent6551Account(payable(tba))
            .createSession(sid, uint64(block.timestamp + 1 days), address(token), 100e6, targets);

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory badSig = _signActivation(sid, sessionSigner, deadline, OWNER_PK);

        vm.expectRevert(abi.encodeWithSelector(Agent6551Account.InvalidSigner.selector, vm.addr(OWNER_PK)));
        Agent6551Account(payable(tba)).activateSessionBySig(sid, sessionSigner, deadline, badSig);
    }

    function testGetSessionIdsOnlyOwner() public {
        // Owner can read.
        vm.prank(nftOwner);
        bytes32[] memory ids = Agent6551Account(payable(tba)).getSessionIds(0, 10);
        assertEq(ids.length, 1);
        assertEq(ids[0], sessionId);

        vm.prank(nftOwner);
        uint256 cnt = Agent6551Account(payable(tba)).sessionCount();
        assertEq(cnt, 1);

        // Non-owner reverts.
        vm.expectRevert(abi.encodeWithSelector(Agent6551Account.NotTokenOwner.selector, address(this)));
        Agent6551Account(payable(tba)).getSessionIds(0, 10);

        vm.expectRevert(abi.encodeWithSelector(Agent6551Account.NotTokenOwner.selector, address(this)));
        Agent6551Account(payable(tba)).sessionCount();
    }

    function testGetSessionIdsPagination() public {
        bytes32 sid2 = keccak256("session-2");
        bytes32 sid3 = keccak256("session-3");
        address[] memory targets = new address[](1);
        targets[0] = address(shop);

        vm.prank(nftOwner);
        Agent6551Account(payable(tba))
            .createSession(sid2, uint64(block.timestamp + 1 days), address(token), 100e6, targets);
        vm.prank(nftOwner);
        Agent6551Account(payable(tba))
            .createSession(sid3, uint64(block.timestamp + 1 days), address(token), 100e6, targets);

        vm.prank(nftOwner);
        bytes32[] memory page1 = Agent6551Account(payable(tba)).getSessionIds(0, 2);
        assertEq(page1.length, 2);
        assertEq(page1[0], sessionId);
        assertEq(page1[1], sid2);

        vm.prank(nftOwner);
        bytes32[] memory page2 = Agent6551Account(payable(tba)).getSessionIds(2, 2);
        assertEq(page2.length, 1);
        assertEq(page2[0], sid3);
    }

    function testGetActiveSessionIdsFiltersExpiredAndRevoked() public {
        bytes32 sid2 = keccak256("active-2");
        bytes32 sid3 = keccak256("expired-3");
        bytes32 sid4 = keccak256("revoked-4");
        address[] memory targets = new address[](1);
        targets[0] = address(shop);

        vm.prank(nftOwner);
        Agent6551Account(payable(tba))
            .createSession(sid2, uint64(block.timestamp + 1 days), address(token), 100e6, targets);

        vm.prank(nftOwner);
        Agent6551Account(payable(tba))
            .createSession(
                sid3,
                uint64(block.timestamp + 1), // will expire after warp
                address(token),
                100e6,
                targets
            );

        vm.prank(nftOwner);
        Agent6551Account(payable(tba))
            .createSession(sid4, uint64(block.timestamp + 1 days), address(token), 100e6, targets);

        vm.prank(nftOwner);
        Agent6551Account(payable(tba)).revokeSession(sid4);

        vm.warp(block.timestamp + 2);

        vm.prank(nftOwner);
        bytes32[] memory ids = Agent6551Account(payable(tba)).getActiveSessionIds(0, 10);

        // sessionId (from setUp) and sid2 should remain active
        assertEq(ids.length, 2);
        assertEq(ids[0], sessionId);
        assertEq(ids[1], sid2);
    }

    function testCreateSessionDuplicateSessionIdReverts() public {
        address[] memory targets = new address[](1);
        targets[0] = address(shop);

        vm.prank(nftOwner);
        vm.expectRevert(abi.encodeWithSelector(Agent6551Account.SessionAlreadyExists.selector, sessionId));
        Agent6551Account(payable(tba))
            .createSession(sessionId, uint64(block.timestamp + 1 days), address(token), 100e6, targets);
    }

    function testCreateSessionInvalidValidUntilReverts() public {
        bytes32 sid = keccak256("bad-valid-until");
        address[] memory targets = new address[](1);
        targets[0] = address(shop);

        vm.prank(nftOwner);
        vm.expectRevert(
            abi.encodeWithSelector(Agent6551Account.InvalidSessionValidUntil.selector, uint64(block.timestamp))
        );
        Agent6551Account(payable(tba)).createSession(sid, uint64(block.timestamp), address(token), 100e6, targets);
    }

    function testCreateSessionZeroMaxTotalReverts() public {
        bytes32 sid = keccak256("bad-max-total");
        address[] memory targets = new address[](1);
        targets[0] = address(shop);

        vm.prank(nftOwner);
        vm.expectRevert(abi.encodeWithSelector(Agent6551Account.InvalidSessionMaxTotal.selector, 0));
        Agent6551Account(payable(tba)).createSession(sid, uint64(block.timestamp + 1 days), address(token), 0, targets);
    }

    function testCreateSessionEmptyTargetsReverts() public {
        bytes32 sid = keccak256("bad-targets-empty");
        address[] memory targets = new address[](0);

        vm.prank(nftOwner);
        vm.expectRevert(abi.encodeWithSelector(Agent6551Account.InvalidSessionTargets.selector));
        Agent6551Account(payable(tba))
            .createSession(sid, uint64(block.timestamp + 1 days), address(token), 100e6, targets);
    }

    function testCreateSessionZeroAddressTargetReverts() public {
        bytes32 sid = keccak256("bad-targets-zero");
        address[] memory targets = new address[](1);
        targets[0] = address(0);

        vm.prank(nftOwner);
        vm.expectRevert(abi.encodeWithSelector(Agent6551Account.InvalidSessionTarget.selector, address(0)));
        Agent6551Account(payable(tba))
            .createSession(sid, uint64(block.timestamp + 1 days), address(token), 100e6, targets);
    }

    function _signRequest(Agent6551Account.SessionCallRequest memory req)
        internal
        view
        returns (bytes memory signature)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                SESSION_CALL_TYPEHASH,
                req.sessionId,
                req.to,
                req.value,
                keccak256(req.data),
                req.nonce,
                req.deadline,
                req.pullAmount
            )
        );

        bytes32 domainSeparator = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH, keccak256(bytes("Agent6551Account")), keccak256(bytes("1")), block.chainid, tba
            )
        );

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SESSION_PK, digest);
        signature = abi.encodePacked(r, s, v);
    }

    function _signActivation(bytes32 sid, address signer, uint256 deadline, uint256 pk)
        internal
        view
        returns (bytes memory signature)
    {
        bytes32 structHash = keccak256(abi.encode(SESSION_ACTIVATION_TYPEHASH, sid, signer, deadline));

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
