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
  objectType: 'object-type',
  objectTypeTyped: (objectType) => `object-type--${objectType}`,
  iconActivated: 'icon-checkbox-checked',
  iconDeactivated: 'icon-checkbox-unchecked',
  checkboxToggle: 'checkbox-toggle',
  spanToggle: 'span-toggle',
  activated: 'item-activated',
  deactivated: 'item-deactivated',

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
  iconControllerActivated: 'icon-controller-activated',
  iconControllerDeactivated: 'icon-controller-deactivated',
  iconCopyToClipboard: 'icon-copy',
  iconSlideResize: 'icon-slide-resize',
  clickDragButton: 'click-drag-button',
};

export const IDS = {
  controllerActiveElementInfo: 'visual-debugger--controller--active-element--info',
  controllerElementInfo: 'visual-debugger--controller-layer--info',
  controllerElementSuggestions: 'visual-debugger--controller-layer--suggestions',
  controllerElementTemplateFilePath: 'visual-debugger--controller-layer--template-file-path',
  controllerActivationCheckbox: 'debuggerActivationCheckbox',
};

export const LAYER_ATTRIBUTES = {
  layerId: 'data-vd-id',
  layerTargetId: 'data-vd-target-id',
  controllerActivated: 'data-controller-activated',
};

export const STORAGE_KEYS = {
  debuggerActivated: 'debuggerActivated',
  controllerWidth: 'controllerWidth',
};

export const DEFAULTS = {
  initialControllerWidth: '400px',
  controllerDeactivatedGap: 10,
};
