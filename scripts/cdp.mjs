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

export async function newTab(url) {
  const r = await fetch(`${base}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!r.ok) throw new Error(`newTab ${r.status} ${await r.text()}`);
  return r.json();
}

export function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', () => res());
    ws.addEventListener('error', (e) => rej(new Error('ws error ' + e.message)));
  });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  });
  return {
    ready,
    send(method, params = {}) {
      return ready.then(() => new Promise((resolve, reject) => {
        const mid = ++id;
        pending.set(mid, { resolve, reject });
        ws.send(JSON.stringify({ id: mid, method, params }));
      }));
    },
    async eval(expression) {
      const r = await this.send('Runtime.evaluate', {
        expression, awaitPromise: true, returnByValue: true,
      });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''));
      return r.result.value;
    },
    close() { ws.close(); },
  };
}

export async function waitFor(fn, { timeout = 15000, interval = 400, label = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for ${label}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}
