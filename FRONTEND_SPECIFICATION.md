# Budgetly Flutter Frontend Specification

## Overview
Budgetly is a decentralized budgeting application that allows users to create time-locked budgets with scheduled fund releases. This specification outlines the complete frontend implementation using Flutter, Riverpod for state management, and Reown AppKit for wallet connectivity.

## Core Features & Smart Contract Integration

### 1. Wallet Connection & Authentication
**Implementation with Reown AppKit:**
- Integrate Reown AppKit for seamless wallet connectivity
- Support multiple wallet providers (MetaMask, WalletConnect, etc.)
- Display connected wallet address and balance
- Handle wallet disconnection gracefully
- Store wallet connection state in Riverpod providers

**UI Components:**
- Connect wallet button on splash/landing screen
- Wallet address display in app header
- Disconnect option in settings/profile menu
- Network selector for different blockchain networks

### 2. Dashboard/Home Screen
**Core Functionality:**
- Display list of user's budgets (using `getBudgets()` contract function)
- Show budget summary cards with key metrics
- Quick actions: Create Budget, View Details, Top Up
- Real-time balance updates and available withdrawal amounts

**UI Elements:**
- Grid/List view of budget cards
- Each card shows: Budget name, total balance, next release date, status
- Floating action button for creating new budget
- Pull-to-refresh functionality
- Empty state when no budgets exist

**Riverpod Integration:**
- `budgetListProvider` - manages list of user budgets
- `budgetSummaryProvider` - calculates aggregate statistics
- Auto-refresh every 30 seconds or on app resume

### 3. Budget Creation Flow
**Contract Function:** `lockFunds()`

**Multi-Step Form:**
1. **Budget Details:**
   - Budget name input (converted to bytes32)
   - Purpose/description (optional, stored locally)
   
2. **Token Selection:**
   - Display whitelisted tokens (check `allowedTokens` mapping)
   - Multi-token selection with amount inputs
   - Token balance validation from user's wallet
   
3. **Release Configuration:**
   - Release cycle selection (daily, weekly, monthly, custom)
   - Release amount per cycle
   - Start date/time selection
   
4. **Review & Confirmation:**
   - Summary of all inputs
   - Gas fee estimation
   - Token approval transactions (if needed)
   - Final transaction confirmation

**UI Features:**
- Step-by-step wizard with progress indicator
- Form validation with real-time feedback
- Token amount input with max button
- Date/time picker for start time
- Loading states during transaction processing
- Success/error handling with appropriate messages

### 4. Budget Management Screen
**Contract Functions:** `getBudgetDetails()`, `totalBalance()`, `getAvailableBalanceToRelease()`

**Budget Overview Section:**
- Budget name and status (active/disabled)
- Total balance across all tokens
- Next release date and amount
- Available balance ready for withdrawal
- Release cycle information

**Token Holdings Section:**
- List of tokens in the budget with individual balances
- Token logos and symbols
- USD value conversion (if API available)

**Action Buttons:**
- Top Up Budget
- Withdraw Available Funds
- Enable/Disable Budget
- Edit Settings (when balance is zero)

**Charts & Analytics:**
- Release schedule timeline
- Balance history over time
- Withdrawal history

### 5. Top Up Budget Functionality
**Contract Function:** `topUpBudget()`

**UI Flow:**
1. Select tokens to add (from whitelisted tokens)
2. Enter amounts for each selected token
3. Validate sufficient wallet balance
4. Handle token approvals if needed
5. Execute top-up transaction
6. Show confirmation and updated balance

**Features:**
- Multi-token support in single transaction
- Batch approval handling
- Real-time balance updates
- Transaction history logging

### 6. Fund Withdrawal System
**Contract Function:** `releaseFunds()`

**Withdrawal Interface:**
- Display available amount ready for withdrawal
- Recipient address input (default to connected wallet)
- Address validation and ENS support
- Transaction confirmation dialog
- Gas fee estimation

**Release Schedule Display:**
- Next release countdown timer
- Historical release calendar
- Upcoming releases preview
- Missed releases indication

**Restrictions Handling:**
- Check if budget is enabled
- Validate sufficient cycles have passed
- Show helpful error messages for failed conditions

### 7. Budget Settings Management
**Contract Functions:** `changeBudgetStatus()`, `updateReleaseAmount()`, `updateReleaseCycle()`

**Status Management:**
- Toggle to enable/disable budget
- Clear indication of current status
- Warning dialogs for status changes

**Release Configuration Updates:**
- Edit release amount (only when balance is zero)
- Edit release cycle (only when balance is zero)
- Clear validation messages and restrictions
- Confirmation dialogs for critical changes

### 8. Token Whitelist Display
**Contract Function:** `allowedTokens` mapping

