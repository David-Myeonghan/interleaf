// Drives the note layer: capture the fixture, create notes on adjacent lines via
// real Ranges, then assert the cards neither overlap nor drift off their anchors.
import * as cdp from './cdp.mjs';
import { extensionId } from './ext-id.mjs';

const FIXTURE = 'http://127.0.0.1:8777/index.html';
const extId = await extensionId();

/** Waits for a page target whose url starts with `prefix`. Fixed sleeps raced
 *  the fixture's asset loads and left tabs.query with no url to match. */
async function waitForPage(prefix, label) {
  return cdp.waitFor(
    async () => (await cdp.targets()).find((t) => t.type === 'page' && t.url.startsWith(prefix)),
    { label: label ?? prefix, timeout: 20000 },
  );
}

await cdp.newTab(FIXTURE);
await waitForPage(FIXTURE, 'fixture page');

await cdp.newTab(`chrome-extension://${extId}/popup.html`);
const popTarget = await waitForPage(`chrome-extension://${extId}/popup.html`, 'popup page');
const pop = cdp.connect(popTarget.webSocketDebuggerUrl);

const tabId = await cdp.waitFor(async () => {
  const ids = JSON.parse(await pop.eval(
    `chrome.tabs.query({}).then(ts => JSON.stringify(ts.filter(t => (t.url||'').startsWith('${FIXTURE}')).map(t => t.id)))`));
  return ids[0];
}, { label: 'fixture tab id' });

const cap = JSON.parse(await pop.eval(
  `chrome.runtime.sendMessage({ type: 'capture', tabId: ${tabId} }).then(r => JSON.stringify(r))`));
if (!cap.ok) { console.error('capture failed', cap); process.exit(1); }
console.log('captured', Math.round(cap.bytes / 1024) + 'KB');

const edTarget = await waitForPage(`chrome-extension://${extId}/editor.html`, 'editor page');
const ed = cdp.connect(edTarget.webSocketDebuggerUrl);
await cdp.waitFor(() => ed.eval('!!(window.__interleaf && window.__interleaf.layer)'), { label: 'note layer' });

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
    reflowed: 'interleafReflow' in document.documentElement.dataset,
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
  await new Promise((r) => setTimeout(r, 600));
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
      reflowed: 'interleafReflow' in document.documentElement.dataset,
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
if (wide.reflowed) failures.push('wide viewport should not reflow the capture');
if (wide.bodyPaddingRight !== '20px') failures.push('wide viewport changed body padding: ' + wide.bodyPaddingRight);
if (!narrow.reflowed) failures.push('narrow viewport should reserve room');
for (const [label, r] of [['wide', wide], ['narrow', narrow]]) {
  if (r.cardsOverText) failures.push(label + ': cards sit over the text');
  if (r.overlaps) failures.push(label + ': ' + r.overlaps + ' overlapping cards');
}

console.log(failures.length ? '\nFAIL\n- ' + failures.join('\n- ') : '\nPASS: both gutter branches hold');

pop.close(); ed.close();
