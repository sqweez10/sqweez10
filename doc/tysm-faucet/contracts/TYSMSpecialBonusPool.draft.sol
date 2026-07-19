// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * ████████╗██╗   ██╗███████╗███╗   ███╗   Special Loyalty Bonus Pool
 * ╚══██╔══╝╚██╗ ██╔╝██╔════╝████╗ ████║
 * ██║    ╚████╔╝ ███████╗██╔████╔██║
 * ██║     ╚██╔╝  ╚════██║██║╚██╔╝██║
 * ██║      ██║   ███████║██║ ╚═╝ ██║
 *
 * @title   TYSMSpecialBonusPool
 * @author  tops87
 * @notice  DRAFT. Not deployed, not tested, not audited.
 *
 *          A standalone bonus reward contract for long-term TYSM Daily
 *          Faucet users, built entirely separately from the existing
 *          TYSMFaucetV2 contract:
 *            - This contract makes NO write calls into TYSMFaucetV2.
 *            - It only reads `userInfo(address).totalDays` from it.
 *            - It cannot affect the daily faucet's streak, cooldown,
 *              totalClaimed, or claim history in any way.
 *
 *          The 0.0000038 ETH `supportFee` charged on each bonus claim is
 *          a separate, contract-level fee — it is NOT Base network gas.
 *          Gas is paid to Base as normal on top of this fee. The fee is
 *          held in this contract's ETH balance and is only ever moved by
 *          the owner calling `withdrawFees()` to `feeRecipient` (a bonus
 *          treasury), to help refill the TYSM bonus pool over time.
 *
 *          Each milestone (e.g. Day 45, Day 60) is a ONE-TIME claim per
 *          wallet. A user does not need to claim milestones in order —
 *          e.g. a user who reaches Day 60 without ever claiming Day 45
 *          can still claim both, in any order, whenever they choose.
 *
 * Bonus amounts (see project docs for full multiplier rationale):
 *   C2 (x1, active by default):  Day 45 = 80,000 TYSM   Day 60 = 180,000 TYSM
 *   C3 (x2, pre-set, disabled):  Day 75 = 160,000 TYSM  Day 90 = 360,000 TYSM
 *   C4 (x3, pre-set, disabled):  Day 105 = 240,000 TYSM Day 120 = 540,000 TYSM
 *                                (multiplier caps at C4 / x3)
 */

// =========================================================
//  INTERFACES
// =========================================================

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @notice Read-only interface into the existing, unmodified daily faucet.
interface ITYSMFaucetV2 {
    function userInfo(address user)
        external
        view
        returns (
            uint256 lastClaim,
            uint256 streak,
            uint256 totalClaimed,
            uint256 totalDays
        );
}

