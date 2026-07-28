/**
 * @typedef {object} StorageAdapter
 * @property {(key: string, fallback?: string) => string|null} get
 * @property {(key: string, value: string) => void} set
 */

/**
 * Default adapter for the Drupal-module context: wraps window.localStorage.
 * Guarded in case storage is unavailable (private browsing, restrictive
 * CSP, iframe without storage access, etc.) so the debugger degrades to
 * "no persistence" instead of throwing.
 *
 * The Chrome extension should provide its own adapter backed by
 * chrome.storage.sync/local instead of this one — see the extension repo.
 *
 * @type {StorageAdapter}
 */
export const webStorageAdapter = {
  get(key, fallback = null) {
    try {
      const value = window.localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Swallow — persistence is a nice-to-have, not a hard requirement.
    }
  },
};
