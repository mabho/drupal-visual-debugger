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

  const overlay = createOverlayEngine({ themeElements });
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
