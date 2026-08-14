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
 * } | null} The parsed theme elements plus the overlay/panel roots
 *   appended to `document.body`, or `null` if `root` was already
 *   initialized. `destroy()` tears the instance down; `init()` can then
 *   be called again on the same `root`.
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
   * AJAX, BigPipe, or any other DOM mutation) — passed as `onDomChanged`
   * to `createOverlayEngine` below. Referencing `overlay`/`panel` here is
   * safe despite them not being constructed yet: this is hoisted and only
   * called later, once both are assigned.
   *
   * Re-parses `root` for new elements (idempotent, so already-tracked
   * ones are skipped), and evicts entries whose `dataNode` is no longer
   * connected. `.filter` snapshots `themeElements` first since
   * `overlay.removeThemeElement` splices that same array as it goes.
   *
   * Add order (overlay, then panel) mirrors `init()`'s own construction.
   * Remove order is reversed (panel, then overlay): panel's removal needs
   * `listRow`/`instanceLayer` still intact; overlay's removal nulls them.
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
   * Fully tears this instance down (`overlay.destroy()`, `panel.destroy()`)
   * and clears the `initialized` guard so a later `init()` on the same
   * `root` runs fresh.
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
