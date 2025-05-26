// Service for investment-related calculations

/**
 * Calculates the investment allocation for a given token based on its data,
 * available SOL, and maximum allocation percentage.
 *
 * @param {object} tokenData - An object containing token information.
 *                             Expected properties: liquidityUSD (number), marketCapUSD (number).
 * @param {number} availableSol - The amount of SOL available in the wallet.
 * @param {number} maxAllocationPercent - The maximum percentage of availableSol to allocate
 *                                        to a single token (e.g., 0.2 for 20%).
 * @returns {object|number} - If the token is skipped, returns an object { allocate: false, reason: string, allocationSOL: 0 }.
 *                            Otherwise, returns the calculated allocation amount in SOL (number).
 *                            For consistency, perhaps always return an object: { allocate: true, allocationSOL: number }
 */
function calculateInvestmentAllocation(tokenData, availableSol, maxAllocationPercent) {
  // Ensure tokenData has the required fields and they are numbers
  if (!tokenData || typeof tokenData.liquidityUSD !== 'number' || typeof tokenData.marketCapUSD !== 'number') {
    console.error("Invalid tokenData provided:", tokenData);
    return { allocate: false, reason: "Invalid or incomplete token data provided.", allocationSOL: 0 };
  }
  if (typeof availableSol !== 'number' || availableSol < 0) {
    console.error("Invalid availableSol provided:", availableSol);
    return { allocate: false, reason: "Invalid available SOL.", allocationSOL: 0 };
  }
  if (typeof maxAllocationPercent !== 'number' || maxAllocationPercent < 0 || maxAllocationPercent > 1) {
    console.error("Invalid maxAllocationPercent provided:", maxAllocationPercent);
    return { allocate: false, reason: "Invalid maximum allocation percentage.", allocationSOL: 0 };
  }

  const tokenLiquidity = tokenData.liquidityUSD;
  const tokenMarketCap = tokenData.marketCapUSD;

  // Threshold Check
  const minLiquidity = 1000;
  const minMarketCap = 10000;

  if (tokenLiquidity < minLiquidity || tokenMarketCap < minMarketCap) {
    let reasons = [];
    if (tokenLiquidity < minLiquidity) {
      reasons.push(`Liquidity $${tokenLiquidity} < $${minLiquidity}`);
    }
    if (tokenMarketCap < minMarketCap) {
      reasons.push(`Market Cap $${tokenMarketCap} < $${minMarketCap}`);
    }
    return { allocate: false, reason: `Below threshold: ${reasons.join(', ')}`, allocationSOL: 0 };
  }

  // Calculate Scores
  const liqScore = Math.min(1, tokenLiquidity / 50000);
  const capScore = Math.min(1, tokenMarketCap / 500000);

  // Calculate Risk Score
  // riskScore = 0.6 * liqScore + 0.4 * capScore
  // The problem statement implies riskScore is used to *reduce* allocation based on risk.
  // A higher score (closer to 1) means less risky / better parameters, thus allowing fuller allocation.
  // A lower score (closer to 0) means more risky / worse parameters, thus reducing allocation.
  const riskFactor = 0.6 * liqScore + 0.4 * capScore; // Renamed for clarity from riskScore to riskFactor, as higher is better here.

  // Calculate Allocation
  // allocation = availableSol * maxAllocationPercent * riskFactor
  const allocationSOL = availableSol * maxAllocationPercent * riskFactor;

  return { allocate: true, allocationSOL: allocationSOL, riskFactor: riskFactor, liqScore: liqScore, capScore: capScore };
}

module.exports = {
  calculateInvestmentAllocation,
};

// Example Usage (for testing purposes, can be removed or commented out)
/*
const mockTokenGood = {
  address: "goodTokenAddress",
  name: "Good Token",
  symbol: "GOOD",
  priceUSD: 10,
  liquidityUSD: 60000,  // Above 50k for liqScore = 1
  marketCapUSD: 750000, // Above 500k for capScore = 1
  lastFetched: new Date()
};

const mockTokenMedium = {
  address: "mediumTokenAddress",
  name: "Medium Token",
  symbol: "MED",
  priceUSD: 5,
  liquidityUSD: 25000,  // liqScore = 0.5
  marketCapUSD: 100000, // capScore = 0.2
  lastFetched: new Date()
};

const mockTokenLowLiquidity = {
  address: "lowLiqTokenAddress",
  name: "Low Liquidity Token",
  symbol: "LOWL",
  priceUSD: 1,
  liquidityUSD: 500,    // Below threshold
  marketCapUSD: 100000,
  lastFetched: new Date()
};

const mockTokenLowMarketCap = {
  address: "lowCapTokenAddress",
  name: "Low MarketCap Token",
  symbol: "LOWMC",
  priceUSD: 1,
  liquidityUSD: 10000,
  marketCapUSD: 5000,   // Below threshold
  lastFetched: new Date()
};

const mockTokenInvalid = {
  address: "invalidTokenAddress",
  name: "Invalid Token",
  symbol: "INV",
  // liquidityUSD: missing
  marketCapUSD: 50000,
  lastFetched: new Date()
}

const availableSolBalance = 100; // Example SOL balance
const maxAllocPercent = 0.2; // As per issue, 20%

console.log("Good Token:", calculateInvestmentAllocation(mockTokenGood, availableSolBalance, maxAllocPercent));
// Expected: riskFactor = 0.6 * 1 + 0.4 * 1 = 1. allocationSOL = 100 * 0.2 * 1 = 20

console.log("Medium Token:", calculateInvestmentAllocation(mockTokenMedium, availableSolBalance, maxAllocPercent));
// liqScore = 25000 / 50000 = 0.5
// capScore = 100000 / 500000 = 0.2
// riskFactor = 0.6 * 0.5 + 0.4 * 0.2 = 0.3 + 0.08 = 0.38
// allocationSOL = 100 * 0.2 * 0.38 = 20 * 0.38 = 7.6

console.log("Low Liquidity Token:", calculateInvestmentAllocation(mockTokenLowLiquidity, availableSolBalance, maxAllocPercent));
// Expected: { allocate: false, reason: "Below threshold: Liquidity $500 < $1000", allocationSOL: 0 }

console.log("Low Market Cap Token:", calculateInvestmentAllocation(mockTokenLowMarketCap, availableSolBalance, maxAllocPercent));
// Expected: { allocate: false, reason: "Below threshold: Market Cap $5000 < $10000", allocationSOL: 0 }

console.log("Invalid Token Data:", calculateInvestmentAllocation(mockTokenInvalid, availableSolBalance, maxAllocPercent));
// Expected: { allocate: false, reason: "Invalid or incomplete token data provided.", allocationSOL: 0 }

console.log("Invalid SOL:", calculateInvestmentAllocation(mockTokenGood, "not-a-number", maxAllocPercent));
// Expected: { allocate: false, reason: "Invalid available SOL.", allocationSOL: 0 }

console.log("Invalid Percent:", calculateInvestmentAllocation(mockTokenGood, availableSolBalance, 2)); // 200%
// Expected: { allocate: false, reason: "Invalid maximum allocation percentage.", allocationSOL: 0 }
*/
