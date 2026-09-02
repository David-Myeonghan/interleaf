// What can be checked without a human: the save controller's states, the panel's
// wiring, coalescing, and that opening a file writes nothing. The OS pickers are
// native windows CDP cannot drive, so choosing a target stays hand-driven and is
// covered by scripts/m4-manual.md.
import * as cdp from './cdp.mjs';
import { openExtension, captureInto, closeTabs, waitForPage, openPage, tabIdFor } from './harness.mjs';
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
const { extId, popup, fresh: freshness } = await openExtension();
console.log('freshness:', freshness);

const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

const fixturePage = await openPage(FIXTURE, 'fixture');

const { page: ed, result: cap } = await captureInto(popup, extId, FIXTURE);
console.log('captured', Math.round(cap.bytes / 1024) + 'KB');


// A fresh capture with nothing remembered has no target and must not invent one.
const fresh = JSON.parse(await ed.eval('JSON.stringify(window.__interleaf.saver.status())'));
console.log('fresh capture:', fresh);
check(fresh.state === 'unset', `a fresh capture should have no target, got ${fresh.state}`);
check(fresh.fileName === null, `a fresh capture should name no file, got ${fresh.fileName}`);

// Typing must not schedule a write while there is nowhere to write.
const scheduled = JSON.parse(await ed.eval(`(() => {
  const { layer, saver } = window.__interleaf;
  const p = document.getElementById('p1');
  const text = p.firstChild;
  const at = text.data.indexOf('Anchor phrase number 1');
  const r = document.createRange();
  r.setStart(text, at); r.setEnd(text, at + 22);
  layer.create(r);
  const entry = [...layer.notes.values()][0];
  const body = entry.card.querySelector('.il-card__body');
  body.value = 'typed';
  body.dispatchEvent(new Event('input', { bubbles: true }));
  return JSON.stringify({ timerSet: saver.timer !== null, state: saver.state });
})()`));
console.log('after typing with no target:', scheduled);
check(!scheduled.timerSet, 'typing scheduled a write although no target was chosen');

// The panel must appear, carry the checkbox on by default, and be dismissible.
const panel = JSON.parse(await ed.eval(`(async () => {
  document.getElementById('interleaf-save').click();
  await new Promise(r => setTimeout(r, 200));
  const box = document.getElementById('interleaf-panel');
  const remember = document.getElementById('interleaf-remember');
  const out = { shown: !!box, rememberChecked: !!remember?.checked };
  document.getElementById('interleaf-cancel')?.click();
  await new Promise(r => setTimeout(r, 200));
  out.dismissed = !document.getElementById('interleaf-panel');
  return JSON.stringify(out);
})()`));
console.log('first-save panel:', panel);
check(panel.shown, 'the first-save panel did not appear');
check(panel.rememberChecked, 'remember-the-folder should default to on');
check(panel.dismissed, 'the panel did not close on cancel');

// Cancelling must still hand over the notes rather than dropping them.
const rescued = JSON.parse(await ed.eval(`(() => {
  const seen = [];
  const original = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.download) seen.push(this.download); };
  const downloads = [];
  const realDownload = chrome.downloads.download;
  chrome.downloads.download = (options) => { downloads.push(options.filename); return Promise.resolve(1); };
  return document.getElementById('interleaf-save').click(), new Promise(r => setTimeout(r, 300)).then(async () => {
    document.getElementById('interleaf-cancel').click();
    await new Promise(r => setTimeout(r, 400));
    HTMLAnchorElement.prototype.click = original;
    chrome.downloads.download = realDownload;
    return JSON.stringify({ anchorDownloads: seen, apiDownloads: downloads });
  });
})()`));
console.log('cancelling the panel:', rescued);
check(rescued.apiDownloads.length + rescued.anchorDownloads.length > 0,
  'cancelling the panel left the notes with nowhere to go');

