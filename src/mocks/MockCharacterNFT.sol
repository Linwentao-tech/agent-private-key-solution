// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title MockCharacterNFT
/// @notice Minimal ERC-721 character NFT for ERC-6551 token bound accounts.
contract MockCharacterNFT is ERC721, Ownable {
    using Strings for uint256;

    error NonexistentToken(uint256 tokenId);

    uint256 private _nextId = 1;
    string private _baseTokenUri;

    constructor(string memory name_, string memory symbol_) ERC721(name_, symbol_) Ownable(msg.sender) {}

    /// @notice Mint a new character NFT to `to`.
    function mint(address to) external onlyOwner returns (uint256 tokenId) {
        tokenId = _nextId++;
        _safeMint(to, tokenId);
    }

    /// @notice Set base URI for token metadata.
    function setBaseURI(string calldata baseUri_) external onlyOwner {
        _baseTokenUri = baseUri_;
    }

    /// @dev Return token URI as baseURI + tokenId.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        if (_ownerOf(tokenId) == address(0)) revert NonexistentToken(tokenId);
        if (bytes(_baseTokenUri).length == 0) return "";
        return string.concat(_baseTokenUri, tokenId.toString(), ".json");
    }
}
