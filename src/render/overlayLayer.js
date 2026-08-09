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
 *   `addThemeElement`/`removeThemeElement` (see the returned shape) push/
 *   splice this same array, so anything else holding a reference to it
 *   (e.g. `index.js`, `getUniquePropertyHooks`) sees dynamic changes too.
 * @param {() => void} [options.onDomChanged] Called (debounced, no payload)
 *   whenever a DOM mutation suggests content may have appeared or
 *   disappeared somewhere in the document — see `observePositionChanges`'s
 *   `scheduleContentNotify`. This module stays parser-agnostic on purpose
 *   (see the file-level doc comment): it never decides *what* changed,
 *   only that something did; `index.js` is the one that reacts by
 *   re-parsing and calling `addThemeElement`/`removeThemeElement`.
 * @returns {{
 *   baseLayer: Element,
 *   attachControllerHooks: (hooks: ControllerHooks) => void,
 *   isThemeElementSelected: (themeElement: import('../model/themeElement.js').ThemeElement) => boolean,
 *   toggleThemeElementSelection: (themeElement: import('../model/themeElement.js').ThemeElement) => void,
 *   setThemeElementVisible: (themeElement: import('../model/themeElement.js').ThemeElement, visible: boolean) => void,
 *   hoverThemeElement: (themeElement: import('../model/themeElement.js').ThemeElement) => void,
 *   unhoverThemeElement: (themeElement: import('../model/themeElement.js').ThemeElement) => void,
 *   addThemeElement: (themeElement: import('../model/themeElement.js').ThemeElement) => void,
 *   removeThemeElement: (themeElement: import('../model/themeElement.js').ThemeElement) => void,
 *   destroy: () => void,
 * }} `baseLayer` is the container element holding every instance layer —
 *   append it to the document once. The rest of the shape is the API
 *   surface the controller panel's List/Filters tabs drive directly (see
 *   each named function below for details); `attachControllerHooks` wires
 *   up the reverse direction (overlay → panel notifications);
 *   `addThemeElement`/`removeThemeElement` incorporate/evict a theme
 *   element discovered/lost after this initial construction (see each for
 *   details); `destroy` tears all of this back down (see its own doc
 *   comment).
 */
