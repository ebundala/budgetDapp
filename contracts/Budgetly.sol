// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.0.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Budgetly is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    struct Budget {
        mapping(address => uint256) balances; // Mapping of token address to balance
        uint256 releaseCycle; // In seconds
        uint256 startBudgetCycle; //time to start a budget cycles
        uint256 lastReleaseTime; //last time funds were releases in multiples of release cycles
        uint256 releaseAmount; // Fixed amount to release from the budget in each cycle
        bool initialized; // Flag to indicate if the budget is initialized
        bool status;
        bool hasFunds; // flag the budget if its empty
        address[] tokens; // List of tokens stored in the budget
    }

    mapping(address => mapping(bytes32 => Budget)) public userBudgets; // userAddress => budgetName => Budget
    mapping(address=>bytes32[]) private userBudgetNames;
    mapping(address => bool) public allowedTokens; //allowed stable coins
    
    event TokenStatusChanged(address indexed token,bool status);
    event BudgetCreated(address indexed owner,bytes32 budgetName);
    event BudgetTopUp(address indexed owner,bytes32 budgetName,uint256 amount);
    event BudgetWithdraw(address indexed owner,bytes32 budgetName,uint256 amount);
    event BudgetStatusChanged(address indexed owner,bytes32 budgetName,bool status);
    
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() public /* address initialOwner */ initializer {
        __Ownable_init(/* initialOwner */ msg.sender);
        __UUPSUpgradeable_init();
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyOwner {}

    function topUpBudget(
        bytes32 budgetName,
        address[] memory tokens,
        uint256[] memory amounts
    ) external returns (bool success) {
        Budget storage budget = userBudgets[msg.sender][budgetName];
        require(budget.initialized, "Budget not found");
        require(budget.status,"Budget is disabled");
        uint256 total = 0;
        require(tokens.length == amounts.length, "Arrays length mismatch");

        if (!budget.hasFunds) {
            uint256 cycles = _getElapsedCycles(budget);
            budget.lastReleaseTime += cycles * budget.releaseCycle; // start computing cycles from last supposed withdraw
        }

        for (uint256 i = 0; i < tokens.length; i++) {
            address token = tokens[i];
            uint256 amount = amounts[i];
            require(_isStablecoin(token), "Token is not whitelisted");
            require(amount > 0, "Invalid amount");

            IERC20(token).transferFrom(msg.sender, address(this), amount);
            if (!isTokenStored(budget.tokens, token)) {
                budget.tokens.push(token);
            }
            budget.balances[token] += amount;
            total += amount;
        }
        emit BudgetTopUp(msg.sender,budgetName,total);
        return true;
    }

    function whitelistToken(
        address token,
        bool allow
    ) external onlyOwner returns (bool status) {
        allowedTokens[token] = allow;
        emit TokenStatusChanged(token,allow);
        return allowedTokens[token];
    }
    function changeBudgetStatus(bytes32 budgetName, bool budgetStatus) external returns (bool status){
    Budget storage budget = userBudgets[msg.sender][budgetName];
    require(budget.initialized, "Budget not found");
    budget.status = budgetStatus;
    emit BudgetStatusChanged(msg.sender, budgetName, budgetStatus);
    return budgetStatus;
}

    function _isStablecoin(address token) internal view returns (bool success) {
        return allowedTokens[token];
    }

    function lockFunds(
        bytes32 budgetName,
        address[] memory tokens,
        uint256[] memory amounts,
        uint256 releaseCycle,
        uint256 startBudgetCycle,
        uint256 _releaseAmount
    ) external returns (bool locked) {
        require(releaseCycle > 0, "Release cycle must be greater than zero");
        require(_releaseAmount > 0, "Release amount must be greater than zero");
        // require(
        //     startBudgetCycle > block.timestamp,
        //     "Start time must be greater than current blocktime"
        // );

        Budget storage budget = userBudgets[msg.sender][budgetName];
        
        require(!budget.initialized, "Budget name already in use");
        require(tokens.length == amounts.length, "Arrays length mismatch");

        for (uint256 i = 0; i < tokens.length; i++) {
            address token = tokens[i];
            uint256 amount = amounts[i];
            require(_isStablecoin(token), "Token is not whitelisted");
            require(amount > 0, "Invalid amount");

            IERC20(token).transferFrom(msg.sender, address(this), amount);
            budget.balances[token] += amount;
            // Add token to the list of stored tokens if not already present
            if (!isTokenStored(budget.tokens, token)) {
                budget.tokens.push(token);
            }
        }

        // Initialize the budget
        budget.releaseCycle = releaseCycle;
        budget.releaseAmount = _releaseAmount;
        budget.lastReleaseTime = startBudgetCycle;
        budget.initialized = true;
        budget.startBudgetCycle = startBudgetCycle;
        budget.hasFunds = true;
        budget.status = true;
        userBudgetNames[msg.sender].push(budgetName);
        emit BudgetCreated(msg.sender,budgetName);
        return true;
    }

    function updateReleaseAmount(
        bytes32 budgetName,
        uint256 newReleaseAmount
    ) external returns (bool updated) {
        Budget storage budget = userBudgets[msg.sender][budgetName];
        require(budget.initialized, "Budget not found");
        require(budget.status,"Budget is disabled");
        require(
            _totalBalance(budget) == 0,
            "Cannot update release amount while balance is non-zero"
        );
        require(
            newReleaseAmount > 0,
            "New release amount must be greater than zero"
        );

        budget.releaseAmount = newReleaseAmount;
        
        return true;
    }

    function updateReleaseCycle(
        bytes32 budgetName,
        uint256 newReleaseCycle
    ) external returns (bool updated) {
        Budget storage budget = userBudgets[msg.sender][budgetName];
        require(budget.initialized, "Budget not found");
        require(budget.status,"Budget is disabled");
        require(
            _totalBalance(budget) == 0,
            "Cannot update release cycle while balance is non-zero"
        );
        require(
            newReleaseCycle > 0,
            "New release cycle must be greater than zero"
        );

        budget.releaseCycle = newReleaseCycle;
        return true;
    }

    function releaseFunds(
        bytes32 budgetName,
        address recipient
    ) external returns (bool success) {
        Budget storage budget = userBudgets[msg.sender][budgetName];

        require(budget.initialized, "Budget not found");
        require(budget.status,"Budget is disabled");
        uint256 cycles = _getElapsedCycles(budget);
        require(cycles > 0, "Release cycles must be greater than one");

     

        // Calculate the total amount to release (ensure it's never a fraction)
        uint256 totalReleaseAmount = cycles * budget.releaseAmount;

        // Get the available balance in the budget
        uint256 availableBalance = _totalBalance(budget);

        // Release the lesser of totalReleaseAmount or availableBalance
        uint256 amountToRelease = (totalReleaseAmount < availableBalance)
            ? totalReleaseAmount
            : availableBalance;

        // Ensure there are enough funds to release
        require(amountToRelease > 0, "Insufficient funds to release");

        // Iterate over token balances to meet the required release amount
        uint256 remainingAmountToRelease = amountToRelease;
        for (
            uint256 i = 0;
            i < budget.tokens.length && remainingAmountToRelease > 0;
            i++
        ) {
            address token = budget.tokens[i];
            uint256 balance = budget.balances[token];

            if (balance > 0) {
                uint256 amountToUse = (balance >= remainingAmountToRelease)
                    ? remainingAmountToRelease
                    : balance;

                // Transfer tokens to recipient
                IERC20(token).transfer(recipient, amountToUse);

                // Update remaining amount to release
                remainingAmountToRelease -= amountToUse;

                // Update token balance in the budget
                budget.balances[token] -= amountToUse;
            }
        }

        require(
            remainingAmountToRelease == 0,
            "Unexpected error in funds release"
        );

        // Update the last release time
        budget.lastReleaseTime += (cycles * budget.releaseCycle);
        budget.hasFunds = _totalBalance(budget) > 0;
        emit BudgetWithdraw(msg.sender,budgetName,amountToRelease);
        return true;
    }

    function getBudgetDetails(
        bytes32 budgetName
    )
        external
        view
        returns (
            address[] memory tokens,
            uint256[] memory balances,
            uint256 releaseCycle,
            uint256 lastReleaseTime,
            uint256 releaseAmount
        )
    {
        Budget storage budget = userBudgets[msg.sender][budgetName];

        uint256 numTokens = budget.tokens.length;
        tokens = new address[](numTokens);
        balances = new uint256[](numTokens);

        for (uint256 i = 0; i < numTokens; i++) {
            address token = budget.tokens[i];
            tokens[i] = token;
            balances[i] = budget.balances[token];
        }

        return (
            tokens,
            balances,
            budget.releaseCycle,
            budget.lastReleaseTime,
            budget.releaseAmount
        );
    }

    function _getElapsedCycles(
        Budget storage budget
    ) internal view returns (uint256 cyclesPassed) {
        // Calculate the number of complete cycles since the last release
        if (block.timestamp >= budget.lastReleaseTime && budget.releaseCycle>0) {
            uint256 elapsedTime = block.timestamp - budget.lastReleaseTime;
            return elapsedTime / budget.releaseCycle;
        }
        return 0;
    }

    function _calculateAvailableBalance(
        Budget storage budget,
        uint256 cycles
    ) internal view returns (uint256 amountToRelease) {
        // Calculate the total amount to release (ensure it's never a fraction)
        uint256 totalReleaseAmount = cycles * budget.releaseAmount;
        // Get the available balance in the budget
        uint256 availableBalance = _totalBalance(budget);
        // Release the lesser of totalReleaseAmount or availableBalance
        return
            (totalReleaseAmount < availableBalance)
                ? totalReleaseAmount
                : availableBalance;
    }

    function getAvailableBalanceToRelease(
        bytes32 budgetName
    ) external view returns (uint256 balance) {
        Budget storage budget = userBudgets[msg.sender][budgetName];
        uint256 cyclesPassed = _getElapsedCycles(budget);
        return _calculateAvailableBalance(budget, cyclesPassed);
    }

    function isTokenStored(
        address[] memory tokenList,
        address token
    ) internal pure returns (bool) {
        for (uint256 i = 0; i < tokenList.length; i++) {
            if (tokenList[i] == token) {
                return true;
            }
        }
        return false;
    }

    function _totalBalance(
        Budget storage budget
    ) internal view returns (uint256) {
        uint256 total = 0;

        for (uint256 i = 0; i < budget.tokens.length; i++) {
            address token = budget.tokens[i];
            total += budget.balances[token];
        }

        return total;
    }

    function totalBalance(bytes32 budgetName) external view returns(uint256){
        Budget storage budget = userBudgets[msg.sender][budgetName];
        require(budget.initialized, "Budget not found");
        return _totalBalance(budget);
    }
    function getBudgets() external view returns (bytes32[] memory){
        return userBudgetNames[msg.sender];
    }
}
