// Round-trip: capture, make notes, write the file out, then open that file over
// file:// with no extension involved and check every note came back to the same
// text. Includes a phrase that appears twice and a range spanning two elements,
// which are the cases a position-only or quote-only anchor gets wrong.
import * as cdp from './cdp.mjs';
import { openExtension, captureInto, closeTabs, waitForPage, openPage } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Served over file://, not http://. macOS grants local-network access per
// binary, and it is withheld from Chrome for Testing: the browser cannot reach
// any localhost server (a data: url loads fine, every http one stays
// about:blank) while curl on the same machine gets 200. A file:// fixture keeps
// the harness independent of that, and still exercises resource inlining
// because its stylesheet, image and webfont are separate files.
const FIXTURE = 'file://' + fileURLToPath(new URL('../test/fixture-site/index.html', import.meta.url));
const OUT_DIR = fileURLToPath(new URL('../test/out/', import.meta.url));
const OUT = path.join(OUT_DIR, 'roundtrip.html');

// Verifying against bytes that are not on disk proves nothing, and a leftover
// extension page never answers, so both are settled before anything is measured.
await closeTabs((url) => url.startsWith(FIXTURE));
const { extId, popup, fresh } = await openExtension();
console.log('freshness:', fresh);

const fixturePage = await openPage(FIXTURE, 'fixture');

const { page: ed, result: cap } = await captureInto(popup, extId, FIXTURE);
console.log('captured', Math.round(cap.bytes / 1024) + 'KB');


// Notes to plant. The last three are the awkward cases.
const PLANTS = [
  { where: '#p1', phrase: 'Anchor phrase number 1' },
  { where: '#p3', phrase: 'Anchor phrase number 3' },
  { where: '#dup1 b', phrase: 'the same sentence appears twice on this page' },
  { where: '#dup2 b', phrase: 'the same sentence appears twice on this page' },
  { where: '#split', phrase: 'that straddles two', spanning: true },
];

const planted = await ed.eval(`(() => {
  const layer = window.__interleaf.layer;
  const plants = ${JSON.stringify(PLANTS)};
  const out = [];

  for (const [i, plant] of plants.entries()) {
    const host = document.querySelector(plant.where);
    let id = null;

    if (plant.spanning) {
      // Build a range across element boundaries: from inside the text before the
      // <em> to inside the text after it.
      const em = host.querySelector('em');
      const before = em.previousSibling;
      const after = em.nextSibling;
      const r = document.createRange();
      r.setStart(before, before.data.lastIndexOf('that '));
      r.setEnd(after, after.data.indexOf(' two') + 4);
      id = layer.create(r);
    } else {
      const text = host.firstChild;
      const at = text.data.indexOf(plant.phrase);
      const r = document.createRange();
      r.setStart(text, at);
      r.setEnd(text, at + plant.phrase.length);
      id = layer.create(r);
    }

    if (id) {
      const entry = layer.notes.get(id);
      const body = entry.card.querySelector('.il-card__body');
      body.value = 'note for ' + plant.where;
      body.dispatchEvent(new Event('input', { bubbles: true }));
      out.push({ id, where: plant.where, exact: entry.note.anchor.quote.exact, position: entry.note.anchor.position });
    } else {
      out.push({ id: null, where: plant.where });
    }
  }
  return JSON.stringify(out, null, 2);
})()`);
console.log('planted:\n' + planted.replace(/^/gm, '  '));

const html = await ed.eval('window.__interleaf.buildDocument()');
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, html);
console.log(`\nwrote ${OUT} (${Math.round(html.length / 1024)}KB)`);

