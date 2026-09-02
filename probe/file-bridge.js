// Probe 2 + 3: does a content script attach to a file:// page, and can the
// page's own inline script detect the extension via window.postMessage?
console.log('[PROBE] file-bridge injected into', location.href);

const marker = document.createElement('div');
marker.id = '__snapnote_bridge_marker';
marker.dataset.injected = '1';
marker.dataset.at = new Date().toISOString();
marker.style.cssText = 'position:fixed;top:0;right:0;z-index:2147483647;background:#0a7d28;color:#fff;padding:4px 8px;font:12px system-ui';
marker.textContent = 'bridge injected';
document.documentElement.appendChild(marker);

window.addEventListener('message', async (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (msg?.__snapnote === 'ping') {
    let swReply = null;
    try {
      swReply = await chrome.runtime.sendMessage({ type: 'bridge:hello', url: location.href });
    } catch (e) {
      swReply = { ok: false, error: String(e) };
    }
    window.postMessage({ __snapnote: 'pong', nonce: msg.nonce, swReply }, '*');
    return;
  }
  // Carry the fixture's findings back so they land in one exportable place.
  if (msg?.__snapnote === 'report') {
    try {
      await chrome.runtime.sendMessage({ type: 'bridge:report', payload: msg.payload, url: location.href });
    } catch (e) {
      console.warn('[PROBE] report relay failed', e);
    }
  }
});
