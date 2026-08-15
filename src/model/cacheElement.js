/**
 * @typedef {object} CacheElement
 * @property {string|null} id Unique id assigned once matched to a DOM node.
 * @property {boolean|null} cacheHit `true`/`false` from `CACHE-HIT: Yes|No`.
 * @property {string|null} objectType `'cache-hit'`/`'cache-miss'`, derived
 *   from `cacheHit` — lets this reuse `createOverlayEngine`'s existing
 *   per-type color-coding with no changes to that module.
 * @property {string[]|null} tags
 * @property {string[]|null} contexts
 * @property {string[]|null} keys
 * @property {string|null} maxAge Raw value as Drupal printed it (e.g. `-1`
 *   for permanent) — never translated to a word like "Permanent".
 * @property {string[]|null} preBubblingTags
 * @property {string[]|null} preBubblingContexts
 * @property {string[]|null} preBubblingKeys
 * @property {string|null} preBubblingMaxAge
 * @property {string|null} renderingTime Only present on a cache miss (the
 *   actual-render path) — always absent on a hit.
 * @property {Element|null} dataNode The real DOM element this entry describes.
 * @property {Element|null} instanceLayer Populated later by the overlay engine.
 * @property {{setActivated: (checked: boolean) => void, setVisible: (visible: boolean) => void, remove: () => void}|null} cacheRow
 *   Set by the controller panel's Cache tab row builder — same contract
 *   as `ThemeElement`'s `listRow`/`treeRow`/`groupedRow`.
 */

/**
 * Creates a fresh, empty cache element. Once per match, no shared state.
 *
 * @returns {CacheElement}
 */
export function createEmptyCacheElement() {
  return {
    id: null,
    cacheHit: null,
    objectType: null,
    tags: null,
    contexts: null,
    keys: null,
    maxAge: null,
    preBubblingTags: null,
    preBubblingContexts: null,
    preBubblingKeys: null,
    preBubblingMaxAge: null,
    renderingTime: null,
    dataNode: null,
    instanceLayer: null,
    cacheRow: null,
  };
}
