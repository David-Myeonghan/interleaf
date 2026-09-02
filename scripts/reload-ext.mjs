// Forces the extension to re-read its files.
//
// A browser restart is not enough: Chrome keeps the registered MV3 service
// worker, so an edited sw.js goes on running as the old bytes. A capture ran
// against stale code for several commits before this was noticed, which makes
// this a required step of every verification, not a convenience.
import * as cdp from './cdp.mjs';
import { extensionId } from './ext-id.mjs';

export async function reloadExtension() {
  const extId = await extensionId();
  const before = extId;

  await cdp.newTab(`chrome-extension://${extId}/popup.html`);
  const target = await cdp.waitFor(
    async () => (await cdp.targets()).find((t) => t.type === 'page' && t.url.endsWith('/popup.html')),
    { label: 'popup page' },
  );
  const page = cdp.connect(target.webSocketDebuggerUrl);

  // The call tears down this page, so it cannot be awaited for a reply.
  page.send('Runtime.evaluate', { expression: 'chrome.runtime.reload()' }).catch(() => {});
  page.close();

  // Wait until a popup page can be opened and evaluated again.
  await new Promise((r) => setTimeout(r, 1200));
  await cdp.waitFor(async () => {
    const t = (await cdp.targets()).find((x) => x.type === 'page' && x.url.endsWith('/popup.html'));
    if (!t) {
      await cdp.newTab(`chrome-extension://${extId}/popup.html`);
      return false;
    }
    const c = cdp.connect(t.webSocketDebuggerUrl);
    try {
      return (await c.eval('typeof chrome.runtime.id')) === 'string';
    } catch {
      return false;
    } finally {
      c.close();
    }
  }, { label: 'extension back up', timeout: 20000 });

  return before;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const id = await reloadExtension();
  console.log('reloaded', id);
  process.exit(0);
}
