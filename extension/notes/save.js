// The save controller. Where the file goes, how the permission for it is kept,
// and when writes happen.
//
// Measured against Chrome 152: once a handle is granted, writes need no further
// gesture, including from a timer; a restored handle needs one click per browser
// session to regain permission. So the cost floor is one click per browser
// start, and nothing per keystroke.

import * as store from './storage.js';

const AUTOSAVE_DELAY = 1200;

export const SaveState = {
  unset: 'unset',
  ready: 'ready',
  saving: 'saving',
  saved: 'saved',
  needsPermission: 'needs-permission',
  failed: 'failed',
};

export class Saver {
  /**
   * @param {object} options
   * @param {() => Promise<string> | string} options.build produces the document to write
   * @param {(status: object) => void} [options.onStatus]
   * @param {() => string} [options.suggestName] filename for a fresh target
   */
  constructor({ build, onStatus, suggestName }) {
    this.build = build;
    this.onStatus = onStatus ?? (() => {});
    this.suggestName = suggestName ?? (() => 'page.html');
    this.fileHandle = null;
    this.dirHandle = null;
    this.state = SaveState.unset;
    this.error = null;
    this.lastSavedAt = null;
    this.timer = null;
    this.pending = null;
    this.writing = false;
    this.pendingWhileWriting = false;
  }

  status() {
    return {
      state: this.state,
      error: this.error,
      lastSavedAt: this.lastSavedAt,
      fileName: this.fileHandle?.name ?? null,
      dirName: this.dirHandle?.name ?? null,
      remembersFolder: !!this.dirHandle,
    };
  }

  set(state, error = null) {
    this.state = state;
    this.error = error;
    this.onStatus(this.status());
  }

  /**
   * Loads the remembered folder, if any. The remembered *file* is deliberately
   * not adopted here: in the capture flow it belongs to a previous page, and
   * inheriting it would overwrite that page with this one.
   */
  async restoreFolder() {
    this.dirHandle = (await store.get(store.KEYS.dir)) ?? null;
    this.set(this.fileHandle ? this.state : SaveState.unset);
    return this.status();
  }

  /**
   * Takes a file inside the remembered folder as the save target. This is what
   * makes later captures silent.
   *
   * A folder holds other files, so a name is not an identity. An existing file
   * of this name is opened and its stamped `docId` compared; only a match is
   * adopted. Anything else - another capture that happens to share a title, or
   * a file the user put there - is stepped around by taking the next free name.
   * Overwriting a stranger with no dialog would be data loss.
   *
   * A restored folder handle starts at `prompt` and reading inside it then
   * throws, so the request is held for `grant()` to retry after the one click.
   */
  async adoptInFolder(name, { docId = null, create = true } = {}) {
    if (!this.dirHandle) return this.status();
    this.pending = { name, docId, create };

    const permission = await this.dirHandle.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted') {
      this.set(SaveState.needsPermission);
      return this.status();
    }