// Nothing of the note layer may leak into the file's markup.
const leaks = [];
if (/<il-mark/i.test(html)) leaks.push('il-mark elements were written into the file');
if (/id="interleaf-cards"/.test(html)) leaks.push('the cards container was written into the file');
if (/id="interleaf-bar"/.test(html)) leaks.push('the toolbar was written into the file');
if (!/id="interleaf-data"/.test(html)) leaks.push('the note data block is missing');
if (!/id="interleaf-runtime"/.test(html)) leaks.push('the inlined viewer is missing');
if (/chrome-extension:\/\//.test(html)) leaks.push('an extension URL was left in the file');
console.log(leaks.length ? 'markup FAIL\n- ' + leaks.join('\n- ') : 'markup: clean');

// Open the written file. No extension code participates from here on.
// openPage rather than a bare newTab: a target can come up with its address set
// and nothing rendered, and evaluating against it then times out.
const fileUrl = 'file://' + OUT;
const opened = await openPage(fileUrl, 'saved file');
await cdp.waitFor(() => opened.eval('!!(window.__interleaf && window.__interleaf.status)'),
  { label: 'viewer boot', timeout: 20000 });
await opened.eval('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');

const restored = await opened.eval(`(() => {
  const { layer, status } = window.__interleaf;
  const notes = [...layer.notes.entries()].map(([id, { note, card }]) => {
    const marks = [...document.querySelectorAll('il-mark[data-note-id="' + id + '"]')];
    return {
      id,
      body: card.querySelector('.il-card__body').value,
      markText: marks.map(m => m.textContent).join(''),
      expected: note.anchor?.quote?.exact ?? null,
      markCount: marks.length,
      orphaned: 'orphaned' in card.dataset,
      cardTop: Math.round(card.getBoundingClientRect().top + scrollY),
      markTop: marks.length ? Math.round(marks[0].getBoundingClientRect().top + scrollY) : null,
    };
  });
  return JSON.stringify({
    status,
    hasChromeApi: typeof chrome !== 'undefined' && !!chrome.runtime,
    notes,
  }, null, 2);
})()`);
console.log('\nrestored:\n' + restored.replace(/^/gm, '  '));

const r = JSON.parse(restored);
const failures = [...leaks];
if (r.status.restored !== PLANTS.length) failures.push(`restored ${r.status.restored} of ${PLANTS.length}`);
if (r.status.orphaned.length) failures.push(`orphaned: ${r.status.orphaned.join(', ')}`);
for (const n of r.notes) {
  if (n.markText !== n.expected) failures.push(`${n.id}: anchored to "${n.markText}" but stored "${n.expected}"`);
  if (!n.body) failures.push(`${n.id}: note text was not carried into the file`);
}
// The duplicated phrase must land on two different places, not the same one.
const dupTops = r.notes.filter((n) => n.expected?.startsWith('the same sentence')).map((n) => n.markTop);
if (new Set(dupTops).size !== dupTops.length) failures.push('the repeated phrase resolved to the same spot twice');

console.log(failures.length ? '\nFAIL\n- ' + failures.join('\n- ') : '\nPASS: notes survive the round trip, extension not involved');
popup.close(); ed.close(); opened.close();

// The stored offsets are only half the anchor. Shift the text so every position
// is wrong and check the quote path finds the notes anyway - that is the case
// the recorded prefix and suffix exist for.
const SHIFTED = path.join(OUT_DIR, 'roundtrip-shifted.html');
const shifted = html.replace(
  /<body([^>]*)>/i,
  '<body$1><p id="interloper">An inserted paragraph that pushes every stored character offset out of place, so position lookup must fail and the quote must carry the notes.</p>',
);
if (shifted === html) throw new Error('could not insert the interloper paragraph');
fs.writeFileSync(SHIFTED, shifted);

const shiftedUrl = 'file://' + SHIFTED;
const moved = await openPage(shiftedUrl, 'shifted file');
await cdp.waitFor(() => moved.eval('!!(window.__interleaf && window.__interleaf.status)'),
  { label: 'viewer boot (shifted)', timeout: 20000 });
await moved.eval('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');

const afterShift = await moved.eval(`(() => {
  const { layer, status } = window.__interleaf;
  return JSON.stringify({
    status,
    notes: [...layer.notes.entries()].map(([id, { note, card }]) => {
      const marks = [...document.querySelectorAll('il-mark[data-note-id="' + id + '"]')];
      return {
        markText: marks.map(m => m.textContent).join(''),
        expected: note.anchor?.quote?.exact ?? null,
        markTop: marks.length ? Math.round(marks[0].getBoundingClientRect().top + scrollY) : null,
        orphaned: 'orphaned' in card.dataset,
      };
    }),
  }, null, 2);
})()`);
console.log('\nafter shifting the text:\n' + afterShift.replace(/^/gm, '  '));

const sh = JSON.parse(afterShift);
const shiftFailures = [];
if (sh.status.restored !== PLANTS.length) shiftFailures.push(`restored ${sh.status.restored} of ${PLANTS.length} after the shift`);
if (sh.status.byQuote.length !== PLANTS.length) {
  shiftFailures.push(`only ${sh.status.byQuote.length} of ${PLANTS.length} fell back to the quote; positions should all be stale`);
}
for (const n of sh.notes) {
  if (n.markText !== n.expected) shiftFailures.push(`anchored to "${n.markText}" but stored "${n.expected}"`);
}
const shiftedDupTops = sh.notes.filter((n) => n.expected?.startsWith('the same sentence')).map((n) => n.markTop);
if (new Set(shiftedDupTops).size !== shiftedDupTops.length) {
  shiftFailures.push('after the shift the repeated phrase resolved to the same spot twice');
}
console.log(shiftFailures.length
  ? 'FAIL (shifted)\n- ' + shiftFailures.join('\n- ')
  : 'PASS: stale positions fall back to the quote, repeats still land apart');
moved.close();
process.exit(0);
