import * as cdp from './cdp.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.join(os.homedir(), 'person/snapnote');
const PROBE_DIR = path.join(ROOT, 'probe');
const SECURE = path.join(ROOT, 'm0/chrome-profile/Default/Secure Preferences');

function findExtension() {
  const d = JSON.parse(fs.readFileSync(SECURE, 'utf8'));
  const settings = d.extensions?.settings ?? {};
  for (const [id, v] of Object.entries(settings)) {
    if (v.path === PROBE_DIR) {
      return { id, allowFileAccess: v.allowFileAccess ?? v.newAllowFileAccess ?? null, state: v.state };
    }
  }
  return null;
}

const ext = findExtension();
if (!ext) {
  console.log(JSON.stringify({ loaded: false, hint: 'Load Unpacked not done yet (no settings entry matching probe dir)' }, null, 2));
  process.exit(2);
}
console.log(JSON.stringify({ loaded: true, ...ext }, null, 2));

// Open the probe page and the file:// fixture, then read what they report.
const probeUrl = `chrome-extension://${ext.id}/probe.html`;
const fixtureUrl = 'file://' + path.join(PROBE_DIR, 'fixtures/local-page.html');

async function tabFor(url, { open = true } = {}) {
  let t = (await cdp.targets()).find((x) => x.type === 'page' && x.url.startsWith(url));
  if (!t && open) { await cdp.newTab(url); await new Promise((r) => setTimeout(r, 1500)); }
  t = (await cdp.targets()).find((x) => x.type === 'page' && x.url.startsWith(url));
  return t;
}

const which = process.argv[2] ?? 'all';

if (which === 'all' || which === 'fixture') {
  const t = await tabFor(fixtureUrl);
  if (!t) console.log('fixture tab not available');
  else {
    const c = cdp.connect(t.webSocketDebuggerUrl);
    await new Promise((r) => setTimeout(r, 2500));
    const res = await c.eval('JSON.stringify(window.__PROBE_FILE ?? null)');
    console.log('\n=== file:// fixture (P0/P2/P3) ===\n' + (res ?? 'null'));
    c.close();
  }
}

if (which === 'all' || which === 'probe') {
  const t = await tabFor(probeUrl);
  if (!t) console.log('probe tab not available');
  else {
    const c = cdp.connect(t.webSocketDebuggerUrl);
    const res = await c.eval('JSON.stringify(window.__PROBE ?? null)');
    console.log('\n=== extension page (P1/P1a/P1b/P1c/P5/P1r) ===\n' + (res ?? 'null'));
    c.close();
  }
}

if (which === 'all' || which === 'p4') {
  // P4 result is stashed in chrome.storage.local by the popup; read it from the probe page.
  const t = await tabFor(probeUrl);
  if (t) {
    const c = cdp.connect(t.webSocketDebuggerUrl);
    const res = await c.eval('chrome.storage.local.get("p4").then(o => JSON.stringify(o.p4 ?? null))');
    console.log('\n=== capture (P4) ===\n' + (res ?? 'null'));
    c.close();
  }
}
