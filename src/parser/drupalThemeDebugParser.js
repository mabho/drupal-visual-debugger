import { createEmptyThemeElement } from '../model/themeElement.js';
import { LAYER_ATTRIBUTES } from '../constants.js';

/**
 * The one part of the library that is genuinely Drupal-specific: reads
 * the HTML comments Drupal's Twig debug output writes into the page
 * (THEME DEBUG / THEME HOOK / FILE NAME SUGGESTIONS / BEGIN OUTPUT). The
 * renderer that consumes its output (see render/) has no idea where the
 * data came from.
 *
 * Requires Twig debugging enabled (services.yml -> twig.config.debug: true).
 *
 * Regexes below are real regex literals, not built from strings — a
 * `new RegExp("...\\s*\\n\\s*...")` string with single backslashes
 * silently drops the `\s` escape, since it's not a recognized string escape.
 */

const RE_THEME_DEBUG = /THEME DEBUG/;
const RE_TEMPLATE_HOOK = /THEME HOOK: '([^']*)'/;
const RE_TEMPLATE_SUGGESTIONS = /FILE NAME SUGGESTIONS:\s*\n\s*([^']*)\s*\n*\s*/;
// Drupal emits "BEGIN OUTPUT" for the default/core template, or
// "💡 BEGIN CUSTOM TEMPLATE OUTPUT" when the active template is a
// theme-provided override (see TwigThemeEngine::renderTwigTemplate()) —
// i.e. almost every element on a real themed site. Both must match, or
// every overridden template is silently dropped.
const RE_TEMPLATE_FILE_PATH = /BEGIN(?: CUSTOM TEMPLATE)? OUTPUT from '([^']*)'/;
// Reserved for future use (e.g. depth/nesting tracking); not consumed yet.
const RE_TEMPLATE_END_OUTPUT = /END(?: CUSTOM TEMPLATE)? OUTPUT from '([^']*)'/;

/**
 * Walks every comment node under `root` and builds one ThemeElement per
 * "THEME DEBUG ... BEGIN OUTPUT" block that resolves to a real DOM element.
 *
 * Uses a `TreeWalker` filtered to `SHOW_COMMENT` rather than
 * `querySelectorAll('*')` + inspecting `childNodes`: the native
 * `whatToShow` filter skips non-comment nodes without materializing a
 * full element collection, and correctly finds comments that are direct
 * children of `root` itself (which `querySelectorAll('*')` never includes).
 *
 * Each comment is tested against the module-level regexes in turn;
 * matching `THEME DEBUG` gates all subsequent matches until a
 * `BEGIN OUTPUT` comment is found, at which point `current` is pushed (if
 * it resolved to a real element) or discarded, and scanning resets.
 *
 * Safe to call repeatedly on the same (or overlapping) `root` — elements
 * already matched (tracked via `LAYER_ATTRIBUTES.layerId`) are skipped,
 * so whole-root rescanning works for picking up dynamic content (see
 * `index.js`'s `reconcileDynamicContent`).
 *
 * @param {Element} [root] Root element to scan for theme debug comments.
 *   Defaults to `document.body`.
 * @returns {import('../model/themeElement.js').ThemeElement[]} One entry
 *   per newly-matched block, in document order. Blocks that never
 *   resolved to a real DOM element are omitted.
 */
export function parseThemeDebugElements(root = document.body) {
  const themeElements = [];
  let current = createEmptyThemeElement();
  let activated = false;

  const treeWalker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);

  let child = treeWalker.nextNode();
  while (child) {
    const text = child.textContent;

    if (RE_THEME_DEBUG.test(text)) {
      activated = true;
      child = treeWalker.nextNode();
      continue;
    }

    if (!activated) {
      child = treeWalker.nextNode();
      continue;
    }

    const hookMatch = text.match(RE_TEMPLATE_HOOK);
    if (hookMatch) {
      current.propertyHook = hookMatch[1];
      current.objectType = hookMatch[1].split('__')[0];
      child = treeWalker.nextNode();
      continue;
    }

    const suggestionsMatch = text.match(RE_TEMPLATE_SUGGESTIONS);
    if (suggestionsMatch) {
      current.suggestions = suggestionsMatch[1]
        .trim()
        .split(/\n\s*/)
        .map((line) => {
          const [flag, suggestion] = line.split(' ');
          // 'x' is the legacy marker; '✅' is what current Drupal core emits.
          return { suggestion, activated: flag === 'x' || flag === '✅' };
        });
      child = treeWalker.nextNode();
      continue;
    }

    const filePathMatch = text.match(RE_TEMPLATE_FILE_PATH);
    if (filePathMatch) {
      current.filePath = filePathMatch[1];

      const dataNode = child.nextElementSibling;
      // Guards against re-matching an element a previous call already
      // claimed, which would otherwise push a duplicate ThemeElement
      // every time `root` is rescanned.
      const alreadyMatched = dataNode?.hasAttribute(LAYER_ATTRIBUTES.layerId);

      if (dataNode && dataNode.nodeType === Node.ELEMENT_NODE && !alreadyMatched) {
        current.dataNode = dataNode;
        current.id = `element-${Math.random().toString(36).substring(7)}`;
        dataNode.setAttribute(LAYER_ATTRIBUTES.layerId, current.id);
        themeElements.push(current);
      }

      // Start fresh for the next block.
      current = createEmptyThemeElement();
      activated = false;
    }

    child = treeWalker.nextNode();
  }

  return themeElements;
}

/**
 * Unique, sorted list of theme hooks found on the page.
 *
 * @param {import('../model/themeElement.js').ThemeElement[]} themeElements
 *   Typically the array returned by {@link parseThemeDebugElements}.
 * @returns {string[]} Alphabetically sorted list of distinct
 *   `propertyHook` values (e.g. `['block__system_branding_block', 'node__article']`).
 */
export function getUniquePropertyHooks(themeElements) {
  return [...new Set(themeElements.map((el) => el.propertyHook))].sort();
}