export function createOverlayEngine({ themeElements, onDomChanged }) {
  const baseLayer = document.createElement('div');
  baseLayer.classList.add(CLASS_NAMES.visualDebugger, CLASS_NAMES.baseLayer);

  /** @type {ControllerHooks|null} */
  let controllerHooks = null;

  /**
   * One entry per distinct `position: sticky` ancestor found on the page —
   * see `setupStickyTracking`/`createStickyGroup`. Real pages almost
   * always have only a handful of distinct sticky containers (a header,
   * maybe a sidebar) regardless of how many theme elements are tracked,
   * so this stays small independent of page size.
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
    classifyPositionStrategy(themeElement.dataNode);
    // Sticky only needs live tracking if the element isn't already
    // unconditionally fixed — a genuinely-fixed element needs nothing
    // further, and checking here (rather than inside `setupStickyTracking`
    // itself) keeps that function focused on sticky detection alone.
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
   * Incorporates a newly-discovered theme element into this already-
   * running engine: builds and appends its overlay exactly like the
   * construction-time elements got, starts tracking its size via
   * `resizeObserver`, and pushes it into the shared `themeElements` array
   * — the one place ownership of that push lives; `controllerPanel.js`'s
   * own `addThemeElement` takes the object as a given and must not also
   * push it, or the array (and anything that reads it, e.g.
   * `getUniquePropertyHooks`) ends up with duplicates. No-op if
   * `themeElement` was already added, in case dynamic-content
   * reconciliation (see `index.js`'s `reconcileDynamicContent`) ever
   * double-fires for the same object.
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
   * Reverses `addThemeElement` — also used for elements that were present
   * at construction time, e.g. once their `dataNode` is detected as
   * detached from the document (see `reconcileDynamicContent`). Deselects
   * the element first if it was the checked/selected one (cascades into
   * the usual `resetDefaultThemeElement` notification via `setChecked`,
   * no extra plumbing needed), stops tracking its size, removes its
   * overlay from the document, strips the `data-vd-id` the parser stamped
   * — so a library that detaches-and-later-reinserts the same node (e.g.
   * a cached/reused dialog) is picked up fresh on a later rescan rather
   * than being permanently skipped by the parser's own cross-call dedup
   * guard — and drops it from the shared `themeElements` array. No-op if
   * `themeElement` was already removed.
   *
   * Callers (see `index.js`'s `reconcileDynamicContent`) must call
   * `controllerPanel`'s equivalent `removeThemeElement` FIRST, while
   * `themeElement.listRow`/`instanceLayer` are still intact — this
   * function nulls both.
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
    themeElement.dataNode?.removeAttribute(LAYER_ATTRIBUTES.layerId);
    themeElement.dataNode?.removeAttribute(LAYER_ATTRIBUTES.positionStrategy);
    const index = themeElements.indexOf(themeElement);
    if (index !== -1) themeElements.splice(index, 1);
    themeElement.instanceLayer = null;
    themeElement.listRow = null;
  }

  /**
   * Sizes and positions an overlay layer to match a reference element's
   * current bounding box. Branches on `refElement`'s cached
   * `LAYER_ATTRIBUTES.positionStrategy` (set once by
   * `classifyPositionStrategy`, never derived here) — for an element
   * that's itself `position: fixed`, or a descendant of a clean,
   * viewport-anchored `position: fixed` ancestor, the overlay is
   * positioned `fixed` too, straight from the viewport-relative
   * `getBoundingClientRect` values with no scroll offset added; setting
   * `position` inline overrides the stylesheet's class-driven `position:
   * absolute` (from `.instance-element`'s SCSS rule) with no SCSS changes
   * needed, since inline style always wins over a class selector.
   * Everything else keeps the ordinary document-relative math (accounting
   * for page scroll) exactly as before.
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
   * Properties that establish a containing block for `position: fixed`
   * descendants specifically — a stricter, different set than what
   * affects `position: absolute` descendants (plain `relative`/
   * `absolute`/`sticky` on an ancestor does *not* count here; only these
   * do). Verified against the current CSS Positioned Layout / Transforms
   * / Contain specs. Checked via `getComputedStyle`, never via a raw
   * `style` attribute read, since these can come from a stylesheet rule
   * just as easily as an inline style.
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
   * Classifies, once, whether `dataNode` should be tracked as
   * `position: fixed` (itself, or a descendant of a clean, viewport-
   * anchored `position: fixed` ancestor) or with the ordinary document-
   * relative strategy — and caches the result as
   * `LAYER_ATTRIBUTES.positionStrategy` directly on `dataNode`, the only
   * thing `positionLayer` ever reads. Deliberately runs once, when an
   * element is first added to tracking (see `buildInstanceLayer`), not on
   * every position-sync tick — seeing whether an element sits inside a
   * fixed ancestor is normally a static fact of the page's structure for
   * that element's lifetime, and a `getComputedStyle` walk per element per
   * animation frame would be real, avoidable cost on top of the
   * `getBoundingClientRect` calls already happening there. If an
   * element's classification genuinely needs to change later, the
   * existing AJAX/BigPipe reconciliation already reclassifies from
   * scratch whenever an element is removed-and-re-added.
   *
   * Walks from `dataNode` upward (checking `dataNode` itself first) for
   * the nearest `position: fixed` ancestor, short-circuiting instantly if
   * it encounters an ancestor already marked
   * `LAYER_ATTRIBUTES.fixedContainingBlock` by a *previous* element's
   * classification — but only after revalidating that marker with one
   * `getComputedStyle` check, not by trusting it blindly: without that
   * revalidation, a marker written once and never invalidated would
   * misclassify future elements once that ancestor's CSS later toggles
   * away from `position: fixed` (e.g. a header that switches between
   * `fixed`/`static` via a scroll-driven class toggle). Once a fixed
   * ancestor is found (freshly, or confirmed-still-valid via the marker),
   * continues walking upward from it checking every remaining ancestor
   * via `establishesFixedContainingBlock` — if any is found, that fixed
   * ancestor isn't actually anchored to the true viewport (something
   * between it and the viewport intercepts it), so the safe fallback is
   * "not fixed". Otherwise, the fixed ancestor is confirmed clean: it gets
   * marked for future elements to short-circuit on, and `dataNode` is
   * classified `'fixed'`.
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
   * Finds the nearest `position: sticky` ancestor (including `dataNode`
   * itself) that could plausibly ever actually stick — i.e. also has at
   * least one of `top`/`right`/`bottom`/`left` not `auto` (a bare
   * `position: sticky` with no offset behaves exactly like `position:
   * relative` and never pins, so there's no point building tracking for
   * it). Scoped to `top`-stickiness only for now (see this feature's
   * "Known limitations" — `bottom`/`left`/`right`-sticky elements are
   * simply never matched here, falling back to the ordinary absolute+
   * scroll strategy like any other in-flow content).
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
   * Finds the nearest ancestor that is genuinely, actively user-scrollable
   * — the correct `root` for an `IntersectionObserver` watching a sentinel
   * near `element`. `null` (meaning the viewport) if none exists, which is
   * both the common case for a page-level sticky header AND the safe
   * default whenever nothing more specific is confirmed.
   *
   * Deliberately stricter than "computed overflow isn't `visible`":
   * - Only `auto`/`scroll` qualify, not `hidden`/`clip` — `hidden` clips
   *   content but isn't a container a user actually scrolls; treating it
   *   as one produces a root whose own bounding rect (via
   *   `getBoundingClientRect`, always viewport-relative) spans however
   *   much of the *page* that element renders, not the visible viewport —
   *   since nothing genuinely scrolls *inside* it, intersection against
   *   that oversized rect only flips once the sentinel scrolls out of the
   *   element's entire rendered extent, not the viewport, which reads as
   *   "the stuck transition doesn't fire until the sentinel leaves the
   *   whole page." A real, confirmed failure mode, not a hypothetical one.
   * - Also requires genuine overflow (`scrollHeight`/`scrollWidth`
   *   exceeding the client box) — a declared-but-inactive `overflow: auto`
   *   with nothing to scroll shouldn't qualify either.
   * - `document.body`/`document.documentElement` are never returned even
   *   if they'd otherwise match (e.g. a `body { overflow-x: hidden }`
   *   reset, common for suppressing accidental horizontal scrollbars, was
   *   the concrete case that surfaced this) — real page-level scrolling
   *   should just use `root: null`, which is unconditionally correct and
   *   carries none of the above risk; treating body/html as a stand-in
   *   for the same thing is exactly what caused it.
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
   * Live, transition-driven counterpart to `classifyPositionStrategy` for
   * elements that aren't unconditionally fixed but do sit under a
   * `position: sticky` ancestor — sticky can't be classified once and
   * cached forever the way fixed can, since whether it's *currently*
   * pinned changes continuously with scroll position, with no
   * `getComputedStyle` signal that reveals which state it's in at any
   * given moment. Detects the sticky ancestor (if any), then joins or
   * creates its shared `StickyGroup` (see `createStickyGroup`) — many
   * theme elements commonly resolve to the very same sticky ancestor
   * (e.g. several tracked elements inside one header), so only the first
   * one actually creates a sentinel/observer.
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
   * Builds a new `StickyGroup` for a just-discovered sticky ancestor: an
   * invisible-in-effect sentinel (a real, in-flow sibling — `height: 1px;
   * margin: 0; padding: 0`, negligible but real layout footprint) inserted
   * immediately before it, watched by an `IntersectionObserver` rooted at
   * its nearest actual scroll container. The observer fires only at the
   * two stuck/unstuck transition instants (see `handleStickyIntersection`)
   * — no per-frame or per-scroll-pixel cost either way.
   *
   * @param {Element} stickyAncestor The sticky element to track.
   * @returns {StickyGroup} The new, empty (no `members` yet) group.
   */
  function createStickyGroup(stickyAncestor) {
    const sentinel = document.createElement('div');
    sentinel.setAttribute(LAYER_ATTRIBUTES.stickySentinelMarker, 'true');
    sentinel.style.cssText = 'height:1px;margin:0;padding:0;';
    stickyAncestor.parentElement.insertBefore(sentinel, stickyAncestor);

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
      { root: group.root },
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
   * Revalidates that `stickyAncestor` is still actually CSS-`sticky`
   * before honoring a "stuck" transition — the sentinel's intersection is
   * pure scroll geometry and fires regardless of whether the ancestor is
   * still sticky at that moment; without this check, a responsive
   * breakpoint that toggles `sticky` off via a class swap would pin an
   * overlay over an element that's actually back in ordinary flow. The
   * sticky-specific analogue of `classifyPositionStrategy`'s marker
   * revalidation for the fixed case.
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
   * Position sync (`scheduleSync`, rAF-coalesced) and content-change
   * notification (`scheduleContentNotify`, debounced — see its own doc
   * comment for why it deliberately runs on a different, much slower
   * cadence) are two independently-triggered signals sharing the same
   * `MutationObserver`, not one shared tick — repositioning wants ≤1-frame
   * latency (visible jank otherwise), while "new content probably
   * finished arriving" does not, and reusing the per-frame cadence for
   * both would drive a full comment-tree rescan up to 60x/sec, forever,
   * on any page with even one continuously-mutating widget (a carousel, a
   * live-chat badge).
   *
   * @param {import('../model/themeElement.js').ThemeElement[]} elements
   *   Theme elements to keep aligned; each must already have both
   *   `instanceLayer` and `dataNode` set.
   * @param {() => void} [onDomChanged] Forwarded from `createOverlayEngine`
   *   — called (debounced) whenever a qualifying mutation suggests content
   *   may have appeared/disappeared. Omitted entirely if not provided (no
   *   timer ever gets scheduled).
   * @returns {{
   *   resizeObserver: ResizeObserver,
   *   mutationObserver: MutationObserver,
   *   disconnect: () => void,
   * }} `resizeObserver`/`mutationObserver`, so the caller can `disconnect()`
   *   them on `destroy()` as before, plus a `disconnect` function covering
   *   the `transitionend`/`load` listeners and any pending scheduled
   *   resync/notify — none of these are tied to an element this module
   *   ever removes itself, so without tearing all of them down they'd keep
   *   running (and keep this whole closure alive) forever.
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

    // A single mutation batch can be relevant to position, to content
    // discovery, both, or neither — checked once per mutation record
    // rather than with two separate `.some()` passes over the same array.
    const mutationObserver = new MutationObserver((mutations) => {
      let relevantForPosition = false;
      let relevantForContent = false;

      mutations.forEach((mutation) => {
        if (baseLayer.contains(mutation.target)) return;
        // Inserting/removing a sticky-tracking sentinel (see
        // `createStickyGroup`/`detachFromStickyGroup`) is a real childList
        // mutation on a real page node — `mutation.target` there is the
        // sentinel's *parent*, never the sentinel itself, so the
        // `baseLayer.contains` check above can't catch it; check the
        // actual added/removed nodes instead. Without this, every sticky
        // group created/torn down would otherwise trigger a pointless
        // position resync and a full comment-tree rescan for zero actual
        // page content change.
        const touchedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
        if (touchedNodes.length > 0 && touchedNodes.every((node) => (
          node.nodeType === Node.ELEMENT_NODE && node.hasAttribute(LAYER_ATTRIBUTES.stickySentinelMarker)
        ))) {
          return;
        }
        relevantForPosition = true;
        // Attribute-only mutations (including the parser's own
        // `data-vd-id` stamp on a just-matched node) can never introduce
        // or remove a comment/element pairing, so they're excluded here —
        // only a childList change with actual added/removed nodes counts.
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
   * plus the `transitionend`/`load`/`document.fonts.ready` triggers and
   * any still-pending scheduled resync (`disconnectPositionObservers` —
   * without this, they'd keep running against the real page forever, even
   * after `baseLayer` is gone), removes `baseLayer` from the document
   * (which takes every instance layer, and the mouseenter/mouseleave/click
   * listeners attached directly to them, with it — those don't need
   * separate removal since nothing outside this removed subtree
   * references them), strips the `data-vd-id` attribute the parser left
   * on each real page element, disconnects every remaining sticky group's
   * `IntersectionObserver` and removes its sentinel from the document
   * (mirroring the per-group teardown in `detachFromStickyGroup`, done in
   * bulk here since every element is going away at once), and clears the
   * `instanceLayer`/`listRow`/`stickyGroup` references each `themeElement`
   * was carrying so a stale `themeElements` array a consumer might still
   * be holding doesn't keep detached DOM/closures alive.
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
      themeElement.instanceLayer = null;
      themeElement.listRow = null;
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
 *   overlay, or a synthetic hover from the List/Filters tab).
 * @property {() => void} resetActiveThemeElement
 *   Called when the currently-hovered theme element stops being hovered.
 * @property {(themeElement: import('../model/themeElement.js').ThemeElement) => void} setDefaultThemeElement
 *   Called when a theme element becomes the single selected element.
 * @property {() => void} resetDefaultThemeElement
 *   Called when the currently-selected theme element is deselected.
 */
