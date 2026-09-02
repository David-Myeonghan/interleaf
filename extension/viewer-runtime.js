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
  function serializeDocument({ notes, runtimeJs, runtimeCss, source }) {
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
      data.textContent = JSON.stringify({ version: 1, source, notes }, null, 2);
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
  function replaceNode(parent, id, build) {
    const fresh = build();
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

  // src/viewer-entry.js
  var RUNTIME_ID2 = "interleaf-runtime";
  var RUNTIME_STYLE_ID2 = "interleaf-runtime-style";
  function readData() {
    const el = document.getElementById(DATA_ID);
    if (!el) return { version: 1, source: {}, notes: [] };
    try {
      return JSON.parse(el.textContent);
    } catch {
      return { version: 1, source: {}, notes: [], parseError: true };
    }
  }
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
#interleaf-bar .note { color: #9aa3b2; }
`;
  function currentDocument(layer, data) {
    return serializeDocument({
      notes: layer.toJSON(),
      runtimeJs: document.getElementById(RUNTIME_ID2)?.textContent ?? "",
      runtimeCss: document.getElementById(RUNTIME_STYLE_ID2)?.textContent ?? "",
      source: data.source ?? {}
    });
  }
  function download(html, name) {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3e4);
  }
  function mountBar(layer, data, status) {
    const style = document.createElement("style");
    style.id = "interleaf-bar-style";
    style.textContent = BAR_STYLE;
    document.head.appendChild(style);
    const bar = document.createElement("div");
    bar.id = "interleaf-bar";
    bar.innerHTML = `
    <strong>Interleaf</strong>
    <span class="note" id="interleaf-count"></span>
    <span class="grow note" id="interleaf-source"></span>
    <button id="interleaf-toggle" type="button">\uB178\uD2B8 \uC228\uAE30\uAE30</button>
    <button id="interleaf-save" type="button">\uC0AC\uBCF8 \uB0B4\uB824\uBC1B\uAE30</button>
  `;
    document.body.appendChild(bar);
    const count = document.getElementById("interleaf-count");
    const render = (notes) => {
      const orphans = status.orphaned.length;
      count.textContent = `\uB178\uD2B8 ${notes.length}\uAC1C` + (orphans ? ` \xB7 \uC6D0\uBB38 \uBABB \uCC3E\uC74C ${orphans}\uAC1C` : "");
    };
    layer.onChange = render;
    render(layer.toJSON());
    document.getElementById("interleaf-source").textContent = data.source?.url ?? location.href;
    const toggle = document.getElementById("interleaf-toggle");
    toggle.onclick = () => {
      const hidden = !("on" in toggle.dataset);
      if (hidden) toggle.dataset.on = "";
      else delete toggle.dataset.on;
      toggle.textContent = hidden ? "\uB178\uD2B8 \uBCF4\uC774\uAE30" : "\uB178\uD2B8 \uC228\uAE30\uAE30";
      layer.setNotesHidden(hidden);
    };
    document.getElementById("interleaf-save").onclick = () => {
      const name = (data.source?.title || document.title || "page").replace(/[\/\\?%*:|"<>]/g, " ").slice(0, 80);
      download(currentDocument(layer, data), `${name}.html`);
    };
  }
  function boot() {
    const data = readData();
    const layer = new NoteLayer();
    layer.mount();
    const status = layer.restore(data.notes ?? []);
    mountBar(layer, data, status);
    window.__interleaf = { layer, data, status, currentDocument: () => currentDocument(layer, data) };
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
