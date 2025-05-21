const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { getMint, getAccount, getAssociatedTokenAddress } = require('@solana/spl-token');
const { RPC_ENDPOINT, RAYDIUM_PROGRAM_ADDRESS } = require('./config');
const { logger } = require('./logger');

const connection = new Connection(RPC_ENDPOINT, 'confirmed');
const raydiumProgramId = new PublicKey(RAYDIUM_PROGRAM_ADDRESS);

logger.info(`Solana service initialized with RPC: ${RPC_ENDPOINT}`);
logger.info(`Monitoring Raydium Program ID: ${RAYDIUM_PROGRAM_ADDRESS}`);

/**
 * Fetches and parses transaction details.
 * @param {string} signature - The transaction signature.
 * @returns {Promise<import('@solana/web3.js').ParsedTransactionWithMeta | null>}
 */
async function getTransactionDetails(signature) {
  try {
    const tx = await connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0, // Specify to ensure compatibility
    });
    if (!tx) {
      logger.warn(`Transaction not found or failed to parse: ${signature}`);
      return null;
    }
    return tx;
  } catch (error) {
    logger.error(`Error fetching transaction details for ${signature}: ${error.message}`, { error });
    return null;
  }
}

/**
 * Fetches and unpacks mint account information.
 * @param {string | PublicKey} tokenMintAddress - The token mint's public key.
 * @returns {Promise<import('@solana/spl-token').Mint | null>}
 */
async function getMintAccountInfo(tokenMintAddress) {
  try {
    const mintPublicKey = new PublicKey(tokenMintAddress);
    const mintInfo = await getMint(connection, mintPublicKey);
    // The getMint function from @solana/spl-token already returns the unpacked mint info.
    // Fields like mintInfo.mintAuthority and mintInfo.freezeAuthority are available.
    if (!mintInfo) {
        logger.warn(`Mint account not found or failed to parse: ${tokenMintAddress.toString()}`);
        return null;
    }
    return mintInfo;
  } catch (error) {
    logger.error(`Error fetching mint account info for ${tokenMintAddress.toString()}: ${error.message}`, { error });
    return null;
  }
}

/**
 * Derives the Associated Token Account (ATA) and fetches its information.
 * @param {string | PublicKey} tokenMintAddress - The token mint's public key.
 * @param {string | PublicKey} ownerAddress - The owner's public key.
 * @returns {Promise<import('@solana/spl-token').Account | null>}
 */
async function getTokenAccountInfo(tokenMintAddress, ownerAddress) {
    try {
        const mintPublicKey = new PublicKey(tokenMintAddress);
        const ownerPublicKey = new PublicKey(ownerAddress);

        const ata = await getAssociatedTokenAddress(
            mintPublicKey,
            ownerPublicKey,
            false // allowOwnerOffCurve - typically false for wallets, true for PDAs
            // TOKEN_PROGRAM_ID, // Defaulted, not needed unless using a custom SPL Token program
            // ASSOCIATED_TOKEN_PROGRAM_ID // Defaulted
        );

        logger.info(`Derived ATA for mint ${mintPublicKey.toBase58()} and owner ${ownerPublicKey.toBase58()}: ${ata.toBase58()}`);

        const accountInfo = await getAccount(connection, ata);
        if (!accountInfo) {
            // It's possible the ATA hasn't been created yet, which is not an error in itself.
            logger.info(`ATA ${ata.toBase58()} not found or not yet initialized.`);
            return null;
        }
        return accountInfo;
    } catch (error) {
        // Catch errors from getAssociatedTokenAddress or getAccount
        if (error.message.includes("TokenAccountNotFoundError") || error.message.includes("Account does not exist")) {
             logger.info(`ATA for mint ${tokenMintAddress.toString()} and owner ${ownerAddress.toString()} not found.`);
             return null;
        }
        logger.error(`Error fetching ATA info for mint ${tokenMintAddress.toString()}, owner ${ownerAddress.toString()}: ${error.message}`, { error });
        return null;
    }
}


