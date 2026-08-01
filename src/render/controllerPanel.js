import { CLASS_NAMES, IDS, LAYER_ATTRIBUTES, STORAGE_KEYS, DEFAULTS } from '../constants.js';
import { webStorageAdapter } from '../storage/webStorageAdapter.js';
import { defaultStrings } from '../i18n/defaultStrings.js';
import { createOnOffSwitch } from './onOffSwitch.js';

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
 * @param {Partial<typeof defaultStrings>} [options.strings]
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
  let controllerLayer = null;

  function getSelectedThemeElement() {
    return activeThemeElement || defaultThemeElement || null;
  }

  // ---- DOM builders ------------------------------------------------------

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

  function generateEmptyTag(infoType) {
    const wrapper = document.createElement('div');
    wrapper.classList.add(CLASS_NAMES.elementInfoTextContent, CLASS_NAMES.elementInfoEmpty);
    wrapper.textContent = infoType === 'active' ? strings.noActiveElement : strings.noSelectedElement;
    return wrapper;
  }

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

  function switchToTab(targetId) {
    const button = controllerLayer.querySelector(`[data-target-tab="${targetId}"]`);
    const panel = controllerLayer.querySelector(`#${targetId}`);
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

    // Syncs this row's own visibility switch + disabled look, without
    // touching the overlay — used both by this row's own click (which also
    // tells the overlay) and by listRow.setVisible (called BY the overlay
    // when visibility changes elsewhere, e.g. the Filters tab).
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

    // A filter switch is a pure batch action: it always shows the state you
    // last set it to, and setting it shows/hides every member element. It
    // deliberately doesn't try to track whether members have since drifted
    // out of sync via individual List-tab toggles.
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
    label.textContent = strings.activateDebugger;

    const wrapper = document.createElement('div');
    wrapper.classList.add(CLASS_NAMES.formWrapper);
    wrapper.append(activationCheckbox, iconTrue, iconFalse, label);

    const form = document.createElement('form');
    form.classList.add(CLASS_NAMES.form);
    form.appendChild(wrapper);

    content.append(
      generateActiveElementLayer(),
      generateTabsNavigation(),
      generateSelectedElementLayer(),
      generateListTab(),
      generateFiltersTab(),
    );
    layer.append(form, content);

    controllerLayer = layer;
    toggleDebuggerActivated(activated);
    return layer;
  }

  // ---- Activation / sizing ------------------------------------------------

  function toggleDebuggerActivated(activated = true) {
    document.body.classList.toggle(CLASS_NAMES.controllerActivated, activated);
    document.body.classList.toggle(CLASS_NAMES.controllerDeactivated, !activated);
    storage.set(STORAGE_KEYS.debuggerActivated, String(activated));

    if (controllerLayer) {
      controllerLayer.setAttribute(LAYER_ATTRIBUTES.controllerActivated, String(activated));
      checkControllerActivation();
    }
  }

  function getControllerActivationStatus() {
    return controllerLayer.getAttribute(LAYER_ATTRIBUTES.controllerActivated) === 'true';
  }

  function checkControllerActivation() {
    if (getControllerActivationStatus()) {
      controllerLayer.style.right = '0px';
      return;
    }
    const width = parseInt(controllerLayer.style.width, 10) || 0;
    const newPosition = (width - DEFAULTS.controllerDeactivatedGap) * -1;
    controllerLayer.style.right = `${newPosition}px`;
  }

  function calculateInitialControllerWidth() {
    const stored = storage.get(STORAGE_KEYS.controllerWidth, DEFAULTS.initialControllerWidth);
    let outputWidth = stored;

    const screenWidth = window.innerWidth;
    const maxWidth = window.getComputedStyle(controllerLayer).getPropertyValue('max-width');

    if (maxWidth) {
      const maxWidthValue = parseFloat(maxWidth);
      const storedValue = parseFloat(stored);
      outputWidth = maxWidth.endsWith('%')
        ? Math.min((maxWidthValue / 100) * screenWidth, storedValue)
        : Math.min(screenWidth, maxWidthValue, storedValue);
    }

    controllerLayer.style.width = `${outputWidth}px`;
  }

  function generateSliderButton() {
    let isMouseDown = false;
    const button = document.createElement('button');
    button.classList.add(CLASS_NAMES.clickDragButton, CLASS_NAMES.iconSlideResize);
    button.setAttribute('aria-label', strings.clickDragButton);

    button.addEventListener('mousedown', () => {
      isMouseDown = getControllerActivationStatus();
    });

    document.addEventListener('mousemove', (event) => {
      if (!isMouseDown) return;
      resizeControllerLayer(event.clientX);
    });

    document.addEventListener('mouseup', () => {
      if (!isMouseDown) return;
      isMouseDown = false;
      storage.set(STORAGE_KEYS.controllerWidth, controllerLayer.style.width);
    });

    controllerLayer.appendChild(button);
  }

  function resizeControllerLayer(mousePosition = 0) {
    const rect = controllerLayer.getBoundingClientRect();
    requestAnimationFrame(() => {
      const newWidth = rect.width + rect.left - mousePosition;
      controllerLayer.style.width = `${newWidth}px`;
    });
  }

  // Mirrors an ancestor's top offset (e.g. a sticky admin toolbar pushing
  // body padding-top) onto the controller panel's own top position.
  function observeBodyOffset() {
    const observer = new MutationObserver((mutations) => {
      if (!controllerLayer) return;
      const newTop = mutations[0].target.style.paddingTop || 0;
      controllerLayer.style.top = newTop;
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['style'] });
  }

  // ---- Info rendering ------------------------------------------------------

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

  function setSelectedElementSuggestions() {
    const themeElement = defaultThemeElement;
    const layer = controllerLayer.querySelector(`#${IDS.controllerElementSuggestions}`);
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

  function setSelectedElementTemplateFilePath() {
    const themeElement = defaultThemeElement;
    const target = controllerLayer.querySelector(`#${IDS.controllerElementTemplateFilePath}`);
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

  function updateActiveElement() {
    const layer = controllerLayer.querySelector(`#${IDS.controllerActiveElementInfo}`);
    setElementInfo(activeThemeElement, layer, 'active');
  }

  function updateSelectedElement() {
    const layer = controllerLayer.querySelector(`#${IDS.controllerElementInfo}`);
    setElementInfo(defaultThemeElement, layer, 'selected');
    setSelectedElementSuggestions();
    setSelectedElementTemplateFilePath();
    setTabCue();
  }

  // Colors the "Selected" tab's ::before dot to match the selected
  // element's object type, via the same --color--object-type cascade the
  // overlay/list/filter rows use (see base/_types.scss).
  function setTabCue() {
    const button = controllerLayer.querySelector(`#${IDS.controllerButtonSelected}`);
    if (!button) return;

    const emptyObjectTypeClass = CLASS_NAMES.objectTypeTyped('');
    Array.from(button.classList).forEach((className) => {
      if (className.startsWith(emptyObjectTypeClass)) button.classList.remove(className);
    });

    if (defaultThemeElement === null) return;
    button.classList.add(CLASS_NAMES.objectTypeTyped(defaultThemeElement.objectType));
  }

  // ---- Public hooks (consumed by the overlay engine) ------------------------

  function setActiveThemeElement(themeElement) {
    activeThemeElement = themeElement;
    updateActiveElement();
  }

  function resetActiveThemeElement() {
    activeThemeElement = null;
    updateActiveElement();
  }

  function setDefaultThemeElement(themeElement) {
    defaultThemeElement = themeElement;
    updateSelectedElement();
  }

  function resetDefaultThemeElement() {
    defaultThemeElement = null;
    updateSelectedElement();
  }

  function executePostActivation() {
    generateSliderButton();
    calculateInitialControllerWidth();
    checkControllerActivation();
    updateActiveElement();
    updateSelectedElement();
    switchToTab(IDS.controllerElementSelected);
  }

  // ---- Build ----------------------------------------------------------------

  generateControllerLayer();
  observeBodyOffset();

  return {
    get controllerLayer() {
      return controllerLayer;
    },
    executePostActivation,
    setActiveThemeElement,
    resetActiveThemeElement,
    setDefaultThemeElement,
    resetDefaultThemeElement,
    getSelectedThemeElement,
  };
}
