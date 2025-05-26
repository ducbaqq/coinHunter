import React, { useState, useEffect, useCallback } from 'react';
import './App.css';
import TokenInputForm from './components/TokenInputForm';
import TokenList from './components/TokenList';

// @solana/web3.js is not directly used in this file for connection,
// but good to have for future interactions if needed (e.g. sending transactions, fetching balance).
// The connection itself relies on the Phantom provider injected into `window`.

function App() {
    const [watchedTokens, setWatchedTokens] = useState([]);
    const [ws, setWs] = useState(null);

    // Wallet Connection State
    const [provider, setProvider] = useState(null);
    const [walletKey, setWalletKey] = useState(null);
    // const [solBalance, setSolBalance] = useState(0); // For later use if needed

    // Function to get the Phantom provider (or other Solana providers)
    const getProvider = useCallback(() => {
        if ('phantom' in window) {
            const solanaProvider = window.phantom?.solana;
            if (solanaProvider?.isPhantom) {
                return solanaProvider;
            }
        }
        // Fallback for other wallets that might use window.solana
        // but prioritize Phantom if window.phantom.solana is available.
        if ('solana' in window) {
            const solanaProvider = window.solana;
            // Check if it's a compliant provider. isPhantom check is important.
            if (solanaProvider?.isPhantom) { 
                return solanaProvider;
            }
            // Could add more specific checks for other wallets here e.g. solProvider.isSolflare
            // For this app, we'll primarily focus on Phantom via window.phantom.solana or window.solana (if it's Phantom)
            // If it's a generic window.solana and not Phantom, and Phantom isn't found,
            // we might still return it, but behavior might vary.
            // For now, let's be strict about isPhantom to ensure expected API.
            // if (!window.phantom?.solana && solanaProvider) return solanaProvider; // Example for broader compatibility
        }
        return null;
    }, []);


    const connectWallet = useCallback(async () => {
        const solProvider = getProvider();
        if (solProvider) {
            try {
                // The connect() method will typically prompt the user if not already connected.
                // The 'connect' event will handle setting state.
                await solProvider.connect(); 
            } catch (err) {
                console.error("Error connecting to wallet:", err);
                if (err.code === 4001) { // User rejected the request
                    alert("Wallet connection request rejected. Please approve in Phantom to connect.");
                } else {
                    alert("Could not connect to wallet. See console for details.");
                }
            }
        } else {
            alert('Phantom wallet not found. Please install Phantom from https://phantom.app/');
            window.open('https://phantom.app/', '_blank');
        }
    }, [getProvider]);

    const disconnectWallet = useCallback(async () => {
        if (provider) {
            try {
                await provider.disconnect();
                // State updates (provider, walletKey, balance) will be handled by the 'disconnect' event listener.
            } catch (err) {
                console.error("Error disconnecting wallet:", err);
                // Manually clear state as a fallback if event doesn't fire or provider errors
                setProvider(null);
                setWalletKey(null);
                // setSolBalance(0);
            }
        }
    }, [provider]);

    // Effect for Wallet event listeners and initial connection check
    useEffect(() => {
        const solProvider = getProvider();

        if (solProvider) {
            // Event listener for connection
            const handleConnect = (publicKey) => {
                console.log('Wallet connected via event!', publicKey.toString());
                setProvider(solProvider);
                setWalletKey(publicKey.toString());
                // TODO: Fetch SOL balance here if needed
            };

            // Event listener for disconnection
            const handleDisconnect = () => {
                console.log('Wallet disconnected via event!');
                setProvider(null);
                setWalletKey(null);
                // setSolBalance(0);
            };

            // Event listener for account change
            const handleAccountChanged = (publicKey) => {
                if (publicKey) {
                    console.log('Account changed to', publicKey.toString());
                    setWalletKey(publicKey.toString());
                    // TODO: Re-fetch SOL balance or other account-specific data
                } else {
                    // This case means the user has disconnected all accounts or the new account is not authorized.
                    // Effectively, it's a disconnect. Some wallets might not emit 'disconnect' but 'accountChanged' with null.
                    console.log('Account changed to null, treating as disconnect.');
                    handleDisconnect(); // Trigger our disconnect logic
                }
            };
            
            solProvider.on('connect', handleConnect);
            solProvider.on('disconnect', handleDisconnect);
            solProvider.on('accountChanged', handleAccountChanged);

            // Check if already connected on component mount (e.g., after page refresh)
            // Phantom's `isConnected` and `publicKey` properties are useful here.
            if (solProvider.isConnected && solProvider.publicKey) {
                console.log("Wallet already connected on mount:", solProvider.publicKey.toString());
                setProvider(solProvider);
                setWalletKey(solProvider.publicKey.toString());
                // TODO: Fetch SOL balance
            } else {
                 // Attempt to auto-connect if previously approved (onlyIfTrusted)
                 // This can improve UX by not requiring a click every time if already permitted.
                 solProvider.connect({ onlyIfTrusted: true }).catch(err => {
                    // Silently fail if auto-connect isn't possible (e.g., user hasn't approved before)
                    console.log("Auto-connect attempt failed or not trusted:", err.message);
                 });
            }

            // Cleanup listeners on component unmount
            return () => {
                // The `off` method or equivalent should be used if available.
                // Phantom's provider might handle this internally, but explicit cleanup is good practice.
                // The exact method name can vary (e.g., `removeListener`, `off`).
                // For this example, we'll assume Phantom's `on` returns a disposable or handles it.
                // If issues arise, check Phantom's specific API for removing listeners.
                // solProvider.off('connect', handleConnect);
                // solProvider.off('disconnect', handleDisconnect);
                // solProvider.off('accountChanged', handleAccountChanged);
                // For now, relying on Phantom's behavior or that listeners are overwritten/cleared on provider change.
            };
        }
    }, [getProvider]); // Rerun if getProvider changes (it's memoized by useCallback, so stable)


    // WebSocket initialization
    useEffect(() => {
        const websocketUrl = `ws://${window.location.hostname}:5000`;
        console.log(`Attempting to connect WebSocket to: ${websocketUrl}`);
        
        const socket = new WebSocket(websocketUrl);
        socket.onopen = () => {
            console.log('WebSocket connection established');
            setWs(socket);
        };
        socket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                console.log('WebSocket message received:', message);
                if (message.type === 'TOKEN_UPDATE') {
                    setWatchedTokens(prevTokens => {
                        const existingTokenIndex = prevTokens.findIndex(t => t.address === message.payload.address);
                        if (existingTokenIndex !== -1) {
                            const updatedTokens = [...prevTokens];
                            updatedTokens[existingTokenIndex] = { ...updatedTokens[existingTokenIndex], ...message.payload };
                            return updatedTokens;
                        } else {
                            return [...prevTokens, { ...message.payload, id: message.payload.address }];
                        }
                    });
                } else if (message.type === 'INITIAL_TOKENS' || message.type === 'ALL_TOKENS_UPDATE') {
                    setWatchedTokens(message.payload.map(token => ({ ...token, id: token.address })));
                } else if (message.type === 'TOKEN_ADDED_CONFIRMATION') {
                    const { address, ...tokenData } = message.payload;
                    setWatchedTokens(prevTokens => {
                        if (!prevTokens.find(t => t.address === address)) {
                            return [...prevTokens, { id: address, address, name: `Loading ${address.substring(0,6)}...`, ...tokenData }];
                        }
                        return prevTokens.map(t => t.address === address ? { ...t, ...tokenData } : t);
                    });
                } else if (message.type === 'WELCOME') {
                    console.log('Welcome message from server:', message.payload);
                } else if (message.type === 'ERROR' || message.type === 'ERROR_MESSAGE') {
                    console.error('Error message from backend:', message.payload);
                }
            } catch (error) {
                console.error('Error parsing WebSocket message or updating state:', error);
            }
        };
        socket.onclose = () => {
            console.log('WebSocket connection closed');
            setWs(null);
        };
        socket.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
        return () => {
            if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
                socket.close();
            }
        };
    }, []); // Empty dependency array for WebSocket

    const handleAddToken = (address) => {
        console.log('Attempting to add token:', address);
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
            alert("Invalid Solana address format.");
            return;
        }
        if (watchedTokens.find(token => token.address === address)) {
            alert("This token is already being watched.");
            return;
        }
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ADD_TOKEN_WATCH', payload: { address } }));
            console.log(`Sent ADD_TOKEN_WATCH for ${address} to backend.`);
            setWatchedTokens(prevTokens => [...prevTokens, { id: address, address, name: `Loading ${address.substring(0,6)}...`}]);
        } else {
            console.warn('WebSocket not connected. Cannot send token to backend.');
            alert('WebSocket is not connected. Please wait or refresh.');
        }
    };

    return (
        <div className="App">
            <header className="App-header">
                <h1>Solana Token Watcher</h1>
                <div style={{ position: 'absolute', top: '10px', right: '10px', textAlign: 'right' }}>
                    {walletKey ? (
                        <div>
                            <p style={{ margin: '0 0 5px 0', fontSize: '0.9em' }}>
                                Connected: {walletKey.substring(0, 4)}...{walletKey.substring(walletKey.length - 4)}
                            </p>
                            <button onClick={disconnectWallet} style={{padding: '8px 12px', fontSize: '0.9em'}}>
                                Disconnect Wallet
                            </button>
                        </div>
                    ) : (
                        <button onClick={connectWallet} style={{padding: '10px 15px'}}>
                            Connect Phantom Wallet
                        </button>
                    )}
                </div>
                <p>WebSocket Status: {ws && ws.readyState === WebSocket.OPEN ? 'Connected' : 'Disconnected'}</p>
            </header>
            <TokenInputForm onAddToken={handleAddToken} />
            <TokenList tokens={watchedTokens} />
        </div>
    );
}

export default App;
