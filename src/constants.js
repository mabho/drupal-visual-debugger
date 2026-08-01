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
   * property in a given scope. Used on overlay layers, List/Filters rows,
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
  clickDragButton: 'click-drag-button',

  // Tabbed navigation.
  tabsNavigation: 'tabbed-navigation',
  tabsNavigationTabs: 'tabbed-navigation__tabs',
  tabsNavigationTab: 'tabbed-navigation__tab',
  tabsNavigationTabSelected: 'tabbed-navigation__tab--selected',
  tabsNavigationSeparator: 'tabbed-navigation__separator',
  tabActive: 'active',
  navTarget: 'nav-target',

  // List tab.
  listElement: 'list',
  listElementContent: 'list__content',
  listItem: 'list-item',
  listItemActivation: 'list-item__activation',
  listItemActivationHover: 'list-item__activation--hover',
  listItemVisibility: 'list-item__visibility',

  // Filters tab.
  filtersElement: 'filters',
  filtersElementContent: 'filters__content',
  filtersElementItem: 'filters-item',
  filtersElementItemSelectAll: 'filters-item--select-all',
  filtersElementItemActivation: 'filters-item__activation',
  filtersElementItemActivationHover: 'filter-item__activation--hover',
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
  controllerButtonFilters: 'visual-debugger--controller-layer--button--filters',
  controllerElementFilters: 'visual-debugger--controller-layer--filters',
};

export const LAYER_ATTRIBUTES = {
  layerId: 'data-vd-id',
  layerTargetId: 'data-vd-target-id',
  controllerActivated: 'data-controller-activated',
  visible: 'data-vd-visible',
  listItemActivated: 'data-vd-list-item-activated',
};

export const STORAGE_KEYS = {
  debuggerActivated: 'debuggerActivated',
  controllerWidth: 'controllerWidth',
};

export const DEFAULTS = {
  initialControllerWidth: '400px',
  controllerDeactivatedGap: 10,
};
