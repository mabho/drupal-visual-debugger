/**
 * Class names, element IDs, and data-attribute names shared between the
 * overlay engine and the controller panel.
 *
 * These are kept identical to the original Drupal module's markup so
 * existing CSS (visual_debugger's css/source) can be reused with little to
 * no changes.
 */

export const CLASS_NAMES = {
  // Shared / top-level.
  visualDebugger: 'visual-debugger',
  initialized: 'visual-debugger--initialized',

  // Overlay (instance layers).
  baseLayer: 'visual-debugger--base',
  instanceLayer: 'instance-element',
  instanceLayerUnchecked: 'instance-element--unchecked',
  instanceLayerChecked: 'instance-element--checked',
  instanceLayerHover: 'instance-element--hover',
  objectType: 'object-type',
  objectTypeHover: 'object-type--hover',
  /**
   * Builds the per-type modifier class (e.g. `object-type--node`) that
   * `base/_types.scss` uses to set the `--vd-color--object-type` custom
   * property in a given scope. Used on overlay layers, Items tab rows,
   * and the "Selected" tab's color cue (`setTabCue` in controllerPanel.js).
   *
   * @param {string} objectType The theme element's object type (e.g.
   *   `'node'`, `'block'`), or `''` to build the bare prefix used when
   *   scanning for/removing any previously-applied type class.
   * @returns {string} The modifier class name.
   */
  objectTypeTyped: (objectType) => `object-type--${objectType}`,
  iconActivated: 'icon-checkbox-checked',
  iconDeactivated: 'icon-checkbox-unchecked',
  checkboxToggle: 'checkbox-toggle',
  checkboxToggleWrapper: 'checkbox-toggle-wrapper',
  spanToggle: 'span-toggle',
  activated: 'item-activated',
  deactivated: 'item-deactivated',
  inputWrapperActivated: 'wrapper-activated',
  inputWrapperDeactivated: 'wrapper-deactivated',
  inputWrapperDisabled: 'disabled',

  // Controller panel.
  controllerBaseLayer: 'visual-debugger--controller',
  controllerActivated: 'visual-debugger--activated',
  controllerDeactivated: 'visual-debugger--deactivated',
  form: 'activation-form',
  formWrapper: 'activation-form-wrapper',
  content: 'content-auto-scroll',
  elementInfoTextContent: 'tag',
  elementInfoEmpty: 'tag--empty',
  elementInfoObjectType: 'tag--object-type',
  elementInfoPropertyHook: 'tag--prop-hook',
  activeElementLayer: 'active-element',
  activeElementInfo: 'active-element__info',
  selectedElement: 'selected-element',
  selectedElementInfoWrapper: 'selected-element__info-wrapper',
  selectedElementInfo: 'selected-element__info',
  selectedElementSuggestionsWrapper: 'selected-element__suggestions-wrapper',
  selectedElementSuggestions: 'selected-element__suggestions',
  selectedElementTemplateFilePathWrapper: 'selected-element__template-file-path-wrapper',
  selectedElementTemplateFilePath: 'selected-element__template-file-path',
  selectedElementTemplateFilePathLabel: 'label',
  contentCopyData: 'content-copy-data',
  contentCopyDataLabel: 'content-copy-data__label',
  iconSelectedTrue: 'icon-selected-true',
  iconSelectedFalse: 'icon-selected-false',
  iconEye: 'icon-eye',
  iconEyeBlocked: 'icon-eye-blocked',
  iconToggleOn: 'icon-toggle-on',
  iconToggleOff: 'icon-toggle-off',
  iconControllerActivated: 'icon-controller-activated',
  iconControllerDeactivated: 'icon-controller-deactivated',
  iconCopyToClipboard: 'icon-copy',
  iconSlideResize: 'icon-slide-resize',
  // Icomoon's chevron/"navigate_next" glyph — used as the Branched
  // sub-view's disclosure control (see generateTreeItem), rotated via
  // CSS rather than swapped for a different glyph to indicate expanded
  // vs collapsed.
  iconNavigateNext: 'icon-navigate-next',
  // Icomoon's "minus" glyph — a static, non-interactive placeholder for
  // childless Branched-sub-view rows, reserving the same icon-width
  // column a real disclosure triangle would occupy so leaf rows' labels/
  // switches stay aligned with sibling rows that do have children.
  iconMinus: 'icon-minus',
  clickDragButton: 'click-drag-button',

  // "No debug data" placeholder (shown instead of the tab bar/panels when
  // `themeElements` comes back empty — see controllerPanel.js's
  // generateEmptyStateLayer).
  emptyState: 'empty-state',
  emptyStateTitle: 'empty-state__title',
  emptyStateMessage: 'empty-state__message',
  emptyStateHint: 'empty-state__hint',

  // Tabbed navigation.
  tabsNavigation: 'tabbed-navigation',
  tabsNavigationTabs: 'tabbed-navigation__tabs',
  tabsNavigationTab: 'tabbed-navigation__tab',
  tabsNavigationTabSelected: 'tabbed-navigation__tab--selected',
  tabsNavigationSeparator: 'tabbed-navigation__separator',
  tabActive: 'active',
  navTarget: 'nav-target',

  // List tab (internal DOM vocabulary kept as-is even though the tab's
  // rendered label is now "Items" — see defaultStrings.js's `tabItems` —
  // since existing external CSS and querySelector call sites depend on
  // these exact class/id names).
  listElement: 'list',
  listElementContent: 'list__content',
  listItem: 'list-item',
  listItemActivation: 'list-item__activation',
  listItemActivationHover: 'list-item__activation--hover',
  listItemVisibility: 'list-item__visibility',
  listElementItemSelectAll: 'list-item--select-all',

  // Items tab's Listed/Branched sub-view switcher.
  itemsSubViewSwitcher: 'items-subview-switcher',
  itemsSubViewButton: 'items-subview-switcher__button',
  // Reuses `tabActive` (the same "active" class the top-level Selected/
  // Items tab buttons already use) for the active sub-view button, rather
  // than adding a redundant second "active" class.

  // Items tab's Branched (tree) sub-view.
  branchedElement: 'branched',
  branchedElementContent: 'branched__content',
  branchedItem: 'branched-item',
  branchedItemRow: 'branched-item__row',
  branchedItemChildren: 'branched-item__children',
  branchedItemDisclosure: 'branched-item__disclosure',
  // Presence toggles a node's children container closed; absence (the
  // default for a never-toggled node) means expanded — mirrors how
  // `tabActive` is presence-only with no separate "inactive" class.
  branchedItemCollapsed: 'branched-item--collapsed',

  // Items tab's Grouped sub-view (rows bucketed by objectType). Group
  // switches reuse `filtersElementItemActivation`/`objectType`/`iconSquare`
  // verbatim (see generateGroupSection) rather than getting their own
  // class; the Aggregate switch reuses `listItemActivation` verbatim (see
  // the "All Elements" switches) — only the structure below is new.
  groupedElement: 'grouped',
  groupedElementContent: 'grouped__content',
  groupedAggregateRow: 'grouped__aggregate',
  groupedItem: 'grouped-item',
  groupedItemHeader: 'grouped-item__header',
  groupedItemDisclosure: 'grouped-item__disclosure',
  // Presence toggles a group's children container closed; absence means
  // expanded — same convention as `branchedItemCollapsed`.
  groupedItemCollapsed: 'grouped-item--collapsed',
  groupedItemChildren: 'grouped-item__children',

  // Shared per-type on/off switch styling — originally the Filters tab's
  // own (that tab has since been removed entirely), kept because the
  // Items tab's Grouped sub-view still reuses these exact classes
  // verbatim for its own group switches (see generateGroupSection).
  filtersElementItemActivation: 'filters-item__activation',
  iconSquare: 'icon-square',
  iconWithinContent: 'icon-within-content',
};

