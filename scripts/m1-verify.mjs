// Drives the loaded extension end to end: capture the fixture page, confirm the
// editor tab renders it, and write the snapshot out for an offline check.
import * as cdp from './cdp.mjs';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const FIXTURE = 'http://127.0.0.1:8777/index.html';
const OUT = fileURLToPath(new URL('../test/out/snapshot.html', import.meta.url));

// The service worker is dormant most of the time, so the id comes from the
// profile's own extension registry rather than from a live CDP target.
const EXT_DIR = fileURLToPath(new URL('../extension', import.meta.url));
const prefsPath = fileURLToPath(new URL('../.dev-profile/Default/Secure Preferences', import.meta.url));
const settings = JSON.parse(fs.readFileSync(prefsPath, 'utf8')).extensions?.settings ?? {};
const extId = Object.entries(settings).find(([, v]) => v.path === EXT_DIR)?.[0];
if (!extId) throw new Error('extension not registered in dev profile: ' + EXT_DIR);
console.log('extension id:', extId);

// 1. open the fixture page
const fixture = await cdp.newTab(FIXTURE);
await new Promise((r) => setTimeout(r, 1500));
const fixtureTarget = (await cdp.targets()).find((t) => t.url.startsWith(FIXTURE));
const fx = cdp.connect(fixtureTarget.webSocketDebuggerUrl);
const fxTabId = await fx.eval('1'); // force the connection open
console.log('fixture open:', fixtureTarget.url);

// 2. drive the capture from an extension page (popup.html works as a tab)
await cdp.newTab(`chrome-extension://${extId}/popup.html`);
await new Promise((r) => setTimeout(r, 1200));
const popupTarget = (await cdp.targets()).find((t) => t.url.endsWith('/popup.html'));
const pop = cdp.connect(popupTarget.webSocketDebuggerUrl);

const tabs = await pop.eval(`chrome.tabs.query({}).then(ts => JSON.stringify(
  ts.filter(t => t.url && t.url.startsWith('${FIXTURE}')).map(t => t.id)))`);
const targetTabId = JSON.parse(tabs)[0];
console.log('target tabId:', targetTabId);

const captureRes = JSON.parse(await pop.eval(
  `chrome.runtime.sendMessage({ type: 'capture', tabId: ${targetTabId} }).then(r => JSON.stringify(r))`));
console.log('capture result:', captureRes);
if (!captureRes.ok) process.exit(1);

// 3. inspect the editor tab that the service worker opened
await new Promise((r) => setTimeout(r, 2000));
const editorTarget = (await cdp.targets()).find((t) => t.url.includes('/editor.html'));
if (!editorTarget) throw new Error('editor tab was not opened');
const ed = cdp.connect(editorTarget.webSocketDebuggerUrl);

const rendered = JSON.parse(await ed.eval(`JSON.stringify({
  title: document.title,
  h1: document.querySelector('h1')?.textContent?.trim() ?? null,
  toolbar: !!document.getElementById('interleaf-bar'),
  imgCount: document.images.length,
  imgSrcIsInline: [...document.images].map(i => i.currentSrc.slice(0, 12)),
  imgLoaded: [...document.images].map(i => i.complete && i.naturalWidth > 0),
  styleSheetCount: document.styleSheets.length,
  bodyBg: getComputedStyle(document.body).backgroundColor,
  externalRefs: [...document.querySelectorAll('[src],[href]')]
    .map(e => e.getAttribute('src') || e.getAttribute('href'))
    .filter(v => v && /^https?:/.test(v)),
})`));
console.log('editor render:', JSON.stringify(rendered, null, 2));

// 4. persist the snapshot so it can be opened with the server down
const html = await ed.eval(`(async () => {
  const p = new URLSearchParams(location.search);
  const s = await chrome.storage.session.get(p.get('id'));
  return s[p.get('id')].html;
})()`);
fs.mkdirSync(fileURLToPath(new URL('../test/out/', import.meta.url)), { recursive: true });
fs.writeFileSync(OUT, html);
console.log('snapshot written:', OUT, html.length, 'bytes');

fx.close(); pop.close(); ed.close();
