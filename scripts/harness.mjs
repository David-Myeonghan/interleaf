// Shared setup for the verification harnesses.
//
// Opening a popup page is how the harness reaches the extension's APIs, but a
// page left over from a previous restart has an invalidated chrome.runtime and
// silently never answers, which hangs the run. So stale extension pages are
// closed and a fresh one is opened and proven to respond before use.
import * as cdp from './cdp.mjs';
import { extensionId } from './ext-id.mjs';
import { ensureFresh } from './ensure-fresh.mjs';

const PORT = process.env.CDP_PORT || 9444;

// A harness that hangs must say where. Every step announces itself, so a stall
// is a visible last line rather than silence.
let stepStart = Date.now();
export function step(message) {
  const elapsed = Date.now() - stepStart;
  stepStart = Date.now();
  console.log(`[+${String(elapsed).padStart(5)}ms] ${message}`);
}

export async function closeTabs(predicate) {
  // Tolerates there being no browser yet: callers use this to tidy up before a
  // run, and on a fresh checkout there is nothing to tidy.
  let open;
  try {
    open = await cdp.targets();
  } catch {
    return;
  }
  for (const target of open.filter((t) => t.type === 'page' && predicate(t.url))) {
    await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {});
  }
}

export async function waitForPage(prefix, label) {
  return cdp.waitFor(
    async () => (await cdp.targets()).find((t) => t.type === 'page' && t.url.startsWith(prefix)),
    { label: label ?? prefix, timeout: 25000 },
  );
}

/**
 * Opens a url and does not return until the document is actually there.
 *
 * A tab created through /json/new can end up with its address set and nothing
 * loaded - Chrome leaves some background tabs unrendered, and chrome.tabs then
 * reports it as loading forever. The document is polled for real content and the
 * target reloaded if it stays empty.
 *
 * Page.navigate is deliberately not awaited, and never used on a target that
 * already carries the url: that call simply never resolved, which hung the
 * harness with no error at all.
 */
export async function openPage(url, label) {
  step(`open ${label ?? url}`);
  const created = await cdp.newTab(url);
  step('  tab created');
  // Brought to the front before anything is evaluated: Chrome throttles and can
  // freeze background tabs, and Runtime.evaluate against a frozen one never
  // replies. The launcher also disables backgrounding, and both are needed.
  await fetch(`http://127.0.0.1:${PORT}/json/activate/${created.id}`).catch(() => {});
  const target = await waitForPage(url, label);
  step('  target found');
  const page = cdp.connect(target.webSocketDebuggerUrl);

  const loaded = () => page
    .eval('document.readyState === "complete" && !!document.body && document.body.children.length > 0')
    .catch(() => false);

  for (const attempt of [0, 1, 2]) {
    try {
      await cdp.waitFor(loaded, { label: `${label ?? url} loaded`, timeout: 8000, interval: 300 });
      step(`  rendered (attempt ${attempt + 1})`);
      return page;
    } catch {
      if (attempt === 2) break;
      // Fire and forget: awaiting either call can hang on an unrendered target.
      page.send('Page.reload', { ignoreCache: true }).catch(() => {});
    }
  }
  throw new Error(`${label ?? url} never rendered`);
}

/** A popup page whose runtime answers, plus the extension id. */
export async function openExtension() {
  step('checking the extension is the build on disk');
  const fresh = await ensureFresh();
  step('  fresh');
  const extId = await extensionId();
  const popupUrl = `chrome-extension://${extId}/popup.html`;

  await closeTabs((url) => url.startsWith('chrome-extension://'));
  step('  stale extension pages closed');
  await cdp.newTab(popupUrl);
  const target = await waitForPage(popupUrl, 'popup page');
  step('  popup open');
  const popup = cdp.connect(target.webSocketDebuggerUrl);

  await cdp.waitFor(async () => {
    const build = await popup.eval(
      'chrome.runtime.sendMessage({ type: "build" }).then(r => r && r.build).catch(() => null)')
      .catch(() => null);
    return !!build;
  }, { label: 'extension responding', timeout: 20000 });
  step('  extension responding');

  return { extId, popup, fresh };
}

/** The tab id for a url, asked of the worker so a loading tab still resolves. */
export async function tabIdFor(popup, prefix) {
  return cdp.waitFor(async () => {
    const tabs = JSON.parse(await popup.eval(
      'chrome.runtime.sendMessage({ type: "tabs" }).then(r => JSON.stringify(r ?? []))'));
    return tabs.find((t) => t.url.startsWith(prefix))?.id;
  }, { label: `tab for ${prefix}`, timeout: 25000 });
}

/** Captures `prefix`'s tab and returns the editor page connection. */
export async function captureInto(popup, extId, prefix) {
  step('resolve the tab to capture');
  const tabId = await tabIdFor(popup, prefix);
  step(`  tab ${tabId}`);
  const result = JSON.parse(await popup.eval(
    `chrome.runtime.sendMessage({ type: 'capture', tabId: ${tabId} }).then(r => JSON.stringify(r))`));
  if (!result.ok) throw new Error('capture failed: ' + JSON.stringify(result));
  step(`  captured ${Math.round(result.bytes / 1024)}KB`);

  const editor = await waitForPage(`chrome-extension://${extId}/editor.html`, 'editor page');
  const page = cdp.connect(editor.webSocketDebuggerUrl);
  await cdp.waitFor(() => page.eval('!!(window.__interleaf && window.__interleaf.layer)'),
    { label: 'note layer', timeout: 20000 });
  step('  editor ready');
  return { page, result };
}