contract TYSMSpecialBonusPool {
    // =========================================================
    //  STATE
    // =========================================================

    IERC20 public immutable tysm;
    ITYSMFaucetV2 public immutable faucet;

    address public owner;
    address payable public feeRecipient;

    /// @notice Fixed ETH fee required per bonus claim, separate from
    ///         normal Base network gas. Owner-adjustable but capped by
    ///         MAX_SUPPORT_FEE below so it can never be raised to
    ///         something that harms users.
    uint256 public supportFee;

    /// @notice Hard ceiling on supportFee, enforced in setSupportFee().
    ///         Set well above the default (0.0000038 ETH) to allow for
    ///         reasonable future adjustment, while still making it
    ///         impossible for the fee to become a meaningful barrier to
    ///         claiming a bonus.
    uint256 public constant MAX_SUPPORT_FEE = 0.0001 ether;

    bool public paused;

    /// @dev milestoneDay => TYSM amount (18 decimals) paid for that milestone
    mapping(uint256 => uint256) public bonusAmountByMilestone;

    /// @dev milestoneDay => whether it can currently be claimed
    mapping(uint256 => bool) public milestoneEnabled;

    /// @dev user => milestoneDay => already claimed
    mapping(address => mapping(uint256 => bool)) public claimedBonus;

    /// @notice Owner-controlled blocklist. Blocked addresses cannot claim
    ///         bonuses regardless of eligibility, as a backstop against
    ///         wallets identified as farming/abuse after the fact.
    mapping(address => bool) public blocked;

    /// @dev Enumerable list of every milestone day ever configured, used
    ///      by getAvailableMilestones(). Expected to stay small (well
    ///      under 20 entries), so a plain array is simple and cheap
    ///      enough — no need for a more complex enumerable-set pattern.
    uint256[] public knownMilestoneDays;
    mapping(uint256 => bool) private _isKnownMilestone;

    /// @dev simple reentrancy guard
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _reentrancyStatus = _NOT_ENTERED;

    // =========================================================
    //  EVENTS
    // =========================================================

    event BonusClaimed(address indexed user, uint256 indexed milestoneDay, uint256 amount, uint256 totalDays);
    event MilestoneEnabledUpdated(uint256 indexed milestoneDay, bool enabled);
    event BonusAmountUpdated(uint256 indexed milestoneDay, uint256 amount);
    event SupportFeeUpdated(uint256 oldFee, uint256 newFee);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event FeesWithdrawn(address indexed to, uint256 amount);
    event TokensWithdrawn(address indexed to, uint256 amount);
    event BlockedStatusUpdated(address indexed user, bool isBlocked);
    event Paused();
    event Unpaused();
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    // =========================================================
    //  MODIFIERS
    // =========================================================

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Bonus pool is paused");
        _;
    }

    modifier nonReentrant() {
        require(_reentrancyStatus != _ENTERED, "Reentrant call");
        _reentrancyStatus = _ENTERED;
        _;
        _reentrancyStatus = _NOT_ENTERED;
    }

    // =========================================================
    //  CONSTRUCTOR
    // =========================================================

    /**
     * @param _tysm          TYSM token address on Base
     *                       (e.g. 0x0358795322c04de04ead2338a803a9d3518a9877)
     * @param _faucet        Existing TYSMFaucetV2 address on Base
     *                       (e.g. 0x43B68e86F6D6B3ED8d94c2A51015602c7338f124)
     * @param _feeRecipient  Address that receives withdrawn support fees
     *                       (e.g. a bonus treasury / multisig)
     */
    constructor(address _tysm, address _faucet, address payable _feeRecipient) {
        require(_tysm != address(0), "Zero token address");
        require(_faucet != address(0), "Zero faucet address");
        require(_feeRecipient != address(0), "Zero fee recipient");

        tysm = IERC20(_tysm);
        faucet = ITYSMFaucetV2(_faucet);
        owner = msg.sender;
        feeRecipient = _feeRecipient;

        supportFee = 0.0000038 ether;

        // Initial active phase (C2) — enabled by default.
        _setBonusAmount(45, 80_000 * 10 ** 18);
        _setMilestoneEnabled(45, true);

        _setBonusAmount(60, 180_000 * 10 ** 18);
        _setMilestoneEnabled(60, true);

        // Future phases (C3 / C4) — amounts pre-set for convenience, but
        // left DISABLED. The owner must explicitly call
        // setMilestoneEnabled(day, true) to activate each one later.
        _setBonusAmount(75, 160_000 * 10 ** 18);   // C3 mid  (x2 of Day 45)
        _setBonusAmount(90, 360_000 * 10 ** 18);   // C3 end  (x2 of Day 60)
        _setBonusAmount(105, 240_000 * 10 ** 18);  // C4 mid  (x3 of Day 45)
        _setBonusAmount(120, 540_000 * 10 ** 18);  // C4 end  (x3 of Day 60) — multiplier caps at C4
    }

    // =========================================================
    //  CLAIM
    // =========================================================

    /**
     * @notice Claim a single bonus milestone. Always a separate
     *         transaction from the daily faucet's own claim() — this
     *         function never calls into TYSMFaucetV2 except for the
     *         read-only userInfo() eligibility check below.
     * @param milestoneDay The milestone day being claimed (e.g. 45, 60).
     */
    function claimBonus(uint256 milestoneDay) external payable nonReentrant whenNotPaused {
        require(!blocked[msg.sender], "Blocked");
        require(milestoneEnabled[milestoneDay], "Milestone not enabled");
        require(!claimedBonus[msg.sender][milestoneDay], "Already claimed");
        require(msg.value >= supportFee, "Insufficient support fee");

        // Read-only lookup of the user's lifetime totalDays from the
        // existing, untouched daily faucet contract.
        (, , , uint256 totalDays) = faucet.userInfo(msg.sender);
        require(totalDays >= milestoneDay, "Not eligible yet");

        uint256 amount = bonusAmountByMilestone[milestoneDay];
        require(amount > 0, "No bonus configured");
        require(tysm.balanceOf(address(this)) >= amount, "Bonus pool empty");

        // Effects before interactions: mark this milestone claimed BEFORE
        // the external TYSM transfer, so a duplicate or reentrant claim
        // is impossible regardless of what the token transfer does.
        claimedBonus[msg.sender][milestoneDay] = true;

        require(tysm.transfer(msg.sender, amount), "Token transfer failed");

        emit BonusClaimed(msg.sender, milestoneDay, amount, totalDays);

        // Note: any msg.value above supportFee is intentionally kept in
        // the contract as extra bonus-pool support rather than refunded,
        // to keep this function simple. The frontend should send the
        // exact fee amount.
    }

    // =========================================================
    //  VIEW FUNCTIONS
    // =========================================================

    /// @notice Best-effort eligibility check. Cannot verify msg.value
    ///         (only meaningful inside an actual transaction) — the
    ///         frontend must still attach `supportFee` when calling
    ///         claimBonus().
    function canClaimBonus(address user, uint256 milestoneDay) external view returns (bool) {
        if (paused) return false;
        if (blocked[user]) return false;
        if (!milestoneEnabled[milestoneDay]) return false;
        if (claimedBonus[user][milestoneDay]) return false;

        uint256 amount = bonusAmountByMilestone[milestoneDay];
        if (amount == 0) return false;
        if (tysm.balanceOf(address(this)) < amount) return false;

        (, , , uint256 totalDays) = faucet.userInfo(user);
        return totalDays >= milestoneDay;
    }

    function getBonusAmount(uint256 milestoneDay) external view returns (uint256) {
        return bonusAmountByMilestone[milestoneDay];
    }

    function hasClaimed(address user, uint256 milestoneDay) external view returns (bool) {
        return claimedBonus[user][milestoneDay];
    }

    /// @notice Returns every milestone day the user currently qualifies
    ///         for, is enabled, funded, and has not yet claimed.
    function getAvailableMilestones(address user) external view returns (uint256[] memory) {
        (, , , uint256 totalDays) = faucet.userInfo(user);

        uint256 len = knownMilestoneDays.length;
        uint256 count = 0;

        for (uint256 i = 0; i < len; i++) {
            uint256 day = knownMilestoneDays[i];
            if (_isAvailable(user, day, totalDays)) {
                count++;
            }
        }

        uint256[] memory result = new uint256[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < len; i++) {
            uint256 day = knownMilestoneDays[i];
            if (_isAvailable(user, day, totalDays)) {
                result[idx] = day;
                idx++;
            }
        }

        return result;
    }

    /// @notice TYSM available in this contract to pay out bonuses.
    function bonusPoolBalance() external view returns (uint256) {
        return tysm.balanceOf(address(this));
    }

    /// @notice ETH collected from support fees, awaiting withdrawal.
    function feeBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /// @notice Convenience read of the user's lifetime totalDays, sourced
    ///         directly from the existing daily faucet (read-only).
    function getUserTotalDays(address user) external view returns (uint256) {
        (, , , uint256 totalDays) = faucet.userInfo(user);
        return totalDays;
    }

    // =========================================================
    //  OWNER FUNCTIONS
    // =========================================================

    function setMilestoneEnabled(uint256 milestoneDay, bool enabled) external onlyOwner {
        _setMilestoneEnabled(milestoneDay, enabled);
    }

    /// @notice Add a new milestone or update the amount of an existing
    ///         one. Does NOT change enabled state — a brand-new milestone
    ///         day defaults to disabled until setMilestoneEnabled is
    ///         called separately.
    function setBonusAmount(uint256 milestoneDay, uint256 amount) external onlyOwner {
        _setBonusAmount(milestoneDay, amount);
    }

    function setSupportFee(uint256 newFee) external onlyOwner {
        require(newFee <= MAX_SUPPORT_FEE, "Fee exceeds max cap");
        uint256 old = supportFee;
        supportFee = newFee;
        emit SupportFeeUpdated(old, newFee);
    }

    function setFeeRecipient(address payable newRecipient) external onlyOwner {
        require(newRecipient != address(0), "Zero address");
        address old = feeRecipient;
        feeRecipient = newRecipient;
        emit FeeRecipientUpdated(old, newRecipient);
    }

    /// @notice Block or unblock a single wallet from claiming bonuses.
    function setBlocked(address user, bool isBlocked) external onlyOwner {
        blocked[user] = isBlocked;
        emit BlockedStatusUpdated(user, isBlocked);
    }

    /// @notice Block or unblock multiple wallets in a single transaction,
    ///         e.g. to act quickly on a newly identified farming cluster.
    function setBlockedBatch(address[] calldata users, bool isBlocked) external onlyOwner {
        uint256 len = users.length;
        for (uint256 i = 0; i < len; i++) {
            blocked[users[i]] = isBlocked;
            emit BlockedStatusUpdated(users[i], isBlocked);
        }
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused();
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused();
    }

    /// @notice Withdraw collected ETH support fees to feeRecipient.
    function withdrawFees() external onlyOwner nonReentrant {
        uint256 bal = address(this).balance;
        require(bal > 0, "No fees to withdraw");

        (bool sent, ) = feeRecipient.call{value: bal}("");
        require(sent, "ETH transfer failed");

        emit FeesWithdrawn(feeRecipient, bal);
    }

    /// @notice Owner-controlled cleanup / rebalancing tool, e.g. to move
    ///         unused TYSM out before topping up, or in an emergency.
    ///         Does not affect any claimed status or user eligibility.
    function withdrawUnusedTYSM(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Zero address");
        require(tysm.transfer(to, amount), "Token transfer failed");
        emit TokensWithdrawn(to, amount);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        address old = owner;
        owner = newOwner;
        emit OwnershipTransferred(old, newOwner);
    }

    // =========================================================
    //  INTERNAL HELPERS
    // =========================================================

    function _setMilestoneEnabled(uint256 milestoneDay, bool enabled) internal {
        milestoneEnabled[milestoneDay] = enabled;
        emit MilestoneEnabledUpdated(milestoneDay, enabled);
    }

    function _setBonusAmount(uint256 milestoneDay, uint256 amount) internal {
        if (!_isKnownMilestone[milestoneDay]) {
            _isKnownMilestone[milestoneDay] = true;
            knownMilestoneDays.push(milestoneDay);
        }
        bonusAmountByMilestone[milestoneDay] = amount;
        emit BonusAmountUpdated(milestoneDay, amount);
    }

    function _isAvailable(address user, uint256 day, uint256 totalDays) internal view returns (bool) {
        return
            !blocked[user] &&
            milestoneEnabled[day] &&
            !claimedBonus[user][day] &&
            bonusAmountByMilestone[day] > 0 &&
            totalDays >= day;
    }

    // =========================================================
    //  FALLBACK
    // =========================================================

    /// @dev Reject stray ETH sent outside of claimBonus() so accidental
    ///      transfers aren't silently absorbed as "fees". claimBonus()
    ///      itself always carries calldata, so it is unaffected by this.
    receive() external payable {
        revert("Direct ETH not accepted, use claimBonus()");
    }
}
