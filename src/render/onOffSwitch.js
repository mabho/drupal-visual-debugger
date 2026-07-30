import { CLASS_NAMES } from '../constants.js';

/**
 * Builds a small on/off switch: a wrapper div holding a (visually hidden,
 * pointer-events: none) checkbox, an "on" icon, an "off" icon, and an
 * optional label. The caller owns interaction — attach listeners to
 * `wrapper` directly (the input can't receive pointer events by design,
 * matching the original module's markup) and call `setChecked()` to keep
 * the visual state in sync with whatever triggered the change.
 *
 * Ported from the original module's Drupal.vdUtilities.generateOnOffSwitch,
 * trimmed to what the List/Filters tabs need: no generic eventListeners
 * array, no Drupal.t() coupling.
 *
 * @param {object} [options]
 * @param {string} [options.label]
 * @param {boolean} [options.checked]
 * @param {string[]} [options.wrapperClasses]
 * @param {Record<string, string>} [options.wrapperAttributes]
 * @param {boolean} [options.labelFirst] Place the label after the icons (true) or before (false).
 * @param {string} options.iconOn Icon class shown when checked.
 * @param {string} options.iconOff Icon class shown when unchecked.
 * @returns {{ wrapper: Element, input: Element, setChecked: (checked: boolean) => void }}
 */
export function createOnOffSwitch({
  label = '',
  checked = true,
  wrapperClasses = [],
  wrapperAttributes = {},
  labelFirst = true,
  iconOn,
  iconOff,
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
    const labelEl = document.createElement('label');
    labelEl.style.pointerEvents = 'none';
    labelEl.textContent = label;
    if (labelFirst) {
      wrapper.appendChild(labelEl);
    } else {
      wrapper.insertBefore(labelEl, wrapper.firstChild);
    }
  }

  function setChecked(value) {
    input.checked = value;
    wrapper.classList.toggle(CLASS_NAMES.inputWrapperActivated, value);
    wrapper.classList.toggle(CLASS_NAMES.inputWrapperDeactivated, !value);
  }

  return { wrapper, input, setChecked };
}
