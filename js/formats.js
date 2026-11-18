/* Scriptdesk — script formats, element definitions and shared helpers */
(function () {
  'use strict';
  const SD = (window.SD = window.SD || {});

  SD.APP_ID = 'scriptdesk';
  // Extra document kinds (beat board, sketch, schedule) register themselves here:
  // { icon, label, create(project, name), normalize(d), render(root, d), hasContent(d), … }
  SD.KINDS = SD.KINDS || {};
  SD.FILE_VERSION = 1;
  SD.FILE_EXT = '.scriptdesk';

  SD.uid = () =>
    Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

  SD.ELEMENT_LABELS = {
    scene: 'Scene Heading',
    action: 'Action',
    character: 'Character',
    parenthetical: 'Parenthetical',
    dialogue: 'Dialogue',
    transition: 'Transition',
    shot: 'Shot',
    general: 'General',
    sound: 'Sound',
    music: 'Music',
    page: 'Page',
    panel: 'Panel',
    caption: 'Caption',
    sfx: 'Sound Effect',
    audio: 'Audio',
    act: 'Act Break',
  };

  // enter: element that follows when you press Enter at the end of a block
  // tab:   element the current block turns into when you press Tab
  SD.SCRIPT_TYPES = {
    screenplay: {
      label: 'Screenplay',
      icon: '🎬',
      sceneType: 'scene',
      elements: ['scene', 'action', 'character', 'parenthetical', 'dialogue', 'transition', 'shot', 'general'],
      enter: { scene: 'action', action: 'action', character: 'dialogue', parenthetical: 'dialogue', dialogue: 'character', transition: 'scene', shot: 'action', general: 'general' },
      tab: { scene: 'action', action: 'character', character: 'transition', parenthetical: 'dialogue', dialogue: 'parenthetical', transition: 'scene', shot: 'action', general: 'action' },
      labels: {},
    },
    stageplay: {
      label: 'Stage Play',
      icon: '🎭',
      sceneType: 'scene',
      elements: ['scene', 'action', 'character', 'parenthetical', 'dialogue', 'transition', 'general'],
      enter: { scene: 'action', action: 'character', character: 'dialogue', parenthetical: 'dialogue', dialogue: 'character', transition: 'scene', general: 'general' },
      tab: { scene: 'action', action: 'character', character: 'action', parenthetical: 'dialogue', dialogue: 'parenthetical', transition: 'scene', general: 'action' },
      labels: { scene: 'Act / Scene', action: 'Stage Direction' },
    },
    audioplay: {
      label: 'Audio Play',
      icon: '🎙️',
      sceneType: 'scene',
      elements: ['scene', 'action', 'character', 'parenthetical', 'dialogue', 'sound', 'music', 'transition'],
      enter: { scene: 'action', action: 'character', character: 'dialogue', parenthetical: 'dialogue', dialogue: 'character', sound: 'character', music: 'character', transition: 'scene' },
      tab: { scene: 'action', action: 'character', character: 'sound', sound: 'music', music: 'action', parenthetical: 'dialogue', dialogue: 'parenthetical', transition: 'scene' },
      labels: { action: 'Description' },
    },
    comic: {
      label: 'Comic Book',
      icon: '💬',
      sceneType: 'page',
      elements: ['page', 'panel', 'action', 'character', 'dialogue', 'caption', 'sfx'],
      enter: { page: 'panel', panel: 'action', action: 'character', character: 'dialogue', dialogue: 'character', caption: 'character', sfx: 'panel' },
      tab: { page: 'panel', panel: 'action', action: 'character', character: 'caption', caption: 'sfx', sfx: 'panel', dialogue: 'character' },
      labels: { action: 'Panel Description' },
    },
    av: {
      label: 'AV Script',
      icon: '📺',
      sceneType: 'scene',
      // two columns: Video on the left, Audio (narration, dialogue, sound) on the right
      elements: ['scene', 'shot', 'audio', 'character', 'parenthetical', 'dialogue', 'transition'],
      enter: { scene: 'shot', shot: 'audio', audio: 'shot', character: 'dialogue', parenthetical: 'dialogue', dialogue: 'shot', transition: 'scene' },
      tab: { scene: 'shot', shot: 'audio', audio: 'character', character: 'shot', parenthetical: 'dialogue', dialogue: 'parenthetical', transition: 'scene' },
      labels: { scene: 'Segment', shot: 'Video' },
      twoColumn: true,
    },
  };
  // TV: single-camera drama and multi-camera sitcom, both with act breaks
  SD.SCRIPT_TYPES.teleplay = {
    label: 'TV Drama (single camera)',
    icon: '📡',
    sceneType: 'scene',
    elements: ['scene', 'action', 'character', 'parenthetical', 'dialogue', 'transition', 'act', 'shot', 'general'],
    enter: { scene: 'action', action: 'action', character: 'dialogue', parenthetical: 'dialogue', dialogue: 'character', transition: 'scene', act: 'scene', shot: 'action', general: 'general' },
    tab: { scene: 'action', action: 'character', character: 'transition', parenthetical: 'dialogue', dialogue: 'parenthetical', transition: 'act', act: 'scene', shot: 'action', general: 'action' },
    labels: {},
    tv: true,
  };
  SD.SCRIPT_TYPES.sitcom = {
    label: 'Sitcom (multi-camera)',
    icon: '🛋️',
    sceneType: 'scene',
    elements: ['act', 'scene', 'action', 'character', 'parenthetical', 'dialogue', 'transition', 'general'],
    enter: { act: 'scene', scene: 'action', action: 'character', character: 'dialogue', parenthetical: 'dialogue', dialogue: 'character', transition: 'scene', general: 'general' },
    tab: { act: 'scene', scene: 'action', action: 'character', character: 'transition', parenthetical: 'dialogue', dialogue: 'parenthetical', transition: 'act', general: 'action' },
    labels: {},
    tv: true,
  };
  SD.ACT_NAMES = ['COLD OPEN', 'TEASER', 'ACT ONE', 'ACT TWO', 'ACT THREE', 'ACT FOUR', 'ACT FIVE', 'ACT SIX', 'TAG', 'END OF TEASER', 'END OF ACT ONE', 'END OF ACT TWO', 'END OF ACT THREE', 'END OF ACT FOUR', 'END OF ACT FIVE', 'END OF SHOW'];
  SD.AV_LEFT = new Set(['shot']);
  SD.AV_RIGHT = new Set(['audio', 'character', 'parenthetical', 'dialogue']);

  SD.labelFor = (scriptType, el) =>
    (SD.SCRIPT_TYPES[scriptType] && SD.SCRIPT_TYPES[scriptType].labels[el]) || SD.ELEMENT_LABELS[el] || el;

  SD.UPPERCASE_TYPES = new Set(['scene', 'character', 'transition', 'shot', 'page', 'panel', 'sound', 'act']);

  // ---------- inline formatting ----------
  // An element's text stays plain; e.fmt holds [start, end, flags] runs (1 bold, 2 italic, 4 underline).
  SD.FMT = { b: 1, i: 2, u: 4 };
  SD.fmtClean = (runs) => {
    const out = [];
    for (const r of (runs || []).filter((x) => x && x[1] > x[0] && x[2]).sort((a, b) => a[0] - b[0])) {
      const last = out[out.length - 1];
      if (last && last[2] === r[2] && last[1] >= r[0]) last[1] = Math.max(last[1], r[1]);
      else out.push([r[0], r[1], r[2]]);
    }
    return out;
  };
  SD.fmtSlice = (fmt, s, e) => (fmt || []).map(([a, b, f]) => [Math.max(a, s) - s, Math.min(b, e) - s, f]).filter(([a, b]) => b > a);
  SD.fmtShift = (fmt, d) => (fmt || []).map(([a, b, f]) => [a + d, b + d, f]);
  SD.fmtAt = (fmt, i) => { for (const [a, b, f] of fmt || []) if (a <= i && i < b) return f; return 0; };
  const setFmt = (el, runs) => { const c = SD.fmtClean(runs); if (c.length) el.fmt = c; else delete el.fmt; };
  // Replace text start…end with `ins`, keeping the formatting around it in place.
  SD.editText = (el, start, end, ins) => {
    const fmt = el.fmt;
    el.text = el.text.slice(0, start) + ins + el.text.slice(end);
    if (!fmt) return;
    const f = SD.fmtAt(fmt, start);
    setFmt(el, [...SD.fmtSlice(fmt, 0, start), ...(ins && f ? [[start, start + ins.length, f]] : []), ...SD.fmtShift(SD.fmtSlice(fmt, end, Infinity), start + ins.length)]);
  };
  // Pieces of text with their flags, in order.
  SD.fmtSegments = (text, fmt) => {
    text = text || '';
    if (!fmt || !fmt.length) return [[text, 0]];
    const cuts = new Set([0, text.length]);
    for (const [a, b] of fmt) { cuts.add(Math.min(a, text.length)); cuts.add(Math.min(b, text.length)); }
    const pts = [...cuts].sort((a, b) => a - b);
    const segs = [];
    for (let k = 0; k < pts.length - 1; k++) if (pts[k + 1] > pts[k]) segs.push([text.slice(pts[k], pts[k + 1]), SD.fmtAt(fmt, pts[k])]);
    return segs;
  };
  // Fill a DOM element with formatted text (<b>, <i>, <u>).
  SD.fillFormatted = (node, text, fmt) => {
    node.textContent = '';
    for (const [t, f] of SD.fmtSegments(text, fmt)) {
      let n = document.createTextNode(t);
      for (const [bit, tag] of [[4, 'u'], [2, 'i'], [1, 'b']]) if (f & bit) { const w = document.createElement(tag); w.append(n); n = w; }
      node.append(n);
    }
  };
  // Markers around formatted text, e.g. Fountain: **bold** *italic* _underline_
  SD.fmtToMarkup = (text, fmt, open = { 1: '**', 2: '*', 4: '_' }, close = open) => SD.fmtSegments(text, fmt).map(([t, f]) => {
    if (!f || !t.trim()) return t;
    const lead = t.match(/^\s*/)[0], trail = t.match(/\s*$/)[0], core = t.trim();
    let o = '', c = '';
    for (const bit of [4, 1, 2]) if (f & bit) { o += open[bit]; c = close[bit] + c; }
    return lead + o + core + c + trail;
  }).join('');
  // Read Fountain emphasis back: returns { text, fmt }.
  SD.markupToFmt = (src) => {
    let text = '', flags = 0;
    const runs = [];
    let i = 0, runStart = 0;
    const flip = (bit) => { if (text.length > runStart && flags) runs.push([runStart, text.length, flags]); flags ^= bit; runStart = text.length; };
    while (i < src.length) {
      const ch = src[i];
      if (ch === '\\' && /[*_\\]/.test(src[i + 1] || '')) { text += src[i + 1]; i += 2; continue; }
      const m = src.startsWith('***', i) ? '***' : src.startsWith('**', i) ? '**' : ch === '*' ? '*' : ch === '_' ? '_' : '';
      const bits = { '***': 3, '**': 1, '*': 2, _: 4 }[m];
      if (m) {
        const opening = (flags & bits) !== bits;
        const closesLater = src.indexOf(m, i + m.length) > i + m.length;
        if (!opening || closesLater) { flip(bits & (opening ? ~flags : flags) || bits); i += m.length; continue; }
      }
      text += ch;
      i++;
    }
    if (text.length > runStart && flags) runs.push([runStart, text.length, flags]);
    return { text, fmt: SD.fmtClean(runs) };
  };

  // Catalog categories and forms live in catalog.js

  SD.SCENE_COLORS = ['', '#e5484d', '#f76b15', '#ffc53d', '#46a758', '#12a594', '#0090ff', '#8e4ec6', '#d6409f', '#8b8d98'];

  SD.SCENE_PREFIXES = ['INT. ', 'EXT. ', 'INT./EXT. ', 'EST. ', 'I/E. '];
  SD.TIMES_OF_DAY = ['DAY', 'NIGHT', 'MORNING', 'AFTERNOON', 'EVENING', 'DAWN', 'DUSK', 'CONTINUOUS', 'LATER', 'MOMENTS LATER', 'SAME TIME'];
  SD.TRANSITIONS = ['CUT TO:', 'FADE OUT.', 'FADE TO BLACK.', 'DISSOLVE TO:', 'SMASH CUT TO:', 'MATCH CUT TO:', 'JUMP CUT TO:', 'CUT TO BLACK.', 'FADE IN:', 'INTERCUT WITH:', 'BACK TO:'];
  SD.CHARACTER_EXTENSIONS = ['(V.O.)', '(O.S.)', '(O.C.)', "(CONT'D)"];

  // ---------- documents & projects ----------
  SD.newScript = (scriptType = 'screenplay', name) => {
    const t = SD.SCRIPT_TYPES[scriptType] || SD.SCRIPT_TYPES.screenplay;
    return {
      id: SD.uid(),
      kind: 'script',
      scriptType,
      name: name || t.label,
      titlePage: { enabled: true, title: '', credit: 'Written by', author: '', source: '', draftDate: '', contact: '' },
      elements: [{ id: SD.uid(), type: t.sceneType, text: '' }],
    };
  };

  SD.newNote = (name = 'Notes') => ({ id: SD.uid(), kind: 'note', name, text: '', html: '', about: [] });

  // ---------- rich text (notes) ----------
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  SD.escapeHtml = esc;
  SD.textToHtml = (text) => String(text || '').split(/\n{2,}/).filter((p) => p.trim()).map((p) => '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>').join('');

  // Keep only simple formatting: headings, paragraphs, bold/italic/underline, lists, quotes, links.
  const ALLOWED = new Set(['P', 'H1', 'H2', 'H3', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'BR', 'HR', 'A', 'DIV', 'SPAN', 'PRE', 'CODE', 'DEL']);
  SD.sanitizeHtml = (html) => {
    const doc = new DOMParser().parseFromString('<body>' + (html || '') + '</body>', 'text/html');
    const walk = (node) => {
      for (const c of [...node.childNodes]) {
        if (c.nodeType === 3) continue;
        if (c.nodeType !== 1) { c.remove(); continue; }
        const tag = c.tagName;
        if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'TITLE'].includes(tag)) { c.remove(); continue; }
        walk(c);
        if (!ALLOWED.has(tag)) { c.replaceWith(...c.childNodes); continue; }
        const href = tag === 'A' ? c.getAttribute('href') || '' : '';
        for (const a of [...c.attributes]) c.removeAttribute(a.name);
        if (tag === 'A' && /^(https?:|mailto:)/i.test(href)) { c.setAttribute('href', href); c.setAttribute('target', '_blank'); c.setAttribute('rel', 'noopener'); }
        if (tag === 'SPAN') c.replaceWith(...c.childNodes);
      }
    };
    walk(doc.body);
    return doc.body.innerHTML.trim();
  };
  SD.htmlToPlain = (html) => {
    const doc = new DOMParser().parseFromString('<body>' + (html || '') + '</body>', 'text/html');
    doc.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
    doc.querySelectorAll('p,h1,h2,h3,li,blockquote,div').forEach((b) => b.append('\n'));
    return doc.body.textContent.replace(/\n{3,}/g, '\n\n').trim();
  };

  SD.newProject = () => {
    const now = new Date().toISOString();
    return {
      app: SD.APP_ID,
      version: SD.FILE_VERSION,
      title: 'Untitled Project',
      created: now,
      modified: now,
      settings: { pageSize: 'letter', sceneNumbers: false, boldScenes: false },
      documents: [SD.newScript('screenplay', 'Screenplay')],
      catalog: [],
    };
  };

  // Fill in anything missing so older / hand-edited files still open.
  SD.migrate = (p) => {
    if (!p || typeof p !== 'object' || !Array.isArray(p.documents)) throw new Error('This file is not a Scriptdesk project.');
    const base = SD.newProject();
    p.app = SD.APP_ID;
    p.version = SD.FILE_VERSION;
    p.title = p.title || 'Untitled Project';
    p.settings = Object.assign({}, base.settings, p.settings || {});
    p.catalog = Array.isArray(p.catalog) ? p.catalog : [];
    p.catalog.forEach((c) => SD.normalizeCatalogItem(c));
    p.folders = (Array.isArray(p.folders) ? p.folders : []).filter((f) => f && f.id).map((f) => ({ id: f.id, name: f.name || 'Folder', open: f.open !== false }));
    p.documents.forEach((d) => {
      d.id = d.id || SD.uid();
      if (d.folder && !(p.folders || []).some((f) => f.id === d.folder)) delete d.folder;
      if (SD.KINDS[d.kind]) { d.name = d.name || SD.KINDS[d.kind].label; SD.KINDS[d.kind].normalize(d); return; }
      if (d.kind === 'note') {
        d.text = d.text || ''; d.name = d.name || 'Notes';
        if (typeof d.html !== 'string') d.html = SD.textToHtml(d.text);
        d.about = Array.isArray(d.about) ? d.about : [];
        return;
      }
      if (d.kind === 'storyline') { d.name = d.name || 'Storyline'; SD.normalizeStoryline(d); return; }
      if (d.kind === 'storyboard') { d.name = d.name || 'Storyboard'; SD.normalizeStoryboard(d); return; }
      d.kind = 'script';
      if (!SD.SCRIPT_TYPES[d.scriptType]) d.scriptType = 'screenplay';
      d.name = d.name || SD.SCRIPT_TYPES[d.scriptType].label;
      d.titlePage = Object.assign({ enabled: true, title: '', episode: '', credit: 'Written by', author: '', source: '', draftDate: '', contact: '' }, d.titlePage || {});
      if (!Array.isArray(d.elements) || !d.elements.length) d.elements = [{ id: SD.uid(), type: SD.SCRIPT_TYPES[d.scriptType].sceneType, text: '' }];
      d.elements.forEach((e) => {
        e.id = e.id || SD.uid(); e.type = e.type || 'action'; e.text = e.text == null ? '' : String(e.text);
        if (e.comments && !Array.isArray(e.comments)) delete e.comments;
        if (e.dual && e.type !== 'character') delete e.dual;
        if (e.temp != null && !(e.temp >= 0 && e.temp <= 10)) delete e.temp;
        if (e.fmt) { if (Array.isArray(e.fmt)) setFmt(e, e.fmt.filter((r) => Array.isArray(r) && r.length === 3).map((r) => r.map(Number))); else delete e.fmt; }
      });
    });
    return p;
  };

  // ---------- text helpers ----------
  SD.wrapLines = (text, width) => {
    const out = [];
    for (const para of String(text || '').split('\n')) {
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length) { out.push(''); continue; }
      let line = '';
      for (let w of words) {
        while (w.length > width) {
          if (line) { out.push(line); line = ''; }
          out.push(w.slice(0, width));
          w = w.slice(width);
        }
        if (!line) line = w;
        else if (line.length + 1 + w.length <= width) line += ' ' + w;
        else { out.push(line); line = w; }
      }
      if (line) out.push(line);
    }
    return out.length ? out : [''];
  };

  SD.charName = (text) =>
    String(text || '')
      .replace(/\(.*?\)/g, '')
      .replace(/\^\s*$/, '')
      .replace(/^@/, '')
      .trim()
      .toUpperCase();

  SD.parseSceneHeading = (text) => {
    const up = String(text || '').toUpperCase().trim();
    const m = up.match(/^(INT\.?\s*\/\s*EXT\.?|EXT\.?\s*\/\s*INT\.?|I\/E\.?|INT\.?|EXT\.?|EST\.?)(?:\s+|$)/);
    let setting = '', rest = up;
    if (m) {
      const p = m[1].replace(/[.\s]/g, '');
      setting = p === 'INT' ? 'INT' : p === 'EXT' ? 'EXT' : p === 'EST' ? 'EXT' : 'INT/EXT';
      rest = up.slice(m[0].length);
    }
    const dash = rest.lastIndexOf(' - ');
    const location = (dash >= 0 ? rest.slice(0, dash) : rest).trim();
    const time = dash >= 0 ? rest.slice(dash + 3).trim() : '';
    return { prefix: m ? m[0] : '', setting, location, time };
  };

  // Display text as it appears on the page (uppercase, comic numbering…)
  SD.displayText = (scriptType, el, ctr) => {
    let t = el.text || '';
    if (SD.UPPERCASE_TYPES.has(el.type)) t = t.toUpperCase();
    if (scriptType === 'comic' && ctr) {
      if (el.type === 'page') { ctr.page++; ctr.panel = 0; return 'PAGE ' + ctr.page + (t ? ' — ' + t : ''); }
      if (el.type === 'panel') { ctr.panel++; return 'PANEL ' + ctr.panel + (t ? '. ' + t : ''); }
    }
    if (el.type === 'caption') return 'CAPTION: ' + t;
    if (el.type === 'sfx') return 'SFX: ' + t;
    if (el.type === 'parenthetical' && t && !t.startsWith('(')) return '(' + t + ')';
    return t;
  };

  // ---------- page estimation (12pt Courier, 6 lines per inch) ----------
  SD.LINES_PER_PAGE = 54;
  SD.WIDTHS = { act: 60, scene: 60, action: 60, character: 38, parenthetical: 24, dialogue: 35, transition: 60, shot: 60, general: 60, sound: 60, music: 60, page: 60, panel: 60, caption: 50, sfx: 50 };
  SD.SPACE_BEFORE = { act: 3, scene: 2, action: 1, character: 1, parenthetical: 0, dialogue: 0, transition: 1, shot: 1, general: 1, sound: 1, music: 1, page: 3, panel: 1, caption: 1, sfx: 1 };

  // Dual dialogue: a character cue with e.dual is spoken at the same time as the speech before it.
  SD.SPEECH_TYPES = new Set(['parenthetical', 'dialogue']);
  SD.speechEnd = (els, i) => { let k = i + 1; while (k < els.length && SD.SPEECH_TYPES.has(els[k].type)) k++; return k; };
  SD.canBeDual = (els, i) => !!els[i] && els[i].type === 'character' && i > 0 && SD.SPEECH_TYPES.has(els[i - 1].type);
  // Group elements for side-by-side layout: [{ pair: [leftEls, rightEls] } | element]
  SD.dualGroups = (els) => {
    const out = [];
    for (let i = 0; i < els.length; i++) {
      const e = els[i];
      if (e.type === 'character') {
        const j = SD.speechEnd(els, i);
        if (els[j] && els[j].type === 'character' && els[j].dual) {
          const k = SD.speechEnd(els, j);
          out.push({ pair: [els.slice(i, j), els.slice(j, k)] });
          i = k - 1;
          continue;
        }
      }
      out.push(e);
    }
    return out;
  };

  SD.estimate = (doc) => {
    const els = doc.elements;
    const lineAt = new Array(els.length);
    let line = 0;
    const av = doc.scriptType === 'av';
    let lastCue = null, dualMax = null;
    for (let i = 0; i < els.length; i++) {
      const e = els[i];
      // the second speech of a dual pair sits beside the first, so it adds no extra lines
      if (dualMax != null && !SD.SPEECH_TYPES.has(e.type)) { line = Math.max(line, dualMax); dualMax = null; }
      if (e.type === 'character' && e.dual && lastCue != null && i > 0 && SD.SPEECH_TYPES.has(els[i - 1].type)) {
        dualMax = line;
        lineAt[i] = lastCue;
        line = lastCue + SD.wrapLines(e.text, SD.WIDTHS.character).length;
        continue;
      }
      if (av && (SD.AV_LEFT.has(e.type) || SD.AV_RIGHT.has(e.type))) {
        const prev = els[i - 1];
        const n = SD.wrapLines(e.text, 28).length;
        if (prev && SD.AV_RIGHT.has(e.type) && SD.AV_LEFT.has(prev.type)) { lineAt[i] = lineAt[i - 1]; line = Math.max(line, lineAt[i] + n); continue; }
        if (i > 0) line += e.type === 'dialogue' || e.type === 'parenthetical' ? 0 : 1;
        lineAt[i] = line;
        line += n;
        continue;
      }
      if (i > 0) line += SD.SPACE_BEFORE[e.type] ?? 1;
      lineAt[i] = line;
      if (e.type === 'character') lastCue = line;
      const n = SD.wrapLines(e.text, SD.WIDTHS[e.type] || 60).length;
      line += doc.scriptType === 'sitcom' && (e.type === 'dialogue' || e.type === 'action') ? n * 2 - 1 : n;
    }
    if (dualMax != null) line = Math.max(line, dualMax);
    return { totalLines: line, pages: Math.max(1, Math.ceil(line / SD.LINES_PER_PAGE)), lineAt };
  };

  SD.pageOfLine = (l) => Math.floor(l / SD.LINES_PER_PAGE) + 1;

  SD.eighths = (lines) => {
    const e = Math.max(1, Math.round((lines / SD.LINES_PER_PAGE) * 8));
    const whole = Math.floor(e / 8), r = e % 8;
    return (whole ? String(whole) : '') + (whole && r ? ' ' : '') + (r ? r + '/8' : '');
  };

  SD.getScenes = (doc) => {
    const st = (SD.SCRIPT_TYPES[doc.scriptType] || SD.SCRIPT_TYPES.screenplay).sceneType;
    const est = SD.estimate(doc);
    const els = doc.elements;
    const scenes = [];
    els.forEach((e, i) => { if (e.type === st) scenes.push({ id: e.id, el: e, start: i, number: scenes.length + 1 }); });
    scenes.forEach((s, k) => {
      s.end = k + 1 < scenes.length ? scenes[k + 1].start : els.length;
      const endLine = s.end < els.length ? est.lineAt[s.end] - (SD.SPACE_BEFORE[els[s.end].type] ?? 1) : est.totalLines;
      s.lines = Math.max(1, endLine - est.lineAt[s.start]);
      s.page = SD.pageOfLine(est.lineAt[s.start]);
    });
    // exact page numbers from the page engine
    if (SD.paginate) { const pg = SD.paginate(doc); scenes.forEach((s) => { const v = pg.pageOf.get(s.id); if (v) s.page = v; }); scenes.pages = pg.count; }
    scenes.estimate = est;
    return scenes;
  };

  SD.sceneCharacters = (doc, scene) => {
    const set = new Set();
    for (let i = scene.start; i < scene.end; i++) {
      const e = doc.elements[i];
      if (e.type === 'character') { const n = SD.charName(e.text); if (n) set.add(n); }
    }
    return [...set];
  };

  SD.wordCount = (doc) => {
    let n = 0;
    for (const e of doc.elements) { const m = (e.text || '').match(/\S+/g); if (m) n += m.length; }
    return n;
  };

  // Where is each catalog item used? Returns Map(itemId -> [{doc, scene}])
  SD.catalogUsage = (project) => {
    const usage = new Map();
    const byName = new Map();
    for (const c of project.catalog) {
      usage.set(c.id, []);
      byName.set(c.category + '|' + c.name.trim().toUpperCase(), c.id);
    }
    const add = (id, doc, scene) => {
      const list = usage.get(id);
      if (list && !list.some((u) => u.doc === doc && u.scene === scene)) list.push({ doc, scene });
    };
    for (const d of project.documents) {
      if (d.kind !== 'script') continue;
      for (const s of SD.getScenes(d)) {
        for (const id of s.el.items || []) add(id, d, s);
        for (const n of SD.sceneCharacters(d, s)) { const id = byName.get('character|' + n); if (id) add(id, d, s); }
        if (s.el.type === 'scene') {
          const loc = SD.parseSceneHeading(s.el.text).location;
          const id = loc && byName.get('location|' + loc);
          if (id) add(id, d, s);
        }
      }
    }
    return usage;
  };

  // Formatted plain text, laid out like the printed page.
  SD.toPlainText = (doc) => {
    const indent = { character: 22, parenthetical: 16, dialogue: 10, caption: 10, sfx: 10 };
    const lines = [];
    const tp = doc.titlePage || {};
    if (tp.enabled !== false && (tp.title || tp.author)) {
      const center = (s) => ' '.repeat(Math.max(0, Math.floor((60 - s.length) / 2))) + s;
      lines.push('', '', '', '', '');
      if (tp.title) tp.title.toUpperCase().split('\n').forEach((l) => lines.push(center(l)));
      lines.push('');
      if (tp.credit) lines.push(center(tp.credit));
      if (tp.author) tp.author.split('\n').forEach((l) => lines.push(center(l)));
      if (tp.source) { lines.push(''); tp.source.split('\n').forEach((l) => lines.push(center(l))); }
      lines.push('', '', '');
      if (tp.contact) tp.contact.split('\n').forEach((l) => lines.push(l));
      if (tp.draftDate) lines.push(tp.draftDate);
      lines.push('', '\f');
    }
    const ctr = { page: 0, panel: 0 };
    doc.elements.forEach((e, i) => {
      if (i > 0) for (let k = 0; k < (SD.SPACE_BEFORE[e.type] ?? 1); k++) lines.push('');
      const text = SD.displayText(doc.scriptType, e, ctr);
      const width = SD.WIDTHS[e.type] || 60;
      for (const l of SD.wrapLines(text, width)) {
        if (e.type === 'transition') lines.push(' '.repeat(Math.max(0, 60 - l.length)) + l);
        else lines.push(' '.repeat(indent[e.type] || 0) + l);
      }
    });
    return lines.join('\n').replace(/\n{4,}/g, '\n\n\n') + '\n';
  };
})();
