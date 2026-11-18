/* Scriptdesk — finished pages: one layout from the page engine, drawn as a PDF file or as printable HTML.
   The PDF uses the standard Courier fonts every PDF reader has, so it needs nothing from the internet. */
(function () {
  'use strict';
  const SD = (window.SD = window.SD || {});
  const CPI = 10, LPI = 6; // 12pt Courier

  // ---------- production: scene numbers (locked or not), OMITTED scenes, revision marks ----------
  SD.REVISION_COLORS = [
    ['Blue', '#a9c8ff'], ['Pink', '#ffc0d4'], ['Yellow', '#fff3a3'], ['Green', '#c3ecc0'], ['Goldenrod', '#f3d27a'],
    ['Buff', '#f2e0c0'], ['Salmon', '#ffb8a0'], ['Cherry', '#f08c9c'], ['Tan', '#d9c3a0'], ['Grey', '#d0d0d0'],
  ];
  SD.production = (doc) => {
    const pr = (doc.production = doc.production && typeof doc.production === 'object' ? doc.production : {});
    pr.revisions = Array.isArray(pr.revisions) ? pr.revisions : [];
    pr.numbers = pr.numbers && typeof pr.numbers === 'object' ? pr.numbers : {};
    pr.order = Array.isArray(pr.order) ? pr.order : [];
    return pr;
  };
  // Scene numbers: in order when unlocked; when locked, kept, with new scenes as 12A, 12B (or A1 before the first).
  SD.sceneNumbers = (doc) => {
    const pr = SD.production(doc);
    const st = (SD.SCRIPT_TYPES[doc.scriptType] || {}).sceneType;
    const scenes = doc.elements.filter((e) => e.type === st);
    const out = new Map();
    if (!pr.locked) { scenes.forEach((e, i) => out.set(e.id, String(i + 1))); return out; }
    let prev = null, letter = 0, before = 0;
    for (const e of scenes) {
      if (pr.numbers[e.id]) { prev = pr.numbers[e.id]; letter = 0; out.set(e.id, prev); continue; }
      if (prev == null) { before++; out.set(e.id, String.fromCharCode(64 + before) + (pr.order.length ? pr.numbers[pr.order[0]] || '1' : '1')); continue; }
      letter++;
      out.set(e.id, prev + SD.shotLetters(letter - 1));
    }
    return out;
  };
  // locked scenes that were deleted, with the scene they followed
  SD.omittedScenes = (doc) => {
    const pr = SD.production(doc);
    if (!pr.locked) return [];
    const have = new Set(doc.elements.map((e) => e.id));
    const out = [];
    pr.order.forEach((id, i) => {
      if (have.has(id)) return;
      let after = null;
      for (let k = i - 1; k >= 0; k--) if (have.has(pr.order[k])) { after = pr.order[k]; break; }
      out.push({ id, no: pr.numbers[id], after });
    });
    return out;
  };
  SD.currentRevision = (doc) => { const pr = SD.production(doc); return pr.revisions.find((r) => r.id === pr.current) || null; };

  // The script as it is printed: with OMITTED headings and scene numbers attached.
  function printable(doc) {
    const nums = SD.sceneNumbers(doc);
    const om = SD.omittedScenes(doc);
    const st = (SD.SCRIPT_TYPES[doc.scriptType] || {}).sceneType;
    const els = [];
    const omFirst = om.filter((o) => !o.after);
    for (const o of omFirst) els.push({ id: 'om-' + o.id, type: 'scene', text: 'OMITTED', sceneNo: o.no });
    for (const e of doc.elements) els.push(nums.has(e.id) ? Object.assign({}, e, { sceneNo: nums.get(e.id) }) : e);
    // put OMITTED headings in front of the scene that came after the deleted one
    if (om.length) {
      const out = [];
      const afterMap = new Map();
      for (const o of om) if (o.after) { if (!afterMap.has(o.after)) afterMap.set(o.after, []); afterMap.get(o.after).push(o); }
      let pending = [];
      for (const e of els) {
        if (e.type === st && pending.length) { for (const o of pending) out.push({ id: 'om-' + o.id, type: 'scene', text: 'OMITTED', sceneNo: o.no }); pending = []; }
        out.push(e);
        if (afterMap.has(e.id)) pending = afterMap.get(e.id);
      }
      for (const o of pending) out.push({ id: 'om-' + o.id, type: 'scene', text: 'OMITTED', sceneNo: o.no });
      return { scriptType: doc.scriptType, elements: out };
    }
    return { scriptType: doc.scriptType, elements: els };
  }

  /* Everything that goes on paper, in inches.
     opts: { size, sceneNumbers, revisionMarks: 'current'|'all'|'none', titlePage: bool, onlyRevised: bool } */
  SD.scriptLayout = (doc, opts = {}) => {
    const pdoc = printable(doc);
    const pg = SD.paginate(pdoc, { size: opts.size });
    const P = pg.page;
    const rev = SD.currentRevision(doc);
    const marks = opts.revisionMarks || 'current';
    const showNums = opts.sceneNumbers || SD.production(doc).locked;
    const st = (SD.SCRIPT_TYPES[doc.scriptType] || {}).sceneType;
    const pages = [];
    const tp = doc.titlePage || {};
    if (opts.titlePage !== false && tp.enabled !== false && (tp.title || tp.author)) {
      const items = [];
      const center = (text, y, style) => items.push({ x: (P.w - text.length / CPI) / 2, y, text, fmt: [], style: style || {} });
      let y = 3.4;
      for (const l of String(tp.title || '').toUpperCase().split('\n')) { center(l, y, { bold: true, underline: true }); y += 1 / LPI; }
      y += 2 / LPI;
      for (const key of ['episode', 'credit', 'author', 'source']) {
        if (!tp[key]) continue;
        for (const l of String(tp[key]).split('\n')) { center(l, y); y += 1 / LPI; }
        y += 1 / LPI;
      }
      const contact = String(tp.contact || '').split('\n').filter(Boolean);
      contact.forEach((l, i) => items.push({ x: 1.5, y: P.h - 1 - (contact.length - i) / LPI, text: l, fmt: [], style: {} }));
      if (tp.draftDate) String(tp.draftDate).split('\n').forEach((l, i, a) => items.push({ x: P.w - 1 - l.length / CPI, y: P.h - 1 - (a.length - i) / LPI, text: l, fmt: [], style: {} }));
      pages.push({ title: true, items, revised: false });
    }
    const firstLine = new Set();
    for (const p of pg.pages) {
      const items = [];
      let revised = false;
      for (const ln of p.lines) {
        const y = pg.top + ln.row / LPI;
        const L = ln.style || {};
        const len = ln.text.length / CPI;
        let x = ln.x;
        if (L.align === 'right') x = pg.left + 6.0 - len;
        else if (L.align === 'center') x = pg.left + (L.col === 'right' ? 3.17 : 0) + ((L.col ? 2.82 : 6.0) - len) / 2;
        items.push({ x, y, text: ln.text, fmt: ln.fmt || [], style: L });
        // scene numbers in both margins, on the first line of the heading
        if (showNums && ln.type === st && !firstLine.has(ln.elId)) {
          firstLine.add(ln.elId);
          const el = pdoc.elements.find((e) => e.id === ln.elId);
          if (el && el.sceneNo) { items.push({ x: 0.75, y, text: el.sceneNo, fmt: [], style: {} }); items.push({ x: P.w - 0.85, y, text: el.sceneNo, fmt: [], style: {} }); }
        }
        const isRev = ln.rev && (marks === 'all' || (marks === 'current' && rev && ln.rev === rev.id));
        if (isRev) { items.push({ x: P.w - 0.45, y, text: '*', fmt: [], style: {} }); revised = true; }
      }
      // page number top right from page 2, with the revision when this page changed
      if (p.no > 1 || revised) {
        const head = [revised && rev ? `${rev.name} Rev. ${rev.date || ''}`.trim() : '', p.no > 1 ? p.no + '.' : ''].filter(Boolean).join('   ');
        items.push({ x: P.w - 1 - head.length / CPI, y: 0.5, text: head, fmt: [], style: {} });
      }
      pages.push({ no: p.no, items, revised });
    }
    return { pages: opts.onlyRevised ? pages.filter((p) => p.revised) : pages, size: pg.size, w: P.w, h: P.h, count: pg.count };
  };

  // ---------- PDF ----------
  const WIN = { 0x20ac: 128, 0x201a: 130, 0x192: 131, 0x201e: 132, 0x2026: 133, 0x2020: 134, 0x2021: 135, 0x2c6: 136, 0x2030: 137, 0x160: 138, 0x2039: 139, 0x152: 140, 0x17d: 142, 0x2018: 145, 0x2019: 146, 0x201c: 147, 0x201d: 148, 0x2022: 149, 0x2013: 150, 0x2014: 151, 0x2dc: 152, 0x2122: 153, 0x161: 154, 0x203a: 155, 0x153: 156, 0x17e: 158, 0x178: 159 };
  const pdfStr = (s) => {
    let out = '';
    for (const ch of s) {
      const c = ch.codePointAt(0);
      let b = c < 128 ? c : WIN[c] || (c >= 160 && c <= 255 ? c : 63);
      if (b === 40 || b === 41 || b === 92) out += '\\' + String.fromCharCode(b);
      else if (b < 32) out += ' ';
      else if (b > 126) out += '\\' + b.toString(8).padStart(3, '0');
      else out += String.fromCharCode(b);
    }
    return '(' + out + ')';
  };
  const n2 = (v) => (Math.round(v * 100) / 100).toString();
  // document properties use a different character set: keep them to plain characters
  const plainMeta = (t) => String(t).replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...');

  SD.layoutToPDF = (layout, info = {}) => {
    const W = layout.w * 72, H = layout.h * 72;
    const objs = [];
    const add = (body) => { objs.push(body); return objs.length; };
    const catalog = add(null), pagesObj = add(null);
    const fonts = ['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'].map((f) => add(`<< /Type /Font /Subtype /Type1 /BaseFont /${f} /Encoding /WinAnsiEncoding >>`));
    const kids = [];
    for (const p of layout.pages) {
      let cs = '';
      for (const it of p.items) {
        const base = it.y * 72 + 9.5; // baseline of a 12pt line
        let x = it.x * 72;
        for (const [t, f0] of SD.fmtSegments(it.text, it.fmt)) {
          if (!t) continue;
          const f = f0 | (it.style.bold ? 1 : 0) | (it.style.italic ? 2 : 0) | (it.style.underline ? 4 : 0);
          const font = (f & 1 ? 1 : 0) + (f & 2 ? 2 : 0);
          cs += `BT /F${font + 1} 12 Tf ${n2(x)} ${n2(H - base)} Td ${pdfStr(t)} Tj ET\n`;
          const w = [...t].length * 7.2;
          if (f & 4 && t.trim()) cs += `0.6 w ${n2(x)} ${n2(H - base - 1.6)} m ${n2(x + w)} ${n2(H - base - 1.6)} l S\n`;
          x += w;
        }
      }
      const content = add(`<< /Length ${cs.length} >>\nstream\n${cs}endstream`);
      kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${n2(W)} ${n2(H)}] /Resources << /Font << /F1 ${fonts[0]} 0 R /F2 ${fonts[1]} 0 R /F3 ${fonts[2]} 0 R /F4 ${fonts[3]} 0 R >> >> /Contents ${content} 0 R >>`));
    }
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
    objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
    const infoObj = add(`<< /Title ${pdfStr(plainMeta(info.title || 'Script'))} /Author ${pdfStr(plainMeta(info.author || ''))} /Creator (Scriptdesk) /Producer (Scriptdesk) >>`);
    let out = '%PDF-1.4\n';
    const offs = [];
    objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${infoObj} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
    return new Blob([bytes], { type: 'application/pdf' });
  };

  // ---------- the same pages as HTML, for printing ----------
  SD.layoutToHTML = (layout) => {
    const pages = [];
    for (const p of layout.pages) {
      const page = document.createElement('div');
      page.className = 'pp-page';
      page.style.width = layout.w + 'in';
      page.style.height = layout.h + 'in';
      for (const it of p.items) {
        const s = document.createElement('div');
        s.className = 'pp-line';
        s.style.left = it.x + 'in';
        s.style.top = it.y + 'in';
        if (it.style.bold) s.style.fontWeight = '700';
        if (it.style.italic) s.style.fontStyle = 'italic';
        if (it.style.underline) s.style.textDecoration = 'underline';
        SD.fillFormatted(s, it.text, it.fmt);
        page.append(s);
      }
      pages.push(page);
    }
    return pages;
  };

  // ---------- documents in a proportional font (one-sheet, synopsis, bios, letter) ----------
  // Helvetica is built into every PDF reader; Arial has the same widths, so the browser can measure lines for us.
  const FACE = 'Arial, Helvetica, "Liberation Sans", "Nimbus Sans", sans-serif';
  let measureCtx = null;
  const measure = (text, size, bold, italic) => {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    measureCtx.font = `${italic ? 'italic ' : ''}${bold ? '700 ' : ''}${size}px ${FACE}`;
    return measureCtx.measureText(text).width;
  };
  const STYLES = {
    title: { size: 24, bold: true, align: 'center', after: 6 },
    subtitle: { size: 12, italic: true, align: 'center', after: 18, gray: true },
    h: { size: 13, bold: true, before: 14, after: 4 },
    p: { size: 11, after: 8 },
    quote: { size: 12, italic: true, indent: 24, after: 10 },
    meta: { size: 10, gray: true, after: 2 },
    small: { size: 9, gray: true, after: 2 },
    label: { size: 9, bold: true, gray: true, after: 1, before: 8 },
  };
  SD.proseToPDF = (blocks, opts = {}) => {
    const A4 = opts.size === 'a4';
    const W = A4 ? 595.28 : 612, H = A4 ? 841.89 : 792, M = 72, TW = W - 2 * M;
    const pages = [];
    let items = null, y = 0;
    const newPage = () => { items = []; pages.push(items); y = M; };
    newPage();
    for (const b of blocks) {
      if (b.kind === 'space') { y += b.h || 12; continue; }
      if (b.kind === 'pagebreak') { if (items.length) newPage(); continue; }
      const st = Object.assign({}, STYLES[b.kind] || STYLES.p, b.style || {});
      const lh = Math.round(st.size * 1.38 * 10) / 10;
      if (st.before && items.length) y += st.before;
      const width = TW - (st.indent || 0) * 2;
      for (const para of String(b.text || '').split('\n')) {
        const words = para.split(/\s+/).filter(Boolean);
        const lines = [];
        let cur = '';
        for (const w of words) {
          const t = cur ? cur + ' ' + w : w;
          if (cur && measure(t, st.size, st.bold, st.italic) > width) { lines.push(cur); cur = w; } else cur = t;
        }
        lines.push(cur);
        // keep headings with the next lines
        if (y + lh * (b.kind === 'h' || b.kind === 'label' ? 3 : 1) > H - M) newPage();
        for (const ln of lines) {
          if (y + lh > H - M) newPage();
          const wd = measure(ln, st.size, st.bold, st.italic);
          const x = M + (st.indent || 0) + (st.align === 'center' ? (width - wd) / 2 : st.align === 'right' ? width - wd : 0);
          items.push({ x, y: y + st.size, text: ln, size: st.size, font: (st.bold ? 1 : 0) + (st.italic ? 2 : 0), gray: !!st.gray });
          y += lh;
        }
      }
      y += st.after || 0;
    }
    if (opts.footer) pages.forEach((its, i) => { const t = `${opts.footer}${pages.length > 1 ? '  ·  ' + (i + 1) + ' / ' + pages.length : ''}`; its.push({ x: (W - measure(t, 8)) / 2, y: H - 36, text: t, size: 8, font: 0, gray: true }); });
    const streams = pages.map((its) => its.map((it) => `BT ${it.gray ? '0.38 g ' : '0 g '}/F${it.font + 1} ${it.size} Tf ${n2(it.x)} ${n2(H - it.y)} Td ${pdfStr(it.text)} Tj ET\n`).join(''));
    return writePDF(streams, W, H, ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'], opts);
  };

  function writePDF(streams, W, H, fontNames, info) {
    const objs = [];
    const add = (body) => { objs.push(body); return objs.length; };
    const catalog = add(null), pagesObj = add(null);
    const fonts = fontNames.map((f) => add(`<< /Type /Font /Subtype /Type1 /BaseFont /${f} /Encoding /WinAnsiEncoding >>`));
    const fontRes = fonts.map((id, i) => `/F${i + 1} ${id} 0 R`).join(' ');
    const kids = streams.map((cs) => {
      const content = add(`<< /Length ${cs.length} >>\nstream\n${cs}endstream`);
      return add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${n2(W)} ${n2(H)}] /Resources << /Font << ${fontRes} >> >> /Contents ${content} 0 R >>`);
    });
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
    objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
    const infoObj = add(`<< /Title ${pdfStr(plainMeta(info.title || 'Document'))} /Author ${pdfStr(plainMeta(info.author || ''))} /Creator (Scriptdesk) /Producer (Scriptdesk) >>`);
    let out = '%PDF-1.4\n';
    const offs = [];
    objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${infoObj} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
    return new Blob([bytes], { type: 'application/pdf' });
  }
})();
