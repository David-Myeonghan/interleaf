// Tiny CDP helper over Node's built-in WebSocket (Node 22+). No deps.
const PORT = process.env.CDP_PORT || 9333;
const base = `http://127.0.0.1:${PORT}`;

export async function targets() {
  const r = await fetch(`${base}/json/list`);
  return r.json();
}

export async function version() {
  const r = await fetch(`${base}/json/version`);
  return r.json();
}

// Every request carries a deadline. Without one a call whose reply never comes
// (an unrendered target answers nothing) leaves a promise pending forever, and
// because waitFor awaits its probe, the timeout it was given never gets a
// chance to fire. Runs hung with no error and no last line.
const REQUEST_TIMEOUT_MS = Number(process.env.CDP_TIMEOUT_MS ?? 10000);

/**
 * Opens a tab and actually navigates it.
 *
 * `/json/new` registers a target carrying the url but leaves the document at
 * about:blank in this Chrome build, so the tab is created through
 * Target.createTarget over the browser endpoint instead.
 */
export async function newTab(url) {
  const { webSocketDebuggerUrl } = await version();
  const browser = connect(webSocketDebuggerUrl);
  try {
    const { targetId } = await browser.send('Target.createTarget', { url });
    return { id: targetId, url };
  } finally {
    browser.close();
  }
}

export function connect(wsUrl, { timeout = REQUEST_TIMEOUT_MS } = {}) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('cdp: websocket did not open')), timeout);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(); });
    ws.addEventListener('error', (e) => { clearTimeout(timer); reject(new Error('cdp: websocket error ' + (e.message ?? ''))); });
  });

  const failAll = (reason) => {
    for (const [, entry] of pending) entry.reject(new Error(reason));
    pending.clear();
  };
  ws.addEventListener('close', () => failAll('cdp: socket closed'));

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const entry = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  });

  return {
    ready,
    send(method, params = {}) {
      return ready.then(() => new Promise((resolve, reject) => {
        const requestId = ++id;
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error(`cdp: ${method} timed out after ${timeout}ms`));
        }, timeout);
        pending.set(requestId, { resolve, reject, timer });
        ws.send(JSON.stringify({ id: requestId, method, params }));
      }));
    },
    async eval(expression) {
      const result = await this.send('Runtime.evaluate', {
        expression, awaitPromise: true, returnByValue: true,
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text + ' ' +
          (result.exceptionDetails.exception?.description ?? ''));
      }
      return result.result.value;
    },
    close() { failAll('cdp: closed by caller'); ws.close(); },
  };
}

export async function waitFor(fn, { timeout = 15000, interval = 400, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  let lastError = null;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      // Bounded even if fn itself never settles.
      const value = await Promise.race([
        Promise.resolve().then(fn),
        new Promise((_, reject) => setTimeout(() => reject(new Error('probe timed out')), remaining)),
      ]);
      if (value) return value;
    } catch (e) {
      lastError = e;
    }
    if (Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`timeout waiting for ${label}` + (lastError ? ` (last error: ${lastError.message})` : ''));
}
