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
 * Decides where the cards column sits and whether the page must give up width.
 *
 * The reserve is dropped before measuring. Measuring with it in place feeds the
 * layer its own output: reserving width narrows the content, the narrowed
 * content then looks like free space, the reserve is dropped, and the decision
 * oscillates between passes.
 *
 * @returns {{left: number, width: number, reflow: boolean}}
 */
export function measureGutter() {
  const root = document.documentElement;
  const hadReserve = 'interleafReflow' in root.dataset;
  if (hadReserve) {
    delete root.dataset.interleafReflow;
    // Forces the style change to take effect before the rects are read.
    void document.body.offsetWidth;
  }

  const viewport = root.clientWidth;
  const content = contentRightEdge();

  if (hadReserve) root.dataset.interleafReflow = '1';
  const free = viewport - content - GAP - EDGE;

  if (free >= CARD_WIDTH) {
    // Sit in the empty page beside the text, flush to the right but never so far
    // that a very narrow column leaves the cards stranded at the window edge.
    const left = Math.min(content + GAP, viewport - CARD_WIDTH - EDGE);
    return { left, width: CARD_WIDTH, reflow: false };
  }

  return { left: viewport - CARD_WIDTH - EDGE, width: CARD_WIDTH, reflow: true };
}

/** Applies the measurement: positions the column and toggles the reflow. */
export function applyGutter(host) {
  const { left, width, reflow } = measureGutter();
  host.style.left = `${Math.round(left)}px`;
  host.style.width = `${width}px`;
  const root = document.documentElement;
  if (reflow) root.dataset.interleafReflow = '1';
  else delete root.dataset.interleafReflow;
  root.style.setProperty('--il-gutter-reserve', reflow ? `${width + GAP + EDGE}px` : '0px');
  return { left, width, reflow };
}