/**
 * Placeholder for fetching and parsing Raydium pool liquidity.
 * This is complex and likely requires knowledge of Raydium's specific account structures
 * or using their SDK.
 * @param {string | PublicKey} poolStateAccount - The public key of the liquidity pool's state account.
 * @returns {Promise<Object | null>}
 */
async function getPoolLiquidity(poolStateAccount) {
  logger.info(`getPoolLiquidity called for ${poolStateAccount.toString()}. This function is a placeholder.`);
  // TODO: Implement actual logic. This would involve:
  // 1. Fetching the account info for poolStateAccount.
  // 2. Deserializing the account data according to Raydium's LP state layout.
  //    This layout is specific to Raydium and might need to be reverse-engineered or found in their SDK.
  //    It typically contains mint addresses for tokenA, tokenB, and their amounts.
  // Example structure of what might be returned: { solAmount, tokenAmount, tokenMint }
  try {
    const accountInfo = await connection.getAccountInfo(new PublicKey(poolStateAccount));
    if (!accountInfo) {
        logger.warn(`Pool state account not found: ${poolStateAccount.toString()}`);
        return null;
    }
    // The actual parsing of accountInfo.data is the complex part.
    logger.warn(`Pool state account data for ${poolStateAccount.toString()} needs specific Raydium parsing logic.`);
    return { rawData: accountInfo.data.toString('base64') }; // Return raw data for now
  } catch (error) {
    logger.error(`Error fetching pool state account info for ${poolStateAccount.toString()}: ${error.message}`, { error });
    return null;
  }
}

/**
 * Placeholder for fetching the current price from a Raydium pool.
 * @param {string | PublicKey} poolId - The ID or state account of the pool.
 * @returns {Promise<number | null>}
 */
async function getCurrentPrice(poolId) {
  logger.info(`getCurrentPrice called for ${poolId.toString()}. This function is a placeholder.`);
  // TODO: Implement actual logic. This would involve:
  // 1. Calling getPoolLiquidity or a similar function to get reserves.
  // 2. Calculating price based on reserve ratio (e.g., SOL amount / other token amount).
  // Fallback to external APIs if needed as per PRD.
  const liquidity = await getPoolLiquidity(poolId); // Assuming poolId is the poolStateAccount
  if (liquidity && liquidity.solAmount && liquidity.tokenAmount && liquidity.tokenAmount > 0) {
    // This is a simplistic calculation. Real price calculation needs to consider token decimals.
    // return liquidity.solAmount / liquidity.tokenAmount;
    logger.warn("CurrentPrice calculation from raw reserves is not yet fully implemented due to complex Raydium data parsing.");
    return null;
  }
  return null;
}

// Store subscription IDs to manage them (e.g., for unsubscribing)
let poolSubscriptionId = null;

/**
 * Subscribes to new Raydium liquidity pools.
 * @param {Function} onNewPoolDetectedCallback - Callback function invoked with pool data.
 */
