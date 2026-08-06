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
 * Selected/List views, active element info, theme suggestions, template
 * file path, and the click-drag resize handle.
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
 *   Every theme element found on the page — needed to build the List tab.
 * @param {ReturnType<typeof import('./overlayLayer.js').createOverlayEngine>} [options.overlay]
 *   Used by the List tab to select/show/hide/hover a theme element's
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
        label: strings.tabList,
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
   * Builds the "List" tab: one `generateListItem` row per theme element
   * found on the page, in document order.
   *
   * @returns {Element} The List tab panel, not yet attached to the DOM.
   */
  function generateListTab() {
    const layer = document.createElement('div');
    layer.id = IDS.controllerElementList;
    layer.classList.add(CLASS_NAMES.listElement, CLASS_NAMES.navTarget);

    const title = document.createElement('h3');
    title.textContent = strings.tabList;

    const content = document.createElement('div');
    content.classList.add(CLASS_NAMES.listElementContent);

    themeElements.forEach((themeElement) => {
      content.appendChild(generateListItem(themeElement));
    });

    layer.append(title, content);
    return layer;
  }

  /**
   * Builds one List tab row for a single theme element: an "activation"
   * switch (select/deselect this element, labeled with its theme hook) and
   * a "visibility" eye switch (show/hide its overlay entirely). Registers
   * `themeElement.listRow` so the overlay engine (selection) and the
   * Filters tab (visibility) can keep this row's switches in sync when
   * either changes from somewhere other than this row itself.
   *
   * @param {import('../model/themeElement.js').ThemeElement} themeElement
   *   The theme element this row represents.
   * @returns {Element} The list item, not yet attached to the DOM.
   */
  function generateListItem(themeElement) {
    const item = document.createElement('div');
    item.classList.add(CLASS_NAMES.listItem);

    const activation = createOnOffSwitch({
      label: themeElement.propertyHook,
      checked: false,
      wrapperClasses: [CLASS_NAMES.listItemActivation, CLASS_NAMES.objectTypeTyped(themeElement.objectType)],
      wrapperAttributes: { [LAYER_ATTRIBUTES.visible]: 'true' },
      iconOn: CLASS_NAMES.iconSelectedTrue,
      iconOff: CLASS_NAMES.iconSelectedFalse,
    });

    activation.wrapper.addEventListener('click', () => {
      // A row hidden by a filter (Filters tab, added separately) shouldn't
      // be selectable.
      if (activation.wrapper.getAttribute(LAYER_ATTRIBUTES.visible) === 'true') {
        overlay?.toggleThemeElementSelection(themeElement);
      }
    });
    activation.wrapper.addEventListener('mouseenter', () => overlay?.hoverThemeElement(themeElement));
    activation.wrapper.addEventListener('mouseleave', () => overlay?.unhoverThemeElement(themeElement));

    const visibility = createOnOffSwitch({
      checked: true,
      wrapperClasses: [CLASS_NAMES.listItemVisibility],
      iconOn: CLASS_NAMES.iconToggleOn,
      iconOff: CLASS_NAMES.iconToggleOff,
    });

    /**
     * Syncs this row's own visibility switch + disabled look, without
     * touching the overlay — used both by this row's own click (which also
     * tells the overlay) and by listRow.setVisible (called BY the overlay
     * when visibility changes elsewhere, e.g. the Filters tab).
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
    });

    // Lets the overlay engine (and Filters tab) sync this row's activation
    // switch and visibility switch when either changes from elsewhere.
    themeElement.listRow = {
      setActivated: activation.setChecked,
      setVisible: applyVisible,
    };

    item.append(activation.wrapper, visibility.wrapper);
    return item;
  }

  /**
   * Builds the "Filters" tab: one batch-visibility switch per distinct
   * `objectType` found on the page (labeled with the type and its element
   * count), plus an "All Elements" switch that sets every type at once.
   * Each switch is a pure batch action (see `applyFilterVisible`) rather
   * than a tri-state reflecting each member's actual current visibility —
   * it always just shows the state it was last set to.
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

    // Group by object type, preserving first-seen order.
    const groups = new Map();
    themeElements.forEach((themeElement) => {
      if (!groups.has(themeElement.objectType)) groups.set(themeElement.objectType, []);
      groups.get(themeElement.objectType).push(themeElement);
    });

    /**
     * A filter switch is a pure batch action: it always shows the state
     * you last set it to, and setting it shows/hides every member element.
     * It deliberately doesn't try to track whether members have since
     * drifted out of sync via individual List-tab toggles.
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

    const filterGroups = [];

    groups.forEach((members, type) => {
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

      filterGroups.push({ filterSwitch, members });
      item.appendChild(filterSwitch.wrapper);
      content.appendChild(item);
    });

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
      filterGroups.forEach(({ filterSwitch, members }) => applyFilterVisible(filterSwitch, members, next));
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
    title.textContent = strings.selectedElement;

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

    layer.append(title, infoWrapper, suggestionsWrapper, filePathWrapper);
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
        generateListTab(),
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
    destroy,
  };
}
