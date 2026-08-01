import { createEmptyThemeElement } from '../model/themeElement.js';
import { LAYER_ATTRIBUTES } from '../constants.js';

/**
 * This is the one part of the library that is genuinely Drupal-specific:
 * it reads the HTML comments Drupal's Twig debug output writes into the
 * page (THEME DEBUG / THEME HOOK / FILE NAME SUGGESTIONS / BEGIN OUTPUT).
 * The renderer that consumes its output (see render/) has no idea where
 * the data came from.
 *
 * Requirement: the page must have Twig debugging enabled
 * (services.yml -> twig.config.debug: true) or there is nothing to parse.
 *
 * Regexes below are written as real regex literals rather than built from
 * strings, to avoid a subtle bug in the original module: a
 * `new RegExp("...\\s*\\n\\s*...")`-style string with single backslashes
 * silently drops the `\s` escape (it's not a recognized string escape), so
 * the resulting pattern quietly stops matching whitespace as intended.
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
 * Implementation note: `root.querySelectorAll('*')` only returns Element
 * nodes, so comment nodes are found by then walking each element's own
 * `childNodes` — this still visits every comment in document order because
 * every comment in Drupal's debug output is a child of some element under
 * `root`. Each comment is tested against the module-level regexes in turn;
 * matching `THEME DEBUG` flips on an `activated` flag that gates all
 * subsequent matches until a `BEGIN OUTPUT` comment is found (successful or
 * not — see `drupalThemeDebugParser.js`'s file-level comment for why both
 * `BEGIN OUTPUT` and `BEGIN CUSTOM TEMPLATE OUTPUT` must match), at which
 * point the in-progress `current` element is either pushed (if it resolved
 * to a real DOM element) or discarded, and scanning resets for the next
 * block.
 *
 * @param {Element} [root] Root element to scan for theme debug comments.
 *   Defaults to `document.body`. Comments outside of `root` (e.g. in
 *   `<head>`) are not seen.
 * @returns {import('../model/themeElement.js').ThemeElement[]} One entry
 *   per matched "THEME DEBUG ... BEGIN OUTPUT" block, in document order.
 *   Blocks that never resolved to a real DOM element (no matching
 *   `BEGIN OUTPUT`, or no element immediately following it) are omitted.
 */
export function parseThemeDebugElements(root = document.body) {
  const themeElements = [];
  let current = createEmptyThemeElement();
  let activated = false;

  const allNodes = root.querySelectorAll('*');

  allNodes.forEach((node) => {
    Array.from(node.childNodes).forEach((child) => {
      if (child.nodeType !== Node.COMMENT_NODE) return;
      const text = child.textContent;

      if (RE_THEME_DEBUG.test(text)) {
        activated = true;
        return;
      }

      if (!activated) return;

      const hookMatch = text.match(RE_TEMPLATE_HOOK);
      if (hookMatch) {
        current.propertyHook = hookMatch[1];
        current.objectType = hookMatch[1].split('__')[0];
        return;
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
        return;
      }

      const filePathMatch = text.match(RE_TEMPLATE_FILE_PATH);
      if (filePathMatch) {
        current.filePath = filePathMatch[1];

        const dataNode = child.nextElementSibling;
        const alreadyMatched = current.dataNode !== null;

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
    });
  });

  return themeElements;
}

/**
 * Utility: unique, sorted list of theme hooks found on the page. Useful for
 * an "Aggregate by type" view (see the module's roadmap).
 *
 * @param {import('../model/themeElement.js').ThemeElement[]} themeElements
 *   Theme elements to collect hooks from, typically the array returned by
 *   {@link parseThemeDebugElements}.
 * @returns {string[]} Alphabetically sorted list of distinct
 *   `propertyHook` values (e.g. `['block__system_branding_block', 'node__article']`).
 */
export function getUniquePropertyHooks(themeElements) {
  return [...new Set(themeElements.map((el) => el.propertyHook))].sort();
}