// Writes must coalesce: a burst of edits is one queued write, not one each.
const coalesced = JSON.parse(await ed.eval(`(async () => {
  const { saver } = window.__interleaf;
  const writes = [];
  saver.fileHandle = {
    name: 'stub.html',
    queryPermission: async () => 'granted',
    createWritable: async () => ({
      write: async (html) => { writes.push(html.length); },
      close: async () => {},
    }),
  };
  saver.set('ready');
  for (let i = 0; i < 5; i++) saver.schedule(20);
  await new Promise(r => setTimeout(r, 500));
  const first = writes.length;
  await Promise.all([saver.saveNow(), saver.saveNow(), saver.saveNow()]);
  await new Promise(r => setTimeout(r, 400));
  return JSON.stringify({ afterBurst: first, afterConcurrent: writes.length, state: saver.state });
})()`));
console.log('coalescing:', coalesced);
check(coalesced.afterBurst === 1, `a burst of 5 edits produced ${coalesced.afterBurst} writes, expected 1`);
check(coalesced.afterConcurrent <= coalesced.afterBurst + 2,
  `three concurrent saves produced ${coalesced.afterConcurrent - coalesced.afterBurst} writes`);
check(coalesced.state === 'saved', `state after writing should be saved, got ${coalesced.state}`);

// Opening a saved file must write nothing: the disk already matches the view.
const saved = path.join(OUT_DIR, 'm4-open.html');
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(saved, await ed.eval('window.__interleaf.buildDocument()'));
const before = fs.statSync(saved).mtimeMs;

const url = 'file://' + saved;
const opened = await openPage(url, 'saved file');
await cdp.waitFor(() => opened.eval('!!(window.__interleaf && window.__interleaf.saver)'),
  { label: 'file saver', timeout: 20000 });
await new Promise((r) => setTimeout(r, 1500));

const onOpen = JSON.parse(await opened.eval('JSON.stringify(window.__interleaf.saver.status())'));
console.log('\nsaved file on open:', onOpen);
check(fs.statSync(saved).mtimeMs === before, 'opening the file rewrote it');
check(onOpen.state === 'unset' || onOpen.state === 'needs-permission' || onOpen.state === 'ready',
  `unexpected state on open: ${onOpen.state}`);

const fileUi = JSON.parse(await opened.eval(`JSON.stringify({
  saveLabel: document.getElementById('interleaf-save').textContent,
  changeHidden: document.getElementById('interleaf-change').hidden,
  forgetHidden: document.getElementById('interleaf-forget').hidden,
  status: document.getElementById('interleaf-status').textContent,
  target: document.getElementById('interleaf-target').textContent,
  hasChromeApi: typeof chrome !== 'undefined' && !!chrome.runtime,
})`));
console.log('saved file toolbar:', fileUi);
check(!fileUi.hasChromeApi, 'the saved file reached a chrome API');
check(fileUi.saveLabel.includes('저장'), `unexpected save button label: ${fileUi.saveLabel}`);
if (!onOpen.fileName && !onOpen.remembersFolder) {
  check(fileUi.changeHidden && fileUi.forgetHidden, 'location controls shown with no destination known');
}
// The path may be shown as a hint read from the document even before a handle
// is usable; that is display, not a claim that a destination exists.
check(typeof fileUi.target === 'string', 'the toolbar should always render a target line');

// A folder holds other files. A name collision must never overwrite a stranger.
// The dir handle is stubbed because showDirectoryPicker is a native window.
const collision = JSON.parse(await ed.eval(`(async () => {
  const { saver } = window.__interleaf;

  const files = new Map();
  const makeFile = (name, body) => ({
    name,
    getFile: async () => ({
      size: body.length,
      slice: (from) => ({ text: async () => body.slice(from) }),
      text: async () => body,
    }),
    createWritable: async () => ({
      write: async (html) => { files.set(name, { ...files.get(name), body: html, writes: (files.get(name).writes ?? 0) + 1 }); },
      close: async () => {},
    }),
    queryPermission: async () => 'granted',
  });

  const seed = (name, body) => files.set(name, { body, handle: null, writes: 0 });
  seed('taken.html', 'a file the user put there, nothing to do with us');
  seed('ours.html', JSON.stringify({ version: 1, docId: 'DOC-OURS', notes: [] }));

  const dir = {
    name: 'stub-folder',
    queryPermission: async () => 'granted',
    getFileHandle: async (name, options) => {
      if (!files.has(name)) {
        if (!options?.create) { const e = new Error('nope'); e.name = 'NotFoundError'; throw e; }
        seed(name, '');
      }
      const entry = files.get(name);
      if (!entry.handle) entry.handle = makeFile(name, entry.body);
      return entry.handle;
    },
  };

  const results = {};

  // 1. A stranger of the same name: step around it, do not touch it.
  saver.fileHandle = null; saver.dirHandle = dir; saver.pending = null;
  await saver.adoptInFolder('taken.html', { docId: 'DOC-NEW' });
  results.strangerTargetName = saver.fileHandle?.name ?? null;
  await saver.saveNow();
  results.strangerUntouched = files.get('taken.html').writes === 0;
  results.strangerBody = files.get('taken.html').body.slice(0, 20);

  // 2. Our own file of that name: adopt it, write in place.
  saver.fileHandle = null; saver.pending = null;
  await saver.adoptInFolder('ours.html', { docId: 'DOC-OURS' });
  results.ownTargetName = saver.fileHandle?.name ?? null;

  // 3. Looking for our own file when the name holds a stranger: do not adopt.
  saver.fileHandle = null; saver.pending = null;
  const strict = await saver.adoptInFolder('taken.html', { docId: 'DOC-OURS', create: false });
  results.strictState = strict.state;
  results.strictTargetName = saver.fileHandle?.name ?? null;

  return JSON.stringify(results);
})()`));
console.log('\nname collision in a remembered folder:', collision);
check(collision.strangerTargetName === 'taken (2).html',
  `a name collision should step aside to "taken (2).html", got ${collision.strangerTargetName}`);
