// Renders a captured snapshot in this extension page. The page's own document is
// replaced by the snapshot, so the note layer later anchors against the real DOM
// rather than an iframe it cannot reach into.
//
// Extension pages run under script-src 'self', so the snapshot's inline scripts
// never execute here. That is wanted: the capture is taken with blockScripts.

const params = new URLSearchParams(location.search);
const id = params.get('id');

/** @type {{html: string, title: string, url: string, capturedAt: string, name: string} | null} */
let snapshot = null;

function fail(message) {
  const boot = document.getElementById('snapnote-boot');
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

const TOOLBAR_STYLE = `
#snapnote-bar {
  position: fixed; inset: 0 0 auto 0; z-index: 2147483647;
  display: flex; align-items: center; gap: 10px;
  padding: 6px 12px; box-sizing: border-box;
  font: 12px/1.4 -apple-system, system-ui, sans-serif;
  background: #1f2430; color: #e8e8ea;
  box-shadow: 0 1px 4px rgba(0,0,0,.3);
}
#snapnote-bar .grow { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#snapnote-bar button {
  font: inherit; padding: 4px 10px; cursor: pointer;
  border: 1px solid #4a5162; border-radius: 5px;
  background: #2c3342; color: inherit;
}
#snapnote-bar button:hover { background: #39424f; }
#snapnote-bar .note { color: #9aa3b2; }
body { padding-top: 34px !important; }
`;

function mountToolbar() {
  const style = document.createElement('style');
  style.id = 'snapnote-style';
  style.textContent = TOOLBAR_STYLE;
  document.head.appendChild(style);

  const bar = document.createElement('div');
  bar.id = 'snapnote-bar';
  bar.innerHTML = `
    <strong>SnapNote</strong>
    <span class="grow note" id="snapnote-source"></span>
    <button id="snapnote-download">HTML 내려받기</button>
  `;
  document.body.appendChild(bar);

  document.getElementById('snapnote-source').textContent = snapshot.url;
  document.getElementById('snapnote-download').onclick = downloadSnapshot;
}

async function downloadSnapshot() {
  const blob = new Blob([snapshot.html], { type: 'text/html' });
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

  document.title = snapshot.title || 'SnapNote';
  mountSnapshot(snapshot.html);
  mountToolbar();
}

boot().catch((e) => fail(String(e?.message ?? e)));
