const fs = require('fs').promises; // Using promises version for async operations
const path = require('path'); // To ensure the directory exists
const { ACTIVE_TRADES_FILE } = require('./config');
const { logger } = require('./logger');

/**
 * Loads active trades from the ACTIVE_TRADES_FILE.
 * @returns {Promise<Array<Object>>} A promise that resolves to an array of trade objects.
 * Returns an empty array if the file doesn't exist, is empty, or contains invalid JSON.
 */
async function loadActiveTrades() {
  try {
    const data = await fs.readFile(ACTIVE_TRADES_FILE, 'utf8');
    if (!data) {
      logger.info(`Active trades file ('${ACTIVE_TRADES_FILE}') is empty. Returning empty array.`);
      return [];
    }
    const trades = JSON.parse(data);
    // Basic validation to ensure it's an array, further validation could be added per trade object
    if (!Array.isArray(trades)) {
        logger.warn(`Invalid data format in active trades file ('${ACTIVE_TRADES_FILE}'). Expected an array. Returning empty array.`);
        return [];
    }
    logger.info(`Successfully loaded ${trades.length} active trades from '${ACTIVE_TRADES_FILE}'.`);
    return trades;
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.info(`Active trades file ('${ACTIVE_TRADES_FILE}') not found. Returning empty array.`);
      return []; // File not found is a normal scenario for the first run
    } else if (error instanceof SyntaxError) {
      logger.error(`Error parsing JSON from active trades file ('${ACTIVE_TRADES_FILE}'): ${error.message}. Returning empty array.`);
      return []; // Invalid JSON
    } else {
      logger.error(`Failed to read active trades file ('${ACTIVE_TRADES_FILE}'): ${error.message}`);
      return []; // Other errors
    }
  }
}

/**
 * Saves the array of active trades to the ACTIVE_TRADES_FILE.
 * @param {Array<Object>} trades - The array of trade objects to save.
 * @returns {Promise<boolean>} A promise that resolves to true if saving was successful, false otherwise.
 */
async function saveActiveTrades(trades) {
  if (!Array.isArray(trades)) {
    logger.error('Invalid input to saveActiveTrades: Expected an array of trades.');
    return false;
  }
  try {
    // Ensure the directory exists before writing the file
    const dir = path.dirname(ACTIVE_TRADES_FILE);
    try {
        await fs.access(dir);
    } catch (error) {
        if (error.code === 'ENOENT') {
            logger.info(`Directory ${dir} for active trades file does not exist. Creating it.`);
            await fs.mkdir(dir, { recursive: true });
        } else {
            throw error; // Re-throw other access errors
        }
    }

    const jsonData = JSON.stringify(trades, null, 2); // Pretty print JSON
    await fs.writeFile(ACTIVE_TRADES_FILE, jsonData, 'utf8');
    logger.info(`Successfully saved ${trades.length} active trades to '${ACTIVE_TRADES_FILE}'.`);
    return true;
  } catch (error) {
    logger.error(`Failed to save active trades to ('${ACTIVE_TRADES_FILE}'): ${error.message}`);
    return false;
  }
}

module.exports = {
  loadActiveTrades,
  saveActiveTrades,
};

// Example of trade object structure (for documentation, not part of the code itself):
// {
//   "tokenMintAddress": "So11111111111111111111111111111111111111112",
//   "buyPrice": 0.5,
//   "buyTimestamp": "2024-01-01T12:00:00.000Z",
//   "tokenAmount": 100,
//   "peakPrice": 0.55
// }