check(collision.strangerUntouched, 'a stranger file of the same name was written to');
check(collision.ownTargetName === 'ours.html',
  `our own file should be adopted in place, got ${collision.ownTargetName}`);
check(collision.strictState === 'unset',
  `looking for our own file must not settle on a stranger, got ${collision.strictState}`);
check(collision.strictTargetName === null,
  `a stranger was adopted as our own file: ${collision.strictTargetName}`);

// Picking a folder from a reopened file must adopt that same file, not create
// "name (2).html" beside the document on screen.
const reopened = JSON.parse(await ed.eval(`(async () => {
  const { saver } = window.__interleaf;
  const files = new Map();
  const body = JSON.stringify({ version: 1, docId: 'DOC-SELF', notes: [] });
  const make = (name, text) => ({
    name,
    getFile: async () => ({ size: text.length, slice: (from) => ({ text: async () => text.slice(from) }), text: async () => text }),
    createWritable: async () => ({ write: async () => {}, close: async () => {} }),
    queryPermission: async () => 'granted',
  });
  files.set('self.html', make('self.html', body));

  const dir = {
    name: 'stub-folder',
    queryPermission: async () => 'granted',
    getFileHandle: async (name, options) => {
      if (!files.has(name)) {
        if (!options?.create) { const e = new Error('nope'); e.name = 'NotFoundError'; throw e; }
        files.set(name, make(name, ''));
      }
      return files.get(name);
    },
  };

  // Stand in for showDirectoryPicker, which is a native window.
  const realPicker = window.showDirectoryPicker;
  window.showDirectoryPicker = async () => dir;
  saver.fileHandle = null; saver.dirHandle = null; saver.pending = null;
  saver.docId = 'DOC-SELF';
  saver.ownName = 'self.html';
  try {
    await saver.chooseTarget({ rememberFolder: true });
  } finally {
    window.showDirectoryPicker = realPicker;
  }
  return JSON.stringify({ target: saver.fileHandle?.name ?? null, state: saver.state });
})()`));
console.log('\nreopened file picks its own file:', reopened);
check(reopened.target === 'self.html',
  `picking a folder from a reopened file should adopt self.html, got ${reopened.target}`);
check(reopened.state === 'ready', `expected ready after adopting, got ${reopened.state}`);

// A page forbidding base-uri cannot be captured at all. The refusal has to
// arrive as a named reason the popup can put into words, not as a crash.
const NO_BASE = FIXTURE.replace(/[^/]+$/, 'no-base.html');
await openPage(NO_BASE, 'base-uri fixture');
const refusedTabId = await tabIdFor(popup, NO_BASE);
const refused = JSON.parse(await popup.eval(
  `chrome.runtime.sendMessage({ type: 'capture', tabId: ${refusedTabId} }).then(r => JSON.stringify(r))`));
console.log('\npage forbidding base-uri:', refused);
check(refused.ok === false, 'a page forbidding base-uri should not report success');
check(refused.reason === 'base-uri-blocked',
  `expected reason base-uri-blocked, got ${refused.reason}`);

console.log(failures.length ? '\nFAIL\n- ' + failures.join('\n- ') : '\nPASS: save states, panel, coalescing, no write on open, no clobbering neighbours');
popup.close(); ed.close(); opened.close();
process.exit(failures.length ? 1 : 0);
