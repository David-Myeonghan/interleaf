// Captures the four store screenshots at 1280x800 from a real page.
//
// The subject is Wikipedia's article on marginalia, which is what the extension
// is named after, so the listing shows the tool doing the thing it describes.
import * as cdp from './cdp.mjs';
import { openExtension, captureInto, closeTabs, openPage } from './harness.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SUBJECT = 'https://en.wikipedia.org/wiki/Marginalia';
const OUT = fileURLToPath(new URL('../docs/screenshots/', import.meta.url));
const SIZE = { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false };

const NOTES = [
  { find: 'marginalia', body: '이 글 자체가 이 도구의 이름이다. 읽으면서 옆에 적는 관행.' },
  { find: 'annotation', body: '주석과 메모의 차이 — 나중에 다시 찾아볼 것.' },
  { find: 'reader', body: '읽는 사람이 남긴 흔적이 원문만큼 읽힌다는 얘기.' },
];

async function shoot(page, name) {
  await page.send('Page.enable');
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, name);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  console.log('wrote', path.basename(file));
}

await closeTabs(() => true);
const { extId, popup } = await openExtension();
const subject = await openPage(SUBJECT, 'subject page');

// Collapsed on the live page, before capture: a capture is taken with the
// page's scripts blocked, so its own controls are inert afterwards. This is
// the article as a reader would have it - one centred column - which leaves
// the margin the cards are meant to sit in.
await subject.send('Emulation.setDeviceMetricsOverride', SIZE);
await cdp.waitFor(() => subject.eval('Math.abs(document.documentElement.clientWidth - 1280) < 40'),
  { label: 'subject viewport' });
const collapsed = await subject.eval(`(() => {
  let clicked = 0;
  for (const el of document.querySelectorAll('button, a')) {
    if ((el.textContent || '').trim().toLowerCase() === 'hide' && el.offsetParent) { el.click(); clicked++; }
  }
  return clicked;
})()`);
console.log('sidebars collapsed:', collapsed);
await new Promise((r) => setTimeout(r, 900));

const { page: ed } = await captureInto(popup, extId, SUBJECT);
await ed.send('Emulation.setDeviceMetricsOverride', SIZE);
await cdp.waitFor(() => ed.eval('Math.abs(document.documentElement.clientWidth - 1280) < 40'),
  { label: 'viewport' });

// Notes on real sentences, so the shot shows the layout it will actually meet.
const planted = await ed.eval(`(() => {
  const layer = window.__interleaf.layer;
  const wanted = ${JSON.stringify(NOTES)};
  const made = [];
  const paragraphs = [...document.querySelectorAll('p')].filter(p => (p.textContent || '').length > 120);

  for (const note of wanted) {
    const host = paragraphs.find((p) => {
      const text = p.firstChild && p.firstChild.data;
      return text && text.toLowerCase().includes(note.find) && !p.querySelector('il-mark');
    });
    if (!host) continue;
    const text = host.firstChild;
    const at = text.data.toLowerCase().indexOf(note.find);
    const range = document.createRange();
    range.setStart(text, at);
    range.setEnd(text, Math.min(at + note.find.length + 24, text.data.length));
    const id = layer.create(range);
    if (!id) continue;
    const body = layer.notes.get(id).card.querySelector('.il-card__body');
    body.value = note.body;
    body.dispatchEvent(new Event('input', { bubbles: true }));
    made.push(note.find);
  }
  window.scrollTo(0, Math.max(0, (document.querySelector('il-mark')?.getBoundingClientRect().top ?? 0) + scrollY - 180));
  return JSON.stringify({ made, total: layer.notes.size });
})()`);
console.log('planted:', planted);
await ed.eval('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');

// 1. notes in the margin, leader line on the active one
await ed.eval(`(() => {
  const layer = window.__interleaf.layer;
  // Focus the note whose highlight is actually on screen, so the leader line
  // between the line and its card is part of the picture.
  const onScreen = [...layer.notes.keys()].find((id) => {
    const mark = document.querySelector('il-mark[data-note-id="' + id + '"]');
    if (!mark) return false;
    const box = mark.getBoundingClientRect();
    return box.top > 80 && box.bottom < innerHeight - 80;
  });
  layer.focus(onScreen ?? [...layer.notes.keys()][0]);
  return onScreen ?? null;
})()`);
await new Promise((r) => setTimeout(r, 500));
await shoot(ed, '1-notes-in-margin.png');

// 2. the first-save panel, checkbox and all
await ed.eval(`document.getElementById('interleaf-save').click()`);
await new Promise((r) => setTimeout(r, 500));
await shoot(ed, '2-first-save-panel.png');
await ed.eval(`document.getElementById('interleaf-cancel')?.click()`);
await new Promise((r) => setTimeout(r, 300));

// 3. notes hidden, showing the capture itself is untouched
await ed.eval(`document.getElementById('interleaf-toggle').click()`);
await new Promise((r) => setTimeout(r, 500));
await shoot(ed, '3-notes-hidden.png');
await ed.eval(`document.getElementById('interleaf-toggle').click()`);
await new Promise((r) => setTimeout(r, 400));

// 4. the saved file reopened from disk, with no extension involved
const html = await ed.eval('window.__interleaf.buildDocument()');
const saved = path.join(OUT, 'sample-saved-page.html');
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(saved, html);
const opened = await openPage('file://' + saved, 'saved file');
await opened.send('Emulation.setDeviceMetricsOverride', SIZE);
await cdp.waitFor(() => opened.eval('!!(window.__interleaf && window.__interleaf.layer)'),
  { label: 'viewer boot' });
await opened.eval('window.__interleaf.layer.focus([...window.__interleaf.layer.notes.keys()][1])');
await new Promise((r) => setTimeout(r, 600));
await shoot(opened, '4-reopened-from-disk.png');

console.log('\nnotes restored in the saved file:',
  await opened.eval('window.__interleaf.layer.notes.size'));
process.exit(0);
