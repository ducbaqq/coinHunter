// backend/services/cacheService.js
const cache = new Map();

/**
 * Stores a value in the cache with an optional Time-To-Live (TTL).
 * @param {string} key - The key to store the value under.
 * @param {any} value - The value to store.
 * @param {number} [ttl_ms] - Optional. Time-to-live in milliseconds.
 */
function set(key, value, ttl_ms) {
    const expiryTime = ttl_ms ? Date.now() + ttl_ms : null;
    cache.set(key, { value, expiryTime });
    
    // Clear the entry after ttl_ms if ttl_ms is provided
    // This is an alternative to checking expiryTime on get, ensuring proactive cleanup for entries with TTL
    // However, the problem description implies checking on get, so we'll stick to that primarily.
    // This timeout is just for proactive deletion to free memory if the entry is not accessed again.
    if (ttl_ms) {
        setTimeout(() => {
            // Only delete if it hasn't been updated in the meantime
            const currentEntry = cache.get(key);
            if (currentEntry && currentEntry.expiryTime === expiryTime) {
                cache.delete(key);
                console.log(`Cache AUTO-DELETED (expired): ${key}`);
            }
        }, ttl_ms);
    }
    console.log(`Cache SET: ${key}. TTL: ${ttl_ms ? (ttl_ms / 1000) + 's' : 'none'}`);
}

/**
 * Retrieves a value from the cache.
 * Returns null if the key doesn't exist or if the item has expired.
 * @param {string} key - The key to retrieve.
 * @returns {any|null} The cached value or null.
 */
function get(key) {
    const entry = cache.get(key);
    if (!entry) {
        console.log(`Cache MISS: ${key}`);
        return null;
    }

    if (entry.expiryTime && Date.now() > entry.expiryTime) {
        console.log(`Cache EXPIRED (on get): ${key}`);
        cache.delete(key); // Delete the expired entry
        return null;
    }

    console.log(`Cache HIT: ${key}`);
    return entry.value;
}

/**
 * Explicitly deletes an item from the cache.
 * @param {string} key - The key to delete.
 */
function del(key) {
    const deleted = cache.delete(key);
    if(deleted) {
        console.log(`Cache DEL: ${key}`);
    } else {
        console.log(`Cache DEL (not found): ${key}`);
    }
}

/**
 * Clears the entire cache.
 */
function clear() {
    cache.clear();
    console.log('Cache CLEARED');
}

module.exports = {
    get,
    set,
    del,
    clear, // Added a clear function for potential use in testing or specific scenarios
};

// Example Usage (for testing)
/*
set("myKey", { data: "hello world" }, 5000); // Expires in 5 seconds
set("permanentKey", { data: "this is permanent" });

console.log("Get myKey (should be there):", get("myKey"));
console.log("Get permanentKey (should be there):", get("permanentKey"));

setTimeout(() => {
    console.log("Get myKey after 3s (should still be there):", get("myKey"));
}, 3000);

setTimeout(() => {
    console.log("Get myKey after 6s (should be expired/gone):", get("myKey"));
    console.log("Get permanentKey (should still be there):", get("permanentKey"));
    del("permanentKey");
    console.log("Get permanentKey (should be gone):", get("permanentKey"));
    console.log("Current cache size:", cache.size);
    clear();
    console.log("Current cache size after clear:", cache.size);
}, 6000);
*/
