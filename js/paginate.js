/* Scriptdesk — the page engine: lays a script out on real pages, the way production scripts are paginated.
   12pt Courier: 10 characters per inch, 6 lines per inch. Positions are in inches from the page's top-left corner.
   Used by the page view, printing, the PDF export and every page number in the app. */
(function () {
  'use strict';
  const SD = (window.SD = window.SD || {});

  const LEFT = 1.5; // left margin
  const TOP = 1.0; // first text line
  const PAGE = { letter: { w: 8.5, h: 11, lines: 54 }, a4: { w: 8.27, h: 11.69, lines: 58 } };

  // where each element sits: indent from the left margin (in), width (characters), alignment, look
  const BASE = {
    scene: { indent: 0, width: 60, upper: true },
    action: { indent: 0, width: 60 },
    character: { indent: 2.2, width: 38, upper: true },
    parenthetical: { indent: 1.6, width: 24 },
    dialogue: { indent: 1.0, width: 35 },
    transition: { indent: 0, width: 60, upper: true, align: 'right' },
    shot: { indent: 0, width: 60, upper: true },
    general: { indent: 0, width: 60 },
    act: { indent: 0, width: 60, upper: true, align: 'center', bold: true, underline: true },
    sound: { indent: 0, width: 60, upper: true },
    music: { indent: 0, width: 60, upper: true },
  };
  const OVER = {
    stageplay: { scene: { align: 'center', underline: true }, character: { indent: 0, align: 'center' }, dialogue: { indent: 0, width: 60 }, parenthetical: { indent: 1.5, width: 30, italic: true }, action: { indent: 2.0, width: 40, italic: true } },
    audioplay: { character: { indent: 0 }, parenthetical: { indent: 1.5, width: 40 }, dialogue: { indent: 1.5, width: 45 }, sound: { indent: 1.5, width: 45, bold: true }, music: { indent: 1.5, width: 45, italic: true, underline: true }, action: { italic: true } },
    comic: { page: { indent: 0, width: 60, upper: true, bold: true, underline: true }, panel: { indent: 0, width: 60, upper: true, bold: true }, character: { indent: 1.5 }, dialogue: { indent: 1.0, width: 40 }, caption: { indent: 1.0, width: 50 }, sfx: { indent: 1.0, width: 50 } },
    sitcom: { scene: { underline: true }, action: { upper: true }, character: { indent: 2.5 }, parenthetical: { indent: 2.0, width: 25 }, dialogue: { indent: 1.5, width: 35, double: true } },
    av: { shot: { indent: 0, width: 28, upper: false, col: 'left' }, audio: { indent: 0, width: 28, col: 'right' }, character: { indent: 0.6, width: 22, col: 'right' }, parenthetical: { indent: 0.3, width: 24, col: 'right' }, dialogue: { indent: 0, width: 28, col: 'right' } },
  };
  SD.layoutFor = (scriptType, type) => Object.assign({ indent: 0, width: 60 }, BASE[type] || BASE.action, (OVER[scriptType] || {})[type] || {});
  const AV_RIGHT_X = 2.82 + 0.35; // second column of an AV script

  // Wrap text to a width; returns line pieces with their offsets in the text.
  function wrap(text, width) {
    const out = [];
    if (!text) return [{ s: 0, e: 0 }];
    let i = 0;
    const n = text.length;
    while (i < n) {
      while (i < n && text[i] === ' ') i++;
      if (i >= n) break;
      if (n - i <= width) { out.push({ s: i, e: n }); break; }
      let cut = text.lastIndexOf(' ', i + width);
      if (cut <= i) cut = i + width; // one very long word: break it
      out.push({ s: i, e: cut });
      i = cut;
    }
    return out.length ? out : [{ s: 0, e: 0 }];
  }
  SD.wrapOffsets = wrap;

  // The text as printed (capitals, PAGE / PANEL / CAPTION prefixes, parentheses) and its formatting runs.
  function printed(doc, e, ctr) {
    const shown = SD.displayText(doc.scriptType, e, ctr);
    const L = SD.layoutFor(doc.scriptType, e.type);
    const text = L.upper ? shown.toUpperCase() : shown;
    let fmt = e.fmt || [];
    if (fmt.length && shown !== e.text) {
      const at = shown.toUpperCase().indexOf((e.text || '').toUpperCase());
      fmt = at >= 0 ? SD.fmtShift(fmt, at) : [];
    }
    return { text, fmt };
  }

  // Signature of a script's contents, so the layout is only worked out again when something changed.
  const cache = new WeakMap();
  const sig = (doc, opts) => {
    let k = doc.scriptType + '|' + doc.elements.length + '|' + (opts.size || '') + '|' + (opts.rev || '');
    let h = 0;
    for (const e of doc.elements) { const t = e.type + (e.text || '') + (e.dual ? '^' : '') + (e.rev || '') + (e.sceneNo || ''); for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; }
    return k + '|' + h;
  };

  /* Lay out a script.
     Returns { pages: [{ no, lines: [{ row, x, text, fmt, style, elId, kind }] }], pageOf: Map(elementId -> page),
               breaks: [{ elId, frac }] (where each page starts), count, linesPerPage } */
  SD.paginate = (doc, opts = {}) => {
    const size = opts.size || 'letter';
    const key = sig(doc, opts);
    const hit = cache.get(doc);
    if (hit && hit.key === key) return hit.result;
    const P = PAGE[size] || PAGE.letter;
    const MAX = P.lines;
    const st = doc.scriptType;
    const els = doc.elements;
    const ctr = { page: 0, panel: 0 };
    const pages = [];
    const pageOf = new Map();
    const breaks = [];
    let page = null, row = 0;
    const newPage = () => { page = { no: pages.length + 1, lines: [] }; pages.push(page); row = 0; };
    newPage();
    const left = () => MAX - row;

    // one element as a list of printable lines
    const linesOf = (e) => {
      const L = SD.layoutFor(st, e.type);
      const { text, fmt } = printed(doc, e, ctr);
      return wrap(text, L.width).map((w) => ({ text: text.slice(w.s, w.e), fmt: SD.fmtSlice(fmt, w.s, w.e), style: L, elId: e.id, type: e.type, rev: e.rev || '' }));
    };
    const xOf = (L) => {
      const colX = L.col === 'right' ? AV_RIGHT_X : 0;
      return LEFT + colX + (L.indent || 0);
    };
    const put = (ln, extra) => {
      page.lines.push(Object.assign({ row, x: xOf(ln.style) }, ln, extra || {}));
      row += ln.style.double ? 2 : 1;
    };
    const space = (n) => { if (row > 0) row += n; };
    const startEl = (e, frac) => { if (!pageOf.has(e.id)) pageOf.set(e.id, page.no); if (row === 0 && pages.length > 1) breaks.push({ elId: e.id, frac: frac || 0 }); };
    const height = (lines) => lines.reduce((n, l) => n + (l.style.double ? 2 : 1), 0) - (lines.length && lines[lines.length - 1].style.double ? 1 : 0);
    const isSpeech = (t) => t === 'parenthetical' || t === 'dialogue';
    const before = (e) => (SD.SPACE_BEFORE[e.type] ?? 1);

    for (let i = 0; i < els.length; i++) {
      const e = els[i];
      // new pages: TV acts, sitcom scenes
      if (row > 0 && ((e.type === 'act' && !/^\s*END OF/i.test(e.text || '') && (st === 'teleplay' || st === 'sitcom')) || (st === 'sitcom' && e.type === 'scene' && !(i > 0 && els[i - 1].type === 'act')))) newPage();

      // ---- AV: video and audio side by side ----
      if (st === 'av' && (e.type === 'shot' || SD.AV_RIGHT && SD.AV_RIGHT.has(e.type))) {
        const leftEls = [], rightEls = [];
        let k = i;
        if (els[k].type === 'shot') { leftEls.push(els[k]); k++; }
        while (k < els.length && SD.AV_RIGHT.has(els[k].type)) { rightEls.push(els[k]); k++; }
        const L1 = leftEls.flatMap(linesOf);
        const R1 = rightEls.flatMap((x, j) => (j > 0 && x.type !== 'dialogue' && x.type !== 'parenthetical' ? [null] : []).concat(linesOf(x)));
        const hgt = Math.max(L1.length, R1.length);
        if (row > 0 && 1 + hgt > left()) newPage();
        space(1);
        const r0 = row;
        [...leftEls, ...rightEls].forEach((x) => startEl(x));
        L1.forEach((ln, j) => page.lines.push(Object.assign({ row: r0 + j, x: xOf(ln.style) }, ln)));
        R1.forEach((ln, j) => { if (ln) page.lines.push(Object.assign({ row: r0 + j, x: xOf(ln.style) }, ln)); });
        row = r0 + hgt;
        i = k - 1;
        continue;
      }

      // ---- a speech: character cue + parentheticals + dialogue (maybe two side by side) ----
      if (e.type === 'character') {
        const j = SD.speechEnd(els, i);
        const dual = els[j] && els[j].type === 'character' && els[j].dual ? SD.speechEnd(els, j) : 0;
        const speech = els.slice(i, j);
        if (dual) {
          const right = els.slice(j, dual);
          const colLines = (part, colX) => part.flatMap((x) => {
            const L = Object.assign({}, SD.layoutFor(st, x.type));
            const ind = x.type === 'character' ? 0.9 : x.type === 'parenthetical' ? 0.5 : 0;
            const { text, fmt } = printed(doc, x, ctr);
            return wrap(text, x.type === 'character' ? 20 : x.type === 'parenthetical' ? 22 : 28).map((w) => ({ text: text.slice(w.s, w.e), fmt: SD.fmtSlice(fmt, w.s, w.e), style: Object.assign(L, { double: false }), elId: x.id, type: x.type, rev: x.rev || '', x: LEFT + colX + ind }));
          });
          const A = colLines(speech, 0), B = colLines(right, 3.1);
          const hgt = Math.max(A.length, B.length);
          if (row > 0 && before(e) + hgt > left()) newPage();
          space(before(e));
          const r0 = row;
          [...speech, ...right].forEach((x) => startEl(x));
          A.forEach((ln, k) => page.lines.push(Object.assign({}, ln, { row: r0 + k })));
          B.forEach((ln, k) => page.lines.push(Object.assign({}, ln, { row: r0 + k })));
          row = r0 + hgt;
          i = dual - 1;
          continue;
        }
        const cue = linesOf(e);
        const body = speech.slice(1).map((x) => ({ el: x, lines: linesOf(x) }));
        const all = [...cue, ...body.flatMap((b) => b.lines)];
        const need = before(e) + height(all);
        if (row === 0 || need <= left()) {
          space(before(e));
          startEl(e);
          cue.forEach((ln) => put(ln));
          body.forEach((b) => { startEl(b.el); b.lines.forEach((ln) => put(ln)); });
          i = j - 1;
          continue;
        }
        // too long for what is left: split after a sentence, with (MORE) and (CONT'D)
        const room = left() - before(e) - height(cue) - 1; // one line kept for (MORE)
        const flat = body.flatMap((b) => b.lines.map((ln, k) => ({ ln, el: b.el, k, n: b.lines.length })));
        let cut = -1;
        if (room >= 2 && flat.length - Math.min(room, flat.length) >= 1) {
          let used = 0, lastSentence = -1, lastOk = -1;
          for (let k = 0; k < flat.length; k++) {
            used += flat[k].ln.style.double ? 2 : 1;
            if (used > room) break;
            lastOk = k;
            const t = flat[k].ln.text.trim();
            if (flat[k].el.type === 'dialogue' && (/[.!?…]["”’)]*$/.test(t) || flat[k].k === flat[k].n - 1) && k >= 1) lastSentence = k;
          }
          cut = lastSentence >= 1 ? lastSentence : lastOk >= 1 && flat[lastOk].el.type === 'dialogue' ? lastOk : -1;
          if (cut >= flat.length - 1) cut = -1;
          if (cut >= 0 && flat[cut + 1] && flat[cut].el.type === 'parenthetical' && flat[cut + 1].el.type !== 'parenthetical') cut--;
        }
        if (cut < 0) {
          newPage();
          startEl(e);
          cue.forEach((ln) => put(ln));
          body.forEach((b) => { startEl(b.el); b.lines.forEach((ln) => put(ln)); });
        } else {
          space(before(e));
          startEl(e);
          cue.forEach((ln) => put(ln));
          for (let k = 0; k <= cut; k++) { if (flat[k].k === 0) startEl(flat[k].el); put(flat[k].ln); }
          const charStyle = SD.layoutFor(st, 'character');
          put({ text: '(MORE)', fmt: [], style: charStyle, elId: e.id, type: 'character', rev: '', kind: 'more' });
          const splitEl = flat[cut + 1].el;
          const splitFrac = flat[cut + 1].k / flat[cut + 1].n;
          newPage();
          const name = SD.charName(e.text) || (e.text || '').toUpperCase();
          breaks.push({ elId: flat[cut + 1].k === 0 ? splitEl.id : splitEl.id, frac: splitFrac });
          put({ text: name + " (CONT'D)", fmt: [], style: charStyle, elId: e.id, type: 'character', rev: '', kind: 'contd' });
          for (let k = cut + 1; k < flat.length; k++) { if (flat[k].k === 0) startEl(flat[k].el); put(flat[k].ln); }
        }
        i = j - 1;
        continue;
      }

      // ---- everything else ----
      const lines = linesOf(e);
      const hgt = height(lines);
      // headings must not be the last thing on a page: keep them with two lines of what follows
      const keepWithNext = ['scene', 'act', 'page', 'panel', 'shot'].includes(e.type) || isSpeech(e.type);
      const nxt = els[i + 1];
      const follow = keepWithNext && nxt ? Math.min(2, nxt.type === 'character' ? 2 : wrap(nxt.text || '', SD.layoutFor(st, nxt.type).width).length) + (SD.SPACE_BEFORE[nxt.type] ?? 1) : 0;
      if (row > 0 && before(e) + hgt + follow > left()) {
        // action can break after a sentence when at least two lines stay on each side
        const room = left() - before(e);
        if (e.type === 'action' && room >= 2 && hgt - room >= 2) {
          let cut = -1;
          for (let k = 1; k < room && k < lines.length - 2; k++) if (/[.!?…]["”’)]*$/.test(lines[k].text.trim())) cut = k;
          if (cut < 1) cut = Math.min(room, lines.length - 2) - 1;
          space(before(e));
          startEl(e);
          for (let k = 0; k <= cut; k++) put(lines[k]);
          newPage();
          breaks.push({ elId: e.id, frac: (cut + 1) / lines.length });
          for (let k = cut + 1; k < lines.length; k++) put(lines[k]);
          continue;
        }
        newPage();
      }
      space(before(e));
      startEl(e);
      lines.forEach((ln) => put(ln));
    }
    // empty last page (only when the script is empty) stays
    const result = { pages, pageOf, breaks, count: pages.length, linesPerPage: MAX, size, page: P, top: TOP, left: LEFT };
    cache.set(doc, { key, result });
    return result;
  };
})();