function subscribeToNewPools(onNewPoolDetectedCallback) {
  logger.info(`Subscribing to new pool creations from Raydium program: ${raydiumProgramId.toBase58()}`);

  if (poolSubscriptionId !== null) {
    logger.warn('Already subscribed to new pools. Unsubscribe first if a new subscription is needed.');
    // Optionally, unsubscribe and resubscribe, or simply return.
    // await connection.removeProgramAccountChangeListener(poolSubscriptionId);
    // logger.info('Removed existing pool subscription.');
    return;
  }

  try {
    poolSubscriptionId = connection.onProgramAccountChange(
      raydiumProgramId,
      async (keyedAccountInfo, context) => {
        const { accountId, accountInfo } = keyedAccountInfo;
        // This gives us accounts owned/modified by Raydium.
        // We need to filter these further by looking at transactions that involve these accounts.
        // The PRD specifically mentions "initialize2" instructions.
        // A common pattern is to look for logs or transaction signatures related to new pools.

        // Heuristic: New LP accounts are often large. This is a weak filter.
        // A better approach is needed, likely involving inspecting transactions that modify these accounts.
        // logger.info(`Program account change detected for account: ${accountId.toBase58()}, data size: ${accountInfo.data.length}`);

        // The crucial part is to get the transaction signature that caused this change.
        // Unfortunately, onProgramAccountChange doesn't directly provide the signature.
        // We might need to use connection.getSignaturesForAddress on the accountId
        // and then fetch recent transactions to look for 'initialize2'.
        // This can be resource-intensive and delayed.

        // A more direct way, if Raydium emits an event or logs a specific message for new pools,
        // would be to use `connection.onLogs`. This requires knowing Raydium's log patterns.

        // Let's try to fetch recent signatures for the changed account and check them.
        // This is a common but potentially slow approach.
        try {
            const signatures = await connection.getSignaturesForAddress(accountId, { limit: 1 }, 'confirmed');
            if (signatures && signatures.length > 0) {
                const latestSignature = signatures[0].signature;
                logger.info(`Checking signature ${latestSignature} for initialize2 instruction related to account ${accountId.toBase58()}`);
                const txDetails = await getTransactionDetails(latestSignature);

                if (txDetails && txDetails.meta && txDetails.transaction && txDetails.transaction.message) {
                    const instructions = txDetails.transaction.message.instructions;
                    const accountKeys = txDetails.transaction.message.accountKeys;

                    for (const instruction of instructions) {
                        // 'initialize2' is specific to Raydium AMM v4.
                        // The actual instruction name/discriminator might vary or need to be found from IDL.
                        // For now, we'll check if the program ID matches Raydium's and look for common patterns.
                        // This is a highly simplified check. Real parsing needs the instruction data layout.
                        const programAddress = accountKeys[instruction.programIdIndex].pubkey;
                        if (programAddress.equals(raydiumProgramId)) {
                            // This is an instruction called on the Raydium program.
                            // We need to decode `instruction.data` (base58) to see if it's `initialize2`.
                            // The first 8 bytes of instruction data are usually the instruction discriminator.
                            // The discriminator for 'initialize2' needs to be known (e.g., from Raydium's IDL or source).
                            // Example: const INITIALIZE2_DISCRIMINATOR = "0x..."; (hex representation)

                            // Without the discriminator, we are guessing.
                            // A common pattern for initialize2 is that it involves several token accounts and mints.
                            // The log messages from the transaction are also very useful.
                            if (txDetails.meta.logMessages) {
                                const isInitializeLog = txDetails.meta.logMessages.some(log =>
                                    log.includes("initialize2") || log.includes("init_pc_amount") // Common terms in Raydium logs
                                );

                                if (isInitializeLog) {
                                    logger.info(`Potential 'initialize2' instruction found in tx: ${latestSignature} for account ${accountId.toBase58()}`);

                                    // --- Attempt to extract key accounts from initialize2 instruction ---
                                    // This is highly Raydium-specific and might need adjustment based on their IDL or observed transaction patterns.
                                    // The order of accounts in `instruction.accounts` (which are indices into `accountKeys`) is critical.
                                    // Typical accounts for Raydium AMM v4 `initialize2`:
                                    // 0: amm_program_id (already known)
                                    // 1: amm_id (usually `accountId` from onProgramAccountChange, or a new PDA)
                                    // 2: amm_authority
                                    // 3: amm_open_orders
                                    // 4: amm_lp_mint (newly created LP token mint)
                                    // 5: token_a_mint (e.g., SOL or USDC)
                                    // 6: token_b_mint (the other token, often the new one)
                                    // 7: token_a_vault (Raydium's vault for token_a)
                                    // 8: token_b_vault (Raydium's vault for token_b)
                                    // 9: serum_market_id
                                    // ... and more system accounts, user accounts etc.

                                    // The `instruction.accounts` array contains indices pointing to `txDetails.transaction.message.accountKeys`.
                                    const mappedAccounts = instruction.accounts.map(index => accountKeys[index].pubkey.toBase58());

                                    // Placeholder values - actual indices need verification
                                    const extractedAmmId = mappedAccounts[1] || accountId.toBase58(); // AMM ID might be the account that changed or specified in instruction
                                    const lpMintAddress = mappedAccounts[4];
                                    const tokenAMintAddress = mappedAccounts[5]; // e.g. SOL or USDC
                                    const tokenBMintAddress = mappedAccounts[6]; // e.g. the new token
                                    const serumMarketId = mappedAccounts[9];

                                    // Further validation: Ensure these look like mints/accounts
                                    // e.g., tokenAMintAddress should not be the same as tokenBMintAddress

                                    const poolData = {
                                        ammId: extractedAmmId,
                                        transaction_signature: latestSignature,
                                        timestamp: txDetails.blockTime ? new Date(txDetails.blockTime * 1000).toISOString() : new Date().toISOString(),
                                        tokenA_mint: tokenAMintAddress,
                                        tokenB_mint: tokenBMintAddress,
                                        lp_mint: lpMintAddress,
                                        market_id: serumMarketId,
                                        // For debugging and further refinement:
                                        rawInstruction: {
                                            programIdIndex: instruction.programIdIndex,
                                            accounts: instruction.accounts, // indices
                                            data: instruction.data, // base58 encoded data
                                        },
                                        allAccountKeysFromTx: accountKeys.map(ak => ak.pubkey.toBase58()),
                                        logMessages: txDetails.meta.logMessages,
                                    };

                                    logger.info("New pool detected (based on log heuristics and attempted account mapping):", JSON.stringify(poolData, null, 2));
                                    onNewPoolDetectedCallback(poolData);
                                    break; // Found and processed initialize2, exit loop
                                }
                            }
                        }
                    }
                }
            }
        } catch (sigError) {
            logger.error(`Error processing signature for changed account ${accountId.toBase58()}: ${sigError.message}`, { error: sigError });
        }
      },
      'confirmed' // Commitment level
    );
    logger.info(`Successfully subscribed to Raydium program account changes. Subscription ID: ${poolSubscriptionId}`);

  } catch (error) {
    logger.error(`Error subscribing to Raydium program account changes: ${error.message}`, { error });
    poolSubscriptionId = null; // Reset subscription ID on error
  }
}

