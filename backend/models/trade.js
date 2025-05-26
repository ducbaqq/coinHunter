class Trade {
  constructor(tokenId, type, amountSOL, priceUSD, timestamp, status) {
    this.tokenId = tokenId; // string, linking to Token
    this.type = type; // 'buy'/'sell'
    this.amountSOL = amountSOL; // number (SOL invested for buy, SOL gained for sell)
    this.priceUSD = priceUSD; // number (price of the token per unit in USD at time of trade)
    this.timestamp = timestamp; // Date
    this.status = status; // 'pending'/'simulated_completed'/'failed_...'
    this.reasonForTrade = null; // Optional: e.g., 'stop-loss', 'take-profit', 'initial_buy'
  }
}

module.exports = Trade;
