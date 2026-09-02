const button = document.getElementById('capture');
const status = document.getElementById('status');

button.onclick = async () => {
  button.disabled = true;
  status.className = '';
  status.textContent = '페이지를 복사하는 중…';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  // A tab still loading reports an empty url and carries the real one in
  // pendingUrl. Judging on url alone refused to capture pages that were merely
  // slow, which reads as "this page cannot be saved".
  const address = tab?.url || tab?.pendingUrl || '';
  if (!tab?.id || !/^(https?|file):/.test(address)) {
    status.className = 'bad';
    status.textContent = address
      ? '이 페이지는 저장할 수 없습니다.'
      : '페이지가 아직 열리는 중입니다. 잠시 후 다시 눌러주세요.';
    button.disabled = false;
    return;
  }

  const res = await chrome.runtime.sendMessage({ type: 'capture', tabId: tab.id });
  if (res?.ok) {
    status.textContent = `${Math.round(res.bytes / 1024)}KB 복사됨. 새 탭에서 열었습니다.`;
    window.close();
    return;
  }

  status.className = 'bad';
  status.textContent = explain(res);
  button.disabled = false;
};

/** A named reason gets a sentence; anything else falls back to the raw message. */
function explain(result) {
  switch (result?.reason) {
    case 'base-uri-blocked':
      return '이 페이지는 저장할 수 없습니다. 페이지가 복사에 필요한 동작을 막고 있어 우회할 방법이 없습니다.';
    case 'failed':
      return '복사에 실패했습니다: ' + (result.error ?? '알 수 없는 오류');
    default:
      return result?.error ?? '알 수 없는 오류';
  }
}
