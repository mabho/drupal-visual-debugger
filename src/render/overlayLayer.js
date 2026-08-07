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
 *   destroy: () => void,
 * }} `baseLayer` is the container element holding every instance layer —
 *   append it to the document once. The rest of the shape is the API
 *   surface the controller panel's List/Filters tabs drive directly (see
 *   each named function below for details); `attachControllerHooks` wires
 *   up the reverse direction (overlay → panel notifications); `destroy`
 *   tears all of this back down (see its own doc comment).
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

  const {
    resizeObserver,
    mutationObserver,
    disconnect: disconnectPositionObservers,
  } = observePositionChanges(themeElements);

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
   * changes, via four independent triggers:
   *
   * - `ResizeObserver` on each element's own `dataNode` — catches the
   *   tracked element itself changing size.
   * - `MutationObserver` on `document.documentElement` (not just
   *   `document.body`'s own `style` attribute, the original scope) with
   *   `childList`/`subtree`/`attributes` all watched — catches layout
   *   shifts caused by *anything else* on the page: a lazy-loaded image
   *   finishing, an injected ad/cookie-consent banner, an accordion
   *   revealing a sibling, a class toggle. None of that resizes the
   *   tracked element itself or touches `document.body`'s `style`
   *   attribute specifically, so the original narrower scope missed all
   *   of it. Rooted at `documentElement` rather than `body` so it also
   *   covers attribute changes made on `<html>` itself (e.g. a
   *   viewport-offset custom property some themes use) — `document.body`
   *   is already inside `documentElement`'s subtree, so this is a strict
   *   superset of the previous scope. Mutations inside `baseLayer` itself
   *   are filtered out (see `scheduleSync`'s caller below) — otherwise
   *   this module's own position writes would retrigger the observer
   *   forever.
   * - `transitionend` on `document` (capture phase, so it sees transitions
   *   on any element) — some themes animate a layout shift (e.g. a
   *   toolbar's `padding-top` transitioning open/closed) rather than
   *   jumping straight to the new value. The mutation above fires the
   *   instant the new value is *written*, which — mid-transition — is a
   *   stale read; this catches the moment the animation actually
   *   finishes.
   * - `window` `load` and `document.fonts.ready` (each once) — both land
   *   after the very first `positionLayer` call in `buildInstanceLayer`,
   *   which runs as soon as the page's Drupal behaviors attach
   *   (`DOMContentLoaded`) — well before either fonts or images/iframes
   *   without reserved dimensions have necessarily finished loading and
   *   reflowing the page. One extra full resync once each has settled
   *   catches whatever the initial pass measured too early.
   *
   * All four are coalesced through the same `requestAnimationFrame`-
   * scheduled resync (`scheduleSync`) rather than repositioning
   * synchronously per trigger, since the `MutationObserver` in particular
   * can fire far more often than the narrower `style`-only version did.
   *
   * @param {import('../model/themeElement.js').ThemeElement[]} elements
   *   Theme elements to keep aligned; each must already have both
   *   `instanceLayer` and `dataNode` set.
   * @returns {{
   *   resizeObserver: ResizeObserver,
   *   mutationObserver: MutationObserver,
   *   disconnect: () => void,
   * }} `resizeObserver`/`mutationObserver`, so the caller can `disconnect()`
   *   them on `destroy()` as before, plus a `disconnect` function covering
   *   the `transitionend`/`load` listeners and any pending scheduled
   *   resync — none of these five are tied to an element this module ever
   *   removes itself, so without tearing all of them down they'd keep
   *   running (and keep this whole closure alive) forever.
   */
  function observePositionChanges(elements) {
    let destroyed = false;
    let pendingSyncFrame = null;

    /**
     * The actual resync, run at most once per animation frame regardless
     * of how many triggers fired in between (see `scheduleSync`).
     *
     * @returns {void}
     */
    function syncAllPositions() {
      pendingSyncFrame = null;
      if (destroyed) return;
      elements.forEach((el) => positionLayer(el.instanceLayer, el.dataNode));
    }

    /**
     * Coalescing entry point for every trigger below — safe to call as
     * often as they fire.
     *
     * @returns {void}
     */
    function scheduleSync() {
      if (destroyed || pendingSyncFrame !== null) return;
      pendingSyncFrame = requestAnimationFrame(syncAllPositions);
    }

    const resizeObserver = new ResizeObserver((entries) => {
      entries.forEach((entry) => {
        const themeElement = elements.find((el) => el.dataNode === entry.target);
        if (themeElement) positionLayer(themeElement.instanceLayer, themeElement.dataNode);
      });
    });
    elements.forEach((el) => resizeObserver.observe(el.dataNode));

    const mutationObserver = new MutationObserver((mutations) => {
      const relevant = mutations.some((mutation) => !baseLayer.contains(mutation.target));
      if (relevant) scheduleSync();
    });
    mutationObserver.observe(document.documentElement, {
      attributes: true,
      childList: true,
      subtree: true,
    });

    document.addEventListener('transitionend', scheduleSync, true);
    window.addEventListener('load', scheduleSync, { once: true });
    document.fonts?.ready?.then(scheduleSync);

    return {
      resizeObserver,
      mutationObserver,
      disconnect() {
        destroyed = true;
        if (pendingSyncFrame !== null) {
          cancelAnimationFrame(pendingSyncFrame);
          pendingSyncFrame = null;
        }
        document.removeEventListener('transitionend', scheduleSync, true);
        window.removeEventListener('load', scheduleSync);
      },
    };
  }

  /**
   * Tears down everything this engine created: disconnects both observers
   * plus the `transitionend`/`load`/`document.fonts.ready` triggers and
   * any still-pending scheduled resync (`disconnectPositionObservers` —
   * without this, they'd keep running against the real page forever, even
   * after `baseLayer` is gone), removes `baseLayer` from the document
   * (which takes every instance layer, and the mouseenter/mouseleave/click
   * listeners attached directly to them, with it — those don't need
   * separate removal since nothing outside this removed subtree
   * references them), strips the `data-vd-id` attribute the parser left
   * on each real page element, and clears the `instanceLayer`/`listRow`
   * references each `themeElement` was carrying so a stale
   * `themeElements` array a consumer might still be holding doesn't keep
   * detached DOM/closures alive.
   *
   * @returns {void}
   */
  function destroy() {
    resizeObserver.disconnect();
    mutationObserver.disconnect();
    disconnectPositionObservers();
    baseLayer.remove();

    themeElements.forEach((themeElement) => {
      themeElement.dataNode?.removeAttribute(LAYER_ATTRIBUTES.layerId);
      themeElement.instanceLayer = null;
      themeElement.listRow = null;
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
    destroy,
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