/**
 * Unsubscribes from new pool creations.
 */
async function unsubscribeFromNewPools() {
  if (poolSubscriptionId !== null) {
    try {
      await connection.removeProgramAccountChangeListener(poolSubscriptionId);
      logger.info('Successfully unsubscribed from new pool creations.');
      poolSubscriptionId = null;
    } catch (error) {
      logger.error(`Error unsubscribing from new pool creations: ${error.message}`, { error });
    }
  } else {
    logger.info('Not currently subscribed to new pools.');
  }
}


module.exports = {
  connection,
  getTransactionDetails,
  getMintAccountInfo,
  getTokenAccountInfo,
  getPoolLiquidity,
  getCurrentPrice,
  subscribeToNewPools,
  unsubscribeFromNewPools, // Good practice to offer an unsubscribe method
  raydiumProgramId
};

// Example usage (for testing within this file, can be removed)
/*
async function test() {
  // Test getMintAccountInfo
  const solMintInfo = await getMintAccountInfo('So11111111111111111111111111111111111111112'); // SOL Mint
  if (solMintInfo) {
    logger.info('SOL Mint Info:', {
      address: solMintInfo.address.toBase58(),
      mintAuthority: solMintInfo.mintAuthority ? solMintInfo.mintAuthority.toBase58() : null,
      freezeAuthority: solMintInfo.freezeAuthority ? solMintInfo.freezeAuthority.toBase58() : null,
      decimals: solMintInfo.decimals,
      isInitialized: solMintInfo.isInitialized,
    });
  }

  // To test subscribeToNewPools:
  // subscribeToNewPools((poolData) => {
  //   logger.info('Callback - New Pool Detected:', poolData);
  //   // Further processing of poolData
  // });

  // Test getTransactionDetails (replace with a real Raydium initialize2 signature)
  // const exampleTxSig = "YOUR_EXAMPLE_RAYDIUM_INITIALIZE2_SIGNATURE_HERE";
  // const txTest = await getTransactionDetails(exampleTxSig);
  // if (txTest) logger.info("Test Transaction Details:", txTest);

}
test().catch(err => logger.error("Test function error", err));
*/
