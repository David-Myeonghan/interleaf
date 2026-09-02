(() => {
  // extension/notes/highlight.js
  var MARK = "il-mark";
  function paint(range, noteId) {
    const texts = textNodesIn(range);
    const marks = [];
    for (const node of texts) {
      const from = node === range.startContainer ? range.startOffset : 0;
      const to = node === range.endContainer ? range.endOffset : node.length;
      if (to <= from) continue;
      let target = node;
      if (to < target.length) target.splitText(to);
      if (from > 0) target = target.splitText(from);
      const mark = document.createElement(MARK);
      mark.dataset.noteId = noteId;
      target.parentNode.insertBefore(mark, target);
      mark.appendChild(target);
      marks.push(mark);
    }
    return marks;
  }
  function marksFor(noteId) {
    return [...document.querySelectorAll(`${MARK}[data-note-id="${cssEscape(noteId)}"]`)];
  }
  function unpaint(noteId) {
    for (const mark of marksFor(noteId)) {
      const parent = mark.parentNode;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize();
    }
  }
  function setActive(noteId, active) {
    for (const mark of marksFor(noteId)) {
      if (active) mark.dataset.active = "";
      else delete mark.dataset.active;
    }
  }
  function topOf(noteId) {
    const [first] = marksFor(noteId);
    if (!first) return null;
    const rect = first.getBoundingClientRect();
    return rect.top + window.scrollY;
  }
  function textNodesIn(range) {
    const walker = document.createTreeWalker(
      range.commonAncestorContainer,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.length) return NodeFilter.FILTER_REJECT;
          if (!range.intersectsNode(node)) return NodeFilter.FILTER_REJECT;
          if (node.parentElement?.closest(`${MARK}, #interleaf-root, #interleaf-cards, #interleaf-bar`)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    const out = [];
    if (range.commonAncestorContainer.nodeType === Node.TEXT_NODE) {
      out.push(range.commonAncestorContainer);
    } else {
      let n;
      while (n = walker.nextNode()) out.push(n);
    }
    return out;
  }
  function cssEscape(value) {
    return CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&");
  }

  // extension/notes/layout.js
  var MIN_GAP = 8;
  function place(cards) {
    for (const card of cards) {
      card.el.style.display = card.anchorTop === null ? "none" : "";
    }
    const visible = cards.filter((c) => c.anchorTop !== null).map((c) => ({ id: c.id, el: c.el, anchorTop: c.anchorTop, height: c.el.offsetHeight })).sort((a, b) => a.anchorTop - b.anchorTop);
    let floor = 0;
    const out = [];
    for (const card of visible) {
      const top = Math.max(card.anchorTop, floor);
      card.el.style.top = `${Math.round(top)}px`;
      floor = top + card.height + MIN_GAP;
      out.push({ id: card.id, top });
    }
    return out;
  }
  function drawLeader(svg, mark, card, textRight = 0) {
    svg.replaceChildren();
    if (!mark || !card) return;
    const m = mark.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    const markY = m.top + m.height / 2;
    const cardY = c.top + 14;
    const startX = Math.max(m.right, textRight) + 4;
    const endX = c.left - 2;
    if (endX <= startX) return;
    const elbowX = Math.max(startX + 12, endX - 18);
    const points = [
      [startX, markY],
      [elbowX, markY],
      [elbowX, cardY],
      [endX, cardY]
    ];
    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    line.setAttribute("points", points.map(([x, y]) => `${Math.round(x)},${Math.round(y)}`).join(" "));
    svg.appendChild(line);
  }

  // extension/notes/gutter.js
  var CARD_WIDTH = 296;
  var GAP = 24;
  var EDGE = 12;
  function contentRightEdge() {
    const edges = [];
    for (const el of document.body.querySelectorAll("p, li, h1, h2, h3, h4, blockquote, pre, td, dd, figcaption")) {
      if (el.closest("#interleaf-cards, #interleaf-bar, #interleaf-leader")) continue;
      const text = el.textContent?.trim();
      if (!text || text.length < 20) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 80 || rect.height === 0) continue;
      edges.push(rect.right + window.scrollX);
    }
    if (!edges.length) return document.body.getBoundingClientRect().right + window.scrollX;
    edges.sort((a, b) => a - b);
    return edges[Math.floor(edges.length * 0.95)] ?? edges[edges.length - 1];
  }
  function measureGutter() {
    const viewport = document.documentElement.clientWidth;
    const content = contentRightEdge();
    const left = Math.max(
      Math.min(content + GAP, viewport - CARD_WIDTH - EDGE),
      EDGE
    );
    return { left, width: CARD_WIDTH, overContent: left < content };
  }
  function applyGutter(host) {
    const measured = measureGutter();
    host.style.left = `${Math.round(measured.left)}px`;
    host.style.width = `${measured.width}px`;
    const root = document.documentElement;
    if (measured.overContent) root.dataset.interleafOverlay = "";
    else delete root.dataset.interleafOverlay;
    return measured;
  }

  // extension/notes/anchor.js
  var CONTEXT = 32;
  function textMap(root = document.body) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node2) {
        if (!node2.length) return NodeFilter.FILTER_REJECT;
        if (node2.parentElement?.closest("#interleaf-cards, #interleaf-bar, #interleaf-leader")) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    let text = "";
    let node;
    while (node = walker.nextNode()) {
      nodes.push({ node, start: text.length, end: text.length + node.length });
      text += node.data;
    }
    return { nodes, text };
  }
  function offsetOf(map, container, offset) {
    if (container.nodeType === Node.TEXT_NODE) {
      const entry2 = map.nodes.find((n) => n.node === container);
      return entry2 ? entry2.start + offset : null;
    }
    const child = container.childNodes[offset];
    if (!child) {
      const last = map.nodes[map.nodes.length - 1];
      return last ? last.end : 0;
    }
    const entry = map.nodes.find((n) => child.contains?.(n.node) || n.node === child);
    return entry ? entry.start : null;
  }
  function fromRange(range, root = document.body) {
    const map = textMap(root);
    const start = offsetOf(map, range.startContainer, range.startOffset);
    const end = offsetOf(map, range.endContainer, range.endOffset);
    if (start === null || end === null || end <= start) return null;
    return {
      quote: {
        exact: map.text.slice(start, end),
        prefix: map.text.slice(Math.max(0, start - CONTEXT), start),
        suffix: map.text.slice(end, end + CONTEXT)
      },
      position: { start, end }
    };
  }
  function rangeFor(map, start, end) {
    const from = map.nodes.find((n) => start >= n.start && start < n.end);
    const to = map.nodes.find((n) => end > n.start && end <= n.end);
    if (!from || !to) return null;
    const range = document.createRange();
    range.setStart(from.node, start - from.start);
    range.setEnd(to.node, end - to.start);
    return range;
  }
  function toRange(anchor, root = document.body) {
    const map = textMap(root);
    const exact = anchor?.quote?.exact;
    if (!exact) return null;
    const { start, end } = anchor.position ?? {};
    if (Number.isInteger(start) && map.text.slice(start, end) === exact) {
      const range2 = rangeFor(map, start, end);
      if (range2) return { range: range2, how: "position" };
    }
    let best = null;
    for (let i = map.text.indexOf(exact); i !== -1; i = map.text.indexOf(exact, i + 1)) {
      const score = affixScore(map.text, i, i + exact.length, anchor.quote);
      const distance = Number.isInteger(start) ? Math.abs(i - start) : 0;
      if (!best || score > best.score || score === best.score && distance < best.distance) {
        best = { at: i, score, distance };
      }
    }
    if (!best) return null;
    const range = rangeFor(map, best.at, best.at + exact.length);
    return range ? { range, how: "quote" } : null;
  }
  function affixScore(text, from, to, quote) {
    const prefix = quote.prefix ?? "";
    const suffix = quote.suffix ?? "";
    const before = text.slice(Math.max(0, from - prefix.length), from);
    const after = text.slice(to, to + suffix.length);
    return matchFromEnd(before, prefix) + matchFromStart(after, suffix);
  }
  function matchFromEnd(a, b) {
    if (!b.length) return 1;
    let n = 0;
    while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
    return n / b.length;
  }
  function matchFromStart(a, b) {
    if (!b.length) return 1;
    let n = 0;
    while (n < a.length && n < b.length && a[n] === b[n]) n++;
    return n / b.length;
  }

  // extension/notes/notes.js
  var QUOTE_CLAMP = 140;
  var NoteLayer = class {
    /** @param {{onChange?: (notes: object[]) => void}} options */
    constructor({ onChange } = {}) {
      this.notes = /* @__PURE__ */ new Map();
      this.onChange = onChange ?? (() => {
      });
      this.activeId = null;
      this.cardsHost = null;
      this.relayout = throttleToFrame(() => this.layout());
      this.redrawLeader = throttleToFrame(() => this.drawActiveLeader());
    }
    mount() {
      document.documentElement.dataset.interleaf = "";
      this.cardsHost = document.createElement("div");
      this.cardsHost.id = "interleaf-cards";
      document.documentElement.appendChild(this.cardsHost);
      this.leaderHost = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      this.leaderHost.id = "interleaf-leader";
      document.documentElement.appendChild(this.leaderHost);
      document.addEventListener("mouseup", (e) => this.onMouseUp(e));
      window.addEventListener("resize", this.relayout);
      window.addEventListener("load", this.relayout);
      window.addEventListener("scroll", this.redrawLeader, { passive: true });
      document.addEventListener("click", (e) => this.onDocumentClick(e));
    }
    setNotesHidden(hidden) {
      document.documentElement.dataset.interleaf = hidden ? "notes-hidden" : "";
      if (!hidden) this.relayout();
    }
    onMouseUp(event) {
      if (event.target.closest?.("#interleaf-cards, #interleaf-bar")) return;
      if (document.documentElement.dataset.interleaf === "notes-hidden") return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (!range.toString().trim()) return;
      selection.removeAllRanges();
      this.create(range);
    }
    create(range) {
      const anchor = fromRange(range);
      if (!anchor) return null;
      const id = "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const marks = paint(range, id);
      if (!marks.length) return null;
      const note = {
        id,
        anchor,
        body: "",
        collapsed: false,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      this.addCard(note);
      this.layout();
      this.focus(id);
      this.emit();
      return id;
    }
    /**
     * Puts stored notes back on the page. Anchors that no longer resolve are kept
     * rather than dropped: the note is the user's, and silently discarding one
     * because the text moved would lose work no one asked to lose.
     *
     * @returns {{restored: number, orphaned: string[], byQuote: string[]}}
     */
    restore(notes) {
      const orphaned = [];
      const byQuote = [];
      let restored = 0;
      for (const note of notes) {
        const found = toRange(note.anchor);
        if (!found) {
          this.addCard({ ...note, orphaned: true });
          orphaned.push(note.id);
          continue;
        }
        const marks = paint(found.range, note.id);
        if (!marks.length) {
          this.addCard({ ...note, orphaned: true });
          orphaned.push(note.id);
          continue;
        }
        this.addCard({ ...note, orphaned: false });
        if (found.how === "quote") byQuote.push(note.id);
        restored++;
      }
      this.layout();
      this.emit();
      return { restored, orphaned, byQuote };
    }
    addCard(note) {
      const card = this.buildCard(note);
      this.cardsHost.appendChild(card);
      this.notes.set(note.id, { note, card });
      return card;
    }
    remove(id) {
      const entry = this.notes.get(id);
      if (!entry) return;
      unpaint(id);
      entry.card.remove();
      this.notes.delete(id);
      if (this.activeId === id) this.activeId = null;
      this.layout();
      this.emit();
    }
    focus(id) {
      const entry = this.notes.get(id);
      if (!entry) return;
      this.setActive(id);
      if (!entry.note.collapsed) entry.card.querySelector(".il-card__body").focus();
    }
    setActive(id) {
      if (this.activeId && this.activeId !== id) {
        setActive(this.activeId, false);
        const prev = this.notes.get(this.activeId);
        if (prev) delete prev.card.dataset.active;
      }
      this.activeId = id;
      if (!id) {
        this.redrawLeader();
        return;
      }
      setActive(id, true);
      const entry = this.notes.get(id);
      if (entry) entry.card.dataset.active = "";
      this.redrawLeader();
    }
    toggleCollapsed(id, collapsed) {
      const entry = this.notes.get(id);
      if (!entry) return;
      entry.note.collapsed = collapsed ?? !entry.note.collapsed;
      if (entry.note.collapsed) entry.card.dataset.collapsed = "";
      else delete entry.card.dataset.collapsed;
      this.layout();
      this.emit();
    }
    layout() {
      this.gutter = applyGutter(this.cardsHost);
      const cards = [...this.notes.entries()].map(([id, { note, card }]) => ({
        id,
        el: card,
        // An orphan has no mark to sit beside. It stacks at the top of the column
        // rather than being hidden: the note is the user's work, and a note you
        // cannot see is a note you have lost.
        anchorTop: topOf(id) ?? (note.orphaned ? 0 : null)
      }));
      place(cards);
      this.drawActiveLeader();
    }
    drawActiveLeader() {
      if (!this.leaderHost) return;
      const entry = this.activeId ? this.notes.get(this.activeId) : null;
      const [mark] = this.activeId ? marksFor(this.activeId) : [];
      const textRight = (this.gutter?.left ?? 0) - 24;
      drawLeader(this.leaderHost, mark ?? null, entry?.card ?? null, textRight);
    }
    toJSON() {
      return [...this.notes.values()].map(({ note }) => {
        const { orphaned, ...rest } = note;
        return rest;
      });
    }
    emit() {
      this.onChange(this.toJSON());
    }
    onDocumentClick(event) {
      const mark = event.target.closest?.("il-mark");
      if (mark) {
        const id = mark.dataset.noteId;
        const entry = this.notes.get(id);
        if (entry?.note.collapsed) this.toggleCollapsed(id, false);
        this.focus(id);
        return;
      }
      const card = event.target.closest?.(".il-card");
      if (card) {
        this.setActive(card.dataset.noteId);
        return;
      }
      this.setActive(null);
    }
    buildCard(note) {
      const card = document.createElement("div");
      card.className = "il-card";
      card.dataset.noteId = note.id;
      if (note.collapsed) card.dataset.collapsed = "";
      if (note.orphaned) card.dataset.orphaned = "";
      const exact = note.anchor?.quote?.exact ?? "";
      const quote = document.createElement("p");
      quote.className = "il-card__quote";
      quote.textContent = (exact.length > QUOTE_CLAMP ? exact.slice(0, QUOTE_CLAMP) + "\u2026" : exact) || "(\uC6D0\uBB38\uC744 \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4)";
      const body = document.createElement("textarea");
      body.className = "il-card__body";
      body.placeholder = "\uC0DD\uAC01\uC744 \uC801\uC73C\uC138\uC694";
      body.value = note.body;
      body.rows = 1;
      body.addEventListener("input", () => {
        note.body = body.value;
        autosize(body);
        this.relayout();
        this.emit();
      });
      body.addEventListener("focus", () => this.setActive(note.id));
      const foot = document.createElement("div");
      foot.className = "il-card__foot";
      const collapse = document.createElement("button");
      collapse.type = "button";
      collapse.textContent = "\uC811\uAE30";
      collapse.onclick = () => this.toggleCollapsed(note.id, true);
      const spacer = document.createElement("span");
      spacer.className = "spacer";
      const del = document.createElement("button");
      del.type = "button";
      del.textContent = "\uC0AD\uC81C";
      del.onclick = () => this.remove(note.id);
      foot.append(collapse, spacer, del);
      card.append(quote, body, foot);
      requestAnimationFrame(() => autosize(body));
      return card;
    }
  };
  function autosize(textarea) {
    textarea.style.height = "auto";
    const cap = parseFloat(getComputedStyle(textarea).maxHeight);
    const wanted = textarea.scrollHeight;
    textarea.style.height = (Number.isFinite(cap) ? Math.min(wanted, cap) : wanted) + "px";
  }
  function throttleToFrame(fn) {
    let queued = false;
    return () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        fn();
      });
    };
  }

  // extension/notes/serialize.js
  var DATA_ID = "interleaf-data";
  var RUNTIME_ID = "interleaf-runtime";
  var RUNTIME_STYLE_ID = "interleaf-runtime-style";
  var STRIP = "#interleaf-cards, #interleaf-bar, #interleaf-leader, #interleaf-toolbar-style, #interleaf-notes-style, #interleaf-boot";
  function serializeDocument({ notes, runtimeJs, runtimeCss, source, docId }) {
    const clone = document.documentElement.cloneNode(true);
    for (const el of clone.querySelectorAll(STRIP)) el.remove();
    unwrapMarks(clone);
    delete clone.dataset.interleaf;
    delete clone.dataset.interleafOverlay;
    clone.removeAttribute("style");
    const head = clone.querySelector("head") ?? clone.insertBefore(document.createElement("head"), clone.firstChild);
    replaceNode(head, RUNTIME_STYLE_ID, () => {
      const style = document.createElement("style");
      style.id = RUNTIME_STYLE_ID;
      style.textContent = runtimeCss;
      return style;
    });
    const body = clone.querySelector("body") ?? clone.appendChild(document.createElement("body"));
    replaceNode(body, DATA_ID, () => {
      const data = document.createElement("script");
      data.type = "application/json";
      data.id = DATA_ID;
      data.textContent = JSON.stringify({ version: 1, docId, source, notes }, null, 2);
      return data;
    });
    replaceNode(body, RUNTIME_ID, () => {
      const script = document.createElement("script");
      script.id = RUNTIME_ID;
      script.textContent = runtimeJs;
      return script;
    });
    return "<!doctype html>\n" + clone.outerHTML;
  }
  function replaceNode(parent, id, build2) {
    const fresh = build2();
    const existing = parent.querySelector(`#${id}`);
    if (existing) existing.replaceWith(fresh);
    else parent.appendChild(fresh);
    return fresh;
  }
  function unwrapMarks(root) {
    for (const mark of root.querySelectorAll("il-mark")) {
      const parent = mark.parentNode;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
    }
    root.normalize();
  }

  // extension/notes/storage.js
  var DB_NAME = "interleaf";
  var STORE = "handles";
  var VERSION = 1;
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
  async function put(key, value) {
    try {
      await withStore("readwrite", (store) => store.put(value, key));
      return true;
    } catch {
      return false;
    }
  }
  async function get(key) {
    try {
      return await withStore("readonly", (store) => store.get(key));
    } catch {
      return void 0;
    }
  }
  async function remove(key) {
    try {
      await withStore("readwrite", (store) => store.delete(key));
      return true;
    } catch {
      return false;
    }
  }
  var KEYS = { file: "target-file", dir: "target-dir" };

  // extension/notes/save.js
  var AUTOSAVE_DELAY = 1200;
  var SaveState = {
    unset: "unset",
    ready: "ready",
    saving: "saving",
    saved: "saved",
    needsPermission: "needs-permission",
    failed: "failed"
  };
  var Saver = class {
    /**
     * @param {object} options
     * @param {() => Promise<string> | string} options.build produces the document to write
     * @param {(status: object) => void} [options.onStatus]
     * @param {() => string} [options.suggestName] filename for a fresh target
     */
    constructor({ build: build2, onStatus, suggestName, docId = null, ownName = null }) {
      this.build = build2;
      this.onStatus = onStatus ?? (() => {
      });
      this.suggestName = suggestName ?? (() => "page.html");
      this.docId = docId;
      this.ownName = ownName;
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
        remembersFolder: !!this.dirHandle
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
      this.dirHandle = await get(KEYS.dir) ?? null;
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
      const permission = await this.dirHandle.queryPermission({ mode: "readwrite" });
      if (permission !== "granted") {
        this.set(SaveState.needsPermission);
        return this.status();
      }
      try {
        const existing = await this.getFileHandle(name);
        if (existing && await readDocId(existing) === docId && docId) {
          this.fileHandle = existing;
        } else if (existing && !create) {
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
        await put(KEYS.file, this.fileHandle);
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
        if (e?.name === "NotFoundError") return null;
        throw e;
      }
    }
    /** `page.html` -> `page (2).html`, counting up until the folder has no such file. */
    async freeName(name) {
      const dot = name.lastIndexOf(".");
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const extension = dot > 0 ? name.slice(dot) : "";
      for (let n = 2; n < 1e3; n++) {
        const candidate = `${stem} (${n})${extension}`;
        if (!await this.getFileHandle(candidate)) return candidate;
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
    async restoreFile(ownName = this.ownName, docId = this.docId) {
      this.ownName = ownName ?? this.ownName;
      this.docId = docId ?? this.docId;
      await this.restoreFolder();
      if (ownName && this.dirHandle) {
        const adopted = await this.adoptInFolder(ownName, { docId, create: false });
        if (adopted.state !== SaveState.unset) return adopted;
      }
      const stored = await get(KEYS.file) ?? null;
      if (!stored || ownName && stored.name !== ownName) {
        this.fileHandle = null;
        this.set(SaveState.unset);
        return this.status();
      }
      this.fileHandle = stored;
      const permission = await this.fileHandle.queryPermission({ mode: "readwrite" });
      if (permission !== "granted") {
        this.set(SaveState.needsPermission);
        return this.status();
      }
      if (docId && await readDocId(this.fileHandle) !== docId) {
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
        this.dirHandle = await window.showDirectoryPicker({ mode: "readwrite", id: "interleaf" });
        await put(KEYS.dir, this.dirHandle);
        const status = await this.adoptInFolder(this.ownName ?? this.suggestName(), { docId: this.docId });
        if (status.state !== SaveState.ready) return status;
      } else {
        this.dirHandle = null;
        await remove(KEYS.dir);
        this.fileHandle = await window.showSaveFilePicker({
          suggestedName: this.suggestName(),
          types: [{ description: "HTML", accept: { "text/html": [".html"] } }]
        });
      }
      await put(KEYS.file, this.fileHandle);
      this.set(SaveState.ready);
      return this.status();
    }
    /** Forgets the remembered location. The file on disk is untouched. */
    async forget() {
      this.cancelScheduled();
      this.fileHandle = null;
      this.dirHandle = null;
      this.pending = null;
      await remove(KEYS.file);
      await remove(KEYS.dir);
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
        const permission2 = await this.dirHandle.requestPermission({ mode: "readwrite" });
        if (permission2 !== "granted") {
          this.set(SaveState.needsPermission);
          return this.status();
        }
        const { name, docId, create } = this.pending;
        return this.adoptInFolder(name, { docId, create });
      }
      if (!this.fileHandle) return this.status();
      const permission = await this.fileHandle.requestPermission({ mode: "readwrite" });
      this.set(permission === "granted" ? SaveState.ready : SaveState.needsPermission);
      return this.status();
    }
    /** True when a write can proceed with no interaction at all. */
    async canWriteSilently() {
      if (!this.fileHandle) return false;
      return await this.fileHandle.queryPermission({ mode: "readwrite" }) === "granted";
    }
    /** Writes now. Resolves to the status; never throws. */
    async saveNow() {
      if (!this.fileHandle) {
        this.set(SaveState.unset);
        return this.status();
      }
      if (this.writing) {
        this.pendingWhileWriting = true;
        return this.status();
      }
      this.writing = true;
      this.set(SaveState.saving);
      try {
        if (!await this.canWriteSilently()) {
          this.set(SaveState.needsPermission);
          return this.status();
        }
        const html = await this.build();
        const writable = await this.fileHandle.createWritable();
        await writable.write(html);
        await writable.close();
        this.lastSavedAt = (/* @__PURE__ */ new Date()).toISOString();
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
  };
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

  // extension/notes/save-ui.js
  var PANEL_STYLE = `
#interleaf-panel {
  position: fixed; inset: 0; z-index: 2147483646;
  display: flex; align-items: center; justify-content: center;
  background: rgba(20, 22, 26, .45);
  font: 14px/1.6 -apple-system, system-ui, sans-serif;
}
#interleaf-panel .box {
  width: 420px; max-width: calc(100vw - 32px);
  background: #fff; color: #23262b;
  border-radius: 12px; padding: 20px 22px;
  box-shadow: 0 12px 40px rgba(0,0,0,.28);
}
#interleaf-panel h2 { margin: 0 0 4px; font-size: 15px; }
#interleaf-panel p.sub { margin: 0 0 16px; color: #6b727c; font-size: 13px; }
#interleaf-panel label { display: flex; gap: 8px; align-items: flex-start; cursor: pointer; }
#interleaf-panel label input { margin: 3px 0 0; }
#interleaf-panel label .hint { display: block; color: #6b727c; font-size: 12px; margin-top: 2px; }
#interleaf-panel .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }
#interleaf-panel button {
  font: inherit; padding: 6px 14px; border-radius: 7px; cursor: pointer;
  border: 1px solid #c9cdd4; background: #fff; color: inherit;
}
#interleaf-panel button.primary { background: #2b6cb0; border-color: #2b6cb0; color: #fff; }
#interleaf-panel button:hover { filter: brightness(.97); }
#interleaf-panel .error { margin: 12px 0 0; color: #c0392b; font-size: 12px; }
`;
  function askWhereToSave(pick) {
    return new Promise((resolve) => {
      if (!document.getElementById("interleaf-panel-style")) {
        const style = document.createElement("style");
        style.id = "interleaf-panel-style";
        style.textContent = PANEL_STYLE;
        document.head.appendChild(style);
      }
      const panel = document.createElement("div");
      panel.id = "interleaf-panel";
      panel.innerHTML = `
      <div class="box" role="dialog" aria-modal="true">
        <h2>\uC800\uC7A5 \uC704\uCE58\uB97C \uC815\uD574\uC8FC\uC138\uC694</h2>
        <p class="sub">\uC774 \uB2E4\uC74C\uBD80\uD130\uB294 \uC801\uB294 \uB300\uB85C \uC800\uC7A5\uB429\uB2C8\uB2E4.</p>
        <label>
          <input type="checkbox" id="interleaf-remember" checked>
          <span>
            \uB2E4\uC74C\uC5D0\uB3C4 \uC5EC\uAE30\uC5D0 \uC800\uC7A5
            <span class="hint">\uB044\uBA74 \uC774 \uD30C\uC77C\uB9CC \uC800\uC7A5\uD558\uACE0, \uB2E4\uC74C\uC5D0 \uB2E4\uC2DC \uBB3B\uC2B5\uB2C8\uB2E4.</span>
          </span>
        </label>
        <div class="row">
          <button type="button" id="interleaf-cancel">\uCDE8\uC18C</button>
          <button type="button" class="primary" id="interleaf-pick">\uC704\uCE58 \uACE0\uB974\uAE30</button>
        </div>
        <p class="error" id="interleaf-panel-error" hidden></p>
      </div>
    `;
      document.body.appendChild(panel);
      const dismiss = (value) => {
        panel.remove();
        resolve(value);
      };
      document.getElementById("interleaf-cancel").onclick = () => dismiss(null);
      panel.addEventListener("click", (e) => {
        if (e.target === panel) dismiss(null);
      });
      const button = document.getElementById("interleaf-pick");
      button.onclick = () => {
        const rememberFolder = document.getElementById("interleaf-remember").checked;
        button.disabled = true;
        pick({ rememberFolder }).then(dismiss, (e) => {
          button.disabled = false;
          if (e?.name === "AbortError") return;
          const error = document.getElementById("interleaf-panel-error");
          error.hidden = false;
          error.textContent = String(e?.message ?? e);
        });
      };
      button.focus();
    });
  }
  function describeStatus(status) {
    switch (status.state) {
      case "unset":
        return "\uC800\uC7A5 \uC704\uCE58 \uC5C6\uC74C";
      case "needs-permission":
        return "\uC800\uC7A5 \uAD8C\uD55C \uD544\uC694";
      case "saving":
        return "\uC800\uC7A5 \uC911\u2026";
      case "saved":
        return "\uC800\uC7A5\uB428 " + new Date(status.lastSavedAt).toLocaleTimeString();
      case "failed":
        return "\uC800\uC7A5 \uC2E4\uD328: " + (status.error ?? "\uC54C \uC218 \uC5C6\uB294 \uC624\uB958");
      case "ready":
      default:
        return status.fileName ? `${status.fileName} \uC5D0 \uC800\uC7A5` : "\uC800\uC7A5 \uC900\uBE44\uB428";
    }
  }
  function describeTarget(status) {
    if (!status.fileName) return "\uC704\uCE58 \uBBF8\uC9C0\uC815";
    if (status.remembersFolder) return `${status.dirName}/${status.fileName}`;
    return status.fileName;
  }

  // src/viewer-entry.js
  var RUNTIME_ID2 = "interleaf-runtime";
  var RUNTIME_STYLE_ID2 = "interleaf-runtime-style";
  var BAR_STYLE = `
#interleaf-bar {
  position: fixed; inset: 0 0 auto 0; z-index: 2147483647;
  display: flex; align-items: center; gap: 10px;
  padding: 6px 12px; box-sizing: border-box; height: 34px;
  font: 12px/1.4 -apple-system, system-ui, sans-serif;
  background: #1f2430; color: #e8e8ea;
  box-shadow: 0 1px 4px rgba(0,0,0,.3);
}
#interleaf-bar .grow { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#interleaf-bar button {
  font: inherit; padding: 4px 10px; cursor: pointer; white-space: nowrap;
  border: 1px solid #4a5162; border-radius: 5px; background: #2c3342; color: inherit;
}
#interleaf-bar button:hover { background: #39424f; }
#interleaf-bar button[data-on] { background: #4a5162; }
#interleaf-bar button.link {
  border: 0; background: none; padding: 2px 4px; text-decoration: underline; color: #9aa3b2;
}
#interleaf-bar button.link:hover { color: #e8e8ea; background: none; }
#interleaf-bar .note { color: #9aa3b2; }
#interleaf-bar .warn { color: #ffb86b; }
#interleaf-bar .bad { color: #ff8f7a; }
`;
  function readData() {
    const el = document.getElementById(DATA_ID);
    if (!el) return { version: 1, source: {}, notes: [] };
    try {
      return JSON.parse(el.textContent);
    } catch {
      return { version: 1, source: {}, notes: [], parseError: true };
    }
  }
  function ownFileName() {
    if (location.protocol !== "file:") return null;
    const name = decodeURIComponent(location.pathname.split("/").pop() ?? "");
    return name || null;
  }
  function suggestedName(data) {
    const base = (data.source?.title || document.title || "page").replace(/[\/\\?%*:|"<>\x00-\x1f]/g, " ").replace(/\s+/g, " ").trim();
    return `${(base || "page").slice(0, 80)}.html`;
  }
  function build(layer, data) {
    return serializeDocument({
      notes: layer.toJSON(),
      runtimeJs: document.getElementById(RUNTIME_ID2)?.textContent ?? "",
      runtimeCss: document.getElementById(RUNTIME_STYLE_ID2)?.textContent ?? "",
      source: data.source ?? {},
      docId: data.docId
    });
  }
  function downloadCopy(html, name) {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3e4);
  }
  function boot() {
    const data = readData();
    const layer = new NoteLayer();
    layer.mount();
    const restoreStatus = layer.restore(data.notes ?? []);
    const saver = new Saver({
      build: () => build(layer, data),
      suggestName: () => suggestedName(data),
      onStatus: (status) => renderStatus(status),
      docId: data.docId,
      ownName: ownFileName()
    });
    const style = document.createElement("style");
    style.id = "interleaf-bar-style";
    style.textContent = BAR_STYLE;
    document.head.appendChild(style);
    const bar = document.createElement("div");
    bar.id = "interleaf-bar";
    bar.innerHTML = `
    <strong>Interleaf</strong>
    <span class="note" id="interleaf-count"></span>
    <span class="note" id="interleaf-status"></span>
    <span class="grow note" id="interleaf-target"></span>
    <button class="link" id="interleaf-change" type="button" hidden>\uBC14\uAFB8\uAE30</button>
    <button class="link" id="interleaf-forget" type="button" hidden>\uAE30\uC5B5 \uD574\uC81C</button>
    <button id="interleaf-toggle" type="button">\uB178\uD2B8 \uC228\uAE30\uAE30</button>
    <button id="interleaf-save" type="button">\uC774 \uD30C\uC77C\uC5D0 \uC800\uC7A5</button>
  `;
    document.body.appendChild(bar);
    const el = {
      count: document.getElementById("interleaf-count"),
      status: document.getElementById("interleaf-status"),
      target: document.getElementById("interleaf-target"),
      change: document.getElementById("interleaf-change"),
      forget: document.getElementById("interleaf-forget"),
      save: document.getElementById("interleaf-save"),
      toggle: document.getElementById("interleaf-toggle")
    };
    function renderCount(notes) {
      const orphans = restoreStatus.orphaned.length;
      el.count.textContent = `\uB178\uD2B8 ${notes.length}\uAC1C` + (orphans ? ` \xB7 \uC6D0\uBB38 \uBABB \uCC3E\uC74C ${orphans}\uAC1C` : "");
    }
    function renderStatus(status) {
      el.status.textContent = describeStatus(status);
      el.status.className = status.state === "failed" ? "bad" : status.state === "needs-permission" ? "warn" : "note";
      el.target.textContent = status.fileName ? `\u2192 ${describeTarget(status)}` : "";
      el.change.hidden = !status.fileName;
      el.forget.hidden = !status.fileName;
      el.save.textContent = status.state === "needs-permission" ? "\uC800\uC7A5 \uD5C8\uC6A9" : "\uC774 \uD30C\uC77C\uC5D0 \uC800\uC7A5";
    }
    layer.onChange = (notes) => {
      renderCount(notes);
      if (saver.fileHandle) saver.schedule();
    };
    renderCount(layer.toJSON());
    el.toggle.onclick = () => {
      const hidden = !("on" in el.toggle.dataset);
      if (hidden) el.toggle.dataset.on = "";
      else delete el.toggle.dataset.on;
      el.toggle.textContent = hidden ? "\uB178\uD2B8 \uBCF4\uC774\uAE30" : "\uB178\uD2B8 \uC228\uAE30\uAE30";
      layer.setNotesHidden(hidden);
    };
    const pickTarget = () => askWhereToSave((choice) => saver.chooseTarget(choice).then(() => saver.saveNow()));
    el.save.onclick = async () => {
      if (saver.state === "needs-permission") {
        const status = await saver.grant();
        if (status.state === "ready") await saver.saveNow();
        return;
      }
      if (!saver.fileHandle) {
        const picked = await pickTarget();
        if (!picked) {
          downloadCopy(build(layer, data), suggestedName(data));
        }
        return;
      }
      await saver.saveNow();
    };
    el.change.onclick = () => pickTarget();
    el.forget.onclick = () => saver.forget();
    saver.restoreFile();
    window.__interleaf = {
      layer,
      data,
      saver,
      status: restoreStatus,
      currentDocument: () => build(layer, data)
    };
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
