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
      // Uncheck any other checked layer first, mirroring single-selection
      // behavior from the original module.
      themeElements.forEach((other) => {
        if (other !== themeElement && other.instanceLayer.classList.contains(CLASS_NAMES.instanceLayerChecked)) {
          other.instanceLayer.click();
        }
      });
      checkbox.click();
    });

    checkbox.addEventListener('change', () => {
      layer.classList.toggle(CLASS_NAMES.instanceLayerChecked);
      layer.classList.toggle(CLASS_NAMES.instanceLayerUnchecked);

      if (checkbox.checked) {
        checkbox.focus();
        controllerHooks?.setDefaultThemeElement(themeElement);
      } else {
        checkbox.blur();
        controllerHooks?.resetDefaultThemeElement();
      }
    });

    return layer;
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
  };
}

/**
 * @typedef {object} ControllerHooks
 * @property {(themeElement: import('../model/themeElement.js').ThemeElement) => void} setActiveThemeElement
 * @property {() => void} resetActiveThemeElement
 * @property {(themeElement: import('../model/themeElement.js').ThemeElement) => void} setDefaultThemeElement
 * @property {() => void} resetDefaultThemeElement
 */
