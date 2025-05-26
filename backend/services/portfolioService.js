// backend/services/portfolioService.js

// In-memory store for portfolio
const portfolio = {
    currentSOLBalance: 100, // Initial SOL balance
    positions: new Map(), // Using a Map for easier management of positions by tokenAddress
    // Example position structure:
    // tokenAddress: {
    //   tokenAddress: string,
    //   amountHeld: number,
    //   averageBuyPriceUSD: number, // Price per token in USD
    //   initialInvestmentUSD: number, // Total USD value initially invested in this position
    //   // Optional fields for later:
    //   // stopLossPriceUSD: number, 
    //   // takeProfitPriceUSD: number 
    // }
    simulatedTradeHistory: [], // To store all simulated Trade objects
};

function getPortfolio() {
    return {
        currentSOLBalance: portfolio.currentSOLBalance,
        positions: Object.fromEntries(portfolio.positions), // Convert Map to object for easier external use/display
        simulatedTradeHistory: [...portfolio.simulatedTradeHistory],
    };
}

function getSOLBalance() {
    return portfolio.currentSOLBalance;
}

function setSOLBalance(newBalance) {
    if (typeof newBalance !== 'number' || newBalance < 0) {
        console.error("PortfolioService: Invalid attempt to set SOL balance.", newBalance);
        return false;
    }
    portfolio.currentSOLBalance = newBalance;
    console.log(`PortfolioService: SOL Balance updated to ${newBalance}`);
    return true;
}

function getPosition(tokenAddress) {
    return portfolio.positions.get(tokenAddress);
}

/**
 * Updates or adds a position to the portfolio.
 * @param {string} tokenAddress - The address of the token.
 * @param {number} amountChange - The amount of token bought (+) or sold (-).
 * @param {number} priceUSD - The current price of the token in USD.
 * @param {number} solInvestedChange - The amount of SOL invested (+) or returned from sale (-).
 * @param {number} usdValueChange - The USD value of the tokens bought (+) or sold (-).
 */
function updatePosition(tokenAddress, amountChange, priceUSD, solInvestedChange, usdValueChange) {
    let position = portfolio.positions.get(tokenAddress);

    if (!position && amountChange <= 0) {
        console.error(`PortfolioService: Attempted to sell non-existent position for ${tokenAddress}`);
        return null;
    }

    if (!position) { // New buy
        position = {
            tokenAddress,
            amountHeld: amountChange,
            averageBuyPriceUSD: priceUSD,
            initialInvestmentUSD: usdValueChange, // USD value of this first buy
            // For simplicity, averageBuyPrice is the first price. Re-calculation needed for subsequent buys.
        };
        portfolio.positions.set(tokenAddress, position);
        console.log(`PortfolioService: New position ADDED for ${tokenAddress}`, position);
    } else { // Existing position
        if (amountChange > 0) { // Subsequent buy
            const currentTotalValue = position.amountHeld * position.averageBuyPriceUSD;
            const newTotalValue = currentTotalValue + usdValueChange;
            position.amountHeld += amountChange;
            position.averageBuyPriceUSD = newTotalValue / position.amountHeld; // Recalculate average buy price
            position.initialInvestmentUSD += usdValueChange; // Add to total USD invested
            console.log(`PortfolioService: Position UPDATED (buy) for ${tokenAddress}`, position);
        } else { // Sell
            position.amountHeld += amountChange; // amountChange is negative for sells
            // averageBuyPriceUSD and initialInvestmentUSD typically don't change on sell,
            // unless you want to track remaining initialInvestmentUSD, but that's complex.
            // For now, they reflect the history of buys.
            console.log(`PortfolioService: Position UPDATED (sell) for ${tokenAddress}`, position);

            if (position.amountHeld <= 0.000001) { // Using a small threshold for floating point issues
                portfolio.positions.delete(tokenAddress);
                console.log(`PortfolioService: Position REMOVED for ${tokenAddress} (fully sold).`);
                return null; // Position closed
            }
        }
    }
    return portfolio.positions.get(tokenAddress); // Return the updated or new position
}


function addTradeToHistory(trade) {
    portfolio.simulatedTradeHistory.push(trade);
    console.log(`PortfolioService: Trade logged for ${trade.tokenId}, Type: ${trade.type}, Status: ${trade.status}`);
}

function getTradeHistory() {
    return [...portfolio.simulatedTradeHistory];
}


module.exports = {
    getPortfolio,
    getSOLBalance,
    setSOLBalance,
    getPosition,
    updatePosition,
    addTradeToHistory,
    getTradeHistory,
};

// Example usage:
/*
console.log("Initial Portfolio:", getPortfolio());
setSOLBalance(90);
const newPos = updatePosition("TOKEN_A", 10, 5, 10, 50); // Buy 10 TOKEN_A at $5/token, cost 10 SOL ($50 value)
console.log("Portfolio after buy:", getPortfolio());
const updatedPos = updatePosition("TOKEN_A", -5, 6, -5, -30); // Sell 5 TOKEN_A at $6/token, gain 5 SOL ($30 value)
console.log("Portfolio after sell:", getPortfolio());
const closedPos = updatePosition("TOKEN_A", -5, 6, -5, -30); // Sell remaining 5 TOKEN_A
console.log("Portfolio after closing position:", getPortfolio());
console.log("Position TOKEN_A after close:", getPosition("TOKEN_A")); // Should be undefined
*/
