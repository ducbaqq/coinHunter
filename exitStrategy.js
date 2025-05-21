const { logger } = require('./logger');
const {
  PROFIT_TARGET_PERCENT,
  TRADE_TIME_LIMIT_MINUTES,
  TRAILING_STOP_PERCENT,
} = require('./config');
const {
  simulateSell,
  updatePeakPrice,
  getActivePositions,
} = require('./tradingLogic');
const { getCurrentPrice } = require('./solanaService');

/**
 * Checks exit conditions for a single active position.
 * @param {Object} position - The active trade position object.
 * @returns {Promise<boolean>} True if a sell was triggered, false otherwise.
 */
async function checkExitConditions(position) {
  logger.debug(`Checking exit conditions for token: ${position.tokenMintAddress}, pool: ${position.poolId}`);

  const currentPriceInSol = await getCurrentPrice(position.poolId);

  if (currentPriceInSol === null || currentPriceInSol <= 0) {
    logger.error(`Failed to fetch valid current price for ${position.tokenMintAddress} (pool: ${position.poolId}). Price: ${currentPriceInSol}. Skipping exit checks for this position.`);
    return false;
  }
  logger.debug(`Current price for ${position.tokenMintAddress} is ${currentPriceInSol} SOL.`);

  // a. Update Peak Price
  // updatePeakPrice from tradingLogic will update the position object in its internal activePositions list.
  // For the subsequent checks in this function call, we'll use currentPriceInSol and the position object
  // which might have its peakPrice updated by the call below if currentPriceInSol was higher.
  // The activePositions array in tradingLogic is the source of truth.
  await updatePeakPrice(position.tokenMintAddress, currentPriceInSol);
  
  // Re-fetch the position to ensure we have the latest peakPrice for checks.
  // This is important because updatePeakPrice modifies the list in tradingLogic.
  // A more optimized way might be for updatePeakPrice to return the updated position,
  // but getActivePositions() returns copies, so direct mutation isn't an issue here for stale data within this function's scope
  // *Correction*: The `position` object passed in is a copy. `updatePeakPrice` updates the original in `tradingLogic`.
  // For the logic below, we need the potentially updated peakPrice.
  // We will fetch all positions again, then find our current one. This is slightly inefficient but ensures data integrity for the checks.
  // A better design might be for updatePeakPrice to return the updated position, or for checkExitConditions to operate on indices.
  // For now, let's assume that `position.peakPrice` will be updated if `tradingLogic.js` handles its internal array well,
  // and the `position` object we have here is a snapshot. The `peakPrice` from `position` is what it was *before* this `currentPriceInSol`.
  // The TRADING_LOGIC.updatePeakPrice *should* update the object in the activePositions array.
  // Let's rely on the fact that the `position` object we have is from `getActivePositions` which is a copy.
  // The `peakPrice` on *this specific `position` object* won't be updated by `updatePeakPrice`.
  // We need to fetch the updated position or rely on `currentPriceInSol` for up-to-date checks where possible.
  // For trailing stop, we critically need the latest peak price.
  
  // Fetch the potentially updated position from the source of truth
  const allCurrentPositions = getActivePositions(); // Get fresh copies
  const potentiallyUpdatedPosition = allCurrentPositions.find(p => p.tokenMintAddress === position.tokenMintAddress);

  if (!potentiallyUpdatedPosition) {
      logger.warn(`Position ${position.tokenMintAddress} seems to have been sold or removed during peak price update. Skipping further checks.`);
      return false; // Position might have been sold by another concurrent check or process
  }
  // Use this potentiallyUpdatedPosition for subsequent checks involving peakPrice.
  const activePeakPrice = potentiallyUpdatedPosition.peakPrice;


  // b. Profit Target Check
  const profit = (currentPriceInSol - potentiallyUpdatedPosition.buyPrice) / potentiallyUpdatedPosition.buyPrice;
  if (profit >= PROFIT_TARGET_PERCENT) {
    logger.info(`Profit target hit for ${potentiallyUpdatedPosition.tokenMintAddress}. Profit: ${(profit * 100).toFixed(2)}%. Current Price: ${currentPriceInSol}, Buy Price: ${potentiallyUpdatedPosition.buyPrice}.`);
    await simulateSell(potentiallyUpdatedPosition, currentPriceInSol, 'profit_target');
    return true;
  }

  // c. Trailing Stop Check
  // Check if profit target was ever achieved by comparing peakPrice against initial profit target
  const profitTargetAchievedPreviously = activePeakPrice > potentiallyUpdatedPosition.buyPrice * (1 + PROFIT_TARGET_PERCENT);
  if (profitTargetAchievedPreviously && currentPriceInSol < activePeakPrice * (1 - TRAILING_STOP_PERCENT)) {
    logger.info(`Trailing stop triggered for ${potentiallyUpdatedPosition.tokenMintAddress}. Current Price: ${currentPriceInSol}, Peak Price: ${activePeakPrice}, Stop Price: ${activePeakPrice * (1 - TRAILING_STOP_PERCENT)}.`);
    await simulateSell(potentiallyUpdatedPosition, currentPriceInSol, 'trailing_stop');
    return true;
  }

  // d. Time Limit Check
  const elapsedMinutes = (Date.now() - potentiallyUpdatedPosition.buyTimestamp) / (1000 * 60);
  if (elapsedMinutes >= TRADE_TIME_LIMIT_MINUTES) {
    logger.info(`Time limit reached for ${potentiallyUpdatedPosition.tokenMintAddress}. Elapsed: ${elapsedMinutes.toFixed(2)} mins, Limit: ${TRADE_TIME_LIMIT_MINUTES} mins.`);
    await simulateSell(potentiallyUpdatedPosition, currentPriceInSol, 'time_limit');
    return true;
  }

  logger.debug(`No exit conditions met for ${potentiallyUpdatedPosition.tokenMintAddress}.`);
  return false;
}

/**
 * Iterates through active trades and checks exit conditions.
 * This function is intended to be called periodically by the main application loop.
 */
async function monitorTrades() {
  const positions = getActivePositions(); // Gets a fresh copy of active positions

  if (positions.length === 0) {
    // logger.debug('No active positions to monitor.');
    return;
  }

  logger.info(`Monitoring ${positions.length} active positions...`);

  for (const position of positions) {
    // If a position is sold, simulateSell removes it from the original list in tradingLogic.
    // The 'positions' array here is a snapshot. If a sell occurs,
    // subsequent iterations in this loop for *other* positions will still use this snapshot.
    // However, checkExitConditions will fetch the latest price and use the most current data
    // from tradingLogic for its decisions (especially after the peakPrice update logic).
    // This is generally fine for a simulation.
    // If checkExitConditions returns true, a sell happened. We could break or log.
    // The primary concern of list modification during iteration is somewhat mitigated because
    // getActivePositions() returns a copy, and simulateSell modifies the source list.
    // If `checkExitConditions` modifies `position` directly AND `getActivePositions` returned direct references,
    // that would be a different problem.
    await checkExitConditions(position);
    // Small delay if needed to avoid hammering APIs, though getCurrentPrice should handle its own rate limiting if any.
    // await new Promise(resolve => setTimeout(resolve, 100)); // Example: 100ms delay
  }
}

module.exports = {
  monitorTrades,
  // checkExitConditions, // Export if direct calling is needed for testing or specific scenarios
};
