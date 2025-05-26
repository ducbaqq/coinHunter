// backend/services/tradingService.js
const portfolioService = require('./portfolioService');
const apiClient = require('./apiClient'); // apiClient.fetchTokenData, and we'll add fetchSolPriceUSD
const investmentService = require('./investmentService');
const Trade = require('../models/trade'); // For logging trades

// Placeholder for SOL/USD price. Will be fetched and cached.
let currentSolPriceUSD = null; 
const SOL_PRICE_CACHE_TTL_MS = 5 * 60 * 1000; // Cache SOL price for 5 minutes

/**
 * Fetches and caches the current SOL/USD price.
 * For now, it will try to get it from Raydium's SOL-USDC pair.
 * A dedicated price feed might be better in a real scenario.
 */
async function refreshSolPriceUSD() {
    console.log("Attempting to refresh SOL/USD price...");
    try {
        // Option 1: Use fetchTokenData for SOL itself, if it reliably gives USD price.
        // const solTokenData = await apiClient.fetchTokenData("So11111111111111111111111111111111111111112"); // SOL mint address
        // if (solTokenData && solTokenData.priceUSD) {
        //     currentSolPriceUSD = solTokenData.priceUSD;
        //     portfolioService.set('sol_price_usd', currentSolPriceUSD, SOL_PRICE_CACHE_TTL_MS); // Using portfolioService as a generic cache for this
        //     console.log(`TradingService: SOL/USD price updated to $${currentSolPriceUSD} (from SOL token data)`);
        //     return currentSolPriceUSD;
        // }

        // Option 2: More directly look for a SOL/USDC pair from Raydium's all_pairs (if apiClient exposes it or we fetch it)
        // This logic is similar to what's in apiClient.js for finding pairs.
        // For simplicity, we'll assume apiClient can provide this, or we add a dedicated function there.
        // Let's add fetchSolPriceUSD to apiClient.js

        const solPriceData = await apiClient.fetchSolPriceUSD(); // This function needs to be created in apiClient.js
        if (solPriceData && solPriceData.price) {
            currentSolPriceUSD = solPriceData.price;
            // We need a generic cache, let's use the existing cacheService for this
            const cacheService = require('./cacheService'); // Import it here if not already available globally
            cacheService.set('sol_price_usd', currentSolPriceUSD, SOL_PRICE_CACHE_TTL_MS);
            console.log(`TradingService: SOL/USD price updated to $${currentSolPriceUSD}`);
            return currentSolPriceUSD;
        } else {
            console.warn("TradingService: Could not refresh SOL/USD price from apiClient.fetchSolPriceUSD.");
            return null;
        }

    } catch (error) {
        console.error("TradingService: Error refreshing SOL/USD price:", error.message);
        return null;
    }
}

// Periodically refresh SOL price
// setInterval(refreshSolPriceUSD, SOL_PRICE_CACHE_TTL_MS); // Refresh a bit before cache expires
// Or refresh on demand / before trades if it's been a while.


/**
 * Gets the current SOL/USD price, fetching if necessary or using cache.
 */
async function getSolPriceUSD() {
    const cacheService = require('./cacheService');
    let price = cacheService.get('sol_price_usd');
    if (price) {
        console.log("Using cached SOL/USD price:", price);
        currentSolPriceUSD = price; // Update local variable as well
        return price;
    }
    // If not cached, refresh it
    return await refreshSolPriceUSD();
}


/**
 * Initiates a simulated buy order for a token.
 * @param {string} tokenAddress - The address of the token to buy.
 * @param {object} currentTokenData - The current market data for the token (from fetchTokenData).
 * @returns {object|null} Details of the buy or null if skipped.
 */
