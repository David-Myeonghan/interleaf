// The runtime that ships inside a saved file. It runs from `file://` with no
// extension present, so it may not touch any chrome.* API.
import { NoteLayer } from '../extension/notes/notes.js';
import { serializeDocument, DATA_ID } from '../extension/notes/serialize.js';
import { Saver } from '../extension/notes/save.js';
import { askWhereToSave, describeStatus, describeTarget } from '../extension/notes/save-ui.js';

const RUNTIME_ID = 'interleaf-runtime';
const RUNTIME_STYLE_ID = 'interleaf-runtime-style';

const BAR_STYLE = `
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
  border: 1px solid #4a5162; border-radius: 5px; background: #2c3342; color: inherit;
}
#interleaf-bar button:hover { background: #39424f; }
#interleaf-bar button[data-on] { background: #4a5162; }
#interleaf-bar button.link {
  border: 0; background: none; padding: 2px 4px; text-decoration: underline; color: #9aa3b2;
}
#interleaf-bar button.link:hover { color: #e8e8ea; background: none; }
#interleaf-bar .note { color: #9aa3b2; }
#interleaf-bar .warn { color: #ffb86b; }
#interleaf-bar .bad { color: #ff8f7a; }
`;

function readData() {
  const el = document.getElementById(DATA_ID);
  if (!el) return { version: 1, source: {}, notes: [] };
  try {
    return JSON.parse(el.textContent);
  } catch {
    return { version: 1, source: {}, notes: [], parseError: true };
  }
}

/** This document's own filename, when it was opened from disk. */
function ownFileName() {
  if (location.protocol !== 'file:') return null;
  const name = decodeURIComponent(location.pathname.split('/').pop() ?? '');
  return name || null;
}

function suggestedName(data) {
  const base = (data.source?.title || document.title || 'page')
    .replace(/[\/\\?%*:|"<>\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${(base || 'page').slice(0, 80)}.html`;
}

function build(layer, data) {
  return serializeDocument({
    notes: layer.toJSON(),
    runtimeJs: document.getElementById(RUNTIME_ID)?.textContent ?? '',
    runtimeCss: document.getElementById(RUNTIME_STYLE_ID)?.textContent ?? '',
    source: data.source ?? {},
    docId: data.docId,
  });
}

/** Last resort when the file cannot be written: hand over a copy instead. */
function downloadCopy(html, name) {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function boot() {
  const data = readData();
  const layer = new NoteLayer();
  layer.mount();
  const restoreStatus = layer.restore(data.notes ?? []);

  const saver = new Saver({
    build: () => build(layer, data),
    suggestName: () => suggestedName(data),
    onStatus: (status) => renderStatus(status),
    docId: data.docId,
    ownName: ownFileName(),
  });

  const style = document.createElement('style');
  style.id = 'interleaf-bar-style';
  style.textContent = BAR_STYLE;
  document.head.appendChild(style);

  const bar = document.createElement('div');
  bar.id = 'interleaf-bar';
  bar.innerHTML = `
    <strong>Interleaf</strong>
    <span class="note" id="interleaf-count"></span>
    <span class="note" id="interleaf-status"></span>
    <span class="grow note" id="interleaf-target"></span>
    <button class="link" id="interleaf-change" type="button" hidden>바꾸기</button>
    <button class="link" id="interleaf-forget" type="button" hidden>기억 해제</button>
    <button id="interleaf-toggle" type="button">노트 숨기기</button>
    <button id="interleaf-save" type="button">이 파일에 저장</button>
  `;
  document.body.appendChild(bar);

  const el = {
    count: document.getElementById('interleaf-count'),
    status: document.getElementById('interleaf-status'),
    target: document.getElementById('interleaf-target'),
    change: document.getElementById('interleaf-change'),
    forget: document.getElementById('interleaf-forget'),
    save: document.getElementById('interleaf-save'),
    toggle: document.getElementById('interleaf-toggle'),
  };

  function renderCount(notes) {
    const orphans = restoreStatus.orphaned.length;
    el.count.textContent = `노트 ${notes.length}개` + (orphans ? ` · 원문 못 찾음 ${orphans}개` : '');
  }

  function renderStatus(status) {
    el.status.textContent = describeStatus(status);
    el.status.className = status.state === 'failed'
      ? 'bad'
      : status.state === 'needs-permission' ? 'warn' : 'note';
    // Where saves go must be visible; a tool that quietly writes somewhere is
    // worse than one that asks.
    el.target.textContent = status.fileName ? `→ ${describeTarget(status)}` : '';
    el.change.hidden = !status.fileName;
    el.forget.hidden = !status.fileName;
    el.save.textContent = status.state === 'needs-permission' ? '저장 허용' : '이 파일에 저장';
  }

  layer.onChange = (notes) => {
    renderCount(notes);
    if (saver.fileHandle) saver.schedule();
  };
  renderCount(layer.toJSON());

  el.toggle.onclick = () => {
    const hidden = !('on' in el.toggle.dataset);
    if (hidden) el.toggle.dataset.on = '';
    else delete el.toggle.dataset.on;
    el.toggle.textContent = hidden ? '노트 보이기' : '노트 숨기기';
    layer.setNotesHidden(hidden);
  };

  const pickTarget = () => askWhereToSave((choice) =>
    saver.chooseTarget(choice).then(() => saver.saveNow()));

  el.save.onclick = async () => {
    if (saver.state === 'needs-permission') {
      const status = await saver.grant();
      if (status.state === 'ready') await saver.saveNow();
      return;
    }
    if (!saver.fileHandle) {
      const picked = await pickTarget();
      if (!picked) {
        // Nowhere to write, but the notes still exist and must be rescuable.
        downloadCopy(build(layer, data), suggestedName(data));
      }
      return;
    }
    await saver.saveNow();
  };

  el.change.onclick = () => pickTarget();
  el.forget.onclick = () => saver.forget();

  // A folder plus this document's own filename is this same file, so a saved
  // file reopened from disk usually needs no picker - only the one permission
  // click that a restored handle costs per browser session.
  // Nothing is written on open: the file on disk already matches what is shown.
  saver.restoreFile();

  window.__interleaf = {
    layer,
    data,
    saver,
    status: restoreStatus,
    currentDocument: () => build(layer, data),
  };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
