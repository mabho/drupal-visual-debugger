import { CLASS_NAMES, IDS, LAYER_ATTRIBUTES, STORAGE_KEYS, DEFAULTS } from '../constants.js';
import { webStorageAdapter } from '../storage/webStorageAdapter.js';
import { defaultStrings } from '../i18n/defaultStrings.js';
import { createOnOffSwitch } from './onOffSwitch.js';
// Generated at build time (build.mjs's buildPanelStyles(), gitignored) —
// the panel's compiled CSS plus base64-embedded icon font/Open Sans, for
// the panel's Shadow DOM (separate from the overlay's dist/*.css copies).
import panelStyles from '../../generated/panelStyles.css';

/**
 * Builds the fly-out inspector panel: activation toggle, tabbed
 * Selected/Items (Listed/Branched/Grouped sub-views) views, active
 * element info, theme suggestions, template file path, and the
 * click-drag resize handle.
 *
 * A factory, not a singleton — each call returns an independent instance
 * with its own closured state.
 *
 * @param {object} [options]
 * @param {import('../storage/webStorageAdapter.js').StorageAdapter} [options.storage]
 *   Persistence for the activation toggle and panel width. Defaults to
 *   `webStorageAdapter` (`localStorage`); pass `createMemoryStorageAdapter()`
 *   or a `chrome.storage`-backed adapter in other hosting contexts.
 * @param {Partial<typeof defaultStrings>} [options.strings] Overrides
 *   merged over `defaultStrings` — e.g. `Drupal.t()`-resolved translations.
 * @param {import('../model/themeElement.js').ThemeElement[]} [options.themeElements]
 *   Every theme element found on the page — needed to build the Items tab.
 * @param {ReturnType<typeof import('./overlayLayer.js').createOverlayEngine>} [options.overlay]
 *   Used by the Items tab to select/show/hide/hover a theme element's
 *   overlay without going through synthetic DOM click()s.
 * @param {import('../model/cacheElement.js').CacheElement[]} [options.cacheElements]
 *   Every cache-debug block found on the page — needed to build the Cache
 *   tab. Independent of `themeElements`/`overlay` (see
 *   `drupalCacheDebugParser.js`); the Cache tab only appears when non-empty.
 * @param {ReturnType<typeof import('./overlayLayer.js').createOverlayEngine>} [options.cacheOverlay]
 *   A second, independent overlay engine instance driving `cacheElements`'
 *   overlays — only ever constructed over the subset with a resolved
 *   `dataNode` (see `index.js`).
 * @returns {object} Controller panel instance (see bottom of file for shape).
 */
