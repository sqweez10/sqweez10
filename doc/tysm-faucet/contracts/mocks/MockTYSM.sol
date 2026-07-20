// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// =========================================================
//  DRAFT — NOT DEPLOYED — NOT AUDITED — FOR REVIEW ONLY
// =========================================================

/**
 * @title   MockTYSM
 * @notice  Minimal ERC20-like mock token for local/testnet testing of
 *          TYSMFaucetV3 only. This is NOT the real TYSM token contract
 *          and must never be treated as one — it exists purely so test
 *          suites can freely mint and move test tokens.
 */
contract MockTYSM {
    string public constant name = "Mock TYSM";
    string public constant symbol = "TYSM";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    /// @notice Test-only mint function, intentionally unrestricted. The
    ///         real TYSM token has no public mint() — this exists only
    ///         so tests can fund faucet/pool contracts freely.
    function mint(address to, uint256 amount) external {
        require(to != address(0), "Zero address");
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 currentAllowance = allowance[from][msg.sender];
        require(currentAllowance >= amount, "Insufficient allowance");

        if (currentAllowance != type(uint256).max) {
            allowance[from][msg.sender] = currentAllowance - amount;
        }

        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "Zero address");
        require(balanceOf[from] >= amount, "Insufficient balance");

        balanceOf[from] -= amount;
        balanceOf[to] += amount;

        emit Transfer(from, to, amount);
    }
}
