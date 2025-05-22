const { logger, logCompletedTrade } = require('./logger');
const {
  VIRTUAL_BUDGET_SOL,
  TRADE_SIZE_SOL,
  MAX_CONCURRENT_POSITIONS,
  RAYDIUM_FEE_PERCENT,
  // Other config if needed for slippage calculation later
} = require('./config');
const { saveActiveTrades, loadActiveTrades } = require('./stateManager');
const { getCurrentPrice } = require('./solanaService'); // Though not directly used in this file's logic yet, good for context

// --- Placeholder Utility Functions (to be moved and properly implemented later) ---
/**
 * Placeholder for calculating tokens received for a given SOL amount.
 * @param {number} solAmount - Amount of SOL to spend.
 * @param {number} currentPriceInSol - Current price of the token in SOL.
 * @param {number} feePercent - Trading fee percentage.
 * @param {number} slippagePercent - Simulated slippage percentage.
 * @returns {number} Calculated amount of tokens.
 */
function calculateTokensForSol(solAmount, currentPriceInSol, feePercent, slippagePercent) {
  if (currentPriceInSol <= 0) return 0;
  const solAfterFee = solAmount * (1 - feePercent);
  const tokensBeforeSlippage = solAfterFee / currentPriceInSol;
  const tokensAfterSlippage = tokensBeforeSlippage * (1 - slippagePercent);
  logger.debug(`calculateTokensForSol: SOL_in=${solAmount}, price=${currentPriceInSol}, fee=${feePercent}, slippage=${slippagePercent} => Tokens_out=${tokensAfterSlippage}`);
  return tokensAfterSlippage;
}

/**
 * Placeholder for calculating SOL received for a given token amount.
 * @param {number} tokenAmount - Amount of tokens to sell.
 * @param {number} currentPriceInSol - Current price of the token in SOL.
 * @param {number} feePercent - Trading fee percentage.
 * @param {number} slippagePercent - Simulated slippage percentage.
 * @returns {number} Calculated amount of SOL.
 */
function calculateSolForTokens(tokenAmount, currentPriceInSol, feePercent, slippagePercent) {
  if (currentPriceInSol <= 0) return 0;
  const tokensToSell = tokenAmount; // Assume all tokens are sold
  const solBeforeFeeAndSlippage = tokensToSell * currentPriceInSol;
  const solAfterFee = solBeforeFeeAndSlippage * (1 - feePercent);
  const solAfterSlippage = solAfterFee * (1 - slippagePercent);
  logger.debug(`calculateSolForTokens: Tokens_in=${tokenAmount}, price=${currentPriceInSol}, fee=${feePercent}, slippage=${slippagePercent} => SOL_out=${solAfterSlippage}`);
  return solAfterSlippage;
}
// --- End Placeholder Utility Functions ---


let virtualBudget = VIRTUAL_BUDGET_SOL;
let activePositions = []; // Array of trade objects

/**
 * Initializes the trading module by loading active positions.
 */
async function initializeTrading() {
  const loadedTrades = await loadActiveTrades();
  if (loadedTrades && loadedTrades.length > 0) {
    activePositions = loadedTrades;
    // Optional: Adjust virtualBudget based on loaded trades if needed.
    // For now, assume virtualBudget starts fresh as VIRTUAL_BUDGET_SOL,
    // and loaded trades represent ongoing positions that don't reclaim their initial cost
    // until sold. The budget reflects *available* SOL for new trades.
    // If loaded trades should reduce the initial budget:
    // let committedSol = 0;
    // activePositions.forEach(pos => committedSol += pos.tradeSizeSol || TRADE_SIZE_SOL);
    // virtualBudget = VIRTUAL_BUDGET_SOL - committedSol;
    logger.info(`Loaded ${activePositions.length} active positions. Initial budget: ${VIRTUAL_BUDGET_SOL} SOL.`);
  } else {
    logger.info(`No active positions loaded. Initial budget: ${VIRTUAL_BUDGET_SOL} SOL.`);
  }
  // Ensure budget doesn't go negative if loaded trades exceed initial budget (edge case)
  if (virtualBudget < 0) virtualBudget = 0;
}

/**
 * Checks if a buy operation can be performed for the given token.
 * @param {string} tokenMint - The mint address of the token to buy.
 * @returns {boolean} True if buy can be performed, false otherwise.
 */
function canBuy(tokenMint) {
  if (virtualBudget < TRADE_SIZE_SOL) {
    logger.info(`Cannot buy ${tokenMint}: Insufficient virtual budget. Have ${virtualBudget}, need ${TRADE_SIZE_SOL}.`);
    return false;
  }
  if (activePositions.length >= MAX_CONCURRENT_POSITIONS) {
    logger.info(`Cannot buy ${tokenMint}: Max concurrent positions (${MAX_CONCURRENT_POSITIONS}) reached.`);
    return false;
  }
  if (activePositions.some(pos => pos.tokenMintAddress === tokenMint)) {
    logger.info(`Cannot buy ${tokenMint}: Position already exists for this token.`);
    return false;
  }
  return true;
}

/**
 * Simulates buying a token.
 * @param {string} tokenMint - The mint address of the token to buy.
 * @param {string} poolId - The ID of the pool where the token is traded.
 * @param {number} currentPriceInSol - The current market price of the token in SOL.
 * @returns {Object|null} The new position object if successful, null otherwise.
 */
