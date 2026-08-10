/**
 * @typedef {object} ThemeElement
 * @property {string|null} id            Unique id assigned once matched to a DOM node.
 * @property {string|null} propertyHook   Full theme hook, e.g. "node__article".
 * @property {string|null} objectType     Base object type, e.g. "node" (hook split on "__").
 * @property {Array<{suggestion: string, activated: boolean}>|null} suggestions
 * @property {string|null} filePath       Path to the active template file.
 * @property {Element|null} dataNode      The real DOM element this entry describes.
 * @property {Element|null} instanceLayer Populated later by the overlay engine.
 * @property {import('../render/overlayLayer.js').StickyGroup|null} stickyGroup
 *   Populated later by the overlay engine's `setupStickyTracking`, only if
 *   `dataNode` sits under a `position: sticky` ancestor — the shared group
 *   object (one per distinct sticky ancestor, since many theme elements
 *   commonly share one) used to flip this element's positioning strategy
 *   live as it stuck/unsticks, and to find/detach it on removal.
 * @property {{setActivated: (checked: boolean) => void, setVisible: (visible: boolean) => void, remove: () => void}|null} listRow
 *   Populated by the controller panel's `generateListItem` (Items tab,
 *   Listed sub-view) — lets `overlayLayer.js` (selection/visibility
 *   changes) and the Filters tab (batch visibility) sync that row's
 *   switches without going through synthetic DOM events.
 * @property {{setActivated: (checked: boolean) => void, setVisible: (visible: boolean) => void, remove: () => void}|null} treeRow
 *   Same contract as `listRow`, populated by `generateTreeItem` (Items
 *   tab, Branched sub-view) instead — a *separate* slot, deliberately not
 *   shared with `listRow`, since both sub-views' rows for the same
 *   element can exist independently and both need live updates; see
 *   `overlayLayer.js`'s `setChecked`/`setVisible`, which notify both.
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
    stickyGroup: null,
    listRow: null,
    treeRow: null,
  };
}