async function initiateBuyOrder(tokenAddress, currentTokenData) {
    console.log(`TradingService: Attempting SIMULATED BUY for ${tokenAddress}`);

    if (!currentTokenData || typeof currentTokenData.priceUSD !== 'number') {
        console.error(`TradingService: Invalid currentTokenData for buy order of ${tokenAddress}`, currentTokenData);
        portfolioService.addTradeToHistory(new Trade(tokenAddress, 'buy', 0, 0, new Date(), 'failed_pre_check_invalid_data'));
        return null;
    }

    const solPrice = await getSolPriceUSD();
    if (!solPrice) {
        console.error(`TradingService: Cannot execute buy for ${tokenAddress}, SOL/USD price is unavailable.`);
        portfolioService.addTradeToHistory(new Trade(tokenAddress, 'buy', 0, currentTokenData.priceUSD, new Date(), 'failed_pre_check_no_sol_price'));
        return null;
    }

    const availableSolForPortfolio = portfolioService.getSOLBalance();
    // Using maxAllocationPercent from a config or hardcoded for now
    // Per issue: "app should automatically invest a calculated amount... upon input"
    // This means the "availableSolForInvestment" is effectively the portfolio's current SOL balance,
    // and calculateInvestmentAllocation will determine how much of *that* to use.
    const maxAllocationPercent = 0.20; // Example: invest up to 20% of current total SOL balance per token

    const allocationResult = investmentService.calculateInvestmentAllocation(
        currentTokenData,
        availableSolForPortfolio,
        maxAllocationPercent
    );

    if (!allocationResult.allocate || allocationResult.allocationSOL <= 0) {
        console.log(`TradingService: Skipping buy for ${tokenAddress} due to investment criteria. Reason: ${allocationResult.reason}`);
        // Log a 'skipped' or 'failed' trade for this attempt for audit.
        portfolioService.addTradeToHistory(new Trade(tokenAddress, 'buy', 0, currentTokenData.priceUSD, new Date(), `skipped_investment_criteria: ${allocationResult.reason}`));
        return null;
    }

    let amountSOLToInvest = allocationResult.allocationSOL;

    // Ensure we don't invest more SOL than available
    if (amountSOLToInvest > availableSolForPortfolio) {
        console.warn(`TradingService: Calculated SOL investment (${amountSOLToInvest}) exceeds available SOL (${availableSolForPortfolio}). Adjusting to available SOL.`);
        amountSOLToInvest = availableSolForPortfolio;
    }
    
    if (amountSOLToInvest <= 0) {
        console.log(`TradingService: Skipping buy for ${tokenAddress} as amountSOLToInvest is zero or less.`);
        return null;
    }

    const tokenPriceInUSD = currentTokenData.priceUSD;
    const amountOfTokenBought = (amountSOLToInvest * solPrice) / tokenPriceInUSD;
    const usdValueOfInvestment = amountSOLToInvest * solPrice;

    // Simulate the buy:
    const previousSOLBalance = portfolioService.getSOLBalance();
    const newSOLBalance = previousSOLBalance - amountSOLToInvest;
    portfolioService.setSOLBalance(newSOLBalance);

    const updatedPosition = portfolioService.updatePosition(
        tokenAddress,
        amountOfTokenBought,
        tokenPriceInUSD,
        amountSOLToInvest, // solInvestedChange is positive
        usdValueOfInvestment // usdValueChange is positive
    );

    const trade = new Trade(
        tokenAddress,
        'buy',
        amountSOLToInvest,
        tokenPriceInUSD,
        new Date(),
        'simulated_completed'
    );
    portfolioService.addTradeToHistory(trade);

    console.log(`TradingService: SIMULATED BUY for ${amountOfTokenBought.toFixed(6)} ${currentTokenData.symbol || tokenAddress} @ $${tokenPriceInUSD.toFixed(6)}/token. Cost: ${amountSOLToInvest.toFixed(4)} SOL ($${usdValueOfInvestment.toFixed(2)}). New SOL Balance: ${newSOLBalance.toFixed(4)}`);
    
    return { trade, position: updatedPosition };
}


/**
 * Initiates a simulated sell order for a token.
 * @param {string} tokenAddress - The address of the token to sell.
 * @param {number} percentageToSell - Percentage of the holding to sell (e.g., 100 for 100%).
 * @param {object} currentTokenData - Current market data for the token.
 * @param {string} reason - Reason for the sell (e.g., "stop-loss", "take-profit").
 * @returns {object|null} Details of the sell or null if failed.
 */
