// Renders a captured snapshot in this extension page. The page's own document is
// replaced by the snapshot, so the note layer later anchors against the real DOM
// rather than an iframe it cannot reach into.
//
// Extension pages run under script-src 'self', so the snapshot's inline scripts
// never execute here. That is wanted: the capture is taken with blockScripts.

import { NoteLayer } from './notes/notes.js';
import { serializeDocument } from './notes/serialize.js';
import { Saver } from './notes/save.js';
import { askWhereToSave, describeStatus, describeTarget } from './notes/save-ui.js';

const params = new URLSearchParams(location.search);
const id = params.get('id');

/** @type {{html: string, title: string, url: string, capturedAt: string, name: string} | null} */
let snapshot = null;

function fail(message) {
  const boot = document.getElementById('interleaf-boot');
  if (boot) {
    boot.textContent = message;
    boot.style.color = '#c00';
  }
}

function mountSnapshot(html) {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const adopted = document.importNode(parsed.documentElement, true);
  document.replaceChild(adopted, document.documentElement);
}

/** The snapshot replaces this page's document, so our own CSS is re-added after. */
function mountStylesheet(href, id) {
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = chrome.runtime.getURL(href);
  document.head.appendChild(link);
}

const TOOLBAR_STYLE = `
#interleaf-bar {
  position: fixed; inset: 0 0 auto 0; z-index: 2147483647;
  display: flex; align-items: center; gap: 10px;
  padding: 6px 12px; box-sizing: border-box; height: 34px;
  font: 12px/1.4 -apple-system, system-ui, sans-serif;
  background: #1f2430; color: #e8e8ea;
  box-shadow: 0 1px 4px rgba(0,0,0,.3);
}
#interleaf-bar .grow { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#interleaf-bar button {
  font: inherit; padding: 4px 10px; cursor: pointer; white-space: nowrap;
  border: 1px solid #4a5162; border-radius: 5px;
  background: #2c3342; color: inherit;
}
#interleaf-bar button:hover { background: #39424f; }
#interleaf-bar button[data-on] { background: #4a5162; }
#interleaf-bar .note { color: #9aa3b2; }
`;

function mountToolbar(layer, saver) {
  const style = document.createElement('style');
  style.id = 'interleaf-toolbar-style';
  style.textContent = TOOLBAR_STYLE;
  document.head.appendChild(style);

  const bar = document.createElement('div');
  bar.id = 'interleaf-bar';
  bar.innerHTML = `
    <strong>Interleaf</strong>
    <span class="note" id="interleaf-count">노트 0개</span>
    <span class="note" id="interleaf-status"></span>
    <span class="grow note" id="interleaf-target"></span>
    <button class="link" id="interleaf-change" type="button" hidden>바꾸기</button>
    <button class="link" id="interleaf-forget" type="button" hidden>기억 해제</button>
    <button id="interleaf-toggle" type="button">노트 숨기기</button>
    <button id="interleaf-save" type="button">이 파일에 저장</button>
  `;
  document.body.appendChild(bar);

  const toggle = document.getElementById('interleaf-toggle');
  toggle.onclick = () => {
    const hidden = !('on' in toggle.dataset);
    if (hidden) toggle.dataset.on = '';
    else delete toggle.dataset.on;
    toggle.textContent = hidden ? '노트 보이기' : '노트 숨기기';
    layer.setNotesHidden(hidden);
  };

  const pickTarget = () => askWhereToSave((choice) =>
    saver.chooseTarget(choice).then(() => saver.saveNow()));

  const save = document.getElementById('interleaf-save');
  save.onclick = async () => {
    if (saver.state === 'needs-permission') {
      const status = await saver.grant();
      if (status.state === 'ready') await saver.saveNow();
      return;
    }
    if (!saver.fileHandle) {
      const picked = await pickTarget();
      // Nowhere to write, but the notes still exist and must be rescuable.
      if (!picked) await downloadCopy(layer);
      return;
    }
    await saver.saveNow();
  };

  document.getElementById('interleaf-change').onclick = () => pickTarget();
  document.getElementById('interleaf-forget').onclick = () => saver.forget();
}

function renderStatus(status) {
  const statusEl = document.getElementById('interleaf-status');
  const targetEl = document.getElementById('interleaf-target');
  const save = document.getElementById('interleaf-save');
  if (!statusEl) return;
  statusEl.textContent = describeStatus(status);
  statusEl.className = status.state === 'failed'
    ? 'bad'
    : status.state === 'needs-permission' ? 'warn' : 'note';
  // Where saves go must be visible; a tool that quietly writes somewhere is
  // worse than one that asks.
  targetEl.textContent = status.fileName ? `→ ${describeTarget(status)}` : '';
  document.getElementById('interleaf-change').hidden = !status.fileName;
  document.getElementById('interleaf-forget').hidden = !status.fileName;
  save.textContent = status.state === 'needs-permission' ? '저장 허용' : '이 파일에 저장';
}

function renderCount(notes) {
  const el = document.getElementById('interleaf-count');
  if (el) el.textContent = `노트 ${notes.length}개`;
}

/** The viewer and stylesheet are inlined so the saved file needs no extension. */
async function runtimeSources() {
  const [js, css] = await Promise.all([
    fetch(chrome.runtime.getURL('viewer-runtime.js')).then((r) => r.text()),
    fetch(chrome.runtime.getURL('notes.css')).then((r) => r.text()),
  ]);
  return { js, css };
}

async function buildDocument(layer) {
  const { js, css } = await runtimeSources();
  return serializeDocument({
    notes: layer.toJSON(),
    runtimeJs: js,
    runtimeCss: css,
    docId: snapshot.docId,
    source: { url: snapshot.url, title: snapshot.title, capturedAt: snapshot.capturedAt },
  });
}

async function downloadCopy(layer) {
  const html = await buildDocument(layer);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename: `${snapshot.name}.html`, saveAs: true });
  } finally {
    // Revoking immediately can abort the download, so let the task settle first.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

async function boot() {
  if (!id) return fail('열 스냅샷이 지정되지 않았습니다.');
  const stored = await chrome.storage.session.get(id);
  snapshot = stored[id] ?? null;
  if (!snapshot) return fail('스냅샷을 찾을 수 없습니다. 다시 저장해 주세요.');

  document.title = snapshot.title || 'Interleaf';
  mountSnapshot(snapshot.html);
  mountStylesheet('notes.css', 'interleaf-notes-style');

  const layer = new NoteLayer();
  layer.mount();

  const saver = new Saver({
    build: () => buildDocument(layer),
    suggestName: () => `${snapshot.name}.html`,
    onStatus: renderStatus,
  });

  mountToolbar(layer, saver);
  renderCount([]);

  // A remembered folder makes every capture after the first save itself with no
  // dialog: same folder, a filename from this page, nothing to ask. The
  // remembered *file* is not inherited - it belongs to the previous capture.
  await saver.restoreFolder();
  if (saver.dirHandle) await saver.adoptInFolder(`${snapshot.name}.html`, { docId: snapshot.docId });
  renderStatus(saver.status());

  layer.onChange = (notes) => {
    renderCount(notes);
    if (saver.fileHandle) saver.schedule();
  };

  // Exposed for the verification harness, which drives selections over CDP.
  window.__interleaf = { layer, saver, snapshot, buildDocument: () => buildDocument(layer) };
}

boot().catch((e) => fail(String(e?.message ?? e)));
