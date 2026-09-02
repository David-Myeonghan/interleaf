// The note layer: turns a drag into a highlight plus a card, and keeps the cards
// where they belong. Anchor resolution on reload is M3 and lives elsewhere.

import * as hl from './highlight.js';
import { place, drawLeader } from './layout.js';
import { applyGutter } from './gutter.js';
import { fromRange, toRange } from './anchor.js';

const QUOTE_CLAMP = 140;

export class NoteLayer {
  /** @param {{onChange?: (notes: object[]) => void}} options */
  constructor({ onChange } = {}) {
    this.notes = new Map();
    this.onChange = onChange ?? (() => {});
    this.activeId = null;
    this.cardsHost = null;
    this.relayout = throttleToFrame(() => this.layout());
    this.redrawLeader = throttleToFrame(() => this.drawActiveLeader());
  }

  mount() {
    document.documentElement.dataset.interleaf = '';

    this.cardsHost = document.createElement('div');
    this.cardsHost.id = 'interleaf-cards';
    document.documentElement.appendChild(this.cardsHost);

    this.leaderHost = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.leaderHost.id = 'interleaf-leader';
    document.documentElement.appendChild(this.leaderHost);

    document.addEventListener('mouseup', (e) => this.onMouseUp(e));
    window.addEventListener('resize', this.relayout);
    // Images and webfonts settle after first paint and shift the text under the
    // marks, so a late relayout avoids cards that look one line off.
    window.addEventListener('load', this.relayout);
    // The leader is drawn in viewport coordinates, so scrolling invalidates it.
    window.addEventListener('scroll', this.redrawLeader, { passive: true });
    document.addEventListener('click', (e) => this.onDocumentClick(e));
  }

  setNotesHidden(hidden) {
    document.documentElement.dataset.interleaf = hidden ? 'notes-hidden' : '';
    if (!hidden) this.relayout();
  }

  onMouseUp(event) {
    if (event.target.closest?.('#interleaf-cards, #interleaf-bar')) return;
    if (document.documentElement.dataset.interleaf === 'notes-hidden') return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    if (!range.toString().trim()) return;

    selection.removeAllRanges();
    this.create(range);
  }

  create(range) {
    // The anchor is taken before painting: marks split text nodes, and the
    // offsets written to the file must describe the text a fresh load walks.
    const anchor = fromRange(range);
    if (!anchor) return null;

    const id = 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const marks = hl.paint(range, id);
    if (!marks.length) return null;

    const note = {
      id,
      anchor,
      body: '',
      collapsed: false,
      createdAt: new Date().toISOString(),
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
      const marks = hl.paint(found.range, note.id);
      if (!marks.length) {
        this.addCard({ ...note, orphaned: true });
        orphaned.push(note.id);
        continue;
      }
      this.addCard({ ...note, orphaned: false });
      if (found.how === 'quote') byQuote.push(note.id);
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
    hl.unpaint(id);
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
    if (!entry.note.collapsed) entry.card.querySelector('.il-card__body').focus();
  }

  setActive(id) {
    if (this.activeId && this.activeId !== id) {
      hl.setActive(this.activeId, false);
      const prev = this.notes.get(this.activeId);
      if (prev) delete prev.card.dataset.active;
    }
    this.activeId = id;
    if (!id) { this.redrawLeader(); return; }
    hl.setActive(id, true);
    const entry = this.notes.get(id);
    if (entry) entry.card.dataset.active = '';
    this.redrawLeader();
  }

  toggleCollapsed(id, collapsed) {
    const entry = this.notes.get(id);
    if (!entry) return;
    entry.note.collapsed = collapsed ?? !entry.note.collapsed;
    if (entry.note.collapsed) entry.card.dataset.collapsed = '';
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
      anchorTop: hl.topOf(id) ?? (note.orphaned ? 0 : null),
    }));
    place(cards);
    this.drawActiveLeader();
  }

  drawActiveLeader() {
    if (!this.leaderHost) return;
    const entry = this.activeId ? this.notes.get(this.activeId) : null;
    const [mark] = this.activeId ? hl.marksFor(this.activeId) : [];
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
    const mark = event.target.closest?.('il-mark');
    if (mark) {
      const id = mark.dataset.noteId;
      const entry = this.notes.get(id);
      if (entry?.note.collapsed) this.toggleCollapsed(id, false);
      this.focus(id);
      return;
    }
    const card = event.target.closest?.('.il-card');
    if (card) {
      this.setActive(card.dataset.noteId);
      return;
    }
    this.setActive(null);
  }

  buildCard(note) {
    const card = document.createElement('div');
    card.className = 'il-card';
    card.dataset.noteId = note.id;
    if (note.collapsed) card.dataset.collapsed = '';

    if (note.orphaned) card.dataset.orphaned = '';

    const exact = note.anchor?.quote?.exact ?? '';
    const quote = document.createElement('p');
    quote.className = 'il-card__quote';
    quote.textContent = (exact.length > QUOTE_CLAMP ? exact.slice(0, QUOTE_CLAMP) + '…' : exact)
      || '(원문을 찾지 못했습니다)';

    const body = document.createElement('textarea');
    body.className = 'il-card__body';
    body.placeholder = '생각을 적으세요';
    body.value = note.body;
    body.rows = 1;
    body.addEventListener('input', () => {
      note.body = body.value;
      autosize(body);
      this.relayout();
      this.emit();
    });
    body.addEventListener('focus', () => this.setActive(note.id));

    const foot = document.createElement('div');
    foot.className = 'il-card__foot';
    const collapse = document.createElement('button');
    collapse.type = 'button';
    collapse.textContent = '접기';
    collapse.onclick = () => this.toggleCollapsed(note.id, true);
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '삭제';
    del.onclick = () => this.remove(note.id);
    foot.append(collapse, spacer, del);

    card.append(quote, body, foot);
    // Height is needed for layout, so size the textarea before the first place().
    requestAnimationFrame(() => autosize(body));
    return card;
  }
}

/** Grows the textarea to fit, up to the cap that notes.css imposes. */
function autosize(textarea) {
  textarea.style.height = 'auto';
  const cap = parseFloat(getComputedStyle(textarea).maxHeight);
  const wanted = textarea.scrollHeight;
  textarea.style.height = (Number.isFinite(cap) ? Math.min(wanted, cap) : wanted) + 'px';
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
