// 1. Imports
require('dotenv').config(); // 7. Load .env variables first

const { logger } = require('./logger');
const config = require('./config'); // For PRICE_CHECK_INTERVAL_MS and default RPC_ENDPOINT
const {
  initializeTrading,
  simulateBuy,
  // getActivePositions, // Not directly used in main loop, but available
} = require('./tradingLogic');
const solanaService = require('./solanaService'); // Import as an object to call its methods
const { analyzeTokenAndPool } = require('./tokenAnalyzer');
const { monitorTrades } = require('./exitStrategy');

// Main Application Logic
async function main() {
  // 8. Log application start
  logger.info('======================================================');
  logger.info('Starting Solana Raydium Sniper Bot...');
  logger.info(`Using RPC Endpoint: ${config.RPC_ENDPOINT}`);
  logger.info('======================================================');

  // 9. Verify RPC_ENDPOINT is set
  if (!config.RPC_ENDPOINT) {
    logger.error('RPC_ENDPOINT is not defined. Please set it in .env or config.js. Exiting.');
    process.exit(1);
  }
  // Test connection (optional, solanaService might do this implicitly or on first call)
  try {
    const version = await solanaService.connection.getVersion();
    logger.info(`Successfully connected to Solana RPC. Node version: ${version['solana-core']}`);
  } catch (error) {
    logger.error(`Failed to connect to Solana RPC: ${error.message}. Please check your RPC_ENDPOINT. Exiting.`, { error });
    process.exit(1);
  }


  // 10. Call initializeTrading()
  await initializeTrading();

  // 11. Define handleNewPool(poolData) function
  async function handleNewPool(poolData) {
    try {
      logger.info(`New pool event received. AMM ID: ${poolData.ammId}, Tx: ${poolData.transaction_signature}. Processing...`);
      // poolData should contain: { ammId, transaction_signature, timestamp, tokenA_mint, tokenB_mint, lp_mint, market_id, ... }

      const analysisResult = await analyzeTokenAndPool(poolData);

      if (analysisResult.suitable) {
        logger.info(`Token ${analysisResult.tokenMint} from pool ${analysisResult.poolId} PASSED analysis: ${analysisResult.reason}`);

        // Fetch current price to execute the buy
        const currentPrice = await solanaService.getCurrentPrice(analysisResult.poolId);

        if (currentPrice !== null && currentPrice > 0) {
          logger.info(`Current price for ${analysisResult.tokenMint} (pool ${analysisResult.poolId}) is ${currentPrice} SOL. Attempting buy.`);
          await simulateBuy(analysisResult.tokenMint, analysisResult.poolId, currentPrice);
        } else {
          logger.error(`Could not fetch a valid price for ${analysisResult.tokenMint} (pool ${analysisResult.poolId}) to initiate buy. Price: ${currentPrice}.`);
        }
      } else {
        logger.warn(`Token from pool ${poolData.ammId} (Tx: ${poolData.transaction_signature}) did NOT pass analysis: ${analysisResult.reason}`);
      }
    } catch (error) {
      logger.error(`Error in handleNewPool for AMM ID ${poolData.ammId}: ${error.message}`, { error, poolData });
    }
  }

  // 12. Start monitoring for new pools
  // subscribeToNewPools in solanaService handles its own logging for subscription success/failure.
  // The error callback within subscribeToNewPools (if any specific errors from onProgramAccountChange) should log.
  solanaService.subscribeToNewPools(handleNewPool);
  logger.info(`🚀 Monitoring for new Raydium pools on program ID: ${solanaService.raydiumProgramId.toBase58()}`);

  // 13. Start periodic exit strategy checks
  setInterval(async () => {
    try {
      await monitorTrades();
    } catch (error) {
      logger.error('Error during periodic monitorTrades execution:', error);
    }
  }, config.PRICE_CHECK_INTERVAL_MS);
  logger.info(`📈 Started periodic trade monitoring. Interval: ${config.PRICE_CHECK_INTERVAL_MS / 1000} seconds.`);

  logger.info("Bot is now running. Waiting for new pools and monitoring active trades...");
  logger.info('======================================================');

  // Keep the main process alive (e.g. if not using a web server or other long-running task)
  // This is often not needed if subscriptions or intervals are running.
  // new Promise(() => {}); // Keeps node running indefinitely
}

// 15. Add a top-level error handler for main()
main().catch(error => {
  logger.error("💥 Unhandled error in main application execution:", {
    message: error.message,
    stack: error.stack,
    error, // full error object
  });
  process.exit(1);
});

// Graceful shutdown (optional but good practice)
process.on('SIGINT', async () => {
  logger.info('SIGINT received. Shutting down gracefully...');
  if (solanaService && typeof solanaService.unsubscribeFromNewPools === 'function') {
    try {
      await solanaService.unsubscribeFromNewPools();
    } catch (err) {
      logger.warn(`Error during unsubscribe: ${err.message}`);
    }
  }
  // Add any other cleanup tasks here
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', { promise, reason });
    // Optionally exit or log more details
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', { error });
    process.exit(1); // Mandatory exit after uncaught exception
});