async function initiateSellOrder(tokenAddress, percentageToSell, currentTokenData, reason) {
    console.log(`TradingService: Attempting SIMULATED SELL for ${tokenAddress}, Reason: ${reason}`);

    const position = portfolioService.getPosition(tokenAddress);
    if (!position || position.amountHeld <= 0) {
        console.error(`TradingService: No position to sell for ${tokenAddress}.`);
        portfolioService.addTradeToHistory(new Trade(tokenAddress, 'sell', 0, currentTokenData?.priceUSD || 0, new Date(), 'failed_no_position'));
        return null;
    }

    if (!currentTokenData || typeof currentTokenData.priceUSD !== 'number') {
        console.error(`TradingService: Invalid currentTokenData for sell order of ${tokenAddress}`, currentTokenData);
        portfolioService.addTradeToHistory(new Trade(tokenAddress, 'sell', 0, 0, new Date(), 'failed_invalid_data'));
        return null;
    }
    
    const solPrice = await getSolPriceUSD();
    if (!solPrice) {
        console.error(`TradingService: Cannot execute sell for ${tokenAddress}, SOL/USD price is unavailable.`);
        portfolioService.addTradeToHistory(new Trade(tokenAddress, 'sell', 0, currentTokenData.priceUSD, new Date(), 'failed_no_sol_price'));
        return null;
    }

    const amountOfTokenToSell = position.amountHeld * (percentageToSell / 100);
    if (amountOfTokenToSell <= 0) {
        console.log(`TradingService: Sell amount is zero or less for ${tokenAddress}. Skipping sell.`);
        return null;
    }
    
    const tokenPriceInUSD = currentTokenData.priceUSD;
    const usdValueOfSale = amountOfTokenToSell * tokenPriceInUSD;
    const proceedsSOL = usdValueOfSale / solPrice;

    // Simulate the sell:
    const previousSOLBalance = portfolioService.getSOLBalance();
    const newSOLBalance = previousSOLBalance + proceedsSOL;
    portfolioService.setSOLBalance(newSOLBalance);

    const updatedPosition = portfolioService.updatePosition(
        tokenAddress,
        -amountOfTokenToSell, // amountChange is negative for sells
        tokenPriceInUSD,
        -proceedsSOL, // solInvestedChange is negative (SOL returned)
        -usdValueOfSale // usdValueChange is negative (USD value removed from position)
    );

    const trade = new Trade(
        tokenAddress,
        'sell',
        proceedsSOL, // Log SOL gained
        tokenPriceInUSD,
        new Date(),
        'simulated_completed'
    );
    trade.reasonForTrade = reason; // Add reason to trade object
    portfolioService.addTradeToHistory(trade);

    console.log(`TradingService: SIMULATED SELL of ${amountOfTokenToSell.toFixed(6)} ${currentTokenData.symbol || tokenAddress} @ $${tokenPriceInUSD.toFixed(6)}/token. Proceeds: ${proceedsSOL.toFixed(4)} SOL ($${usdValueOfSale.toFixed(2)}). Reason: ${reason}. New SOL Balance: ${newSOLBalance.toFixed(4)}`);
    
    return { trade, position: updatedPosition };
}


/**
 * Checks automated trading rules (stop-loss, take-profit) for a token.
 * @param {string} tokenAddress - The address of the token.
 * @param {object} currentTokenData - Current market data for the token.
 */
async function checkAutomatedTradingRules(tokenAddress, currentTokenData) {
    const position = portfolioService.getPosition(tokenAddress);

    if (!position || position.amountHeld <= 0 || typeof position.averageBuyPriceUSD !== 'number') {
        // No position, or not enough data to make a decision
        return;
    }

    if (!currentTokenData || typeof currentTokenData.priceUSD !== 'number') {
        console.warn(`TradingService: checkAutomatedTradingRules - Invalid currentTokenData for ${tokenAddress}`);
        return;
    }

    const currentPriceUSD = currentTokenData.priceUSD;
    const buyPriceUSD = position.averageBuyPriceUSD;

    // Define thresholds (could be configurable per token later)
    const takeProfitMultiplier = 1.20; // 20% profit
    const stopLossMultiplier = 0.90;   // 10% loss

    // Take Profit Check
    if (currentPriceUSD >= buyPriceUSD * takeProfitMultiplier) {
        console.log(`TradingService: TAKE-PROFIT condition met for ${tokenAddress}. Current: $${currentPriceUSD}, Buy: $${buyPriceUSD}`);
        await initiateSellOrder(tokenAddress, 100, currentTokenData, "take-profit");
    } 
    // Stop Loss Check (else if, so we don't sell for stop-loss if take-profit already triggered in the same check)
    else if (currentPriceUSD <= buyPriceUSD * stopLossMultiplier) {
        console.log(`TradingService: STOP-LOSS condition met for ${tokenAddress}. Current: $${currentPriceUSD}, Buy: $${buyPriceUSD}`);
        await initiateSellOrder(tokenAddress, 100, currentTokenData, "stop-loss");
    }
}


module.exports = {
    initiateBuyOrder,
    initiateSellOrder,
    checkAutomatedTradingRules,
    getSolPriceUSD, // Expose for potential external use or initial fetch
    refreshSolPriceUSD, // Expose for explicit refresh if needed
};

// Initialize SOL Price on startup
getSolPriceUSD(); // Fetch and cache SOL/USD price when service loads.
setInterval(refreshSolPriceUSD, SOL_PRICE_CACHE_TTL_MS - 30000); // Periodically refresh SOL price, slightly before TTL

// Example of how this might be called (e.g., from server.js when a token update is received)
/*
async function handleTokenUpdateFromServer(updatedTokenData) {
    // ... (update token in main list, broadcast to clients) ...

    // Then, check trading rules if it's a token we have a position in
    const position = portfolioService.getPosition(updatedTokenData.address);
    if (position && position.amountHeld > 0) {
        await checkAutomatedTradingRules(updatedTokenData.address, updatedTokenData);
    }
}
*/
