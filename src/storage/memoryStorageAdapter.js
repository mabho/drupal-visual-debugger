/**
 * @type {import('./webStorageAdapter.js').StorageAdapter}
 */
export function createMemoryStorageAdapter() {
  const store = new Map();
  return {
    get(key, fallback = null) {
      return store.has(key) ? store.get(key) : fallback;
    },
    set(key, value) {
      store.set(key, value);
    },
  };
}
