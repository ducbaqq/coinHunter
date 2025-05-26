const express = require('express');
const http =require('http');
const { WebSocketServer } = require('ws');

const apiClient = require('./services/apiClient');
const portfolioService = require('./services/portfolioService');
const tradingService = require('./services/tradingService');
const cacheService = require('./services/cacheService'); // For cache visibility if needed, or managing watched tokens

const app = express();
const port = process.env.PORT || 5000;

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Store watched token addresses (could be enhanced to store per-client later)
// For now, a global list of tokens the backend actively monitors.
const globallyWatchedTokens = new Set(); 
// Interval for fetching updates for watched tokens (e.g., every 30 seconds)
const WATCHED_TOKEN_REFRESH_INTERVAL_MS = 30 * 1000;


// Function to broadcast to all clients
function broadcast(data) {
  // console.log("Broadcasting:", data); // Can be noisy, enable if debugging specific messages
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// Function to broadcast portfolio updates
function broadcastPortfolioUpdate() {
    const portfolioState = portfolioService.getPortfolio();
    broadcast({ type: 'PORTFOLIO_UPDATE', payload: portfolioState });
}


// Function to fetch data for a single token, check rules, and broadcast
async function processSingleToken(tokenAddress) {
    try {
        const tokenData = await apiClient.fetchTokenData(tokenAddress);
        if (tokenData && tokenData.symbol !== 'Error') { // Ensure data is valid
            broadcast({ type: 'TOKEN_UPDATE', payload: tokenData });

            // Check automated trading rules if the token is in our portfolio
            const position = portfolioService.getPosition(tokenAddress);
            if (position && position.amountHeld > 0) {
                await tradingService.checkAutomatedTradingRules(tokenAddress, tokenData);
                // checkAutomatedTradingRules might trigger a sell, which logs a trade and updates portfolio.
                // Broadcast portfolio updates if a trade happened.
                // For simplicity, we can broadcast portfolio after every check if a position exists.
                // More optimized: only broadcast if portfolioService indicates a change.
                broadcastPortfolioUpdate(); 
            }
            return tokenData; // Return data for potential initial buy decision
        } else {
            console.warn(`Server: Failed to fetch valid data for ${tokenAddress}, skipping further processing.`);
            // Optionally, send an error to clients or remove from watched list if consistently failing
            // broadcast({ type: 'TOKEN_ERROR', payload: { address: tokenAddress, message: "Failed to fetch data" } });
        }
    } catch (error) {
        console.error(`Server: Error processing token ${tokenAddress}:`, error);
    }
    return null;
}


// Periodically fetch updates for all globally watched tokens
setInterval(async () => {
    if (globallyWatchedTokens.size === 0) return;
    console.log(`Server: Periodic refresh for ${globallyWatchedTokens.size} watched token(s)...`);
    // Fetch all SOL price first to ensure it's fresh for any subsequent processing
    await tradingService.getSolPriceUSD(); 

    for (const address of globallyWatchedTokens) {
        await processSingleToken(address);
    }
    // After processing all tokens, broadcast the latest portfolio state once.
    // broadcastPortfolioUpdate(); // This is now done within processSingleToken if a position exists
}, WATCHED_TOKEN_REFRESH_INTERVAL_MS);


wss.on('connection', (ws) => {
  console.log('Client connected to WebSocket');
  ws.send(JSON.stringify({ type: 'WELCOME', payload: 'Welcome to the Solana Trader WebSocket!' }));
  
  // Send current portfolio state and SOL price on new connection
  broadcastPortfolioUpdate();
  tradingService.getSolPriceUSD().then(price => {
      if (price) ws.send(JSON.stringify({ type: 'SOL_PRICE_UPDATE', payload: { price }}));
  });

  // Send initial data for already watched tokens
  // (Could be a lot of data if many tokens are watched; consider pagination or client request for this)
  // For now, send updates for all currently watched tokens.
  if (globallyWatchedTokens.size > 0) {
    ws.send(JSON.stringify({ type: 'NOTIFICATION', payload: { message: `Backend is watching ${globallyWatchedTokens.size} tokens. Sending initial data...`}}));
    for (const address of globallyWatchedTokens) {
        const cachedToken = cacheService.get(`token_${address}`); // Check cache first
        if (cachedToken) {
            ws.send(JSON.stringify({ type: 'TOKEN_UPDATE', payload: cachedToken }));
        } else {
            processSingleToken(address).then(tokenData => { // Fetch if not in cache
                if (tokenData) ws.send(JSON.stringify({ type: 'TOKEN_UPDATE', payload: tokenData }));
            });
        }
    }
  }


  ws.on('message', async (message) => {
    console.log('Received from client: %s', message);
    let parsedMessage;
    try {
        parsedMessage = JSON.parse(message);
    } catch (error) {
        console.error("Failed to parse client message:", error);
        ws.send(JSON.stringify({ type: 'ERROR', payload: 'Invalid JSON message received.' }));
        return;
    }

    switch (parsedMessage.type) {
        case 'ADD_TOKEN_WATCH':
            const { address } = parsedMessage.payload;
            if (!address) {
                ws.send(JSON.stringify({ type: 'ERROR', payload: 'Token address missing in ADD_TOKEN_WATCH' }));
                return;
            }

            console.log(`Server: Client requests to watch token: ${address}`);
            globallyWatchedTokens.add(address);
            ws.send(JSON.stringify({ type: 'TOKEN_ADDED_CONFIRMATION', payload: { address, message: "Token added to watch list. Fetching data..." } }));

            // Fetch initial data for the newly added token and attempt initial buy
            const initialTokenData = await processSingleToken(address); 
            if (initialTokenData && initialTokenData.symbol !== 'Error') {
                // Attempt initial buy based on this fresh data
                // The `availableSolForInvestment` for `initiateBuyOrder` is the current portfolio balance.
                // `calculateInvestmentAllocation` inside `initiateBuyOrder` will determine the actual SOL to use.
                const buyResult = await tradingService.initiateBuyOrder(address, initialTokenData);
                if (buyResult && buyResult.trade) {
                    console.log(`Server: Initial buy order processed for ${address}. Trade ID: ${buyResult.trade.timestamp}`); // Assuming timestamp as a simple ID
                    // Broadcast updated portfolio after buy
                    broadcastPortfolioUpdate();
                } else {
                    console.log(`Server: Initial buy for ${address} skipped or failed.`);
                }
            } else {
                 console.log(`Server: Not attempting initial buy for ${address} due to invalid/missing initial data.`);
            }
            break;
        
        case 'REQUEST_PORTFOLIO': // Example: Client explicitly requests portfolio
             ws.send(JSON.stringify({ type: 'PORTFOLIO_UPDATE', payload: portfolioService.getPortfolio() }));
             break;

        case 'REQUEST_SOL_PRICE': // Example: Client explicitly requests SOL price
             const solPrice = await tradingService.getSolPriceUSD();
             if (solPrice) ws.send(JSON.stringify({ type: 'SOL_PRICE_UPDATE', payload: { price: solPrice }}));
             break;

        default:
            console.log(`Server: Received unhandled message type: ${parsedMessage.type}`);
            ws.send(JSON.stringify({ type: 'ECHO', payload: parsedMessage }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    // Optionally, handle per-client watch lists if implemented:
    // removeClientSubscriptions(ws); 
  });

  ws.on('error', (error) => {
    console.error('WebSocket error with client:', error);
  });
});

server.listen(port, () => {
  console.log(`HTTP Server listening on port ${port}`);
  console.log(`WebSocket server attached and listening on the same port.`);
  // Initial fetch of SOL price when server starts
  tradingService.refreshSolPriceUSD().then(price => {
      if(price) console.log(`Initial SOL/USD price fetched: $${price}`);
      else console.error("Failed to fetch initial SOL/USD price on server startup.");
  });
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('SIGINT signal received: closing HTTP server');
    wss.clients.forEach(client => client.terminate());
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});
