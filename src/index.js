import { parseThemeDebugElements, getUniquePropertyHooks } from './parser/drupalThemeDebugParser.js';
import { createOverlayEngine } from './render/overlayLayer.js';
import { createControllerPanel } from './render/controllerPanel.js';
import { webStorageAdapter } from './storage/webStorageAdapter.js';
import { createMemoryStorageAdapter } from './storage/memoryStorageAdapter.js';
import { defaultStrings } from './i18n/defaultStrings.js';
import { CLASS_NAMES, IDS, LAYER_ATTRIBUTES, STORAGE_KEYS } from './constants.js';

/**
 * Initializes the visual debugger against `root` (defaults to
 * document.body). Safe to call multiple times — it's a no-op if already
 * initialized on the given root.
 *
 * @param {object} [options]
 * @param {Element} [options.root] Root element to scan for theme debug comments.
 * @param {import('./storage/webStorageAdapter.js').StorageAdapter} [options.storage]
 *   Defaults to localStorage. Pass a chrome.storage-backed adapter from the
 *   extension package instead.
 * @param {Partial<typeof defaultStrings>} [options.strings] String overrides (e.g. Drupal.t() results).
 * @param {boolean} [options.debug] Log parsed elements to the console.
 * @returns {{
 *   themeElements: import('./model/themeElement.js').ThemeElement[],
 *   baseLayer: Element,
 *   controllerLayer: Element,
 *   panel: ReturnType<typeof createControllerPanel>,
 *   destroy: () => void,
 * } | null} The parsed theme elements plus the overlay/panel roots that
 *   were appended to `document.body`, or `null` if `root` was already
 *   initialized (the no-op case above) — in which case nothing was
 *   built or appended. Call `destroy()` to fully tear this instance down
 *   (see its own doc comment) — after that, `init()` can be called again
 *   on the same `root` for a clean restart.
 */
export function init(options = {}) {
  const root = options.root ?? document.body;
  const storage = options.storage ?? webStorageAdapter;
  const strings = options.strings ?? {};
  const debug = options.debug ?? false;

  if (root.classList.contains(CLASS_NAMES.initialized)) {
    return null;
  }
  root.classList.add(CLASS_NAMES.initialized);

  const themeElements = parseThemeDebugElements(root);
  if (debug) {
    // eslint-disable-next-line no-console
    console.debug('[drupal-visual-debugger] parsed theme elements:', themeElements);
  }

  /**
   * Reconciliation policy for dynamically-added/removed content (Drupal
   * AJAX commands, BigPipe placeholder swaps, or any other DOM mutation):
   * passed as `onDomChanged` to `createOverlayEngine` below, and called
   * (debounced — see `overlayLayer.js`'s `scheduleContentNotify`) whenever
   * a qualifying mutation suggests something changed. Safe to reference
   * `overlay`/`panel` here despite this function declaration appearing
   * textually before either is constructed — it's hoisted, and it's never
   * actually *called* until well after `init()` has returned (the
   * earliest possible trigger is an async `MutationObserver`/`setTimeout`
   * callback), by which point both are long since assigned.
   *
   * Re-parses `root` for newly-appeared elements — `parseThemeDebugElements`
   * is idempotent across repeat calls on the same root (see its own doc
   * comment), so this naturally only ever returns elements that weren't
   * already tracked — and separately snapshots `themeElements` (the exact
   * array both `overlay` and `panel` share a reference to) for entries
   * whose `dataNode` is no longer connected to the document, the common
   * outcome of both a BigPipe placeholder swap and an ordinary AJAX
   * replace/remove command, to evict. `.filter` takes a fresh snapshot
   * rather than iterating `themeElements` live, since `overlay
   * .removeThemeElement` splices out of that same array as it goes.
   *
   * Add order (overlay, then panel) mirrors `init()`'s own construction
   * order just below. Remove order (panel, then overlay) is required in
   * the other direction — panel's removal needs `listRow`/`instanceLayer`
   * still intact to find and clean up the right row/active-state
   * references; overlay's removal is what nulls them afterward.
   *
   * @returns {void}
   */
  function reconcileDynamicContent() {
    parseThemeDebugElements(root).forEach((themeElement) => {
      overlay.addThemeElement(themeElement);
      panel.addThemeElement(themeElement);
    });

    themeElements
      .filter((themeElement) => !themeElement.dataNode.isConnected)
      .forEach((themeElement) => {
        panel.removeThemeElement(themeElement);
        overlay.removeThemeElement(themeElement);
      });
  }

  const overlay = createOverlayEngine({ themeElements, onDomChanged: reconcileDynamicContent });
  const panel = createControllerPanel({ storage, strings, themeElements, overlay });

  overlay.attachControllerHooks(panel);
  document.body.appendChild(overlay.baseLayer);
  document.body.appendChild(panel.controllerLayer);
  panel.executePostActivation();

  /**
   * Fully tears this instance down: disconnects the overlay's observers
   * and removes its `baseLayer` (`overlay.destroy()`), removes the
   * two `document`-level slider listeners and the body-offset observer
   * and removes the panel's shadow host (`panel.destroy()`), and clears
   * the `initialized` guard from `root` so a later `init()` call on the
   * same `root` runs fresh instead of silently no-op'ing. Idempotent —
   * every step it calls is safe to run more than once.
   *
   * @returns {void}
   */
  function destroy() {
    overlay.destroy();
    panel.destroy();
    root.classList.remove(CLASS_NAMES.initialized);
  }

  return {
    themeElements,
    baseLayer: overlay.baseLayer,
    controllerLayer: panel.controllerLayer,
    panel,
    destroy,
  };
}

export {
  parseThemeDebugElements,
  getUniquePropertyHooks,
  createOverlayEngine,
  createControllerPanel,
  webStorageAdapter,
  createMemoryStorageAdapter,
  defaultStrings,
  CLASS_NAMES,
  IDS,
  LAYER_ATTRIBUTES,
  STORAGE_KEYS,
};