**Features:**
- Display all whitelisted stablecoins
- Token information (symbol, name, logo)
- Filter tokens in selection screens
- Show token approval status

## Technical Architecture

### State Management with Riverpod

**Core Providers:**
```dart
// Wallet connection state
final walletProvider = StateNotifierProvider<WalletNotifier, WalletState>

// Contract interaction
final budgetlyContractProvider = Provider<BudgetlyContract>

// Budget data
final budgetListProvider = FutureProvider<List<Budget>>
final budgetDetailsProvider = FutureProvider.family<BudgetDetails, String>

// Real-time data
final availableBalanceProvider = StreamProvider.family<BigInt, String>
final nextReleaseTimeProvider = Provider.family<DateTime?, String>

// UI state
final selectedTokensProvider = StateProvider<List<Token>>
final createBudgetFormProvider = StateNotifierProvider<CreateBudgetFormNotifier, CreateBudgetFormState>
```

**Error Handling:**
- Global error handling with AsyncError states
- User-friendly error messages for common contract failures
- Retry mechanisms for network issues
- Offline state management

### Navigation Structure
```
Splash Screen
├── Wallet Connection
└── Main App
    ├── Dashboard (Home)
    ├── Create Budget
    │   ├── Budget Details
    │   ├── Token Selection
    │   ├── Release Configuration
    │   └── Review & Confirm
    ├── Budget Details
    │   ├── Overview
    │   ├── Top Up
    │   ├── Withdraw
    │   └── Settings
    ├── Transaction History
    └── Settings
        ├── Wallet Management
        ├── Notifications
        └── About
```

### Contract Integration Details

**ABI Integration:**
- Generate TypeScript types from contract ABI
- Use web3dart for Ethereum interaction
- Handle contract method calls with proper error handling
- Event listening for real-time updates

**Transaction Handling:**
- Gas estimation before transactions
- Transaction status tracking
- Confirmation waiting with progress indicators
- Error handling for failed transactions

**Data Transformation:**
- Convert bytes32 budget names to/from strings
- Handle BigInt amounts with proper decimal conversion
- Format timestamps for user display
- Cache frequently accessed data

### UI/UX Specifications

**Design Theme:**
- Modern, clean interface with financial app aesthetics
- Primary colors: Blue/Teal for trust and stability
- Secondary colors: Green for positive actions, Red for warnings
- Dark/Light theme support

**Typography:**
- Clear hierarchy with readable fonts
- Proper spacing and alignment
- Accessibility considerations (font scaling)

**Animations & Interactions:**
- Smooth transitions between screens
- Loading animations for blockchain operations
- Pull-to-refresh with visual feedback
- Haptic feedback for important actions

**Responsive Design:**
- Tablet layout optimization
- Safe area handling for different screen sizes
- Adaptive layouts for landscape mode

### Security Considerations

**Wallet Security:**
- Never store private keys locally
- Secure session management
- Automatic disconnect on app backgrounding (optional)

**Input Validation:**
- Sanitize all user inputs
- Validate addresses and amounts
- Check contract requirements before transactions

**Error Prevention:**
- Confirmation dialogs for irreversible actions
- Clear warnings for destructive operations
- Balance checks before transactions

### Offline Support

**Cached Data:**
- Store budget information locally
- Offline viewing of transaction history
- Graceful degradation when network unavailable

**Sync Strategy:**
- Background sync when connection restored
- Conflict resolution for stale data
- Progress indicators for sync operations

### Testing Strategy

**Unit Tests:**
- Provider state management
- Contract interaction logic
- Data transformation functions

**Widget Tests:**
- UI component behavior
- Form validation
- Navigation flows

**Integration Tests:**
- End-to-end user flows
- Contract interaction testing
- Error scenario handling

### Performance Optimization

**Data Management:**
- Lazy loading of budget details
- Pagination for large data sets
- Efficient state updates

**Network Optimization:**
- Batch contract calls where possible
- Cache frequently accessed data
- Minimize blockchain queries

### Accessibility Features

**Screen Reader Support:**
- Semantic labels for all interactive elements
- Proper navigation order
- Alternative text for images

**Visual Accessibility:**
- High contrast mode support
- Scalable text sizing
- Color-blind friendly design

### Future Enhancements

**Advanced Features:**
- Budget sharing/collaboration
- Automated investment integration
- Analytics and insights dashboard
- Notification system for releases

**Technical Improvements:**
- Multi-chain support
- Layer 2 integration
- Enhanced offline capabilities
- Progressive Web App version

This specification provides a comprehensive foundation for building a robust, user-friendly Budgetly frontend that fully integrates with the smart contract while providing excellent user experience and security.
