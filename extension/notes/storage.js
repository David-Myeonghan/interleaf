// Keeping file and folder handles between sessions. Handles are
// structured-cloneable, so IndexedDB stores them directly.
//
// Runs in two origins: the extension page and the saved file over file://. Each
// keeps its own store, which is why a file opened from disk has to be pointed at
// its folder once even if the extension already knows it.

const DB_NAME = 'interleaf';
const STORE = 'handles';
const VERSION = 1;

function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, run) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

// Private-browsing windows and blocked site data make IndexedDB throw outright,
// and a failure to remember a folder must not stop anyone from saving.
export async function put(key, value) {
  try {
    await withStore('readwrite', (store) => store.put(value, key));
    return true;
  } catch {
    return false;
  }
}

export async function get(key) {
  try {
    return await withStore('readonly', (store) => store.get(key));
  } catch {
    return undefined;
  }
}

export async function remove(key) {
  try {
    await withStore('readwrite', (store) => store.delete(key));
    return true;
  } catch {
    return false;
  }
}

export const KEYS = { file: 'target-file', dir: 'target-dir' };
