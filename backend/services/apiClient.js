const axios = require('axios');
const Token = require('../models/token'); // Assuming Token model is in ../models/token.js
const cache = require('./cacheService'); // Import the cache service

const HELIUS_API_KEY = process.env.HELIUS_API_KEY || 'YOUR_HELIUS_API_KEY'; // Placeholder, use environment variables
const HELIUS_API_BASE_URL = 'https://mainnet.helius-rpc.com'; // Corrected Helius RPC endpoint

const RAYDIUM_API_BASE_URL = 'https://api.raydium.io/v2';

const TOKEN_DATA_CACHE_TTL_MS = 60 * 1000; // 1 minute
const RAYDIUM_PAIRS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes for the general pairs list
const SOL_MINT_ADDRESS = "So11111111111111111111111111111111111111112";


/**
 * Fetches and caches the list of all pairs from Raydium.
 * @returns {Promise<Array>} A promise that resolves to an array of pairs, or an empty array on error.
 */
async function getRaydiumPairs() {
    const cacheKey = 'raydium_all_pairs';
    let allRaydiumPairs = cache.get(cacheKey);
    if (allRaydiumPairs) {
        console.log("Using cached Raydium all_pairs data.");
        return allRaydiumPairs;
    }

    try {
        console.log("Fetching all pairs from Raydium API...");
        const raydiumPairsResponse = await axios.get(`${RAYDIUM_API_BASE_URL}/main/pairs`);
        if (raydiumPairsResponse.data && Array.isArray(raydiumPairsResponse.data)) {
            allRaydiumPairs = raydiumPairsResponse.data;
            cache.set(cacheKey, allRaydiumPairs, RAYDIUM_PAIRS_CACHE_TTL_MS);
            return allRaydiumPairs;
        } else {
            console.warn(`Raydium API /main/pairs did not return expected array data:`, raydiumPairsResponse.data);
            return []; // Ensure it's an array to prevent errors
        }
    } catch (error) {
        console.error(`Error fetching all pairs from Raydium:`, error.message);
        return []; // Ensure it's an array
    }
}


/**
 * Fetches the current SOL/USD price from Raydium SOL-USDC pair.
 * @returns {Promise<object|null>} Object like { price: number } or null.
 */
async function fetchSolPriceUSD() {
    const cacheKey = 'sol_price_usd_data'; // Specific cache key for this data object
    const cachedSolPriceData = cache.get(cacheKey);
    if (cachedSolPriceData) {
        console.log("Returning cached SOL/USD price data:", cachedSolPriceData);
        return cachedSolPriceData;
    }

    console.log("Fetching SOL/USD price from Raydium pairs...");
    const allPairs = await getRaydiumPairs();
    if (!allPairs || allPairs.length === 0) {
        console.error("apiClient.fetchSolPriceUSD: Raydium pairs data is unavailable.");
        return null;
    }

    // Standard Raydium pair name for SOL/USDC
    const solUsdcPair = allPairs.find(pair => pair.name === 'SOL-USDC'); 
    
    if (solUsdcPair && typeof solUsdcPair.price === 'number') {
        const priceData = { price: solUsdcPair.price };
        cache.set(cacheKey, priceData, TOKEN_DATA_CACHE_TTL_MS); // Use a shorter TTL, same as other tokens
        console.log("Fetched and cached SOL/USD price:", priceData);
        return priceData;
    } else {
        console.warn("apiClient.fetchSolPriceUSD: Could not find SOL-USDC pair or price in Raydium data.");
        // Fallback: Try SOL-USDT if SOL-USDC is not found
        const solUsdtPair = allPairs.find(pair => pair.name === 'SOL-USDT');
        if (solUsdtPair && typeof solUsdtPair.price === 'number') {
            const priceData = { price: solUsdtPair.price };
            cache.set(cacheKey, priceData, TOKEN_DATA_CACHE_TTL_MS);
            console.log("Fetched and cached SOL/USDT price as SOL/USD:", priceData);
            return priceData;
        } else {
            console.warn("apiClient.fetchSolPriceUSD: Could not find SOL-USDT pair either.");
        }
    }
    return null;
}


