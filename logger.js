const winston = require('winston');
const config = require('./config');

// Define the general log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.json()
);

// Define a more readable format for the console
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`)
);

// Create the main logger instance
const logger = winston.createLogger({
  level: config.LOG_LEVEL,
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: consoleFormat
    }),
    new winston.transports.File({
      filename: config.APP_LOG_FILE,
      maxsize: config.LOG_FILE_SIZE_MB * 1024 * 1024,
      maxFiles: config.LOG_FILES_TO_RETAIN,
      tailable: true,
    })
  ],
  exceptionHandlers: [
    new winston.transports.File({ filename: 'exceptions.log' }) // Optional: separate file for uncaught exceptions
  ]
});

// Create a dedicated transport for completed trades
const completedTradesTransport = new winston.transports.File({
  filename: config.COMPLETED_TRADES_FILE,
  format: winston.format.combine( // Each log call will be a new line, and we log the object as JSON
    winston.format.printf(info => {
      // Assuming the 'message' is the tradeData object
      return JSON.stringify(info.message);
    })
  ),
  level: 'info', // Ensure it logs info level messages
});

// Add this transport to a new logger instance or the main one if preferred.
// For simplicity and clear separation, let's use a dedicated logger for completed trades.
const completedTradesLogger = winston.createLogger({
    level: 'info', // Completed trades are informational events
    transports: [completedTradesTransport],
    // Do not propagate to parent logger's transports if it's added there
});

// Function to log completed trades
// This function will use the dedicated completedTradesLogger
function logCompletedTrade(tradeData) {
  completedTradesLogger.info(tradeData);
}

// Export the main logger and the dedicated function
module.exports = {
  logger,
  logCompletedTrade
};

// Example Usage (can be removed or commented out)
// logger.info('Application started');
// logger.warn('A warning message');
// logger.error('An error occurred');
// logCompletedTrade({ tradeId: '123', symbol: 'SOL/USDC', profit: 10, timestamp: new Date().toISOString() });
// logCompletedTrade({ tradeId: '124', symbol: 'BONK/USDC', profit: -5, timestamp: new Date().toISOString() });
