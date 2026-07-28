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
const RE_TEMPLATE_FILE_PATH = /BEGIN OUTPUT from '([^']*)'/;
// Reserved for future use (e.g. depth/nesting tracking); not consumed yet.
const RE_TEMPLATE_END_OUTPUT = /END OUTPUT from '([^']*)'/;

/**
 * Walks every comment node under `root` and builds one ThemeElement per
 * "THEME DEBUG ... BEGIN OUTPUT" block that resolves to a real DOM element.
 *
 * @param {Element} [root] Root to scan. Defaults to document.body.
 * @returns {import('../model/themeElement.js').ThemeElement[]}
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
            return { suggestion, activated: flag === 'x' };
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
 * @returns {string[]}
 */
export function getUniquePropertyHooks(themeElements) {
  return [...new Set(themeElements.map((el) => el.propertyHook))].sort();
}
