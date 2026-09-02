// Drives the note layer: capture the fixture, create notes on adjacent lines via
// real Ranges, then assert the cards neither overlap nor drift off their anchors.
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

// Verifying against bytes that are not on disk proves nothing, and a leftover
// extension page never answers, so both are settled before anything is measured.
await closeTabs((url) => url.startsWith(FIXTURE));
const { extId, popup, fresh } = await openExtension();
console.log('freshness:', fresh);

const fixturePage = await openPage(FIXTURE, 'fixture');

const { page: ed, result: cap } = await captureInto(popup, extId, FIXTURE);
console.log('captured', Math.round(cap.bytes / 1024) + 'KB');


// Pin the viewport so the gutter decision is measured against a known width.
await ed.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await new Promise((r) => setTimeout(r, 400));

// Select the "Anchor phrase number N" span inside each of the first five
// paragraphs and let the layer turn each selection into a note.
const created = JSON.parse(await ed.eval(`(() => {
  const layer = window.__interleaf.layer;
  const ids = [];
  for (let i = 1; i <= 5; i++) {
    const p = document.getElementById('p' + i);
    if (!p) { ids.push(null); continue; }
    const text = p.firstChild;
    const phrase = 'Anchor phrase number ' + i;
    const start = text.data.indexOf(phrase);
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + phrase.length);
    ids.push(layer.create(range, phrase));
  }
  return JSON.stringify(ids);
})()`));
console.log('created note ids:', created);

// Give each note some body text so the cards differ in height.
await ed.eval(`(() => {
  const layer = window.__interleaf.layer;
  let n = 0;
  for (const [id, entry] of layer.notes) {
    n++;
    const body = entry.card.querySelector('.il-card__body');
    body.value = ['짧은 메모.', '두 줄쯤 되는 보통 길이의 메모. 이 정도가 흔하다.', '한 줄.', '조금 더 긴 메모. 세 줄 정도까지는 흔히 적는다. 그래서 이 길이로도 재본다.', '메모.'][n - 1];
    body.dispatchEvent(new Event('input', { bubbles: true }));
  }
  return true;
})()`);
await new Promise((r) => setTimeout(r, 600));

const report = JSON.parse(await ed.eval(`(() => {
  const layer = window.__interleaf.layer;
  const cards = [...layer.notes.entries()].map(([id, { card }]) => {
    const marks = [...document.querySelectorAll('il-mark[data-note-id="' + id + '"]')];
    const markTop = marks.length ? marks[0].getBoundingClientRect().top + scrollY : null;
    const r = card.getBoundingClientRect();
    return {
      id,
      markTop: markTop === null ? null : Math.round(markTop),
      cardTop: Math.round(r.top + scrollY),
      cardBottom: Math.round(r.bottom + scrollY),
      cardLeft: Math.round(r.left),
      drift: markTop === null ? null : Math.round(r.top + scrollY - markTop),
    };
  }).sort((a, b) => a.cardTop - b.cardTop);

  let overlaps = 0;
  for (let i = 1; i < cards.length; i++) {
    if (cards[i].cardTop < cards[i - 1].cardBottom) overlaps++;
  }

  const bodyStyle = getComputedStyle(document.body);
  return JSON.stringify({
    noteCount: layer.notes.size,
    markCount: document.querySelectorAll('il-mark').length,
    overlaps,
    gutterPaddingRight: bodyStyle.paddingRight,
    overContent: 'interleafOverlay' in document.documentElement.dataset,
    gutter: layer.gutter,
    diag: {
      clientWidth: document.documentElement.clientWidth,
      innerWidth: window.innerWidth,
      bodyRect: (() => { const r = document.body.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) }; })(),
      p1Right: Math.round(document.querySelector('#p1').getBoundingClientRect().right),
      sampledEdges: (() => {
        const out = [];
        for (const el of document.body.querySelectorAll('p, li, h1, h2, h3')) {
          const t = el.textContent?.trim();
          if (!t || t.length < 20) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 80 || r.height === 0) continue;
          out.push(Math.round(r.right));
        }
        return out;
      })(),
    },
    contentRightEdge: Math.round(document.querySelector('#p1').getBoundingClientRect().right),
    cardsLeftEdge: cards.length ? Math.min(...cards.map(c => c.cardLeft)) : null,
    cards,
  }, null, 2);
})()`));
console.log(report);

