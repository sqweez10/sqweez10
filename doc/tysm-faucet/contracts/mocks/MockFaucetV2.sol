// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// =========================================================
//  DRAFT — NOT DEPLOYED — NOT AUDITED — FOR REVIEW ONLY
// =========================================================

/**
 * @title   MockFaucetV2
 * @notice  Minimal mock of TYSMFaucetV2's userInfo() shape, for testing
 *          TYSMFaucetV3's lazy-migration logic on Base Sepolia / locally.
 *          This is NOT the real V2 contract — it has no claim() function
 *          and no reward logic of its own. It only stores whatever
 *          userInfo values a test explicitly sets for a given address.
 */
contract MockFaucetV2 {
    struct UserInfo {
        uint256 lastClaim;
        uint256 streak;
        uint256 totalClaimed;
        uint256 totalDays;
    }

    mapping(address => UserInfo) private _userInfo;

    /// @notice Test-only setter, intentionally unrestricted, to simulate
    ///         a given V2 claim history for a wallet so V3's migration
    ///         logic can be exercised against known starting states.
    function setUserInfo(
        address user,
        uint256 lastClaim,
        uint256 streak,
        uint256 totalClaimed,
        uint256 totalDays
    ) external {
        _userInfo[user] = UserInfo({
            lastClaim: lastClaim,
            streak: streak,
            totalClaimed: totalClaimed,
            totalDays: totalDays
        });
    }

    /// @notice Matches the real TYSMFaucetV2.userInfo(address) signature
    ///         exactly, including that it never reverts for an address
    ///         with no history — it simply returns all-zero values, the
    ///         same behavior as a Solidity auto-generated mapping getter.
    function userInfo(address user)
        external
        view
        returns (
            uint256 lastClaim,
            uint256 streak,
            uint256 totalClaimed,
            uint256 totalDays
        )
    {
        UserInfo storage info = _userInfo[user];
        return (info.lastClaim, info.streak, info.totalClaimed, info.totalDays);
    }
}
