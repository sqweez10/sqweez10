// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// =========================================================
//  DRAFT — NOT DEPLOYED — NOT AUDITED — FOR REVIEW ONLY
// =========================================================

/**
 * ████████╗██╗   ██╗███████╗███╗   ███╗   V3
 * ╚══██╔══╝╚██╗ ██╔╝██╔════╝████╗ ████║
 * ██║    ╚████╔╝ ███████╗██╔████╔██║
 * ██║     ╚██╔╝  ╚════██║██║╚██╔╝██║
 * ██║      ██║   ███████║██║ ╚═╝ ██║
 *
 * @title   TYSMFaucetV3 (DRAFT)
 * @author  tops87
 * @notice  Anti-farming redesign of the TYSM Daily Faucet.
 *
 *          Background: TYSMFaucetV2 paid the correct amount to every
 *          wallet that called claim() — it was not a payout bug. The
 *          problem was coordinated multi-wallet farming (many smart
 *          wallets / Account Abstraction bundles each claiming the base
 *          2,000 TYSM/day and forwarding it to a collector address). V2
 *          has no pause() function and will not be refilled going
 *          forward; it is kept only as a read-only history source.
 *
 *          V3 requires a fresh, backend-issued, EIP-712 signed
 *          authorization for every claim. The contract never writes to
 *          V2 — it only performs read-only calls to V2's userInfo() for
 *          lazy migration the first time a wallet claims via V3.
 *
 *          Reward schedule is intentionally identical to V2 (V2 never
 *          had Cycle 2/3 multiplier rewards — that concept does not
 *          exist here either):
 *            Days 1-6:   2,000 TYSM/day
 *            Day 7:      10,000 TYSM
 *            Days 8-14:  2,000 TYSM/day
 *            Day 15:     40,000 TYSM
 *            Days 16-29: 2,000 TYSM/day
 *            Day 30:     90,000 TYSM
 *            Day 31+:    cycle repeats from Day 1
 */

