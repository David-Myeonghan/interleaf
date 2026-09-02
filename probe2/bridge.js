// Asks the worker for the handle, then hands it to the page over postMessage.
window.addEventListener('message', async (event) => {
  if (event.source !== window || event.data?.__probe !== 'want-handle') return;
  let viaRuntime = null;
  try {
    viaRuntime = await chrome.runtime.sendMessage({ type: 'take' });
  } catch (e) {
    viaRuntime = { error: String(e) };
  }
  const handle = viaRuntime && viaRuntime.handle;
  let posted = 'not attempted';
  if (handle) {
    try { window.postMessage({ __probe: 'handle', handle }, '*'); posted = 'posted'; }
    catch (e) { posted = 'postMessage failed: ' + e.name + ' ' + e.message; }
  }
  window.postMessage({ __probe: 'report', runtimeName: viaRuntime?.name ?? null,
    runtimeHasHandle: !!handle, runtimeError: viaRuntime?.error ?? null, posted }, '*');
});
