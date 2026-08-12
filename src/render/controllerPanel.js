import { CLASS_NAMES, IDS, LAYER_ATTRIBUTES, STORAGE_KEYS, DEFAULTS } from '../constants.js';
import { webStorageAdapter } from '../storage/webStorageAdapter.js';
import { defaultStrings } from '../i18n/defaultStrings.js';
import { createOnOffSwitch } from './onOffSwitch.js';
// Generated at build time by build.mjs's buildPanelStyles() into the
// package-root generated/ directory (gitignored, kept out of src/ since
// everything else here is hand-authored) — the panel's own compiled CSS
// plus self-contained (base64-embedded font) copies of the icon font and
// Open Sans, concatenated. Not authored directly; see that function's doc
// comment for why the panel needs its own copies instead of relying on
// the standalone dist/*.css files the overlay uses.
import panelStyles from '../../generated/panelStyles.css';

/**
 * Builds the fly-out inspector panel: activation toggle, tabbed
 * Selected/Items (Listed/Branched sub-views)/Filters views, active
 * element info, theme suggestions, template file path, and the
 * click-drag resize handle.
 *
 * This is a factory, not a singleton — each call returns an independent
 * instance with its own closured state, unlike the original
 * Drupal.controllerElement object literal.
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
 * @returns {object} Controller panel instance (see bottom of file for shape).
 */