export function createControllerPanel(options = {}) {
  const storage = options.storage ?? webStorageAdapter;
  const strings = { ...defaultStrings, ...options.strings };
  const themeElements = options.themeElements ?? [];
  const overlay = options.overlay ?? null;
  const cacheElements = options.cacheElements ?? [];
  const cacheOverlay = options.cacheOverlay ?? null;

  let activeThemeElement = null;
  let defaultThemeElement = null;
  // The panel's styled root, inside the shadow root — every function here
  // that queries/styles "the panel" operates on this, not panelHost.
  let panelRoot = null;
  // The light-DOM element appended to the document; owns the shadow root
  // panelRoot lives in. Exposed externally as `controllerLayer`.
  let panelHost = null;
  // Named handlers (not inline arrows) so destroy() can removeEventListener
  // them — registered on `document`, which outlives the panel. Assigned in
  // generateSliderButton().
  let handleSliderMouseMove = null;
  let handleSliderMouseUp = null;
  // Watches document.body; disconnected in destroy().
  let bodyOffsetObserver = null;
  // Branched sub-view state. `collapsedById` (keyed by `themeElement.id`)
  // tracks collapse state across `rebuildBranchedView`'s full rebuilds; no
  // entry means expanded. Entries are deleted in `removeThemeElement`.
  let collapsedById = new Map();
  let branchedViewBuilt = false;
  let branchedViewDirty = false;
  let branchedRefreshScheduled = false;
  // Grouped sub-view state, mirroring Branched's above. `groupCollapsedByType`
  // is keyed by `objectType` (groups are per-type, not per-element).
  // `groupSectionsByType`/`currentGroupTypes` are rebuilt fresh each
  // `rebuildGroupedView` call but must survive individual disclosure
  // toggles and Aggregate-switch clicks between rebuilds.
  // `aggregateSwitchControl` is the Aggregate switch's own on/off control.
  let groupCollapsedByType = new Map();
  let groupedViewBuilt = false;
  let groupedViewDirty = false;
  let groupedRefreshScheduled = false;
  let groupSectionsByType = new Map();
  let currentGroupTypes = null;
  let aggregateSwitchControl = null;

  /**
   * The element the "Selected Element" panel should currently show —
   * whatever's hovered takes priority over whatever's clicked/selected,
   * and `null` if neither is set. Despite the name, this can hold a
   * `CacheElement` just as well as a `ThemeElement`: both `overlay` and
   * `cacheOverlay` report through this same panel via the same
   * `ControllerHooks` interface (see `index.js`).
   *
   * @returns {import('../model/themeElement.js').ThemeElement|import('../model/cacheElement.js').CacheElement|null}
   */
  function getSelectedThemeElement() {
    return activeThemeElement || defaultThemeElement || null;
  }

  /**
   * Is `element` a `CacheElement`? Distinguishes the two kinds of
   * selectable element wherever `activeThemeElement`/`defaultThemeElement`
   * is read, by checking for `cacheHit` rather than an explicit `kind` tag.
   *
   * @param {import('../model/themeElement.js').ThemeElement|import('../model/cacheElement.js').CacheElement|null} element
   * @returns {boolean}
   */
  function isCacheElement(element) {
    return element !== null && 'cacheHit' in element;
  }

  /**
   * The label to show for a cache element, wherever it's identified:
   * its own cache keys joined (e.g. `entity_view:node:1:full`) if
   * present, else the Hit/Miss text (Drupal emits no keys on a hit).
   *
   * @param {import('../model/cacheElement.js').CacheElement} cacheElement
   * @returns {string}
   */
  function getCacheElementLabel(cacheElement) {
    if (cacheElement.keys && cacheElement.keys.length > 0) return cacheElement.keys.join(':');
    return cacheElement.cacheHit ? strings.cacheHit : strings.cacheMiss;
  }

  // ---- DOM builders ------------------------------------------------------

  /**
   * Builds a labeled `<input readonly>` + copy-to-clipboard button row,
   * used for theme suggestions and the template file path. On a
   * successful copy, briefly swaps the button's icon to
   * `CLASS_NAMES.iconSelectedTrue`, then reverts.
   *
   * @param {string|null} itemLabel Visible label, or `null` (e.g.
   *   suggestion rows use an icon instead, and per-value cache detail
   *   rows have no label at all — see `appendCacheDetail`).
   * @param {string|null} itemLabelClass Class for the label wrapper, or
   *   `null` alongside a `null` `itemLabel` to skip the label wrapper
   *   entirely rather than leaving an empty one in the row.
   * @param {string} itemContent Value shown in the input and copied.
   * @returns {Element} The row wrapper, not yet attached to the DOM.
   */
  function generateContentCopyData(itemLabel, itemLabelClass, itemContent) {
    const itemWrapper = document.createElement('div');
    const clipboardContent = document.createElement('input');
    const clipboardButton = document.createElement('button');

    itemWrapper.classList.add(CLASS_NAMES.contentCopyData);

    if (itemLabel || itemLabelClass) {
      const itemLabelWrapper = document.createElement('div');
      itemLabelWrapper.classList.add(itemLabelClass);
      itemLabelWrapper.textContent = itemLabel;
      itemWrapper.appendChild(itemLabelWrapper);
    }

    clipboardContent.value = itemContent;
    clipboardContent.readOnly = true;

    clipboardButton.classList.add(CLASS_NAMES.iconCopyToClipboard);
    clipboardButton.setAttribute('aria-label', strings.copyToClipboard);

    // Closured per button so a second click restarts the revert timer
    // instead of racing the first.
    let feedbackTimeoutId = null;
    clipboardButton.addEventListener('click', () => {
      clipboardCopy(clipboardContent).then((succeeded) => {
        if (!succeeded) return;
        if (feedbackTimeoutId !== null) clearTimeout(feedbackTimeoutId);
        clipboardButton.classList.replace(CLASS_NAMES.iconCopyToClipboard, CLASS_NAMES.iconSelectedTrue);
        feedbackTimeoutId = setTimeout(() => {
          feedbackTimeoutId = null;
          clipboardButton.classList.replace(CLASS_NAMES.iconSelectedTrue, CLASS_NAMES.iconCopyToClipboard);
        }, DEFAULTS.copyFeedbackDuration);
      });
    });

    itemWrapper.append(clipboardContent, clipboardButton);
    return itemWrapper;
  }

  /**
   * Copies a read-only input's value to the clipboard: the async
   * Clipboard API where available, else `document.execCommand('copy')`.
   *
   * @param {Element} contentRefField The `<input readonly>` whose value to copy.
   * @returns {Promise<boolean>} Resolves `true` if the copy succeeded.
   */
  function clipboardCopy(contentRefField) {
    const textToCopy = contentRefField.value;
    if (navigator.clipboard) {
      return navigator.clipboard.writeText(textToCopy).then(() => true, () => false);
    }
    contentRefField.select();
    const succeeded = document.execCommand('copy');
    contentRefField.focus();
    return Promise.resolve(succeeded);
  }

  /**
   * Builds the "nothing to show" placeholder tag used across the Active
   * Element / Selected Element panels.
   *
   * @param {string} infoType Which empty message to show: `'active'` for
   *   `strings.noActiveElement`, anything else for `strings.noSelectedElement`.
   * @returns {Element} The empty-state tag, not yet attached to the DOM.
   */
  function generateEmptyTag(infoType) {
    const wrapper = document.createElement('div');
    wrapper.classList.add(CLASS_NAMES.elementInfoTextContent, CLASS_NAMES.elementInfoEmpty);
    wrapper.textContent = infoType === 'active' ? strings.noActiveElement : strings.noSelectedElement;
    return wrapper;
  }

  /**
   * Builds the "Active Element" panel: a title and an empty info container
   * (populated later by `updateActiveElement`) reflecting whichever theme
   * element is currently hovered.
   *
   * @returns {Element} The panel, not yet attached to the DOM.
   */
  function generateActiveElementLayer() {
    const layer = document.createElement('div');
    layer.classList.add(CLASS_NAMES.activeElementLayer);

    const title = document.createElement('h3');
    title.textContent = strings.activeElement;

    const info = document.createElement('div');
    info.id = IDS.controllerActiveElementInfo;
    info.classList.add(CLASS_NAMES.activeElementInfo);

    layer.append(title, info);
    return layer;
  }

  /**
   * Builds the tab bar (Selected / Items / Cache) and its bottom
   * separator. Each button's click hands off to `switchToTab`; the
   * "Selected" button also gets the `tabsNavigationTabSelected` class,
   * which the CSS uses to show the object-type-colored cue dot that
   * `setTabCue` maintains. The Cache tab is included only when
   * `cacheElements` is non-empty — a page with render-cache debugging
   * off has nothing for it to show.
   *
   * @returns {Element} The tab navigation bar, not yet attached to the DOM.
   */
  function generateTabsNavigation() {
    const nav = document.createElement('div');
    nav.classList.add(CLASS_NAMES.tabsNavigation);

    const tabsRow = document.createElement('div');
    tabsRow.classList.add(CLASS_NAMES.tabsNavigationTabs);

    const tabs = [
      {
        id: IDS.controllerButtonSelected,
        label: strings.tabSelected,
        targetId: IDS.controllerElementSelected,
        extraClasses: [CLASS_NAMES.tabsNavigationTabSelected],
      },
      {
        id: IDS.controllerButtonList,
        label: strings.tabItems,
        targetId: IDS.controllerElementList,
      },
    ];

    if (cacheElements.length > 0) {
      tabs.push({
        id: IDS.controllerButtonCache,
        label: strings.tabCache,
        targetId: IDS.controllerElementCache,
      });
    }

    tabs.forEach((tab) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = tab.id;
      button.setAttribute('data-target-tab', tab.targetId);
      button.setAttribute('aria-label', tab.label);
      button.classList.add(CLASS_NAMES.tabsNavigationTab, ...(tab.extraClasses || []));
      button.textContent = tab.label;
      button.addEventListener('click', () => switchToTab(tab.targetId));
      tabsRow.appendChild(button);
    });

    const separator = document.createElement('div');
    separator.classList.add(CLASS_NAMES.tabsNavigationSeparator);

    nav.append(tabsRow, separator);
    return nav;
  }

  /**
   * Activates a tab: shows the panel matching `targetId` and hides its
   * siblings, and marks the corresponding tab button active. A no-op if
   * either the button or the panel can't be found (e.g. called before
   * `generateControllerLayer` has finished building the DOM).
   *
   * @param {string} targetId The target panel's element `id` — one of
   *   `IDS.controllerElementSelected`/`controllerElementList`.
   * @returns {void}
   */
  function switchToTab(targetId) {
    const button = panelRoot.querySelector(`[data-target-tab="${targetId}"]`);
    const panel = panelRoot.querySelector(`#${targetId}`);
    if (!button || !panel) return;

    Array.from(button.parentElement.children).forEach((sibling) => {
      sibling.classList.remove(CLASS_NAMES.tabActive);
    });
    button.classList.add(CLASS_NAMES.tabActive);

    Array.from(panel.parentElement.children).forEach((sibling) => {
      sibling.classList.remove(CLASS_NAMES.tabActive);
    });
    panel.classList.add(CLASS_NAMES.tabActive);
  }

  /**
   * Builds the "Items" tab (internal DOM vocabulary — `CLASS_NAMES.listElement`
   * etc. — stays as-is even though the rendered label is "Items"; see
   * `tabItems`): the Listed/Branched/Grouped sub-view switcher, a shared
   * "All Elements" switch above all three (`generateAllElementsRow`), the
   * Listed view, and the Branched/Grouped views (built lazily — see
   * `applyItemsSubView`).
   *
   * @returns {Element} The Items tab panel, not yet attached to the DOM.
   */
  function generateItemsTab() {
    const layer = document.createElement('div');
    layer.id = IDS.controllerElementList;
    layer.classList.add(CLASS_NAMES.listElement, CLASS_NAMES.navTarget);

    const switcher = generateItemsSubViewSwitcher();
    const allElementsRow = generateAllElementsRow();

    // Not `CLASS_NAMES.navTarget` on the sub-view containers: their own
    // `__content` rules already set `display: flex` at the same
    // specificity as `.nav-target`'s `display: none`, so which one wins
    // isn't guaranteed — see the `:not(.active)` SCSS rules instead.
    const listedContainer = generateListedSubView();

    const branchedContainer = document.createElement('div');
    branchedContainer.classList.add(CLASS_NAMES.branchedElementContent);

    const groupedContainer = document.createElement('div');
    groupedContainer.classList.add(CLASS_NAMES.groupedElement, CLASS_NAMES.groupedElementContent);

    layer.append(switcher, allElementsRow, listedContainer, branchedContainer, groupedContainer);

    // Passed explicitly since `layer` isn't attached to `panelRoot` yet.
    applyItemsSubView(storage.get(STORAGE_KEYS.itemsSubView, DEFAULTS.itemsSubView), layer);

    return layer;
  }

  /**
   * Builds the single "All Elements" on/off switch shared by all three
   * Items sub-views — one element, placed once under the sub-view
   * switcher (see `generateItemsTab`), outside the sub-views' own content
   * containers so it survives Branched's/Grouped's rebuilds untouched.
   *
   * A pure batch action: always shows the state you last set it to,
   * doesn't track individual elements drifting out of sync.
   *
   * @returns {Element} The row, not yet attached to the DOM.
   */
  function generateAllElementsRow() {
    const allItem = document.createElement('div');
    allItem.classList.add(CLASS_NAMES.listElementItemSelectAll);

    // Reuses `listItemActivation`'s styling (full-width, labeled), not
    // the narrow icon-only `listItemVisibility`.
    const allSwitch = createOnOffSwitch({
      label: strings.allElements,
      checked: true,
      wrapperClasses: [CLASS_NAMES.listItemActivation],
      iconOn: CLASS_NAMES.iconToggleOn,
      iconOff: CLASS_NAMES.iconToggleOff,
    });

    allSwitch.wrapper.addEventListener('click', () => {
      const next = !allSwitch.input.checked;
      allSwitch.setChecked(next);
      themeElements.forEach((themeElement) => overlay?.setThemeElementVisible(themeElement, next));
    });

    allItem.appendChild(allSwitch.wrapper);
    return allItem;
  }

  /**
   * Builds the activation (select/deselect) and visibility (show/hide)
   * switches shared by all Items sub-view rows and the Cache tab's own
   * rows, plus the `applyVisible` sync function each registers as its
   * `listRow`/`treeRow`/`groupedRow`/`cacheRow`.setVisible. Generic over
   * which overlay engine drives it and what the element actually is.
   *
   * @param {{objectType: string|null}} element The element this row
   *   represents — only `.objectType` is read directly here (for the
   *   per-type color class); the rest is passed through opaquely to `overlay`.
   * @param {object} options
   * @param {ReturnType<typeof import('./overlayLayer.js').createOverlayEngine>|null} options.overlay
   *   The overlay engine instance driving this element.
   * @param {string} options.label Activation switch label.
   * @param {boolean} options.initialSelected Real current selection state
   *   — pass `overlay?.isThemeElementSelected(element) ?? false`.
   * @param {boolean} options.initialVisible Real current visibility state
   *   — pass `overlay?.isThemeElementVisible(element) ?? true`.
   * @param {(visible: boolean) => void} [options.onVisibilityToggled]
   *   Run after the visibility switch's own click applies
   *   `overlay.setThemeElementVisible` — Branched rows use this to
   *   cascade to descendants; only from a real click, never from a
   *   passive `applyVisible` sync.
   * @returns {{
   *   activation: ReturnType<typeof createOnOffSwitch>,
   *   visibility: ReturnType<typeof createOnOffSwitch>,
   *   applyVisible: (visible: boolean) => void,
   * }}
   */
  function buildRowControls(element, { overlay, label, initialSelected, initialVisible, onVisibilityToggled }) {
    const activation = createOnOffSwitch({
      label,
      checked: initialSelected,
      wrapperClasses: [CLASS_NAMES.listItemActivation, CLASS_NAMES.objectTypeTyped(element.objectType)],
      wrapperAttributes: { [LAYER_ATTRIBUTES.visible]: String(initialVisible) },
      iconOn: CLASS_NAMES.iconSelectedTrue,
      iconOff: CLASS_NAMES.iconSelectedFalse,
    });

    activation.wrapper.addEventListener('click', () => {
      // A row hidden elsewhere (e.g. Grouped's own group switch), or
      // (Branched only) by a hidden ancestor's cascade, shouldn't be
      // selectable.
      if (activation.wrapper.getAttribute(LAYER_ATTRIBUTES.visible) === 'true') {
        overlay?.toggleThemeElementSelection(element);
      }
    });
    activation.wrapper.addEventListener('mouseenter', () => overlay?.hoverThemeElement(element));
    activation.wrapper.addEventListener('mouseleave', () => overlay?.unhoverThemeElement(element));

    const visibility = createOnOffSwitch({
      checked: initialVisible,
      wrapperClasses: [CLASS_NAMES.listItemVisibility],
      iconOn: CLASS_NAMES.iconToggleOn,
      iconOff: CLASS_NAMES.iconToggleOff,
    });

    /**
     * Syncs this row's visibility switch + disabled look, without
     * touching the overlay — used by this row's own click and by
     * listRow/treeRow/groupedRow/cacheRow.setVisible.
     *
     * @param {boolean} visible New visibility state to reflect.
     * @returns {void}
     */
    function applyVisible(visible) {
      visibility.setChecked(visible);
      activation.wrapper.classList.toggle(CLASS_NAMES.inputWrapperDisabled, !visible);
      activation.wrapper.setAttribute(LAYER_ATTRIBUTES.visible, String(visible));
    }

    visibility.wrapper.addEventListener('click', () => {
      const nextVisible = !visibility.input.checked;
      applyVisible(nextVisible);
      overlay?.setThemeElementVisible(element, nextVisible);
      onVisibilityToggled?.(nextVisible);
    });

    return { activation, visibility, applyVisible };
  }

  /**
   * Builds the Listed sub-view's content: one `generateListItem` row per
   * theme element, in document order.
   *
   * @returns {Element} The Listed sub-view content, not yet attached to the DOM.
   */
  function generateListedSubView() {
    const content = document.createElement('div');
    content.classList.add(CLASS_NAMES.listElementContent);

    themeElements.forEach((themeElement) => {
      content.appendChild(generateListItem(themeElement));
    });

    return content;
  }

  /**
   * Builds one Listed-sub-view row for a single theme element, via
   * `buildRowControls` (no cascade hook — flat rows have no descendants).
   * Registers `themeElement.listRow`, a slot separate from `treeRow`/
   * `groupedRow` (see themeElement.js).
   *
   * @param {import('../model/themeElement.js').ThemeElement} themeElement
   *   The theme element this row represents.
   * @returns {Element} The list item, not yet attached to the DOM.
   */
  function generateListItem(themeElement) {
    const item = document.createElement('div');
    item.classList.add(CLASS_NAMES.listItem);

    const { activation, visibility, applyVisible } = buildRowControls(themeElement, {
      overlay,
      label: themeElement.propertyHook,
      initialSelected: overlay?.isThemeElementSelected(themeElement) ?? false,
      initialVisible: overlay?.isThemeElementVisible(themeElement) ?? true,
    });

    themeElement.listRow = {
      // Scrolls into view on selection from anywhere, not just this row.
      setActivated: (checked) => {
        activation.setChecked(checked);
        if (checked) scrollRowIntoView(item);
      },
      setVisible: applyVisible,
      remove: () => item.remove(),
    };

    item.append(activation.wrapper, visibility.wrapper);
    return item;
  }

  /**
   * Expands every collapsed ancestor of `item` (a Branched row) — a
   * collapsed ancestor is `display:none`, and `scrollIntoView` no-ops on
   * a non-rendered element. Reuses each ancestor's own disclosure
   * button's click handling via a synthetic `.click()`, rather than
   * duplicating its `collapsedById` bookkeeping — safe here since
   * expanding is one-directional (unlike overlay ↔ list selection, which
   * avoids synthetic clicks to prevent a bounce-back loop).
   *
   * @param {Element} item A `.branched-item` row, possibly nested inside
   *   one or more collapsed ancestors.
   * @returns {void}
   */
  function expandCollapsedAncestors(item) {
    let ancestor = item.parentElement?.closest(`.${CLASS_NAMES.branchedItem}.${CLASS_NAMES.branchedItemCollapsed}`);
    while (ancestor) {
      ancestor.querySelector(`:scope > .${CLASS_NAMES.branchedItemRow} > .${CLASS_NAMES.branchedItemDisclosure}`)?.click();
      ancestor = item.parentElement?.closest(`.${CLASS_NAMES.branchedItem}.${CLASS_NAMES.branchedItemCollapsed}`);
    }
  }

  /**
   * Scrolls a row into view. Sets `scroll-margin-top` to the sticky tab
   * nav's height first, or `scrollIntoView` can land the row underneath
   * it (visually hidden despite being "in view").
   *
   * @param {Element} item The row to scroll into view.
   * @returns {void}
   */
  function scrollRowIntoView(item) {
    const nav = panelRoot?.querySelector(`.${CLASS_NAMES.tabsNavigation}`);
    item.style.scrollMarginTop = `${nav?.getBoundingClientRect().height ?? 0}px`;
    item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /**
   * Recursively cascades a visibility change from `themeElement` to every
   * descendant in `childrenOf` (from `deriveThemeElementTree`) — an
   * unconditional batch action: re-showing a parent re-shows every
   * descendant regardless of prior individual state.
   *
   * @param {import('../model/themeElement.js').ThemeElement} themeElement
   *   The node whose descendants (not itself) should cascade.
   * @param {boolean} visible New visibility state to cascade.
   * @param {Map<import('../model/themeElement.js').ThemeElement, import('../model/themeElement.js').ThemeElement[]>} childrenOf
   *   The full tree's children-by-parent map, from `deriveThemeElementTree`.
   * @returns {void}
   */
  function cascadeVisibilityToDescendants(themeElement, visible, childrenOf) {
    (childrenOf.get(themeElement) ?? []).forEach((child) => {
      overlay?.setThemeElementVisible(child, visible);
      cascadeVisibilityToDescendants(child, visible, childrenOf);
    });
  }

  /**
   * Derives the Branched sub-view's tree from the current `themeElements`
   * and live DOM ancestry — recomputed fresh on every call rather than
   * incrementally maintained, so reparenting after a removal happens for
   * free. An element's parent is the nearest ancestor that's also a
   * tracked `dataNode` (not necessarily its immediate DOM parent);
   * elements with none are roots.
   *
   * @returns {{
   *   roots: import('../model/themeElement.js').ThemeElement[],
   *   childrenOf: Map<import('../model/themeElement.js').ThemeElement, import('../model/themeElement.js').ThemeElement[]>,
   * }} In `themeElements` order.
   */
  function deriveThemeElementTree() {
    const byDataNode = new Map();
    themeElements.forEach((themeElement) => byDataNode.set(themeElement.dataNode, themeElement));

    const roots = [];
    const childrenOf = new Map();

    themeElements.forEach((themeElement) => {
      let node = themeElement.dataNode.parentElement;
      let parent = null;
      while (node) {
        if (byDataNode.has(node)) {
          parent = byDataNode.get(node);
          break;
        }
        node = node.parentElement;
      }

      if (parent) {
        if (!childrenOf.has(parent)) childrenOf.set(parent, []);
        childrenOf.get(parent).push(themeElement);
      } else {
        roots.push(themeElement);
      }
    });

    return { roots, childrenOf };
  }

  /**
   * Builds one Branched-sub-view row for `themeElement`: the same
   * switches as `generateListItem`, plus a disclosure icon and (if it has
   * children) a nested children container of recursively-built child
   * rows. A childless element still gets a static "minus" glyph in the
   * same slot, to keep rows aligned with siblings that do have a
   * disclosure triangle. Registers `themeElement.treeRow`, separate from
   * `listRow` (see themeElement.js).
   *
   * @param {import('../model/themeElement.js').ThemeElement} themeElement
   *   The theme element this row represents.
   * @param {Map<import('../model/themeElement.js').ThemeElement, import('../model/themeElement.js').ThemeElement[]>} childrenOf
   *   The full tree's children-by-parent map, from `deriveThemeElementTree`.
   * @returns {Element} The tree item, not yet attached to the DOM.
   */
  function generateTreeItem(themeElement, childrenOf) {
    const children = childrenOf.get(themeElement) ?? [];

    const item = document.createElement('div');
    item.classList.add(CLASS_NAMES.branchedItem);

    const row = document.createElement('div');
    row.classList.add(CLASS_NAMES.branchedItemRow);

    let disclosure;
    let childrenContainer = null;

    if (children.length > 0) {
      disclosure = document.createElement('button');
      disclosure.type = 'button';
      disclosure.classList.add(CLASS_NAMES.branchedItemDisclosure, CLASS_NAMES.iconNavigateNext);
      disclosure.setAttribute('aria-label', strings.toggleExpandCollapse);

      childrenContainer = document.createElement('div');
      childrenContainer.classList.add(CLASS_NAMES.branchedItemChildren);
      children.forEach((child) => childrenContainer.appendChild(generateTreeItem(child, childrenOf)));

      /**
       * Applies a collapsed/expanded state to this node's DOM, without
       * touching `collapsedById`.
       *
       * @param {boolean} collapsed
       * @returns {void}
       */
      const applyCollapsed = (collapsed) => {
        item.classList.toggle(CLASS_NAMES.branchedItemCollapsed, collapsed);
        disclosure.setAttribute('aria-expanded', String(!collapsed));
      };

      disclosure.addEventListener('click', () => {
        const collapsed = !collapsedById.get(themeElement.id);
        collapsedById.set(themeElement.id, collapsed);
        applyCollapsed(collapsed);
      });

      applyCollapsed(collapsedById.get(themeElement.id) ?? false);
    } else {
      // A <span>, not a <button>: a leaf has nothing to expand, but still
      // needs the same icon-width column reserved to keep rows aligned.
      disclosure = document.createElement('span');
      disclosure.classList.add(CLASS_NAMES.branchedItemDisclosure, CLASS_NAMES.iconMinus);
      disclosure.setAttribute('aria-hidden', 'true');
    }

    const { activation, visibility, applyVisible } = buildRowControls(themeElement, {
      overlay,
      label: themeElement.propertyHook,
      initialSelected: overlay?.isThemeElementSelected(themeElement) ?? false,
      initialVisible: overlay?.isThemeElementVisible(themeElement) ?? true,
      onVisibilityToggled: (visible) => cascadeVisibilityToDescendants(themeElement, visible, childrenOf),
    });

    themeElement.treeRow = {
      // Same as `listRow`, plus expanding any collapsed ancestor first —
      // a row inside a collapsed parent is `display:none`.
      setActivated: (checked) => {
        activation.setChecked(checked);
        if (checked) {
          expandCollapsedAncestors(item);
          scrollRowIntoView(item);
        }
      },
      setVisible: applyVisible,
      remove: () => item.remove(),
    };

    row.append(disclosure, activation.wrapper, visibility.wrapper);
    item.appendChild(row);
    if (childrenContainer) item.appendChild(childrenContainer);

    return item;
  }

  /**
   * Builds the Items tab's Listed/Branched/Grouped sub-view switcher —
   * three buttons directly under the tab title, above all three
   * sub-views' content.
   *
   * @returns {Element} The switcher, not yet attached to the DOM.
   */
  function generateItemsSubViewSwitcher() {
    const switcher = document.createElement('div');
    switcher.classList.add(CLASS_NAMES.itemsSubViewSwitcher);

    [
      { id: 'listed', label: strings.subViewListed },
      { id: 'branched', label: strings.subViewBranched },
      { id: 'grouped', label: strings.subViewGrouped },
    ].forEach(({ id, label }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.classList.add(CLASS_NAMES.itemsSubViewButton);
      button.setAttribute('data-subview', id);
      button.textContent = label;
      button.addEventListener('click', () => setItemsSubView(id));
      switcher.appendChild(button);
    });

    return switcher;
  }

  /**
   * Persists and applies a new Items sub-view choice — the click-driven
   * entry point (always called well after the Items tab is live, so it
   * operates on `panelRoot`, unlike `generateItemsTab`'s own initial
   * application — see `applyItemsSubView`'s doc comment).
   *
   * @param {'listed'|'branched'|'grouped'} subview
   * @returns {void}
   */
  function setItemsSubView(subview) {
    storage.set(STORAGE_KEYS.itemsSubView, subview);
    applyItemsSubView(subview, panelRoot);
  }

  /**
   * Shows the chosen sub-view's container and hides the others within
   * `root`, updates the switcher buttons, and rebuilds Branched/Grouped
   * if stale or never built (see `scheduleBranchedRefresh`).
   *
   * @param {'listed'|'branched'|'grouped'} subview
   * @param {Element} root Subtree to query within — `panelRoot`, except
   *   `generateItemsTab` passes its own not-yet-attached `layer`.
   * @returns {void}
   */
  function applyItemsSubView(subview, root) {
    const listedEl = root.querySelector(`.${CLASS_NAMES.listElementContent}`);
    const branchedEl = root.querySelector(`.${CLASS_NAMES.branchedElementContent}`);
    const groupedEl = root.querySelector(`.${CLASS_NAMES.groupedElementContent}`);
    const switcher = root.querySelector(`.${CLASS_NAMES.itemsSubViewSwitcher}`);

    listedEl?.classList.toggle(CLASS_NAMES.tabActive, subview === 'listed');
    branchedEl?.classList.toggle(CLASS_NAMES.tabActive, subview === 'branched');
    groupedEl?.classList.toggle(CLASS_NAMES.tabActive, subview === 'grouped');
    switcher?.querySelectorAll(`.${CLASS_NAMES.itemsSubViewButton}`).forEach((button) => {
      button.classList.toggle(CLASS_NAMES.tabActive, button.getAttribute('data-subview') === subview);
    });

    if (subview === 'branched' && (branchedViewDirty || !branchedViewBuilt)) {
      rebuildBranchedView(branchedEl);
    }
    if (subview === 'grouped' && (groupedViewDirty || !groupedViewBuilt)) {
      rebuildGroupedView(groupedEl);
    }
  }

  /**
   * Rebuilds the Branched sub-view's tree from scratch (see
   * `deriveThemeElementTree`). Collapse state survives via `collapsedById`.
   *
   * @param {Element|null} [branchedEl] The Branched container to rebuild
   *   into. Defaults to looking it up via `panelRoot`.
   * @returns {void}
   */
  function rebuildBranchedView(branchedEl = panelRoot?.querySelector(`.${CLASS_NAMES.branchedElementContent}`)) {
    if (!branchedEl) return;

    branchedEl.innerHTML = '';
    const { roots, childrenOf } = deriveThemeElementTree();
    roots.forEach((themeElement) => branchedEl.appendChild(generateTreeItem(themeElement, childrenOf)));

    branchedViewBuilt = true;
    branchedViewDirty = false;
  }

  /**
   * Is the Branched sub-view currently the one showing? Read by
   * `scheduleBranchedRefresh` to decide whether to coalesce an immediate
   * rebuild or just flag staleness for later.
   *
   * @returns {boolean}
   */
  function isBranchedSubViewActive() {
    return panelRoot?.querySelector(`.${CLASS_NAMES.branchedElementContent}`)?.classList.contains(CLASS_NAMES.tabActive) ?? false;
  }

  /**
   * Flags the Branched sub-view as needing a rebuild; if it's currently
   * active, coalesces the rebuild via a microtask rather than running
   * synchronously. Required for correctness, not just efficiency:
   * `index.js`'s `reconcileDynamicContent` calls this panel's
   * `removeThemeElement` *before* `overlayLayer.js`'s own splices the
   * element out of `themeElements`, so a synchronous rebuild here would
   * read a stale array mid-batch. If Branched isn't active, the rebuild
   * happens lazily next time `applyItemsSubView` switches to it.
   *
   * @returns {void}
   */
  function scheduleBranchedRefresh() {
    branchedViewDirty = true;
    if (!isBranchedSubViewActive() || branchedRefreshScheduled) return;
    branchedRefreshScheduled = true;
    Promise.resolve().then(() => {
      branchedRefreshScheduled = false;
      if (branchedViewDirty) rebuildBranchedView();
    });
  }

  // ---- Items tab: Grouped sub-view + Aggregate switch --------------------

  /**
   * Expands `item`'s own group if collapsed (a group has exactly one
   * possible collapsed ancestor, so a single `closest()` suffices — see
   * `expandCollapsedAncestors` for Branched's arbitrary-depth version).
   * Reuses the group's disclosure button's click handling, which also
   * keeps the Aggregate switch in sync.
   *
   * @param {Element} item A `.list-item` row inside a Grouped-sub-view
   *   group, possibly currently collapsed.
   * @returns {void}
   */
  function expandCollapsedGroupAncestor(item) {
    const ancestor = item.closest(`.${CLASS_NAMES.groupedItem}.${CLASS_NAMES.groupedItemCollapsed}`);
    ancestor?.querySelector(`:scope > .${CLASS_NAMES.groupedItemHeader} > .${CLASS_NAMES.groupedItemDisclosure}`)?.click();
  }

  /**
   * Builds one Grouped-sub-view member row for `themeElement` — the same
   * switches as `generateListItem` (flat, no cascade). Registers
   * `themeElement.groupedRow`, separate from `listRow`/`treeRow`.
   *
   * @param {import('../model/themeElement.js').ThemeElement} themeElement
   *   The theme element this row represents.
   * @returns {Element} The row, not yet attached to the DOM.
   */
  function generateGroupedItem(themeElement) {
    const item = document.createElement('div');
    item.classList.add(CLASS_NAMES.listItem);

    const { activation, visibility, applyVisible } = buildRowControls(themeElement, {
      overlay,
      label: themeElement.propertyHook,
      initialSelected: overlay?.isThemeElementSelected(themeElement) ?? false,
      initialVisible: overlay?.isThemeElementVisible(themeElement) ?? true,
    });

    themeElement.groupedRow = {
      setActivated: (checked) => {
        activation.setChecked(checked);
        if (checked) {
          expandCollapsedGroupAncestor(item);
          scrollRowIntoView(item);
        }
      },
      // Runs for a visibility change from *any* source (this row's own
      // click, another sub-view's row, a direct overlay click) — not just
      // this row's own switch, so
      // `applyVisible` alone (this row's own visuals) isn't enough; the
      // owning group's switch needs the same immediate resync. See
      // `syncGroupSwitchForType`'s doc comment for the "at least one
      // member visible" semantics this implements.
      setVisible: (visible) => {
        applyVisible(visible);
        syncGroupSwitchForType(themeElement.objectType);
      },
      remove: () => item.remove(),
    };

    item.append(activation.wrapper, visibility.wrapper);
    return item;
  }

  /**
   * A click on a group's switch sets every member's overlay to `visible`.
   * The checked state isn't sticky — each member's `groupedRow.setVisible`
   * calls `syncGroupSwitchForType`, converging the switch to the real
   * "at least one member visible" state.
   *
   * @param {ReturnType<typeof createOnOffSwitch>} groupSwitch
   * @param {import('../model/themeElement.js').ThemeElement[]} members
   * @param {boolean} visible New visibility state for the whole group.
   * @returns {void}
   */
  function applyGroupVisible(groupSwitch, members, visible) {
    groupSwitch.setChecked(visible);
    groupSwitch.wrapper.setAttribute(LAYER_ATTRIBUTES.visible, String(visible));
    members.forEach((themeElement) => overlay?.setThemeElementVisible(themeElement, visible));
  }

  /**
   * Builds one Grouped-sub-view group for `type`/`members`: a header row
   * (disclosure button — a group always has ≥1 member, so it's always
   * real/interactive — plus the batch on/off switch, reusing the shared
   * per-type switch styling verbatim) and a children container of member
   * rows. Registers this group's collapse-toggle into
   * `groupSectionsByType` so the Aggregate switch can bulk-collapse/
   * expand without a full `rebuildGroupedView`.
   *
   * The switch's checked state is a live minimum-threshold read of member
   * visibility (`members.some(...)`, kept in sync by
   * `syncGroupSwitchForType`) — never hardcoded, since this group is torn
   * down and rebuilt on every dynamic content change.
   *
   * @param {string} type The `objectType` this group represents.
   * @param {import('../model/themeElement.js').ThemeElement[]} members
   * @returns {Element} The group section, not yet attached to the DOM.
   */
  function generateGroupSection(type, members) {
    const groupEl = document.createElement('div');
    groupEl.classList.add(CLASS_NAMES.groupedItem);

    const header = document.createElement('div');
    header.classList.add(CLASS_NAMES.groupedItemHeader);

    const disclosure = document.createElement('button');
    disclosure.type = 'button';
    disclosure.classList.add(CLASS_NAMES.groupedItemDisclosure, CLASS_NAMES.iconNavigateNext);
    disclosure.setAttribute('aria-label', strings.toggleExpandCollapse);

    const childrenContainer = document.createElement('div');
    childrenContainer.classList.add(CLASS_NAMES.groupedItemChildren);
    members.forEach((themeElement) => childrenContainer.appendChild(generateGroupedItem(themeElement)));

    /**
     * Applies a collapsed/expanded state to this group's DOM, without
     * touching `groupCollapsedByType`.
     *
     * @param {boolean} collapsed
     * @returns {void}
     */
    const applyCollapsed = (collapsed) => {
      groupEl.classList.toggle(CLASS_NAMES.groupedItemCollapsed, collapsed);
      disclosure.setAttribute('aria-expanded', String(!collapsed));
    };

    disclosure.addEventListener('click', () => {
      const collapsed = !groupCollapsedByType.get(type);
      groupCollapsedByType.set(type, collapsed);
      applyCollapsed(collapsed);
      syncAggregateSwitchState();
    });

    applyCollapsed(groupCollapsedByType.get(type) ?? false);

    const initialGroupVisible = members.some((themeElement) => overlay?.isThemeElementVisible(themeElement) ?? true);
    const groupSwitch = createOnOffSwitch({
      label: `${type} - (${members.length})`,
      checked: initialGroupVisible,
      wrapperClasses: [CLASS_NAMES.filtersElementItemActivation, CLASS_NAMES.objectType, CLASS_NAMES.objectTypeTyped(type)],
      wrapperAttributes: { [LAYER_ATTRIBUTES.visible]: String(initialGroupVisible) },
      iconOn: CLASS_NAMES.iconToggleOn,
      iconOff: CLASS_NAMES.iconToggleOff,
      iconBullet: CLASS_NAMES.iconSquare,
      labelFirst: false,
    });

    groupSwitch.wrapper.addEventListener('click', () => {
      applyGroupVisible(groupSwitch, members, !groupSwitch.input.checked);
    });

    groupSectionsByType.set(type, { setCollapsed: applyCollapsed, groupSwitch, members });

    header.append(disclosure, groupSwitch.wrapper);
    groupEl.append(header, childrenContainer);
    return groupEl;
  }

  /**
   * Recomputes and pushes a group's switch to reflect real member
   * visibility — "on" if at least one member is visible, "off" only once
   * every member is hidden. Called from every member's
   * `groupedRow.setVisible`, for a change from any source. No-op if
   * `type` has no registered group.
   *
   * @param {string} type The `objectType` whose group switch to resync.
   * @returns {void}
   */
  function syncGroupSwitchForType(type) {
    const section = groupSectionsByType.get(type);
    if (!section) return;
    const visible = section.members.some((themeElement) => overlay?.isThemeElementVisible(themeElement) ?? true);
    section.groupSwitch.setChecked(visible);
    section.groupSwitch.wrapper.setAttribute(LAYER_ATTRIBUTES.visible, String(visible));
  }

  /**
   * Is every current group collapsed? Backs the Aggregate switch's
   * displayed state (see `syncAggregateSwitchState`).
   *
   * @param {Map<string, import('../model/themeElement.js').ThemeElement[]>} groups
   * @returns {boolean}
   */
  function computeAggregateAllGroups(groups) {
    return groups.size > 0 && Array.from(groups.keys()).every((type) => groupCollapsedByType.get(type) === true);
  }

  /**
   * Pushes the Aggregate switch's live-computed checked state to its
   * control. Called after any group's disclosure toggles and after a
   * full rebuild.
   *
   * @returns {void}
   */
  function syncAggregateSwitchState() {
    if (!aggregateSwitchControl || !currentGroupTypes) return;
    aggregateSwitchControl.setChecked(computeAggregateAllGroups(currentGroupTypes));
  }

  /**
   * The Aggregate switch's click handler: a real bulk write, not just a
   * recompute — flips every current group's `groupCollapsedByType` entry
   * to `next` in one pass and updates each group's disclosure DOM directly
   * via `groupSectionsByType` (rotate icon, hide/show its children
   * container), without a full `rebuildGroupedView` — the same UI-only,
   * no-rebuild-needed characteristic a single group's own disclosure has.
   *
   * @param {boolean} next New collapsed state to apply to every group.
   * @returns {void}
   */
  function applyAggregateToAllGroups(next) {
    if (!currentGroupTypes) return;
    currentGroupTypes.forEach((members, type) => {
      groupCollapsedByType.set(type, next);
      groupSectionsByType.get(type)?.setCollapsed(next);
    });
    aggregateSwitchControl?.setChecked(next);
  }

  /**
   * Rebuilds the Grouped sub-view from scratch: the Aggregate header row
   * plus one `generateGroupSection` per distinct `objectType`, bucketed
   * fresh from `themeElements` each time (full rebuild, mirrors
   * `rebuildBranchedView`).
   *
   * `groupCollapsedByType` survives the rebuild: pruned for removed
   * types, and a brand-new type is seeded with `wasAggregated` (the
   * Aggregate state from just before this rebuild) rather than the usual
   * "expanded by default" — otherwise a new group arriving while
   * Aggregate reads "on" would flip it to "off" on its own.
   *
   * @param {Element|null} [groupedEl] The Grouped container to rebuild
   *   into. Defaults to looking it up via `panelRoot`.
   * @returns {void}
   */
  function rebuildGroupedView(groupedEl = panelRoot?.querySelector(`.${CLASS_NAMES.groupedElementContent}`)) {
    if (!groupedEl) return;

    const groups = new Map();
    themeElements.forEach((themeElement) => {
      if (!groups.has(themeElement.objectType)) groups.set(themeElement.objectType, []);
      groups.get(themeElement.objectType).push(themeElement);
    });
    const wasAggregated = currentGroupTypes ? computeAggregateAllGroups(currentGroupTypes) : false;

    Array.from(groupCollapsedByType.keys()).forEach((type) => {
      if (!groups.has(type)) groupCollapsedByType.delete(type);
    });
    groups.forEach((members, type) => {
      if (!groupCollapsedByType.has(type)) groupCollapsedByType.set(type, wasAggregated);
    });

    groupedEl.innerHTML = '';
    groupSectionsByType = new Map();

    const aggregateRow = document.createElement('div');
    aggregateRow.classList.add(CLASS_NAMES.groupedAggregateRow);

    aggregateSwitchControl = createOnOffSwitch({
      label: strings.aggregateGroups,
      checked: false,
      wrapperClasses: [CLASS_NAMES.listItemActivation],
      iconOn: CLASS_NAMES.iconToggleOn,
      iconOff: CLASS_NAMES.iconToggleOff,
    });
    aggregateSwitchControl.wrapper.addEventListener('click', () => {
      applyAggregateToAllGroups(!aggregateSwitchControl.input.checked);
    });
    aggregateRow.appendChild(aggregateSwitchControl.wrapper);
    groupedEl.appendChild(aggregateRow);

    groups.forEach((members, type) => {
      groupedEl.appendChild(generateGroupSection(type, members));
    });

    currentGroupTypes = groups;
    groupedViewBuilt = true;
    groupedViewDirty = false;
    syncAggregateSwitchState();
  }

  /**
   * Is the Grouped sub-view currently showing? Mirrors
   * `isBranchedSubViewActive`.
   *
   * @returns {boolean}
   */
  function isGroupedSubViewActive() {
    return panelRoot?.querySelector(`.${CLASS_NAMES.groupedElementContent}`)?.classList.contains(CLASS_NAMES.tabActive) ?? false;
  }

  /**
   * Flags the Grouped sub-view as needing a rebuild, coalescing an
   * immediate rebuild via a microtask if active — mirrors
   * `scheduleBranchedRefresh`.
   *
   * @returns {void}
   */
  function scheduleGroupedRefresh() {
    groupedViewDirty = true;
    if (!isGroupedSubViewActive() || groupedRefreshScheduled) return;
    groupedRefreshScheduled = true;
    Promise.resolve().then(() => {
      groupedRefreshScheduled = false;
      if (groupedViewDirty) rebuildGroupedView();
    });
  }

  // ---- Cache tab ------------------------------------------------------

  /**
   * Appends a field group to the Cache Details container: an `<h4>`
   * heading (`label`) plus one copyable, label-less row per entry in
   * `values` (one value per row, never comma-joined), wrapped in their
   * own div so the container's flex gap visually separates field groups.
   * A no-op if `values` is empty/absent.
   *
   * @param {Element} container The Cache Details container.
   * @param {string} label
   * @param {string[]|null} values
   * @returns {void}
   */
  function appendCacheDetail(container, label, values) {
    if (!values || values.length === 0) return;

    const field = document.createElement('div');
    field.classList.add(CLASS_NAMES.selectedElementCacheDetailsField);

    const heading = document.createElement('h4');
    heading.textContent = label;
    field.appendChild(heading);

    values.forEach((value) => field.appendChild(generateContentCopyData(null, null, value)));
    container.appendChild(field);
  }

  /**
   * Builds one Cache-tab row for `cacheElement`. With a real `dataNode`,
   * gets activation/visibility switches (`buildRowControls`, driven by
   * `cacheOverlay`); otherwise a plain non-interactive label. Selecting
   * shows details in the Selected Element panel, like an Items tab row.
   * Label is `cacheElement.keys` joined (e.g. `entity_view:node:1:full`)
   * when present, since every row would otherwise read "Cache Miss" —
   * falls back to the Hit/Miss text on a cache hit (no keys emitted then).
   *
   * @param {import('../model/cacheElement.js').CacheElement} cacheElement
   * @returns {Element} The row, not yet attached to the DOM.
   */
  function generateCacheItem(cacheElement) {
    const item = document.createElement('div');
    item.classList.add(CLASS_NAMES.cacheItem);

    const header = document.createElement('div');
    header.classList.add(CLASS_NAMES.cacheItemHeader);

    const label = getCacheElementLabel(cacheElement);

    if (cacheElement.dataNode) {
      const { activation, visibility, applyVisible } = buildRowControls(cacheElement, {
        overlay: cacheOverlay,
        label,
        initialSelected: cacheOverlay?.isThemeElementSelected(cacheElement) ?? false,
        initialVisible: cacheOverlay?.isThemeElementVisible(cacheElement) ?? true,
      });

      cacheElement.cacheRow = {
        setActivated: (checked) => {
          activation.setChecked(checked);
          if (checked) scrollRowIntoView(item);
        },
        setVisible: applyVisible,
        remove: () => item.remove(),
      };

      header.append(activation.wrapper, visibility.wrapper);
    } else {
      const noElementLabel = document.createElement('div');
      noElementLabel.classList.add(CLASS_NAMES.cacheItemNoElement, CLASS_NAMES.objectType, CLASS_NAMES.objectTypeTyped(cacheElement.objectType));
      noElementLabel.textContent = label;
      noElementLabel.title = strings.noElementForCacheEntry;
      header.append(noElementLabel);
    }

    item.appendChild(header);
    return item;
  }

  /**
   * Builds the "All Elements" on/off switch for the Cache tab — same
   * pure-batch-action pattern as `generateAllElementsRow`, reusing its
   * classes verbatim. Only affects cache elements with a resolved
   * `dataNode`, since the rest have no overlay to show/hide.
   *
   * @returns {Element} The row, not yet attached to the DOM.
   */
  function generateCacheAllElementsRow() {
    const allItem = document.createElement('div');
    allItem.classList.add(CLASS_NAMES.listElementItemSelectAll);

    const allSwitch = createOnOffSwitch({
      label: strings.allElements,
      checked: true,
      wrapperClasses: [CLASS_NAMES.listItemActivation],
      iconOn: CLASS_NAMES.iconToggleOn,
      iconOff: CLASS_NAMES.iconToggleOff,
    });

    allSwitch.wrapper.addEventListener('click', () => {
      const next = !allSwitch.input.checked;
      allSwitch.setChecked(next);
      cacheElements
        .filter((cacheElement) => cacheElement.dataNode)
        .forEach((cacheElement) => cacheOverlay?.setThemeElementVisible(cacheElement, next));
    });

    allItem.appendChild(allSwitch.wrapper);
    return allItem;
  }

  /**
   * Builds the "Cache" tab: the shared "All Elements" switch, then one
   * `generateCacheItem` row per cache-debug block found on the page, in
   * document order. Only ever built when `cacheElements` is non-empty
   * (see `generateTabsNavigation`).
   *
   * @returns {Element} The Cache tab panel, not yet attached to the DOM.
   */
  function generateCacheTab() {
    const layer = document.createElement('div');
    layer.id = IDS.controllerElementCache;
    layer.classList.add(CLASS_NAMES.cacheElement, CLASS_NAMES.navTarget);

    const allElementsRow = generateCacheAllElementsRow();

    const content = document.createElement('div');
    content.classList.add(CLASS_NAMES.cacheElementContent);
    cacheElements.forEach((cacheElement) => content.appendChild(generateCacheItem(cacheElement)));

    layer.append(allElementsRow, content);
    return layer;
  }

  /**
   * Builds the "no debug data" placeholder shown instead of the tab bar
   * when `themeElements` is empty — e.g. the Chrome extension activated
   * on a non-Drupal page, or Twig debugging turned off.
   *
   * @returns {Element} The placeholder panel, not yet attached to the DOM.
   */
  function generateEmptyStateLayer() {
    const layer = document.createElement('div');
    layer.classList.add(CLASS_NAMES.emptyState);

    const title = document.createElement('h3');
    title.classList.add(CLASS_NAMES.emptyStateTitle);
    title.textContent = strings.noDebugDataTitle;

    const message = document.createElement('p');
    message.classList.add(CLASS_NAMES.emptyStateMessage);
    message.textContent = strings.noDebugDataMessage;

    const hint = document.createElement('p');
    hint.classList.add(CLASS_NAMES.emptyStateHint);
    hint.textContent = strings.noDebugDataHint;

    layer.append(title, message, hint);
    return layer;
  }

  /**
   * Builds the "Selected Element" panel: basic info, theme suggestions,
   * template file path, and cache details — empty containers populated
   * later by `updateSelectedElement`. The last three are mutually
   * exclusive: a `ThemeElement` fills suggestions/file path, a
   * `CacheElement` fills cache details, never both.
   *
   * @returns {Element} The panel, not yet attached to the DOM.
   */
  function generateSelectedElementLayer() {
    const layer = document.createElement('div');
    const title = document.createElement('h3');
    layer.id = IDS.controllerElementSelected;
    layer.classList.add(CLASS_NAMES.selectedElement, CLASS_NAMES.navTarget);

    const infoWrapper = document.createElement('div');
    const info = document.createElement('div');
    const infoTitle = document.createElement('h4');
    infoWrapper.classList.add(CLASS_NAMES.selectedElementInfoWrapper);
    info.id = IDS.controllerElementInfo;
    info.classList.add(CLASS_NAMES.selectedElementInfo);
    infoTitle.textContent = strings.basicInfo;
    infoWrapper.append(infoTitle, info);

    const suggestionsWrapper = document.createElement('div');
    const suggestions = document.createElement('div');
    const suggestionsTitle = document.createElement('h4');
    suggestionsWrapper.classList.add(CLASS_NAMES.selectedElementSuggestionsWrapper);
    suggestions.id = IDS.controllerElementSuggestions;
    suggestions.classList.add(CLASS_NAMES.selectedElementSuggestions);
    suggestionsTitle.textContent = strings.themeSuggestions;
    suggestionsWrapper.append(suggestionsTitle, suggestions);

    const filePathWrapper = document.createElement('div');
    const filePath = document.createElement('div');
    const filePathTitle = document.createElement('h4');
    filePathWrapper.classList.add(CLASS_NAMES.selectedElementTemplateFilePathWrapper);
    filePath.classList.add(CLASS_NAMES.selectedElementTemplateFilePath);
    filePath.id = IDS.controllerElementTemplateFilePath;
    filePathTitle.textContent = strings.templateFilePath;
    filePathWrapper.append(filePathTitle, filePath);

    // No static section title here, unlike its siblings above — each
    // field (Cache Tags, Cache Contexts, ...) gets its own `<h4>` heading
    // instead, built dynamically by `appendCacheDetail`.
    const cacheDetailsWrapper = document.createElement('div');
    const cacheDetails = document.createElement('div');
    cacheDetailsWrapper.classList.add(CLASS_NAMES.selectedElementCacheDetailsWrapper);
    cacheDetails.id = IDS.controllerElementCacheDetails;
    cacheDetails.classList.add(CLASS_NAMES.selectedElementCacheDetails);
    cacheDetailsWrapper.appendChild(cacheDetails);

    layer.append(infoWrapper, suggestionsWrapper, filePathWrapper, cacheDetailsWrapper);
    return layer;
  }

  /**
   * Builds the whole fly-out panel — activation form, then Active
   * Element/tabs/Selected/Items (or `generateEmptyStateLayer` if
   * `themeElements` is empty) — sealed behind a Shadow DOM boundary.
   * Assigns `panelRoot` (styled content, inside the shadow root) and
   * `panelHost` (the bare light-DOM element owning it).
   *
   * `panelHost` carries no classes, so host-page CSS can't target it; the
   * shadow stylesheet opens with `:host { all: initial; }` so no
   * inherited property (including page-level `--vd-*` overrides) crosses
   * the boundary.
   *
   * @returns {Element} `panelHost` — the element to append to the document.
   */
  function generateControllerLayer() {
    const layer = document.createElement('div');
    layer.classList.add(CLASS_NAMES.visualDebugger, CLASS_NAMES.controllerBaseLayer);

    const content = document.createElement('div');
    content.classList.add(CLASS_NAMES.content);

    const activationCheckbox = document.createElement('input');
    activationCheckbox.type = 'checkbox';
    activationCheckbox.id = IDS.controllerActivationCheckbox;
    activationCheckbox.classList.add(CLASS_NAMES.checkboxToggle);

    const activated = (storage.get(STORAGE_KEYS.debuggerActivated, 'true')) === 'true';
    activationCheckbox.checked = activated;
    layer.setAttribute(LAYER_ATTRIBUTES.controllerActivated, String(activated));

    activationCheckbox.addEventListener('change', function handleToggle() {
      toggleDebuggerActivated(this.checked);
    });

    const iconTrue = document.createElement('span');
    iconTrue.classList.add(CLASS_NAMES.iconEye, CLASS_NAMES.activated, CLASS_NAMES.iconControllerActivated);
    const iconFalse = document.createElement('span');
    iconFalse.classList.add(CLASS_NAMES.iconEyeBlocked, CLASS_NAMES.deactivated, CLASS_NAMES.iconControllerDeactivated);

    const label = document.createElement('label');
    label.setAttribute('for', activationCheckbox.id);
    label.textContent = strings.debuggerActivated;

    const wrapper = document.createElement('div');
    wrapper.classList.add(CLASS_NAMES.formWrapper);
    wrapper.append(activationCheckbox, iconTrue, iconFalse, label);

    const form = document.createElement('form');
    form.classList.add(CLASS_NAMES.form);
    form.appendChild(wrapper);

    if (themeElements.length > 0) {
      content.append(
        generateActiveElementLayer(),
        generateTabsNavigation(),
        generateSelectedElementLayer(),
        generateItemsTab(),
      );
      // Gated on `themeElements`, not `cacheElements`, alongside the rest
      // of the tab UI above — a page with render-cache debugging on but
      // Twig debugging off still falls into the plain empty-state message.
      if (cacheElements.length > 0) content.appendChild(generateCacheTab());
    } else {
      content.append(generateEmptyStateLayer());
    }
    layer.append(form, content);

    const host = document.createElement('div');
    host.id = IDS.controllerHost;
    const shadowRoot = host.attachShadow({ mode: 'open' });

    const styleEl = document.createElement('style');
    styleEl.textContent = panelStyles;
    shadowRoot.append(styleEl, layer);

    panelRoot = layer;
    panelHost = host;
    toggleDebuggerActivated(activated);
    return host;
  }

  // ---- Activation / sizing ------------------------------------------------

  /**
   * Activates or deactivates the whole debugger: toggles the
   * activated/deactivated classes on `document.body` (which the CSS uses
   * to hide/collapse the overlay and panel), persists the choice, and
   * repositions the panel to match.
   *
   * @param {boolean} [activated] New activation state.
   * @returns {void}
   */
  function toggleDebuggerActivated(activated = true) {
    document.body.classList.toggle(CLASS_NAMES.controllerActivated, activated);
    document.body.classList.toggle(CLASS_NAMES.controllerDeactivated, !activated);
    storage.set(STORAGE_KEYS.debuggerActivated, String(activated));

    if (panelRoot) {
      panelRoot.setAttribute(LAYER_ATTRIBUTES.controllerActivated, String(activated));
      checkControllerActivation();
    }
  }

  /**
   * Reads the panel's current activation state back from the DOM (the
   * attribute `toggleDebuggerActivated` set), rather than from a separate
   * variable — so it's always in sync with what's actually rendered.
   *
   * @returns {boolean} `true` if the debugger is currently activated.
   */
  function getControllerActivationStatus() {
    return panelRoot.getAttribute(LAYER_ATTRIBUTES.controllerActivated) === 'true';
  }

  /**
   * Slides the panel fully into view when activated, or mostly off-screen
   * (leaving a small grab handle showing) when deactivated.
   *
   * @returns {void}
   */
  function checkControllerActivation() {
    if (getControllerActivationStatus()) {
      panelRoot.style.right = '0px';
      return;
    }
    const width = parseInt(panelRoot.style.width, 10) || 0;
    const newPosition = (width - DEFAULTS.controllerDeactivatedGap) * -1;
    panelRoot.style.right = `${newPosition}px`;
  }

  /**
   * Sets the panel's initial width from `storage` (falling back to
   * `DEFAULTS.initialControllerWidth`), clamped so it never exceeds the
   * panel's own CSS `max-width` or the current viewport width.
   *
   * @returns {void}
   */
  function calculateInitialControllerWidth() {
    const stored = storage.get(STORAGE_KEYS.controllerWidth, DEFAULTS.initialControllerWidth);
    let outputWidth = stored;

    const screenWidth = window.innerWidth;
    const maxWidth = window.getComputedStyle(panelRoot).getPropertyValue('max-width');

    if (maxWidth) {
      const maxWidthValue = parseFloat(maxWidth);
      const storedValue = parseFloat(stored);
      outputWidth = maxWidth.endsWith('%')
        ? Math.min((maxWidthValue / 100) * screenWidth, storedValue)
        : Math.min(screenWidth, maxWidthValue, storedValue);
    }

    panelRoot.style.width = `${outputWidth}px`;
  }

  /**
   * Builds and attaches the click-and-drag handle used to resize the
   * panel. Tracks `mousedown` on the handle itself (only while the panel
   * is activated), then `mousemove`/`mouseup` on `document` so dragging
   * keeps working even if the cursor leaves the handle.
   *
   * @returns {void}
   */
  function generateSliderButton() {
    let isMouseDown = false;
    const button = document.createElement('button');
    button.classList.add(CLASS_NAMES.clickDragButton, CLASS_NAMES.iconSlideResize);
    button.setAttribute('aria-label', strings.clickDragButton);

    button.addEventListener('mousedown', () => {
      isMouseDown = getControllerActivationStatus();
    });

    handleSliderMouseMove = (event) => {
      if (!isMouseDown) return;
      resizeControllerLayer(event.clientX);
    };
    document.addEventListener('mousemove', handleSliderMouseMove);

    handleSliderMouseUp = () => {
      if (!isMouseDown) return;
      isMouseDown = false;
      storage.set(STORAGE_KEYS.controllerWidth, panelRoot.style.width);
    };
    document.addEventListener('mouseup', handleSliderMouseUp);

    panelRoot.appendChild(button);
  }

  /**
   * Recomputes the panel's width so its left edge tracks the mouse
   * position during a drag-resize, deferred to the next animation frame to
   * avoid layout thrashing on every `mousemove`.
   *
   * @param {number} [mousePosition] Current horizontal mouse position
   *   (`event.clientX`) during the drag.
   * @returns {void}
   */
  function resizeControllerLayer(mousePosition = 0) {
    const rect = panelRoot.getBoundingClientRect();
    requestAnimationFrame(() => {
      const newWidth = rect.width + rect.left - mousePosition;
      panelRoot.style.width = `${newWidth}px`;
    });
  }

  /**
   * Mirrors an ancestor's top offset (e.g. a sticky admin toolbar pushing
   * body padding-top) onto the controller panel's own top position, so the
   * panel doesn't end up underneath a toolbar.
   *
   * @returns {void}
   */
  function observeBodyOffset() {
    bodyOffsetObserver = new MutationObserver((mutations) => {
      if (!panelRoot) return;
      const newTop = mutations[0].target.style.paddingTop || 0;
      panelRoot.style.top = newTop;
    });
    bodyOffsetObserver.observe(document.body, { attributes: true, attributeFilter: ['style'] });
  }

  // ---- Info rendering ------------------------------------------------------

  /**
   * Renders a theme element's basic info (object type tag + property hook
   * tag, skipping the hook if it's identical to the object type) into a
   * target container, replacing whatever was there before. Used by both
   * the Active Element and Selected Element panels.
   *
   * @param {import('../model/themeElement.js').ThemeElement|null} themeElement
   *   The element to describe, or `null` to render the empty-state tag.
   * @param {Element} targetLayer Container to render into; its existing
   *   contents are cleared first.
   * @param {string} [infoType] Which empty-state message to use when
   *   `themeElement` is `null` — see `generateEmptyTag`.
   * @returns {void}
   */
  function setElementInfo(themeElement, targetLayer, infoType = 'active') {
    targetLayer.innerHTML = '';

    if (themeElement === null) {
      targetLayer.append(generateEmptyTag(infoType));
      return;
    }

    let objectTypeText = '';
    if (themeElement.objectType) {
      const wrapper = document.createElement('div');
      wrapper.classList.add(
        CLASS_NAMES.elementInfoTextContent,
        CLASS_NAMES.elementInfoObjectType,
        `${CLASS_NAMES.elementInfoObjectType}--${themeElement.objectType}`,
      );
      // Color class stays keyed on the raw `objectType` (cache-hit/miss);
      // the displayed text uses the same coherent label as the Cache tab.
      objectTypeText = isCacheElement(themeElement) ? getCacheElementLabel(themeElement) : themeElement.objectType;
      wrapper.textContent = objectTypeText;
      targetLayer.append(wrapper);
    }

    if (themeElement.propertyHook && objectTypeText !== themeElement.propertyHook) {
      const wrapper = document.createElement('div');
      wrapper.classList.add(CLASS_NAMES.elementInfoTextContent, CLASS_NAMES.elementInfoPropertyHook);
      wrapper.textContent = themeElement.propertyHook;
      targetLayer.append(wrapper);
    }
  }

  /**
   * Renders the selected element's theme suggestions (one copyable row
   * per suggestion, marked activated/not). Hides the whole section
   * (title included) when nothing, or a `CacheElement`, is selected.
   *
   * @returns {void}
   */
  function setSelectedElementSuggestions() {
    const themeElement = isCacheElement(defaultThemeElement) ? null : defaultThemeElement;
    const wrapper = panelRoot.querySelector(`.${CLASS_NAMES.selectedElementSuggestionsWrapper}`);
    const layer = panelRoot.querySelector(`#${IDS.controllerElementSuggestions}`);
    if (!layer) return;
    layer.innerHTML = '';

    if (wrapper) wrapper.hidden = themeElement === null;
    if (themeElement === null) return;

    (themeElement.suggestions || []).forEach((item) => {
      const row = generateContentCopyData(
        null,
        item.activated ? CLASS_NAMES.iconSelectedTrue : CLASS_NAMES.iconSelectedFalse,
        item.suggestion,
      );
      layer.appendChild(row);
    });
  }

  /**
   * Renders the selected element's template file path as a copyable row
   * (or the empty-state tag if a real `ThemeElement` is selected but
   * happens to have none). Same self-hiding behavior as
   * `setSelectedElementSuggestions` when nothing, or a `CacheElement`, is
   * selected instead.
   *
   * @returns {void}
   */
  function setSelectedElementTemplateFilePath() {
    const themeElement = isCacheElement(defaultThemeElement) ? null : defaultThemeElement;
    const wrapper = panelRoot.querySelector(`.${CLASS_NAMES.selectedElementTemplateFilePathWrapper}`);
    const target = panelRoot.querySelector(`#${IDS.controllerElementTemplateFilePath}`);
    if (!target) return;
    target.innerHTML = '';

    if (wrapper) wrapper.hidden = themeElement === null;
    if (themeElement === null) return;

    if (!themeElement.filePath) {
      target.append(generateEmptyTag('selected'));
      return;
    }

    const row = generateContentCopyData(
      strings.filePath,
      CLASS_NAMES.selectedElementTemplateFilePathLabel,
      themeElement.filePath,
    );
    target.appendChild(row);
  }

  /**
   * Renders the selected cache element's metadata (tags/contexts/keys/
   * max-age/pre-bubbling variants/rendering time). Hides the whole
   * section when nothing, or a `ThemeElement`, is selected instead.
   *
   * @returns {void}
   */
  function setSelectedElementCacheDetails() {
    const cacheElement = isCacheElement(defaultThemeElement) ? defaultThemeElement : null;
    const wrapper = panelRoot.querySelector(`.${CLASS_NAMES.selectedElementCacheDetailsWrapper}`);
    const layer = panelRoot.querySelector(`#${IDS.controllerElementCacheDetails}`);
    if (!layer) return;
    layer.innerHTML = '';

    if (wrapper) wrapper.hidden = cacheElement === null;
    if (cacheElement === null) return;

    appendCacheDetail(layer, strings.cacheHit, cacheElement.cacheHit === null ? null : [cacheElement.cacheHit ? 'Yes' : 'No']);
    appendCacheDetail(layer, strings.cacheTags, cacheElement.tags);
    appendCacheDetail(layer, strings.cacheContexts, cacheElement.contexts);
    appendCacheDetail(layer, strings.cacheKeys, cacheElement.keys);
    appendCacheDetail(layer, strings.cacheMaxAge, cacheElement.maxAge ? [cacheElement.maxAge] : null);
    appendCacheDetail(layer, strings.preBubblingCacheTags, cacheElement.preBubblingTags);
    appendCacheDetail(layer, strings.preBubblingCacheContexts, cacheElement.preBubblingContexts);
    appendCacheDetail(layer, strings.preBubblingCacheKeys, cacheElement.preBubblingKeys);
    appendCacheDetail(layer, strings.preBubblingCacheMaxAge, cacheElement.preBubblingMaxAge ? [cacheElement.preBubblingMaxAge] : null);
    appendCacheDetail(layer, strings.renderingTime, cacheElement.renderingTime ? [cacheElement.renderingTime] : null);
  }

  /**
   * Refreshes the Active Element panel to reflect `activeThemeElement`
   * (the currently-hovered theme element, or `null`). Call after changing
   * `activeThemeElement`.
   *
   * @returns {void}
   */
  function updateActiveElement() {
    const layer = panelRoot.querySelector(`#${IDS.controllerActiveElementInfo}`);
    if (!layer) return;
    setElementInfo(activeThemeElement, layer, 'active');
  }

  /**
   * Refreshes everything driven by `defaultThemeElement` (the currently
   * selected element — a `ThemeElement`, a `CacheElement`, or `null`):
   * the Selected Element panel's basic info, plus whichever of
   * suggestions/file path (`ThemeElement`) or cache details
   * (`CacheElement`) applies — the other pair renders empty — and the
   * Selected tab's color cue. Call after changing `defaultThemeElement`.
   *
   * @returns {void}
   */
  function updateSelectedElement() {
    const layer = panelRoot.querySelector(`#${IDS.controllerElementInfo}`);
    if (!layer) return;
    setElementInfo(defaultThemeElement, layer, 'selected');
    setSelectedElementSuggestions();
    setSelectedElementTemplateFilePath();
    setSelectedElementCacheDetails();
    setTabCue();
  }

  /**
   * Colors the "Selected" tab's `::before` dot to match the selected
   * element's object type, via the same `--color--object-type` cascade the
   * overlay/Items tab rows use (see `base/_types.scss`). Clears any
   * previous object-type class off the tab button first, then — if
   * something's selected — adds the current one.
   *
   * @returns {void}
   */
  function setTabCue() {
    const button = panelRoot.querySelector(`#${IDS.controllerButtonSelected}`);
    if (!button) return;

    const emptyObjectTypeClass = CLASS_NAMES.objectTypeTyped('');
    Array.from(button.classList).forEach((className) => {
      if (className.startsWith(emptyObjectTypeClass)) button.classList.remove(className);
    });

    if (defaultThemeElement === null) return;
    button.classList.add(CLASS_NAMES.objectTypeTyped(defaultThemeElement.objectType));
  }

  // ---- Public hooks (consumed by the overlay engine) ------------------------

  /**
   * `ControllerHooks.setActiveThemeElement` — a theme element became hovered.
   *
   * @param {import('../model/themeElement.js').ThemeElement} themeElement
   * @returns {void}
   */
  function setActiveThemeElement(themeElement) {
    activeThemeElement = themeElement;
    updateActiveElement();
  }

  /**
   * `ControllerHooks.resetActiveThemeElement` — the hovered element stopped
   * being hovered.
   *
   * @returns {void}
   */
  function resetActiveThemeElement() {
    activeThemeElement = null;
    updateActiveElement();
  }

  /**
   * `ControllerHooks.setDefaultThemeElement` — a theme *or cache* element
   * became selected (both `overlay` and `cacheOverlay` report through
   * this hook). Each engine only enforces single selection within its
   * own array, so deselects the other kind here if it was selected.
   *
   * @param {import('../model/themeElement.js').ThemeElement|import('../model/cacheElement.js').CacheElement} element
   * @returns {void}
   */
  function setDefaultThemeElement(element) {
    if (defaultThemeElement && isCacheElement(defaultThemeElement) !== isCacheElement(element)) {
      (isCacheElement(defaultThemeElement) ? cacheOverlay : overlay)?.toggleThemeElementSelection(defaultThemeElement);
    }
    defaultThemeElement = element;
    updateSelectedElement();
  }

  /**
   * `ControllerHooks.resetDefaultThemeElement` — the selected element was
   * deselected.
   *
   * @returns {void}
   */
  function resetDefaultThemeElement() {
    defaultThemeElement = null;
    updateSelectedElement();
  }

  // ---- Dynamic content (AJAX/BigPipe) ---------------------------------------

  /**
   * Incorporates a theme element discovered after construction (see
   * `index.js`'s `reconcileDynamicContent`). `themeElement` must already
   * be in the shared `themeElements` array — `overlayLayer.js`'s own
   * `addThemeElement` owns pushing it, and must run first.
   *
   * If the panel is showing the empty-state placeholder, tears it down
   * and builds the full tab UI fresh (without re-running
   * `generateSliderButton`/`calculateInitialControllerWidth`, which
   * already ran once). Otherwise appends one Listed row and schedules a
   * Branched/Grouped rebuild.
   *
   * @param {import('../model/themeElement.js').ThemeElement} themeElement
   *   The newly-discovered theme element (already in `themeElements`).
   * @returns {void}
   */
  function addThemeElement(themeElement) {
    const emptyStateEl = panelRoot.querySelector(`.${CLASS_NAMES.emptyState}`);
    if (emptyStateEl) {
      const content = panelRoot.querySelector(`.${CLASS_NAMES.content}`);
      emptyStateEl.remove();
      content.append(
        generateActiveElementLayer(),
        generateTabsNavigation(),
        generateSelectedElementLayer(),
        generateItemsTab(),
      );
      updateActiveElement();
      updateSelectedElement();
      switchToTab(IDS.controllerElementSelected);
      return;
    }

    const listContent = panelRoot.querySelector(`#${IDS.controllerElementList} .${CLASS_NAMES.listElementContent}`);
    listContent?.appendChild(generateListItem(themeElement));

    // Listed row added incrementally above; Branched/Grouped rebuild
    // wholesale instead (see `scheduleBranchedRefresh`).
    scheduleBranchedRefresh();
    scheduleGroupedRefresh();
  }

  /**
   * Reverses `addThemeElement`'s incremental path — call BEFORE
   * `overlayLayer.js`'s own `removeThemeElement` for the same element,
   * while `listRow`/`treeRow`/`groupedRow`/`instanceLayer` are still
   * intact. Resets Active/Selected panels if pointing at `themeElement`,
   * removes its Listed row, and schedules a Branched/Grouped refresh.
   *
   * @param {import('../model/themeElement.js').ThemeElement} themeElement
   *   The theme element to stop tracking.
   * @returns {void}
   */
  function removeThemeElement(themeElement) {
    if (activeThemeElement === themeElement) resetActiveThemeElement();
    if (defaultThemeElement === themeElement) resetDefaultThemeElement();

    themeElement.listRow?.remove();
    collapsedById.delete(themeElement.id);
    scheduleBranchedRefresh();
    scheduleGroupedRefresh();
  }

  /**
   * Incorporates a cache element discovered after construction. `index.js`
   * pushes it to the shared `cacheElements` array before calling this. If
   * the Cache tab wasn't built yet (only built at construction when
   * `cacheElements` was already non-empty), adds its nav button and
   * builds the tab fresh instead of just appending a row.
   *
   * @param {import('../model/cacheElement.js').CacheElement} cacheElement
   * @returns {void}
   */
  function addCacheElement(cacheElement) {
    const existingContent = panelRoot.querySelector(`#${IDS.controllerElementCache} .${CLASS_NAMES.cacheElementContent}`);
    if (existingContent) {
      existingContent.appendChild(generateCacheItem(cacheElement));
      return;
    }

    const tabsRow = panelRoot.querySelector(`.${CLASS_NAMES.tabsNavigationTabs}`);
    if (tabsRow) {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = IDS.controllerButtonCache;
      button.setAttribute('data-target-tab', IDS.controllerElementCache);
      button.setAttribute('aria-label', strings.tabCache);
      button.classList.add(CLASS_NAMES.tabsNavigationTab);
      button.textContent = strings.tabCache;
      button.addEventListener('click', () => switchToTab(IDS.controllerElementCache));
      tabsRow.appendChild(button);
    }
    panelRoot.querySelector(`.${CLASS_NAMES.content}`)?.appendChild(generateCacheTab());
  }

  /**
   * Reverses `addCacheElement`. Call BEFORE `cacheOverlay`'s own
   * `removeThemeElement` (if this element had one), same as
   * `removeThemeElement` requires for `overlayLayer.js`.
   *
   * @param {import('../model/cacheElement.js').CacheElement} cacheElement
   * @returns {void}
   */
  function removeCacheElement(cacheElement) {
    cacheElement.cacheRow?.remove();
  }

  /**
   * One-time setup that must run after the panel's DOM is attached (so
   * `getBoundingClientRect`/computed styles are meaningful): resize
   * handle, panel sizing/position, initial Active/Selected panels, and
   * the "Selected" tab. Called once by `src/index.js`.
   *
   * @returns {void}
   */
  function executePostActivation() {
    generateSliderButton();
    calculateInitialControllerWidth();
    checkControllerActivation();
    updateActiveElement();
    updateSelectedElement();
    switchToTab(IDS.controllerElementSelected);
  }

  /**
   * Tears down everything registered outside `panelHost` (the two
   * `document`-level slider listeners, the body-offset observer — all
   * registered on `document`/`document.body`, which would otherwise keep
   * this closure alive), then removes `panelHost` itself. Everything else
   * lives inside its shadow tree and goes with it.
   *
   * @returns {void}
   */
  function destroy() {
    if (handleSliderMouseMove) document.removeEventListener('mousemove', handleSliderMouseMove);
    if (handleSliderMouseUp) document.removeEventListener('mouseup', handleSliderMouseUp);
    bodyOffsetObserver?.disconnect();
    document.body.classList.remove(CLASS_NAMES.controllerActivated, CLASS_NAMES.controllerDeactivated);
    panelHost?.remove();
  }

  // ---- Build ----------------------------------------------------------------

  generateControllerLayer();
  observeBodyOffset();

  return {
    /**
     * The Shadow DOM host (`panelHost`) — append it to the document once.
     *
     * @returns {Element}
     */
    get controllerLayer() {
      return panelHost;
    },
    executePostActivation,
    setActiveThemeElement,
    resetActiveThemeElement,
    setDefaultThemeElement,
    resetDefaultThemeElement,
    getSelectedThemeElement,
    addThemeElement,
    removeThemeElement,
    addCacheElement,
    removeCacheElement,
    destroy,
  };
}
