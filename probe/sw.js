// Service worker. Probe 1b: can a stored handle be written to from the SW,
// with no extension UI open and no user gesture?
import { getHandle } from './idb.js';

async function writeFromServiceWorker(text) {
  const handle = await getHandle('probe-file');
  if (!handle) return { ok: false, stage: 'getHandle', error: 'no stored handle' };

  let perm;
  try {
    perm = await handle.queryPermission({ mode: 'readwrite' });
  } catch (e) {
    return { ok: false, stage: 'queryPermission', error: String(e) };
  }
  if (perm !== 'granted') {
    // Deliberately attempt it: we want the exact failure mode on record.
    try {
      perm = await handle.requestPermission({ mode: 'readwrite' });
    } catch (e) {
      return { ok: false, stage: 'requestPermission', error: String(e), permission: perm };
    }
    if (perm !== 'granted') {
      return { ok: false, stage: 'requestPermission', error: 'not granted', permission: perm };
    }
  }

  try {
    const w = await handle.createWritable();
    await w.write(text);
    await w.close();
    return { ok: true, stage: 'write', permission: perm };
  } catch (e) {
    return { ok: false, stage: 'createWritable/write', error: String(e), permission: perm };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type === 'sw:write') {
    writeFromServiceWorker(msg.text).then(reply);
    return true; // async reply
  }
  if (msg?.type === 'sw:ping') {
    reply({ ok: true, from: 'sw' });
    return false;
  }
  // Probe 3: relay from file:// content script
  if (msg?.type === 'bridge:hello') {
    reply({ ok: true, extensionPresent: true, url: msg.url });
    return false;
  }
  return false;
});

// Probe 4: inject the bundled single-file-core into a chosen tab and capture.
// Frames are removed because the frame-side scripts are not injected here; without
// that, getPageData waits on frame responses that never arrive.
const CAPTURE_OPTIONS = {
  removeHiddenElements: true,
  compressHTML: true,
  blockScripts: true,
  removeFrames: true,
  loadDeferredImages: false,
  removeUnusedStyles: true,
  removeUnusedFonts: true,
};

const CAPTURE_TIMEOUT_MS = 45000;

async function captureTab(tabId) {
  const t0 = Date.now();
  const record = async (r) => {
    const out = { ...r, elapsedMs: Date.now() - t0 };
    await chrome.storage.local.set({ p4: out });
    return out;
  };

  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (e) {
    return record({ ok: false, stage: 'tabs.get', error: String(e) });
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      files: ['sf-bundle.js'],
    });
  } catch (e) {
    return record({ ok: false, stage: 'inject', error: String(e), url: tab.url });
  }

  let result;
  try {
    [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      args: [CAPTURE_OPTIONS, CAPTURE_TIMEOUT_MS],
      func: async (options, timeoutMs) => {
        const started = Date.now();
        try {
          const data = await Promise.race([
            globalThis.SnapNoteCapture.getPageData(options, {}),
            new Promise((_, rej) =>
              setTimeout(() => rej(new Error('getPageData timed out after ' + timeoutMs + 'ms')), timeoutMs)),
          ]);
          return {
            ok: true,
            title: data.title,
            bytes: data.content.length,
            filename: data.filename,
            pageMs: Date.now() - started,
          };
        } catch (e) {
          return { ok: false, stage: 'getPageData', error: String(e), pageMs: Date.now() - started };
        }
      },
    });
  } catch (e) {
    return record({ ok: false, stage: 'executeScript(func)', error: String(e), url: tab.url });
  }

  return record({ ...result, url: tab.url });
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type === 'sw:capture') {
    captureTab(msg.tabId).then(reply).catch((e) => reply({ ok: false, error: String(e) }));
    return true;
  }
  if (msg?.type === 'sw:tabs') {
    chrome.tabs.query({}).then((tabs) =>
      reply(tabs
        .filter((t) => /^https?:/.test(t.url ?? ''))
        .map((t) => ({ id: t.id, title: t.title, url: t.url }))));
    return true;
  }
  return false;
});


// Collect every probe result in one place so it can be exported as a file.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type === 'bridge:report') {
    chrome.storage.local.set({ fixture: { ...msg.payload, _reportedFrom: msg.url } }).then(() => reply({ ok: true }));
    return true;
  }
  if (msg?.type === 'store') {
    chrome.storage.local.set({ [msg.key]: msg.value }).then(() => reply({ ok: true }));
    return true;
  }
  return false;
});
