const $ = (id) => document.getElementById(id);

$('open').onclick = (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('probe.html') });
};

$('capture').onclick = async () => {
  $('out').textContent = 'capturing…';
  const res = await chrome.runtime.sendMessage({ type: 'sw:capture' });
  $('out').textContent = JSON.stringify(res, null, 2);
  console.log('[PROBE] p4', res);
  await chrome.storage.local.set({ p4: res });
};