/**
 * Fetches comprehensive data for a given Solana token address.
 *
 * @param {string} tokenAddress The Solana address of the token.
 * @returns {Promise<Token|null>} A Token object or null if data fetching fails.
 */
async function fetchTokenData(tokenAddress) {
  const cacheKey = `token_${tokenAddress}`;
  const cachedTokenData = cache.get(cacheKey);
  if (cachedTokenData) {
    console.log(`Returning cached data for ${tokenAddress}`);
    if (cachedTokenData.lastFetched && typeof cachedTokenData.lastFetched === 'string') {
        cachedTokenData.lastFetched = new Date(cachedTokenData.lastFetched);
    }
    return cachedTokenData;
  }

  console.log(`Fetching fresh data for ${tokenAddress}`);

  let tokenName = null;
  let tokenSymbol = null;
  let marketCapUSD = null;
  let priceUSD = null;
  let liquidityUSD = null;
  let supply = null;

  // 1. Fetch Token Metadata (Name, Symbol, Supply) from Helius
  try {
    const heliusUrl = `${HELIUS_API_BASE_URL}/?api-key=${HELIUS_API_KEY}`;
    const heliusResponse = await axios.post(heliusUrl, {
      jsonrpc: '2.0',
      id: `helius-fetch-asset-${tokenAddress}`,
      method: 'getAsset',
      params: { id: tokenAddress },
    });

    if (heliusResponse.data && heliusResponse.data.result) {
      const assetData = heliusResponse.data.result;
      tokenName = assetData.content?.metadata?.name || 'N/A';
      tokenSymbol = assetData.content?.metadata?.symbol || 'N/A';
      
      if (assetData.token_info && assetData.token_info.supply) {
          const decimals = assetData.token_info.decimals === undefined ? 0 : assetData.token_info.decimals;
          supply = assetData.token_info.supply / Math.pow(10, decimals);
      }
    } else {
      console.warn(`Helius API did not return expected data for ${tokenAddress}:`, heliusResponse.data?.error?.message || heliusResponse.data);
    }
  } catch (error) {
    console.error(`Error fetching token metadata from Helius for ${tokenAddress}:`, error.response ? error.response.data : error.message);
  }

  // 2. Fetch Liquidity and Price from Raydium
  const allRaydiumPairs = await getRaydiumPairs();

  if (allRaydiumPairs && allRaydiumPairs.length > 0) {
    let foundPair = null;
    if (tokenSymbol && tokenSymbol !== 'N/A') {
        const preferredQuotes = ['USDC', 'USDT', 'SOL']; // Prioritize pairs against these quotes
        for (const quote of preferredQuotes) {
            // Exact match for pairs like "WIF-USDC"
            foundPair = allRaydiumPairs.find(p => p.name === `${tokenSymbol}-${quote}`);
            if (foundPair) break;
        }
        
        // Fallback for cases where symbol might be slightly different in pair name (e.g. wrapped tokens)
        // or if it's not paired with preferred quotes but still the base.
        if(!foundPair) {
            foundPair = allRaydiumPairs.find(p => p.name && p.name.startsWith(`${tokenSymbol}-`));
        }
    }
    // If token is SOL, its priceUSD is the SOL/USD price
    if (tokenAddress === SOL_MINT_ADDRESS) {
        const solPriceData = await fetchSolPriceUSD();
        if (solPriceData) {
            priceUSD = solPriceData.price;
            // For SOL itself, liquidity and market cap might be fetched differently or might be vast.
            // Raydium SOL-USDC pair liquidity can be a proxy.
            const solUsdcPair = allRaydiumPairs.find(pair => pair.name === 'SOL-USDC');
            if (solUsdcPair) liquidityUSD = parseFloat(solUsdcPair.liquidity);
        }
    } else if (foundPair) {
      priceUSD = parseFloat(foundPair.price); 
      liquidityUSD = parseFloat(foundPair.liquidity);

      // If the found pair is against SOL (e.g., "MYTOKEN-SOL"), then 'price' is in terms of SOL.
      // We need to convert it to USD.
      if (foundPair.name && foundPair.name.endsWith('-SOL') && priceUSD) {
          const solPriceInUSD = await fetchSolPriceUSD();
          if (solPriceInUSD && solPriceInUSD.price) {
              priceUSD = priceUSD * solPriceInUSD.price; // Convert price from SOL to USD
              // Liquidity also needs conversion if it's expressed in SOL terms or mixed.
              // For simplicity, if liquidity is from a TOKEN-SOL pair, it's often a mix.
              // We'll assume Raydium's 'liquidity' field for pairs is already in USD value,
              // but this is a strong assumption and might need refinement for TOKEN-SOL pairs.
              console.log(`Converted price of ${tokenSymbol} from SOL to USD: $${priceUSD}`);
          } else {
              console.warn(`Could not convert price of ${foundPair.name} to USD: SOL/USD price unavailable.`);
              priceUSD = null; // Price is uncertain
          }
      }
    } else {
      console.warn(`Could not find a direct liquidity/price pair for ${tokenSymbol} (${tokenAddress}) on Raydium via /main/pairs.`);
    }
  }

  if (priceUSD && supply) {
    marketCapUSD = priceUSD * supply;
  } else if (priceUSD && tokenName !== 'N/A' && tokenSymbol !== 'N/A' && !supply) {
    console.warn(`Cannot calculate market cap for ${tokenSymbol}: supply data is missing.`);
  }

  if (!tokenName || tokenName === 'N/A' || !tokenSymbol || tokenSymbol === 'N/A') {
    console.error(`Failed to fetch essential token data (name/symbol) for ${tokenAddress}. Will not cache incomplete data.`);
    return new Token(tokenAddress, tokenName || 'Error', tokenSymbol || 'Error', null, null, null, new Date());
  }

  const token = new Token(
    tokenAddress,
    tokenName,
    tokenSymbol,
    priceUSD,
    liquidityUSD,
    marketCapUSD,
    new Date()
  );

  cache.set(cacheKey, token, TOKEN_DATA_CACHE_TTL_MS);
  console.log(`Cached fresh data for ${tokenAddress}`);
  return token;
}

