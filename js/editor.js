/* Scriptdesk — the script editor (contenteditable, one <div> per element) */
(function () {
  'use strict';
  const SD = window.SD;

  class ScriptEditor {
    constructor(root, opts) {
      this.root = root;
      this.opts = opts;
      this.doc = null;
      this.histories = {};
      this.typing = false;
      this.curBlock = null;
      this.lastCaret = null;
      this.lastSelectedText = '';
      this.ac = { open: false, items: [], index: 0, block: null, touched: false };

      this.acEl = document.createElement('div');
      this.acEl.className = 'autocomplete';
      this.acEl.hidden = true;
      document.body.appendChild(this.acEl);
      this.acEl.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const it = e.target.closest('[data-i]');
        if (it) { this.ac.index = +it.dataset.i; this.acceptAC(false); }
      });

      root.contentEditable = 'true';
      root.spellcheck = true;
      root.setAttribute('role', 'textbox');
      root.setAttribute('aria-multiline', 'true');
      root.addEventListener('keydown', (e) => this.onKeyDown(e));
      root.addEventListener('beforeinput', (e) => this.onBeforeInput(e));
      root.addEventListener('input', (e) => this.onInput(e));
      root.addEventListener('compositionend', () => this.onInput({}));
      root.addEventListener('paste', (e) => this.onPaste(e));
      root.addEventListener('copy', (e) => this.onCopy(e, false));
      root.addEventListener('cut', (e) => this.onCopy(e, true));
      root.addEventListener('drop', (e) => e.preventDefault());
      root.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== root) this.closeAC(); }, 150));
      document.addEventListener('selectionchange', () => this.onSelectionChange());
      window.addEventListener('resize', () => this.closeAC());
      root.closest('.view-scroll')?.addEventListener('scroll', () => this.closeAC(), { passive: true });
    }

    get type() { return SD.SCRIPT_TYPES[this.doc.scriptType] || SD.SCRIPT_TYPES.screenplay; }
    get hist() { return this.histories[this.doc.id]; }

    // ---------- loading & rendering ----------
    load(doc) {
      this.closeAC();
      this.flushTyping();
      this.doc = doc;
      this.root.dataset.scriptType = doc.scriptType;
      if (!this.histories[doc.id]) this.histories[doc.id] = { undo: [], redo: [] };
      this.render();
      this.lastState = this.snapshot();
    }

    render() {
      this.curBlock = null;
      const frag = document.createDocumentFragment();
      for (const e of this.doc.elements) frag.appendChild(this.makeBlock(e));
      this.root.replaceChildren(frag);
      this.ensureNotEmpty();
      this.refreshMarks();
    }

    makeBlock(e) {
      const d = document.createElement('div');
      d.className = 'el';
      d.dataset.type = e.type;
      d.dataset.id = e.id;
      const open = e.comments ? e.comments.filter((c) => !c.done).length : 0;
      if (open) d.dataset.comments = open;
      this.setBlockText(d, e.text, e.fmt);
      return d;
    }

    // Formatting runs of a block, read from its <b>/<i>/<u> (and any pasted styles).
    blockFmt(block) {
      const runs = [];
      let pos = 0;
      const walk = (node, flags) => {
        for (const c of node.childNodes) {
          if (c.nodeType === 3) { const t = c.data.replace(/\u200b/g, ''); if (t.length && flags) runs.push([pos, pos + t.length, flags]); pos += t.length; continue; }
          if (c.nodeType !== 1) continue;
          let f = flags;
          const tag = c.tagName;
          if (tag === 'B' || tag === 'STRONG') f |= 1;
          if (tag === 'I' || tag === 'EM') f |= 2;
          if (tag === 'U') f |= 4;
          const st = c.style;
          if (st) {
            const w = st.fontWeight;
            if (w === 'bold' || +w >= 600) f |= 1; else if (w === 'normal' || (w && +w < 600)) f &= ~1;
            if (st.fontStyle === 'italic') f |= 2; else if (st.fontStyle === 'normal') f &= ~2;
            const td = st.textDecorationLine || st.textDecoration || '';
            if (/underline/.test(td)) f |= 4; else if (td === 'none') f &= ~4;
          }
          walk(c, f);
        }
      };
      walk(block, 0);
      return SD.fmtClean(runs);
    }

    // Only <b>, <i>, <u> without attributes (or a lone <br>) count as tidy.
    isTidy(block) {
      for (const el of block.querySelectorAll('*')) {
        if (el.tagName === 'BR') continue;
        if (!['B', 'I', 'U'].includes(el.tagName) || el.attributes.length) return false;
      }
      return true;
    }

    format(kind) {
      if (!this.doc) return;
      const cmd = { b: 'bold', i: 'italic', u: 'underline' }[kind];
      const sel = getSelection();
      if (!sel.rangeCount || sel.isCollapsed || !this.root.contains(sel.anchorNode)) return;
      this.checkpoint();
      const r = sel.getRangeAt(0);
      const a = this.blockOf(r.startContainer), z = this.blockOf(r.endContainer);
      const keep = a && z ? { a: this.blocks().indexOf(a), as: this.offsetIn(a, r.startContainer, r.startOffset), z: this.blocks().indexOf(z), zs: this.offsetIn(z, r.endContainer, r.endOffset) } : null;
      try { document.execCommand('styleWithCSS', false, false); } catch (e) { /* older browsers */ }
      document.execCommand(cmd, false, null);
      this.afterChange();
      if (keep) {
        const bs = this.blocks();
        const ra = bs[keep.a] && this.rangeIn(bs[keep.a], keep.as, keep.as), rz = bs[keep.z] && this.rangeIn(bs[keep.z], keep.zs, keep.zs);
        if (ra && rz) { const rr = document.createRange(); rr.setStart(ra.startContainer, ra.startOffset); rr.setEnd(rz.startContainer, rz.startOffset); sel.removeAllRanges(); sel.addRange(rr); }
      }
    }

    // Lines with open comments carry data-comments (drawn as a marker by the CSS).
    refreshMarks() {
      if (!this.doc) return;
      const byId = new Map(this.doc.elements.map((e) => [e.id, e]));
      let dual = false;
      for (const b of this.blocks()) {
        const e = byId.get(b.dataset.id);
        const n = e && e.comments ? e.comments.filter((c) => !c.done).length : 0;
        if (n) b.dataset.comments = n; else delete b.dataset.comments;
        const t = b.dataset.type;
        if (t === 'character') dual = !!(e && e.dual);
        else if (!SD.SPEECH_TYPES.has(t)) dual = false;
        if (dual) b.dataset.dual = '1'; else delete b.dataset.dual;
      }
      if (this.opts.onRender) this.opts.onRender();
    }

    // A DOM range over characters start…end of a block's text.
    rangeIn(block, start, end) {
      const r = document.createRange();
      const w = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      let n, pos = 0, okStart = false;
      while ((n = w.nextNode())) {
        const len = n.length;
        if (!okStart && start <= pos + len) { r.setStart(n, start - pos); okStart = true; }
        if (okStart && end <= pos + len) { r.setEnd(n, end - pos); return r; }
        pos += len;
      }
      return null;
    }

    // Where the selection (or the cursor) is: block, character offsets and selected text.
    selectionInfo() {
      const sel = getSelection();
      if (sel.rangeCount && this.root.contains(sel.anchorNode)) {
        const r = sel.getRangeAt(0);
        const a = this.blockOf(r.startContainer), z = this.blockOf(r.endContainer);
        if (a) {
          const start = this.offsetIn(a, r.startContainer, r.startOffset);
          const end = a === z ? this.offsetIn(a, r.endContainer, r.endOffset) : this.blockText(a).length;
          return { block: a, start, end, text: this.blockText(a).slice(start, end) };
        }
      }
      const b = this.curBlock || (this.lastCaret && this.blocks()[this.lastCaret.index]);
      return b ? { block: b, start: 0, end: 0, text: '' } : null;
    }

    selectRange(id, start, end, focus = true) {
      const b = this.root.querySelector(`[data-id="${CSS.escape(id)}"]`);
      if (!b) return false;
      const r = this.rangeIn(b, start, end);
      if (focus) this.root.focus({ preventScroll: true });
      if (r) { const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
      b.scrollIntoView({ block: 'center' });
      return true;
    }

    setBlockText(d, text, fmt) {
      if (fmt && fmt.length && text) SD.fillFormatted(d, text, fmt);
      else d.textContent = text || '';
      if (!text) d.appendChild(document.createElement('br'));
      d.classList.toggle('is-empty', !text);
    }

    blockText(d) { return d.textContent.replace(/​/g, ''); }
    blocks() { return Array.from(this.root.children); }

    ensureNotEmpty() {
      if (!this.root.firstElementChild) {
        const e = { id: SD.uid(), type: this.type.sceneType, text: '' };
        this.doc.elements = [e];
        this.root.appendChild(this.makeBlock(e));
      }
    }

    blockOf(n) {
      if (!n) return null;
      if (n === this.root) return this.root.children[0] || null;
      while (n && n.parentNode !== this.root) n = n.parentNode;
      return n && n.nodeType === 1 ? n : null;
    }

    // ---------- DOM -> model ----------
    sync() {
      if (!this.doc) return;
      const old = new Map(this.doc.elements.map((e) => [e.id, e]));
      const seen = new Set();
      const out = [];
      for (const b of this.blocks()) {
        let id = b.dataset.id;
        if (!id || seen.has(id)) { id = SD.uid(); b.dataset.id = id; }
        seen.add(id);
        const type = b.dataset.type || 'action';
        const text = this.blockText(b).replace(/\n/g, ' ');
        const fmt = b.querySelector('b, i, u, strong, em, span, font') ? this.blockFmt(b) : [];
        const prev = old.get(id);
        const e = prev || { id };
        e.type = type; e.text = text;
        if (fmt.length) e.fmt = fmt; else delete e.fmt;
        out.push(e);
      }
      this.doc.elements = out;
    }

    // Keep the DOM tidy: only <div class="el"> children holding plain text.
    normalize() {
      const sel = getSelection();
      const caret = this.saveCaret();
      let changed = false, strayCaret = null;
      for (const n of Array.from(this.root.childNodes)) {
        if (n.nodeType === 1 && n.tagName === 'DIV' && n.classList.contains('el') && n.dataset.type) continue;
        if (n.nodeType !== 1 && n.nodeType !== 3) { n.remove(); continue; }
        const hadCaret = sel.rangeCount && (n === sel.anchorNode || n.contains(sel.anchorNode));
        const type = (n.nodeType === 1 && n.dataset && n.dataset.type) || 'action';
        const d = this.makeBlock({ id: SD.uid(), type, text: n.textContent });
        if (n.nodeType === 1 && n.tagName === 'BR' && this.root.childNodes.length > 1) { n.remove(); changed = true; continue; }
        n.replaceWith(d);
        changed = true;
        if (hadCaret) strayCaret = d;
      }
      for (const b of this.blocks()) {
        const bad = !this.isTidy(b);
        const t = this.blockText(b);
        if (bad) { this.setBlockText(b, t, this.blockFmt(b)); changed = true; }
        else if (t && b.querySelector('br')) { b.querySelectorAll('br').forEach((x) => x.remove()); changed = true; }
        else if (!t && !b.querySelector('br')) { b.appendChild(document.createElement('br')); }
        b.classList.toggle('is-empty', !t);
        if (b.hasAttribute('style')) b.removeAttribute('style');
      }
      if (strayCaret) this.setCaret(strayCaret, this.blockText(strayCaret).length);
      else if (changed && caret) this.restoreCaret(caret);
      this.ensureNotEmpty();
    }

    // ---------- caret helpers ----------
    currentBlock() {
      const sel = getSelection();
      if (!sel.rangeCount || !this.root.contains(sel.focusNode)) return null;
      if (sel.focusNode === this.root) return this.root.children[Math.min(sel.focusOffset, this.root.children.length - 1)] || null;
      return this.blockOf(sel.focusNode);
    }

    offsetIn(block, node, offset) {
      const r = document.createRange();
      r.selectNodeContents(block);
      try { r.setEnd(node, offset); } catch (e) { return 0; }
      return r.toString().length;
    }

    caretOffset(block) {
      const sel = getSelection();
      if (!sel.rangeCount || !block.contains(sel.focusNode)) return this.blockText(block).length;
      return this.offsetIn(block, sel.focusNode, sel.focusOffset);
    }

    saveCaret() {
      const b = this.currentBlock();
      if (!b) return null;
      return { index: this.blocks().indexOf(b), offset: this.caretOffset(b) };
    }

    restoreCaret(c) {
      const bs = this.blocks();
      const b = bs[Math.max(0, Math.min(c.index, bs.length - 1))];
      if (b) this.setCaret(b, c.offset);
    }

    setCaret(block, offset) {
      const sel = getSelection();
      const r = document.createRange();
      const w = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      let n, rem = offset, last = null, placed = false;
      while ((n = w.nextNode())) {
        last = n;
        if (rem <= n.length) { r.setStart(n, rem); placed = true; break; }
        rem -= n.length;
      }
      if (!placed) { if (last) r.setStart(last, last.length); else r.setStart(block, 0); }
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    }

    selectedBlocks() {
      const sel = getSelection();
      if (!sel.rangeCount) return [];
      const r = sel.getRangeAt(0);
      const a = this.blockOf(r.startContainer), z = this.blockOf(r.endContainer);
      const bs = this.blocks();
      const i = bs.indexOf(a), j = bs.indexOf(z);
      if (i < 0) return [];
      return bs.slice(i, (j < 0 ? i : j) + 1);
    }

    focusEditor() {
      if (document.activeElement !== this.root) {
        this.root.focus({ preventScroll: true });
        if (this.lastCaret) this.restoreCaret(this.lastCaret);
      }
    }

    goTo(id) {
      const b = this.root.querySelector(`[data-id="${CSS.escape(id)}"]`);
      if (!b) return;
      this.root.focus({ preventScroll: true });
      this.setCaret(b, 0);
      b.scrollIntoView({ block: 'center' });
    }

    scrollToBlock(b) {
      const r = b.getBoundingClientRect();
      const host = this.root.closest('.view-scroll');
      if (!host) return;
      const hr = host.getBoundingClientRect();
      if (r.bottom > hr.bottom - 40 || r.top < hr.top + 20) b.scrollIntoView({ block: 'nearest' });
    }

    // ---------- undo / redo ----------
    snapshot() { return { els: JSON.stringify(this.doc.elements), caret: this.saveCaret() }; }

    pushUndo(s) {
      const h = this.hist;
      if (!s || (h.undo.length && h.undo[h.undo.length - 1].els === s.els)) return;
      h.undo.push(s);
      if (h.undo.length > 400) h.undo.shift();
      h.redo.length = 0;
    }

    flushTyping() { this.typing = false; clearTimeout(this.typingTimer); }

    checkpoint() {
      this.flushTyping();
      this.sync();
      this.pushUndo(this.snapshot());
    }

    undo() {
      if (!this.doc) return;
      this.flushTyping();
      this.sync();
      const h = this.hist;
      const cur = this.snapshot();
      let s = h.undo.pop();
      while (s && s.els === cur.els) s = h.undo.pop();
      if (!s) return;
      h.redo.push(cur);
      this.restore(s);
    }

    redo() {
      if (!this.doc) return;
      const h = this.hist;
      const s = h.redo.pop();
      if (!s) return;
      this.sync();
      h.undo.push(this.snapshot());
      this.restore(s);
    }

    restore(s) {
      this.closeAC();
      this.doc.elements = JSON.parse(s.els);
      this.render();
      this.root.focus({ preventScroll: true });
      if (s.caret) this.restoreCaret(s.caret);
      this.lastState = this.snapshot();
      this.opts.onChange();
      this.onSelectionChange();
    }

    // Call when something outside the editor edited the elements (synopsis etc.)
    refreshState() { if (this.doc) this.lastState = this.snapshot(); }

    afterChange() {
      this.normalize();
      this.sync();
      this.refreshMarks();
      this.lastState = this.snapshot();
      this.opts.onChange();
      this.onSelectionChange(true);
    }

    // ---------- element types ----------
    applyType(b, nt, caretHere = true) {
      const old = b.dataset.type;
      const text = this.blockText(b);
      b.dataset.type = nt;
      if (nt === 'parenthetical' && old !== 'parenthetical') {
        if (!text.trim()) { this.setBlockText(b, '()'); if (caretHere) this.setCaret(b, 1); }
        else if (!text.startsWith('(')) { const lead = text.length - text.trimStart().length; const t = '(' + text.trim() + ')'; this.setBlockText(b, t, SD.fmtShift(SD.fmtSlice(this.blockFmt(b), lead, lead + text.trim().length), 1)); if (caretHere) this.setCaret(b, t.length - 1); }
      } else if (old === 'parenthetical' && nt !== 'parenthetical') {
        const m = text.match(/^\((.*)\)$/);
        if (m) { this.setBlockText(b, m[1], SD.fmtSlice(this.blockFmt(b), 1, 1 + m[1].length)); if (caretHere) this.setCaret(b, m[1].length); }
      }
    }

    setType(t) {
      if (!this.doc) return;
      this.focusEditor();
      this.checkpoint();
      const bs = this.selectedBlocks();
      for (const b of bs) this.applyType(b, t, bs.length === 1);
      this.afterChange();
      this.updateAC();
    }

    // ---------- keyboard ----------
    onKeyDown(e) {
      const mod = e.ctrlKey || e.metaKey;
      if (this.ac.open) {
        if (e.key === 'ArrowDown') { e.preventDefault(); this.moveAC(1); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); this.moveAC(-1); return; }
        // On an empty line the list is only a hint: Tab/Enter keep their normal meaning
        // unless you typed something or moved through the list with the arrow keys.
        const engaged = this.ac.touched || this.blockText(this.ac.block).length > 0;
        if (e.key === 'Tab' && !e.shiftKey && engaged) { e.preventDefault(); this.acceptAC(false); return; }
        if (e.key === 'Enter' && !e.shiftKey && engaged) { e.preventDefault(); this.acceptAC(true); return; }
        if (e.key === 'Escape') { e.preventDefault(); this.closeAC(); return; }
      }
      if (mod && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); return; }
        if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); this.redo(); return; }
        if (/^[1-9]$/.test(e.key)) {
          const t = this.type.elements[+e.key - 1];
          if (t) { e.preventDefault(); this.setType(t); }
          return;
        }
        if (k === 'b' || k === 'i' || k === 'u') { e.preventDefault(); this.format(k); return; }
      }
      if (e.key === 'Enter' && !mod) { e.preventDefault(); this.handleEnter(e.shiftKey); return; }
      if (e.key === 'Tab' && !mod) { e.preventDefault(); this.handleTab(e.shiftKey); return; }
    }

    onBeforeInput(e) {
      switch (e.inputType) {
        case 'historyUndo': e.preventDefault(); this.undo(); return;
        case 'historyRedo': e.preventDefault(); this.redo(); return;
        case 'insertParagraph': e.preventDefault(); this.handleEnter(false); return;
        case 'insertLineBreak': e.preventDefault(); this.handleEnter(true); return;
        case 'insertFromDrop': e.preventDefault(); return;
        case 'formatBold': case 'formatItalic': case 'formatUnderline': e.preventDefault(); this.format({ formatBold: 'b', formatItalic: 'i', formatUnderline: 'u' }[e.inputType]); return;
        case 'insertText': {
          // typing ")" right before an existing ")" just steps over it
          if (e.data === ')') {
            const b = this.currentBlock();
            const sel = getSelection();
            if (b && sel.isCollapsed && b.dataset.type === 'parenthetical') {
              const t = this.blockText(b), off = this.caretOffset(b);
              if (t[off] === ')') { e.preventDefault(); this.setCaret(b, off + 1); }
            }
          }
        }
      }
    }

    handleEnter(keepType) {
      this.closeAC();
      this.checkpoint();
      const sel = getSelection();
      if (sel.rangeCount && !sel.isCollapsed) {
        const r = sel.getRangeAt(0);
        const a = this.blockOf(r.startContainer), z = this.blockOf(r.endContainer);
        r.deleteContents();
        if (a !== z && z && z.isConnected) {
          this.normalize();
          this.setCaret(z, 0);
          this.afterChange();
          return;
        }
        this.normalize();
      }
      const b = this.currentBlock();
      if (!b) return;
      const text = this.blockText(b);
      let off = this.caretOffset(b);
      const type = b.dataset.type;

      const emptyParen = type === 'parenthetical' && /^\(\s*\)$/.test(text);
      if ((!text.trim() || emptyParen) && !keepType && type !== 'page' && type !== 'panel') {
        const nt = type === 'action' ? this.type.sceneType : emptyParen ? 'dialogue' : 'action';
        this.applyType(b, nt);
        this.setBlockText(b, '');
        this.setCaret(b, 0);
        this.afterChange();
        this.updateAC();
        return;
      }
      if (type === 'parenthetical' && text.slice(off).trim() === ')') off = text.length;
      if (off === 0 && text.length) {
        const nb = this.makeBlock({ id: SD.uid(), type, text: '' });
        b.before(nb);
        this.setCaret(b, 0);
        this.afterChange();
        return;
      }
      const before = text.slice(0, off);
      const after = text.slice(off);
      const fmt = this.blockFmt(b);
      const newType = keepType || after.length ? type : this.type.enter[type] || 'action';
      this.setBlockText(b, before, SD.fmtSlice(fmt, 0, off));
      const nb = this.makeBlock({ id: SD.uid(), type: newType, text: after, fmt: SD.fmtSlice(fmt, off, text.length) });
      b.after(nb);
      this.setCaret(nb, 0);
      this.afterChange();
      this.scrollToBlock(nb);
      this.updateAC();
    }

    handleTab(shift) {
      const b = this.currentBlock();
      if (!b) return;
      this.closeAC();
      this.checkpoint();
      const type = b.dataset.type;
      const list = this.type.elements;
      let nt;
      if (shift) nt = list[(list.indexOf(type) - 1 + list.length) % list.length];
      else nt = this.type.tab[type] || 'action';
      this.applyType(b, nt);
      this.afterChange();
      this.updateAC();
    }

    // ---------- typing ----------
    onInput(e) {
      if (e.isComposing || !this.doc) return;
      if (!this.typing) { this.typing = true; this.pushUndo(this.lastState); }
      clearTimeout(this.typingTimer);
      this.typingTimer = setTimeout(() => { this.typing = false; }, 700);
      this.normalize();
      const b = this.currentBlock();
      if (b) {
        const t = this.blockText(b);
        // "int. " typed into an action line becomes a scene heading
        if (b.dataset.type === 'action' && this.type.sceneType === 'scene' && /^(int|ext|est|int\.?\/ext|i\/e)\.\s/i.test(t) && this.type.elements.includes('scene')) {
          b.dataset.type = 'scene';
        }
        // "(" typed into an empty dialogue becomes a parenthetical
        if (b.dataset.type === 'dialogue' && t === '(' && this.type.elements.includes('parenthetical')) {
          b.dataset.type = 'parenthetical';
          this.setBlockText(b, '()');
          this.setCaret(b, 1);
        }
      }
      this.sync();
      this.lastState = this.snapshot();
      this.opts.onChange();
      this.onSelectionChange(true);
      this.ac.touched = false;
      this.updateAC();
    }

    // ---------- clipboard ----------
    onCopy(e, cut) {
      const sel = getSelection();
      if (!sel.rangeCount || sel.isCollapsed) return;
      const r = sel.getRangeAt(0);
      const sb = this.blockOf(r.startContainer), eb = this.blockOf(r.endContainer);
      if (!sb || !eb) return;
      const bs = this.blocks();
      const i0 = bs.indexOf(sb), i1 = bs.indexOf(eb);
      const items = [];
      for (let i = i0; i <= i1; i++) {
        const b = bs[i];
        const t = this.blockText(b);
        const s = i === i0 ? this.offsetIn(b, r.startContainer, r.startOffset) : 0;
        const en = i === i1 ? this.offsetIn(b, r.endContainer, r.endOffset) : t.length;
        const f = SD.fmtSlice(this.blockFmt(b), s, en);
        items.push(f.length ? { type: b.dataset.type, text: t.slice(s, en), fmt: f } : { type: b.dataset.type, text: t.slice(s, en) });
      }
      e.preventDefault();
      e.clipboardData.setData('text/plain', items.map((x) => x.text).join('\n'));
      e.clipboardData.setData('application/x-scriptdesk', JSON.stringify(items));
      if (cut) {
        this.checkpoint();
        const startOff = this.offsetIn(sb, r.startContainer, r.startOffset);
        r.deleteContents();
        if (sb !== eb && eb.isConnected) {
          const ta = this.blockText(sb);
          this.setBlockText(sb, ta + this.blockText(eb), [...this.blockFmt(sb), ...SD.fmtShift(this.blockFmt(eb), ta.length)]);
          eb.remove();
        }
        this.normalize();
        this.setCaret(sb, startOff);
        this.afterChange();
      }
    }

    onPaste(e) {
      e.preventDefault();
      const cd = e.clipboardData;
      const text = (cd.getData('text/plain') || '').replace(/\r\n?/g, '\n');
      let items = null;
      try { const raw = cd.getData('application/x-scriptdesk'); if (raw) items = JSON.parse(raw); } catch (err) { items = null; }
      if (!items && !text) return;
      if (!items && !text.includes('\n')) { document.execCommand('insertText', false, text); return; }
      if (!items) items = SD.Fountain.parse(text).elements.map((x) => ({ type: x.type, text: x.text }));
      items = items.map((x) => ({ type: this.type.elements.includes(x.type) ? x.type : 'action', text: x.text || '', fmt: Array.isArray(x.fmt) ? x.fmt : undefined }));
      if (!items.length) return;

      this.checkpoint();
      const sel = getSelection();
      if (!sel.isCollapsed) {
        const r = sel.getRangeAt(0);
        const a = this.blockOf(r.startContainer), z = this.blockOf(r.endContainer);
        const off = a ? this.offsetIn(a, r.startContainer, r.startOffset) : 0;
        r.deleteContents();
        if (a && z && a !== z && z.isConnected) { const ta = this.blockText(a); this.setBlockText(a, ta + this.blockText(z), [...this.blockFmt(a), ...SD.fmtShift(this.blockFmt(z), ta.length)]); z.remove(); }
        this.normalize();
        if (a) this.setCaret(a, off);
      }
      const b = this.currentBlock();
      if (!b) return;
      const t = this.blockText(b), off = this.caretOffset(b);
      const before = t.slice(0, off), after = t.slice(off);
      const bf = this.blockFmt(b);
      // single fragment from within one element: paste inline
      if (items.length === 1) {
        const n = items[0].text.length;
        this.setBlockText(b, before + items[0].text + after, [...SD.fmtSlice(bf, 0, off), ...SD.fmtShift(items[0].fmt || [], off), ...SD.fmtShift(SD.fmtSlice(bf, off, t.length), off + n)]);
        this.setCaret(b, before.length + items[0].text.length);
        this.afterChange();
        return;
      }
      const nbs = items.map((x) => this.makeBlock({ id: SD.uid(), type: x.type, text: x.text, fmt: x.fmt }));
      const last = nbs[nbs.length - 1];
      if (before) {
        this.setBlockText(b, before, SD.fmtSlice(bf, 0, off));
        b.after(...nbs);
        if (after) last.after(this.makeBlock({ id: SD.uid(), type: b.dataset.type, text: after, fmt: SD.fmtSlice(bf, off, t.length) }));
      } else {
        b.before(...nbs);
        if (after) this.setBlockText(b, after, SD.fmtSlice(bf, off, t.length));
        else b.remove();
      }
      this.setCaret(last, this.blockText(last).length);
      this.afterChange();
      this.scrollToBlock(last);
    }

    // ---------- selection tracking ----------
    onSelectionChange(force) {
      if (!this.doc) return;
      const sel = getSelection();
      if (!sel.rangeCount || !this.root.contains(sel.focusNode)) return;
      const b = this.currentBlock();
      if (!b) return;
      if (!sel.isCollapsed) this.lastSelectedText = sel.toString().trim();
      this.lastCaret = this.saveCaret();
      if (b !== this.curBlock || force) {
        if (this.curBlock && this.curBlock !== b) this.curBlock.classList.remove('current');
        b.classList.add('current');
        this.curBlock = b;
        if (this.ac.open && this.ac.block !== b) this.closeAC();
      }
      b.dataset.label = SD.labelFor(this.doc.scriptType, b.dataset.type);
      this.opts.onCaret({ block: b, index: this.blocks().indexOf(b), type: b.dataset.type });
    }

    // ---------- autocomplete ----------
    updateAC() {
      const b = this.currentBlock();
      const sel = getSelection();
      if (!b || !sel.isCollapsed) return this.closeAC();
      const text = this.blockText(b);
      if (this.caretOffset(b) !== text.length) return this.closeAC();
      const items = (this.opts.getSuggestions(this.doc, b.dataset.type, text) || []).slice(0, 10);
      if (!items.length) return this.closeAC();
      const keep = this.ac.open && this.ac.block === b;
      this.ac = { open: true, items, index: 0, block: b, touched: keep ? this.ac.touched : false };
      this.renderAC();
    }

    renderAC() {
      const { items, index } = this.ac;
      this.acEl.replaceChildren(...items.map((it, i) => {
        const d = document.createElement('div');
        d.className = 'ac-item' + (i === index ? ' active' : '');
        d.dataset.i = i;
        d.textContent = it.label;
        if (it.hint) { const s = document.createElement('span'); s.className = 'ac-hint'; s.textContent = it.hint; d.appendChild(s); }
        return d;
      }));
      this.acEl.hidden = false;
      const sel = getSelection();
      let rect = null;
      if (sel.rangeCount) {
        const r = sel.getRangeAt(0).cloneRange();
        const rects = r.getClientRects();
        rect = rects.length ? rects[rects.length - 1] : null;
      }
      const br = this.ac.block.getBoundingClientRect();
      const left = rect && rect.width + rect.height ? rect.left : br.left;
      const bottom = rect && rect.height ? rect.bottom : br.top + 18;
      const w = this.acEl.offsetWidth, hgt = this.acEl.offsetHeight;
      let top = bottom + 4;
      if (top + hgt > window.innerHeight - 8) top = Math.max(8, (rect ? rect.top : br.top) - hgt - 4);
      this.acEl.style.left = Math.max(8, Math.min(left, window.innerWidth - w - 8)) + 'px';
      this.acEl.style.top = top + 'px';
      this.acEl.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
    }

    moveAC(d) {
      const n = this.ac.items.length;
      this.ac.index = (this.ac.index + d + n) % n;
      this.ac.touched = true;
      this.renderAC();
    }

    closeAC() {
      if (!this.ac.open) return;
      this.ac = { open: false, items: [], index: 0, block: null, touched: false };
      this.acEl.hidden = true;
    }

    acceptAC(isEnter) {
      const it = this.ac.items[this.ac.index];
      const b = this.ac.block;
      this.closeAC();
      if (!it || !b || !b.isConnected) return;
      this.checkpoint();
      this.setBlockText(b, it.value);
      this.setCaret(b, it.value.length);
      this.afterChange();
      if (isEnter && it.complete) this.handleEnter(false);
      else if (!it.complete) this.updateAC();
    }
  }

  SD.ScriptEditor = ScriptEditor;
})();
