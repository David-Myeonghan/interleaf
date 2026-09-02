// Card placement. Positions are never stored: they are recomputed on open, on
// resize and after any edit, which keeps overlap a layout concern rather than a
// data one.

const MIN_GAP = 8;

/**
 * Lays cards out top to bottom. Each card wants to sit level with its highlight
 * and is pushed down only as far as clearing the card above requires.
 *
 * One pass suffices: a card is placed as high as the card above it allows, and
 * that card was placed the same way, so the whole stack ends up as high as the
 * anchors and gaps permit.
 *
 * @param {{id: string, el: HTMLElement, anchorTop: number|null}[]} cards
 * @returns {{id: string, top: number}[]} where each visible card landed
 */
export function place(cards) {
  for (const card of cards) {
    card.el.style.display = card.anchorTop === null ? 'none' : '';
  }

  const visible = cards
    .filter((c) => c.anchorTop !== null)
    .map((c) => ({ id: c.id, el: c.el, anchorTop: c.anchorTop, height: c.el.offsetHeight }))
    .sort((a, b) => a.anchorTop - b.anchorTop);

  let floor = 0;
  const out = [];
  for (const card of visible) {
    const top = Math.max(card.anchorTop, floor);
    card.el.style.top = `${Math.round(top)}px`;
    floor = top + card.height + MIN_GAP;
    out.push({ id: card.id, top });
  }
  return out;
}

/**
 * Draws a dashed leader from a highlight to its card. Only the active note gets
 * one; drawing them all turns the gutter into a thicket.
 *
 * Coordinates are viewport-relative because the host is position: fixed. A host
 * inside the cards column cannot reach left into the content area, and an
 * absolutely positioned one would have to track the body's padding box.
 *
 * @param {SVGElement} svg   fixed, viewport-sized host
 * @param {Element|null} mark  first mark element of the active note
 * @param {Element|null} card  the active note's card
 * @param {number} textRight   viewport x where the page's text stops
 */
export function drawLeader(svg, mark, card, textRight = 0) {
  svg.replaceChildren();
  if (!mark || !card) return;

  const m = mark.getBoundingClientRect();
  const c = card.getBoundingClientRect();
  const markY = m.top + m.height / 2;
  const cardY = c.top + 14;
  // Starting at the mark's right edge drew the line straight through the rest of
  // that line's text and read as a strikethrough. It begins past the text block.
  const startX = Math.max(m.right, textRight) + 4;
  const endX = c.left - 2;
  if (endX <= startX) return;

  const elbowX = Math.max(startX + 12, endX - 18);
  const points = [
    [startX, markY],
    [elbowX, markY],
    [elbowX, cardY],
    [endX, cardY],
  ];

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  line.setAttribute('points', points.map(([x, y]) => `${Math.round(x)},${Math.round(y)}`).join(' '));
  svg.appendChild(line);
}
