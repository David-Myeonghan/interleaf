// Where the cards go. Most articles are a centred column with several hundred
// pixels of empty page beside them, so the cards can be laid over that space and
// the captured page never has to be reflowed. Only when the content genuinely
// fills the width does the layer fall back to reserving room for itself.

const CARD_WIDTH = 296;
const GAP = 24;
const EDGE = 12;

/**
 * Right edge of the page's actual content, in document coordinates.
 *
 * A single widest-element measurement is wrong: full-bleed wrappers, sticky
 * headers and footers routinely span the viewport while the prose does not. The
 * text-bearing blocks are sampled instead and a high percentile taken, so one
 * stray banner does not force a reflow.
 */
export function contentRightEdge() {
  const edges = [];
  for (const el of document.body.querySelectorAll('p, li, h1, h2, h3, h4, blockquote, pre, td, dd, figcaption')) {
    if (el.closest('#interleaf-cards, #interleaf-bar, #interleaf-leader')) continue;
    const text = el.textContent?.trim();
    if (!text || text.length < 20) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 80 || rect.height === 0) continue;
    edges.push(rect.right + window.scrollX);
  }
  if (!edges.length) return document.body.getBoundingClientRect().right + window.scrollX;
  edges.sort((a, b) => a - b);
  return edges[Math.floor(edges.length * 0.95)] ?? edges[edges.length - 1];
}

/**
 * Decides where the cards column sits, and whether it ends up over the page's
 * own content.
 *
 * The captured page is never reflowed. Reserving width can break a layout
 * outright — absolutely positioned elements, grids, sticky chrome — and the
 * only way back from a broken layout is to hide the notes. Overlaying merely
 * occludes, which folding or the hide button undoes. The recoverable loss wins.
 *
 * @returns {{left: number, width: number, overContent: boolean}}
 */
export function measureGutter() {
  const viewport = document.documentElement.clientWidth;
  const content = contentRightEdge();
  const left = Math.max(
    Math.min(content + GAP, viewport - CARD_WIDTH - EDGE),
    EDGE,
  );
  return { left, width: CARD_WIDTH, overContent: left < content };
}

/** Applies the measurement: positions the column and flags the overlap. */
export function applyGutter(host) {
  const measured = measureGutter();
  host.style.left = `${Math.round(measured.left)}px`;
  host.style.width = `${measured.width}px`;
  const root = document.documentElement;
  if (measured.overContent) root.dataset.interleafOverlay = '';
  else delete root.dataset.interleafOverlay;
  return measured;
}
