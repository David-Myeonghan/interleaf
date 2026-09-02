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
  } else {
    status.className = 'bad';
    status.textContent = res?.error ?? '알 수 없는 오류';
    button.disabled = false;
  }
};
