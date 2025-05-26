import React from 'react';

function TokenDisplay({ token }) {
    if (!token) return null;

    // Helper for formatting numbers or showing N/A
    const formatNumber = (value, decimals = 2) => {
        if (typeof value === 'number') {
            return value.toLocaleString(undefined, {
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals,
            });
        }
        return 'N/A';
    };
    
    const formatPrice = (value) => {
         if (typeof value === 'number') {
            if (value < 0.0001 && value > 0) { // For very small prices
                 return value.toExponential(2);
            }
            return value.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 6, // Allow more precision for smaller prices
            });
        }
        return 'N/A';
    }


    return (
        <div style={{ border: '1px solid #ccc', margin: '10px', padding: '10px', borderRadius: '5px', backgroundColor: '#f9f9f9' }}>
            <h3 style={{ marginTop: 0 }}>{token.name || 'Unknown Token'} ({token.symbol || token.address})</h3>
            <p><strong>Address:</strong> {token.address}</p>
            <p><strong>Price:</strong> ${formatPrice(token.priceUSD)}</p>
            <p><strong>Liquidity:</strong> ${formatNumber(token.liquidityUSD)}</p>
            <p><strong>Market Cap:</strong> ${formatNumber(token.marketCapUSD)}</p>
            <p><strong>Token Age:</strong> {token.age || 'N/A'}</p>
            <p><strong>5-min Performance:</strong> {token.perf5min || 'N/A'}</p>
            <p><strong>1-hour Performance:</strong> {token.perf1hr || 'N/A'}</p>
            {/* Placeholder for investment-specific data */}
            {token.investment && (
                <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #eee' }}>
                    <h4>My Investment:</h4>
                    <p>Amount: {token.investment.amountSOL ? `${formatNumber(token.investment.amountSOL, 4)} SOL` : 'N/A'}</p>
                    <p>Current Value: ${token.investment.currentValueUSD ? formatNumber(token.investment.currentValueUSD) : 'N/A'}</p>
                    <p>Profit/Loss: {token.investment.pnlUSD ? `${token.investment.pnlUSD >= 0 ? '+' : ''}$${formatNumber(token.investment.pnlUSD)}` : 'N/A'}</p>
                </div>
            )}
        </div>
    );
}

export default TokenDisplay;