export const IDS = {
  // The Shadow DOM host appended to the document — see
  // render/controllerPanel.js's generateControllerLayer(). Deliberately
  // the only identifying attribute on that element; it carries no
  // visual-debugger--* classes so page CSS has nothing to coincidentally
  // match.
  controllerHost: 'visual-debugger--controller-host',
  controllerActiveElementInfo: 'visual-debugger--controller--active-element--info',
  controllerElementInfo: 'visual-debugger--controller-layer--info',
  controllerElementSuggestions: 'visual-debugger--controller-layer--suggestions',
  controllerElementTemplateFilePath: 'visual-debugger--controller-layer--template-file-path',
  controllerActivationCheckbox: 'debuggerActivationCheckbox',
  controllerButtonSelected: 'visual-debugger--controller-layer--button--selected',
  controllerElementSelected: 'visual-debugger--controller-layer--selected',
  controllerButtonList: 'visual-debugger--controller-layer--button--list',
  controllerElementList: 'visual-debugger--controller-layer--list',
};

export const LAYER_ATTRIBUTES = {
  layerId: 'data-vd-id',
  layerTargetId: 'data-vd-target-id',
  controllerActivated: 'data-controller-activated',
  visible: 'data-vd-visible',
  listItemActivated: 'data-vd-list-item-activated',
  // Stamped on a tracked element's own `dataNode` once classified — see
  // overlayLayer.js's `classifyPositionStrategy`. Value `'fixed'` means
  // this element is itself `position: fixed`, or a descendant of a clean,
  // viewport-anchored `position: fixed` ancestor; absent means the
  // ordinary absolute+scroll-offset positioning applies. The only thing
  // `positionLayer` reads on its hot path — a single attribute check, no
  // ancestor walk.
  positionStrategy: 'data-vd-position-strategy',
  // Internal short-circuit marker stamped on whichever ancestor element
  // (not necessarily a tracked theme element itself) was confirmed to be
  // a clean, viewport-anchored `position: fixed` containing block — lets
  // later classification walks for *other* tracked elements sharing that
  // same ancestor stop immediately instead of re-deriving it. Revalidated
  // (not blindly trusted) on each use — see `classifyPositionStrategy`.
  fixedContainingBlock: 'data-vd-fixed-root',
  // Marks the tiny sentinel `<div>` overlayLayer.js's `createStickyGroup`
  // inserts as a real sibling of a `position: sticky` ancestor, watched by
  // an `IntersectionObserver` to detect stuck/unstuck transitions. Read by
  // `observePositionChanges`'s `MutationObserver` filter so inserting/
  // removing this element doesn't itself trigger a position resync or a
  // full comment-tree rescan.
  stickySentinelMarker: 'data-vd-sticky-sentinel',
};

export const STORAGE_KEYS = {
  debuggerActivated: 'debuggerActivated',
  controllerWidth: 'controllerWidth',
  itemsSubView: 'itemsSubView',
};

export const DEFAULTS = {
  initialControllerWidth: '400px',
  controllerDeactivatedGap: 10,
  itemsSubView: 'listed',
  // How long the copy-to-clipboard button shows its success feedback
  // (see controllerPanel.js's generateContentCopyData) before reverting
  // to the plain copy icon.
  copyFeedbackDuration: 1500,
};
