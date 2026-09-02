// The first-save dialog and the toolbar's save controls.
//
// The checkbox lives in our own panel because the OS save dialog cannot carry
// one, and the choice it makes is not cosmetic: remembering the folder is what
// lets every later save happen with no dialog at all.

const PANEL_STYLE = `
#interleaf-panel {
  position: fixed; inset: 0; z-index: 2147483646;
  display: flex; align-items: center; justify-content: center;
  background: rgba(20, 22, 26, .45);
  font: 14px/1.6 -apple-system, system-ui, sans-serif;
}
#interleaf-panel .box {
  width: 420px; max-width: calc(100vw - 32px);
  background: #fff; color: #23262b;
  border-radius: 12px; padding: 20px 22px;
  box-shadow: 0 12px 40px rgba(0,0,0,.28);
}
#interleaf-panel h2 { margin: 0 0 4px; font-size: 15px; }
#interleaf-panel p.sub { margin: 0 0 16px; color: #6b727c; font-size: 13px; }
#interleaf-panel label { display: flex; gap: 8px; align-items: flex-start; cursor: pointer; }
#interleaf-panel label input { margin: 3px 0 0; }
#interleaf-panel label .hint { display: block; color: #6b727c; font-size: 12px; margin-top: 2px; }
#interleaf-panel .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }
#interleaf-panel button {
  font: inherit; padding: 6px 14px; border-radius: 7px; cursor: pointer;
  border: 1px solid #c9cdd4; background: #fff; color: inherit;
}
#interleaf-panel button.primary { background: #2b6cb0; border-color: #2b6cb0; color: #fff; }
#interleaf-panel button:hover { filter: brightness(.97); }
#interleaf-panel .error { margin: 12px 0 0; color: #c0392b; font-size: 12px; }
`;

/**
 * Asks where to save, then runs `pick` with the answer.
 *
 * `pick` is invoked synchronously inside the button's click handler rather than
 * after an awaited answer: the OS file picker requires live user activation, and
 * resuming from a promise risks having spent it.
 *
 * @param {(choice: {rememberFolder: boolean}) => Promise<unknown>} pick
 * @returns {Promise<unknown | null>} what `pick` resolved to, or null if dismissed
 */
export function askWhereToSave(pick) {
  return new Promise((resolve) => {
    if (!document.getElementById('interleaf-panel-style')) {
      const style = document.createElement('style');
      style.id = 'interleaf-panel-style';
      style.textContent = PANEL_STYLE;
      document.head.appendChild(style);
    }

    const panel = document.createElement('div');
    panel.id = 'interleaf-panel';
    panel.innerHTML = `
      <div class="box" role="dialog" aria-modal="true">
        <h2>저장 위치를 정해주세요</h2>
        <p class="sub">이 다음부터는 적는 대로 저장됩니다.</p>
        <label>
          <input type="checkbox" id="interleaf-remember" checked>
          <span>
            다음에도 여기에 저장
            <span class="hint">끄면 이 파일만 저장하고, 다음에 다시 묻습니다.</span>
          </span>
        </label>
        <div class="row">
          <button type="button" id="interleaf-cancel">취소</button>
          <button type="button" class="primary" id="interleaf-pick">위치 고르기</button>
        </div>
        <p class="error" id="interleaf-panel-error" hidden></p>
      </div>
    `;
    document.body.appendChild(panel);

    const dismiss = (value) => {
      panel.remove();
      resolve(value);
    };

    document.getElementById('interleaf-cancel').onclick = () => dismiss(null);
    panel.addEventListener('click', (e) => {
      if (e.target === panel) dismiss(null);
    });

    const button = document.getElementById('interleaf-pick');
    button.onclick = () => {
      const rememberFolder = document.getElementById('interleaf-remember').checked;
      button.disabled = true;
      // Opened inside this handler so the activation is still live.
      pick({ rememberFolder }).then(dismiss, (e) => {
        button.disabled = false;
        // A dismissed OS picker is not an error worth shouting about.
        if (e?.name === 'AbortError') return;
        const error = document.getElementById('interleaf-panel-error');
        error.hidden = false;
        error.textContent = String(e?.message ?? e);
      });
    };
    button.focus();
  });
}

/** Human-readable save status for the toolbar. */
export function describeStatus(status) {
  switch (status.state) {
    case 'unset':
      return '저장 위치 없음';
    case 'needs-permission':
      return '저장 권한 필요 — 버튼을 누르고 "매번 허용"을 고르면 다시 묻지 않습니다';
    case 'saving':
      return '저장 중…';
    case 'saved':
      return '저장됨 ' + new Date(status.lastSavedAt).toLocaleTimeString();
    case 'failed':
      return '저장 실패: ' + (status.error ?? '알 수 없는 오류');
    case 'ready':
    default:
      return status.fileName ? `${status.fileName} 에 저장` : '저장 준비됨';
  }
}

/** Where saves are going, for the toolbar's location line. */
export function describeTarget(status) {
  if (!status.fileName) return '위치 미지정';
  if (status.remembersFolder) return `${status.dirName}/${status.fileName}`;
  return status.fileName;
}
