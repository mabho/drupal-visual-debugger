import { CLASS_NAMES, LAYER_ATTRIBUTES } from '../constants.js';

/**
 * Builds and manages the overlay layers painted on top of each parsed
 * theme element. Fully agnostic — no knowledge of Drupal comments or Twig.
 *
 * Builds one overlay ("instance layer") per theme element up front, and
 * mutates each `themeElement` in place by setting its `instanceLayer`
 * property — everything else locates a theme element's overlay through
 * that property rather than a separate lookup table.
 *
 * @param {object} options
 * @param {import('../model/themeElement.js').ThemeElement[]} options.themeElements
 *   Every theme element found on the page. The returned engine holds this
 *   exact array — `addThemeElement`/`removeThemeElement` push/splice it,
 *   so any other holder (e.g. `index.js`) sees dynamic changes too.
 * @param {() => void} [options.onDomChanged] Called (debounced) whenever a
 *   DOM mutation suggests content appeared/disappeared — see
 *   `observePositionChanges`'s `scheduleContentNotify`. This module never
 *   decides *what* changed, only that something did; `index.js` re-parses
 *   and calls `addThemeElement`/`removeThemeElement`.
 * @returns {{
 *   baseLayer: Element,
 *   attachControllerHooks: (hooks: ControllerHooks) => void,
 *   isThemeElementSelected: (themeElement: import('../model/themeElement.js').ThemeElement) => boolean,
 *   toggleThemeElementSelection: (themeElement: import('../model/themeElement.js').ThemeElement) => void,
 *   setThemeElementVisible: (themeElement: import('../model/themeElement.js').ThemeElement, visible: boolean) => void,
 *   isThemeElementVisible: (themeElement: import('../model/themeElement.js').ThemeElement) => boolean,
 *   hoverThemeElement: (themeElement: import('../model/themeElement.js').ThemeElement) => void,
 *   unhoverThemeElement: (themeElement: import('../model/themeElement.js').ThemeElement) => void,
 *   addThemeElement: (themeElement: import('../model/themeElement.js').ThemeElement) => void,
 *   removeThemeElement: (themeElement: import('../model/themeElement.js').ThemeElement) => void,
 *   destroy: () => void,
 * }} `baseLayer` holds every instance layer — append it once.
 *   `attachControllerHooks` wires overlay → panel notifications; the rest
 *   is the API surface the controller panel drives directly.
 */
