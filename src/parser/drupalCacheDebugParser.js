import { createEmptyCacheElement } from '../model/cacheElement.js';
import { LAYER_ATTRIBUTES } from '../constants.js';
import { findBoundedElementSibling } from './boundedElementSibling.js';

/**
 * Parses Drupal's render-cache debug HTML comments (`renderer.config.debug`
 * — separate from the `twig.config.debug` setting `drupalThemeDebugParser.js`
 * reads). Fully independent of that parser/`ThemeElement`: a cache block
 * wraps any render array with `#cache` keys, themed or not.
 */

const RE_CACHE_START = /START RENDERER/;
const RE_CACHE_END = /END RENDERER/;
const RE_CACHE_HIT = /CACHE-HIT:\s*(Yes|No)/;
// One pattern for both `CACHE TAGS/CONTEXTS/KEYS` and their
// `PRE-BUBBLING CACHE` counterparts — Drupal emits the same templated
// block twice, once per prefix. `[\s\S]*` (not `.*`) since the item list
// is real embedded newlines within this one comment node's text.
const RE_CACHE_LIST = /^\s*(PRE-BUBBLING )?CACHE (TAGS|CONTEXTS|KEYS):\s*([\s\S]*)$/;
const RE_CACHE_MAX_AGE = /^\s*(PRE-BUBBLING )?CACHE MAX-AGE:\s*(.+?)\s*$/;
const RE_CACHE_RENDERING_TIME = /RENDERING TIME:\s*([\d.]+)/;

const CACHE_LIST_PROPERTY = { TAGS: 'tags', CONTEXTS: 'contexts', KEYS: 'keys' };
const PRE_BUBBLING_LIST_PROPERTY = { TAGS: 'preBubblingTags', CONTEXTS: 'preBubblingContexts', KEYS: 'preBubblingKeys' };

/**
 * Splits a `CACHE TAGS:`-style comment body into its `   * value` lines.
 *
 * @param {string} body Text after the `NAME:` prefix, newlines included.
 * @returns {string[]}
 */
function parseListItems(body) {
  return body
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s*/, '').trim())
    .filter((line) => line.length > 0);
}

/**
 * Walks comment nodes under `root` and builds one CacheElement per
 * `START RENDERER ... END RENDERER` block. Uses an explicit stack, since
 * cache blocks can nest and — unlike theme-debug's `BEGIN OUTPUT` — the
 * reset trigger (`END RENDERER`) sits at the end of a block, after any
 * nested child's own complete cycle.
 *
 * @param {Element} [root] Root element to scan. Defaults to `document.body`.
 * @returns {import('../model/cacheElement.js').CacheElement[]} One entry
 *   per newly-matched block, in document order.
 */
export function parseCacheDebugElements(root = document.body) {
  const cacheElements = [];
  const stack = [];
  let current = null;
  let startNode = null;

  const treeWalker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);

  let child = treeWalker.nextNode();
  while (child) {
    const text = child.textContent;

    if (RE_CACHE_START.test(text)) {
      if (current) stack.push({ element: current, startNode });
      current = createEmptyCacheElement();
      startNode = child;
      child = treeWalker.nextNode();
      continue;
    }

    if (!current) {
      child = treeWalker.nextNode();
      continue;
    }

    const hitMatch = text.match(RE_CACHE_HIT);
    if (hitMatch) {
      current.cacheHit = hitMatch[1] === 'Yes';
      current.objectType = current.cacheHit ? 'cache-hit' : 'cache-miss';
      child = treeWalker.nextNode();
      continue;
    }

    const listMatch = text.match(RE_CACHE_LIST);
    if (listMatch) {
      const [, preBubbling, field, body] = listMatch;
      const propertyName = preBubbling ? PRE_BUBBLING_LIST_PROPERTY[field] : CACHE_LIST_PROPERTY[field];
      current[propertyName] = parseListItems(body);
      child = treeWalker.nextNode();
      continue;
    }

    const maxAgeMatch = text.match(RE_CACHE_MAX_AGE);
    if (maxAgeMatch) {
      const [, preBubbling, value] = maxAgeMatch;
      current[preBubbling ? 'preBubblingMaxAge' : 'maxAge'] = value;
      child = treeWalker.nextNode();
      continue;
    }

    const timeMatch = text.match(RE_CACHE_RENDERING_TIME);
    if (timeMatch) {
      current.renderingTime = timeMatch[1];
      child = treeWalker.nextNode();
      continue;
    }

    if (RE_CACHE_END.test(text)) {
      const dataNode = findBoundedElementSibling(startNode, RE_CACHE_START, RE_CACHE_END);
      const alreadyMatched = dataNode?.hasAttribute(LAYER_ATTRIBUTES.cacheLayerId);

      if (!alreadyMatched) {
        current.dataNode = dataNode ?? null;
        current.id = `cache-element-${Math.random().toString(36).substring(7)}`;
        if (dataNode) dataNode.setAttribute(LAYER_ATTRIBUTES.cacheLayerId, current.id);
        cacheElements.push(current);
      }

      const parent = stack.pop();
      current = parent ? parent.element : null;
      startNode = parent ? parent.startNode : null;
    }

    child = treeWalker.nextNode();
  }

  return cacheElements;
}
