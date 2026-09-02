// Writing the page back out. The output must stand on its own: opened straight
// from disk with no extension present, it has to show the highlights and let
// the notes be edited further.

const DATA_ID = 'interleaf-data';
const RUNTIME_ID = 'interleaf-runtime';
const RUNTIME_STYLE_ID = 'interleaf-runtime-style';
const STRIP = '#interleaf-cards, #interleaf-bar, #interleaf-leader, #interleaf-toolbar-style, #interleaf-notes-style, #interleaf-boot';

/**
 * @param {object} options
 * @param {object[]} options.notes    note records, each carrying its anchor
 * @param {string} options.runtimeJs  the viewer, inlined so `file://` can run it
 * @param {string} options.runtimeCss the layer's stylesheet, inlined likewise
 * @param {{url: string, title: string, capturedAt: string}} options.source
 * @param {string} options.docId identity of this document across its copies
 * @param {string|null} options.savedIn name of the folder it was last saved in,
 *   carried so a reopened file can say where it saves before permission returns
 * @returns {string} a complete HTML document
 */
export function serializeDocument({ notes, runtimeJs, runtimeCss, source, docId, savedIn = null }) {
  const clone = document.documentElement.cloneNode(true);

  for (const el of clone.querySelectorAll(STRIP)) el.remove();
  unwrapMarks(clone);
  // Only the note layer's own attributes; the page's own dataset is left alone.
  delete clone.dataset.interleaf;
  delete clone.dataset.interleafOverlay;
  clone.removeAttribute('style');

  const head = clone.querySelector('head') ?? clone.insertBefore(document.createElement('head'), clone.firstChild);

  replaceNode(head, RUNTIME_STYLE_ID, () => {
    const style = document.createElement('style');
    style.id = RUNTIME_STYLE_ID;
    style.textContent = runtimeCss;
    return style;
  });

  const body = clone.querySelector('body') ?? clone.appendChild(document.createElement('body'));

  replaceNode(body, DATA_ID, () => {
    const data = document.createElement('script');
    data.type = 'application/json';
    data.id = DATA_ID;
    data.textContent = JSON.stringify({ version: 1, docId, savedIn, source, notes }, null, 2);
    return data;
  });

  replaceNode(body, RUNTIME_ID, () => {
    const script = document.createElement('script');
    script.id = RUNTIME_ID;
    script.textContent = runtimeJs;
    return script;
  });

  return '<!doctype html>\n' + clone.outerHTML;
}

/** Puts `build()`'s node where the old one with that id was, or at the end. */
function replaceNode(parent, id, build) {
  const fresh = build();
  const existing = parent.querySelector(`#${id}`);
  if (existing) existing.replaceWith(fresh);
  else parent.appendChild(fresh);
  return fresh;
}

/** Marks are presentation, not content: the file stores anchors, not wrappers. */
function unwrapMarks(root) {
  for (const mark of root.querySelectorAll('il-mark')) {
    const parent = mark.parentNode;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
  }
  // Rejoins the text nodes that painting split, so the offsets written into the
  // data block describe the same text a fresh load will walk.
  root.normalize();
}

export { DATA_ID };
