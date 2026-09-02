// Minimal IndexedDB helper for storing FileSystemFileHandle objects.
// Handles are structured-cloneable, so IDB can store them directly.
const DB_NAME = 'snapnote-probe';
const STORE = 'handles';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const putHandle = (key, handle) => tx('readwrite', (s) => s.put(handle, key));
export const getHandle = (key) => tx('readonly', (s) => s.get(key));