async function simulateBuy(tokenMint, poolId, currentPriceInSol) {
  if (!canBuy(tokenMint)) {
    return null; // Reason already logged by canBuy
  }

  // Placeholder: Random slippage between 1% and 5% (0.01 to 0.05)
  const simulatedSlippagePercent = (Math.random() * (0.05 - 0.01) + 0.01);
  logger.info(`Simulating buy for ${tokenMint}. Price: ${currentPriceInSol} SOL. Applying ${ (simulatedSlippagePercent * 100).toFixed(2)}% slippage.`);

  const calculatedTokenAmount = calculateTokensForSol(
    TRADE_SIZE_SOL,
    currentPriceInSol,
    RAYDIUM_FEE_PERCENT,
    simulatedSlippagePercent
  );

  if (!calculatedTokenAmount || calculatedTokenAmount <= 0) {
    logger.error(`SimulateBuy Error: Calculated token amount is ${calculatedTokenAmount} for ${tokenMint}. Buy order aborted.`);
    return null;
  }

  virtualBudget -= TRADE_SIZE_SOL;

  const newPosition = {
    tokenMintAddress: tokenMint,
    poolId: poolId,
    buyPrice: currentPriceInSol, // Price before slippage and fees
    buyTimestamp: Date.now(),
    tokenAmount: calculatedTokenAmount, // Actual amount received
    peakPrice: currentPriceInSol,
    tradeSizeSol: TRADE_SIZE_SOL, // Cost in SOL for this trade
  };

  activePositions.push(newPosition);
  await saveActiveTrades(activePositions);

  logger.info(`Simulated BUY: ${newPosition.tokenAmount.toFixed(4)} ${newPosition.tokenMintAddress} at ~${newPosition.buyPrice.toPrecision(6)} SOL. Budget: ${virtualBudget.toFixed(2)} SOL.`);
  return newPosition;
}

/**
 * Simulates selling a token position.
 * @param {Object} position - The active position object to sell.
 * @param {number} currentPriceInSol - The current market price of the token in SOL.
 * @param {string} exitReason - The reason for selling (e.g., 'profit_target', 'stop_loss').
 * @returns {Object|null} Object with { solProceeds, soldPosition } if successful, null otherwise.
 */
async function simulateSell(position, currentPriceInSol, exitReason) {
  if (!position || !activePositions.find(p => p.tokenMintAddress === position.tokenMintAddress)) {
    logger.error(`SimulateSell Error: Position not found or invalid for token ${position ? position.tokenMintAddress : 'unknown'}.`);
    return null;
  }

  // Placeholder: Random slippage between 1% and 3% for selling
  const simulatedSlippagePercent = (Math.random() * (0.03 - 0.01) + 0.01);
   logger.info(`Simulating sell for ${position.tokenMintAddress}. Market Price: ${currentPriceInSol} SOL. Applying ${(simulatedSlippagePercent * 100).toFixed(2)}% slippage. Reason: ${exitReason}`);


  const calculatedSolProceeds = calculateSolForTokens(
    position.tokenAmount,
    currentPriceInSol,
    RAYDIUM_FEE_PERCENT,
    simulatedSlippagePercent
  );

  if (calculatedSolProceeds < 0) { // Can be 0 if price is effectively 0
      logger.error(`SimulateSell Error: Calculated SOL proceeds are negative (${calculatedSolProceeds}) for ${position.tokenMintAddress}. Sell order aborted.`);
      return null;
  }

  virtualBudget += calculatedSolProceeds;

  const completedTradeData = {
    ...position,
    sellPrice: currentPriceInSol, // Market price at time of sell decision
    solProceeds: calculatedSolProceeds, // Actual SOL received after fees & slippage
    exitReason: exitReason,
    sellTimestamp: Date.now(),
    profitOrLoss: calculatedSolProceeds - position.tradeSizeSol, // Simple P/L
  };
  logCompletedTrade(completedTradeData); // Log to completed_trades.json

  activePositions = activePositions.filter(p => p.tokenMintAddress !== position.tokenMintAddress);
  await saveActiveTrades(activePositions);

  logger.info(`Simulated SELL: ${position.tokenAmount.toFixed(4)} ${position.tokenMintAddress} for ${calculatedSolProceeds.toFixed(4)} SOL at ~${currentPriceInSol.toPrecision(6)} SOL. Reason: ${exitReason}. Budget: ${virtualBudget.toFixed(2)} SOL.`);
  return { solProceeds: calculatedSolProceeds, soldPosition: position };
}

/**
 * Updates the peak price for an active position.
 * @param {string} tokenMintAddress - The mint address of the token.
 * @param {number} currentPriceInSol - The current market price of the token in SOL.
 */
async function updatePeakPrice(tokenMintAddress, currentPriceInSol) {
  const position = activePositions.find(p => p.tokenMintAddress === tokenMintAddress);
  if (position) {
    if (currentPriceInSol > position.peakPrice) {
      position.peakPrice = currentPriceInSol;
      await saveActiveTrades(activePositions); // Save changes
      logger.debug(`Peak price updated for ${tokenMintAddress} to ${currentPriceInSol}.`);
    }
  } else {
    logger.warn(`Cannot update peak price: Position not found for ${tokenMintAddress}.`);
  }
}

/**
 * Returns a copy of the active positions.
 * @returns {Array<Object>}
 */
function getActivePositions() {
  return [...activePositions]; // Return a copy to prevent direct modification
}

/**
 * Returns the current virtual budget.
 * @returns {number}
 */
function getVirtualBudget() {
  return virtualBudget;
}

module.exports = {
  initializeTrading,
  canBuy,
  simulateBuy,
  simulateSell,
  updatePeakPrice,
  getActivePositions,
  getVirtualBudget,
  // Exporting placeholders for now, ideally they live elsewhere
  calculateTokensForSol,
  calculateSolForTokens
};
