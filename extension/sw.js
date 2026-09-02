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

async function capture(tabId) {
  const tab = await chrome.tabs.get(tabId);

  await chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    files: ['sf-bundle.js'],
  });

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [CAPTURE_OPTIONS, CAPTURE_TIMEOUT_MS],
    func: async (options, timeoutMs) => {
      const data = await Promise.race([
        globalThis.__interleafCapture.getPageData(options, {}),
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
  if (msg?.type === 'capture') {
    captureAndOpenEditor(msg.tabId)
      .then(reply)
      .catch((e) => reply({ ok: false, error: String(e?.message ?? e) }));
    return true;
  }
  return false;
});
