import React from 'react';
import TokenDisplay from './TokenDisplay';

function TokenList({ tokens }) {
    if (!tokens || tokens.length === 0) {
        return <p style={{textAlign: 'center', margin: '20px'}}>No tokens being watched yet, or data is loading...</p>;
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            {/* <h2>Watched Tokens</h2> // This title is already in App.js */}
            {tokens.map(token => (
                // Ensure token object and its address exist before rendering
                token && token.address ? 
                <TokenDisplay key={token.address} token={token} /> :
                null 
            ))}
        </div>
    );
}

export default TokenList;
