import { putHandle, getHandle } from './idb.js';

window.__PROBE = {};

function report(id, result) {
  window.__PROBE[id] = result;
  const el = document.getElementById('out-' + id);
  el.className = result.ok ? 'ok' : 'bad';
  el.textContent = JSON.stringify(result, null, 2);
  console.log('[PROBE]', id, result);
  chrome.storage.local.set({ [id]: result });
}

async function writeVia(handle, text) {
  const w = await handle.createWritable();
  await w.write(text);
  await w.close();
}

document.getElementById('p1').onclick = async () => {
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: 'scratch.html',
      types: [{ description: 'HTML', accept: { 'text/html': ['.html'] } }],
    });
    await writeVia(handle, '<!-- P1 initial write ' + new Date().toISOString() + ' -->');
    await putHandle('probe-file', handle);
    report('p1', { ok: true, name: handle.name, kind: handle.kind, storedInIDB: true });
  } catch (e) {
    report('p1', { ok: false, error: String(e) });
  }
};

document.getElementById('p1a').onclick = async () => {
  try {
    const handle = await getHandle('probe-file');
    if (!handle) return report('p1a', { ok: false, error: 'no stored handle - run P1 first' });
    const before = await handle.queryPermission({ mode: 'readwrite' });
    await writeVia(handle, '<!-- P1a page write ' + new Date().toISOString() + ' -->');
    report('p1a', { ok: true, permissionBeforeWrite: before, name: handle.name });
  } catch (e) {
    report('p1a', { ok: false, error: String(e) });
  }
};

document.getElementById('p1b').onclick = async () => {
  try {
    const res = await chrome.runtime.sendMessage({
      type: 'sw:write',
      text: '<!-- P1b service-worker write ' + new Date().toISOString() + ' -->',
    });
    report('p1b', res ?? { ok: false, error: 'no reply from service worker' });
  } catch (e) {
    report('p1b', { ok: false, error: String(e) });
  }
};

document.getElementById('p1c').onclick = async () => {
  // Writes fired from timers: no user activation is attached to these tasks.
  const results = [];
  for (let i = 1; i <= 3; i++) {
    await new Promise((r) => setTimeout(r, 1200));
    try {
      const handle = await getHandle('probe-file');
      const perm = await handle.queryPermission({ mode: 'readwrite' });
      await writeVia(handle, '<!-- P1c timer write #' + i + ' ' + new Date().toISOString() + ' -->');
      results.push({ attempt: i, ok: true, permission: perm });
    } catch (e) {
      results.push({ attempt: i, ok: false, error: String(e) });
    }
  }
  report('p1c', { ok: results.every((r) => r.ok), results });
};

document.getElementById('p5').onclick = async () => {
  try {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: 'HTML', accept: { 'text/html': ['.html'] } }],
    });
    const file = await handle.getFile();
    const text = await file.text();
    // Render it in a sandbox-free iframe to see whether inline scripts run
    // under the extension page's CSP.
    const frame = document.createElement('iframe');
    frame.style.cssText = 'width:100%;height:240px;border:1px solid #ccc;margin-top:8px';
    frame.srcdoc = text;
    document.getElementById('out-p5').after(frame);
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    report('p5', {
      ok: true,
      name: file.name,
      bytes: file.size,
      readwritePermissionWithoutPrompt: perm,
      note: 'iframe srcdoc rendered below; check whether its inline script executed',
    });
  } catch (e) {
    report('p5', { ok: false, error: String(e) });
  }
};

document.getElementById('p1r').onclick = async () => {
  try {
    const handle = await getHandle('probe-file');
    if (!handle) return report('p1r', { ok: false, error: 'handle did NOT survive restart (IDB empty)' });
    const queried = await handle.queryPermission({ mode: 'readwrite' });
    let requested = null;
    if (queried !== 'granted') {
      requested = await handle.requestPermission({ mode: 'readwrite' });
    }
    if ((requested ?? queried) !== 'granted') {
      return report('p1r', { ok: false, handleSurvived: true, queried, requested, error: 'permission not granted' });
    }
    await writeVia(handle, '<!-- P1r post-restart write ' + new Date().toISOString() + ' -->');
    report('p1r', {
      ok: true,
      handleSurvived: true,
      permissionOnQuery: queried,
      permissionAfterRequest: requested,
      clicksNeeded: queried === 'granted' ? 0 : 1,
    });
  } catch (e) {
    report('p1r', { ok: false, error: String(e) });
  }
};


