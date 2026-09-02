// Turning a Range into something that survives being written to a file, and
// back again. This is the part that cannot lean on a live selection: on reload
// there is only text.
//
// The shape follows the W3C Web Annotation selectors, and for the same reason
// Hypothesis uses both: a position is exact but brittle, a quote is robust but
// ambiguous when the phrase repeats. Storing both lets one check the other.

const CONTEXT = 32;
const OUR_NODES = 'il-mark, #interleaf-cards, #interleaf-bar, #interleaf-leader';

/**
 * Every text node of the captured page, in document order, with the running
 * character offset at which each begins.
 *
 * The layer's own text is skipped, so the mapping is identical before and after
 * highlights are painted: marks only wrap text, they never change a character.
 */
function textMap(root = document.body) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.length) return NodeFilter.FILTER_REJECT;
      // A mark's own text belongs to the page; a card's does not.
      if (node.parentElement?.closest('#interleaf-cards, #interleaf-bar, #interleaf-leader')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes = [];
  let text = '';
  let node;
  while ((node = walker.nextNode())) {
    nodes.push({ node, start: text.length, end: text.length + node.length });
    text += node.data;
  }
  return { nodes, text };
}

/** Character offset of a (container, offset) boundary within the map. */
function offsetOf(map, container, offset) {
  if (container.nodeType === Node.TEXT_NODE) {
    const entry = map.nodes.find((n) => n.node === container);
    return entry ? entry.start + offset : null;
  }
  // An element boundary: take the first text node at or after it.
  const child = container.childNodes[offset];
  if (!child) {
    const last = map.nodes[map.nodes.length - 1];
    return last ? last.end : 0;
  }
  const entry = map.nodes.find((n) => child.contains?.(n.node) || n.node === child);
  return entry ? entry.start : null;
}

/** @returns {{quote: {exact: string, prefix: string, suffix: string}, position: {start: number, end: number}} | null} */
export function fromRange(range, root = document.body) {
  const map = textMap(root);
  const start = offsetOf(map, range.startContainer, range.startOffset);
  const end = offsetOf(map, range.endContainer, range.endOffset);
  if (start === null || end === null || end <= start) return null;

  return {
    quote: {
      exact: map.text.slice(start, end),
      prefix: map.text.slice(Math.max(0, start - CONTEXT), start),
      suffix: map.text.slice(end, end + CONTEXT),
    },
    position: { start, end },
  };
}

/** Builds a Range spanning [start, end) of the map. */
function rangeFor(map, start, end) {
  const from = map.nodes.find((n) => start >= n.start && start < n.end);
  const to = map.nodes.find((n) => end > n.start && end <= n.end);
  if (!from || !to) return null;
  const range = document.createRange();
  range.setStart(from.node, start - from.start);
  range.setEnd(to.node, end - to.start);
  return range;
}

/**
 * Finds the anchor again. The position is tried first and accepted only if the
 * text there still matches; otherwise every occurrence of the quote is scored on
 * how much of its recorded prefix and suffix it reproduces, with distance from
 * the recorded position breaking ties. That is what handles a phrase appearing
 * more than once on the page.
 *
 * @returns {{range: Range, how: 'position' | 'quote'} | null}
 */
export function toRange(anchor, root = document.body) {
  const map = textMap(root);
  const exact = anchor?.quote?.exact;
  if (!exact) return null;

  const { start, end } = anchor.position ?? {};
  if (Number.isInteger(start) && map.text.slice(start, end) === exact) {
    const range = rangeFor(map, start, end);
    if (range) return { range, how: 'position' };
  }

  let best = null;
  for (let i = map.text.indexOf(exact); i !== -1; i = map.text.indexOf(exact, i + 1)) {
    const score = affixScore(map.text, i, i + exact.length, anchor.quote);
    const distance = Number.isInteger(start) ? Math.abs(i - start) : 0;
    if (!best || score > best.score || (score === best.score && distance < best.distance)) {
      best = { at: i, score, distance };
    }
  }
  if (!best) return null;

  const range = rangeFor(map, best.at, best.at + exact.length);
  return range ? { range, how: 'quote' } : null;
}

/** How many recorded context characters the candidate reproduces, 0..1 each side. */
function affixScore(text, from, to, quote) {
  const prefix = quote.prefix ?? '';
  const suffix = quote.suffix ?? '';
  const before = text.slice(Math.max(0, from - prefix.length), from);
  const after = text.slice(to, to + suffix.length);
  return matchFromEnd(before, prefix) + matchFromStart(after, suffix);
}

function matchFromEnd(a, b) {
  if (!b.length) return 1;
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n / b.length;
}

function matchFromStart(a, b) {
  if (!b.length) return 1;
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n / b.length;
}

export { OUR_NODES, textMap };
