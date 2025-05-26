import React, { useState } from 'react';

function TokenInputForm({ onAddToken }) { // onAddToken will be the callback prop
    const [tokenAddress, setTokenAddress] = useState('');

    const handleSubmit = (event) => {
        event.preventDefault();
        if (tokenAddress.trim() === '') {
            alert('Please enter a token address.');
            return;
        }
        // Call a prop function to handle the submission, passing the token address
        onAddToken(tokenAddress.trim());
        setTokenAddress(''); // Clear the input after submission
    };

    return (
        <form onSubmit={handleSubmit} style={{ margin: '20px 0' }}>
            <input
                type="text"
                value={tokenAddress}
                onChange={(e) => setTokenAddress(e.target.value)}
                placeholder="Enter Solana Token Address"
                style={{ padding: '10px', marginRight: '10px', width: '300px' }}
            />
            <button type="submit" style={{ padding: '10px' }}>
                Add Token
            </button>
        </form>
    );
}

export default TokenInputForm;
