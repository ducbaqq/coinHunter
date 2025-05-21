# Solana Coinsniper Bot PRD

**Version**: 1.1  
**Date**: May 21, 2025  

---

## 1. Overview

The Solana Coinsniper Bot is a tool designed to monitor the Solana blockchain for newly created liquidity pools on Raydium, simulate trades with a virtual budget, and exit positions based on predefined criteria. The bot operates in simulation mode with a 5 SOL virtual budget to validate its functionality before any real-world deployment.

### 1.1 Objectives
- Detect new liquidity pools on Raydium in real-time.
- Simulate token purchases when pools meet specific criteria.
- Execute simulated exits based on profit targets or time limits.
- Persist trade state for recovery after restarts.
- Log events efficiently for debugging and performance analysis.

---

## 2. Core Components

The bot comprises six key components:
1. **Detection of New Liquidity Pools**
2. **Token Analysis**
3. **Simulated Trading**
4. **Exit Strategy**
5. **State Management**
6. **Logging**

---

## 3. Technical Requirements

### 3.1 Detection of New Liquidity Pools
- **Method**: Leverage Solana WebSockets through `@solana/web3.js` to monitor Raydium’s program.
- **Raydium Program Address**: `675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8`
- **Trigger**: Listen for “initialize2” instructions, signaling a new liquidity pool creation.
- **Data Extraction**: Parse the transaction to retrieve the token mint address.

### 3.2 Token Analysis
- **Liquidity Check**:
  - Compute the pool’s liquidity in SOL.
  - **Minimum Requirement**: 10 SOL in liquidity (configurable based on testing).
  - Calculation: Sum the SOL value of token reserves.
- **Freeze Authority Check**:
  - Query Solana’s token program to verify the token’s freeze authority status.
  - Requirement: Freeze authority must be revoked to ensure tradability.
- **Pool Age Filter**:
  - Only proceed if the pool creation transaction is ≤ 5 minutes old (configurable).
  - Verified via transaction timestamp.
- **Decision**: Proceed only if liquidity, freeze authority, and pool age conditions are met.

### 3.3 Simulated Trading
- **Virtual Budget**: Fixed at 5 SOL (simulated, no real funds).
- **Trade Size**: 0.5 SOL per position.
- **Position Limit**: Maximum of 10 concurrent positions.
- **Buy Logic**:
  - Simulate purchasing 0.5 SOL worth of the token when a qualifying pool is detected.
  - Calculate token amount using the constant product formula, factoring in Raydium’s 0.25% fee.
  - **Slippage Simulation**: Apply 1-5% slippage based on pool liquidity (e.g., 1% for >50 SOL, 5% for 10-15 SOL).
  - Track each position with:
    - Token mint address
    - Buy price
    - Buy timestamp
    - Token amount purchased
    - Peak price (initially buy price)
- **Position Management**: Store active positions in memory and sync to persistent storage.

### 3.4 Exit Strategy
- **Profit Target**: Sell when price rises 15% above buy price.
- **Time Limit**: Sell if 1 hour elapses since purchase.
- **Trailing Stop**: Sell if price falls 5% from peak price after reaching the 15% profit threshold.
- **Sell Logic**:
  - Calculate proceeds using the constant product formula with a 0.25% fee.
  - Adjust the virtual budget based on simulated profit/loss.
  - Remove the position from active tracking.

### 3.5 State Management
- **Storage**: Maintain active trade data in a JSON file (`active_trades.json`).
- **Trade Data**:
  - Token mint address
  - Buy price
  - Buy timestamp
  - Token amount
  - Peak price (updated dynamically)
- **Recovery**:
  - On startup, load `active_trades.json` to restore active positions.
  - Default to an empty state if the file is absent.
- **Updates**:
  - Append new trades on buy.
  - Remove trades on sell.

### 3.6 Logging
- **Tool**: Utilize Winston for structured logging.
- **Levels**: Info for events, Error for exceptions.
- **Events to Log**:
  - New pool detection
  - Buy decisions (token address, price)
  - Sell decisions (token address, price, reason: profit, time, trailing stop)
  - Errors
- **Completed Trades Log**: Maintain a separate `completed_trades.json` for final PNL review, including exit reason.
- **Constraints**:
  - Cap log file size at 10MB.
  - Retain the last 5 log files with rotation.

---

## 4. Workflows

### 4.1 Startup Workflow
1. Load `active_trades.json` to restore prior trades.
2. Connect to Solana mainnet via WebSocket.
3. Subscribe to account updates for active trade token addresses.
4. Start monitoring Raydium’s program for new pool creations.

