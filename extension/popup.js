const button = document.getElementById('capture');
const status = document.getElementById('status');

button.onclick = async () => {
  button.disabled = true;
  status.className = '';
  status.textContent = '페이지를 복사하는 중…';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/.test(tab.url ?? '')) {
    status.className = 'bad';
    status.textContent = '이 탭은 저장할 수 없습니다.';
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
