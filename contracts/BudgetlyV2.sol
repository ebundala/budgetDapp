// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title BudgetlyV2
 * @notice Upgradeable multi-token budget manager with tranche-based and
 *         milestone-based fund scheduling.  Each user manages their own
 *         isolated set of budgets.  Funds can only be released according to
 *         the rules defined per tranche or milestone.
 *
 * Design overview
 * ---------------
 * • A *budget* holds a shared pool of whitelisted ERC-20 tokens.
 * • *Tranches* are recurring-release rules (FIXED amount or PERCENTAGE of
 *   pool per cycle) that draw from the shared pool.
 * • *Milestones* are one-off releases that unlock at a pre-set timestamp.
 * • Tranche edits can be locked in two ways:
 *     - lockUntilDrained: blocked while (cap > 0 && released < cap).
 *     - lockUntilCycleEnd: changes are queued and applied at the next cycle
 *       boundary automatically when funds are next released.
 */
contract BudgetlyV2 is
    Initializable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    // ─── Enums ───────────────────────────────────────────────────────────────

    /// @notice How a tranche computes the amount to release each cycle.
    enum ReleaseMode {
        FIXED,      // fixed token-unit amount per cycle
        PERCENTAGE  // basis-point share of the current pool per cycle
    }

    /// @notice Lifecycle state of a tranche.
    enum TrancheState {
        ACTIVE,
        PAUSED,
        ENDED
    }

    /// @notice Lifecycle state of a milestone.
    enum MilestoneStatus {
        PENDING,
        RELEASED,
        CANCELLED
    }

    // ─── Structs ─────────────────────────────────────────────────────────────

    struct PendingTrancheUpdate {
        uint256 releaseCycle;   // proposed new cycle length (seconds)
        uint256 releaseValue;   // proposed new value (amount or bps)
        uint256 effectiveAt;    // timestamp when the update becomes active
        bool    hasPending;
    }

    struct Tranche {
        string   label;
        ReleaseMode mode;
        uint256  releaseCycle;   // seconds between release windows
        uint256  releaseValue;   // fixed amount OR basis points (1-10 000)
        uint256  startTime;      // first cycle start
        uint256  lastReleaseTime;// tracks the last cycle-boundary processed
        uint256  cap;            // 0 = unlimited; max cumulative release
        uint256  released;       // cumulative amount already released
        TrancheState state;
        bool     lockUntilDrained;  // blocks edit while released < cap
        bool     lockUntilCycleEnd; // queues edits to next cycle boundary
        PendingTrancheUpdate pendingUpdate;
    }

    struct Milestone {
        string          label;
        uint256         releaseTime; // earliest timestamp for release
        uint256         amount;
        MilestoneStatus status;
    }

    // Solidity does not allow mappings inside structs that are stored in
    // other mappings when accessed via a local variable – we keep the
    // Budget struct in a nested mapping and address it by storage pointer.
    struct Budget {
        mapping(address => uint256) tokenBalances;
        address[] tokens;
        mapping(address => bool)    tokenStored;
        mapping(uint256 => Tranche)   tranches;
        uint256 trancheCount;
        mapping(uint256 => Milestone) milestones;
        uint256 milestoneCount;
        bool initialized;
        bool active;
    }

    // ─── State variables ─────────────────────────────────────────────────────

    /// @dev owner => budgetName => Budget
    mapping(address => mapping(bytes32 => Budget)) private _userBudgets;
    /// @dev owner => list of budget names (for enumeration)
    mapping(address => bytes32[]) private _userBudgetNames;
    /// @notice Protocol-level token whitelist (managed by contract owner)
    mapping(address => bool) public allowedTokens;

    // ─── Events ──────────────────────────────────────────────────────────────

    event TokenStatusChanged(address indexed token, bool status);

    event BudgetCreated(address indexed owner, bytes32 indexed budgetName);
    event BudgetTopUp(
        address indexed owner,
        bytes32 indexed budgetName,
        uint256 amount
    );
    event BudgetStatusChanged(
        address indexed owner,
        bytes32 indexed budgetName,
        bool active
    );

    event TrancheAdded(
        address indexed owner,
        bytes32 indexed budgetName,
        uint256 indexed trancheId,
        string label
    );
    event TrancheUpdated(
        address indexed owner,
        bytes32 indexed budgetName,
        uint256 indexed trancheId
    );
    event TrancheUpdateScheduled(
        address indexed owner,
        bytes32 indexed budgetName,
        uint256 indexed trancheId,
        uint256 effectiveAt
    );
    event TrancheStateChanged(
        address indexed owner,
        bytes32 indexed budgetName,
        uint256 indexed trancheId,
        TrancheState state
    );
    event TrancheReleased(
        address indexed owner,
        bytes32 indexed budgetName,
        uint256 indexed trancheId,
        address recipient,
        uint256 amount
    );

    event MilestoneAdded(
        address indexed owner,
        bytes32 indexed budgetName,
        uint256 indexed milestoneId,
        string  label,
        uint256 releaseTime,
        uint256 amount
    );
    event MilestoneUpdated(
        address indexed owner,
        bytes32 indexed budgetName,
        uint256 indexed milestoneId
    );
    event MilestoneReleased(
        address indexed owner,
        bytes32 indexed budgetName,
        uint256 indexed milestoneId,
        address recipient,
        uint256 amount
    );
    event MilestoneCancelled(
        address indexed owner,
        bytes32 indexed budgetName,
        uint256 indexed milestoneId
    );

    // ─── Constructor / Initializer ───────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyOwner {}

    // ─── Token whitelist ─────────────────────────────────────────────────────

    /**
     * @notice Add or remove a token from the protocol whitelist.
     * @param token  ERC-20 token address.
     * @param allow  true to allow, false to disallow.
     */
    function whitelistToken(
        address token,
        bool allow
    ) external onlyOwner returns (bool) {
        allowedTokens[token] = allow;
        emit TokenStatusChanged(token, allow);
        return allow;
    }

    // ─── Budget lifecycle ────────────────────────────────────────────────────

    /**
     * @notice Create a new budget, optionally depositing an initial set of
     *         tokens.  The budget starts in the *active* state.
     * @param budgetName  Unique identifier for this budget (per user).
     * @param tokens      Initial tokens to deposit (may be empty).
     * @param amounts     Corresponding amounts.
     */
    function createBudget(
        bytes32 budgetName,
        address[] calldata tokens,
        uint256[] calldata amounts
    ) external nonReentrant returns (bool) {
        Budget storage budget = _userBudgets[msg.sender][budgetName];
        require(!budget.initialized, "Budget name already in use");
        require(tokens.length == amounts.length, "Arrays length mismatch");

        budget.initialized = true;
        budget.active = true;
        _userBudgetNames[msg.sender].push(budgetName);

        if (tokens.length > 0) {
            _depositTokens(budget, tokens, amounts);
        }

        emit BudgetCreated(msg.sender, budgetName);
        return true;
    }

    /**
     * @notice Deposit additional tokens into an existing active budget.
     */
    function topUpBudget(
        bytes32 budgetName,
        address[] calldata tokens,
        uint256[] calldata amounts
    ) external nonReentrant returns (bool) {
        Budget storage budget = _userBudgets[msg.sender][budgetName];
        require(budget.initialized, "Budget not found");
        require(budget.active, "Budget is disabled");
        require(tokens.length == amounts.length, "Arrays length mismatch");

        uint256 total = _depositTokens(budget, tokens, amounts);
        emit BudgetTopUp(msg.sender, budgetName, total);
        return true;
    }

    /**
     * @notice Enable or disable a budget.  Disabled budgets cannot receive
     *         deposits or release funds.
     */
    function setBudgetActive(
        bytes32 budgetName,
        bool active
    ) external returns (bool) {
        Budget storage budget = _userBudgets[msg.sender][budgetName];
        require(budget.initialized, "Budget not found");
        budget.active = active;
        emit BudgetStatusChanged(msg.sender, budgetName, active);
        return active;
    }

    // ─── Tranche management ──────────────────────────────────────────────────

    /**
     * @notice Add a new tranche to a budget.
     * @param budgetName        Target budget.
     * @param label             Human-readable name.
     * @param mode              FIXED or PERCENTAGE.
     * @param releaseCycle      Seconds per cycle.
     * @param releaseValue      Amount (FIXED) or basis points (PERCENTAGE).
     * @param startTime         Cycle start (0 = now).
     * @param cap               Max cumulative release (0 = unlimited).
     * @param lockUntilDrained  Block edits while balance remains.
     * @param lockUntilCycleEnd Queue edits to the next cycle boundary.
     * @return trancheId        Index of the newly created tranche.
     */
    function addTranche(
        bytes32 budgetName,
        string  calldata label,
        ReleaseMode mode,
        uint256 releaseCycle,
        uint256 releaseValue,
        uint256 startTime,
        uint256 cap,
        bool    lockUntilDrained,
        bool    lockUntilCycleEnd
    ) external returns (uint256 trancheId) {
        Budget storage budget = _userBudgets[msg.sender][budgetName];
        require(budget.initialized, "Budget not found");
        require(budget.active, "Budget is disabled");
        require(releaseCycle > 0, "Release cycle must be > 0");
        _validateReleaseValue(mode, releaseValue);

        uint256 effectiveStart = startTime == 0 ? block.timestamp : startTime;

        trancheId = budget.trancheCount++;
        Tranche storage t = budget.tranches[trancheId];
        t.label           = label;
        t.mode            = mode;
        t.releaseCycle    = releaseCycle;
        t.releaseValue    = releaseValue;
        t.startTime       = effectiveStart;
        t.lastReleaseTime = effectiveStart;
        t.cap             = cap;
        t.released        = 0;
        t.state           = TrancheState.ACTIVE;
        t.lockUntilDrained  = lockUntilDrained;
        t.lockUntilCycleEnd = lockUntilCycleEnd;

        emit TrancheAdded(msg.sender, budgetName, trancheId, label);
    }

    /**
     * @notice Update a tranche's cycle length and release value.
     *
     * Rules
     * -----
     * • If `lockUntilDrained` is set and the tranche still has a positive
     *   remaining cap balance (cap > 0 && released < cap), the call reverts.
     * • If `lockUntilCycleEnd` is set, the change is *queued* and will be
     *   applied automatically at the next cycle boundary (i.e. during the
     *   next successful `releaseTrancheFunds` call).
     * • Otherwise the change is applied immediately.
     */
    function updateTranche(
        bytes32 budgetName,
        uint256 trancheId,
        uint256 newReleaseCycle,
        uint256 newReleaseValue
    ) external {
        Budget storage budget = _userBudgets[msg.sender][budgetName];
        require(budget.initialized, "Budget not found");
        Tranche storage t = _requireTranche(budget, trancheId);
        require(t.state != TrancheState.ENDED, "Tranche has ended");
        require(newReleaseCycle > 0, "Release cycle must be > 0");
        _validateReleaseValue(t.mode, newReleaseValue);

        // lockUntilDrained: cannot edit while the capped tranche has funds left
        if (t.lockUntilDrained && t.cap > 0) {
            require(t.released >= t.cap, "Tranche is locked until drained");
        }

        if (t.lockUntilCycleEnd) {
            uint256 cycleEnd = _nextCycleBoundary(t);
            t.pendingUpdate = PendingTrancheUpdate({
                releaseCycle: newReleaseCycle,
                releaseValue: newReleaseValue,
                effectiveAt:  cycleEnd,
                hasPending:   true
            });
            emit TrancheUpdateScheduled(
                msg.sender, budgetName, trancheId, cycleEnd
            );
        } else {
            t.releaseCycle = newReleaseCycle;
            t.releaseValue = newReleaseValue;
            emit TrancheUpdated(msg.sender, budgetName, trancheId);
        }
    }

    /**
     * @notice Pause, resume or end a tranche.
     */
    function setTrancheState(
        bytes32 budgetName,
        uint256 trancheId,
        TrancheState newState
    ) external {
        Budget storage budget = _userBudgets[msg.sender][budgetName];
        require(budget.initialized, "Budget not found");
        Tranche storage t = _requireTranche(budget, trancheId);
        require(t.state != TrancheState.ENDED, "Tranche has ended");
        t.state = newState;
        emit TrancheStateChanged(msg.sender, budgetName, trancheId, newState);
    }

    /**
     * @notice Release accrued funds from a tranche to a recipient.
     *
     * The amount released is the lesser of:
     *   • cycles_elapsed × releaseValue  (FIXED mode), or
     *     cycles_elapsed × pool × bps/10000 (PERCENTAGE mode)
     *   • remaining cap  (if cap > 0)
     *   • current pool balance
     *
     * Any pending parameter update whose effectiveAt has passed is applied
     * before the computation.
     */
    function releaseTrancheFunds(
        bytes32 budgetName,
        uint256 trancheId,
        address recipient
    ) external nonReentrant returns (uint256 amountReleased) {
        require(recipient != address(0), "Invalid recipient");
        Budget storage budget = _userBudgets[msg.sender][budgetName];
        require(budget.initialized, "Budget not found");
        require(budget.active, "Budget is disabled");
        Tranche storage t = _requireTranche(budget, trancheId);
        require(t.state == TrancheState.ACTIVE, "Tranche not active");

        _applyPendingUpdate(t);

        uint256 cycles = _elapsedCycles(t);
        require(cycles > 0, "No cycles elapsed");

        uint256 available = _computeAvailable(t, cycles, budget);
        require(available > 0, "Nothing to release");

        // Advance the cycle pointer before transferring (reentrancy safety)
        t.lastReleaseTime += cycles * t.releaseCycle;
        t.released        += available;

        if (t.cap > 0 && t.released >= t.cap) {
            t.state = TrancheState.ENDED;
            emit TrancheStateChanged(
                msg.sender, budgetName, trancheId, TrancheState.ENDED
            );
        }

        _transferFromPool(budget, recipient, available);
        emit TrancheReleased(
            msg.sender, budgetName, trancheId, recipient, available
        );
        return available;
    }

    // ─── Milestone management ─────────────────────────────────────────────────

    /**
     * @notice Add a one-off milestone to a budget.
     * @param releaseTime  Earliest timestamp at which the milestone can be
     *                     released.  Must be strictly in the future.
     * @param amount       Amount to release (drawn from the shared pool).
     * @return milestoneId Index of the newly created milestone.
     */
    function addMilestone(
        bytes32 budgetName,
        string  calldata label,
        uint256 releaseTime,
        uint256 amount
    ) external returns (uint256 milestoneId) {
        Budget storage budget = _userBudgets[msg.sender][budgetName];
        require(budget.initialized, "Budget not found");
        require(budget.active, "Budget is disabled");
        require(releaseTime > block.timestamp, "Release time must be in the future");
        require(amount > 0, "Amount must be > 0");

        milestoneId = budget.milestoneCount++;
        Milestone storage m = budget.milestones[milestoneId];
        m.label       = label;
        m.releaseTime = releaseTime;
        m.amount      = amount;
        m.status      = MilestoneStatus.PENDING;

        emit MilestoneAdded(
            msg.sender, budgetName, milestoneId, label, releaseTime, amount
        );
    }

    /**
     * @notice Edit a future pending milestone.
     *         Already-released or cancelled milestones cannot be edited.
     *         Milestones whose release time is in the past cannot be edited.
     */
    function updateMilestone(
        bytes32 budgetName,
        uint256 milestoneId,
        uint256 newReleaseTime,
        uint256 newAmount
    ) external {
        Budget storage budget = _userBudgets[msg.sender][budgetName];
        require(budget.initialized, "Budget not found");
        Milestone storage m = _requireMilestone(budget, milestoneId);
        require(m.status == MilestoneStatus.PENDING, "Milestone is not pending");
        require(m.releaseTime > block.timestamp, "Cannot edit past milestone");
        require(newReleaseTime > block.timestamp, "New release time must be in the future");
        require(newAmount > 0, "Amount must be > 0");

        m.releaseTime = newReleaseTime;
        m.amount      = newAmount;
        emit MilestoneUpdated(msg.sender, budgetName, milestoneId);
    }

    /**
     * @notice Release a milestone's funds to a recipient once its time has
     *         passed.
     */
    function releaseMilestone(
        bytes32 budgetName,
        uint256 milestoneId,
        address recipient
    ) external nonReentrant returns (uint256 amount) {
        require(recipient != address(0), "Invalid recipient");
        Budget storage budget = _userBudgets[msg.sender][budgetName];
        require(budget.initialized, "Budget not found");
        require(budget.active, "Budget is disabled");
        Milestone storage m = _requireMilestone(budget, milestoneId);
        require(m.status == MilestoneStatus.PENDING, "Milestone not pending");
        require(block.timestamp >= m.releaseTime, "Milestone not yet due");

        amount   = m.amount;
        m.status = MilestoneStatus.RELEASED;

        _transferFromPool(budget, recipient, amount);
        emit MilestoneReleased(
            msg.sender, budgetName, milestoneId, recipient, amount
        );
    }

    /**
     * @notice Cancel a future pending milestone.
     *         Funds remain in the shared pool – they are NOT returned to the
     *         caller's wallet.
     */
    function cancelMilestone(
        bytes32 budgetName,
        uint256 milestoneId
    ) external {
        Budget storage budget = _userBudgets[msg.sender][budgetName];
        require(budget.initialized, "Budget not found");
        Milestone storage m = _requireMilestone(budget, milestoneId);
        require(m.status == MilestoneStatus.PENDING, "Milestone not pending");
        require(m.releaseTime > block.timestamp, "Cannot cancel past milestone");

        m.status = MilestoneStatus.CANCELLED;
        emit MilestoneCancelled(msg.sender, budgetName, milestoneId);
    }

    // ─── View / query functions ───────────────────────────────────────────────

    /**
     * @notice Current token balances for a budget.
     */
    function getBudgetTokens(
        bytes32 budgetName
    ) external view returns (address[] memory tokens, uint256[] memory balances) {
        Budget storage budget = _userBudgets[msg.sender][budgetName];
        require(budget.initialized, "Budget not found");
        return _getTokenBalances(budget);
    }

    /**
     * @notice Full details of a single tranche.
     */
    function getTranche(
        bytes32 budgetName,
        uint256 trancheId
    ) external view returns (
        string memory label,
        ReleaseMode   mode,
        uint256       releaseCycle,
        uint256       releaseValue,
        uint256       startTime,
        uint256       lastReleaseTime,
        uint256       cap,
        uint256       released,
        TrancheState  state,
        bool          lockUntilDrained,
        bool          lockUntilCycleEnd
    ) {
        Budget storage budget = _userBudgets[msg.sender][budgetName];
        require(budget.initialized, "Budget not found");
        Tranche storage t = _requireTranche(budget, trancheId);
        return (
            t.label, t.mode, t.releaseCycle, t.releaseValue,
            t.startTime, t.lastReleaseTime, t.cap, t.released,
            t.state, t.lockUntilDrained, t.lockUntilCycleEnd
        );
    }

    /**
     * @notice Returns the pending update for a tranche (if any).
     */
    function getTrancheUpdate(
        bytes32 budgetName,
        uint256 trancheId
    ) external view returns (
        bool    hasPending,
        uint256 releaseCycle,
        uint256 releaseValue,
        uint256 effectiveAt
    ) {
        Budget storage budget = _userBudgets[msg.sender][budgetName];
        require(budget.initialized, "Budget not found");
        Tranche storage t = _requireTranche(budget, trancheId);
        PendingTrancheUpdate storage u = t.pendingUpdate;
        return (u.hasPending, u.releaseCycle, u.releaseValue, u.effectiveAt);
    }

    /**
     * @notice Full details of a single milestone.
     */
    function getMilestone(
        bytes32 budgetName,
        uint256 milestoneId
    ) external view returns (
        string memory   label,
        uint256         releaseTime,
        uint256         amount,
        MilestoneStatus status
    ) {
        Budget storage budget = _userBudgets[msg.sender][budgetName];
        require(budget.initialized, "Budget not found");
        Milestone storage m = _requireMilestone(budget, milestoneId);
        return (m.label, m.releaseTime, m.amount, m.status);
    }

    /**
     * @notice Amount that can currently be released from a tranche
     *         (accounting for pending updates and pool size).
     */
    function getTrancheAvailable(
        bytes32 budgetName,
        uint256 trancheId
    ) external view returns (uint256) {
        Budget storage budget = _userBudgets[msg.sender][budgetName];
        require(budget.initialized, "Budget not found");
        Tranche storage t = _requireTranche(budget, trancheId);
        if (t.state != TrancheState.ACTIVE) return 0;
        uint256 cycles = _elapsedCycles(t);
        if (cycles == 0) return 0;
        return _computeAvailable(t, cycles, budget);
    }

    /**
     * @notice Aggregated token balance of a budget.
     */
    function totalBalance(
        bytes32 budgetName
    ) external view returns (uint256) {
        Budget storage budget = _userBudgets[msg.sender][budgetName];
        require(budget.initialized, "Budget not found");
        return _totalBalance(budget);
    }

    /**
     * @notice List all budget names for the caller.
     */
    function getBudgets() external view returns (bytes32[] memory) {
        return _userBudgetNames[msg.sender];
    }

    /**
     * @notice Quick status summary for a budget – useful for frontends.
     */
    function getBudgetStatus(
        bytes32 budgetName
    ) external view returns (
        bool    isActive,
        uint256 poolBalance,
        uint256 trancheCount,
        uint256 milestoneCount
    ) {
        Budget storage budget = _userBudgets[msg.sender][budgetName];
        require(budget.initialized, "Budget not found");
        return (
            budget.active,
            _totalBalance(budget),
            budget.trancheCount,
            budget.milestoneCount
        );
    }

    // ─── Internal helpers ────────────────────────────────────────────────────

    function _depositTokens(
        Budget storage budget,
        address[] calldata tokens,
        uint256[] calldata amounts
    ) internal returns (uint256 total) {
        for (uint256 i = 0; i < tokens.length; i++) {
            address token  = tokens[i];
            uint256 amount = amounts[i];
            require(allowedTokens[token], "Token is not whitelisted");
            require(amount > 0, "Invalid amount");
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
            if (!budget.tokenStored[token]) {
                budget.tokens.push(token);
                budget.tokenStored[token] = true;
            }
            budget.tokenBalances[token] += amount;
            total += amount;
        }
    }

    /// @dev Transfer `amount` from the shared pool to `recipient`, consuming
    ///      tokens in order until the amount is satisfied.
    function _transferFromPool(
        Budget storage budget,
        address recipient,
        uint256 amount
    ) internal {
        uint256 remaining = amount;
        for (uint256 i = 0; i < budget.tokens.length && remaining > 0; i++) {
            address token = budget.tokens[i];
            uint256 bal   = budget.tokenBalances[token];
            if (bal == 0) continue;
            uint256 use = bal >= remaining ? remaining : bal;
            budget.tokenBalances[token] -= use;
            remaining -= use;
            IERC20(token).safeTransfer(recipient, use);
        }
        require(remaining == 0, "Insufficient pool balance");
    }

    /// @dev Compute the releasable amount for a tranche in the current call.
    function _computeAvailable(
        Tranche storage t,
        uint256 cycles,
        Budget  storage budget
    ) internal view returns (uint256 available) {
        if (t.mode == ReleaseMode.FIXED) {
            available = cycles * t.releaseValue;
        } else {
            // PERCENTAGE: each elapsed cycle contributes bps of the *current*
            // pool balance.  This is intentionally computed on the live balance
            // so that percentage tranches reflect real fund levels.
            uint256 poolBalance = _totalBalance(budget);
            available = (poolBalance * t.releaseValue * cycles) / 10000;
        }

        // Cap constraint
        if (t.cap > 0) {
            uint256 remaining = t.cap - t.released;
            if (available > remaining) available = remaining;
        }

        // Cannot exceed the pool
        uint256 pool = _totalBalance(budget);
        if (available > pool) available = pool;
    }

    function _elapsedCycles(
        Tranche storage t
    ) internal view returns (uint256) {
        if (block.timestamp < t.lastReleaseTime || t.releaseCycle == 0) {
            return 0;
        }
        return (block.timestamp - t.lastReleaseTime) / t.releaseCycle;
    }

    /// @dev Returns the timestamp of the next cycle boundary after now.
    function _nextCycleBoundary(
        Tranche storage t
    ) internal view returns (uint256) {
        uint256 cycles = _elapsedCycles(t);
        return t.lastReleaseTime + (cycles + 1) * t.releaseCycle;
    }

    /// @dev Apply a queued update if its effectiveAt time has been reached.
    function _applyPendingUpdate(Tranche storage t) internal {
        if (
            t.pendingUpdate.hasPending &&
            block.timestamp >= t.pendingUpdate.effectiveAt
        ) {
            t.releaseCycle             = t.pendingUpdate.releaseCycle;
            t.releaseValue             = t.pendingUpdate.releaseValue;
            t.pendingUpdate.hasPending = false;
        }
    }

    function _validateReleaseValue(
        ReleaseMode mode,
        uint256 value
    ) internal pure {
        require(value > 0, "Release value must be > 0");
        if (mode == ReleaseMode.PERCENTAGE) {
            require(value <= 10000, "Percentage exceeds 100%");
        }
    }

    function _requireTranche(
        Budget storage budget,
        uint256 trancheId
    ) internal view returns (Tranche storage) {
        require(trancheId < budget.trancheCount, "Tranche not found");
        return budget.tranches[trancheId];
    }

    function _requireMilestone(
        Budget storage budget,
        uint256 milestoneId
    ) internal view returns (Milestone storage) {
        require(milestoneId < budget.milestoneCount, "Milestone not found");
        return budget.milestones[milestoneId];
    }

    function _totalBalance(
        Budget storage budget
    ) internal view returns (uint256 total) {
        for (uint256 i = 0; i < budget.tokens.length; i++) {
            total += budget.tokenBalances[budget.tokens[i]];
        }
    }

    function _getTokenBalances(
        Budget storage budget
    ) internal view returns (address[] memory tokens, uint256[] memory balances) {
        uint256 n   = budget.tokens.length;
        tokens      = new address[](n);
        balances    = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            tokens[i]   = budget.tokens[i];
            balances[i] = budget.tokenBalances[budget.tokens[i]];
        }
    }
}
