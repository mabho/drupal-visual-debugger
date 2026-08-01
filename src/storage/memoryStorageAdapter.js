/**
 * Creates a `StorageAdapter` backed by an in-memory `Map` instead of
 * `localStorage`. Useful anywhere persistence isn't available or isn't
 * wanted — e.g. tests, or a context with no durable storage.
 *
 * @returns {import('./webStorageAdapter.js').StorageAdapter} A fresh
 *   adapter with its own private store (not shared across calls).
 */
export function createMemoryStorageAdapter() {
  const store = new Map();
  return {
    /**
     * Reads a value from the in-memory store.
     *
     * @param {string} key Storage key to read.
     * @param {string|null} [fallback] Value returned if the key is absent.
     * @returns {string|null} The stored value, or `fallback`.
     */
    get(key, fallback = null) {
      return store.has(key) ? store.get(key) : fallback;
    },

    /**
     * Writes a value to the in-memory store.
     *
     * @param {string} key Storage key to write.
     * @param {string} value Value to store.
     * @returns {void}
     */
    set(key, value) {
      store.set(key, value);
    },
  };
}