    try {
      const existing = await this.getFileHandle(name);

      if (existing && (await readDocId(existing)) === docId && docId) {
        this.fileHandle = existing;
      } else if (existing && !create) {
        // Looking for our own file and this is not it.
        this.set(SaveState.unset);
        return this.status();
      } else if (existing) {
        this.fileHandle = await this.dirHandle.getFileHandle(await this.freeName(name), { create: true });
      } else if (create) {
        this.fileHandle = await this.dirHandle.getFileHandle(name, { create: true });
      } else {
        this.set(SaveState.unset);
        return this.status();
      }

      await store.put(store.KEYS.file, this.fileHandle);
      this.pending = null;
      this.set(SaveState.ready);
    } catch (e) {
      this.set(create ? SaveState.failed : SaveState.unset, String(e?.message ?? e));
    }
    return this.status();
  }

  /** The handle for `name` in the remembered folder, or null when absent. */
  async getFileHandle(name) {
    try {
      return await this.dirHandle.getFileHandle(name, { create: false });
    } catch (e) {
      if (e?.name === 'NotFoundError') return null;
      throw e;
    }
  }

  /** `page.html` -> `page (2).html`, counting up until the folder has no such file. */
  async freeName(name) {
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : '';
    for (let n = 2; n < 1000; n++) {
      const candidate = `${stem} (${n})${extension}`;
      if (!(await this.getFileHandle(candidate))) return candidate;
    }
    return `${stem} (${Date.now()})${extension}`;
  }

  /**
   * Adopts this document's own file. A remembered folder plus this document's
   * own filename is usually the same file on disk, so a saved file reopened
   * from disk needs no picker - but the folder may be a different one that
   * happens to hold a file of that name, so the stamped `docId` decides.
   *
   * @param {string} [ownName] this document's filename, when opened from disk
   * @param {string} [docId] this document's identity
   */
  async restoreFile(ownName, docId) {
    await this.restoreFolder();

    if (ownName && this.dirHandle) {
      const adopted = await this.adoptInFolder(ownName, { docId, create: false });
      if (adopted.state !== SaveState.unset) return adopted;
    }

    const stored = (await store.get(store.KEYS.file)) ?? null;
    if (!stored || (ownName && stored.name !== ownName)) {
      this.fileHandle = null;
      this.set(SaveState.unset);
      return this.status();
    }
    this.fileHandle = stored;
    const permission = await this.fileHandle.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted') {
      this.set(SaveState.needsPermission);
      return this.status();
    }
    // Readable now, so the identity can be confirmed before anything is written.
    if (docId && (await readDocId(this.fileHandle)) !== docId) {
      this.fileHandle = null;
      this.set(SaveState.unset);
      return this.status();
    }
    this.set(SaveState.ready);
    return this.status();
  }

  /**
   * Picks where to save. Must be called from a user gesture.
   * @param {{rememberFolder: boolean}} options
   */
  async chooseTarget({ rememberFolder }) {
    if (rememberFolder) {
      // A folder handle is what makes every later save silent.
      this.dirHandle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'interleaf' });
      await store.put(store.KEYS.dir, this.dirHandle);
      const wanted = this.suggestName();
      const existing = await this.getFileHandle(wanted);
      this.fileHandle = await this.dirHandle.getFileHandle(
        existing ? await this.freeName(wanted) : wanted,
        { create: true },
      );
    } else {
      this.dirHandle = null;
      await store.remove(store.KEYS.dir);
      this.fileHandle = await window.showSaveFilePicker({
        suggestedName: this.suggestName(),
        types: [{ description: 'HTML', accept: { 'text/html': ['.html'] } }],
      });
    }
    await store.put(store.KEYS.file, this.fileHandle);
    this.set(SaveState.ready);
    return this.status();
  }

  /** Forgets the remembered location. The file on disk is untouched. */
  async forget() {
    this.cancelScheduled();
    this.fileHandle = null;
    this.dirHandle = null;
    this.pending = null;
    await store.remove(store.KEYS.file);
    await store.remove(store.KEYS.dir);
    this.set(SaveState.unset);
    return this.status();
  }

  /**
   * Regains write permission for a restored handle. Needs a user gesture.
   * When only a folder is remembered, the permission is asked for the folder and
   * the file held by `adoptInFolder` is then created inside it.
   */
  async grant() {
    if (!this.fileHandle && this.dirHandle && this.pending) {
      const permission = await this.dirHandle.requestPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        this.set(SaveState.needsPermission);
        return this.status();
      }
      const { name, docId, create } = this.pending;
      return this.adoptInFolder(name, { docId, create });
    }
    if (!this.fileHandle) return this.status();
    const permission = await this.fileHandle.requestPermission({ mode: 'readwrite' });
    this.set(permission === 'granted' ? SaveState.ready : SaveState.needsPermission);
    return this.status();
  }

  /** True when a write can proceed with no interaction at all. */
  async canWriteSilently() {
    if (!this.fileHandle) return false;
    return (await this.fileHandle.queryPermission({ mode: 'readwrite' })) === 'granted';
  }

  /** Writes now. Resolves to the status; never throws. */
  async saveNow() {
    if (!this.fileHandle) {
      this.set(SaveState.unset);
      return this.status();
    }
    if (this.writing) {
      // Coalesce: one more write after the current one, not one per call.
      this.pendingWhileWriting = true;
      return this.status();
    }

    // Claimed before the first await. Setting it after the permission check let
    // three concurrent calls all pass the guard and write three times.
    this.writing = true;
    this.set(SaveState.saving);
    try {
      if (!(await this.canWriteSilently())) {
        this.set(SaveState.needsPermission);
        return this.status();
      }
      const html = await this.build();
      const writable = await this.fileHandle.createWritable();
      await writable.write(html);
      await writable.close();
      this.lastSavedAt = new Date().toISOString();
      this.set(SaveState.saved);
    } catch (e) {
      this.set(SaveState.failed, String(e?.message ?? e));
    } finally {
      this.writing = false;
      if (this.pendingWhileWriting) {
        this.pendingWhileWriting = false;
        this.schedule(0);
      }
    }
    return this.status();
  }

  /** Queues a write once typing stops. */
  schedule(delay = AUTOSAVE_DELAY) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.saveNow(), delay);
  }

  cancelScheduled() {
    clearTimeout(this.timer);
    this.timer = null;
  }
}

/**
 * The `docId` stamped in a saved file, or null if it is not one of ours.
 *
 * Only the tail is read: the identity lives in the JSON block at the end of the
 * document, and a captured page can be megabytes.
 */
async function readDocId(handle) {
  try {
    const file = await handle.getFile();
    const tail = await file.slice(Math.max(0, file.size - 262144)).text();
    const match = /"docId"\s*:\s*"([^"]+)"/.exec(tail);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
