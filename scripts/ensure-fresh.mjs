// Refuses to verify against stale extension bytes.
//
// Two things make this necessary, both learned the hard way. Chrome keeps a
// registered MV3 service worker, so an edited sw.js goes on running as the bytes
// it had at browser start; chrome.runtime.reload() did not dislodge it. And
// launching into a profile another instance already holds does not start a new
// browser at all - it opens a window in the old one. A capture ran against code
// from an hour earlier for several commits before this was noticed.
//
// The stamp is imported by the worker rather than fetched, because a fetched
// stamp comes off disk and reports the newest build even when the running worker
// is old.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as cdp from './cdp.mjs';
import { extensionId } from './ext-id.mjs';

const DISK = fileURLToPath(new URL('../extension/build-stamp.json', import.meta.url));
const LAUNCH = fileURLToPath(new URL('./dev-chrome.sh', import.meta.url));
const PROFILE = fileURLToPath(new URL('../.dev-profile', import.meta.url));

/** Asks the running worker what build it is, via a popup page. */
async function reportedBuild() {
  const extId = await extensionId();
  await cdp.newTab(`chrome-extension://${extId}/popup.html`);
  const target = await cdp.waitFor(
    async () => (await cdp.targets()).find((t) => t.type === 'page' && t.url.endsWith('/popup.html')),
    { label: 'popup page', timeout: 15000 },
  );
  const page = cdp.connect(target.webSocketDebuggerUrl);
  try {
    return await cdp.waitFor(async () => {
      const build = await page.eval(
        'chrome.runtime.sendMessage({ type: "build" }).then(r => r && r.build).catch(() => null)');
      return build ?? false;
    }, { label: 'worker build', timeout: 15000 });
  } finally {
    page.close();
  }
}

async function launch({ wipe }) {
  if (wipe) fs.rmSync(PROFILE, { recursive: true, force: true });
  execFileSync('bash', [LAUNCH], { stdio: 'inherit' });
  await cdp.waitFor(async () => {
    try {
      await cdp.version();
      return true;
    } catch {
      return false;
    }
  }, { label: 'browser up', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2000));
}

export async function ensureFresh() {
  const wanted = JSON.parse(fs.readFileSync(DISK, 'utf8')).builtAt;

  // Restart first, then wipe the profile. Only the wipe reliably replaces a
  // registered worker, but it also drops granted permissions, so it is second.
  for (const step of ['ask', 'restart', 'wipe']) {
    if (step !== 'ask') await launch({ wipe: step === 'wipe' });
    const running = await reportedBuild().catch(() => null);
    if (running === wanted) return { fresh: true, build: wanted, via: step };
  }

  const running = await reportedBuild().catch(() => null);
  throw new Error(`extension is stale: worker reports ${running}, disk has ${wanted}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(await ensureFresh());
  process.exit(0);
}
