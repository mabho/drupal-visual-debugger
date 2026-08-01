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
  /**
   * Reads a value from `localStorage`.
   *
   * @param {string} key Storage key to read.
   * @param {string|null} [fallback] Value returned if the key is absent, or
   *   if `localStorage` throws (e.g. blocked by browser settings/CSP).
   * @returns {string|null} The stored value, or `fallback`.
   */
  get(key, fallback = null) {
    try {
      const value = window.localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch {
      return fallback;
    }
  },

  /**
   * Writes a value to `localStorage`. Failures (quota exceeded, storage
   * blocked, etc.) are swallowed — persistence is a nice-to-have here, not
   * a hard requirement.
   *
   * @param {string} key Storage key to write.
   * @param {string} value Value to store.
   * @returns {void}
   */
  set(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Swallow — persistence is a nice-to-have, not a hard requirement.
    }
  },
};