// =========================================================
//  INTERFACES
// =========================================================

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @notice Read-only interface into the existing, unmodified V2 faucet.
///         V3 never calls any state-changing function on V2.
interface IOldFaucetV2 {
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

contract TYSMFaucetV3 {
    // =========================================================
    //  STATE
    // =========================================================

    IERC20 public immutable tysm;
    IOldFaucetV2 public immutable oldFaucet;

    address public owner;
    address public signer;

    bool public paused;

    uint256 public constant COOLDOWN = 24 hours;

    struct UserInfo {
        uint256 lastClaim;
        uint256 streak;
        uint256 totalClaimed;
        uint256 totalDays;
    }

    /// @dev Internal V3 user records. Exposed read-only via the
    ///      `userInfo(address)` view function below, which also handles
    ///      users who have not migrated yet by reading through to V2.
    mapping(address => UserInfo) private userInfoData;

    /// @notice True once a wallet's V2 history has been copied into V3.
    mapping(address => bool) public migrated;

    /// @notice Owner-controlled blocklist. Blocked addresses cannot
    ///         claim regardless of an otherwise-valid signature.
    mapping(address => bool) public blocked;

    /// @notice Tracks every claim authorization digest already used, to
    ///         prevent replay.
    mapping(bytes32 => bool) public usedAuthorizations;

    uint256 public totalClaimsCount;

    /// @dev simple reentrancy guard
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _reentrancyStatus = _NOT_ENTERED;

    // =========================================================
    //  EIP-712
    // =========================================================

    bytes32 public immutable DOMAIN_SEPARATOR;

    /// @dev keccak256("ClaimAuthorization(address user,uint256 deadline,bytes32 nonce)")
    bytes32 public constant CLAIM_TYPEHASH =
        keccak256("ClaimAuthorization(address user,uint256 deadline,bytes32 nonce)");

    // =========================================================
    //  EVENTS
    // =========================================================

    event ClaimedV3(address indexed user, uint256 amount, uint256 streak, uint256 totalDays);
    event UserMigrated(
        address indexed user,
        uint256 lastClaim,
        uint256 streak,
        uint256 totalClaimed,
        uint256 totalDays
    );
    event SignerUpdated(address indexed oldSigner, address indexed newSigner);
    event BlockedStatusUpdated(address indexed user, bool isBlocked);
    event Paused();
    event Unpaused();
    event TokensWithdrawn(address indexed to, uint256 amount);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    // =========================================================
    //  MODIFIERS
    // =========================================================

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Faucet is paused");
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
     * @param _tysm       TYSM token address on Base
     *                    (e.g. 0x0358795322c04de04ead2338a803a9d3518a9877)
     * @param _oldFaucet  Existing TYSMFaucetV2 address on Base
     *                    (e.g. 0x43B68e86F6D6B3ED8d94c2A51015602c7338f124)
     * @param _signer     Backend signing key that authorizes claims.
     *                    NEVER a real private key here — this is just the
     *                    corresponding public address.
     * @param _owner      Contract owner (e.g. a multisig).
     */
    constructor(address _tysm, address _oldFaucet, address _signer, address _owner) {
        require(_tysm != address(0), "Zero token address");
        require(_oldFaucet != address(0), "Zero old faucet address");
        require(_signer != address(0), "Zero signer address");
        require(_owner != address(0), "Zero owner address");

        tysm = IERC20(_tysm);
        oldFaucet = IOldFaucetV2(_oldFaucet);
        signer = _signer;
        owner = _owner;

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes("TYSMFaucetV3")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    // =========================================================
    //  CLAIM
    // =========================================================

    /**
     * @notice Claim today's reward using a backend-issued EIP-712
     *         signature. The signature is bound directly to
     *         `msg.sender`, so it cannot be reused by, or front-run and
     *         stolen by, a different wallet.
     * @param deadline  Unix timestamp after which this authorization is
     *                  no longer valid.
     * @param nonce     Unique value chosen by the backend per
     *                  authorization. Combined with `msg.sender` and
     *                  `deadline`, it forms a digest that can only ever
     *                  be used once (see `usedAuthorizations`).
     * @param signature 65-byte ECDSA signature from `signer` over the
     *                  EIP-712 digest of (msg.sender, deadline, nonce).
     */
    function claimWithSignature(
        uint256 deadline,
        bytes32 nonce,
        bytes calldata signature
    ) external nonReentrant whenNotPaused {
        require(!blocked[msg.sender], "Blocked");
        require(block.timestamp <= deadline, "Signature expired");

        bytes32 structHash = keccak256(abi.encode(CLAIM_TYPEHASH, msg.sender, deadline, nonce));
        bytes32 digest = _hashTypedDataV4(structHash);

        require(!usedAuthorizations[digest], "Authorization already used");

        address recovered = _recoverSigner(digest, signature);
        require(recovered == signer, "Invalid signer");

        // Mark used immediately after verification, before any further
        // state changes and well before the external token transfer.
        usedAuthorizations[digest] = true;

        UserInfo storage info = userInfoData[msg.sender];

        // --- Lazy migration from V2 (read-only, once per wallet) ---
        if (!migrated[msg.sender]) {
            (
                uint256 v2LastClaim,
                uint256 v2Streak,
                uint256 v2TotalClaimed,
                uint256 v2TotalDays
            ) = oldFaucet.userInfo(msg.sender);

            info.lastClaim = v2LastClaim;
            info.streak = v2Streak;
            info.totalClaimed = v2TotalClaimed;
            info.totalDays = v2TotalDays;

            migrated[msg.sender] = true;
            emit UserMigrated(msg.sender, v2LastClaim, v2Streak, v2TotalClaimed, v2TotalDays);
        }

        // --- Cooldown, using the (possibly just-migrated) lastClaim ---
        require(block.timestamp >= info.lastClaim + COOLDOWN, "Come back in 24 hours");

        // --- Streak progression, mirroring V2's 30-day cycle ---
        if (info.lastClaim > 0 && block.timestamp <= info.lastClaim + 48 hours) {
            info.streak += 1;
        } else {
            info.streak = 1;
        }
        if (info.streak > 30) {
            info.streak = 1;
        }

        uint256 reward = calculateReward(info.streak);
        require(tysm.balanceOf(address(this)) >= reward, "Faucet empty");

        info.lastClaim = block.timestamp;
        info.totalClaimed += reward;
        info.totalDays += 1;
        totalClaimsCount += 1;

        require(tysm.transfer(msg.sender, reward), "Token transfer failed");

        emit ClaimedV3(msg.sender, reward, info.streak, info.totalDays);
    }

    // =========================================================
    //  REWARD CALCULATOR (same schedule as V2)
    // =========================================================

    function calculateReward(uint256 streak) public pure returns (uint256) {
        if (streak == 30) return 90_000 * 10 ** 18;
        if (streak == 15) return 40_000 * 10 ** 18;
        if (streak == 7) return 10_000 * 10 ** 18;
        return 2_000 * 10 ** 18;
    }

    // =========================================================
    //  VIEW FUNCTIONS
    // =========================================================

    /// @dev Effective (lastClaim, streak) for a wallet, whether or not
    ///      it has migrated yet — reads through to V2 for wallets that
    ///      haven't claimed via V3 before. Read-only, never writes.
    function _effective(address user) internal view returns (uint256 lastClaim, uint256 streak) {
        if (migrated[user]) {
            UserInfo storage info = userInfoData[user];
            return (info.lastClaim, info.streak);
        }
        (uint256 v2LastClaim, uint256 v2Streak, , ) = oldFaucet.userInfo(user);
        return (v2LastClaim, v2Streak);
    }

    function canClaim(address user) external view returns (bool) {
        if (paused) return false;
        if (blocked[user]) return false;
        (uint256 lastClaim, ) = _effective(user);
        return block.timestamp >= lastClaim + COOLDOWN;
    }

    function getTimeLeft(address user) external view returns (uint256) {
        (uint256 lastClaim, ) = _effective(user);
        uint256 readyAt = lastClaim + COOLDOWN;
        if (block.timestamp >= readyAt) return 0;
        return readyAt - block.timestamp;
    }

    function faucetBalance() external view returns (uint256) {
        return tysm.balanceOf(address(this));
    }

    /// @notice Reward the user would receive on their *next* successful
    ///         claim, accounting for streak continuation/reset exactly
    ///         as claimWithSignature would apply it.
    function nextReward(address user) external view returns (uint256) {
        (uint256 lastClaim, uint256 streak) = _effective(user);

        uint256 nextStreak;
        if (lastClaim > 0 && block.timestamp <= lastClaim + 48 hours) {
            nextStreak = streak + 1;
        } else {
            nextStreak = 1;
        }
        if (nextStreak > 30) {
            nextStreak = 1;
        }

        return calculateReward(nextStreak);
    }

    /// @notice Mirrors V2's userInfo(address) shape. For wallets that
    ///         haven't migrated yet, reads through to V2 so the frontend
    ///         always sees accurate current values.
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
        if (migrated[user]) {
            UserInfo storage info = userInfoData[user];
            return (info.lastClaim, info.streak, info.totalClaimed, info.totalDays);
        }
        return oldFaucet.userInfo(user);
    }

    // =========================================================
    //  OWNER FUNCTIONS
    // =========================================================

    function setSigner(address newSigner) external onlyOwner {
        require(newSigner != address(0), "Zero address");
        address old = signer;
        signer = newSigner;
        emit SignerUpdated(old, newSigner);
    }

    function setBlocked(address user, bool isBlocked) external onlyOwner {
        require(user != address(0), "Zero address");
        blocked[user] = isBlocked;
        emit BlockedStatusUpdated(user, isBlocked);
    }

    function setBlockedBatch(address[] calldata users, bool isBlocked) external onlyOwner {
        uint256 len = users.length;
        for (uint256 i = 0; i < len; i++) {
            require(users[i] != address(0), "Zero address");
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

    function withdrawTokens(address to, uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0), "Zero address");
        require(amount > 0, "Amount must be greater than zero");
        require(tysm.balanceOf(address(this)) >= amount, "Insufficient balance");
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
    //  EIP-712 / SIGNATURE HELPERS
    // =========================================================

    function _hashTypedDataV4(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    /// @dev Minimal ECDSA recovery with standard malleability protection
    ///      (rejects upper-range `s` values) and `v` normalization check.
    ///      NOTE: this is hand-rolled for a draft. Before any real
    ///      deployment, replace with an audited implementation (e.g.
    ///      OpenZeppelin's ECDSA library) — see the review notes.
    function _recoverSigner(bytes32 digest, bytes memory signature) internal pure returns (address) {
        require(signature.length == 65, "Invalid signature length");

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }

        require(
            uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0,
            "Invalid signature 's' value"
        );
        require(v == 27 || v == 28, "Invalid signature 'v' value");

        address recovered = ecrecover(digest, v, r, s);
        require(recovered != address(0), "Invalid signature");
        return recovered;
    }

    // =========================================================
    //  FALLBACK
    // =========================================================

    /// @dev claimWithSignature is nonpayable by design — this contract
    ///      never expects or needs direct ETH.
    receive() external payable {
        revert("Direct ETH not accepted");
    }
}
