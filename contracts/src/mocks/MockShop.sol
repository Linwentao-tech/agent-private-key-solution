// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title MockShop
/// @notice Simple shop that charges ERC20 in `buy(item, price)`.
contract MockShop {
    using SafeERC20 for IERC20;

    error InvalidPrice();

    IERC20 public immutable PAYMENT_TOKEN;

    event Bought(address indexed buyer, uint256 indexed item, uint256 price);

    constructor(IERC20 token_) {
        PAYMENT_TOKEN = token_;
    }

    /// @notice Buy an item by paying `price` in the payment token.
    function buy(uint256 item, uint256 price) external {
        if (price == 0) revert InvalidPrice();
        PAYMENT_TOKEN.safeTransferFrom(msg.sender, address(this), price);
        emit Bought(msg.sender, item, price);
    }
}