export function createControllerPanel(options = {}) {
  const storage = options.storage ?? webStorageAdapter;
  const strings = { ...defaultStrings, ...options.strings };
  const themeElements = options.themeElements ?? [];
  const overlay = options.overlay ?? null;

  let activeThemeElement = null;
  let defaultThemeElement = null;
  // The panel's own styled root — carries all the visual-debugger--*
  // classes/attributes/inline positioning styles, exactly as it did before
  // the panel moved behind a Shadow DOM boundary. Every other function in
  // this file that queries/styles "the panel" operates on this, not on
  // panelHost — querying a subtree works the same whether or not that
  // subtree happens to live inside a shadow root.
  let panelRoot = null;
  // The light-DOM element actually appended to the document (see
  // generateControllerLayer): a bare host with no meaningful classes,
  // owning the shadow root that panelRoot lives in. Exposed externally as
  // `controllerLayer` (see the returned getter at the bottom of this
  // file) — that name describes the public contract ("append this"), not
  // this variable.
  let panelHost = null;
  // Named handler references (rather than inline arrow functions) so
  // destroy() can removeEventListener() them — these are registered on
  // `document`, which outlives the panel, so they'd otherwise keep this
  // whole closure alive indefinitely. Assigned once in generateSliderButton().
  let handleSliderMouseMove = null;
  let handleSliderMouseUp = null;
  // The observer created in observeBodyOffset(), lifted here so destroy()
  // can disconnect it — it watches document.body, not anything this panel
  // owns/removes itself.
  let bodyOffsetObserver = null;
  // Filters-tab group state, keyed by `objectType` — `{ item, filterSwitch,
  // members }` per group. Lifted here (rather than staying local to
  // `generateFiltersTab`, as it originally was) so `addThemeElement`/
  // `removeThemeElement` can find, update, or create a group's row without
  // rebuilding the whole tab — see those functions and `buildFilterGroupRow`.
  // Populated once, by `generateFiltersTab` itself, at whichever point it
  // gets called (construction time, or later if the panel started in the
  // empty state and this is the first dynamically-added element).
  let filterGroupsByType = new Map();
  // Items tab's Branched sub-view state. `collapsedById` tracks each
  // node's collapsed/expanded state independent of the DOM, keyed by
  // `themeElement.id` (parser-assigned once, stable for that object's
  // whole lifetime) so it survives `rebuildBranchedView`'s full rebuilds;
  // no entry means expanded (the default for a never-toggled node).
  // Entries are deleted in `removeThemeElement` so a long-running,
  // AJAX-heavy page doesn't leak entries for elements that no longer
  // exist. `branchedViewBuilt`/`branchedViewDirty`/
  // `branchedRefreshScheduled` are read/set by `applyItemsSubView`/
  // `rebuildBranchedView`/`scheduleBranchedRefresh` — see each.
  let collapsedById = new Map();
  let branchedViewBuilt = false;
  let branchedViewDirty = false;
  let branchedRefreshScheduled = false;
  // Items tab's Grouped sub-view state — mirrors Branched's own state
  // above, plus pieces specific to bucketed groups and the global
  // Aggregate switch (see rebuildGroupedView/generateGroupSection/
  // applyAggregateToAllGroups for how each is used). `groupCollapsedByType`
  // is keyed by `objectType` (not element id — groups are per-type), not
  // shared with `collapsedById`. `groupSectionsByType` and
  // `currentGroupTypes` are rebuilt fresh every `rebuildGroupedView` call
  // (groups are torn down and recreated wholesale each time), but need to
  // survive the interactions *between* rebuilds — an individual
  // disclosure toggle or an Aggregate-switch click, neither of which
  // triggers a full rebuild. `aggregateSwitchControl` is the Aggregate
  // switch's own `createOnOffSwitch` return value, recreated each rebuild
  // alongside it.
  let groupCollapsedByType = new Map();
  let groupedViewBuilt = false;
  let groupedViewDirty = false;
  let groupedRefreshScheduled = false;
  let groupSectionsByType = new Map();
  let currentGroupTypes = null;
  let aggregateSwitchControl = null;

  /**
   * The theme element the "Selected Element" panel should currently show:
   * whatever's hovered takes priority over whatever's clicked/selected, and
   * `null` if neither is set.
   *
   * @returns {import('../model/themeElement.js').ThemeElement|null}
   */
  function getSelectedThemeElement() {
    return activeThemeElement || defaultThemeElement || null;
  }

  // ---- DOM builders ------------------------------------------------------

  /**
   * Builds a labeled `<input readonly>` + copy-to-clipboard button row,
   * used for theme suggestions and the template file path.
   *
   * @param {string|null} itemLabel Visible label text, or `null` for none
   *   (e.g. suggestion rows, which use an icon instead of a text label).
   * @param {string} itemLabelClass Class added to the label wrapper —
   *   either a text-label style class or an icon class when `itemLabel` is
   *   `null`.
   * @param {string} itemContent The value shown in the (read-only) input
   *   and copied to the clipboard on click.
   * @returns {Element} The row wrapper, not yet attached to the DOM.
   */
  function generateContentCopyData(itemLabel, itemLabelClass, itemContent) {
    const itemWrapper = document.createElement('div');
    const itemLabelWrapper = document.createElement('div');
    const clipboardContent = document.createElement('input');
    const clipboardButton = document.createElement('button');

    itemWrapper.classList.add(CLASS_NAMES.contentCopyData);
    itemLabelWrapper.classList.add(itemLabelClass);
    itemLabelWrapper.textContent = itemLabel;
    clipboardContent.value = itemContent;
    clipboardContent.readOnly = true;

    clipboardButton.classList.add(CLASS_NAMES.iconCopyToClipboard);
    clipboardButton.setAttribute('aria-label', strings.copyToClipboard);
    clipboardButton.addEventListener('click', () => clipboardCopy(clipboardContent));

    itemWrapper.append(itemLabelWrapper, clipboardContent, clipboardButton);
    return itemWrapper;
  }

  /**
   * Copies a read-only input's value to the clipboard, preferring the
   * async Clipboard API and falling back to `document.execCommand('copy')`
   * (via select-and-copy) where it's unavailable.
   *
   * @param {Element} contentRefField The `<input readonly>` whose value to copy.
   * @returns {void}
   */
  function clipboardCopy(contentRefField) {
    const textToCopy = contentRefField.value;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(textToCopy);
    } else {
      contentRefField.select();
      document.execCommand('copy');
      contentRefField.focus();
    }
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
   * Builds the tab bar (Selected / List / Filters) and its bottom
   * separator. Each button's click hands off to `switchToTab`; the
   * "Selected" button also gets the `tabsNavigationTabSelected` class,
   * which the CSS uses to show the object-type-colored cue dot that
   * `setTabCue` maintains.
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
      {
        id: IDS.controllerButtonFilters,
        label: strings.tabFilters,
        targetId: IDS.controllerElementFilters,
      },
    ];

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
   *   `IDS.controllerElementSelected`/`controllerElementList`/`controllerElementFilters`.
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
   * Builds the "Items" tab (formerly labeled "List" — the internal DOM
   * vocabulary, `IDS.controllerElementList`/`CLASS_NAMES.listElement`/
   * etc., is kept exactly as-is on purpose, since existing external CSS
   * and querySelector call sites depend on it; only the rendered label
   * changed — see defaultStrings.js's `tabItems`): a Listed/Branched/
   * Grouped sub-view switcher, the existing flat Listed view (unchanged
   * behavior, via `generateListedSubView`), and the Branched tree/Grouped
   * bucketed views (both built lazily — see `applyItemsSubView`).
   *
   * @returns {Element} The Items tab panel, not yet attached to the DOM.
   */
  function generateItemsTab() {
    const layer = document.createElement('div');
    layer.id = IDS.controllerElementList;
    layer.classList.add(CLASS_NAMES.listElement, CLASS_NAMES.navTarget);

    const switcher = generateItemsSubViewSwitcher();

    // Deliberately NOT `CLASS_NAMES.navTarget` on any sub-view container:
    // `.list__content`/`.branched__content`/`.grouped__content` already
    // carry their own unconditional `display: flex` rule (for their own
    // internal layout), at the same specificity as `.nav-target`'s
    // `display: none` — a tie those rules always won (they compile later
    // in the stylesheet), so the sub-view that should've been hidden
    // never actually was, regardless of which had the `active` class. See
    // the dedicated `:not(.active)` SCSS rules instead, which
    // unambiguously outrank the plain `display: flex` rule by specificity
    // rather than relying on source order.
    const listedContainer = generateListedSubView();

    const branchedContainer = document.createElement('div');
    branchedContainer.classList.add(CLASS_NAMES.branchedElementContent);

    // Unlike `branchedContainer` above, actually carries `groupedElement`
    // (`.grouped`'s background-color/padding) alongside
    // `groupedElementContent` — `CLASS_NAMES.branchedElement` is declared
    // but never applied anywhere, leaving its own SCSS rule dead; this
    // doesn't repeat that omission.
    const groupedContainer = document.createElement('div');
    groupedContainer.classList.add(CLASS_NAMES.groupedElement, CLASS_NAMES.groupedElementContent);

    layer.append(switcher, listedContainer, branchedContainer, groupedContainer);

    // Passes `layer` explicitly (not yet attached to `panelRoot`) rather
    // than relying on `applyItemsSubView`'s `panelRoot`-based default —
    // see that function's own doc comment for why.
    applyItemsSubView(storage.get(STORAGE_KEYS.itemsSubView, DEFAULTS.itemsSubView), layer);

    return layer;
  }

  /**
   * Builds the activation ("select/deselect", labeled with the theme hook)
   * and visibility ("show/hide") switches shared by all three Items
   * sub-views' rows (Listed's `generateListItem`, Branched's
   * `generateTreeItem`, Grouped's `generateGroupedItem`), plus the
   * `applyVisible` sync function each registers as its row's
   * `listRow.setVisible`/`treeRow.setVisible`/`groupedRow.setVisible`.
   * Parameterized on real
   * current state rather than hardcoding it — a latent bug fixed as part
   * of adding the Branched sub-view: both switches used to hardcode their
   * initial checked/visible state regardless of the element's actual
   * current selection/visibility, harmless while rows were rarely
   * rebuilt after construction, but very visible once Branched started
   * fully rebuilding rows on every dynamic content change (a rebuilt row
   * for an already-selected or already-hidden element would silently show
   * the wrong state — worse, a hidden element's row would become
   * clickable/selectable again, since the activation click handler gates
   * on this same `visible` attribute).
   *
   * @param {import('../model/themeElement.js').ThemeElement} themeElement
   *   The theme element this row represents.
   * @param {object} options
   * @param {boolean} options.initialSelected Real current selection state
   *   — pass `overlay?.isThemeElementSelected(themeElement) ?? false`.
   * @param {boolean} options.initialVisible Real current visibility state
   *   — pass `overlay?.isThemeElementVisible(themeElement) ?? true`.
   * @param {(visible: boolean) => void} [options.onVisibilityToggled]
   *   Extra effect run after the visibility switch's own click applies
   *   `overlay.setThemeElementVisible` — Branched rows use this to
   *   cascade the change to every descendant (see `generateTreeItem`);
   *   Listed rows, which have no descendants, leave it unset. Never
   *   called from `applyVisible` itself (only from a real user click) —
   *   `applyVisible` is a passive state-sync path, not a trigger point,
   *   so an externally-driven sync (e.g. the Filters tab hiding this row)
   *   doesn't redundantly re-cascade.
   * @returns {{
   *   activation: ReturnType<typeof createOnOffSwitch>,
   *   visibility: ReturnType<typeof createOnOffSwitch>,
   *   applyVisible: (visible: boolean) => void,
   * }}
   */
  function buildRowControls(themeElement, { initialSelected, initialVisible, onVisibilityToggled }) {
    const activation = createOnOffSwitch({
      label: themeElement.propertyHook,
      checked: initialSelected,
      wrapperClasses: [CLASS_NAMES.listItemActivation, CLASS_NAMES.objectTypeTyped(themeElement.objectType)],
      wrapperAttributes: { [LAYER_ATTRIBUTES.visible]: String(initialVisible) },
      iconOn: CLASS_NAMES.iconSelectedTrue,
      iconOff: CLASS_NAMES.iconSelectedFalse,
    });

    activation.wrapper.addEventListener('click', () => {
      // A row hidden by a filter (Filters tab), or (Branched only) by a
      // hidden ancestor's cascade, shouldn't be selectable.
      if (activation.wrapper.getAttribute(LAYER_ATTRIBUTES.visible) === 'true') {
        overlay?.toggleThemeElementSelection(themeElement);
      }
    });
    activation.wrapper.addEventListener('mouseenter', () => overlay?.hoverThemeElement(themeElement));
    activation.wrapper.addEventListener('mouseleave', () => overlay?.unhoverThemeElement(themeElement));

    const visibility = createOnOffSwitch({
      checked: initialVisible,
      wrapperClasses: [CLASS_NAMES.listItemVisibility],
      iconOn: CLASS_NAMES.iconToggleOn,
      iconOff: CLASS_NAMES.iconToggleOff,
    });

    /**
     * Syncs this row's own visibility switch + disabled look, without
     * touching the overlay — used both by this row's own click (which also
     * tells the overlay) and by listRow/treeRow.setVisible (called BY the
     * overlay when visibility changes elsewhere, e.g. the Filters tab).
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
      overlay?.setThemeElementVisible(themeElement, nextVisible);
      onVisibilityToggled?.(nextVisible);
    });

    return { activation, visibility, applyVisible };
  }

  /**
   * Builds the Listed sub-view's content: one `generateListItem` row per
   * theme element, in document order, plus an "All Elements" switch
   * (mirroring the Filters tab's own — see `generateFiltersTab`) that
   * shows/hides every element's overlay at once.
   *
   * @returns {Element} The Listed sub-view content, not yet attached to the DOM.
   */
  function generateListedSubView() {
    const content = document.createElement('div');
    content.classList.add(CLASS_NAMES.listElementContent);

    themeElements.forEach((themeElement) => {
      content.appendChild(generateListItem(themeElement));
    });

    const allItem = document.createElement('div');
    allItem.classList.add(CLASS_NAMES.listElementItemSelectAll);

    // Reuses `listItemActivation`'s styling (a full-width, labeled row),
    // not `listItemVisibility` (the narrow, icon-only per-row eye toggle)
    // — the latter has no room for a label and would render cramped here.
    // Its `[data-vd-list-item-activated='true']` selection-highlight rule
    // never applies to this switch since nothing ever sets that attribute
    // on it (it's not a real theme-element row, just a batch action).
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
      // `setThemeElementVisible` already calls the affected row's own
      // `listRow.setVisible` internally (see overlayLayer.js's
      // `setVisible`) — same as `applyFilterVisible` relies on for the
      // Filters tab, no separate call needed here.
      themeElements.forEach((themeElement) => overlay?.setThemeElementVisible(themeElement, next));
    });

    allItem.appendChild(allSwitch.wrapper);
    content.prepend(allItem);

    return content;
  }

  /**
   * Builds one Listed-sub-view row for a single theme element, via
   * `buildRowControls` (no cascade hook — a flat row has no descendants).
   * Registers `themeElement.listRow` so the overlay engine (selection/
   * visibility) and the Filters tab (batch visibility) can keep this
   * row's switches in sync when either changes from somewhere other than
   * this row itself; a *separate* slot from `treeRow` (see
   * themeElement.js's doc comment) since the Branched sub-view's row for
   * the same element, if it currently exists, needs independent updates.
   *
   * @param {import('../model/themeElement.js').ThemeElement} themeElement
   *   The theme element this row represents.
   * @returns {Element} The list item, not yet attached to the DOM.
   */
  function generateListItem(themeElement) {
    const item = document.createElement('div');
    item.classList.add(CLASS_NAMES.listItem);

    const { activation, visibility, applyVisible } = buildRowControls(themeElement, {
      initialSelected: overlay?.isThemeElementSelected(themeElement) ?? false,
      initialVisible: overlay?.isThemeElementVisible(themeElement) ?? true,
    });

    themeElement.listRow = {
      // Scrolls this row into view whenever it becomes selected from
      // *anywhere* (a real click on the overlay, the Filters tab, the
      // Branched sub-view) — not just a click on this row itself, which
      // is already in view. Harmless in that case too: scrolling an
      // already-visible element is a no-op.
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
   * Expands every currently-collapsed ancestor of `item` (a Branched-
   * sub-view row) — called before scrolling a newly-selected row into
   * view (see `generateTreeItem`'s `treeRow.setActivated`), since a row
   * nested inside a collapsed parent/grandparent is `display:none` (the
   * `--collapsed` SCSS rule), and `scrollIntoView` silently does nothing
   * for a non-rendered element.
   *
   * Reuses each ancestor's own disclosure button's real click handling
   * (via a synthetic `.click()`) rather than duplicating its
   * `collapsedById`/`aria-expanded` bookkeeping here. Safe to do —
   * unlike the overlay ↔ list selection toggle, which deliberately
   * avoids synthetic click-forwarding to prevent a bounce-back loop —
   * since expanding is one-directional and idempotent: nothing the
   * disclosure's click handler does calls back into this function.
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
   * Scrolls a List/Branched row into view. Sets `scroll-margin-top` to
   * the sticky tab nav's current height first — otherwise `scrollIntoView`
   * can land the row's top edge exactly under `.tabbed-navigation`
   * (`position: sticky; top: 0`), technically in the scrollable area but
   * visually hidden behind it. Measured fresh each call rather than
   * cached, since it only runs on selection (not a hot path) and stays
   * correct if the nav's height ever changes.
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
   * descendant found in `childrenOf` (from `deriveThemeElementTree`) — an
   * unconditional batch action, not a tri-state: re-showing a parent
   * re-shows every descendant regardless of whether any were individually
   * hidden before the parent was hidden, mirroring the Filters tab's own
   * documented "All Elements" philosophy (`applyFilterVisible`). Each
   * descendant's `overlay.setThemeElementVisible` call already syncs that
   * descendant's own `listRow`/`treeRow` internally — no separate sync
   * needed here.
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
   * Builds the Branched sub-view's tree structure fresh from the
   * *current* `themeElements` array and live DOM ancestry — deliberately
   * recomputed from scratch on every call rather than incrementally
   * maintained, since incrementally reparenting orphaned children on
   * removal is meaningfully more bug-prone than a cheap full recompute
   * (O(n × domDepth) — a few thousand comparisons at most for a realistic
   * page). This also means "reparent to the nearest surviving tracked
   * ancestor" after a dynamic removal happens for free: nothing removal-
   * specific needs to run, whoever's now nearest is simply found fresh.
   *
   * An element's parent is the nearest ancestor (walking up
   * `dataNode.parentElement`) that is *also* a currently-tracked
   * `dataNode` — not necessarily its immediate DOM parent, since
   * untracked elements commonly sit in between. Elements with no such
   * ancestor are roots.
   *
   * @returns {{
   *   roots: import('../model/themeElement.js').ThemeElement[],
   *   childrenOf: Map<import('../model/themeElement.js').ThemeElement, import('../model/themeElement.js').ThemeElement[]>,
   * }} `roots` and each `childrenOf` array are in `themeElements` order.
   *   `childrenOf` is the only map actually needed by both tree rendering
   *   and the visibility cascade — a `parentOf` map isn't separately
   *   required.
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
   * activation/visibility switches as `generateListItem` (via
   * `buildRowControls`), plus a disclosure icon and — only if this
   * element has children — a nested children container holding
   * recursively-built child rows. A childless element still gets an icon
   * in that same slot (a static, non-interactive "minus" glyph) rather
   * than nothing at all — leaving the slot empty would shift that row's
   * label/switches left relative to sibling rows that DO have a
   * disclosure triangle, misaligning the whole tree. Indentation is
   * purely structural: each nesting level's `.branched-item__children`
   * container gets its own `padding-left` in SCSS, so depth-based
   * indentation compounds naturally with no JS math needed. Registers
   * `themeElement.treeRow` — a *separate* slot from `listRow` (see
   * themeElement.js's doc comment for why both must exist independently).
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
      // The icon font's glyph renders via its own `:before` rule keyed on
      // `iconNavigateNext`, directly on this button — no separate icon
      // element needed, matching how e.g. generateSliderButton's own
      // icon class works.
      disclosure.classList.add(CLASS_NAMES.branchedItemDisclosure, CLASS_NAMES.iconNavigateNext);
      disclosure.setAttribute('aria-label', strings.toggleExpandCollapse);

      childrenContainer = document.createElement('div');
      childrenContainer.classList.add(CLASS_NAMES.branchedItemChildren);
      children.forEach((child) => childrenContainer.appendChild(generateTreeItem(child, childrenOf)));

      /**
       * Applies a collapsed/expanded state to this node's own DOM
       * (children container + disclosure button), without touching
       * `collapsedById` — used both by the click handler (which also
       * writes to `collapsedById`) and at build time to apply whatever
       * state was already remembered from a previous rebuild.
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
      // Not a real disclosure control — a leaf has nothing to expand, but
      // without SOME element reserving the same icon-width column, a
      // leaf's row would shift left relative to sibling rows that DO have
      // a disclosure triangle, misaligning every row's label/switches.
      // Deliberately a <span>, not a <button>: it isn't interactive, so
      // it shouldn't look or behave like a clickable control (see the
      // matching `button.branched-item__disclosure` scoping in SCSS,
      // which keeps `cursor: pointer` and the rotation transition off
      // this element).
      disclosure = document.createElement('span');
      disclosure.classList.add(CLASS_NAMES.branchedItemDisclosure, CLASS_NAMES.iconMinus);
      disclosure.setAttribute('aria-hidden', 'true');
    }

    const { activation, visibility, applyVisible } = buildRowControls(themeElement, {
      initialSelected: overlay?.isThemeElementSelected(themeElement) ?? false,
      initialVisible: overlay?.isThemeElementVisible(themeElement) ?? true,
      onVisibilityToggled: (visible) => cascadeVisibilityToDescendants(themeElement, visible, childrenOf),
    });

    themeElement.treeRow = {
      // Same "scroll into view whenever selected from anywhere" behavior
      // as `generateListItem`'s `listRow`, plus expanding any collapsed
      // ancestor first — a row nested inside a collapsed parent is
      // `display:none` (see the `--collapsed` SCSS rule), and
      // `scrollIntoView` silently does nothing for a non-rendered
      // element, so without this a selection arriving via a collapsed
      // branch would select the row but never actually reveal it.
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
   * Shows the chosen sub-view's container and hides the other within
   * `root`, updates the switcher buttons' active state, and — switching
   * TO Branched — builds/rebuilds it if it's never been built yet or has
   * gone stale since it was last shown (see `scheduleBranchedRefresh`).
   *
   * @param {'listed'|'branched'|'grouped'} subview
   * @param {Element} root Subtree to query the three containers and the
   *   switcher within. Always `panelRoot` except for one call, inside
   *   `generateItemsTab` itself, which passes the tab's own not-yet-
   *   attached `layer` — `panelRoot.querySelector` wouldn't find anything
   *   not yet attached to it, but `querySelector` on any detached subtree
   *   (attached or not) works fine, so an explicit root sidesteps that
   *   ordering problem without duplicating this function's logic.
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
   * Rebuilds the Branched sub-view's entire tree from scratch, using the
   * current `themeElements`/DOM ancestry (via `deriveThemeElementTree` —
   * see that function's own doc comment for why a full rebuild, rather
   * than incremental patching, is the right call here). Collapsed/
   * expanded state survives the rebuild via `collapsedById`, read fresh
   * by each `generateTreeItem` call as it's (re)built; discarding the old
   * row DOM is safe since both `listRow` and `treeRow` are independent
   * slots (nothing outside the replaced subtree references the old rows).
   *
   * @param {Element|null} [branchedEl] The Branched container to rebuild
   *   into. Defaults to looking it up via `panelRoot` — every caller
   *   except `applyItemsSubView` (which already has it in hand from its
   *   own, possibly-not-yet-`panelRoot`-attached `root`) relies on this
   *   default.
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
   * Flags the Branched sub-view as needing a rebuild, and — only if it's
   * currently the active sub-view — coalesces that rebuild via a
   * microtask rather than running it synchronously. This is a correctness
   * requirement, not just an efficiency one: `index.js`'s
   * `reconcileDynamicContent` calls this panel's own `addThemeElement`/
   * `removeThemeElement` synchronously, in a batch, and for removal
   * specifically calls this panel's `removeThemeElement` *before*
   * `overlayLayer.js`'s own `removeThemeElement` actually splices the
   * element out of the shared `themeElements` array — rebuilding
   * synchronously from in here would read a momentarily-stale array
   * mid-batch. Scheduling via `Promise.resolve().then(...)` guarantees
   * this only actually runs after the full synchronous batch (every
   * add/remove call in that reconciliation pass) has settled, by which
   * point `themeElements` is final. If Branched isn't currently active,
   * no rebuild is scheduled at all — it happens lazily, once, the next
   * time `applyItemsSubView` switches to it.
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
   * Groups theme elements by `objectType`, preserving first-seen order —
   * shared by the Filters tab (`generateFiltersTab`, a pure refactor of
   * logic that used to be inline there) and the Items tab's Grouped
   * sub-view (`rebuildGroupedView`), both of which need the exact same
   * bucketing.
   *
   * @param {import('../model/themeElement.js').ThemeElement[]} elements
   * @returns {Map<string, import('../model/themeElement.js').ThemeElement[]>}
   *   One entry per distinct `objectType`, in first-seen order.
   */
  function groupThemeElementsByType(elements) {
    const groups = new Map();
    elements.forEach((themeElement) => {
      if (!groups.has(themeElement.objectType)) groups.set(themeElement.objectType, []);
      groups.get(themeElement.objectType).push(themeElement);
    });
    return groups;
  }

  /**
   * Expands `item`'s own group if it's currently collapsed — called before
   * scrolling a newly-selected Grouped-sub-view row into view (see
   * `generateGroupedItem`'s `groupedRow.setActivated`), for the same
   * reason `expandCollapsedAncestors` exists for Branched: a row inside a
   * collapsed group is `display:none` (the `--collapsed` SCSS rule), and
   * `scrollIntoView` silently no-ops on a non-rendered element. Simpler
   * than Branched's version — a Grouped row has exactly one possible
   * collapsed ancestor (its own group), not an arbitrary-depth chain — so
   * this only needs a single `closest()` lookup, not a loop. Reuses the
   * group's own disclosure button's real click handling (via a synthetic
   * `.click()`), which also keeps the Aggregate switch's live state in
   * sync (see that handler in `generateGroupSection`) — no separate sync
   * call needed here.
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
   * activation/visibility switches as `generateListItem` (via
   * `buildRowControls`, flat, no cascade — a group member has no
   * descendants). Registers `themeElement.groupedRow`, a *separate* slot
   * from `listRow`/`treeRow` (see themeElement.js's doc comment).
   *
   * @param {import('../model/themeElement.js').ThemeElement} themeElement
   *   The theme element this row represents.
   * @returns {Element} The row, not yet attached to the DOM.
   */
  function generateGroupedItem(themeElement) {
    const item = document.createElement('div');
    item.classList.add(CLASS_NAMES.listItem);

    const { activation, visibility, applyVisible } = buildRowControls(themeElement, {
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
      setVisible: applyVisible,
      remove: () => item.remove(),
    };

    item.append(activation.wrapper, visibility.wrapper);
    return item;
  }

  /**
   * A group's on/off switch is the same kind of pure batch action as a
   * Filters-tab switch (`applyFilterVisible`) — it always shows the state
   * you last set it to, and setting it shows/hides every member's
   * overlay. Deliberately doesn't try to track whether members have since
   * drifted out of sync via individual row toggles, matching that same
   * documented philosophy.
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
   * (disclosure button — always real/interactive, since a group only
   * exists while it has at least one member, unlike Branched's childless-
   * leaf case — plus the batch on/off switch, mirroring
   * `buildFilterGroupRow`'s switch almost exactly, down to reusing its
   * exact classes verbatim) and a children container of member rows (via
   * `generateGroupedItem`). Registers this group's collapse-toggle
   * function into `groupSectionsByType`, keyed by `type`, so the Aggregate
   * switch (see `applyAggregateToAllGroups`) can bulk-collapse/expand
   * every group without a full `rebuildGroupedView`.
   *
   * The switch's initial checked state is computed from real aggregate
   * member visibility (`members.every(...)`), never hardcoded `true` —
   * see `rebuildGroupedView`'s doc comment for why that matters here
   * specifically (this group gets torn down and rebuilt on every dynamic
   * content change, unlike a Filters-tab group).
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
     * Applies a collapsed/expanded state to this group's own DOM (children
     * container + disclosure button), without touching
     * `groupCollapsedByType` — used by the click handler (which also
     * writes to that map), by the initial build below, and by
     * `applyAggregateToAllGroups` (bulk action, via `groupSectionsByType`).
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
      // A manual per-group toggle can change whether *every* group is now
      // collapsed — keep the Aggregate switch's live-computed state
      // honest immediately, not just on the next full rebuild.
      syncAggregateSwitchState();
    });

    applyCollapsed(groupCollapsedByType.get(type) ?? false);
    groupSectionsByType.set(type, { setCollapsed: applyCollapsed });

    const initialGroupVisible = members.every((themeElement) => overlay?.isThemeElementVisible(themeElement) ?? true);
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

    header.append(disclosure, groupSwitch.wrapper);
    groupEl.append(header, childrenContainer);
    return groupEl;
  }

  /**
   * Is every current group collapsed? Read at both individual-toggle time
   * and Aggregate-click time to keep the Aggregate switch's own displayed
   * state truthful — see `syncAggregateSwitchState`.
   *
   * @param {Map<string, import('../model/themeElement.js').ThemeElement[]>} groups
   * @returns {boolean}
   */
  function computeAggregateAllGroups(groups) {
    return groups.size > 0 && Array.from(groups.keys()).every((type) => groupCollapsedByType.get(type) === true);
  }

  /**
   * Pushes the Aggregate switch's live-computed checked state (see
   * `computeAggregateAllGroups`) to its own control. Called after any
   * individual group's disclosure toggles (`generateGroupSection`'s click
   * handler) and after a full rebuild — never lets the switch go stale
   * relative to what the groups are actually doing, per this feature's
   * "recompute live, don't hardcode" requirement.
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
   * Rebuilds the Grouped sub-view's entire content from scratch: the
   * Aggregate header row plus one `generateGroupSection` per distinct
   * `objectType` in the current `themeElements` (via
   * `groupThemeElementsByType`) — full rebuild, not incremental, matching
   * Branched's own approach (see `rebuildBranchedView`'s doc comment for
   * why: `index.js`'s `reconcileDynamicContent` calls this panel's own
   * `removeThemeElement` before `overlayLayer.js`'s splices the element
   * out of the shared array, so an incremental update here would risk
   * reading a momentarily-stale array mid-batch — `scheduleGroupedRefresh`
   * is what actually protects against that, via the same microtask
   * coalescing).
   *
   * Collapse state (`groupCollapsedByType`) survives the rebuild: pruned
   * here (any type no longer present is dropped) and seeded for any
   * brand-new type using whatever the Aggregate switch read a moment ago
   * (`wasAggregated`, computed from `currentGroupTypes` — the *previous*
   * rebuild's groups — before this rebuild's pruning/seeding touches
   * `groupCollapsedByType`) rather than the ordinary "no entry = expanded"
   * default. Without this, a brand-new group arriving while Aggregate read
   * "on" would spawn expanded, silently flipping Aggregate to "off" even
   * though the user did nothing.
   *
   * Each group's own visibility switch is likewise computed from real
   * member visibility, never hardcoded `true` — see `generateGroupSection`
   * for why that matters given this full-rebuild-on-any-change strategy.
   *
   * @param {Element|null} [groupedEl] The Grouped container to rebuild
   *   into. Defaults to looking it up via `panelRoot` — every caller
   *   except `applyItemsSubView` relies on this default (mirrors
   *   `rebuildBranchedView`'s own parameter).
   * @returns {void}
   */
  function rebuildGroupedView(groupedEl = panelRoot?.querySelector(`.${CLASS_NAMES.groupedElementContent}`)) {
    if (!groupedEl) return;

    const groups = groupThemeElementsByType(themeElements);
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
   * Is the Grouped sub-view currently the one showing? Read by
   * `scheduleGroupedRefresh` to decide whether to coalesce an immediate
   * rebuild or just flag staleness for later — mirrors
   * `isBranchedSubViewActive`.
   *
   * @returns {boolean}
   */
  function isGroupedSubViewActive() {
    return panelRoot?.querySelector(`.${CLASS_NAMES.groupedElementContent}`)?.classList.contains(CLASS_NAMES.tabActive) ?? false;
  }

  /**
   * Flags the Grouped sub-view as needing a rebuild, coalescing an
   * immediate rebuild via a microtask if it's currently active — mirrors
   * `scheduleBranchedRefresh` exactly, for the same correctness reason
   * (see that function's own doc comment).
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

  // ---- Filters tab --------------------------------------------------------

  /**
   * A filter switch is a pure batch action: it always shows the state you
   * last set it to, and setting it shows/hides every member element. It
   * deliberately doesn't try to track whether members have since drifted
   * out of sync via individual List-tab toggles.
   *
   * @param {{ wrapper: Element, input: Element, setChecked: (checked: boolean) => void }} filterSwitch
   *   The on/off switch (from `createOnOffSwitch`) representing this type.
   * @param {import('../model/themeElement.js').ThemeElement[]} members
   *   Every theme element of this type.
   * @param {boolean} visible New visibility state for the whole group.
   * @returns {void}
   */
  function applyFilterVisible(filterSwitch, members, visible) {
    filterSwitch.setChecked(visible);
    filterSwitch.wrapper.setAttribute(LAYER_ATTRIBUTES.visible, String(visible));
    members.forEach((themeElement) => overlay?.setThemeElementVisible(themeElement, visible));
  }

  /**
   * Refreshes a Filters-tab group's label to reflect its current member
   * count — call after `addThemeElement`/`removeThemeElement` mutate a
   * group's `members` array in place.
   *
   * @param {string} type The `objectType` whose group label to refresh.
   * @returns {void}
   */
  function updateFilterGroupLabel(type) {
    const group = filterGroupsByType.get(type);
    const label = group?.filterSwitch.wrapper.querySelector('label');
    if (label) label.textContent = `${type} - (${group.members.length})`;
  }

  /**
   * Builds one Filters-tab group row for `type`/`members`, appends it to
   * `content`, and registers it in `filterGroupsByType` — used both by
   * `generateFiltersTab` (once per distinct type found at construction, or
   * whenever the panel transitions out of its empty state) and by
   * `addThemeElement` when a brand-new `objectType` shows up later than
   * that. `members` becomes the group's live, in-place-mutated membership
   * list — `addThemeElement`/`removeThemeElement` push/splice this same
   * array rather than replacing it, which is why the row itself never
   * needs to be rebuilt for a simple membership change (see
   * `updateFilterGroupLabel`).
   *
   * @param {Element} content The Filters tab's row container to append to.
   * @param {string} type The `objectType` this group represents.
   * @param {import('../model/themeElement.js').ThemeElement[]} members
   *   Initial members of this group.
   * @returns {void}
   */
  function buildFilterGroupRow(content, type, members) {
    const item = document.createElement('div');
    item.classList.add(CLASS_NAMES.filtersElementItem);

    const filterSwitch = createOnOffSwitch({
      label: `${type} - (${members.length})`,
      checked: true,
      wrapperClasses: [CLASS_NAMES.filtersElementItemActivation, CLASS_NAMES.objectType, CLASS_NAMES.objectTypeTyped(type)],
      wrapperAttributes: { [LAYER_ATTRIBUTES.visible]: 'true' },
      iconOn: CLASS_NAMES.iconToggleOn,
      iconOff: CLASS_NAMES.iconToggleOff,
      iconBullet: CLASS_NAMES.iconSquare,
      labelFirst: false,
    });

    filterSwitch.wrapper.addEventListener('click', () => {
      applyFilterVisible(filterSwitch, members, !filterSwitch.input.checked);
    });
    filterSwitch.wrapper.addEventListener('mouseenter', () => {
      filterSwitch.wrapper.classList.add(CLASS_NAMES.filtersElementItemActivationHover);
      members.forEach((themeElement) => overlay?.hoverThemeElement(themeElement));
    });
    filterSwitch.wrapper.addEventListener('mouseleave', () => {
      filterSwitch.wrapper.classList.remove(CLASS_NAMES.filtersElementItemActivationHover);
      members.forEach((themeElement) => overlay?.unhoverThemeElement(themeElement));
    });

    item.appendChild(filterSwitch.wrapper);
    content.appendChild(item);
    filterGroupsByType.set(type, { item, filterSwitch, members });
  }

  /**
   * Builds the "Filters" tab: one batch-visibility switch per distinct
   * `objectType` found on the page (labeled with the type and its element
   * count, via `buildFilterGroupRow`), plus an "All Elements" switch that
   * sets every type at once.
   *
   * @returns {Element} The Filters tab panel, not yet attached to the DOM.
   */
  function generateFiltersTab() {
    const layer = document.createElement('div');
    layer.id = IDS.controllerElementFilters;
    layer.classList.add(CLASS_NAMES.filtersElement, CLASS_NAMES.navTarget);

    const title = document.createElement('h3');
    title.textContent = strings.tabFilters;

    const content = document.createElement('div');
    content.classList.add(CLASS_NAMES.filtersElementContent);

    groupThemeElementsByType(themeElements).forEach((members, type) => buildFilterGroupRow(content, type, members));

    const allItem = document.createElement('div');
    allItem.classList.add(CLASS_NAMES.filtersElementItemSelectAll);

    const allSwitch = createOnOffSwitch({
      label: strings.allElements,
      checked: true,
      wrapperClasses: [CLASS_NAMES.filtersElementItemActivation],
      iconOn: CLASS_NAMES.iconToggleOn,
      iconOff: CLASS_NAMES.iconToggleOff,
    });

    allSwitch.wrapper.addEventListener('click', () => {
      const next = !allSwitch.input.checked;
      allSwitch.setChecked(next);
      filterGroupsByType.forEach(({ filterSwitch, members }) => applyFilterVisible(filterSwitch, members, next));
    });

    allItem.appendChild(allSwitch.wrapper);
    content.prepend(allItem);

    layer.append(title, content);
    return layer;
  }

  /**
   * Builds the "no debug data" placeholder shown in place of the tab bar
   * and its panels when `themeElements` came back empty. This happens
   * whenever there's nothing for the parser to have found — most commonly
   * the Chrome extension being activated on a non-Drupal page, or a Drupal
   * page with Twig debugging turned off (unlike the Drupal module, which
   * only ever renders the panel when the debug comments already exist,
   * the extension's activation is a manual button click with no way to
   * know in advance). Without this, the panel would open onto an empty
   * Active Element panel plus three empty tabs, which reads as broken
   * rather than "nothing to show" to someone who doesn't already know the
   * debugger depends on Twig's theme-debug HTML comments.
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
   * Builds the "Selected Element" panel: basic info (object type +
   * property hook), theme suggestions, and template file path — each an
   * empty container populated later by `updateSelectedElement`.
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

    layer.append(infoWrapper, suggestionsWrapper, filePathWrapper);
    return layer;
  }

  /**
   * Builds the whole fly-out panel: the activation form (top checkbox),
   * and the scrollable content area — Active Element, tab navigation, and
   * the Selected/List/Filters panels when `themeElements` is non-empty, or
   * the `generateEmptyStateLayer` placeholder in its place when it's empty
   * (see that function's doc comment for why) — then seals it behind a
   * Shadow DOM boundary. Restores the activation state from `storage` and
   * applies it immediately. Assigns `panelRoot` (the styled content, inside the
   * shadow root) and `panelHost` (the plain light-DOM element that owns
   * the shadow root) — required before any of the other functions in this
   * file that query `panelRoot` can run.
   *
   * The host is deliberately bare (no `visual-debugger*` classes) so
   * nothing in the host page's CSS can coincidentally target it; all the
   * real styling lives on `panelRoot`, matched by the embedded stylesheet
   * from inside the shadow tree. That stylesheet opens with `:host { all:
   * initial; }`, which resets every inherited property (including any
   * `--vd-*` custom property the host page might set on `:root`/`body`)
   * at the boundary — without it, inherited properties would still cross
   * into the shadow tree despite the rule-scoping Shadow DOM otherwise
   * gives us for free.
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
        generateFiltersTab(),
      );
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
      objectTypeText = themeElement.objectType;
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
   * Renders the currently-selected element's theme suggestions list (one
   * copyable row per suggestion, marked activated/not) into the Selected
   * Element panel. Reads `defaultThemeElement` directly rather than taking
   * a parameter, since it's always this panel's own selection state.
   *
   * @returns {void}
   */
  function setSelectedElementSuggestions() {
    const themeElement = defaultThemeElement;
    const layer = panelRoot.querySelector(`#${IDS.controllerElementSuggestions}`);
    if (!layer) return;
    layer.innerHTML = '';

    if (themeElement === null) {
      layer.append(generateEmptyTag('selected'));
      return;
    }

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
   * Renders the currently-selected element's template file path as a
   * copyable row into the Selected Element panel (or the empty-state tag
   * if nothing's selected, or the selected element has no file path).
   * Reads `defaultThemeElement` directly, same as `setSelectedElementSuggestions`.
   *
   * @returns {void}
   */
  function setSelectedElementTemplateFilePath() {
    const themeElement = defaultThemeElement;
    const target = panelRoot.querySelector(`#${IDS.controllerElementTemplateFilePath}`);
    if (!target) return;
    target.innerHTML = '';

    if (themeElement === null || !themeElement.filePath) {
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
   * selected theme element, or `null`): the Selected Element panel's basic
   * info, suggestions, and file path, plus the Selected tab's color cue.
   * Call after changing `defaultThemeElement`.
   *
   * @returns {void}
   */
  function updateSelectedElement() {
    const layer = panelRoot.querySelector(`#${IDS.controllerElementInfo}`);
    if (!layer) return;
    setElementInfo(defaultThemeElement, layer, 'selected');
    setSelectedElementSuggestions();
    setSelectedElementTemplateFilePath();
    setTabCue();
  }

  /**
   * Colors the "Selected" tab's `::before` dot to match the selected
   * element's object type, via the same `--color--object-type` cascade the
   * overlay/list/filter rows use (see `base/_types.scss`). Clears any
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
   * `ControllerHooks.setActiveThemeElement` — called by the overlay engine
   * when a theme element becomes hovered.
   *
   * @param {import('../model/themeElement.js').ThemeElement} themeElement
   *   The newly-hovered theme element.
   * @returns {void}
   */
  function setActiveThemeElement(themeElement) {
    activeThemeElement = themeElement;
    updateActiveElement();
  }

  /**
   * `ControllerHooks.resetActiveThemeElement` — called by the overlay
   * engine when the hovered theme element stops being hovered.
   *
   * @returns {void}
   */
  function resetActiveThemeElement() {
    activeThemeElement = null;
    updateActiveElement();
  }

  /**
   * `ControllerHooks.setDefaultThemeElement` — called by the overlay
   * engine when a theme element becomes the single selected element.
   *
   * @param {import('../model/themeElement.js').ThemeElement} themeElement
   *   The newly-selected theme element.
   * @returns {void}
   */
  function setDefaultThemeElement(themeElement) {
    defaultThemeElement = themeElement;
    updateSelectedElement();
  }

  /**
   * `ControllerHooks.resetDefaultThemeElement` — called by the overlay
   * engine when the selected theme element is deselected.
   *
   * @returns {void}
   */
  function resetDefaultThemeElement() {
    defaultThemeElement = null;
    updateSelectedElement();
  }

  // ---- Dynamic content (AJAX/BigPipe) ---------------------------------------

  /**
   * Incorporates a theme element discovered after construction into the
   * already-running panel (see `index.js`'s `reconcileDynamicContent`).
   * `themeElement` must already be present in the shared `themeElements`
   * array — this function reads it, it doesn't push it (ownership of that
   * push belongs to `overlayLayer.js`'s own `addThemeElement`, which must
   * run first; see that function's doc comment for why).
   *
   * If the panel is currently showing the empty-state placeholder (this is
   * the very first theme element ever seen on this page), tears that down
   * and builds the normal tab UI fresh instead — since `themeElements`
   * already includes `themeElement` by this point, the freshly-built
   * List/Filters tabs already account for it, so there's nothing further
   * to do on that path. Deliberately does not re-run
   * `generateSliderButton`/`calculateInitialControllerWidth`/
   * `checkControllerActivation` — those already ran once in the original
   * `executePostActivation` regardless of empty state; rerunning them
   * would create a second slider button and duplicate `document`-level
   * `mousemove`/`mouseup` listeners.
   *
   * Otherwise (the panel already has a full tab UI), appends one List row
   * and either updates the matching Filters group's membership/label or
   * creates a brand-new group if `themeElement.objectType` hasn't been
   * seen before.
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
        generateFiltersTab(),
      );
      updateActiveElement();
      updateSelectedElement();
      switchToTab(IDS.controllerElementSelected);
      return;
    }

    const listContent = panelRoot.querySelector(`#${IDS.controllerElementList} .${CLASS_NAMES.listElementContent}`);
    listContent?.appendChild(generateListItem(themeElement));

    const group = filterGroupsByType.get(themeElement.objectType);
    if (group) {
      group.members.push(themeElement);
      updateFilterGroupLabel(themeElement.objectType);
    } else {
      const filtersContent = panelRoot.querySelector(`#${IDS.controllerElementFilters} .${CLASS_NAMES.filtersElementContent}`);
      if (filtersContent) buildFilterGroupRow(filtersContent, themeElement.objectType, [themeElement]);
    }

    // The Listed row above was added incrementally; the Branched sub-
    // view's tree and the Grouped sub-view's bucketed groups instead get
    // rebuilt wholesale — see `scheduleBranchedRefresh`'s own doc comment
    // for why (timing relative to `overlayLayer.js`'s own add/remove, and
    // why a full rebuild is the right call rather than incremental
    // patching); `scheduleGroupedRefresh` follows the exact same
    // reasoning.
    scheduleBranchedRefresh();
    scheduleGroupedRefresh();
  }

  /**
   * Reverses `addThemeElement`'s incremental path — call BEFORE
   * `overlayLayer.js`'s own `removeThemeElement` for the same
   * `themeElement`, while `themeElement.listRow`/`treeRow`/`instanceLayer`
   * are still intact (overlay's removal is what nulls them). Resets the
   * Active/Selected panels first if either was pointing at `themeElement`
   * — since overlay's `removeThemeElement` also deselects via
   * `setChecked`, but hover (`activeThemeElement`) has no overlay-side
   * equivalent to check, this identity check is this panel's own
   * responsibility regardless. Removes the element's Listed row and
   * either updates or removes its Filters group (removed entirely once
   * the group's last member is gone); schedules a Branched sub-view
   * refresh (see `scheduleBranchedRefresh`) rather than removing a
   * Branched row directly.
   *
   * Reverting to the empty-state placeholder if this removes the very
   * last theme element is a plausible nice-to-have, deliberately not
   * implemented here — a low-likelihood scenario not worth the asymmetric
   * teardown complexity.
   *
   * @param {import('../model/themeElement.js').ThemeElement} themeElement
   *   The theme element to stop tracking.
   * @returns {void}
   */
  function removeThemeElement(themeElement) {
    if (activeThemeElement === themeElement) resetActiveThemeElement();
    if (defaultThemeElement === themeElement) resetDefaultThemeElement();

    themeElement.listRow?.remove();

    const group = filterGroupsByType.get(themeElement.objectType);
    if (group) {
      const index = group.members.indexOf(themeElement);
      if (index !== -1) group.members.splice(index, 1);
      if (group.members.length === 0) {
        group.item.remove();
        filterGroupsByType.delete(themeElement.objectType);
      } else {
        updateFilterGroupLabel(themeElement.objectType);
      }
    }

    // Only the Listed row's own DOM needs explicit removal above (via
    // `listRow.remove()`) — the Branched sub-view's row and the Grouped
    // sub-view's row for this element (if any) disappear for free the
    // next time each is rebuilt, since a removed element is no longer in
    // `themeElements` by then. Also drops any remembered collapsed/
    // expanded state for this element, so a long-running, AJAX-heavy page
    // doesn't leak `collapsedById` entries for elements that no longer
    // exist (`groupCollapsedByType` is keyed by `objectType`, not element
    // id, so it needs no equivalent per-element cleanup here — it's
    // pruned wholesale inside `rebuildGroupedView` instead).
    collapsedById.delete(themeElement.id);
    scheduleBranchedRefresh();
    scheduleGroupedRefresh();
  }

  /**
   * One-time setup that must run after the panel's DOM exists and has been
   * attached to the document (so `getBoundingClientRect`/computed styles
   * are meaningful): wires the resize handle, sizes the panel, positions
   * it per its activation state, renders the initial Active/Selected
   * Element panels, and activates the "Selected" tab. Called once by the
   * consumer (see `src/index.js`) after appending the panel's `controllerLayer`
   * (the shadow host) to the document.
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
   * Tears down everything this panel registered outside of `panelHost`
   * itself, then removes `panelHost`. The two `document`-level slider
   * listeners and the body-offset `MutationObserver` all outlive the
   * panel's own DOM (they're registered on `document`/`document.body`,
   * neither of which this panel ever removes), so without this they — and
   * every closure they hold onto (`panelRoot`, `storage`, `strings`, this
   * entire factory's scope) — would keep running, and keep the panel
   * alive in memory, forever. Everything else (tab/list/filter row
   * listeners, the activation checkbox, etc.) lives inside `panelHost`'s
   * shadow tree and is removed along with it, with no separate cleanup
   * needed.
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
     * The Shadow DOM host built synchronously above (`panelHost`) — append
     * it to the document once. All of the panel's actual markup lives
     * inside its shadow root, sealed off from the host page's CSS in both
     * directions (see `generateControllerLayer`'s doc comment); this host
     * element itself carries no meaningful classes, so it's not a useful
     * target for external styling either. The getter just exposes the
     * closured value — it's never reassigned after construction.
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
    destroy,
  };
}
