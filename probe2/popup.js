document.getElementById('pick').onclick = async () => {
  const out = document.getElementById('out');
  try {
    const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
    // A handle is structured-cloneable, so sendMessage may or may not carry it.
    const reply = await chrome.runtime.sendMessage({ type: 'hold', handle: dir });
    out.textContent = 'picked: ' + dir.name + '\nworker got: ' + JSON.stringify(reply);
  } catch (e) {
    out.textContent = 'ERR ' + e.name + ': ' + e.message;
  }
};
