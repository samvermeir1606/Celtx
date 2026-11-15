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
  const CELTX_CLASSES = {
    sceneheading: 'scene', action: 'action', character: 'character', dialog: 'dialogue', dialogue: 'dialogue',
    parenthetical: 'parenthetical', transition: 'transition', shot: 'shot', text: 'general', general: 'general',
    act: 'scene', stagedirection: 'action', sound: 'sound', music: 'music', voice: 'character',
  };

  let jszipPromise = null;
  const loadJSZip = () => {
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
  };

  SD.Celtx = {
    async import(file) {
      const JSZip = await loadJSZip();
      const zip = await JSZip.loadAsync(file);
      const names = Object.keys(zip.files);
      // project.rdf maps local files to document titles
      const titles = {};
      let projectTitle = '';
      const rdfName = names.find((n) => /project\.rdf$/i.test(n));
      if (rdfName) {
        try {
          const rdf = new DOMParser().parseFromString(await zip.file(rdfName).async('string'), 'application/xml');
          for (const d of rdf.getElementsByTagName('*')) {
            if (d.localName !== 'Description') continue;
            let lf = '', title = '';
            for (const c of d.children) {
              if (c.localName === 'localFile') lf = c.textContent.trim();
              if (c.localName === 'title') title = c.textContent.trim();
            }
            if (lf && title) titles[lf] = title;
            else if (title && !projectTitle && !lf) projectTitle = title;
          }
        } catch (e) { /* titles are optional */ }
      }
      const docs = [];
      for (const n of names) {
        if (!/\.x?html?$/i.test(n) || zip.files[n].dir) continue;
        const html = await zip.file(n).async('string');
        const dom = new DOMParser().parseFromString(html, 'text/html');
        const base = n.split('/').pop();
        const ps = Array.from(dom.querySelectorAll('p[class]'));
        const known = ps.filter((p) => CELTX_CLASSES[p.className.trim().toLowerCase()]);
        const name = titles[base] || dom.title || base.replace(/\.x?html?$/i, '');
        if (known.length) {
          const doc = SD.newScript('screenplay', name);
          doc.elements = ps.map((p) => {
            const type = CELTX_CLASSES[p.className.trim().toLowerCase()] || 'action';
            return el(type, p.textContent.replace(/\s+/g, ' ').trim());
          });
          if (/stage/i.test(name)) doc.scriptType = 'stageplay';
          docs.push(doc);
        } else {
          const text = (dom.body ? dom.body.innerText || dom.body.textContent : '').trim();
          if (text) { const note = SD.newNote(name); note.text = text; docs.push(note); }
        }
      }
      if (!docs.length) throw new Error('No scripts were found inside this .celtx file.');
      docs.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'script' ? -1 : 1));
      return { title: projectTitle || file.name.replace(/\.celtx$/i, ''), documents: docs };
    },
  };
})();
