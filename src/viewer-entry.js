// The runtime that ships inside a saved file. It runs from `file://` with no
// extension present, so it may not touch any chrome.* API.
import { NoteLayer } from '../extension/notes/notes.js';
import { serializeDocument } from '../extension/notes/serialize.js';
import { DATA_ID } from '../extension/notes/serialize.js';

const RUNTIME_ID = 'interleaf-runtime';
const RUNTIME_STYLE_ID = 'interleaf-runtime-style';

function readData() {
  const el = document.getElementById(DATA_ID);
  if (!el) return { version: 1, source: {}, notes: [] };
  try {
    return JSON.parse(el.textContent);
  } catch {
    return { version: 1, source: {}, notes: [], parseError: true };
  }
}

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
#interleaf-bar .note { color: #9aa3b2; }
`;

function currentDocument(layer, data) {
  return serializeDocument({
    notes: layer.toJSON(),
    runtimeJs: document.getElementById(RUNTIME_ID)?.textContent ?? '',
    runtimeCss: document.getElementById(RUNTIME_STYLE_ID)?.textContent ?? '',
    source: data.source ?? {},
  });
}

function download(html, name) {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function mountBar(layer, data, status) {
  const style = document.createElement('style');
  style.id = 'interleaf-bar-style';
  style.textContent = BAR_STYLE;
  document.head.appendChild(style);

  const bar = document.createElement('div');
  bar.id = 'interleaf-bar';
  bar.innerHTML = `
    <strong>Interleaf</strong>
    <span class="note" id="interleaf-count"></span>
    <span class="grow note" id="interleaf-source"></span>
    <button id="interleaf-toggle" type="button">노트 숨기기</button>
    <button id="interleaf-save" type="button">사본 내려받기</button>
  `;
  document.body.appendChild(bar);

  const count = document.getElementById('interleaf-count');
  const render = (notes) => {
    const orphans = status.orphaned.length;
    count.textContent = `노트 ${notes.length}개` + (orphans ? ` · 원문 못 찾음 ${orphans}개` : '');
  };
  layer.onChange = render;
  render(layer.toJSON());

  document.getElementById('interleaf-source').textContent = data.source?.url ?? location.href;

  const toggle = document.getElementById('interleaf-toggle');
  toggle.onclick = () => {
    const hidden = !('on' in toggle.dataset);
    if (hidden) toggle.dataset.on = '';
    else delete toggle.dataset.on;
    toggle.textContent = hidden ? '노트 보이기' : '노트 숨기기';
    layer.setNotesHidden(hidden);
  };

  document.getElementById('interleaf-save').onclick = () => {
    const name = (data.source?.title || document.title || 'page').replace(/[\/\\?%*:|"<>]/g, ' ').slice(0, 80);
    download(currentDocument(layer, data), `${name}.html`);
  };
}

function boot() {
  const data = readData();
  const layer = new NoteLayer();
  layer.mount();
  const status = layer.restore(data.notes ?? []);
  mountBar(layer, data, status);

  // The harness drives selections and reads state through this.
  window.__interleaf = { layer, data, status, currentDocument: () => currentDocument(layer, data) };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
