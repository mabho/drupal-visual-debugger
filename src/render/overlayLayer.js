import { CLASS_NAMES, LAYER_ATTRIBUTES } from '../constants.js';

/**
 * Builds and manages the overlay layers painted on top of each parsed
 * theme element. Fully agnostic: it operates on the ThemeElement objects
 * it's given and has no knowledge of Drupal comments or Twig.
 *
 * Builds one overlay ("instance layer") per theme element immediately, up
 * front, and mutates each `themeElement` in place by setting its
 * `instanceLayer` property — everything else in this module (and the
 * controller panel) locates a theme element's overlay through that
 * property rather than keeping a separate lookup table.
 *
 * @param {object} options
 * @param {import('../model/themeElement.js').ThemeElement[]} options.themeElements
 *   Every theme element found on the page (from `parseThemeDebugElements`).
 *   The returned engine holds onto this exact array/its elements — mutating
 *   a `themeElement` after this call (e.g. setting `.listRow`) is how the
 *   controller panel wires itself in, not an anti-pattern to avoid here.
 * @returns {{
 *   baseLayer: Element,
 *   attachControllerHooks: (hooks: ControllerHooks) => void,
 *   isThemeElementSelected: (themeElement: import('../model/themeElement.js').ThemeElement) => boolean,
 *   toggleThemeElementSelection: (themeElement: import('../model/themeElement.js').ThemeElement) => void,
 *   setThemeElementVisible: (themeElement: import('../model/themeElement.js').ThemeElement, visible: boolean) => void,
 *   hoverThemeElement: (themeElement: import('../model/themeElement.js').ThemeElement) => void,
 *   unhoverThemeElement: (themeElement: import('../model/themeElement.js').ThemeElement) => void,
 * }} `baseLayer` is the container element holding every instance layer —
 *   append it to the document once. The rest of the shape is the API
 *   surface the controller panel's List/Filters tabs drive directly (see
 *   each named function below for details); `attachControllerHooks` wires
 *   up the reverse direction (overlay → panel notifications).
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
   * Creates the overlay box painted on top of a single theme element's
   * real DOM node: positions it to match that node's current bounding box,
   * gives it a checkbox + activated/deactivated icons (the overlay's own
   * visible checked/unchecked indicator), and wires up hover (highlight +
   * notify the panel's Active Element view) and click (toggle selection).
   *
   * @param {import('../model/themeElement.js').ThemeElement} themeElement
   *   The theme element to build an overlay for. Read for `objectType`,
   *   `id`, and `dataNode`; not mutated by this function itself (the
   *   caller sets `.instanceLayer` after this returns).
   * @returns {Element} The overlay `<div>`, not yet attached to `baseLayer`.
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
   *   The theme element to check. Must already have an `instanceLayer`
   *   (i.e. have gone through `buildInstanceLayer`).
   * @returns {boolean} `true` if this is the currently selected element.
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
   *   The theme element being selected or deselected.
   * @param {boolean} checked `true` to select this element (deselecting
   *   any other currently-selected element first), `false` to deselect it.
   * @returns {void}
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
   * Flips a theme element's selected state — selects it if it wasn't
   * selected, deselects it if it was. Exposed to the panel as
   * `toggleThemeElementSelection`, used by both the overlay's own click
   * handler and the List tab's row click.
   *
   * @param {import('../model/themeElement.js').ThemeElement} themeElement
   *   The theme element whose selection should be toggled.
   * @returns {void}
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
   *   The theme element to show or hide.
   * @param {boolean} visible `true` to show its overlay, `false` to hide it.
   * @returns {void}
   */
  function setVisible(themeElement, visible) {
    if (!visible && isChecked(themeElement)) setChecked(themeElement, false);
    themeElement.instanceLayer.setAttribute(LAYER_ATTRIBUTES.visible, String(visible));
    themeElement.listRow?.setVisible(visible);
  }

  /**
   * Synthetic hover, for use by the List (and Filters) tab: a real mouse
   * hover on the overlay itself is covered by CSS `:hover`, but hovering a
   * list row doesn't put the mouse over the overlay, so its highlight has
   * to be toggled explicitly.
   *
   * @param {import('../model/themeElement.js').ThemeElement} themeElement
   *   The theme element to highlight as hovered.
   * @returns {void}
   */
  function hoverThemeElement(themeElement) {
    themeElement.instanceLayer.classList.add(CLASS_NAMES.instanceLayerHover, CLASS_NAMES.objectTypeHover);
    controllerHooks?.setActiveThemeElement(themeElement);
  }

  /**
   * Clears the synthetic hover highlight applied by `hoverThemeElement` and
   * resets the panel's Active Element view.
   *
   * @param {import('../model/themeElement.js').ThemeElement} themeElement
   *   The theme element to stop highlighting.
   * @returns {void}
   */
  function unhoverThemeElement(themeElement) {
    themeElement.instanceLayer.classList.remove(CLASS_NAMES.instanceLayerHover, CLASS_NAMES.objectTypeHover);
    controllerHooks?.resetActiveThemeElement();
  }

  /**
   * Sizes and positions an overlay layer to match a reference element's
   * current bounding box, accounting for page scroll.
   *
   * @param {Element} layer The overlay `<div>` to reposition.
   * @param {Element} refElement The real DOM element the overlay tracks.
   * @returns {void}
   */
  function positionLayer(layer, refElement) {
    const rect = refElement.getBoundingClientRect();
    layer.style.top = `${Math.round(rect.top + window.scrollY)}px`;
    layer.style.left = `${Math.round(rect.left + window.scrollX)}px`;
    layer.style.width = `${Math.round(rect.width)}px`;
    layer.style.height = `${Math.round(rect.height)}px`;
  }

  /**
   * Counts how many ancestors an element has, used to derive a `z-index`
   * so more deeply nested overlays draw on top of their containers'.
   *
   * @param {Element} element The element to measure.
   * @returns {number} Number of ancestor nodes up to (and not including)
   *   the document root.
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
   *   Theme elements to keep aligned; each must already have both
   *   `instanceLayer` and `dataNode` set.
   * @returns {void}
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
    /**
     * Registers the controller panel's notification callbacks, so this
     * engine can inform the panel of hover/selection changes it initiates
     * (a real mouseenter/click on an overlay). Must be called once, after
     * both the overlay and panel are constructed — see `src/index.js`.
     *
     * @param {ControllerHooks} hooks
     * @returns {void}
     */
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
 * The controller panel's side of the overlay ↔ panel contract (see
 * `createControllerPanel` in `controllerPanel.js`, which returns an object
 * implementing this shape). Registered via `attachControllerHooks`.
 *
 * @typedef {object} ControllerHooks
 * @property {(themeElement: import('../model/themeElement.js').ThemeElement) => void} setActiveThemeElement
 *   Called when a theme element becomes hovered (real mouseenter on its
 *   overlay, or a synthetic hover from the List/Filters tab).
 * @property {() => void} resetActiveThemeElement
 *   Called when the currently-hovered theme element stops being hovered.
 * @property {(themeElement: import('../model/themeElement.js').ThemeElement) => void} setDefaultThemeElement
 *   Called when a theme element becomes the single selected element.
 * @property {() => void} resetDefaultThemeElement
 *   Called when the currently-selected theme element is deselected.
 */
