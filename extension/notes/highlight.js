// Painting a selection. A live Range is already in hand here, so nothing has to
// be searched for; that problem belongs to anchor resolution on reload.

const MARK = 'il-mark';

/**
 * A Range can straddle element boundaries, so wrapping it as a single node is
 * not generally possible. Each fully-or-partly covered text node is wrapped
 * instead, which yields one mark element per text node.
 * @returns {HTMLElement[]} the marks created, in document order
 */
export function paint(range, noteId) {
  const texts = textNodesIn(range);
  const marks = [];

  for (const node of texts) {
    const from = node === range.startContainer ? range.startOffset : 0;
    const to = node === range.endContainer ? range.endOffset : node.length;
    if (to <= from) continue;

    let target = node;
    if (to < target.length) target.splitText(to);
    if (from > 0) target = target.splitText(from);

    const mark = document.createElement(MARK);
    mark.dataset.noteId = noteId;
    target.parentNode.insertBefore(mark, target);
    mark.appendChild(target);
    marks.push(mark);
  }
  return marks;
}

export function marksFor(noteId) {
  return [...document.querySelectorAll(`${MARK}[data-note-id="${cssEscape(noteId)}"]`)];
}

/** Unwraps the marks and stitches the split text nodes back together. */
export function unpaint(noteId) {
  for (const mark of marksFor(noteId)) {
    const parent = mark.parentNode;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  }
}

export function setActive(noteId, active) {
  for (const mark of marksFor(noteId)) {
    if (active) mark.dataset.active = '';
    else delete mark.dataset.active;
  }
}

/** Vertical position of a note's first mark, relative to the document. */
export function topOf(noteId) {
  const [first] = marksFor(noteId);
  if (!first) return null;
  const rect = first.getBoundingClientRect();
  return rect.top + window.scrollY;
}

function textNodesIn(range) {
  const walker = document.createTreeWalker(
    range.commonAncestorContainer,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (!node.length) return NodeFilter.FILTER_REJECT;
        if (!range.intersectsNode(node)) return NodeFilter.FILTER_REJECT;
        // Marks nest badly and the note layer must never highlight itself.
        if (node.parentElement?.closest(`${MARK}, #interleaf-root, #interleaf-cards, #interleaf-bar`)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  const out = [];
  // commonAncestorContainer is itself a text node when the range sits inside one.
  if (range.commonAncestorContainer.nodeType === Node.TEXT_NODE) {
    out.push(range.commonAncestorContainer);
  } else {
    let n;
    while ((n = walker.nextNode())) out.push(n);
  }
  return out;
}

function cssEscape(value) {
  return CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&');
}
