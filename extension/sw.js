import { BUILD } from './build-stamp.js';

// Reported so the harness can tell what bytes are actually running. Chrome keeps
// a registered service worker across restarts, and reading the file off disk
// cannot see that: the file is new while the worker is old.
globalThis.__interleafBuild = BUILD;

// Capture orchestration. The service worker owns capture because it outlives the
// popup, which closes the moment it loses focus.

// Frames are removed: the frame-side single-file scripts are not injected, and
// without this getPageData waits on frame replies that never arrive.
const CAPTURE_OPTIONS = {
  removeHiddenElements: true,
  removeUnusedStyles: true,
  removeUnusedFonts: true,
  compressHTML: true,
  blockScripts: true,
  removeFrames: true,
  loadDeferredImages: false,
};

const CAPTURE_TIMEOUT_MS = 60000;

function slug(text, fallback) {
  const base = (text ?? '').replace(/[\/\\?%*:|"<>\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim();
  return (base || fallback).slice(0, 80);
}

/** Resolves once the tab has finished loading, so the capture sees a whole page. */
async function whenComplete(tabId, timeoutMs = 30000) {
  const started = Date.now();
  for (;;) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') return tab;
    if (Date.now() - started > timeoutMs) return tab;
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function capture(tabId) {
  const tab = await whenComplete(tabId);

  await chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    files: ['sf-bundle.js'],
  });

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [CAPTURE_OPTIONS, CAPTURE_TIMEOUT_MS],
    func: async (options, timeoutMs) => {
      const data = await Promise.race([
        // The page's own address must be passed in: without it the engine sets a
        // base URI ending in "undefined" and every relative link in the capture
        // resolves against the wrong place.
        globalThis.__interleafCapture.getPageData({ ...options, url: location.href }, {}),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('capture timed out after ' + timeoutMs + 'ms')), timeoutMs)),
      ]);
      return { content: data.content, title: data.title };
    },
  });

  if (!result?.content) throw new Error('capture returned no content');
  return { html: result.content, title: result.title || tab.title, url: tab.url };
}

async function captureAndOpenEditor(tabId) {
  const snapshot = await capture(tabId);
  const id = 'snap-' + Date.now().toString(36);
  await chrome.storage.session.set({
    [id]: {
      ...snapshot,
      // Stamped once, carried in every saved copy. It is how a file is
      // recognised as this same document rather than one that merely shares a
      // title, which is what keeps a remembered folder from clobbering a
      // neighbour of the same name.
      docId: crypto.randomUUID(),
      capturedAt: new Date().toISOString(),
      name: slug(snapshot.title, 'page'),
    },
  });
  const editor = await chrome.tabs.create({ url: chrome.runtime.getURL(`editor.html?id=${id}`) });
  return { ok: true, id, bytes: snapshot.html.length, title: snapshot.title, editorTabId: editor.id };
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === 'build') {
    reply({ build: BUILD });
    return false;
  }
  // Tab urls read from a page can come back empty until host access is granted
  // for the site; the worker's own query is not so limited. The harness asks it
  // rather than guessing, which is also how a person's click resolves the tab.
  if (msg?.type === 'tabs') {
    chrome.tabs.query({}).then((tabs) => reply(
      tabs
        .map((t) => ({ id: t.id, url: t.url || t.pendingUrl || '', title: t.title, status: t.status }))
        // file:// included: the harness serves its fixture from disk because
        // macOS withholds local-network access from this browser binary.
        .filter((t) => /^(https?|file):/.test(t.url))));
    return true;
  }
  if (msg?.type === 'capture') {
    captureAndOpenEditor(msg.tabId)
      .then(reply)
      .catch((e) => reply({ ok: false, error: String(e?.message ?? e) }));
    return true;
  }
  return false;
});
