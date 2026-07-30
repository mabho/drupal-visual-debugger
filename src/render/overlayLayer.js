import { CLASS_NAMES, LAYER_ATTRIBUTES } from '../constants.js';

/**
 * Builds and manages the overlay layers painted on top of each parsed
 * theme element. Fully agnostic: it operates on the ThemeElement objects
 * it's given and has no knowledge of Drupal comments or Twig.
 *
 * @param {object} options
 * @param {import('../model/themeElement.js').ThemeElement[]} options.themeElements
 * @returns {{
 *   baseLayer: Element,
 *   attachControllerHooks: (hooks: ControllerHooks) => void,
 * }}
 */
export function createOverlayEngine({ themeElements }) {
  const baseLayer = document.createElement('div');
  baseLayer.classList.add(CLASS_NAMES.visualDebugger, CLASS_NAMES.baseLayer);

  /** @type {ControllerHooks|null} */
  let controllerHooks = null;

  themeElements.forEach((themeElement) => {
    const instanceLayer = buildInstanceLayer(themeElement);
    themeElement.instanceLayer = instanceLayer;
    baseLayer.appendChild(instanceLayer);
  });

  observePositionChanges(themeElements);

  /**
   * @param {import('../model/themeElement.js').ThemeElement} themeElement
   * @returns {Element}
   */
  function buildInstanceLayer(themeElement) {
    const layer = document.createElement('div');
    layer.classList.add(
      CLASS_NAMES.instanceLayer,
      CLASS_NAMES.objectType,
      CLASS_NAMES.objectTypeTyped(themeElement.objectType),
      CLASS_NAMES.instanceLayerUnchecked,
    );
    layer.setAttribute(LAYER_ATTRIBUTES.layerTargetId, themeElement.id);
    layer.setAttribute(LAYER_ATTRIBUTES.visible, 'true');
    layer.style.zIndex = String(getDomDepth(themeElement.dataNode));
    positionLayer(layer, themeElement.dataNode);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.classList.add(CLASS_NAMES.checkboxToggle);

    const activatedIcon = document.createElement('span');
    activatedIcon.classList.add(CLASS_NAMES.spanToggle, CLASS_NAMES.activated, CLASS_NAMES.iconActivated);

    const deactivatedIcon = document.createElement('span');
    deactivatedIcon.classList.add(CLASS_NAMES.spanToggle, CLASS_NAMES.deactivated, CLASS_NAMES.iconDeactivated);

    layer.append(checkbox, activatedIcon, deactivatedIcon);

    layer.addEventListener('mouseenter', () => {
      checkbox.focus({ preventScroll: true });
      controllerHooks?.setActiveThemeElement(themeElement);
    });

    layer.addEventListener('mouseleave', () => {
      checkbox.blur();
      controllerHooks?.resetActiveThemeElement();
    });

    layer.addEventListener('click', () => {
      toggleChecked(themeElement);
    });

    return layer;
  }

  /**
   * Is this theme element currently the single selected/"checked" one?
   *
   * @param {import('../model/themeElement.js').ThemeElement} themeElement
   * @returns {boolean}
   */
  function isChecked(themeElement) {
    return themeElement.instanceLayer.classList.contains(CLASS_NAMES.instanceLayerChecked);
  }

  /**
   * Single source of truth for "checked" state: updates the overlay layer's
   * own checkbox/classes, syncs the List tab row if one has registered
   * itself (see controllerPanel.js), enforces single-selection, and
   * notifies the controller panel. Called directly by both the overlay's
   * own click handler and the List tab — deliberately not implemented via
   * DOM click()-forwarding between the two, which would bounce a synthetic
   * click back and forth between the overlay and the list row.
   *
   * @param {import('../model/themeElement.js').ThemeElement} themeElement
   * @param {boolean} checked
   */
  function setChecked(themeElement, checked) {
    if (checked) {
      themeElements.forEach((other) => {
        if (other !== themeElement && isChecked(other)) setChecked(other, false);
      });
    }

    const layer = themeElement.instanceLayer;
    const checkbox = layer.querySelector(`.${CLASS_NAMES.checkboxToggle}`);
    checkbox.checked = checked;
    layer.classList.toggle(CLASS_NAMES.instanceLayerChecked, checked);
    layer.classList.toggle(CLASS_NAMES.instanceLayerUnchecked, !checked);
    if (checked) checkbox.focus();
    else checkbox.blur();

    themeElement.listRow?.setActivated(checked);

    if (checked) controllerHooks?.setDefaultThemeElement(themeElement);
    else controllerHooks?.resetDefaultThemeElement();
  }

  /**
   * @param {import('../model/themeElement.js').ThemeElement} themeElement
   */
  function toggleChecked(themeElement) {
    setChecked(themeElement, !isChecked(themeElement));
  }

  /**
   * Shows or hides a theme element's overlay layer. Deactivates it first
   * if it was the selected one, mirroring the original module's
   * hideInstanceLayer().
   *
   * @param {import('../model/themeElement.js').ThemeElement} themeElement
   * @param {boolean} visible
   */
  function setVisible(themeElement, visible) {
    if (!visible && isChecked(themeElement)) setChecked(themeElement, false);
    themeElement.instanceLayer.setAttribute(LAYER_ATTRIBUTES.visible, String(visible));
  }

  /**
   * Synthetic hover, for use by the List (and Filters) tab: a real mouse
   * hover on the overlay itself is covered by CSS `:hover`, but hovering a
   * list row doesn't put the mouse over the overlay, so its highlight has
   * to be toggled explicitly.
   *
   * @param {import('../model/themeElement.js').ThemeElement} themeElement
   */
  function hoverThemeElement(themeElement) {
    themeElement.instanceLayer.classList.add(CLASS_NAMES.instanceLayerHover, CLASS_NAMES.objectTypeHover);
    controllerHooks?.setActiveThemeElement(themeElement);
  }

  /**
   * @param {import('../model/themeElement.js').ThemeElement} themeElement
   */
  function unhoverThemeElement(themeElement) {
    themeElement.instanceLayer.classList.remove(CLASS_NAMES.instanceLayerHover, CLASS_NAMES.objectTypeHover);
    controllerHooks?.resetActiveThemeElement();
  }

  /**
   * @param {Element} layer
   * @param {Element} refElement
   */
  function positionLayer(layer, refElement) {
    const rect = refElement.getBoundingClientRect();
    layer.style.top = `${Math.round(rect.top + window.scrollY)}px`;
    layer.style.left = `${Math.round(rect.left + window.scrollX)}px`;
    layer.style.width = `${Math.round(rect.width)}px`;
    layer.style.height = `${Math.round(rect.height)}px`;
  }

  /**
   * @param {Element} element
   * @returns {number}
   */
  function getDomDepth(element) {
    let depth = 0;
    let node = element;
    while (node.parentNode) {
      depth++;
      node = node.parentNode;
    }
    return depth;
  }

  /**
   * Keeps overlay layers aligned with their reference elements as the page
   * resizes, or as ancestor `style` attributes change (e.g. an admin
   * toolbar toggling and shifting body padding).
   *
   * @param {import('../model/themeElement.js').ThemeElement[]} elements
   */
  function observePositionChanges(elements) {
    const resizeObserver = new ResizeObserver((entries) => {
      entries.forEach((entry) => {
        const themeElement = elements.find((el) => el.dataNode === entry.target);
        if (themeElement) positionLayer(themeElement.instanceLayer, themeElement.dataNode);
      });
    });
    elements.forEach((el) => resizeObserver.observe(el.dataNode));

    const mutationObserver = new MutationObserver(() => {
      elements.forEach((el) => positionLayer(el.instanceLayer, el.dataNode));
    });
    mutationObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['style'],
    });
  }

  return {
    baseLayer,
    /** @param {ControllerHooks} hooks */
    attachControllerHooks(hooks) {
      controllerHooks = hooks;
    },
    isThemeElementSelected: isChecked,
    toggleThemeElementSelection: toggleChecked,
    setThemeElementVisible: setVisible,
    hoverThemeElement,
    unhoverThemeElement,
  };
}

/**
 * @typedef {object} ControllerHooks
 * @property {(themeElement: import('../model/themeElement.js').ThemeElement) => void} setActiveThemeElement
 * @property {() => void} resetActiveThemeElement
 * @property {(themeElement: import('../model/themeElement.js').ThemeElement) => void} setDefaultThemeElement
 * @property {() => void} resetDefaultThemeElement
 */
