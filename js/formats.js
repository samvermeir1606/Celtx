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
  SD.AV_LEFT = new Set(['shot']);
  SD.AV_RIGHT = new Set(['audio', 'character', 'parenthetical', 'dialogue']);

  SD.labelFor = (scriptType, el) =>
    (SD.SCRIPT_TYPES[scriptType] && SD.SCRIPT_TYPES[scriptType].labels[el]) || SD.ELEMENT_LABELS[el] || el;

  SD.UPPERCASE_TYPES = new Set(['scene', 'character', 'transition', 'shot', 'page', 'panel', 'sound']);

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

  SD.newNote = (name = 'Notes') => ({ id: SD.uid(), kind: 'note', name, text: '', html: '' });

  // ---------- rich text (notes) ----------
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  SD.escapeHtml = esc;
  SD.textToHtml = (text) => String(text || '').split(/\n{2,}/).filter((p) => p.trim()).map((p) => '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>').join('');

  // Keep only simple formatting: headings, paragraphs, bold/italic/underline, lists, quotes, links.
  const ALLOWED = new Set(['P', 'H1', 'H2', 'H3', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'BR', 'HR', 'A', 'DIV', 'SPAN']);
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
    p.documents.forEach((d) => {
      d.id = d.id || SD.uid();
      if (SD.KINDS[d.kind]) { d.name = d.name || SD.KINDS[d.kind].label; SD.KINDS[d.kind].normalize(d); return; }
      if (d.kind === 'note') {
        d.text = d.text || ''; d.name = d.name || 'Notes';
        if (typeof d.html !== 'string') d.html = SD.textToHtml(d.text);
        return;
      }
      if (d.kind === 'storyline') { d.name = d.name || 'Storyline'; SD.normalizeStoryline(d); return; }
      if (d.kind === 'storyboard') { d.name = d.name || 'Storyboard'; SD.normalizeStoryboard(d); return; }
      d.kind = 'script';
      if (!SD.SCRIPT_TYPES[d.scriptType]) d.scriptType = 'screenplay';
      d.name = d.name || SD.SCRIPT_TYPES[d.scriptType].label;
      d.titlePage = Object.assign({ enabled: true, title: '', credit: 'Written by', author: '', source: '', draftDate: '', contact: '' }, d.titlePage || {});
      if (!Array.isArray(d.elements) || !d.elements.length) d.elements = [{ id: SD.uid(), type: SD.SCRIPT_TYPES[d.scriptType].sceneType, text: '' }];
      d.elements.forEach((e) => {
        e.id = e.id || SD.uid(); e.type = e.type || 'action'; e.text = e.text == null ? '' : String(e.text);
        if (e.comments && !Array.isArray(e.comments)) delete e.comments;
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
  SD.WIDTHS = { scene: 60, action: 60, character: 38, parenthetical: 24, dialogue: 35, transition: 60, shot: 60, general: 60, sound: 60, music: 60, page: 60, panel: 60, caption: 50, sfx: 50 };
  SD.SPACE_BEFORE = { scene: 2, action: 1, character: 1, parenthetical: 0, dialogue: 0, transition: 1, shot: 1, general: 1, sound: 1, music: 1, page: 3, panel: 1, caption: 1, sfx: 1 };

  SD.estimate = (doc) => {
    const els = doc.elements;
    const lineAt = new Array(els.length);
    let line = 0;
    const av = doc.scriptType === 'av';
    for (let i = 0; i < els.length; i++) {
      const e = els[i];
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
      line += SD.wrapLines(e.text, SD.WIDTHS[e.type] || 60).length;
    }
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
