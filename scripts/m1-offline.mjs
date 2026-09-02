// Opens the written snapshot over file:// with the origin server gone.
import * as cdp from './cdp.mjs';
import { fileURLToPath } from 'node:url';

const file = 'file://' + fileURLToPath(new URL('../test/out/snapshot.html', import.meta.url));
await cdp.newTab(file);
await new Promise((r) => setTimeout(r, 2000));

const t = (await cdp.targets()).find((x) => x.url.startsWith(file));
if (!t) throw new Error('snapshot tab did not open');
const c = cdp.connect(t.webSocketDebuggerUrl);

const out = JSON.parse(await c.eval(`JSON.stringify({
  h1: document.querySelector('h1')?.textContent?.trim() ?? null,
  bodyBg: getComputedStyle(document.body).backgroundColor,
  h1Font: getComputedStyle(document.querySelector('h1')).fontFamily,
  badgeBg: getComputedStyle(document.querySelector('.badge')).backgroundColor,
  imgLoaded: [...document.images].map(i => i.complete && i.naturalWidth > 0),
  imgNaturalSize: [...document.images].map(i => i.naturalWidth + 'x' + i.naturalHeight),
  networkishRefs: [...document.querySelectorAll('[src],[href]')]
    .map(e => e.getAttribute('src') || e.getAttribute('href'))
    .filter(v => v && /^https?:/.test(v)),
})`));
console.log(JSON.stringify(out, null, 2));
c.close();
