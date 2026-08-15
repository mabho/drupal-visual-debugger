/**
 * Finds the first element among `startNode`'s siblings, without
 * overrunning past its own end marker into unrelated later content.
 * Tracks begin/end nesting depth, since these blocks can nest.
 *
 * @param {Node} startNode The begin-marker comment node to search from.
 * @param {RegExp} beginPattern Matches this block type's begin marker (nesting depth only).
 * @param {RegExp} endPattern Matches this block type's end marker.
 * @returns {Element|null} The bounded element, or `null` if the end marker comes first.
 */
export function findBoundedElementSibling(startNode, beginPattern, endPattern) {
  let depth = 0;
  let node = startNode.nextSibling;

  while (node) {
    if (node.nodeType === Node.ELEMENT_NODE) return node;

    if (node.nodeType === Node.COMMENT_NODE) {
      const text = node.textContent;
      if (endPattern.test(text)) {
        if (depth === 0) return null;
        depth--;
      } else if (beginPattern.test(text)) {
        depth++;
      }
    }

    node = node.nextSibling;
  }

  return null;
}
