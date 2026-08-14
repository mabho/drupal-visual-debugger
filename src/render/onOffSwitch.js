import { CLASS_NAMES } from '../constants.js';

/**
 * Builds a small on/off switch: a wrapper div holding a (visually hidden,
 * pointer-events: none) checkbox, an "on" icon, an "off" icon, and an
 * optional label. The caller owns interaction — attach listeners to
 * `wrapper` directly (the input itself can't receive pointer events) and
 * call `setChecked()` to sync the visual state.
 *
 * @param {object} [options]
 * @param {string} [options.label] Visible text label. When non-empty, a
 *   `<label for="...">` is created and associated via a generated unique
 *   `id` (omitted entirely when there's no label, e.g. a bare eye toggle).
 * @param {boolean} [options.checked] Initial checked state.
 * @param {string[]} [options.wrapperClasses] Extra classes for the
 *   wrapper `<div>`, alongside the standard toggle-wrapper classes.
 * @param {Record<string, string>} [options.wrapperAttributes] Extra
 *   `name: value` attributes for the wrapper `<div>` (e.g. `data-vd-visible`).
 * @param {boolean} [options.labelFirst] Label after the checkbox/icons
 *   (`true`, default) or before them (`false`).
 * @param {string} options.iconOn Icon class shown when checked.
 * @param {string} options.iconOff Icon class shown when unchecked.
 * @param {string} [options.iconBullet] Extra static icon prepended before
 *   everything else (used by the Grouped sub-view's per-type color
 *   swatch — see generateGroupSection).
 * @returns {{
 *   wrapper: Element,
 *   input: Element,
 *   setChecked: (checked: boolean) => void,
 * }} `wrapper` is the element to insert and attach listeners to. `input`
 *   is the underlying checkbox, exposed for reading `.checked`.
 *   `setChecked(value)` syncs the visuals without dispatching DOM events.
 */
export function createOnOffSwitch({
  label = '',
  checked = true,
  wrapperClasses = [],
  wrapperAttributes = {},
  labelFirst = true,
  iconOn,
  iconOff,
  iconBullet,
} = {}) {
  const wrapper = document.createElement('div');
  Object.entries(wrapperAttributes).forEach(([key, value]) => {
    wrapper.setAttribute(key, value);
  });
  wrapper.classList.add(
    ...wrapperClasses,
    CLASS_NAMES.checkboxToggleWrapper,
    checked ? CLASS_NAMES.inputWrapperActivated : CLASS_NAMES.inputWrapperDeactivated,
  );

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.style.pointerEvents = 'none';
  input.classList.add(CLASS_NAMES.checkboxToggle);

  /**
   * Builds one of the switch's icon `<span>`s (on/off/bullet).
   *
   * @param {string} iconClass Icon font class selecting which glyph renders.
   * @param {string} stateClass Extra class marking this icon's role (e.g.
   *   `CLASS_NAMES.activated`/`deactivated`), used by the CSS to show only
   *   the icon matching the current checked state.
   * @returns {Element} The icon `<span>`, not yet attached to the DOM.
   */
  const makeIcon = (iconClass, stateClass) => {
    const icon = document.createElement('span');
    icon.style.pointerEvents = 'none';
    icon.classList.add(iconClass, stateClass);
    return icon;
  };

  wrapper.append(
    input,
    makeIcon(iconOn, CLASS_NAMES.activated),
    makeIcon(iconOff, CLASS_NAMES.deactivated),
  );

  if (label) {
    // Unique id for the label association — many of these exist at once.
    input.id = `vd-switch-${Math.random().toString(36).substring(7)}`;

    const labelEl = document.createElement('label');
    labelEl.setAttribute('for', input.id);
    labelEl.style.pointerEvents = 'none';
    labelEl.textContent = label;
    if (labelFirst) {
      wrapper.appendChild(labelEl);
    } else {
      wrapper.insertBefore(labelEl, wrapper.firstChild);
    }
  }

  if (iconBullet) {
    wrapper.insertBefore(makeIcon(iconBullet, CLASS_NAMES.iconWithinContent), wrapper.firstChild);
  }

  /**
   * Syncs the checkbox and wrapper classes to a new checked state. Does
   * not dispatch a `change`/`click` event — this is a one-way visual sync,
   * not a simulated user interaction.
   *
   * @param {boolean} value New checked state.
   * @returns {void}
   */
  function setChecked(value) {
    input.checked = value;
    wrapper.classList.toggle(CLASS_NAMES.inputWrapperActivated, value);
    wrapper.classList.toggle(CLASS_NAMES.inputWrapperDeactivated, !value);
  }

  return { wrapper, input, setChecked };
}
