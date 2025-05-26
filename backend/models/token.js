class Token {
  constructor(address, name, symbol, priceUSD, liquidityUSD, marketCapUSD, lastFetched) {
    this.address = address; // string
    this.name = name; // string
    this.symbol = symbol; // string
    this.priceUSD = priceUSD; // number
    this.liquidityUSD = liquidityUSD; // number
    this.marketCapUSD = marketCapUSD; // number
    this.lastFetched = lastFetched; // Date
  }
}

module.exports = Token;