document.getElementById('export').onclick = async () => {
  const stored = await chrome.storage.local.get(null);
  const payload = {
    exportedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    extensionId: chrome.runtime.id,
    results: stored,
  };
  // Blob URLs work here (extension page has a DOM); a service worker could not do this.
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  await chrome.downloads.download({ url, filename: 'snapnote-m0-results.json', saveAs: false });
  document.getElementById('out-export').className = 'ok';
  document.getElementById('out-export').textContent =
    'exported ' + Object.keys(stored).length + ' result keys to Downloads/snapnote-m0-results.json';
};


document.getElementById('p4-list').onclick = async () => {
  const tabs = await chrome.runtime.sendMessage({ type: 'sw:tabs' });
  const box = document.getElementById('p4-tabs');
  box.innerHTML = '';
  for (const t of tabs) {
    const b = document.createElement('button');
    b.textContent = (t.title ?? t.url).slice(0, 60);
    b.title = t.url;
    b.style.cssText = 'display:block;margin:3px 0;text-align:left;max-width:100%';
    b.onclick = async () => {
      document.getElementById('out-p4').textContent = 'capturing ' + t.url + ' …';
      const res = await chrome.runtime.sendMessage({ type: 'sw:capture', tabId: t.id });
      report('p4', res ?? { ok: false, error: 'no reply' });
    };
    box.appendChild(b);
  }
};

// P7: a directory handle would let every capture after the first write itself
// with no dialog. Chromium issue 40240444 reports showDirectoryPicker problems
// in extensions, so this is measured rather than assumed.
let dirHandle = null;

async function createInDir(dir, name, text) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(text);
  await w.close();
  return fh.name;
}

document.getElementById('p7-pick').onclick = async () => {
  try {
    dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await putHandle('probe-dir', dirHandle);
    report('p7', {
      ok: true,
      step: 'pick',
      dirName: dirHandle.name,
      permission: await dirHandle.queryPermission({ mode: 'readwrite' }),
      storedInIDB: true,
    });
  } catch (e) {
    report('p7', { ok: false, step: 'pick', error: e.name + ': ' + e.message });
  }
};

document.getElementById('p7-write').onclick = async () => {
  try {
    const dir = dirHandle ?? (await getHandle('probe-dir'));
    const name = await createInDir(dir, 'p7-a.html', '<!-- p7 write A ' + new Date().toISOString() + ' -->');
    report('p7', { ...window.__PROBE.p7, ok: true, step: 'write A', wrote: name });
  } catch (e) {
    report('p7', { ...window.__PROBE.p7, ok: false, step: 'write A', error: e.name + ': ' + e.message });
  }
};

document.getElementById('p7-write2').onclick = async () => {
  try {
    const dir = dirHandle ?? (await getHandle('probe-dir'));
    const name = await createInDir(dir, 'p7-b.html', '<!-- p7 write B ' + new Date().toISOString() + ' -->');
    report('p7', { ...window.__PROBE.p7, ok: true, step: 'write B', wrote: name });
  } catch (e) {
    report('p7', { ...window.__PROBE.p7, ok: false, step: 'write B', error: e.name + ': ' + e.message });
  }
};

document.getElementById('p7-timer').onclick = async () => {
  await new Promise((r) => setTimeout(r, 1500));
  try {
    const dir = dirHandle ?? (await getHandle('probe-dir'));
    const perm = await dir.queryPermission({ mode: 'readwrite' });
    const name = await createInDir(dir, 'p7-timer.html', '<!-- p7 timer ' + new Date().toISOString() + ' -->');
    report('p7', { ...window.__PROBE.p7, ok: true, step: 'timer write', wrote: name, permission: perm });
  } catch (e) {
    report('p7', { ...window.__PROBE.p7, ok: false, step: 'timer write', error: e.name + ': ' + e.message });
  }
};

document.getElementById('p7r').onclick = async () => {
  try {
    const dir = await getHandle('probe-dir');
    if (!dir) return report('p7r', { ok: false, error: 'folder handle did NOT survive restart (IDB empty)' });
    const queried = await dir.queryPermission({ mode: 'readwrite' });
    let requested = null;
    if (queried !== 'granted') requested = await dir.requestPermission({ mode: 'readwrite' });
    if ((requested ?? queried) !== 'granted') {
      return report('p7r', { ok: false, handleSurvived: true, queried, requested, error: 'permission not granted' });
    }
    const name = await createInDir(dir, 'p7-after-restart.html', '<!-- p7r ' + new Date().toISOString() + ' -->');
    report('p7r', {
      ok: true,
      handleSurvived: true,
      permissionOnQuery: queried,
      permissionAfterRequest: requested,
      clicksNeeded: queried === 'granted' ? 0 : 1,
      wrote: name,
    });
  } catch (e) {
    report('p7r', { ok: false, error: e.name + ': ' + e.message });
  }
};
