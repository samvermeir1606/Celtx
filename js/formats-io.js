/* Scriptdesk — import / export: Fountain, Final Draft (.fdx), old Celtx (.celtx) */
(function () {
  'use strict';
  const SD = window.SD;

  const SCENE_RE = /^(INT|EXT|EST|INT\.?\/EXT|EXT\.?\/INT|I\/E)[.\s]/i;
  const el = (type, text, extra) => Object.assign({ id: SD.uid(), type, text: text || '' }, extra || {});

  // ======================= Fountain =======================
  SD.Fountain = {
    export(doc) {
      const tp = doc.titlePage || {};
      let out = '';
      const keys = [['Title', tp.title], ['Credit', tp.credit], ['Author', tp.author], ['Source', tp.source], ['Draft date', tp.draftDate], ['Contact', tp.contact]]
        .filter(([, v]) => v && String(v).trim());
      if (tp.enabled !== false && (tp.title || tp.author)) {
        for (const [k, v] of keys) {
          const ls = String(v).split('\n');
          out += ls.length > 1 ? k + ':\n' + ls.map((l) => '    ' + l).join('\n') + '\n' : k + ': ' + v + '\n';
        }
        out += '\n';
      }
      const blocks = [];
      let prev = null;
      const ctr = { page: 0, panel: 0 };
      for (const e of doc.elements) {
        const t = (e.text || '').trim();
        if (!t && !['page', 'panel'].includes(e.type)) continue;
        let s;
        switch (e.type) {
          case 'scene': {
            const u = t.toUpperCase();
            s = SCENE_RE.test(u) ? u : '.' + u;
            if (e.synopsis) s += '\n\n= ' + e.synopsis.replace(/\s*\n\s*/g, ' ');
            break;
          }
          case 'character': {
            s = t.toUpperCase();
            if (!/[A-Z]/.test(s.replace(/\(.*?\)/g, ''))) s = '@' + t;
            break;
          }
          case 'parenthetical': s = t.startsWith('(') ? t : '(' + t + ')'; break;
          case 'dialogue': s = t; break;
          case 'transition': { const u = t.toUpperCase(); s = /TO:$/.test(u) ? u : '> ' + u; break; }
          case 'page': s = '.' + SD.displayText(doc.scriptType, e, ctr); break;
          case 'panel': case 'caption': case 'sfx': case 'shot': case 'sound': case 'music':
            s = '!' + SD.displayText(doc.scriptType, e, ctr); break;
          default: {
            s = t;
            const letters = t.replace(/[^A-Za-z]/g, '');
            if ((letters && t === t.toUpperCase()) || SCENE_RE.test(t) || /^[.!@>~=#]/.test(t)) s = '!' + t;
          }
        }
        const inDialogue = ['character', 'parenthetical', 'dialogue'].includes(prev);
        if ((e.type === 'dialogue' || e.type === 'parenthetical') && inDialogue && blocks.length) blocks[blocks.length - 1] += '\n' + s;
        else blocks.push(s);
        prev = e.type;
      }
      return out + blocks.join('\n\n') + '\n';
    },

    parse(text) {
      text = String(text)
        .replace(/^﻿/, '')
        .replace(/\r\n?/g, '\n')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\[\[[\s\S]*?\]\]/g, '');
      const lines = text.split('\n');
      let i = 0;
      const titlePage = {};
      const keyMap = { title: 'title', credit: 'credit', author: 'author', authors: 'author', source: 'source', 'draft date': 'draftDate', date: 'draftDate', contact: 'contact' };
      if (/^[A-Za-z][A-Za-z ]*:/.test(lines[0] || '') && !SCENE_RE.test(lines[0])) {
        let key = null;
        while (i < lines.length && lines[i].trim() !== '') {
          const m = lines[i].match(/^([A-Za-z][A-Za-z ]*):\s*(.*)$/);
          if (m && !/^\s/.test(lines[i])) {
            key = keyMap[m[1].trim().toLowerCase()] || null;
            if (key && m[2].trim()) titlePage[key] = (titlePage[key] ? titlePage[key] + '\n' : '') + m[2].trim();
          } else if (key) {
            titlePage[key] = (titlePage[key] ? titlePage[key] + '\n' : '') + lines[i].trim();
          }
          i++;
        }
      }
      const els = [];
      const blank = (l) => l === undefined || l.trim() === '';
      const isUpper = (s) => { const x = s.replace(/\(.*?\)/g, '').replace(/\^\s*$/, ''); return /[A-Z]/.test(x) && x === x.toUpperCase(); };
      while (i < lines.length) {
        const raw = lines[i];
        const line = raw.trim();
        if (!line) { i++; continue; }
        const prevBlank = i === 0 || blank(lines[i - 1]);
        const nextBlank = blank(lines[i + 1]);
        if (/^={3,}$/.test(line) || line.startsWith('#')) { i++; continue; }
        if (/^=[^=]/.test(line)) {
          const sc = [...els].reverse().find((e) => e.type === 'scene');
          if (sc) sc.synopsis = (sc.synopsis ? sc.synopsis + ' ' : '') + line.slice(1).trim();
          i++; continue;
        }
        if (line.startsWith('!')) { els.push(el('action', line.slice(1).trim())); i++; continue; }
        if (/^\.[^.]/.test(line)) { els.push(el('scene', line.slice(1).replace(/\s*#[^#]*#\s*$/, '').trim())); i++; continue; }
        if (prevBlank && SCENE_RE.test(line)) { els.push(el('scene', line.replace(/\s*#[^#]*#\s*$/, ''))); i++; continue; }
        if (line.startsWith('>') && line.endsWith('<')) { els.push(el('action', line.slice(1, -1).trim())); i++; continue; }
        if (line.startsWith('>')) { els.push(el('transition', line.slice(1).trim())); i++; continue; }
        if (prevBlank && nextBlank && /^[A-Z0-9 .\-']+TO:$/.test(line)) { els.push(el('transition', line)); i++; continue; }
        if (line.startsWith('@') || (prevBlank && !nextBlank && isUpper(line))) {
          els.push(el('character', line.replace(/^@/, '').replace(/\s*\^\s*$/, '')));
          i++;
          let dlg = [];
          const flush = () => { if (dlg.length) { els.push(el('dialogue', dlg.join(' '))); dlg = []; } };
          while (i < lines.length && !blank(lines[i])) {
            const l = lines[i].trim();
            if (/^\(.*\)$/.test(l)) { flush(); els.push(el('parenthetical', l)); }
            else dlg.push(l.replace(/^~\s*/, ''));
            i++;
          }
          flush();
          continue;
        }
        els.push(el('action', line));
        i++;
      }
      return { titlePage, elements: els.length ? els : [el('scene', '')] };
    },
  };

  // ======================= Final Draft (.fdx) =======================
  const FDX_TYPES = { scene: 'Scene Heading', action: 'Action', character: 'Character', parenthetical: 'Parenthetical', dialogue: 'Dialogue', transition: 'Transition', shot: 'Shot', general: 'General' };
  const FDX_BACK = Object.fromEntries(Object.entries(FDX_TYPES).map(([k, v]) => [v.toLowerCase(), k]));
  const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  SD.FDX = {
    export(doc) {
      const ctr = { page: 0, panel: 0 };
      const paras = doc.elements.map((e) => {
        const type = FDX_TYPES[e.type] || (e.type === 'page' ? 'Scene Heading' : 'Action');
        const text = FDX_TYPES[e.type] ? e.text || '' : SD.displayText(doc.scriptType, e, ctr);
        let extra = '';
        if (e.type === 'scene' && e.synopsis) extra = `\n      <SceneProperties><Summary><Paragraph><Text>${xmlEsc(e.synopsis)}</Text></Paragraph></Summary></SceneProperties>`;
        return `    <Paragraph Type="${type}">${extra}\n      <Text>${xmlEsc(text)}</Text>\n    </Paragraph>`;
      });
      const tp = doc.titlePage || {};
      const tpLines = [];
      const center = (t) => `      <Paragraph Alignment="Center" Type="General"><Text>${xmlEsc(t)}</Text></Paragraph>`;
      if (tp.enabled !== false && (tp.title || tp.author)) {
        for (let k = 0; k < 16; k++) tpLines.push('      <Paragraph Type="General"><Text></Text></Paragraph>');
        if (tp.title) tpLines.push(center(tp.title.toUpperCase()));
        tpLines.push(center(''));
        if (tp.credit) tpLines.push(center(tp.credit));
        if (tp.author) tpLines.push(center(tp.author));
        if (tp.source) tpLines.push(center(tp.source));
      }
      return `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<FinalDraft DocumentType="Script" Template="No" Version="5">
  <Content>
${paras.join('\n')}
  </Content>
  <TitlePage>
    <Content>
${tpLines.join('\n')}
    </Content>
  </TitlePage>
</FinalDraft>
`;
    },

    parse(xmlText) {
      const x = new DOMParser().parseFromString(xmlText, 'application/xml');
      if (x.querySelector('parsererror')) throw new Error('Could not read this .fdx file.');
      const content = x.querySelector('FinalDraft > Content') || x.querySelector('Content');
      const els = [];
      if (content) {
        for (const p of content.children) {
          if (p.tagName !== 'Paragraph') continue;
          const type = FDX_BACK[(p.getAttribute('Type') || '').toLowerCase()] || 'action';
          const text = Array.from(p.children).filter((c) => c.tagName === 'Text').map((t) => t.textContent).join('').replace(/\s*\n\s*/g, ' ');
          const e = el(type, text);
          const sum = p.querySelector('SceneProperties Summary');
          if (sum && sum.textContent.trim()) e.synopsis = sum.textContent.trim();
          els.push(e);
        }
      }
      const titlePage = {};
      const tpTexts = Array.from(x.querySelectorAll('TitlePage Paragraph')).map((p) => p.textContent.trim()).filter(Boolean);
      if (tpTexts.length) titlePage.title = tpTexts[0];
      const by = tpTexts.findIndex((t) => /^(written )?by$/i.test(t));
      if (by >= 0) { titlePage.credit = tpTexts[by]; if (tpTexts[by + 1]) titlePage.author = tpTexts[by + 1]; }
      return { titlePage, elements: els.length ? els : [el('scene', '')] };
    },
  };

  // ======================= Old Celtx desktop (.celtx = zip) =======================
  // A .celtx file is a zip holding project.rdf (documents, catalog, scene data),
  // one HTML file per script / text document, and media files.

  // HTML paragraph classes -> element types, per script kind
  const CELTX_CLASSES = {
    sceneheading: 'scene', action: 'action', character: 'character', dialog: 'dialogue', dialogue: 'dialogue',
    parenthetical: 'parenthetical', transition: 'transition', shot: 'shot', text: 'general', general: 'general',
    act: 'general', sound: 'sound', music: 'music', voice: 'character', caption: 'caption',
  };
  const CELTX_CLASS_OVERRIDES = {
    stageplay: { act: 'scene' },
    comic: { sceneheading: 'page', shot: 'panel', sound: 'sfx' },
  };
  const CELTX_DOCTYPES = { ScriptDocument: 'screenplay', TheatreDocument: 'stageplay', RadioDocument: 'audioplay', ComicDocument: 'comic', AVDocument: 'screenplay' };
  const CELTX_NOTE_DOCTYPES = new Set(['TextDocument', 'NovelDocument']);

  // RDF item types -> catalog categories
  const CELTX_TYPES = {
    Cast: 'character', Actor: 'actor', Crew: 'crew', Location: 'location', Props: 'prop', Wardrobe: 'wardrobe',
    Makeup: 'makeup', Hair: 'hair', Set: 'set', SetDressing: 'setdressing', Greenery: 'setdressing', Construction: 'set', Painting: 'set',
    Vehicles: 'vehicle', Animals: 'animal', Livestock: 'animal', AnimalHandler: 'crew', AdditionalLabour: 'crew',
    Weapons: 'weapon', SpecialEquipment: 'equipment', Electrics: 'equipment', Lights: 'equipment', Camera: 'equipment', Cameras: 'equipment',
    SpecialFX: 'sfx', MechanicalFX: 'sfx', OpticalFX: 'vfx', CGI: 'vfx', VisualFX: 'vfx',
    Sound: 'sound', SoundFX: 'sound', Music: 'music', Extras: 'extras', Stunts: 'stunts',
    Misc: 'other', Miscellaneous: 'other', Security: 'other', ProductionNotes: 'other',
  };
  const CELTX_NOT_ITEMS = new Set(['Description', 'Seq', 'Bag', 'Alt', 'Image', 'Audio', 'Video', 'Document', 'DepartmentList', 'Folder', 'Project', 'SceneDetails', 'Scene', 'li']);

  // Celtx form field names (after the "character-" style prefix) -> our field keys
  const CELTX_FIELDS = {
    'full-name': 'fullName', age: 'age', dist_feat: 'distFeatures', hair: 'hair', eyes: 'eyes', height: 'height', weight: 'weight',
    traits: 'traits', princ_func: 'function', goal: 'goal', ach_goal: 'plan', fam_back: 'family', habits: 'habits',
    education: 'education', person: 'personality', likes: 'likes', dislikes: 'dislikes', background: 'background',
    startDate: 'startDate', endDate: 'endDate', 'contact-name': 'contactName', 'contact-email': 'email', 'contact-phone': 'phone',
    'contact-cell': 'cell', 'contact-address': 'address', 'contact-comments': 'contactComments', dob: 'dob', sex: 'gender',
    shirt: 'shirt', pants: 'pants', dress: 'dress', hat: 'hat', shoes: 'shoes', jacket: 'jacket',
    address: 'address', 'dates-available': 'datesAvailable', 'square-footage': 'squareFootage', 'rental-cost': 'rentalCost',
    elevator: 'elevator', 'power-capabilities': 'power', 'light-sources': 'lightSources', 'noise-sources': 'noise',
    'washroom-locations': 'washrooms', 'parking-information': 'parking', 'facility-comments': 'facilityComments',
    size: 'size', color: 'color', era: 'era', procure: 'procure', cost: 'cost', dateNeeded: 'dateNeeded', dateReturn: 'dateReturn',
    comments: 'notes',
  };
  const CELTX_SKIP_FIELDS = new Set(['title', 'description', 'tags', 'scheduleID', 'media', 'actor', 'character', 'about', 'mapaddress']);
  const CELTX_COLOURS = { red: '#e5484d', orange: '#f76b15', yellow: '#ffc53d', green: '#46a758', blue: '#0090ff', cyan: '#12a594', teal: '#12a594', purple: '#8e4ec6', violet: '#8e4ec6', pink: '#d6409f', magenta: '#d6409f', grey: '#8b8d98', gray: '#8b8d98' };

  const titleCase = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase());
  const prettyKey = (k) => titleCase(k.replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2'));

  function fieldValue(key, v) {
    if (key === 'function') {
      const map = { confidante: 'Confidant(e)', bestfriend: 'Best friend', loveinterest: 'Love interest', comicrelief: 'Comic relief' };
      return map[v.replace(/\s+/g, '').toLowerCase()] || titleCase(v);
    }
    if (key === 'elevator') return v === 'true' ? 'Yes' : v === 'false' ? 'No' : v;
    if (key === 'procure') return v === 'own' ? 'Already own' : titleCase(v);
    return v;
  }

  // Scene headings were often typed as "EXT.FOREST.DAY"
  function tidyHeading(t) {
    const m = t.match(/^(INT\.?\/EXT|EXT\.?\/INT|INT|EXT|I\/E|EST)\.\s*([^.]+?)\s*\.\s*([A-Z][A-Z ]*)$/i);
    if (m) return m[1].toUpperCase() + '. ' + m[2].trim() + ' - ' + m[3].trim();
    return t.replace(/^(INT|EXT|EST)\.(?=\S)/i, '$1. ');
  }

  function htmlToText(html) {
    const prepared = String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h\d|li|tr)>/gi, '\n$&');
    const d = new DOMParser().parseFromString(prepared, 'text/html');
    return (d.body ? d.body.textContent : '').replace(/\n{3,}/g, '\n\n').trim();
  }

  let jszipPromise = null;
  function loadJSZip() {
    if (window.JSZip) return Promise.resolve(window.JSZip);
    if (!jszipPromise) {
      jszipPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        s.onload = () => resolve(window.JSZip);
        s.onerror = () => { jszipPromise = null; reject(new Error('Could not load the zip reader (are you offline?).')); };
        document.head.appendChild(s);
      });
    }
    return jszipPromise;
  }

  // Minimal RDF/XML reader: each top-level node keeps its attributes and child values by local name.
  function readRdf(xmlText) {
    const x = new DOMParser().parseFromString(xmlText, 'application/xml');
    const RDFNS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
    const nodes = [];
    const byAbout = new Map();
    for (const e of x.documentElement.children) {
      const n = { type: e.localName, about: '', attrs: {}, res: {}, text: {} };
      for (const a of e.attributes) {
        if (a.localName === 'about') n.about = a.value;
        else if (!a.name.startsWith('xmlns')) n.attrs[a.localName] = a.value;
      }
      for (const c of e.children) {
        const r = c.getAttributeNS(RDFNS, 'resource');
        if (r) (n.res[c.localName] = n.res[c.localName] || []).push(r);
        else n.text[c.localName] = c.textContent;
      }
      nodes.push(n);
      if (!byAbout.has(n.about)) byAbout.set(n.about, []);
      byAbout.get(n.about).push(n);
    }
    const seq = (about) => {
      const n = (byAbout.get(about) || []).find((m) => m.type === 'Seq' || m.type === 'Bag' || m.type === 'Alt');
      return n ? n.res.li || [] : [];
    };
    const get = (about, pred) => (byAbout.get(about) || []).find(pred || (() => true));
    const val = (n, k) => (n.attrs[k] != null ? n.attrs[k] : n.text[k] != null ? n.text[k] : '');
    return { nodes, seq, get, val };
  }

  async function svgToPng(text) {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.localName !== 'svg') return '';
    root.querySelectorAll('script, foreignObject').forEach((x) => x.remove());
    for (const el of [root, ...root.querySelectorAll('*')]) {
      for (const a of [...el.attributes]) if (/^on/i.test(a.name) || (/href$/i.test(a.name) && !/^#|^data:image\//i.test(a.value))) el.removeAttribute(a.name);
    }
    const svg = document.importNode(root, true);
    const holder = document.createElement('div');
    holder.style.cssText = 'position:absolute;left:-10000px;top:0;width:10px;height:10px;overflow:hidden';
    holder.append(svg);
    document.body.append(holder);
    let bb = null;
    try { bb = svg.getBBox(); } catch (e) { /* not measurable */ }
    holder.remove();
    if (!bb || !bb.width || !bb.height) return '';
    const pad = Math.max(bb.width, bb.height) * 0.05;
    const vw = bb.width + pad * 2, vh = bb.height + pad * 2;
    const W = 900, H = Math.max(1, Math.round(W * vh / vw));
    svg.setAttribute('viewBox', `${bb.x - pad} ${bb.y - pad} ${vw} ${vh}`);
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
    try {
      const im = new Image();
      await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = url; });
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(im, 0, 0, W, H);
      return cv.toDataURL('image/png');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const isBreakdownItem = (catalog, id) => {
    const it = catalog.find((c) => c.id === id);
    return !!it && it.category !== 'character' && it.category !== 'actor';
  };

  SD.Celtx = {
    async import(file) {
      const JSZip = await loadJSZip();
      const zip = await JSZip.loadAsync(file);
      const names = Object.keys(zip.files);
      const rdfName = names.find((n) => /(^|\/)project\.rdf$/i.test(n));
      if (!rdfName) throw new Error('This does not look like a Celtx project (project.rdf is missing).');
      const { nodes, seq, get, val } = readRdf(await zip.file(rdfName).async('string'));
      const zipFile = (name) => zip.file(name) || zip.file(names.find((n) => n.split('/').pop() === name) || '\u0000');

      const projectNode = nodes.find((n) => n.type === 'Project');
      const projectTitle = projectNode ? val(projectNode, 'title') : '';

      // ---------- catalog ----------
      const catalog = [];
      const idByAbout = new Map();
      const pending = [];
      for (const n of nodes) {
        if (CELTX_NOT_ITEMS.has(n.type) || !n.about) continue;
        const category = CELTX_TYPES[n.type] || (val(n, 'title') ? 'other' : null);
        if (!category) continue;
        const item = SD.newCatalogItem(category, val(n, 'title').trim());
        item.description = val(n, 'description');
        item.tags = val(n, 'tags');
        const formKeys = new Set(SD.formFor(category).flatMap((s) => s.fields.map((f) => f.key)));
        for (const [k, v] of Object.entries(Object.assign({}, n.attrs, n.text))) {
          if (!String(v).trim() || CELTX_SKIP_FIELDS.has(k)) continue;
          const short = k.replace(/^(character|actor|location|prop|wardrobe|crew|scene|item|[a-z]+?)-/, '');
          if (CELTX_SKIP_FIELDS.has(short)) continue;
          const key = CELTX_FIELDS[short];
          if (key && formKeys.has(key) && !item.fields[key]) item.fields[key] = fieldValue(key, String(v));
          else item.custom.push({ label: prettyKey(short), value: String(v) });
        }
        if (!item.name) item.name = item.fields.fullName || 'Unnamed';
        idByAbout.set(n.about, item.id);
        catalog.push(item);
        pending.push({ n, item });
      }
      // links and media need every item to exist first
      for (const { n, item } of pending) {
        const actor = (n.res.actor || [])[0];
        if (actor && idByAbout.has(actor)) item.links.playedBy = idByAbout.get(actor);
        const chars = (n.res.character || []).flatMap((r) => (seq(r).length ? seq(r) : [r])).map((r) => idByAbout.get(r)).filter(Boolean);
        if (chars.length) item.links.usedBy = chars;
        // some links were stored as plain character names ("Considered For: JACK")
        const byName = (txt) => String(txt).split(/\s*[,;\n]\s*/).map((nm) => catalog.find((c) => c.category === 'character' && c.name.toUpperCase() === nm.trim().toUpperCase())).filter(Boolean);
        item.custom = item.custom.filter((cf) => {
          const key = { 'Considered For': 'consideredFor', 'Characters Used': 'usedBy' }[cf.label];
          if (!key || !SD.formFor(item.category).some((sec) => sec.fields.some((f) => f.key === key))) return true;
          const found = byName(cf.value);
          if (!found.length) return true;
          item.links[key] = [...new Set([...SD.linkIds(item, key), ...found.map((c) => c.id)])];
          return false;
        });
        for (const m of n.res.media || []) {
          const refs = seq(m).length ? seq(m) : [m];
          for (const r of refs) {
            const img = get(r, (x) => x.type === 'Image');
            const local = img && val(img, 'localFile');
            const zf = local && zipFile(local);
            if (!zf) continue;
            try {
              const blob = await zf.async('blob');
              item.media.push({ id: SD.uid(), name: val(img, 'title') || local, data: await SD.imageToDataUrl(blob) });
            } catch (e) { /* skip unreadable media */ }
          }
        }
      }

      // ---------- documents ----------
      const documents = [];
      const sceneRef = new Map();
      const docByAbout = new Map();
      for (const n of nodes) {
        if (n.type !== 'Document') continue;
        const dt = ((n.res.doctype || [])[0] || '').split('/').pop();
        const local = val(n, 'localFile');
        const zf = local && zipFile(local);
        if (!zf) continue;
        const name = val(n, 'title') || local.replace(/\.\w+$/, '');
        const html = await zf.async('string');
        if (CELTX_NOTE_DOCTYPES.has(dt)) {
          const text = htmlToText(html);
          if (text) { const note = SD.newNote(name); note.text = text; const body = new DOMParser().parseFromString(html, 'text/html').body; note.html = SD.sanitizeHtml(body ? body.innerHTML : '') || SD.textToHtml(text); documents.push(note); }
          continue;
        }
        const scriptType = CELTX_DOCTYPES[dt];
        if (!scriptType) continue;
        const doc = SD.newScript(scriptType, name);
        const classes = Object.assign({}, CELTX_CLASSES, CELTX_CLASS_OVERRIDES[scriptType] || {});
        const sceneType = SD.SCRIPT_TYPES[scriptType].sceneType;
        const dom = new DOMParser().parseFromString(html, 'text/html');
        const meta = (k) => { const m = dom.querySelector('meta[name="' + k + '"]'); return m ? m.getAttribute('content') || '' : ''; };
        Object.assign(doc.titlePage, {
          title: (dom.title || '').trim() || projectTitle,
          author: meta('Author'),
          source: meta('DC.source'),
          contact: meta('CX.contact'),
          credit: /^by$/i.test(meta('CX.byline')) || !meta('CX.byline') ? 'Written by' : meta('CX.byline'),
        });

        // scene data (synopsis, colour, breakdown), matched to headings in script order
        const sceneData = (n.res.scenes || []).flatMap((r) => seq(r)).map((r) => get(r)).filter(Boolean);
        const used = new Set();
        const norm = (t) => String(t).toUpperCase().replace(/[^A-Z0-9]/g, '');
        let sceneIdx = 0;
        let curScene = null;
        const els = [];
        for (const p of dom.querySelectorAll('body p')) {
          const cls = (p.className || '').trim().toLowerCase();
          const type = classes[cls] || 'action';
          const notes = [...p.querySelectorAll('span.note')].map((s) => s.getAttribute('text')).filter(Boolean);
          const tagged = [...p.querySelectorAll('span[ref]')].map((s) => idByAbout.get(s.getAttribute('ref'))).filter(Boolean);
          p.querySelectorAll('span.note').forEach((s) => s.remove());
          const raw = p.textContent.replace(/\s+/g, ' ').trim();
          let text = raw;
          if (type === 'scene') text = tidyHeading(raw);
          if (type === 'page') text = raw.replace(/^\(\s*\d+\s+panels?\s*\)$/i, '');
          const e = el(type, text);
          if (type === sceneType) {
            curScene = e;
            let data = null;
            const want = norm(raw);
            for (let k = sceneIdx; k < sceneData.length; k++) {
              if (!used.has(k) && norm(val(sceneData[k], 'title')) === want) { data = sceneData[k]; used.add(k); sceneIdx = k + 1; break; }
            }
            if (!data && cls === 'sceneheading' && sceneData[sceneIdx] && !used.has(sceneIdx)) { data = sceneData[sceneIdx]; used.add(sceneIdx); sceneIdx++; }
            if (data) {
              sceneRef.set(data.about, { doc, el: e });
              if (val(data, 'description')) e.synopsis = val(data, 'description');
              const col = val(data, 'colour').toLowerCase();
              const hex = CELTX_COLOURS[col] || (/^#[0-9a-f]{3,6}$/.test(col) ? col : '');
              if (hex) e.color = hex;
              const members = (data.res.members || []).flatMap((r) => seq(r)).map((r) => idByAbout.get(r)).filter((id) => id && isBreakdownItem(catalog, id));
              if (members.length) e.items = [...new Set(members)];
            }
          }
          if (curScene) {
            const extra = tagged.filter((id) => isBreakdownItem(catalog, id));
            if (extra.length) curScene.items = [...new Set([...(curScene.items || []), ...extra])];

          }
          if (notes.length) e.comments = notes.map((text) => ({ id: SD.uid(), text, quote: '', start: 0, end: 0, created: new Date().toISOString(), done: false }));
          els.push(e);
        }
        if (els.length) doc.elements = els;
        docByAbout.set(n.about, doc);
        documents.push(doc);
      }
      // ---------- storyboards (after the scripts, so sequences can point at their scenes) ----------
      for (const n of nodes) {
        if (n.type !== 'Document') continue;
        const dt = ((n.res.doctype || [])[0] || '').split('/').pop();
        if (!/^StoryboardDocument/.test(dt)) continue;
        const local = val(n, 'localFile');
        const zf = local && zipFile(local);
        if (!zf) continue;
        const xml = new DOMParser().parseFromString(await zf.async('string'), 'application/xml');
        const sb = SD.newStoryboard(val(n, 'title') || 'Storyboard');
        let ratio = '';
        for (const sq of xml.querySelectorAll('sequence')) {
          const ref = sceneRef.get(sq.getAttribute('source'));
          if (ref && !sb.sourceId) sb.sourceId = ref.doc.id;
          const linked = ref && ref.doc.id === sb.sourceId;
          const seq = { id: SD.uid(), title: ref ? ref.el.text.toUpperCase() : tidyHeading(sq.getAttribute('title') || ''), shots: [] };
          if (linked) seq.sceneId = ref.el.id;
          for (const sh of sq.querySelectorAll('shot')) {
            ratio = ratio || sh.getAttribute('ratio') || '';
            const typeText = (sh.getAttribute('shottype') || '').replace(/:\s*$/, '').trim();
            const shot = SD.newShot({ caption: sh.getAttribute('title') || '', shotType: SD.matchShotType(typeText) });
            if (typeText && !shot.shotType) shot.notes = typeText;
            const imgName = (sh.getAttribute('image') || '').split('/').pop();
            const izf = imgName && zipFile(decodeURIComponent(imgName));
            if (izf) { try { shot.image = await SD.imageToDataUrl(await izf.async('blob'), 1280); } catch (e) { /* skip unreadable picture */ } }
            const setup = sh.getAttribute('setupres');
            const sn = setup && get(setup, (m) => m.type === 'Document');
            const sl = sn && val(sn, 'localFile');
            const szf = sl && zipFile(sl);
            if (szf) { try { shot.diagram = await svgToPng(await szf.async('string')); } catch (e) { /* skip unreadable sketch */ } }
            seq.shots.push(shot);
          }
          sb.sequences.push(seq);
        }
        const r = ratio.replace('x', ':');
        if (SD.FRAME_RATIOS[r]) sb.ratio = r;
        if (sb.sequences.length) documents.push(sb);
      }
      // ---------- production schedules (.ics with one entry per scheduled scene) ----------
      for (const n of nodes) {
        if (n.type !== 'Document') continue;
        const dt = ((n.res.doctype || [])[0] || '').split('/').pop();
        if (dt !== 'ScheduleDocument' || !SD.KINDS.schedule) continue;
        const local = val(n, 'localFile');
        const zf = local && zipFile(local);
        const sch = SD.KINDS.schedule.create({ documents: [] }, val(n, 'title') || 'Schedule');
        const src = docByAbout.get((n.res.source || [])[0]);
        if (src) sch.sourceId = src.id;
        Object.assign(sch.callsheet, {
          company: val(n, 'callsheet_prodocompany'), contact: val(n, 'callsheet_contactinfo'), producer: val(n, 'callsheet_prodoteam'),
          location: val(n, 'callsheet_prodonotes'), weather: val(n, 'callsheet_weather'),
        });
        const byDate = new Map();
        for (const e of zf ? SD.parseIcs(await zf.async('string')) : []) {
          const ref = sceneRef.get(e['X-CELTX-SCENE']);
          if (ref) {
            if (!sch.sourceId) sch.sourceId = ref.doc.id;
            if (ref.doc.id !== sch.sourceId) continue;
            if (!byDate.has(e.date)) byDate.set(e.date, { id: SD.uid(), date: e.date, call: e.time, notes: '', scenes: [] });
            const day = byDate.get(e.date);
            day.scenes.push(ref.el.id);
            if (e.time && (!day.call || e.time < day.call)) day.call = e.time;
            if (e.COMMENT) day.notes = [day.notes, e.COMMENT.trim()].filter(Boolean).join(' · ');
            if (/^yes$/i.test(e['X-CELTX-COMPLETED'] || '')) sch.done[ref.el.id] = true;
          } else if (e.SUMMARY) sch.events.push({ id: SD.uid(), date: e.date, title: e.SUMMARY, notes: e.DESCRIPTION || '' });
        }
        sch.days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
        if (sch.days.length || sch.events.length || sch.sourceId) documents.push(sch);
      }
      if (!documents.length && !catalog.length) throw new Error('No scripts or catalog items were found inside this .celtx file.');
      const order = { script: 0, storyboard: 1, schedule: 2, note: 3 };
      documents.sort((a, b) => (order[a.kind] ?? 3) - (order[b.kind] ?? 3));
      return { title: projectTitle || file.name.replace(/\.celtx$/i, ''), documents, catalog };
    },
  };
})();