### 4.2 New Pool Detection Workflow
1. Identify an “initialize2” instruction on Raydium’s program.
2. Extract the token mint address.
3. Validate the token:
   - Confirm liquidity ≥ 10 SOL.
   - Verify revoked freeze authority.
   - Confirm pool age ≤ 5 minutes.
4. If valid, initiate a simulated buy.

### 4.3 Simulated Buy Workflow
1. Verify virtual budget ≥ 0.5 SOL and active positions < 10.
2. If conditions met, simulate a 0.5 SOL buy:
   - Compute token amount with constant product formula, 0.25% fee, and simulated slippage.
   - Store position details in memory and `active_trades.json`.
3. Start price monitoring for exit conditions.

### 4.4 Price Monitoring and Exit Workflow
1. Check each active trade’s price every 5 seconds.
2. Fetch current price from pool reserve data with fallback sources (e.g., Helius token price API, Coingecko for known tokens).
3. Update peak price if current price exceeds it.
4. Evaluate exit conditions:
   - Profit ≥ 15%: Sell.
   - Time ≥ 1 hour: Sell.
   - Price drops 5% from peak post-15% profit: Sell.
5. On sell:
   - Compute proceeds with constant product formula, 0.25% fee, and simulated slippage.
   - Update virtual budget.
   - Clear trade from memory and `active_trades.json`.
   - Log to `completed_trades.json` with exit reason.

---

## 5. Risk Management
- **Trade Size**: Cap at 0.5 SOL to spread risk.
- **Position Cap**: Limit to 10 trades to manage exposure.
- **Budget Check**: Block buys if budget < 0.5 SOL.
- **Time Limit**: 1-hour cap to mitigate rugpull risks.
- **Trailing Stop**: Secure profits with a 5% drop trigger post-profit.

---

## 6. Edge Cases and Error Handling

### 6.1 WebSocket Disconnections
- Implement reconnection logic to restore the WebSocket link.
- Log disconnection and reconnection events.

### 6.2 Multiple New Pools
- Support concurrent pool detection with asynchronous processing.
- Ensure non-blocking execution for high-volume scenarios.

### 6.3 Price Calculation
- Apply constant product formula:
  - Buy: Tokens received for 0.5 SOL.
  - Sell: SOL received for token amount.
- Include Raydium’s 0.25% fee and simulated slippage in all calculations.

### 6.4 Budget or Position Limits
- Skip buys if budget < 0.5 SOL or 10 positions are active.
- Log skipped trades for transparency.

### 6.5 Data Errors
- Handle malformed transaction data or price fetch failures gracefully.
- Log errors and proceed with unaffected trades.

---

## 7. Testing and Validation

### 7.1 Simulation Mode
- Run the bot with a 5 SOL virtual budget for multiple days.
- Measure:
  - Total trades
  - Virtual profit/loss
  - Exit distribution (profit, time, trailing stop)

### 7.2 Parameter Tuning
- Test hold times (e.g., 30 min, 1 hr, 2 hrs) for optimization.
- Adjust profit target (15-20%) and trailing stop based on results.

### 7.3 Backtesting
- Run backtests on one week of historical transactions to verify detection and pricing logic.
- **Data Source**: Use Helius webhook history or Raydium’s historical logs for pool creation and price data.

---

## 8. Technical Stack
- **Language**: JavaScript (Node.js)
- **Libraries**:
  - `@solana/web3.js`: Blockchain and WebSocket interactions.
  - `winston`: Logging with rotation.
- **RPC**: Use QuickNode for Solana RPC access.
- **RPC Rate Limiting**: Batch price queries for active trades to minimize RPC calls and avoid rate limits.

---

## 9. Security Considerations
- **Simulation Only**: Ensure no real transactions occur.
- **Test Wallet**: Use an empty wallet for queries.
- **Data Validation**: Verify all blockchain data integrity.

---

## 10. Future Enhancements
- **Dynamic Position Sizing**: Implement configurable trade sizes (e.g., 0.25-1 SOL) based on pool liquidity or volatility.
- **Alerting**: Support Telegram or Discord alerts for new trades, sells, and errors, configurable via environment variables.
- **Front-Running Risk**: Monitor transaction confirmation times and mempool latency for real trading scenarios.
- **Anti-Sybil and Honeypot Detection**:
  - Query token metadata and check for known honeypot patterns (e.g., via `getTokenLargestAccounts` or `getTokenAccountsByOwner`).
- **Filters**: Add liquidity lock or supply checks.
- **Stop-Loss**: Introduce loss-limiting exits.
- **Multi-DEX**: Expand to other Solana DEXs (e.g., Orca).

---

This PRD provides a detailed plan for the Solana Coinsniper Bot, covering all technical aspects and contingencies for successful execution.