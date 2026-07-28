/**
 * @typedef {object} ThemeElement
 * @property {string|null} id            Unique id assigned once matched to a DOM node.
 * @property {string|null} propertyHook   Full theme hook, e.g. "node__article".
 * @property {string|null} objectType     Base object type, e.g. "node" (hook split on "__").
 * @property {Array<{suggestion: string, activated: boolean}>|null} suggestions
 * @property {string|null} filePath       Path to the active template file.
 * @property {Element|null} dataNode      The real DOM element this entry describes.
 * @property {Element|null} instanceLayer Populated later by the overlay engine.
 */

/**
 * Creates a fresh, empty theme element. Used while scanning comment nodes,
 * and once per match — no shared/reset state, unlike the original
 * Drupal.themeElement singleton.
 *
 * @returns {ThemeElement}
 */
export function createEmptyThemeElement() {
  return {
    id: null,
    propertyHook: null,
    objectType: null,
    suggestions: null,
    filePath: null,
    dataNode: null,
    instanceLayer: null,
  };
}