export function createOverlayEngine({ themeElements, onDomChanged }) {
  const baseLayer = document.createElement('div');
  baseLayer.classList.add(CLASS_NAMES.visualDebugger, CLASS_NAMES.baseLayer);

  /** @type {ControllerHooks|null} */
  let controllerHooks = null;

  /**
   * One entry per distinct `position: sticky` ancestor found on the page
   * — see `setupStickyTracking`/`createStickyGroup`.
   *
   * @type {Map<Element, StickyGroup>}
   */
  const stickyGroupsByAncestor = new Map();

  themeElements.forEach((themeElement) => {
    const instanceLayer = buildInstanceLayer(themeElement);
    themeElement.instanceLayer = instanceLayer;
    baseLayer.appendChild(instanceLayer);
  });

  const {
    resizeObserver,
    mutationObserver,
    disconnect: disconnectPositionObservers,
  } = observePositionChanges(themeElements, onDomChanged);

  /**
   * Creates the overlay box for a single theme element: positions it over
   * the node's bounding box, adds a checkbox + activated/deactivated
   * icons, and wires up hover (highlight + notify the panel) and click
   * (toggle selection).
   *
   * @param {import('../model/themeElement.js').ThemeElement} themeElement
   *   Not mutated here — the caller sets `.instanceLayer` after this returns.
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
    classifyPositionStrategy(themeElement.dataNode);
    // A genuinely-fixed element needs no live sticky tracking.
    if (themeElement.dataNode.getAttribute(LAYER_ATTRIBUTES.positionStrategy) !== 'fixed') {
      setupStickyTracking(themeElement);
    }
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

    // Every sub-view/tab that can have a live row for this element at
    // once needs notifying, or an unregistered one silently goes stale.
    themeElement.listRow?.setActivated(checked);
    themeElement.treeRow?.setActivated(checked);
    themeElement.groupedRow?.setActivated(checked);
    themeElement.cacheRow?.setActivated(checked);

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
   * if it was the selected one.
   *
   * @param {import('../model/themeElement.js').ThemeElement} themeElement
   *   The theme element to show or hide.
   * @param {boolean} visible `true` to show its overlay, `false` to hide it.
   * @returns {void}
   */
  function setVisible(themeElement, visible) {
    if (!visible && isChecked(themeElement)) setChecked(themeElement, false);
    themeElement.instanceLayer.setAttribute(LAYER_ATTRIBUTES.visible, String(visible));
    // See the equivalent comment in `setChecked` — `listRow`, `treeRow`,
    // `groupedRow`, and `cacheRow` all need notifying, since any of them
    // may currently have a live row for this element.
    themeElement.listRow?.setVisible(visible);
    themeElement.treeRow?.setVisible(visible);
    themeElement.groupedRow?.setVisible(visible);
    themeElement.cacheRow?.setVisible(visible);
  }

  /**
   * Is this theme element's overlay currently visible? The visibility
   * counterpart to `isChecked` — read by row-building code for real
   * current state rather than assuming a default.
   *
   * @param {import('../model/themeElement.js').ThemeElement} themeElement
   *   Must already have an `instanceLayer`.
   * @returns {boolean} `true` if this element's overlay is currently visible.
   */
  function isThemeElementVisible(themeElement) {
    return themeElement.instanceLayer?.getAttribute(LAYER_ATTRIBUTES.visible) !== 'false';
  }

  /**
   * Synthetic hover, for use by the Items tab's rows: a real mouse hover
   * on the overlay itself is covered by CSS `:hover`, but hovering a list
   * row doesn't put the mouse over the overlay, so its highlight has to be
   * toggled explicitly.
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
   * Incorporates a newly-discovered theme element into this already-
   * running engine: builds/appends its overlay, tracks its size, and
   * pushes it into `themeElements` — the one place that push happens;
   * `controllerPanel.js`'s own `addThemeElement` must not also push it.
   * No-op if already added.
   *
   * @param {import('../model/themeElement.js').ThemeElement} themeElement
   *   A freshly-parsed theme element, not yet carrying an `instanceLayer`.
   * @returns {void}
   */
  function addThemeElement(themeElement) {
    if (themeElement.instanceLayer) return;
    const instanceLayer = buildInstanceLayer(themeElement);
    themeElement.instanceLayer = instanceLayer;
    baseLayer.appendChild(instanceLayer);
    themeElements.push(themeElement);
    resizeObserver.observe(themeElement.dataNode);
  }

  /**
   * Reverses `addThemeElement` — also used when a construction-time
   * element's `dataNode` is later detected as detached (see
   * `reconcileDynamicContent`). Deselects if checked, stops size
   * tracking, removes the overlay, strips the `data-vd-id` the parser
   * stamped (so a detached-and-reinserted node is picked up fresh rather
   * than skipped by the parser's dedup guard), and drops it from
   * `themeElements`. No-op if already removed.
   *
   * Callers must call `controllerPanel`'s equivalent `removeThemeElement`
   * FIRST, while `listRow`/`treeRow`/`groupedRow`/`cacheRow`/`instanceLayer`
   * are still intact — this function nulls all five.
   *
   * @param {import('../model/themeElement.js').ThemeElement} themeElement
   *   The theme element to stop tracking.
   * @returns {void}
   */
  function removeThemeElement(themeElement) {
    if (!themeElement.instanceLayer) return;
    if (isChecked(themeElement)) setChecked(themeElement, false);
    detachFromStickyGroup(themeElement);
    resizeObserver.unobserve(themeElement.dataNode);
    themeElement.instanceLayer.remove();
    // Strips both dedup markers unconditionally (a harmless no-op for
    // whichever doesn't apply) rather than branching on which kind of
    // element this is — this engine drives both ThemeElements (`layerId`)
    // and CacheElements (`cacheLayerId`) generically.
    themeElement.dataNode?.removeAttribute(LAYER_ATTRIBUTES.layerId);
    themeElement.dataNode?.removeAttribute(LAYER_ATTRIBUTES.cacheLayerId);
    themeElement.dataNode?.removeAttribute(LAYER_ATTRIBUTES.positionStrategy);
    const index = themeElements.indexOf(themeElement);
    if (index !== -1) themeElements.splice(index, 1);
    themeElement.instanceLayer = null;
    themeElement.listRow = null;
    themeElement.treeRow = null;
    themeElement.groupedRow = null;
    themeElement.cacheRow = null;
  }

  /**
   * Sizes and positions an overlay layer to match a reference element's
   * bounding box. Branches on `refElement`'s cached
   * `LAYER_ATTRIBUTES.positionStrategy` (set by `classifyPositionStrategy`):
   * a `fixed` element gets `position: fixed` with no scroll offset added
   * (inline style overrides the stylesheet's `position: absolute`);
   * everything else uses ordinary document-relative math.
   *
   * @param {Element} layer The overlay `<div>` to reposition.
   * @param {Element} refElement The real DOM element the overlay tracks.
   * @returns {void}
   */
  function positionLayer(layer, refElement) {
    const isFixed = refElement.getAttribute(LAYER_ATTRIBUTES.positionStrategy) === 'fixed';
    const rect = refElement.getBoundingClientRect();
    layer.style.position = isFixed ? 'fixed' : 'absolute';
    layer.style.top = `${Math.round(rect.top + (isFixed ? 0 : window.scrollY))}px`;
    layer.style.left = `${Math.round(rect.left + (isFixed ? 0 : window.scrollX))}px`;
    layer.style.width = `${Math.round(rect.width)}px`;
    layer.style.height = `${Math.round(rect.height)}px`;
  }

  /**
   * Does this ancestor establish a containing block for `position: fixed`
   * descendants? A stricter set of properties than what affects
   * `position: absolute` (plain `relative`/`absolute`/`sticky` don't
   * count). Checked via `getComputedStyle`, not a raw `style` attribute,
   * since these can come from a stylesheet rule too.
   *
   * @param {CSSStyleDeclaration} computedStyle Result of
   *   `getComputedStyle(ancestor)` for the ancestor being tested.
   * @returns {boolean} `true` if this ancestor breaks a descendant
   *   `position: fixed` element's anchoring to the true viewport.
   */
  function establishesFixedContainingBlock(computedStyle) {
    const hasNonNone = (prop) => computedStyle.getPropertyValue(prop) !== 'none';
    if (['transform', 'translate', 'scale', 'rotate', 'perspective', 'filter'].some(hasNonNone)) {
      return true;
    }
    if (computedStyle.getPropertyValue('backdrop-filter') !== 'none'
      || computedStyle.getPropertyValue('-webkit-backdrop-filter') !== 'none') {
      return true;
    }
    if (computedStyle.getPropertyValue('content-visibility') === 'auto') {
      return true;
    }
    const willChange = computedStyle.getPropertyValue('will-change');
    if (['transform', 'perspective', 'filter', 'contain'].some((name) => willChange.includes(name))) {
      return true;
    }
    const contain = computedStyle.getPropertyValue('contain');
    return ['layout', 'paint', 'strict', 'content'].some((name) => contain.includes(name));
  }

  /**
   * Classifies, once, whether `dataNode` is `position: fixed` (itself, or
   * a descendant of a clean, viewport-anchored `position: fixed`
   * ancestor) or ordinary document-relative, caching the result as
   * `LAYER_ATTRIBUTES.positionStrategy` — the only thing `positionLayer`
   * reads. Runs once at tracking time (see `buildInstanceLayer`), not per
   * frame, since this is normally a static fact of the page's structure;
   * AJAX/BigPipe reconciliation reclassifies on remove-and-re-add if it
   * ever needs to change.
   *
   * Walks up from `dataNode` for the nearest `position: fixed` ancestor,
   * short-circuiting on an ancestor already marked
   * `LAYER_ATTRIBUTES.fixedContainingBlock` by a previous classification
   * — but revalidated with one `getComputedStyle` check first, since a
   * stale marker would misclassify once that ancestor's CSS later
   * changes. Once found, walks upward from it checking every remaining
   * ancestor via `establishesFixedContainingBlock`; if any neutralizes
   * it, falls back to "not fixed" — otherwise marks it clean and
   * classifies `dataNode` as `'fixed'`.
   *
   * @param {Element} dataNode The real page element to classify.
   * @returns {void}
   */
  function classifyPositionStrategy(dataNode) {
    let fixedAncestor = null;
    // Distinguishes "found via a revalidated marker, already proven clean
    // by whichever earlier element set it — skip re-walking for
    // neutralizers" from "freshly discovered here — still needs that walk
    // before it can be trusted or marked."
    let confirmedClean = false;
    let node = dataNode;

    while (node && node !== document.documentElement) {
      if (node.hasAttribute(LAYER_ATTRIBUTES.fixedContainingBlock)) {
        if (window.getComputedStyle(node).position === 'fixed') {
          fixedAncestor = node;
          confirmedClean = true;
          break;
        }
        // Stale — this ancestor's CSS no longer makes it fixed. Strip the
        // marker so nothing else short-circuits on it either, and fall
        // through to the normal check on this same node below.
        node.removeAttribute(LAYER_ATTRIBUTES.fixedContainingBlock);
      }

      if (window.getComputedStyle(node).position === 'fixed') {
        fixedAncestor = node;
        break;
      }

      node = node.parentElement;
    }

    if (!fixedAncestor) return;

    if (!confirmedClean) {
      let neutralized = false;
      let ancestor = fixedAncestor.parentElement;
      while (ancestor && ancestor !== document.documentElement) {
        if (establishesFixedContainingBlock(window.getComputedStyle(ancestor))) {
          neutralized = true;
          break;
        }
        ancestor = ancestor.parentElement;
      }

      if (neutralized) return;

      fixedAncestor.setAttribute(LAYER_ATTRIBUTES.fixedContainingBlock, 'true');
    }

    dataNode.setAttribute(LAYER_ATTRIBUTES.positionStrategy, 'fixed');
  }

  /**
   * One shared tracking rig per distinct `position: sticky` ancestor —
   * see `createStickyGroup`.
   *
   * @typedef {object} StickyGroup
   * @property {Element} stickyAncestor The `position: sticky` element
   *   itself (nearest one found walking up from a tracked `dataNode`).
   * @property {Element|null} root The `IntersectionObserver` root — the
   *   nearest ancestor scroll container, or `null` for the viewport.
   * @property {Element} sentinel The tiny marker `<div>` inserted as a
   *   real sibling immediately before `stickyAncestor`.
   * @property {IntersectionObserver} observer Watches `sentinel` against
   *   `root`.
   * @property {import('../model/themeElement.js').ThemeElement[]} members
   *   Every tracked theme element resolving to this same sticky ancestor.
   */

  /**
   * Finds the nearest `position: sticky` ancestor (including `dataNode`)
   * that could plausibly stick — i.e. `top` isn't `auto` (a bare `sticky`
   * with no offset never pins). Scoped to `top`-stickiness only for now;
   * `bottom`/`left`/`right`-sticky elements fall back to the ordinary
   * absolute+scroll strategy.
   *
   * @param {Element} dataNode The real page element to search from.
   * @returns {Element|null} The nearest usable sticky ancestor, or `null`.
   */
  function findStickyAncestor(dataNode) {
    let node = dataNode;
    while (node && node !== document.documentElement) {
      const style = window.getComputedStyle(node);
      if (style.position === 'sticky' && style.getPropertyValue('top') !== 'auto') {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  /**
   * Finds the nearest genuinely, actively user-scrollable ancestor — the
   * correct `IntersectionObserver` root for a sentinel near `element`.
   * `null` (viewport) if none exists.
   *
   * Stricter than "overflow isn't `visible`": requires `auto`/`scroll`
   * (not `hidden`/`clip`, which clip but aren't user-scrolled — using one
   * as root would size it to the element's full rendered extent rather
   * than the viewport, delaying the stuck transition) and genuine
   * overflow (`scrollHeight`/`scrollWidth` exceeding the client box).
   * `document.body`/`documentElement` are never returned even if they'd
   * match (e.g. a `body { overflow-x: hidden }` reset) — real page
   * scrolling should just use `root: null`.
   *
   * @param {Element} element Ancestor search starts at `element.parentElement`.
   * @returns {Element|null} The nearest genuinely scrollable ancestor, or `null`.
   */
  function findScrollContainer(element) {
    let node = element.parentElement;
    while (node && node !== document.documentElement && node !== document.body) {
      const style = window.getComputedStyle(node);
      const scrollsY = (style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight;
      const scrollsX = (style.overflowX === 'auto' || style.overflowX === 'scroll') && node.scrollWidth > node.clientWidth;
      if (scrollsY || scrollsX) return node;
      node = node.parentElement;
    }
    return null;
  }

  /**
   * Live counterpart to `classifyPositionStrategy` for elements under a
   * `position: sticky` ancestor — sticky can't be cached once like fixed,
   * since whether it's currently pinned changes with scroll position and
   * `getComputedStyle` can't reveal that. Joins or creates the ancestor's
   * shared `StickyGroup` (many elements commonly share one ancestor, so
   * only the first creates a sentinel/observer).
   *
   * @param {import('../model/themeElement.js').ThemeElement} themeElement
   *   The theme element to wire up live sticky tracking for, if applicable.
   * @returns {void}
   */
  function setupStickyTracking(themeElement) {
    const stickyAncestor = findStickyAncestor(themeElement.dataNode);
    if (!stickyAncestor) return;

    let group = stickyGroupsByAncestor.get(stickyAncestor);
    if (!group) {
      group = createStickyGroup(stickyAncestor);
      stickyGroupsByAncestor.set(stickyAncestor, group);
    }
    group.members.push(themeElement);
    themeElement.stickyGroup = group;
  }

  /**
   * Builds a new `StickyGroup` for a just-discovered sticky ancestor: a
   * near-invisible sentinel (`height: 1px`) inserted right before it,
   * watched by an `IntersectionObserver` rooted at its nearest scroll
   * container. Fires only at the two stuck/unstuck transitions (see
   * `handleStickyIntersection`).
   *
   * `rootMargin` shrinks the root's top edge by `stickyAncestor`'s
   * resolved `top` offset — otherwise the sentinel would only cross the
   * unadjusted edge, later than stickiness actually kicks in.
   * `getComputedStyle` already resolves `calc()`/custom properties to a
   * final px value.
   *
   * Known limitation: the offset is resolved once, here. If it changes
   * later (e.g. a toolbar tray live-updating an offset variable), this
   * group's `rootMargin` goes stale until torn down and recreated.
   *
   * @param {Element} stickyAncestor The sticky element to track.
   * @returns {StickyGroup} The new, empty (no `members` yet) group.
   */
  function createStickyGroup(stickyAncestor) {
    const sentinel = document.createElement('div');
    sentinel.setAttribute(LAYER_ATTRIBUTES.stickySentinelMarker, 'true');
    sentinel.style.cssText = 'height:1px;margin:0;padding:0;';
    stickyAncestor.parentElement.insertBefore(sentinel, stickyAncestor);

    const stickyTopOffsetPx = parseFloat(window.getComputedStyle(stickyAncestor).top) || 0;

    /** @type {StickyGroup} */
    const group = {
      stickyAncestor,
      root: findScrollContainer(stickyAncestor),
      sentinel,
      observer: null,
      members: [],
    };

    group.observer = new IntersectionObserver(
      (entries) => entries.forEach((entry) => handleStickyIntersection(group, entry)),
      { root: group.root, rootMargin: `-${stickyTopOffsetPx}px 0px 0px 0px` },
    );
    group.observer.observe(sentinel);

    return group;
  }

  /**
   * Interprets one `IntersectionObserver` entry for a sticky group's
   * sentinel as a stuck/unstuck transition (or a no-op, for an
   * indeterminate/irrelevant entry) and applies the result.
   *
   * @param {StickyGroup} group The group whose sentinel triggered this entry.
   * @param {IntersectionObserverEntry} entry
   * @returns {void}
   */
  function handleStickyIntersection(group, entry) {
    if (entry.isIntersecting) {
      applyStuck(group, false);
      return;
    }
    // `rootBounds` can be `null` per spec (e.g. root not renderable) —
    // treat as indeterminate rather than risk a crash reading `.top` off
    // it. Also confirm the exit was specifically past the *top* edge —
    // this feature only tracks top-stickiness (see `findStickyAncestor`).
    if (!entry.rootBounds || entry.boundingClientRect.top >= entry.rootBounds.top) return;
    applyStuck(group, true);
  }

  /**
   * Applies a stuck/unstuck transition to every member of `group`.
   * Revalidates `stickyAncestor` is still CSS-`sticky` before honoring a
   * "stuck" transition — the sentinel's intersection is pure scroll
   * geometry and fires regardless, so without this a breakpoint that
   * toggles `sticky` off would pin an overlay over an element back in
   * ordinary flow.
   *
   * @param {StickyGroup} group
   * @param {boolean} stuck Whether the sentinel signaled a transition to stuck.
   * @returns {void}
   */
  function applyStuck(group, stuck) {
    const confirmedStuck = stuck && window.getComputedStyle(group.stickyAncestor).position === 'sticky';
    group.members.forEach((themeElement) => {
      if (confirmedStuck) themeElement.dataNode.setAttribute(LAYER_ATTRIBUTES.positionStrategy, 'fixed');
      else themeElement.dataNode.removeAttribute(LAYER_ATTRIBUTES.positionStrategy);
      positionLayer(themeElement.instanceLayer, themeElement.dataNode);
    });
  }

  /**
   * Reverses `setupStickyTracking` for one element: splices it out of its
   * group's `members`, and — once a group has no members left — tears the
   * whole group down (disconnects the observer, removes the sentinel from
   * the document, drops the Map entry) so nothing keeps tracking a sticky
   * ancestor nobody cares about anymore. No-op if `themeElement` was never
   * part of a sticky group.
   *
   * @param {import('../model/themeElement.js').ThemeElement} themeElement
   * @returns {void}
   */
  function detachFromStickyGroup(themeElement) {
    const group = themeElement.stickyGroup;
    if (!group) return;
    themeElement.stickyGroup = null;

    const index = group.members.indexOf(themeElement);
    if (index !== -1) group.members.splice(index, 1);

    if (group.members.length === 0) {
      group.observer.disconnect();
      group.sentinel.remove();
      stickyGroupsByAncestor.delete(group.stickyAncestor);
    }
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
   * Keeps overlay layers aligned with their reference elements via four
   * independent triggers:
   * - `ResizeObserver` on each `dataNode` — the tracked element resizing.
   * - `MutationObserver` on `document.documentElement` (`childList`/
   *   `subtree`/`attributes`) — layout shifts from anything else on the
   *   page (lazy images, injected banners, class toggles). Mutations
   *   inside `baseLayer` are filtered out, or this module's own position
   *   writes would retrigger it forever.
   * - `transitionend` on `document` (capture phase) — catches animated
   *   layout shifts (e.g. a toolbar's `padding-top` transition) once they
   *   finish; the mutation above fires on write, which is stale mid-transition.
   * - `window` `load` and `document.fonts.ready` (each once) — one extra
   *   resync after fonts/images without reserved dimensions finish
   *   loading, since the first `positionLayer` call runs at
   *   `DOMContentLoaded`, before those settle.
   *
   * Position sync (`scheduleSync`, rAF-coalesced) and content-change
   * notification (`scheduleContentNotify`, debounced) share the same
   * `MutationObserver` but run on different cadences — repositioning
   * wants ≤1-frame latency, while rescanning for new content doesn't, and
   * sharing the per-frame cadence would drive a full rescan up to 60x/sec
   * on any continuously-mutating page.
   *
   * @param {import('../model/themeElement.js').ThemeElement[]} elements
   *   Theme elements to keep aligned; each must already have both
   *   `instanceLayer` and `dataNode` set.
   * @param {() => void} [onDomChanged] Forwarded from `createOverlayEngine`.
   * @returns {{
   *   resizeObserver: ResizeObserver,
   *   mutationObserver: MutationObserver,
   *   disconnect: () => void,
   * }} `disconnect` also covers the `transitionend`/`load` listeners and
   *   any pending scheduled resync/notify.
   */
  function observePositionChanges(elements, onDomChanged) {
    let destroyed = false;
    let pendingSyncFrame = null;
    let pendingContentNotifyTimer = null;

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
     * Coalescing entry point for every position-affecting trigger below —
     * safe to call as often as they fire.
     *
     * @returns {void}
     */
    function scheduleSync() {
      if (destroyed || pendingSyncFrame !== null) return;
      pendingSyncFrame = requestAnimationFrame(syncAllPositions);
    }

    /**
     * Debounced (trailing, ~200ms) notification that new content may have
     * appeared or been removed somewhere in the document. Resets on every
     * qualifying mutation rather than firing on a fixed interval, so
     * `onDomChanged` only runs once a burst of content changes has
     * actually settled (e.g. a whole AJAX response's worth of DOM
     * insertions landing across several mutation records).
     *
     * @returns {void}
     */
    function scheduleContentNotify() {
      if (destroyed || !onDomChanged) return;
      if (pendingContentNotifyTimer !== null) clearTimeout(pendingContentNotifyTimer);
      pendingContentNotifyTimer = setTimeout(() => {
        pendingContentNotifyTimer = null;
        if (!destroyed) onDomChanged();
      }, 200);
    }

    const resizeObserver = new ResizeObserver((entries) => {
      entries.forEach((entry) => {
        const themeElement = elements.find((el) => el.dataNode === entry.target);
        if (themeElement) positionLayer(themeElement.instanceLayer, themeElement.dataNode);
      });
    });
    elements.forEach((el) => resizeObserver.observe(el.dataNode));

    // Checked once per mutation record: relevant to position, content
    // discovery, both, or neither.
    const mutationObserver = new MutationObserver((mutations) => {
      let relevantForPosition = false;
      let relevantForContent = false;

      mutations.forEach((mutation) => {
        if (baseLayer.contains(mutation.target)) return;
        // A sticky sentinel's insert/remove targets its *parent*, so the
        // check above can't catch it — check the touched nodes instead,
        // or every sentinel create/teardown triggers a pointless resync.
        const touchedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
        if (touchedNodes.length > 0 && touchedNodes.every((node) => (
          node.nodeType === Node.ELEMENT_NODE && node.hasAttribute(LAYER_ATTRIBUTES.stickySentinelMarker)
        ))) {
          return;
        }
        relevantForPosition = true;
        // Attribute-only mutations (e.g. the parser's `data-vd-id` stamp)
        // can't add/remove a comment/element pairing.
        if (mutation.type === 'childList' && (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0)) {
          relevantForContent = true;
        }
      });

      if (relevantForPosition) scheduleSync();
      if (relevantForContent) scheduleContentNotify();
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
        if (pendingContentNotifyTimer !== null) {
          clearTimeout(pendingContentNotifyTimer);
          pendingContentNotifyTimer = null;
        }
        document.removeEventListener('transitionend', scheduleSync, true);
        window.removeEventListener('load', scheduleSync);
      },
    };
  }

  /**
   * Tears down everything this engine created: disconnects both observers
   * and the `transitionend`/`load`/`fonts.ready` triggers
   * (`disconnectPositionObservers`), removes `baseLayer` (taking every
   * instance layer and its listeners with it), strips the parser's
   * `data-vd-id` from each page element, tears down every sticky group,
   * and clears the `instanceLayer`/row/`stickyGroup` references each
   * `themeElement` carried.
   *
   * @returns {void}
   */
  function destroy() {
    resizeObserver.disconnect();
    mutationObserver.disconnect();
    disconnectPositionObservers();
    baseLayer.remove();

    stickyGroupsByAncestor.forEach((group) => {
      group.observer.disconnect();
      group.sentinel.remove();
    });
    stickyGroupsByAncestor.clear();

    themeElements.forEach((themeElement) => {
      themeElement.dataNode?.removeAttribute(LAYER_ATTRIBUTES.layerId);
      themeElement.dataNode?.removeAttribute(LAYER_ATTRIBUTES.cacheLayerId);
      themeElement.instanceLayer = null;
      themeElement.listRow = null;
      themeElement.treeRow = null;
      themeElement.groupedRow = null;
      themeElement.cacheRow = null;
      themeElement.stickyGroup = null;
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
    isThemeElementVisible,
    hoverThemeElement,
    unhoverThemeElement,
    addThemeElement,
    removeThemeElement,
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
 *   overlay, or a synthetic hover from the Items tab).
 * @property {() => void} resetActiveThemeElement
 *   Called when the currently-hovered theme element stops being hovered.
 * @property {(themeElement: import('../model/themeElement.js').ThemeElement) => void} setDefaultThemeElement
 *   Called when a theme element becomes the single selected element.
 * @property {() => void} resetDefaultThemeElement
 *   Called when the currently-selected theme element is deselected.
 */
