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
 *   Set by the overlay engine's `setupStickyTracking` if `dataNode` sits
 *   under a `position: sticky` ancestor — the shared group object (one
 *   per distinct ancestor) used to flip positioning strategy live.
 * @property {{setActivated: (checked: boolean) => void, setVisible: (visible: boolean) => void, remove: () => void}|null} listRow
 *   Set by `generateListItem` (Items tab, Listed sub-view) — lets
 *   `overlayLayer.js` sync this row's switches without synthetic DOM events.
 * @property {{setActivated: (checked: boolean) => void, setVisible: (visible: boolean) => void, remove: () => void}|null} treeRow
 *   Same contract as `listRow`, set by `generateTreeItem` (Branched
 *   sub-view) — a separate slot since both rows can exist at once and
 *   need independent updates (see `overlayLayer.js`'s `setChecked`/`setVisible`).
 * @property {{setActivated: (checked: boolean) => void, setVisible: (visible: boolean) => void, remove: () => void}|null} groupedRow
 *   Same contract, set by `generateGroupedItem` (Grouped sub-view) — a
 *   third independent slot.
 */

/**
 * Creates a fresh, empty theme element. Used while scanning comment nodes,
 * and once per match.
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
    groupedRow: null,
  };
}