module.exports = { 
    fetchTokenData,
    fetchSolPriceUSD, // Export the new function
    getRaydiumPairs,  // Export for potential use elsewhere if needed
};

// Example Usage (for testing purposes, would be removed or commented out)
/*
async function testFetch() {
  const solPrice = await fetchSolPriceUSD();
  console.log("Current SOL/USD price:", solPrice);

  const testTokenAddressSOL = "So11111111111111111111111111111111111111112"; // SOL token address
  console.log(`Fetching data for ${testTokenAddressSOL}...`);
  let tokenData = await fetchTokenData(testTokenAddressSOL);
  if (tokenData) console.log("Fetched SOL Data:", tokenData);
  else console.log("Failed to fetch SOL data.");

  // Try fetching again to test cache
  console.log(`Fetching data for ${testTokenAddressSOL} again (should be cached)...`);
  tokenData = await fetchTokenData(testTokenAddressSOL);
  if (tokenData) console.log("Fetched SOL Data (cached):", tokenData);
  else console.log("Failed to fetch SOL data (cached).");


  const testTokenAddressUSDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // USDC
  console.log(`Fetching data for ${testTokenAddressUSDC}...`);
  tokenData = await fetchTokenData(testTokenAddressUSDC);
  if (tokenData) console.log("Fetched USDC Data:", tokenData);
  else console.log("Failed to fetch USDC data.");

  const testTokenAddressRAY = "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R"; // RAY
  console.log(`Fetching data for ${testTokenAddressRAY}...`);
  tokenData = await fetchTokenData(testTokenAddressRAY);
  if (tokenData) console.log("Fetched RAY Data:", tokenData);
  else console.log("Failed to fetch RAY data.");

  const testTokenAddressWIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm"; // WIF
  console.log(`Fetching data for ${testTokenAddressWIF}...`);
  tokenData = await fetchTokenData(testTokenAddressWIF);
  if (tokenData) console.log("Fetched WIF Data:", tokenData);
  else console.log("Failed to fetch WIF data.");
}

// testFetch(); // Uncomment to run test
*/