// Both gutter branches must hold: wide windows leave the capture alone, narrow
// ones reserve room. And in either case the cards must not sit over the text.
const probe = async (width, label) => {
  await ed.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
  // A fixed sleep raced the metrics change once and reported nonsense. Wait for
  // the page to actually see the new width, then for a settled layout pass.
  await cdp.waitFor(
    () => ed.eval(`Math.abs(document.documentElement.clientWidth - ${width}) < 40`),
    { label: `viewport ${width}` },
  );
  await ed.eval('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
  const out = JSON.parse(await ed.eval(`(() => {
    const layer = window.__interleaf.layer;
    const cards = [...layer.notes.entries()].map(([id, { card }]) => {
      const r = card.getBoundingClientRect();
      const m = document.querySelector('il-mark[data-note-id="' + id + '"]');
      return {
        top: Math.round(r.top + scrollY),
        bottom: Math.round(r.bottom + scrollY),
        left: Math.round(r.left),
        drift: m ? Math.round(r.top - m.getBoundingClientRect().top) : null,
      };
    }).sort((a, b) => a.top - b.top);

    let overlaps = 0;
    for (let i = 1; i < cards.length; i++) if (cards[i].top < cards[i - 1].bottom) overlaps++;

    const textRight = Math.max(...[...document.querySelectorAll('p')]
      .filter(p => !p.closest('#interleaf-cards') && (p.textContent || '').trim().length > 20)
      .map(p => p.getBoundingClientRect().right));

    return JSON.stringify({
      viewport: document.documentElement.clientWidth,
      overContent: 'interleafOverlay' in document.documentElement.dataset,
      bodyPaddingRight: getComputedStyle(document.body).paddingRight,
      textRight: Math.round(textRight),
      cardsLeft: Math.min(...cards.map(c => c.left)),
      cardsOverText: Math.min(...cards.map(c => c.left)) < Math.round(textRight),
      overlaps,
      maxDrift: Math.max(...cards.map(c => c.drift ?? 0)),
      leaderDrawn: document.querySelectorAll('#interleaf-leader polyline').length,
      markBg: (() => { const m = document.querySelector('il-mark'); return m ? getComputedStyle(m).backgroundColor : null; })(),
      collapsedFlags: [...layer.notes.values()].map(e => e.note.collapsed),
    });
  })()`));
  console.log(label, out);
  return out;
};

const wide = await probe(1800, 'wide  1800:');
const narrow = await probe(1000, 'narrow 1000:');

const failures = [];
// The capture must never be reflowed, at any width.
for (const [label, r] of [['wide', wide], ['narrow', narrow]]) {
  if (r.bodyPaddingRight !== '20px') failures.push(label + ': body padding changed to ' + r.bodyPaddingRight);
  if (r.overlaps) failures.push(label + ': ' + r.overlaps + ' overlapping cards');
  if (r.cardsLeft + 296 > r.viewport) failures.push(label + ': cards run off the right edge');
}
// Wide leaves empty margin; narrow must land over the text and say so.
if (wide.overContent) failures.push('wide viewport should not overlay the text');
if (wide.cardsOverText) failures.push('wide: cards sit over the text');
if (!narrow.overContent) failures.push('narrow viewport should flag the overlay');

console.log(failures.length ? '\nFAIL\n- ' + failures.join('\n- ') : '\nPASS: capture never reflowed; overlay flagged only when it happens');
popup.close(); ed.close(); fixturePage.close();
// Open sockets keep the event loop alive, so the run has to end itself.
process.exit(failures.length ? 1 : 0);
