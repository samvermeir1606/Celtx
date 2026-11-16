/* Scriptdesk — application shell: project, views, files */
(function () {
  'use strict';
  const SD = window.SD;
  const $ = (s, r = document) => r.querySelector(s);

  // ---------- tiny DOM builder ----------
  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k === 'dataset') Object.assign(e.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k in e && k !== 'list' && k !== 'form') e[k] = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat(Infinity)) {
      if (k == null || k === false) continue;
      e.append(k.nodeType ? k : document.createTextNode(String(k)));
    }
    return e;
  }
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  // ---------- browser storage (per-browser conveniences only) ----------
  const KEYS = { autosave: 'scriptdesk.autosave.v1', theme: 'scriptdesk.theme', zoom: 'scriptdesk.zoom', inspector: 'scriptdesk.inspector' };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };

  // The working copy of the open project lives in IndexedDB, which has room for
  // storyboard pictures (localStorage stops at about 5 MB). Falls back to localStorage.
  const idb = {
    open() {
      if (!idb.p) {
        idb.p = new Promise((res, rej) => {
          if (!window.indexedDB) { rej(new Error('no IndexedDB')); return; }
          const rq = indexedDB.open('scriptdesk', 1);
          rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
          rq.onsuccess = () => res(rq.result);
          rq.onerror = () => rej(rq.error);
        });
        idb.p.catch(() => {});
      }
      return idb.p;
    },
    async run(mode, fn) {
      const db = await idb.open();
      return new Promise((res, rej) => {
        const tx = db.transaction('kv', mode);
        const rq = fn(tx.objectStore('kv'));
        tx.oncomplete = () => res(rq && rq.result);
        tx.onerror = tx.onabort = () => rej(tx.error);
      });
    },
    get: (k) => idb.run('readonly', (os) => os.get(k)),
    set: (k, v) => idb.run('readwrite', (os) => os.put(v, k)),
    del: (k) => idb.run('readwrite', (os) => os.delete(k)),
  };

  const state = {
    project: null,
    docId: null,
    view: 'script',
    fileHandle: null,
    fileName: null,
    dirty: false,
    sceneId: null,
    caretIndex: 0,
    reportTab: 'health',
    catalogFilter: 'all',
    editorStale: true,
    kindTab: {},
  };
  let editor;

  // Read the editor back into the model — only while it is on screen and current,
  // otherwise its (stale) DOM would overwrite edits made in other views.
  const syncEditor = () => {
    if (editor && editor.doc && !state.editorStale && !$('#editor-wrap').hidden) editor.sync();
  };

  const currentDoc = () => state.project.documents.find((d) => d.id === state.docId) || null;
  const isCatalog = () => state.docId === '__catalog';
  const isHome = () => state.docId === '__home';

  // =====================================================================
  // init
  // =====================================================================
  async function init() {
    applyTheme(store.get(KEYS.theme) || 'system');
    editor = new SD.ScriptEditor($('#editor'), {
      onChange: onEditorChange,
      onCaret,
      getSuggestions,
      onRender: () => refreshHighlights(),
    });
    bindChrome();
    applyZoom(+store.get(KEYS.zoom) || 100);

    let restored = null;
    let saved = null;
    try { saved = await idb.get(KEYS.autosave); } catch (e) { /* IndexedDB unavailable */ }
    if (!saved) { try { saved = JSON.parse(store.get(KEYS.autosave) || 'null'); } catch (e) { saved = null; } }
    if (saved && saved.project) {
      try {
        restored = SD.migrate(saved.project);
        state.fileName = saved.fileName || null;
        state.dirty = !!saved.dirty;
      } catch (e) { restored = null; }
    }
    if (restored) {
      setProject(restored, { keepDirty: true, keepFileName: true });
      toast('Picked up where you left off (kept in this browser).');
    } else {
      setProject(SD.newProject());
    }
    if (store.get(KEYS.inspector) === 'off') document.body.classList.add('inspector-off');
  }

  function setProject(p, opts = {}) {
    state.project = p;
    state.fileHandle = opts.fileHandle || null;
    if (!opts.keepFileName) state.fileName = opts.fileName || null;
    if (!opts.keepDirty) state.dirty = false;
    const first = p.documents.find((d) => d.kind === 'script') || p.documents[0];
    // projects with more than a script open on their home page
    state.docId = p.documents.length > 2 ? '__home' : first ? first.id : '__catalog';
    state.view = 'script';
    state.sceneId = null;
    state.editorStale = true;
    editor.histories = {};
    editor.doc = null;
    applyProjectSettings();
    stopTableRead(true);
    closeFind(false);
    logToday();
    renderAll();
    renderGoalChip();
    autosave();
  }

  function renderAll() {
    $('#project-title').value = state.project.title;
    document.title = state.project.title + ' — Scriptdesk';
    renderDocList();
    renderView();
    renderSaveState();
  }

  // =====================================================================
  // dirty state, autosave
  // =====================================================================
  const autosave = debounce(async () => {
    if (!state.project) return;
    const copy = { project: state.project, fileName: state.fileName, dirty: state.dirty };
    let ok = false;
    try {
      await idb.set(KEYS.autosave, copy);
      ok = true;
      if (store.get(KEYS.autosave)) store.del(KEYS.autosave); // older copy from before IndexedDB
    } catch (e) {
      ok = store.set(KEYS.autosave, JSON.stringify(copy));
      // never leave an older copy behind that would come back on the next visit
      if (!ok) { store.del(KEYS.autosave); idb.del(KEYS.autosave).catch(() => {}); }
    }
    if (!ok && !autosave.warned) { autosave.warned = true; toast('This browser could not keep a working copy — remember to Save your project file.'); }
  }, 700);

  function markDirty() {
    trackWords();
    const cd = state.project && currentDoc();
    if (cd) cd.modified = new Date().toISOString();
    state.dirty = true;
    state.project.modified = new Date().toISOString();
    renderSaveState();
    autosave();
    if (isCatalog()) renderStatusSoon();
  }

  function renderSaveState() {
    const el = $('#save-state');
    const name = state.fileName || 'Not saved to a file yet';
    el.replaceChildren(
      h('span', { class: 'save-dot' + (state.dirty ? ' dirty' : '') }),
      h('span', { class: 'save-text' }, state.dirty ? 'Unsaved changes' : state.fileName ? 'Saved' : 'No file'),
    );
    el.title = state.dirty
      ? `${name}\nYour work is kept in this browser, but download/save the project file to keep it safe.`
      : name;
  }

  // =====================================================================
  // editor callbacks
  // =====================================================================
  const refreshDerived = debounce(() => {
    renderNavigator();
    renderStatus();
    if (!$('#inspector').contains(document.activeElement)) renderInspector();
  }, 250);

  const runFindSoon = debounce(() => runFind(), 200);
  function onEditorChange() {
    markDirty();
    refreshDerived();
    if (finder.open) runFindSoon();
  }

  function onCaret(info) {
    const d = currentDoc();
    if (!d || d.kind !== 'script') return;
    const sel = $('#element-select');
    if (sel && sel.value !== info.type) sel.value = info.type;
    state.caretIndex = info.index;
    const st = SD.SCRIPT_TYPES[d.scriptType].sceneType;
    const blocks = editor.root.children;
    let sid = null;
    for (let i = info.index; i >= 0; i--) {
      const b = blocks[i];
      if (b && b.dataset.type === st) { sid = b.dataset.id; break; }
    }
    if (sid !== state.sceneId) {
      state.sceneId = sid;
      renderInspector();
      highlightNav();
    }
    renderStatusSoon();
  }
  const renderStatusSoon = debounce(() => renderStatus(), 120);

  function getSuggestions(doc, type, text) {
    const up = text.toUpperCase();
    const catalog = state.project.catalog;
    if (type === 'character') {
      const freq = new Map();
      for (const e of doc.elements) if (e.type === 'character') { const n = SD.charName(e.text); if (n) freq.set(n, (freq.get(n) || 0) + 1); }
      for (const c of catalog) if (c.category === 'character' && c.name.trim()) { const n = c.name.trim().toUpperCase(); if (!freq.has(n)) freq.set(n, 0); }
      // extension suggestions: "MARY (" -> (V.O.) etc.
      const ext = up.match(/^(.*?)\s*\(([^)]*)$/);
      if (ext) {
        return SD.CHARACTER_EXTENSIONS.filter((x) => x.startsWith('(' + ext[2])).map((x) => ({ label: x, value: ext[1].trim() + ' ' + x, complete: true }));
      }
      return [...freq.entries()]
        .filter(([n]) => n.startsWith(up.trim()) && n !== up.trim())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([n]) => ({ label: n, value: n, complete: true }));
    }
    if (type === 'scene' && SD.SCRIPT_TYPES[doc.scriptType].sceneType === 'scene') {
      const m = up.match(/^(INT\.\/EXT\.|INT\/EXT\.?|I\/E\.|INT\.|EXT\.|EST\.)\s*/);
      if (!m) {
        return SD.SCENE_PREFIXES.filter((p) => p.startsWith(up) && p !== up).map((p) => ({ label: p.trim(), value: p, complete: false }));
      }
      const head = up.slice(0, m[0].length).replace(/\s*$/, ' ');
      const rest = up.slice(m[0].length);
      const dash = rest.lastIndexOf(' -');
      if (dash < 0) {
        const locs = new Map();
        for (const d of state.project.documents) {
          if (d.kind !== 'script') continue;
          for (const e of d.elements) if (e.type === 'scene') { const l = SD.parseSceneHeading(e.text).location; if (l) locs.set(l, (locs.get(l) || 0) + 1); }
        }
        for (const c of catalog) if (c.category === 'location' && c.name.trim()) { const l = c.name.trim().toUpperCase(); if (!locs.has(l)) locs.set(l, 0); }
        return [...locs.entries()]
          .filter(([l]) => l.startsWith(rest) && l !== rest)
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([l]) => ({ label: l, value: head + l + ' - ', complete: false }));
      }
      const tod = rest.slice(dash + 2).trim();
      const base = up.slice(0, m[0].length + dash).replace(/\s*$/, '') + ' - ';
      return SD.TIMES_OF_DAY.filter((t) => t.startsWith(tod) && t !== tod).map((t) => ({ label: t, value: base + t, complete: true }));
    }
    if (type === 'act') {
      return SD.ACT_NAMES.filter((t) => t.startsWith(up.trim()) && t !== up.trim()).map((t) => ({ label: t, value: t, complete: true }));
    }
    if (type === 'transition') {
      return SD.TRANSITIONS.filter((t) => t.startsWith(up) && t !== up).map((t) => ({ label: t, value: t, complete: true }));
    }
    return [];
  }

  // =====================================================================
  // project tree (sidebar)
  // =====================================================================
  function docItem(d) {
    const K = SD.KINDS[d.kind];
    const icon = K ? K.icon : d.kind === 'note' ? '📝' : d.kind === 'storyline' ? '〰️' : d.kind === 'storyboard' ? '🎞️' : SD.SCRIPT_TYPES[d.scriptType].icon;
    const sub = K ? K.label : d.kind === 'note' ? 'Notes' : d.kind === 'storyline' ? 'Storyline' : d.kind === 'storyboard' ? 'Storyboard' : SD.SCRIPT_TYPES[d.scriptType].label;
    return h('li', {
      class: 'doc-item' + (d.id === state.docId ? ' active' : ''),
      title: sub + ' — drag onto a folder to file it',
      draggable: 'true',
      dataset: { doc: d.id },
      onclick: () => selectDoc(d.id),
      ondblclick: () => renameDoc(d),
    },
    h('span', { class: 'doc-icon' }, icon),
    h('span', { class: 'doc-name' }, d.name),
    h('button', { class: 'icon-btn doc-more', title: 'More…', 'aria-label': 'Document options', onclick: (e) => { e.stopPropagation(); docMenu(e.currentTarget, d); } }, '⋯'));
  }

  function renderDocList() {
    const list = $('#doc-list');
    const p = state.project;
    p.folders = p.folders || [];
    const items = [h('li', { class: 'doc-item home-item' + (isHome() ? ' active' : ''), onclick: () => selectDoc('__home') }, h('span', { class: 'doc-icon' }, '🏠'), h('span', { class: 'doc-name' }, 'Home'))];
    items.push(...p.documents.filter((d) => !d.folder).map(docItem));
    for (const f of p.folders) {
      const kids = p.documents.filter((d) => d.folder === f.id);
      items.push(h('li', { class: 'folder-item' + (f.open ? ' open' : ''), dataset: { folder: f.id } },
        h('div', { class: 'doc-item folder-head', title: 'Click to open or close · drop documents here', onclick: () => { f.open = !f.open; markDirty(); renderDocList(); }, ondblclick: () => renameFolder(f) },
          h('span', { class: 'folder-caret' }, f.open ? '▾' : '▸'),
          h('span', { class: 'doc-icon' }, f.open ? '📂' : '📁'),
          h('span', { class: 'doc-name' }, f.name),
          h('span', { class: 'doc-count' }, kids.length || ''),
          h('button', { class: 'icon-btn doc-more', title: 'Folder options', 'aria-label': 'Folder options', onclick: (e) => { e.stopPropagation(); folderMenu(e.currentTarget, f); } }, '⋯')),
        f.open ? h('ul', { class: 'folder-docs' }, kids.length ? kids.map(docItem) : h('li', { class: 'side-empty' }, 'Empty — drag documents here.')) : null));
    }
    items.push(h('li', {
      class: 'doc-item catalog-item' + (isCatalog() ? ' active' : ''),
      onclick: () => selectDoc('__catalog'),
    }, h('span', { class: 'doc-icon' }, '🗂️'), h('span', { class: 'doc-name' }, 'Master Catalog'), h('span', { class: 'doc-count' }, state.project.catalog.length || '')));
    list.replaceChildren(...items);
    if (!list.dataset.dnd) bindDocDrag(list);
  }

  // drag documents into and out of folders
  function bindDocDrag(list) {
    list.dataset.dnd = '1';
    let dragging = null;
    const clear = () => list.querySelectorAll('.drop-on').forEach((x) => x.classList.remove('drop-on'));
    list.addEventListener('dragstart', (e) => {
      const it = e.target.closest && e.target.closest('[data-doc]');
      if (!it) return;
      dragging = it.dataset.doc;
      e.dataTransfer.setData('text/x-scriptdesk-doc', dragging);
      e.dataTransfer.effectAllowed = 'move';
    });
    list.addEventListener('dragend', () => { dragging = null; clear(); });
    list.addEventListener('dragover', (e) => {
      if (!dragging) return;
      e.preventDefault();
      clear();
      const f = e.target.closest('[data-folder]');
      (f ? f.querySelector('.folder-head') : list).classList.add('drop-on');
    });
    list.addEventListener('drop', (e) => {
      if (!dragging) return;
      e.preventDefault();
      const d = state.project.documents.find((x) => x.id === dragging);
      const f = e.target.closest('[data-folder]');
      if (d) { if (f) d.folder = f.dataset.folder; else delete d.folder; markDirty(); }
      dragging = null;
      renderDocList();
    });
  }

  async function addFolder(withDoc) {
    const name = await promptText('New folder', 'Character notes');
    if (!name || !name.trim()) return null;
    const f = { id: SD.uid(), name: name.trim(), open: true };
    state.project.folders.push(f);
    if (withDoc) withDoc.folder = f.id;
    markDirty();
    renderDocList();
    return f;
  }

  async function renameFolder(f) {
    const name = await promptText('Rename folder', f.name);
    if (!name || !name.trim()) return;
    f.name = name.trim();
    markDirty();
    renderDocList();
  }

  function folderMenu(anchor, f) {
    popupMenu(anchor, [
      { label: 'New notes in this folder', run: () => { const d = SD.newNote(f.name + ' ' + (state.project.documents.filter((x) => x.folder === f.id).length + 1)); d.folder = f.id; state.project.documents.push(d); f.open = true; markDirty(); selectDoc(d.id); } },
      { label: 'Rename…', run: () => renameFolder(f) },
      '-',
      { label: 'Delete folder (keeps the documents)', danger: true, run: () => { state.project.documents.forEach((d) => { if (d.folder === f.id) delete d.folder; }); state.project.folders = state.project.folders.filter((x) => x !== f); markDirty(); renderDocList(); } },
    ]);
  }

  function selectDoc(id) {
    syncEditor();
    state.docId = id;
    state.sceneId = null;
    const d = currentDoc();
    if (d && d.kind === 'script' && !['script', 'title', 'cards', 'reports'].includes(state.view)) state.view = 'script';
    if (d && d.kind === 'script') state.view = state.view || 'script';
    state.editorStale = true;
    document.body.classList.remove('show-sidebar');
    renderDocList();
    renderView();
  }

  function addDoc(kind) {
    let d;
    const count = (pred) => state.project.documents.filter(pred).length;
    if (SD.KINDS[kind]) {
      const K = SD.KINDS[kind];
      const n = count((x) => x.kind === kind);
      d = K.create(state.project, K.label + (n ? ' ' + (n + 1) : ''));
    } else if (kind === 'note') d = SD.newNote(count((x) => x.kind === 'note') ? 'Notes ' + (count((x) => x.kind === 'note') + 1) : 'Notes');
    else if (kind === 'storyline') {
      const n = count((x) => x.kind === 'storyline');
      d = SD.newStoryline('Storyline' + (n ? ' ' + (n + 1) : ''));
      const scripts = state.project.documents.filter((x) => x.kind === 'script' && SD.getScenes(x).length);
      if (scripts.length === 1) SD.syncStorylineFromScript(state.project, d, scripts[0]);
    } else if (kind === 'storyboard') {
      const n = count((x) => x.kind === 'storyboard');
      d = SD.newStoryboard('Storyboard' + (n ? ' ' + (n + 1) : ''));
      const scripts = state.project.documents.filter((x) => x.kind === 'script' && SD.getScenes(x).length);
      if (scripts.length === 1) SD.syncStoryboardFromScript(state.project, d, scripts[0]);
    } else {
      const n = count((x) => x.scriptType === kind);
      d = SD.newScript(kind, SD.SCRIPT_TYPES[kind].label + (n ? ' ' + (n + 1) : ''));
      d.titlePage.title = state.project.title !== 'Untitled Project' ? state.project.title : '';
    }
    const cur = currentDoc();
    if (cur && cur.folder) d.folder = cur.folder;
    state.project.documents.push(d);
    markDirty();
    state.view = 'script';
    selectDoc(d.id);
  }

  async function renameDoc(d) {
    const name = await promptText('Rename document', d.name);
    if (name == null || !name.trim()) return;
    d.name = name.trim();
    markDirty();
    renderDocList();
    renderView();
  }

  function moveDoc(d, dir) {
    const docs = state.project.documents;
    const i = docs.indexOf(d);
    // the neighbour in the same folder (or at the top level)
    let j = i + dir;
    while (j >= 0 && j < docs.length && (docs[j].folder || '') !== (d.folder || '')) j += dir;
    if (j < 0 || j >= docs.length) return;
    [docs[i], docs[j]] = [docs[j], docs[i]];
    markDirty();
    renderDocList();
  }

  async function deleteDoc(d) {
    const ok = await modal({
      title: 'Delete “' + d.name + '”?',
      body: 'This removes the document from the project. You can undo this only by re-opening a saved copy of the project file.',
      buttons: [{ label: 'Cancel', value: false }, { label: 'Delete', value: true, primary: true, danger: true }],
    });
    if (!ok) return;
    const docs = state.project.documents;
    docs.splice(docs.indexOf(d), 1);
    delete editor.histories[d.id];
    if (editor.doc === d) editor.doc = null;
    markDirty();
    if (state.docId === d.id) selectDoc((docs.find((x) => x.kind === 'script') || docs[0] || { id: '__catalog' }).id);
    else renderDocList();
  }

  function duplicateDoc(d) {
    const copy = JSON.parse(JSON.stringify(d));
    copy.id = SD.uid();
    copy.name = d.name + ' (copy)';
    if (copy.elements) copy.elements.forEach((e) => { e.id = SD.uid(); });
    const docs = state.project.documents;
    docs.splice(docs.indexOf(d) + 1, 0, copy);
    markDirty();
    selectDoc(copy.id);
  }

  async function convertDoc(d) {
    const sel = h('select', { class: 'input' }, Object.entries(SD.SCRIPT_TYPES).map(([k, t]) => h('option', { value: k, selected: k === d.scriptType }, t.label)));
    const v = await modal({
      title: 'Change script type',
      body: h('div', {}, h('p', {}, 'Change the format of “' + d.name + '”. Elements that the new format does not have become Action.'), sel),
      buttons: [{ label: 'Cancel', value: null }, { label: 'Change', value: () => sel.value, primary: true }],
    });
    if (!v || v === d.scriptType) return;
    const t = SD.SCRIPT_TYPES[v];
    const oldScene = SD.SCRIPT_TYPES[d.scriptType].sceneType;
    d.elements.forEach((e) => {
      if (e.type === oldScene) e.type = t.sceneType;
      else if (!t.elements.includes(e.type)) e.type = 'action';
    });
    d.scriptType = v;
    delete editor.histories[d.id];
    editor.doc = null;
    state.editorStale = true;
    markDirty();
    renderDocList();
    renderView();
  }

  function docMenu(anchor, d) {
    const items = [
      { label: 'Rename…', run: () => renameDoc(d) },
      { label: 'Duplicate', run: () => duplicateDoc(d) },
      d.kind === 'script' ? { label: 'Change script type…', run: () => convertDoc(d) } : null,
      { label: 'Move up', run: () => moveDoc(d, -1) },
      { label: 'Move down', run: () => moveDoc(d, 1) },
      '-',
      ...state.project.folders.filter((f) => f.id !== d.folder).map((f) => ({ label: 'Move to 📁 ' + f.name, run: () => { d.folder = f.id; f.open = true; markDirty(); renderDocList(); } })),
      d.folder ? { label: 'Take out of the folder', run: () => { delete d.folder; markDirty(); renderDocList(); } } : null,
      { label: 'Move to a new folder…', run: () => addFolder(d) },
      '-',
      { label: 'Delete…', danger: true, run: () => deleteDoc(d) },
    ];
    popupMenu(anchor, items);
  }

  // ---------- scene navigator ----------
  function renderNavigator() {
    const list = $('#scene-list');
    const d = currentDoc();
    if (d && d.kind === 'storyline') {
      $('#scene-head-label').textContent = 'Moments';
      $('#scene-count').textContent = d.beats.length || '';
      const cur = storyBeatOf(d, storySel(d));
      list.replaceChildren(...(d.beats.length ? d.beats.map((b, i) => h('li', {
        class: 'scene-item' + (cur === b ? ' current' : ''),
        style: b.groups[0] && b.groups[0].color ? `--scene-color:${b.groups[0].color}` : '',
        onclick: () => { setStorySel(d, 'beat', b.id); state.storyRefresh && state.storyRefresh(); renderNavigator(); },
      }, h('span', { class: 'scene-num' }, b.sceneId ? (b.number || i + 1) : '◆'),
      h('span', { class: 'scene-text' }, b.label || (b.groups[0] && b.groups[0].label) || 'Moment ' + (i + 1)),
      h('span', { class: 'scene-len' }, b.events.length ? b.events.length + '★' : ''))) : [h('li', { class: 'side-empty' }, 'No moments yet.')]));
      return;
    }
    if (d && SD.KINDS[d.kind]) {
      const K = SD.KINDS[d.kind];
      const nav = K.navigator ? K.navigator(d) : null;
      $('#scene-head-label').textContent = nav ? nav.label : 'Scenes';
      $('#scene-count').textContent = nav && nav.items.length ? nav.items.length : '';
      list.replaceChildren(...(nav && nav.items.length ? nav.items.map((it) => h('li', {
        class: 'scene-item' + (it.current ? ' current' : ''),
        style: it.color ? `--scene-color:${it.color}` : '',
        title: it.title || '',
        onclick: it.onclick,
      }, h('span', { class: 'scene-num' }, it.num == null ? '' : it.num), h('span', { class: 'scene-text' }, it.text), h('span', { class: 'scene-len' }, it.len || ''))) : [h('li', { class: 'side-empty' }, nav ? nav.empty : 'Nothing to list here.')]));
      return;
    }
    if (d && d.kind === 'storyboard') {
      $('#scene-head-label').textContent = 'Sequences';
      $('#scene-count').textContent = d.sequences.length || '';
      const nums = SD.storyboardNumbers(state.project, d);
      const cur = state.sbSel && state.sbSel.doc === d.id ? state.sbSel.seq : null;
      list.replaceChildren(...(d.sequences.length ? d.sequences.map((s) => h('li', {
        class: 'scene-item' + (cur === s.id ? ' current' : ''),
        onclick: () => { state.sbSel = { doc: d.id, seq: s.id }; state.sbRefresh && state.sbRefresh(s.id); renderNavigator(); },
      }, h('span', { class: 'scene-num' }, nums.get(s.id)),
      h('span', { class: 'scene-text' }, s.title || h('em', {}, 'Untitled sequence')),
      h('span', { class: 'scene-len' }, s.shots.length || ''))) : [h('li', { class: 'side-empty' }, 'No sequences yet.')]));
      return;
    }
    if (!d || d.kind !== 'script') {
      $('#scene-head-label').textContent = 'Scenes';
      list.replaceChildren(h('li', { class: 'side-empty' }, isCatalog() || isHome() ? 'Pick a script to see its scenes.' : 'Notes have no scenes.'));
      $('#scene-count').textContent = '';
      return;
    }
    const scenes = SD.getScenes(d);
    $('#scene-head-label').textContent = d.scriptType === 'comic' ? 'Pages' : 'Scenes';
    $('#scene-count').textContent = scenes.length || '';
    if (!scenes.length) {
      list.replaceChildren(h('li', { class: 'side-empty' }, d.scriptType === 'comic' ? 'Add a Page element to start.' : 'Type a scene heading (INT. / EXT.) to start a scene.'));
      return;
    }
    list.replaceChildren(...scenes.map((s) => {
      let label = s.el.text.trim().toUpperCase();
      if (d.scriptType === 'comic') label = 'PAGE ' + s.number + (label ? ' — ' + label : '');
      return h('li', {
        class: 'scene-item' + (s.id === state.sceneId ? ' current' : ''),
        dataset: { id: s.id },
        style: s.el.color ? `--scene-color:${s.el.color}` : '',
        title: s.el.synopsis || label,
        onclick: () => goToScene(s.id),
      },
      h('span', { class: 'scene-num' }, s.number),
      h('span', { class: 'scene-text' }, label || h('em', {}, 'Untitled scene')),
      h('span', { class: 'scene-len' }, SD.eighths(s.lines)));
    }));
  }

  function highlightNav() {
    for (const li of document.querySelectorAll('#scene-list .scene-item')) {
      const on = li.dataset.id === state.sceneId;
      li.classList.toggle('current', on);
      if (on) li.scrollIntoView({ block: 'nearest' });
    }
  }

  function goToScene(id) {
    document.body.classList.remove('show-sidebar');
    if (state.view !== 'script') { state.view = 'script'; renderView(); }
    requestAnimationFrame(() => editor.goTo(id));
  }

  // =====================================================================
  // views
  // =====================================================================
  function renderView() {
    const d = currentDoc();
    if (reader.on && (!d || d.id !== reader.docId || state.view !== 'script')) stopTableRead(true);
    if (finder.open && (!d || d.kind !== 'script' || state.view !== 'script')) closeFind(false);
    const showEditor = !!(d && d.kind === 'script' && state.view === 'script');
    $('#editor-wrap').hidden = !showEditor;
    $('#other-view').hidden = showEditor;
    document.body.classList.toggle('editor-mode', showEditor);
    renderTabs();
    renderToolbar();
    if (showEditor) {
      if (editor.doc !== d || state.editorStale) {
        editor.load(d);
        state.editorStale = false;
      }
    } else {
      const ov = $('#other-view');
      ov.replaceChildren();
      ov.scrollTop = 0;
      if (isCatalog()) renderCatalog(ov);
      else if (isHome()) renderHome(ov);
      else if (!d) ov.append(h('div', { class: 'empty-state' }, h('p', {}, 'This project has no documents. Use + in the sidebar to add one.')));
      else if (d.kind === 'note') renderNote(ov, d);
      else if (d.kind === 'storyline') renderStoryline(ov, d);
      else if (d.kind === 'storyboard') renderStoryboard(ov, d);
      else if (SD.KINDS[d.kind]) SD.KINDS[d.kind].render(ov, d);
      else if (state.view === 'title') renderTitleView(ov, d);
      else if (state.view === 'cards') renderCards(ov, d);
      else if (state.view === 'reports') renderReports(ov, d);
    }
    renderNavigator();
    renderInspector();
    renderStatus();
  }

  function setView(v) {
    syncEditor();
    state.view = v;
    renderView();
  }

  function renderTabs() {
    const tabs = $('#view-tabs');
    const d = currentDoc();
    if (isCatalog()) { tabs.replaceChildren(h('div', { class: 'view-title' }, '🗂️ Master Catalog')); return; }
    if (isHome()) { tabs.replaceChildren(h('div', { class: 'view-title' }, '🏠 ' + (state.project.title || 'Home'))); return; }
    if (!d) { tabs.replaceChildren(); return; }
    if (d.kind === 'note') { tabs.replaceChildren(h('div', { class: 'view-title' }, '📝 ' + d.name)); return; }
    if (SD.KINDS[d.kind]) {
      const K = SD.KINDS[d.kind];
      if (!K.tabs) { tabs.replaceChildren(h('div', { class: 'view-title' }, K.icon + ' ' + d.name)); return; }
      const cur = state.kindTab[d.kind] || K.tabs[0][0];
      tabs.replaceChildren(...K.tabs.map(([v, label]) => h('button', {
        class: 'tab' + (cur === v ? ' active' : ''),
        onclick: () => { state.kindTab[d.kind] = v; renderView(); },
      }, label)));
      return;
    }
    if (d.kind === 'storyline') {
      tabs.replaceChildren(...[['flow', 'Flow'], ['grid', 'Grid']].map(([v, label]) => h('button', {
        class: 'tab' + ((state.storyTab || 'flow') === v ? ' active' : ''),
        onclick: () => { state.storyTab = v; renderView(); },
      }, label)));
      return;
    }
    if (d.kind === 'storyboard') {
      tabs.replaceChildren(...[['board', 'Board'], ['list', 'Shot list']].map(([v, label]) => h('button', {
        class: 'tab' + ((state.sbTab || 'board') === v ? ' active' : ''),
        onclick: () => { state.sbTab = v; renderView(); },
      }, label)));
      return;
    }
    const defs = [['script', 'Script'], ['title', 'Title Page'], ['cards', d.scriptType === 'comic' ? 'Page Cards' : 'Index Cards'], ['reports', 'Reports']];
    tabs.replaceChildren(...defs.map(([v, label]) => h('button', {
      class: 'tab' + (state.view === v ? ' active' : ''),
      onclick: () => setView(v),
    }, label)));
  }

  function renderToolbar() {
    const tb = $('#toolbar');
    const d = currentDoc();
    if (d && d.kind === 'storyline') {
      const refresh = () => state.storyRefresh && state.storyRefresh();
      tb.replaceChildren(
        h('button', { class: 'btn small', onclick: () => { const sel = storySel(d); const b = storyBeatOf(d, sel); storyAddBeat(d, b ? d.beats.indexOf(b) : undefined); refresh(); } }, '+ Moment'),
        h('button', { class: 'btn small', onclick: (e) => storyAddCharacterMenu(e.currentTarget, d, (row) => { setStorySel(d, 'row', row.id); refresh(); }) }, '+ Character'),
        h('button', { class: 'btn small', title: 'Pull scenes and who is in them from a script', onclick: (e) => storyBuildMenu(e.currentTarget, d, refresh) }, d.sourceId ? '⟳ Update from script' : 'Build from script…'),
        h('div', { class: 'tb-group' },
          h('button', { class: 'btn ghost small', title: 'Download as an SVG image', onclick: () => download(safeName(d.name) + '.svg', storylineSVGForExport(d), 'image/svg+xml') }, 'SVG'),
          h('button', { class: 'btn ghost small', title: 'Print or save as PDF', onclick: () => printStoryline(d) }, 'Print')));
      return;
    }
    if (d && d.kind === 'storyboard') { tb.replaceChildren(...storyboardToolbar(d)); return; }
    if (d && SD.KINDS[d.kind]) { tb.replaceChildren(...(SD.KINDS[d.kind].toolbar ? SD.KINDS[d.kind].toolbar(d) : [])); return; }
    if (d && d.kind === 'note') { tb.replaceChildren(...noteToolbar(d)); return; }
    if (!d || d.kind !== 'script' || state.view !== 'script') { tb.replaceChildren(); return; }
    const types = SD.SCRIPT_TYPES[d.scriptType];
    const sel = h('select', {
      id: 'element-select',
      class: 'select',
      title: 'Element type — Tab cycles, Ctrl+1…' + types.elements.length + ' jumps',
      onchange: (e) => editor.setType(e.target.value),
    }, types.elements.map((t, i) => h('option', { value: t }, `${SD.labelFor(d.scriptType, t)}   ⌃${i + 1}`)));
    const cur = editor.curBlock && editor.curBlock.dataset.type;
    if (cur) sel.value = cur;
    const s = state.project.settings;
    tb.replaceChildren(
      sel,
      h('button', { class: 'btn ghost small only-touch', title: 'Next element type (like Tab)', onmousedown: (e) => e.preventDefault(), onclick: () => { editor.focusEditor(); editor.handleTab(false); } }, '⇥'),
      h('div', { class: 'tb-group' },
        h('button', { class: 'icon-btn', title: 'Undo (Ctrl+Z)', 'aria-label': 'Undo', onclick: () => editor.undo() }, '↶'),
        h('button', { class: 'icon-btn', title: 'Redo (Ctrl+Y)', 'aria-label': 'Redo', onclick: () => editor.redo() }, '↷')),
      h('div', { class: 'tb-group' },
        ['b', 'i', 'u'].map((k) => h('button', { class: 'icon-btn fmt-' + k, title: { b: 'Bold (Ctrl+B)', i: 'Italic (Ctrl+I)', u: 'Underline (Ctrl+U)' }[k] + ' — select words first', 'aria-label': { b: 'Bold', i: 'Italic', u: 'Underline' }[k], onmousedown: (e) => e.preventDefault(), onclick: () => editor.format(k) }, k.toUpperCase()))),
      h('label', { class: 'tb-check', title: 'Show scene numbers' },
        h('input', { type: 'checkbox', checked: s.sceneNumbers, onchange: (e) => { s.sceneNumbers = e.target.checked; applyProjectSettings(); markDirty(); } }), '#'),
      h('select', { class: 'select', title: 'Zoom', onchange: (e) => applyZoom(+e.target.value) },
        [75, 90, 100, 110, 125, 150].map((z) => h('option', { value: z, selected: z === state.zoom }, z + '%'))),
      h('div', { class: 'tb-group' },
        h('button', { class: 'btn ghost small', title: 'Find & replace (Ctrl+F, Ctrl+H)', onclick: () => openFind(false) }, '🔍 Find'),
        h('button', { class: 'btn ghost small', title: 'Comment on the selected words (Ctrl+Alt+M)', onmousedown: (e) => e.preventDefault(), onclick: addComment }, '💬 Comment'),
        commentCount(d) ? h('button', { class: 'btn ghost small', title: 'All comments in this script', onclick: () => showAllComments(d) }, commentCount(d) + ' open') : null,
        h('button', { class: 'btn ghost small', title: 'Dual dialogue: this speech happens at the same time as the one before (Ctrl+D)', onmousedown: (e) => e.preventDefault(), onclick: toggleDual }, '⇉ Dual'),
        h('button', { class: 'btn ghost small' + (reader.on ? ' primary' : ''), title: 'Table read: the script is read aloud from the cursor, one voice per character', onclick: () => (reader.on ? stopTableRead() : startTableRead()) }, reader.on ? '■ Stop reading' : '🔊 Table read')),
      h('button', { class: 'btn ghost small', title: 'Show or hide the scene panel', onclick: toggleInspector }, 'Scene panel'),
    );
  }

  function toggleInspector() {
    if (window.matchMedia('(max-width: 1100px)').matches) {
      document.body.classList.toggle('show-inspector');
      return;
    }
    const off = document.body.classList.toggle('inspector-off');
    store.set(KEYS.inspector, off ? 'off' : 'on');
  }

  // ---------- scene inspector ----------
  function renderInspector() {
    const ins = $('#inspector');
    const d = currentDoc();
    if (!d || d.kind !== 'script' || state.view !== 'script') { ins.replaceChildren(); return; }
    const scenes = SD.getScenes(d);
    const sc = scenes.find((s) => s.id === state.sceneId);
    if (!sc) {
      ins.replaceChildren(
        h('div', { class: 'ins-section' },
          h('div', { class: 'ins-kicker' }, 'Scene panel'),
          h('p', { class: 'muted' }, 'Put the cursor inside a scene to add a synopsis, a colour, notes and breakdown items (props, wardrobe…).')),
        quickHelp(d));
      return;
    }
    const e = sc.el;
    const chars = SD.sceneCharacters(d, sc);
    const items = (e.items || []).map((id) => state.project.catalog.find((c) => c.id === id)).filter(Boolean);
    const touched = () => { editor.refreshState(); markDirty(); };

    const nameInput = h('input', { class: 'input', placeholder: 'Item name', list: 'catalog-names' });
    const catSelect = h('select', { class: 'select' }, SD.CATEGORIES.filter((c) => c.breakdown && c.id !== 'character' && c.id !== 'location').concat(SD.CATEGORIES.filter((c) => c.id === 'character' || c.id === 'location'))
      .map((c) => h('option', { value: c.id }, c.one)));
    catSelect.value = state.lastBreakdownCat || 'prop';
    const datalist = h('datalist', { id: 'catalog-names' }, state.project.catalog.map((c) => h('option', { value: c.name })));
    const add = () => {
      state.lastBreakdownCat = catSelect.value;
      addBreakdownItem(e, catSelect.value, nameInput.value);
    };
    nameInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); add(); } });

    const grouped = new Map();
    for (const it of items) { if (!grouped.has(it.category)) grouped.set(it.category, []); grouped.get(it.category).push(it); }

    ins.replaceChildren(
      h('div', { class: 'ins-section' },
        h('div', { class: 'ins-kicker' }, `${d.scriptType === 'comic' ? 'Page' : 'Scene'} ${sc.number} · ${SD.eighths(sc.lines)} pg · p. ${sc.page}`),
        h('div', { class: 'ins-title' }, (d.scriptType === 'comic' ? 'PAGE ' + sc.number + ' ' : '') + (e.text.toUpperCase() || '') || 'Untitled scene')),
      sceneCommentsSection(d, sc),
      sceneTempSection(d, sc),
      sceneVersionsSection(d, sc),
      h('div', { class: 'ins-section' },
        h('label', { class: 'lbl' }, 'Synopsis'),
        h('textarea', { class: 'input', rows: 3, placeholder: 'What happens in this scene?', value: e.synopsis || '', oninput: (ev) => { e.synopsis = ev.target.value; touched(); } }),
        h('label', { class: 'lbl' }, 'Colour'),
        h('div', { class: 'swatches' }, SD.SCENE_COLORS.map((c) => h('button', {
          class: 'swatch' + ((e.color || '') === c ? ' on' : '') + (c ? '' : ' none'),
          style: c ? `background:${c}` : '',
          title: c ? 'Colour' : 'No colour',
          'aria-label': c ? 'Set colour ' + c : 'No colour',
          onclick: () => { if (c) e.color = c; else delete e.color; touched(); renderInspector(); renderNavigator(); },
        })))),
      h('div', { class: 'ins-section' },
        h('label', { class: 'lbl' }, 'Characters in scene'),
        chars.length ? h('div', { class: 'chips' }, chars.map((n) => {
          const item = SD.findCatalogItem(state.project, 'character', n);
          const actor = item && item.links.playedBy && state.project.catalog.find((c) => c.id === item.links.playedBy);
          return h('button', {
            class: 'chip link', style: `--chip:${SD.categoryById('character').color}`,
            title: item ? 'Open character profile' : 'Create a character profile',
            onclick: () => openCatalogItem(item ? item.id : null, { category: 'character', name: n }),
          }, n, actor ? h('span', { class: 'chip-sub' }, ' · ' + actor.name) : null);
        })) : h('p', { class: 'muted small' }, 'None yet — they appear automatically from Character elements.')),
      h('div', { class: 'ins-section' },
        h('label', { class: 'lbl' }, 'Breakdown'),
        items.length
          ? h('div', { class: 'breakdown' }, [...grouped.entries()].map(([cat, list]) => h('div', { class: 'bd-group' },
            h('div', { class: 'bd-cat', style: `--chip:${SD.categoryById(cat).color}` }, SD.categoryById(cat).label),
            h('div', { class: 'chips' }, list.map((it) => h('span', { class: 'chip', style: `--chip:${SD.categoryById(cat).color}` },
              h('button', { class: 'chip-name', title: 'Open in catalog', onclick: () => openCatalogItem(it.id) }, it.name),
              h('button', { class: 'chip-x', title: 'Remove from scene', 'aria-label': 'Remove ' + it.name, onclick: () => { e.items = e.items.filter((x) => x !== it.id); touched(); renderInspector(); } }, '×')))))))
          : h('p', { class: 'muted small' }, 'Tag props, wardrobe, vehicles, effects… used in this scene.'),
        h('div', { class: 'bd-add' }, catSelect, nameInput, datalist,
          h('div', { class: 'bd-buttons' },
            h('button', { class: 'btn small', onclick: add }, 'Add'),
            h('button', {
              class: 'btn ghost small',
              title: 'Fill the name with the text selected in the script',
              onmousedown: (ev) => ev.preventDefault(),
              onclick: () => {
                const t = editor.lastSelectedText;
                if (!t) { toast('Select a word in the script first.'); return; }
                nameInput.value = t.replace(/\s+/g, ' ').slice(0, 60);
                nameInput.focus();
              },
            }, 'Use selection')))),
      h('div', { class: 'ins-section' },
        h('label', { class: 'lbl' }, 'Scene notes'),
        h('textarea', { class: 'input', rows: 4, placeholder: 'Ideas, research, production notes…', value: e.notes || '', oninput: (ev) => { e.notes = ev.target.value; touched(); } })),
    );
  }

  // ---------- scene versions: alternatives of a scene you can switch between ----------
  const cloneEls = (els, freshIds) => els.map((e) => Object.assign(JSON.parse(JSON.stringify(e)), freshIds ? { id: SD.uid() } : {}));
  const countWords = (els) => els.reduce((n, e) => n + ((e.text || '').match(/[\p{L}\p{N}'’-]+/gu) || []).length, 0);

  function sceneVersionsSection(d, sc) {
    const e = sc.el;
    const versions = (e.versions = Array.isArray(e.versions) ? e.versions : []);
    const curName = e.versionName || 'Version 1';
    const body = () => { syncEditor(); const s2 = SD.getScenes(d).find((x) => x.id === sc.id); return s2 ? d.elements.slice(s2.start + 1, s2.end) : []; };
    const touched = () => { editor.refreshState(); markDirty(); renderInspector(); };
    const save = async () => {
      const name = await promptText('Name this version', versions.length ? 'Version ' + (versions.length + 2) : 'Version 2');
      if (name == null) return;
      if (!e.versionName) e.versionName = 'Version 1';
      versions.push({ id: SD.uid(), name: name.trim() || 'Version ' + (versions.length + 2), created: new Date().toISOString(), elements: cloneEls(body(), true) });
      touched();
      toast('Saved a copy. Keep editing — you can switch back any time.');
    };
    const use = (v) => {
      syncEditor();
      const s2 = SD.getScenes(d).find((x) => x.id === sc.id);
      if (!s2) return;
      const open = editor.doc === d && !state.editorStale;
      if (open) editor.pushUndo(editor.snapshot());
      const current = d.elements.slice(s2.start + 1, s2.end);
      versions.splice(versions.indexOf(v), 1, { id: SD.uid(), name: curName, created: new Date().toISOString(), elements: cloneEls(current) });
      const taken = new Set(d.elements.filter((x, i) => i <= s2.start || i >= s2.end).map((x) => x.id));
      const incoming = cloneEls(v.elements).map((x) => (taken.has(x.id) ? Object.assign(x, { id: SD.uid() }) : x));
      d.elements.splice(s2.start + 1, s2.end - s2.start - 1, ...(incoming.length ? incoming : [{ id: SD.uid(), type: 'action', text: '' }]));
      e.versionName = v.name;
      if (open) { editor.render(); editor.lastState = editor.snapshot(); editor.goTo(sc.id); } else state.editorStale = true;
      state.sceneId = sc.id;
      markDirty();
      refreshDerived();
      renderInspector();
      toast(`Now using “${v.name}”. “${curName}” is kept as a version.`);
    };
    const compare = (v) => {
      const cur = body();
      const texts = (els) => new Set(els.map((x) => x.text.trim()).filter(Boolean));
      const a = texts(cur), b = texts(v.elements);
      const col = (title, els, other) => {
        const page = h('div', { class: 'script-text vc-page' });
        page.dataset.scriptType = d.scriptType;
        for (const x of els) {
          const div = h('div', { class: 'el' + (x.text.trim() && !other.has(x.text.trim()) ? ' vc-diff' : '') });
          div.dataset.type = x.type;
          if (x.text) SD.fillFormatted(div, x.text, x.fmt); else div.textContent = '\u00a0';
          page.append(div);
        }
        return h('div', { class: 'vc-col' }, h('div', { class: 'vc-head' }, h('strong', {}, title), h('span', { class: 'muted small' }, ` ${countWords(els)} words`)), page);
      };
      modal({ title: 'Compare versions of scene ' + sc.number, wide: true, body: h('div', {}, h('p', { class: 'muted small' }, 'Highlighted lines are only in that version.'), h('div', { class: 'vc' }, col(curName + ' (in use)', cur, b), col(v.name, v.elements, a))), buttons: [{ label: 'Close', value: true, primary: true }] });
    };
    return h('div', { class: 'ins-section' },
      h('div', { class: 'cm-head-row' }, h('label', { class: 'lbl' }, 'Versions of this scene'),
        h('button', { class: 'btn ghost small', title: 'Keep a copy of the scene as it is now, then try something different', onclick: save }, '+ Save a version')),
      versions.length
        ? [h('div', { class: 'ver-row on' }, h('span', { class: 'ver-name' }, '✓ ' + curName), h('span', { class: 'muted small' }, 'in use · ' + countWords(body()) + ' words')),
          ...versions.map((v) => h('div', { class: 'ver-row' },
            h('span', { class: 'ver-name' }, v.name),
            h('span', { class: 'muted small' }, countWords(v.elements) + ' words · ' + fmtDate(v.created)),
            h('span', { class: 'ver-btns' },
              h('button', { class: 'btn ghost small', onclick: () => compare(v) }, 'Compare'),
              h('button', { class: 'btn small', onclick: () => use(v) }, 'Use'),
              h('button', { class: 'icon-btn', title: 'More', 'aria-label': 'Version options', onclick: (ev) => popupMenu(ev.currentTarget, [
                { label: 'Rename…', run: async () => { const n2 = await promptText('Rename version', v.name); if (n2 && n2.trim()) { v.name = n2.trim(); touched(); } } },
                { label: 'Delete version', danger: true, run: () => { e.versions = versions.filter((x) => x !== v); if (!e.versions.length) { delete e.versions; delete e.versionName; } touched(); } },
              ]) }, '⋯'))))]
        : h('p', { class: 'muted small' }, 'Want to try the scene another way? Save a version first; you can switch between versions and compare them.'));
  }

  function quickHelp(d) {
    const t = SD.SCRIPT_TYPES[d.scriptType];
    return h('div', { class: 'ins-section' },
      h('div', { class: 'ins-kicker' }, 'Keys'),
      h('ul', { class: 'keys' },
        h('li', {}, h('kbd', {}, 'Enter'), ' next element'),
        h('li', {}, h('kbd', {}, 'Tab'), ' change element'),
        h('li', {}, h('kbd', {}, 'Shift+Tab'), ' previous element'),
        h('li', {}, h('kbd', {}, 'Ctrl+1…' + t.elements.length), ' pick element'),
        h('li', {}, h('kbd', {}, 'Enter'), ' on an empty line switches to ' + (d.scriptType === 'comic' ? 'Action' : 'Action / Scene Heading'))));
  }

  function addBreakdownItem(sceneEl, category, name) {
    name = (name || '').trim();
    if (!name) { toast('Type a name for the item first.'); return; }
    const cat = state.project.catalog;
    let item = cat.find((c) => c.category === category && c.name.trim().toUpperCase() === name.toUpperCase());
    if (!item) { item = SD.newCatalogItem(category, name); cat.push(item); }
    sceneEl.items = sceneEl.items || [];
    if (!sceneEl.items.includes(item.id)) sceneEl.items.push(item.id);
    editor.refreshState();
    markDirty();
    renderInspector();
    renderDocList();
    $('#inspector input[list]')?.focus();
  }

  // ---------- Title page ----------
  function titlePageNode(tp) {
    const lines = (s) => String(s || '').split('\n').map((l) => h('div', {}, l || ' '));
    return h('div', { class: 'title-page script-font' },
      h('div', { class: 'tp-center' },
        h('div', { class: 'tp-title' }, lines(tp.title || 'Untitled')),
        tp.credit ? h('div', { class: 'tp-credit' }, lines(tp.credit)) : null,
        tp.author ? h('div', { class: 'tp-author' }, lines(tp.author)) : null,
        tp.source ? h('div', { class: 'tp-source' }, lines(tp.source)) : null),
      tp.episode ? h('div', { class: 'tp-episode' }, lines(tp.episode)) : null,
      h('div', { class: 'tp-contact' }, lines(tp.contact)),
      h('div', { class: 'tp-draft' }, lines(tp.draftDate)));
  }

  function renderTitleView(root, d) {
    const tp = d.titlePage;
    const preview = h('div', { class: 'page title-preview' });
    const upd = () => preview.replaceChildren(titlePageNode(tp));
    upd();
    const field = (label, key, opts = {}) => h('label', { class: 'field' },
      h('span', { class: 'lbl' }, label),
      h(opts.multi ? 'textarea' : 'input', {
        class: 'input', value: tp[key] || '', rows: opts.rows || 3, placeholder: opts.ph || '',
        oninput: (e) => { tp[key] = e.target.value; markDirty(); upd(); },
      }));
    root.append(h('div', { class: 'title-view' },
      h('div', { class: 'form-card' },
        h('h2', {}, 'Title page'),
        h('p', { class: 'muted' }, 'Printed as the first page when you print or export.'),
        field('Title', 'title', { multi: true, rows: 2, ph: 'THE TITLE' }),
        SD.SCRIPT_TYPES[d.scriptType].tv ? field('Episode', 'episode', { multi: true, rows: 2, ph: 'Episode 101\n“Pilot”' }) : null,
        field('Credit', 'credit', { ph: 'Written by' }),
        field('Author(s)', 'author', { multi: true, rows: 2 }),
        field('Based on / source', 'source', { multi: true, rows: 2, ph: 'Based on the novel by…' }),
        field('Draft / date', 'draftDate', { ph: 'First Draft — ' + new Date().toLocaleDateString() }),
        field('Contact', 'contact', { multi: true, rows: 4, ph: 'Name\nemail@example.com\nPhone' }),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: tp.enabled !== false, onchange: (e) => { tp.enabled = e.target.checked; markDirty(); } }), ' Include title page when printing / exporting')),
      h('div', { class: 'preview-wrap' }, preview)));
  }

  // ---------- Index cards ----------
  function moveScene(d, from, to) {
    const scenes = SD.getScenes(d);
    if (from === to || !scenes[from]) return;
    const pre = d.elements.slice(0, scenes[0].start);
    const chunks = scenes.map((s) => d.elements.slice(s.start, s.end));
    const [c] = chunks.splice(from, 1);
    chunks.splice(to, 0, c);
    d.elements = pre.concat(...chunks);
  }

  function renderCards(root, d) {
    const scenes = SD.getScenes(d);
    const comic = d.scriptType === 'comic';
    const st = SD.SCRIPT_TYPES[d.scriptType].sceneType;
    const changed = () => { state.editorStale = true; markDirty(); renderNavigatorSoon(); };
    let dragFrom = null;
    const addScene = () => {
      d.elements.push({ id: SD.uid(), type: st, text: comic ? '' : 'INT. ' }, { id: SD.uid(), type: comic ? 'panel' : 'action', text: '' });
      changed();
      renderView();
    };
    const grid = h('div', { class: 'cards' }, scenes.map((s, i) => {
      const chars = SD.sceneCharacters(d, s);
      const card = h('div', {
        class: 'card', draggable: true, style: s.el.color ? `--scene-color:${s.el.color}` : '',
        ondragstart: (e) => { dragFrom = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); card.classList.add('dragging'); },
        ondragend: () => card.classList.remove('dragging'),
        ondragover: (e) => { if (dragFrom == null) return; e.preventDefault(); card.classList.add('drop-target'); },
        ondragleave: () => card.classList.remove('drop-target'),
        ondrop: (e) => { e.preventDefault(); card.classList.remove('drop-target'); if (dragFrom == null) return; moveScene(d, dragFrom, i); dragFrom = null; changed(); renderView(); },
      },
      h('div', { class: 'card-top' },
        h('span', { class: 'card-num' }, (comic ? 'Page ' : '') + s.number),
        h('span', { class: 'card-len' }, SD.eighths(s.lines) + ' pg'),
        s.el.temp != null ? h('span', { class: 'card-temp', style: `--t:${s.el.temp}`, title: 'Scene temperature (0 calm – 10 intense)' }, '🌡 ' + s.el.temp) : null,
        h('button', { class: 'icon-btn', title: 'Open in script', 'aria-label': 'Open in script', onclick: () => goToScene(s.id) }, '↗')),
      h('input', {
        class: 'card-heading', value: s.el.text, placeholder: comic ? 'Page notes' : 'SCENE HEADING', draggable: false,
        oninput: (e) => { s.el.text = e.target.value; changed(); },
      }),
      h('textarea', {
        class: 'card-syn', placeholder: 'Synopsis…', value: s.el.synopsis || '', rows: 4, draggable: false,
        oninput: (e) => { s.el.synopsis = e.target.value; changed(); },
      }),
      chars.length ? h('div', { class: 'card-chars' }, chars.join(' · ')) : null);
      // allow text selection inside fields without starting a drag
      card.querySelectorAll('input,textarea').forEach((f) => {
        f.addEventListener('mousedown', () => { card.draggable = false; });
        f.addEventListener('blur', () => { card.draggable = true; });
      });
      return card;
    }), h('button', { class: 'card add-card', onclick: addScene }, '+ Add ' + (comic ? 'page' : 'scene')));
    root.append(h('div', { class: 'view-pad' },
      h('div', { class: 'view-head' },
        h('h2', {}, comic ? 'Page cards' : 'Index cards'),
        h('p', { class: 'muted' }, `${scenes.length} ${comic ? 'pages' : 'scenes'} · drag cards to reorder ${comic ? 'pages' : 'scenes'} in the script.`)),
      grid));
  }
  const renderNavigatorSoon = debounce(() => renderNavigator(), 300);

  // ---------- Reports ----------
  function characterStats(d) {
    const stats = new Map();
    const scenes = SD.getScenes(d);
    const sceneOf = (i) => { let n = 0; for (const s of scenes) if (s.start <= i) n = s.number; return n; };
    let cur = null;
    d.elements.forEach((e, i) => {
      if (e.type === 'character') {
        const n = SD.charName(e.text);
        if (!n) { cur = null; return; }
        if (!stats.has(n)) stats.set(n, { name: n, speeches: 0, words: 0, scenes: new Set(), first: sceneOf(i) });
        cur = stats.get(n);
        cur.speeches++;
        cur.scenes.add(sceneOf(i));
      } else if (e.type === 'dialogue' && cur) {
        cur.words += (e.text.match(/\S+/g) || []).length;
      } else if (e.type !== 'parenthetical') cur = null;
    });
    return [...stats.values()].sort((a, b) => b.words - a.words);
  }

  function reportTable(headers, rows) {
    return h('table', { class: 'report' },
      h('thead', {}, h('tr', {}, headers.map((x) => h('th', {}, x)))),
      h('tbody', {}, rows.length ? rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c)))) : h('tr', {}, h('td', { colSpan: headers.length, class: 'muted' }, 'Nothing to show yet.'))));
  }

  function buildReport(d, tab) {
    const scenes = SD.getScenes(d);
    if (tab === 'health') return healthReport(d);
    if (tab === 'scenes') {
      return reportTable(['#', 'Scene', 'Page', 'Length', 'Characters', 'Synopsis'], scenes.map((s) => [
        s.number, s.el.text.toUpperCase() || '—', s.page, SD.eighths(s.lines), SD.sceneCharacters(d, s).join(', '), s.el.synopsis || '',
      ]));
    }
    if (tab === 'characters') {
      return reportTable(['Character', 'Speeches', 'Words spoken', 'Scenes', 'First appears'], characterStats(d).map((c) => [
        c.name, c.speeches, c.words, c.scenes.size, c.first ? 'Scene ' + c.first : 'Before first scene',
      ]));
    }
    if (tab === 'locations') {
      const locs = new Map();
      for (const s of scenes) {
        const p = SD.parseSceneHeading(s.el.text);
        const key = p.location || '—';
        if (!locs.has(key)) locs.set(key, { name: key, settings: new Set(), times: new Set(), scenes: [], lines: 0 });
        const l = locs.get(key);
        if (p.setting) l.settings.add(p.setting);
        if (p.time) l.times.add(p.time);
        l.scenes.push(s.number);
        l.lines += s.lines;
      }
      return reportTable(['Location', 'Int / Ext', 'Times', 'Scenes', 'Total length'], [...locs.values()].sort((a, b) => b.scenes.length - a.scenes.length).map((l) => [
        l.name, [...l.settings].join(', '), [...l.times].join(', '), l.scenes.join(', '), SD.eighths(l.lines) + ' pg',
      ]));
    }
    // breakdown
    const wrap = h('div', { class: 'bd-report' });
    for (const s of scenes) {
      const items = (s.el.items || []).map((id) => state.project.catalog.find((c) => c.id === id)).filter(Boolean);
      const chars = SD.sceneCharacters(d, s);
      const groups = new Map();
      if (chars.length) groups.set('character', chars);
      for (const it of items) { if (!groups.has(it.category)) groups.set(it.category, []); if (!groups.get(it.category).includes(it.name)) groups.get(it.category).push(it.name); }
      wrap.append(h('section', { class: 'bd-sheet' },
        h('div', { class: 'bd-sheet-head' },
          h('strong', {}, `Scene ${s.number}`), ' ', s.el.text.toUpperCase() || '—',
          h('span', { class: 'muted' }, ` · ${SD.eighths(s.lines)} pg · page ${s.page}`)),
        s.el.synopsis ? h('p', { class: 'bd-syn' }, s.el.synopsis) : null,
        groups.size
          ? h('div', { class: 'bd-grid' }, [...groups.entries()].map(([cat, names]) => h('div', { class: 'bd-cell', style: `--chip:${SD.categoryById(cat).color}` },
            h('div', { class: 'bd-cat' }, SD.categoryById(cat).label), h('div', {}, names.join(', ')))))
          : h('p', { class: 'muted small' }, 'No breakdown items tagged.')));
    }
    if (!scenes.length) wrap.append(h('p', { class: 'muted' }, 'No scenes yet.'));
    return wrap;
  }

  function renderReports(root, d) {
    const tabs = [['health', 'Health'], ['scenes', 'Scenes'], ['characters', 'Characters'], ['locations', 'Locations'], ['breakdown', 'Breakdown sheets']];
    const words = SD.wordCount(d);
    const est = SD.estimate(d);
    const scenes = SD.getScenes(d);
    root.append(h('div', { class: 'view-pad' },
      h('div', { class: 'view-head' },
        h('h2', {}, 'Reports'),
        h('div', { class: 'stats' },
          stat('Pages (est.)', est.pages), stat('Scenes', scenes.length), stat('Words', words.toLocaleString()), stat('Speaking characters', characterStats(d).length))),
      h('div', { class: 'subtabs' },
        tabs.map(([k, l]) => h('button', { class: 'tab' + (state.reportTab === k ? ' active' : ''), onclick: () => { state.reportTab = k; renderView(); } }, l)),
        state.reportTab === 'characters' ? h('button', { class: 'btn small push-right', onclick: () => voiceCheck() }, '🗣 Voice check') : null,
        h('button', { class: 'btn small push-right', onclick: () => printReport(d) }, 'Print / PDF')),
      buildReport(d, state.reportTab)));
  }
  const stat = (label, value) => h('div', { class: 'stat' }, h('div', { class: 'stat-v' }, value), h('div', { class: 'stat-l' }, label));

  // ---------- Storyline (character flow chart) ----------
  const storySel = (d) => (state.storySel && state.storySel.doc === d.id ? state.storySel : { doc: d.id });
  const setStorySel = (d, type, id) => { state.storySel = { doc: d.id, type, id }; };

  function storyBeatOf(d, sel) {
    if (sel.type === 'beat') return d.beats.find((b) => b.id === sel.id);
    if (sel.type === 'group') return d.beats.find((b) => b.groups.some((g) => g.id === sel.id));
    if (sel.type === 'event') return d.beats.find((b) => b.events.some((e) => e.id === sel.id));
    return null;
  }

  function storyAddCharacterMenu(anchor, d, done) {
    const p = state.project;
    const used = new Set(d.rows.map((r) => r.charId).filter(Boolean));
    const usedNames = new Set(d.rows.map((r) => SD.storyRowName(p, r).toUpperCase()));
    const chars = p.catalog.filter((c) => c.category === 'character' && !used.has(c.id) && !usedNames.has(c.name.toUpperCase()))
      .sort((a, b) => a.name.localeCompare(b.name));
    const add = (row) => { d.rows.push(row); markDirty(); done(row); };
    const items = chars.map((c) => ({ label: c.name || 'Unnamed', run: () => add({ id: SD.uid(), name: c.name, charId: c.id, color: SD.nextStoryColor(d) }) }));
    if (items.length) items.push('-');
    items.push({
      label: 'New character…', run: async () => {
        const name = await promptText('New character in this storyline', '');
        if (!name || !name.trim()) return;
        const c = SD.findCatalogItem(p, 'character', name);
        add({ id: SD.uid(), name: name.trim().toUpperCase(), charId: c ? c.id : null, color: SD.nextStoryColor(d) });
      },
    });
    popupMenu(anchor, items);
  }

  function storyBuildMenu(anchor, d, done) {
    const scripts = state.project.documents.filter((x) => x.kind === 'script');
    if (!scripts.length) { toast('There is no script in this project yet.'); return; }
    popupMenu(anchor, scripts.map((s) => ({
      label: (s.id === d.sourceId ? '✓ ' : '') + s.name + ' — ' + SD.getScenes(s).length + ' scenes',
      run: () => { const r = SD.syncStorylineFromScript(state.project, d, s); markDirty(); toast(`Synced with “${s.name}”: ${r.scenes} scenes${r.added ? `, ${r.added} new` : ''}.`); done(); },
    })));
  }

  // Put a character into one group of a moment (or take them out with gi = -1).
  function storySetMembership(beat, rowId, gi) {
    beat.groups.forEach((g, i) => {
      const had = g.members.includes(rowId);
      if (i === gi && !had) { g.members.push(rowId); if (g.fromScript) g.manual = [...new Set([...(g.manual || []), rowId])]; }
      if (i !== gi && had) { g.members = g.members.filter((x) => x !== rowId); if (g.manual) g.manual = g.manual.filter((x) => x !== rowId); }
    });
  }

  function renderStoryline(root, d) {
    const p = state.project;
    const canvas = h('div', { class: 'story-canvas' });
    const panel = h('aside', { class: 'story-panel' });
    root.append(h('div', { class: 'story' }, canvas, panel));
    const tab = state.storyTab || 'flow';

    const changed = () => { markDirty(); drawCanvas(); renderNavigatorSoon(); renderStatusSoon(); };
    const select = (type, id) => { setStorySel(d, type, id); drawCanvas(); drawPanel(); };
    const full = () => { drawCanvas(); drawPanel(); renderNavigatorSoon(); renderStatusSoon(); };
    state.storyRefresh = full;

    const drawCanvas = () => {
      const sel = storySel(d);
      if (!d.beats.length || !d.rows.length) {
        const scripts = p.documents.filter((x) => x.kind === 'script' && SD.getScenes(x).length);
        canvas.replaceChildren(h('div', { class: 'empty-state story-empty' },
          h('div', { class: 'empty-icon' }, '〰️'),
          h('h3', {}, 'Draw how your characters move through the story'),
          h('p', { class: 'muted' }, 'Each character is a line. Lines run together when characters share a moment and split when they go separate ways. Mark meetings, conflicts and turning points on the lines.'),
          h('div', { class: 'row-gap center' },
            scripts.length ? h('button', { class: 'btn primary', onclick: (e) => storyBuildMenu(e.currentTarget, d, full) }, 'Build from a script…') : null,
            h('button', { class: 'btn', onclick: (e) => storyAddCharacterMenu(e.currentTarget, d, (row) => { setStorySel(d, 'row', row.id); full(); }) }, '+ Add character'),
            h('button', { class: 'btn', onclick: () => { storyAddBeat(d); full(); } }, '+ Add moment')),
          h('p', { class: 'muted small' }, `${d.rows.length} characters · ${d.beats.length} moments`)));
        return;
      }
      if (tab === 'grid') { canvas.replaceChildren(storyGrid(d, sel, select, changed, full)); return; }
      const { svg } = SD.renderStorylineSVG(p, d, { selection: sel });
      const sx = canvas.scrollLeft, sy = canvas.scrollTop;
      canvas.innerHTML = svg;
      canvas.scrollLeft = sx; canvas.scrollTop = sy;
    };

    canvas.addEventListener('click', (e) => {
      if (tab !== 'flow') return;
      const t = e.target.closest('[data-event],[data-group],[data-row],[data-beat]');
      if (!t) { select(null, null); return; }
      if (t.dataset.event) select('event', t.dataset.event);
      else if (t.dataset.group) select('group', t.dataset.group);
      else if (t.dataset.row) select('row', t.dataset.row);
      else select('beat', t.dataset.beat);
    });

    const drawPanel = () => panel.replaceChildren(...storyPanel(d, storySel(d), { select, changed, full }));
    full();
  }

  function storyAddBeat(d, afterIdx) {
    const b = { id: SD.uid(), label: '', groups: [{ id: SD.uid(), label: '', members: [] }], events: [] };
    const i = afterIdx == null ? d.beats.length : afterIdx + 1;
    d.beats.splice(i, 0, b);
    markDirty();
    setStorySel(d, 'beat', b.id);
    return b;
  }

  function storyGrid(d, sel, select, changed, full) {
    const p = state.project;
    const head = h('tr', {}, h('th', { class: 'sg-corner' }, 'Character / moment'),
      d.beats.map((b, i) => h('th', { class: 'sg-beat' + (storyBeatOf(d, sel) === b ? ' on' : '') + (b.orphan ? ' orphan' : '') },
        h('button', { onclick: () => select('beat', b.id), title: b.label },
          h('span', { class: 'sg-num' }, b.sceneId ? 'Sc ' + (b.number || i + 1) : '◆ ' + (i + 1)),
          h('span', { class: 'sg-lbl' }, b.label || (b.groups[0] && b.groups[0].label) || 'Moment')))),
      h('th', { class: 'sg-add' }, h('button', { class: 'icon-btn', title: 'Add moment', 'aria-label': 'Add moment', onclick: () => { storyAddBeat(d); full(); } }, '+')));
    const rows = d.rows.map((r) => h('tr', { class: sel.type === 'row' && sel.id === r.id ? 'on' : '' },
      h('th', { class: 'sg-name' }, h('button', { onclick: () => select('row', r.id) }, h('span', { class: 'sg-dot', style: `background:${r.color}` }), SD.storyRowName(p, r))),
      d.beats.map((b) => {
        const gi = b.groups.findIndex((g) => g.members.includes(r.id));
        const evs = b.events.filter((e) => e.rows.includes(r.id));
        const g = b.groups[gi];
        return h('td', {},
          h('button', {
            class: 'sg-cell' + (gi >= 0 ? ' in' : ''),
            style: gi >= 0 ? `--c:${r.color}` : '',
            title: gi >= 0 ? (b.groups.length > 1 ? `In “${g.label || 'group ' + (gi + 1)}” — click to move` : 'Present — click to remove') : 'Not here — click to add',
            onclick: () => {
              if (!b.groups.length) b.groups.push({ id: SD.uid(), label: '', members: [] });
              const next = gi + 1 >= b.groups.length ? -1 : gi + 1;
              storySetMembership(b, r.id, next);
              changed();
              full();
            },
          }, gi >= 0 && b.groups.length > 1 ? String.fromCharCode(65 + gi) : '', evs.map((e) => h('span', { class: 'sg-ev', title: e.label }, (SD.STORY_EVENT_KINDS.find((k) => k.id === e.kind) || {}).icon || '●'))));
      })));
    return h('div', { class: 'story-grid-wrap' },
      h('table', { class: 'story-grid' }, h('thead', {}, head), h('tbody', {}, rows)),
      h('p', { class: 'muted small sg-help' }, 'Click a cell to put a character in a moment. When a moment has several groups (A, B…), clicking moves the character to the next group, then out.'));
  }

  function storyChips(d, selected, onToggle) {
    const p = state.project;
    return h('div', { class: 'chips toggle-chips' }, d.rows.map((r) => {
      const on = selected.includes(r.id);
      return h('button', { class: 'chip toggle' + (on ? ' on' : ''), style: `--chip:${r.color}`, 'aria-pressed': String(on), onclick: () => onToggle(r.id, !on) }, SD.storyRowName(p, r));
    }));
  }

  function storyPanel(d, sel, ui) {
    const p = state.project;
    const sec = (...kids) => h('div', { class: 'ins-section' }, ...kids);
    const s = d.settings;

    if (sel.type === 'row') {
      const r = d.rows.find((x) => x.id === sel.id);
      if (!r) { ui.select(null, null); return []; }
      const c = r.charId && p.catalog.find((x) => x.id === r.charId);
      const idx = d.rows.indexOf(r);
      const count = d.beats.filter((b) => b.groups.some((g) => g.members.includes(r.id))).length;
      const evCount = d.beats.reduce((n, b) => n + b.events.filter((e) => e.rows.includes(r.id)).length, 0);
      return [
        sec(h('div', { class: 'ins-kicker' }, 'Character line'),
          c ? h('div', { class: 'ins-title' }, c.name)
            : h('input', { class: 'input', value: r.name, placeholder: 'Name', oninput: (e) => { r.name = e.target.value; ui.changed(); } }),
          h('p', { class: 'muted small' }, `In ${count} of ${d.beats.length} moments · ${evCount} events`),
          h('div', { class: 'row-gap' },
            c ? h('button', { class: 'btn small', onclick: () => openCatalogItem(c.id) }, 'Open profile')
              : h('button', { class: 'btn small', onclick: () => { const it = SD.findCatalogItem(p, 'character', r.name) || SD.newCatalogItem('character', r.name.toUpperCase()); if (!p.catalog.includes(it)) p.catalog.push(it); r.charId = it.id; ui.changed(); ui.full(); renderDocList(); } }, 'Create catalog profile'))),
        sec(h('label', { class: 'lbl' }, 'Colour'),
          h('div', { class: 'swatches' }, SD.STORY_PALETTE.map((col) => h('button', { class: 'swatch' + (r.color === col ? ' on' : ''), style: `background:${col}`, 'aria-label': 'Colour ' + col, onclick: () => { r.color = col; ui.changed(); ui.full(); } })))),
        sec(h('label', { class: 'lbl' }, 'Order'),
          h('p', { class: 'muted small' }, 'Lines are sorted to avoid crossings; this order is the starting point.'),
          h('div', { class: 'row-gap' },
            h('button', { class: 'btn small', disabled: idx === 0, onclick: () => { d.rows.splice(idx, 1); d.rows.splice(idx - 1, 0, r); ui.changed(); ui.full(); } }, '↑ Up'),
            h('button', { class: 'btn small', disabled: idx === d.rows.length - 1, onclick: () => { d.rows.splice(idx, 1); d.rows.splice(idx + 1, 0, r); ui.changed(); ui.full(); } }, '↓ Down'),
            h('button', {
              class: 'btn small danger', onclick: () => {
                d.rows.splice(idx, 1);
                for (const b of d.beats) { b.groups.forEach((g) => { g.members = g.members.filter((x) => x !== r.id); }); b.events.forEach((e) => { e.rows = e.rows.filter((x) => x !== r.id); }); }
                ui.select(null, null); ui.changed();
              },
            }, 'Remove from storyline'))),
      ];
    }

    const beat = storyBeatOf(d, sel);
    if (beat) {
      const bi = d.beats.indexOf(beat);
      const script = beat.sceneId && p.documents.find((x) => x.id === d.sourceId);
      const groups = beat.groups.map((g, gi) => h('div', { class: 'sp-card' + (sel.type === 'group' && sel.id === g.id ? ' on' : ''), style: `--chip:${g.color || '#8b8d98'}` },
        h('div', { class: 'sp-card-head' },
          h('span', { class: 'sp-badge' }, beat.groups.length > 1 ? String.fromCharCode(65 + gi) : '●'),
          h('input', { class: 'lbl-input', value: g.label, placeholder: beat.groups.length > 1 ? 'Where / which group?' : 'Where are they? (optional)', oninput: (e) => { g.label = e.target.value; ui.changed(); } }),
          h('button', { class: 'icon-btn', title: 'Delete group', 'aria-label': 'Delete group', onclick: () => { beat.groups.splice(gi, 1); ui.changed(); ui.full(); } }, '×')),
        storyChips(d, g.members, (id, on) => { storySetMembership(beat, id, on ? gi : -1); ui.changed(); ui.full(); }),
        g.fromScript ? h('div', { class: 'help-text' }, 'From the script — characters with dialogue in the scene.') : null));
      const events = beat.events.map((e, ei) => h('div', { class: 'sp-card ev' + (sel.type === 'event' && sel.id === e.id ? ' on' : '') },
        h('div', { class: 'sp-card-head' },
          h('select', { class: 'select small', onchange: (ev) => { e.kind = ev.target.value; ui.changed(); } }, SD.STORY_EVENT_KINDS.map((k) => h('option', { value: k.id, selected: k.id === e.kind }, k.icon + ' ' + k.label))),
          h('button', { class: 'icon-btn', title: 'Delete event', 'aria-label': 'Delete event', onclick: () => { beat.events.splice(ei, 1); ui.changed(); ui.full(); } }, '×')),
        h('input', { class: 'input', value: e.label, placeholder: 'What happens? e.g. “Tom tells Mary the truth”', oninput: (ev) => { e.label = ev.target.value; ui.changed(); } }),
        h('div', { class: 'help-text' }, 'Who is affected?'),
        storyChips(d, e.rows, (id, on) => { e.rows = on ? [...e.rows, id] : e.rows.filter((x) => x !== id); ui.changed(); ui.full(); })));
      return [
        sec(h('div', { class: 'ins-kicker' }, beat.sceneId ? `Scene ${beat.number || bi + 1} · from “${script ? script.name : 'script'}”` : `Moment ${bi + 1}`),
          beat.orphan ? h('p', { class: 'warn small' }, 'This scene is no longer in the script.') : null,
          h('textarea', { class: 'input', rows: 2, value: beat.label, placeholder: 'Name this moment', oninput: (e) => { beat.label = e.target.value; if (beat.sceneId) beat.customLabel = true; ui.changed(); } }),
          h('div', { class: 'row-gap' },
            beat.sceneId && script && !beat.orphan ? h('button', { class: 'btn small', onclick: () => { state.docId = script.id; state.view = 'script'; renderDocList(); renderView(); requestAnimationFrame(() => editor.goTo(beat.sceneId)); } }, 'Go to scene') : null,
            h('button', { class: 'btn small', disabled: bi === 0, title: 'Move earlier', onclick: () => { d.beats.splice(bi, 1); d.beats.splice(bi - 1, 0, beat); ui.changed(); ui.full(); } }, '←'),
            h('button', { class: 'btn small', disabled: bi === d.beats.length - 1, title: 'Move later', onclick: () => { d.beats.splice(bi, 1); d.beats.splice(bi + 1, 0, beat); ui.changed(); ui.full(); } }, '→'),
            h('button', { class: 'btn small', title: 'Insert a new moment after this one', onclick: () => { storyAddBeat(d, bi); ui.full(); } }, '+ After'),
            h('button', { class: 'btn small danger', onclick: () => { d.beats.splice(bi, 1); ui.select(null, null); ui.changed(); } }, 'Delete'))),
        sec(h('label', { class: 'lbl' }, 'Who is together?'),
          h('p', { class: 'muted small' }, 'Characters in the same group are drawn as one bundle. Add a second group when characters are in different places at the same time.'),
          groups,
          h('button', { class: 'btn ghost small', onclick: () => { beat.groups.push({ id: SD.uid(), label: '', members: [] }); ui.changed(); ui.full(); } }, '+ Add a group')),
        sec(h('label', { class: 'lbl' }, 'Events'),
          h('p', { class: 'muted small' }, 'Meetings, fights, discoveries… marked on the lines of the characters they affect.'),
          events,
          h('button', { class: 'btn ghost small', onclick: () => { const ev = { id: SD.uid(), kind: 'meet', label: '', rows: [...new Set(beat.groups.flatMap((g) => g.members))] }; beat.events.push(ev); setStorySel(d, 'event', ev.id); ui.changed(); ui.full(); } }, '+ Add an event')),
      ];
    }

    // nothing selected: overview
    return [
      sec(h('div', { class: 'ins-kicker' }, 'Storyline'),
        h('p', { class: 'muted small' }, 'Click a line, a moment header, a group or an event to edit it. Use the Grid tab to quickly tick who is in each moment.')),
      sec(h('label', { class: 'lbl' }, `Characters (${d.rows.length})`),
        h('div', { class: 'story-rowlist' }, d.rows.map((r) => h('button', { class: 'story-rowbtn', onclick: () => ui.select('row', r.id) }, h('span', { class: 'sg-dot', style: `background:${r.color}` }), SD.storyRowName(p, r)))),
        h('button', { class: 'btn ghost small', onclick: (e) => storyAddCharacterMenu(e.currentTarget, d, (row) => { ui.select('row', row.id); ui.changed(); }) }, '+ Add character')),
      sec(h('label', { class: 'lbl' }, 'Script'),
        h('p', { class: 'muted small' }, d.sourceId ? `Linked to “${(p.documents.find((x) => x.id === d.sourceId) || {}).name || 'a deleted script'}”. Update to pull in new scenes and who is in them; your own moments, groups and events are kept.` : 'Build moments from the scenes of a script, or draw everything by hand.'),
        h('button', { class: 'btn small', onclick: (e) => storyBuildMenu(e.currentTarget, d, ui.full) }, d.sourceId ? 'Update from script…' : 'Build from a script…')),
      sec(h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.showAbsent, onchange: (e) => { s.showAbsent = e.target.checked; ui.changed(); } }), ' Show characters when they are off-screen (thin dashed line)'),
        h('label', { class: 'lbl' }, 'Moment width'),
        h('input', { type: 'range', min: 90, max: 280, step: 10, value: s.colWidth, oninput: (e) => { s.colWidth = +e.target.value; ui.changed(); } })),
    ];
  }

  function storylineSVGForExport(d) {
    const { svg } = SD.renderStorylineSVG(state.project, d, { forExport: true });
    return svg.replace(/^<svg([^>]*)>/, `<svg$1><style>${SD.STORY_SVG_STYLE}</style>`);
  }

  function printStoryline(d) {
    const root = $('#print-root');
    root.className = 'print-story';
    const wrapEl = h('div', { class: 'print-story-svg' });
    wrapEl.innerHTML = storylineSVGForExport(d);
    const svgEl = wrapEl.querySelector('svg');
    svgEl.removeAttribute('width'); svgEl.removeAttribute('height');
    root.replaceChildren(h('h1', {}, (state.project.title || '') + ' — ' + d.name), wrapEl);
    const pageStyle = $('#page-size-style');
    const before = pageStyle.textContent;
    pageStyle.textContent = `@page { size: ${state.project.settings.pageSize === 'a4' ? 'A4' : 'letter'} landscape; margin: 0.5in; }`;
    window.addEventListener('afterprint', () => { pageStyle.textContent = before; }, { once: true });
    window.print();
  }

  // ---------- Storyboard ----------
  const sbSel = (d) => (state.sbSel && state.sbSel.doc === d.id ? state.sbSel : { doc: d.id });
  const sbSource = (d) => state.project.documents.find((x) => x.id === d.sourceId && x.kind === 'script') || null;
  const sbMeta = (shot) => [shot.shotType, shot.move, shot.lens, shot.duration ? shot.duration + 's' : ''].filter(Boolean).join(' · ');
  function sbFind(d, shotId) {
    for (const seq of d.sequences) {
      const index = seq.shots.findIndex((x) => x.id === shotId);
      if (index >= 0) return { seq, shot: seq.shots[index], index };
    }
    return null;
  }
  const sbShotNo = (d, seq, index) => SD.storyboardNumbers(state.project, d).get(seq.id) + SD.shotLetters(index);
  const sbFrameKids = (shot, empty) => [
    shot.image ? h('img', { src: shot.image, alt: '' }) : null,
    shot.drawing ? h('img', { class: 'sb-drawing', src: shot.drawing, alt: '' }) : null,
    !shot.image && !shot.drawing && empty ? h('span', { class: 'sb-frame-empty' }, empty) : null,
  ];
  const isImageFile = (f) => f && /^image\//.test(f.type);

  function storyboardToolbar(d) {
    const refresh = () => state.sbRefresh && state.sbRefresh();
    return [
      h('button', { class: 'btn small', onclick: () => { sbAddSequence(d); refresh(); } }, '+ Sequence'),
      h('button', { class: 'btn small', onclick: () => { sbAddShot(d); refresh(); } }, '+ Shot'),
      h('button', { class: 'btn small', title: 'Make a sequence for every scene of a script', onclick: (e) => sbBuildMenu(e.currentTarget, d, refresh) }, d.sourceId ? '⟳ Update from script' : 'Build from script…'),
      h('div', { class: 'tb-group' },
        h('button', { class: 'btn ghost small', title: 'Play the shots one after another, like an animatic', onclick: () => sbPlay(d) }, '▶ Play'),
        h('button', { class: 'btn ghost small', title: 'Download the shot list as a spreadsheet (CSV)', onclick: () => download(safeName(d.name) + ' - shot list.csv', sbShotListCSV(d), 'text/csv;charset=utf-8') }, 'CSV'),
        h('button', { class: 'btn ghost small', title: 'Print or save as PDF (Ctrl+P)', onclick: () => printStoryboard(d) }, 'Print')),
    ];
  }

  function sbBuildMenu(anchor, d, done) {
    const scripts = state.project.documents.filter((x) => x.kind === 'script');
    if (!scripts.length) { toast('There is no script in this project yet.'); return; }
    popupMenu(anchor, scripts.map((s) => ({
      label: (s.id === d.sourceId ? '✓ ' : '') + s.name + ' — ' + SD.getScenes(s).length + ' scenes',
      run: () => { const r = SD.syncStoryboardFromScript(state.project, d, s); markDirty(); toast(`Synced with “${s.name}”: ${r.scenes} scenes${r.added ? `, ${r.added} new` : ''}.`); done(); },
    })));
  }

  function sbAddSequence(d) {
    const sel = sbSel(d);
    const cur = d.sequences.findIndex((s) => s.id === sel.seq);
    const seq = { id: SD.uid(), title: '', shots: [] };
    d.sequences.splice(cur >= 0 ? cur + 1 : d.sequences.length, 0, seq);
    state.sbSel = { doc: d.id, seq: seq.id };
    markDirty();
    return seq;
  }

  // New shot after the selected one, or at the end of the selected / given sequence.
  function sbAddShot(d, seq, props) {
    const sel = sbSel(d);
    let at;
    if (!seq) {
      const f = sel.shot && sbFind(d, sel.shot);
      if (f) { seq = f.seq; at = f.index + 1; }
      else seq = d.sequences.find((s) => s.id === sel.seq) || d.sequences[d.sequences.length - 1];
    }
    if (!seq) seq = sbAddSequence(d);
    const shot = SD.newShot(props);
    seq.shots.splice(at == null ? seq.shots.length : at, 0, shot);
    state.sbSel = { doc: d.id, seq: seq.id, shot: shot.id, focus: true };
    markDirty();
    return shot;
  }

  function sbDraft(d, seq, done) {
    const script = sbSource(d);
    const shots = script && seq.sceneId ? SD.draftShotsForScene(script, seq.sceneId) : [];
    if (!shots.length) { toast('This scene has no action or dialogue to turn into shots yet.'); return; }
    seq.shots.push(...shots);
    markDirty();
    toast(`Drafted ${shots.length} shots from the scene. Change or delete them as you like.`);
    done();
  }

  async function sbImageFrom(fileOrBlob) {
    try { return await SD.imageToDataUrl(fileOrBlob, 1280); } catch (e) { toast('That picture could not be read.'); return null; }
  }

  function sbPickImage(shot, ui, field = 'image') {
    const inp = h('input', { type: 'file', accept: 'image/*' });
    inp.addEventListener('change', async () => {
      const f = inp.files[0];
      if (!f) return;
      const url = await sbImageFrom(f);
      if (url) { shot[field] = url; ui.changed(); ui.sync(shot, field); }
    });
    inp.click();
  }

  function renderStoryboard(root, d) {
    const canvas = h('div', { class: 'sb-canvas' });
    const panel = h('aside', { class: 'story-panel sb-panel' });
    const shell = h('div', { class: 'story sb' }, canvas, panel);
    root.append(shell);
    const tab = state.sbTab || 'board';

    const draw = () => {
      const top = canvas.scrollTop;
      canvas.replaceChildren(tab === 'list' ? sbList(d, ui) : sbBoard(d, ui));
      canvas.scrollTop = top;
    };
    const drawPanel = () => panel.replaceChildren(...sbPanel(d, ui));
    const ui = {
      // Selecting only moves the highlight, so a caption you are typing in keeps its focus.
      select(sel) {
        state.sbSel = Object.assign({ doc: d.id }, sel);
        for (const el of canvas.querySelectorAll('.on[data-card], .on[data-seqhead], tr.on')) el.classList.remove('on');
        if (sel.shot) canvas.querySelectorAll(`[data-card="${sel.shot}"]`).forEach((el) => el.classList.add('on'));
        else if (sel.seq) canvas.querySelectorAll(`[data-seqhead="${sel.seq}"]`).forEach((el) => el.classList.add('on'));
        drawPanel();
        renderNavigator();
      },
      changed() { markDirty(); renderStatusSoon(); renderNavigatorSoon(); },
      full() { draw(); drawPanel(); renderNavigator(); renderStatus(); applyFocus(); },
      // Copy a changed value into every other control that shows it.
      sync(shot, field) {
        for (const el of shell.querySelectorAll(`[data-shot="${shot.id}"][data-field="${field}"]`)) if (el !== document.activeElement) el.value = shot[field] == null ? '' : shot[field];
        for (const el of shell.querySelectorAll(`[data-shot="${shot.id}"][data-meta]`)) el.textContent = sbMeta(shot);
        if (field === 'duration') for (const el of shell.querySelectorAll('[data-total]')) el.textContent = SD.formatSeconds(SD.storyboardStats(d).seconds);
        if (field === 'image' || field === 'drawing' || field === 'diagram') {
          for (const el of shell.querySelectorAll(`[data-shot="${shot.id}"][data-frame]`)) el.replaceChildren(...sbFrameKids(shot, el.dataset.frame));
          drawPanel();
        }
      },
    };
    // after adding a shot, put the cursor in its caption
    const applyFocus = () => {
      const s = state.sbSel;
      if (!s || s.doc !== d.id || !s.focus) return;
      delete s.focus;
      const el = canvas.querySelector(`[data-card="${s.shot}"]`);
      if (el) { el.scrollIntoView({ block: 'nearest' }); const cap = el.querySelector('textarea'); if (cap) cap.focus({ preventScroll: true }); }
    };
    state.sbRefresh = (seqId) => {
      ui.full();
      if (seqId) { const el = canvas.querySelector(`[data-seqhead="${seqId}"]`); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
    };

    // pictures dropped from your computer, and shots dragged to a new place
    let dragShot = null;
    const clearMarks = () => canvas.querySelectorAll('.drop-before, .drop-after, .drop-img, .drop-seq').forEach((el) => el.classList.remove('drop-before', 'drop-after', 'drop-img', 'drop-seq'));
    const dropSpot = (e) => {
      const card = e.target.closest('[data-card]');
      const strip = e.target.closest('[data-seq]');
      if (card) { const r = card.getBoundingClientRect(); return { card, strip, after: e.clientX > r.left + r.width / 2 }; }
      return strip ? { strip } : null;
    };
    canvas.addEventListener('dragstart', (e) => {
      const fr = e.target.closest && e.target.closest('[data-card] .sb-frame');
      if (!fr) return;
      dragShot = fr.closest('[data-card]').dataset.card;
      e.dataTransfer.setData('text/x-scriptdesk-shot', dragShot);
      e.dataTransfer.effectAllowed = 'move';
      fr.closest('[data-card]').classList.add('dragging');
    });
    canvas.addEventListener('dragend', () => { dragShot = null; clearMarks(); canvas.querySelectorAll('.dragging').forEach((el) => el.classList.remove('dragging')); });
    canvas.addEventListener('dragover', (e) => {
      const files = !dragShot && [...e.dataTransfer.types].includes('Files');
      if (!files && !dragShot) return;
      e.stopPropagation();
      const spot = dropSpot(e);
      clearMarks();
      if (!spot) { if (files) e.dataTransfer.dropEffect = 'none'; e.preventDefault(); return; }
      e.preventDefault();
      if (files) { (spot.card || spot.strip).classList.add(spot.card ? 'drop-img' : 'drop-seq'); e.dataTransfer.dropEffect = 'copy'; }
      else if (spot.card) spot.card.classList.add(spot.after ? 'drop-after' : 'drop-before');
      else spot.strip.classList.add('drop-seq');
    });
    canvas.addEventListener('drop', async (e) => {
      const spot = dropSpot(e);
      const moving = dragShot;
      dragShot = null;
      const files = moving ? [] : [...(e.dataTransfer.files || [])].filter(isImageFile);
      clearMarks();
      if (!files.length && !moving) { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); e.stopPropagation(); toast('Only pictures can be dropped on the storyboard.'); } return; }
      e.preventDefault();
      e.stopPropagation();
      if (!spot) return;
      const seq = d.sequences.find((s) => s.id === spot.strip.dataset.seq);
      if (!seq) return;
      let index = spot.card ? seq.shots.findIndex((x) => x.id === spot.card.dataset.card) + (spot.after ? 1 : 0) : seq.shots.length;
      if (moving) {
        const f = sbFind(d, moving);
        if (!f) return;
        f.seq.shots.splice(f.index, 1);
        if (f.seq === seq && f.index < index) index--;
        seq.shots.splice(index, 0, f.shot);
        state.sbSel = { doc: d.id, seq: seq.id, shot: f.shot.id };
        ui.changed(); ui.full();
        return;
      }
      // a picture dropped on a shot fills that shot; more pictures (or dropped on a gap) become new shots
      let first = files;
      if (spot.card) {
        const shot = seq.shots.find((x) => x.id === spot.card.dataset.card);
        const url = await sbImageFrom(files[0]);
        if (url) shot.image = url;
        first = files.slice(1);
        index = seq.shots.indexOf(shot) + 1;
        state.sbSel = { doc: d.id, seq: seq.id, shot: shot.id };
      }
      for (const f of first) {
        const url = await sbImageFrom(f);
        if (!url) continue;
        const shot = SD.newShot({ image: url, caption: '' });
        seq.shots.splice(index++, 0, shot);
        state.sbSel = { doc: d.id, seq: seq.id, shot: shot.id };
      }
      ui.changed(); ui.full();
    });

    ui.full();
  }

  // Paste a picture into the selected shot (bound once, works while a storyboard is open).
  document.addEventListener('paste', async (e) => {
    const d = currentDoc();
    if (!d || d.kind !== 'storyboard' || !state.sbRefresh) return;
    const items = [...(e.clipboardData ? e.clipboardData.items : [])];
    const item = items.find((it) => it.kind === 'file' && /^image\//.test(it.type));
    if (!item) return;
    // text pasted into a field stays text
    if (e.target.closest && e.target.closest('input, textarea, [contenteditable]') && items.some((it) => it.type === 'text/plain')) return;
    const sel = sbSel(d);
    e.preventDefault();
    const url = await sbImageFrom(item.getAsFile());
    if (!url) return;
    const f = sel.shot && sbFind(d, sel.shot);
    if (f) f.shot.image = url;
    else sbAddShot(d, null, { image: url });
    markDirty();
    state.sbRefresh();
    toast('Picture pasted.');
  });

  function sbField(tag, shot, field, ui, props = {}, kids = []) {
    const el = h(tag, Object.assign({}, props, {
      dataset: { shot: shot.id, field },
      oninput: (e) => {
        shot[field] = props.type === 'number' ? Math.max(0, Math.round((+e.target.value || 0) * 10) / 10) : e.target.value;
        ui.changed();
        ui.sync(shot, field);
      },
    }), kids);
    el.value = shot[field] == null ? '' : shot[field];
    return el;
  }
  const sbTypeSelect = (shot, ui, cls) => sbField('select', shot, 'shotType', ui, { class: cls, title: 'Shot type' },
    [h('option', { value: '' }, '— Shot type —'), SD.SHOT_TYPES.map((t) => h('option', { value: t.abbr }, `${t.abbr} · ${t.label}`))]);
  const sbMoveSelect = (shot, ui, cls) => sbField('select', shot, 'move', ui, { class: cls, title: 'Camera movement' },
    [h('option', { value: '' }, '— Camera —'), SD.CAMERA_MOVES.map((m) => h('option', { value: m }, m))]);

  // The shot's camera setup: a live view of a setup in a sketch (or an old-style picture).
  function sbSetupSection(d, seq, shot, index, no, ui) {
    const sketches = state.project.documents.filter((x) => x.kind === 'sketch');
    const ref = shot.setupRef;
    const sk = ref && sketches.find((x) => x.id === ref.sketch);
    const st = sk && sk.setups.find((x) => x.id === ref.setup);
    const parts = [h('label', { class: 'lbl' }, 'Camera setup')];
    const prevRef = () => { for (let i = index - 1; i >= 0; i--) if (seq.shots[i].setupRef) return seq.shots[i].setupRef; return null; };
    const create = (sk2) => {
      const pr = prevRef();
      const copy = pr && pr.sketch === sk2.id && sk2.setups.some((x) => x.id === pr.setup) ? pr.setup : null;
      const st2 = SD.sketchSetups.create(sk2, 'Shot ' + no, copy);
      shot.setupRef = { sketch: sk2.id, setup: st2.id };
      markDirty();
      SD.sketchSetups.open(sk2.id, st2.id);
      toast(copy ? 'Copied the previous shot’s setup. Move the camera and actors for this shot.' : 'Place the camera and actors for shot ' + no + '. Walls and furniture you draw are shared by every setup.');
    };
    const newSetup = (anchor) => {
      const pr = prevRef();
      const ordered = sketches.slice().sort((a, b) => (pr && b.id === pr.sketch) - (pr && a.id === pr.sketch));
      popupMenu(anchor, [
        ...ordered.map((sk2) => ({ label: 'In 📐 ' + sk2.name, run: () => create(sk2) })),
        ordered.length ? '-' : null,
        { label: 'In a new sketch…', run: () => { const sk2 = SD.KINDS.sketch.create(state.project, (seq.title ? seq.title.slice(0, 40) : 'Set') + ' — plan'); state.project.documents.push(sk2); renderDocList(); create(sk2); } },
      ]);
    };
    const linkMenu = (anchor) => popupMenu(anchor, sketches.flatMap((sk2) => sk2.setups.map((st2) => ({ label: sk2.name + ' › ' + st2.name, run: () => { shot.setupRef = { sketch: sk2.id, setup: st2.id }; ui.changed(); ui.full(); } }))));
    if (sk && st) {
      const box = h('button', { class: 'sb-diagram live', title: 'Open this setup in the sketch', onclick: () => SD.sketchSetups.open(sk.id, st.id) });
      box.innerHTML = SD.sketchSVG(sk, { forExport: true, setup: st.id });
      parts.push(box,
        h('p', { class: 'muted small' }, `“${st.name}” in 📐 ${sk.name}. Changes you make there show up here.`),
        h('div', { class: 'row-gap' },
          h('button', { class: 'btn small', onclick: () => SD.sketchSetups.open(sk.id, st.id) }, 'Open setup'),
          sketches.some((x) => x.setups.length > 1) ? h('button', { class: 'btn ghost small', onclick: (e) => linkMenu(e.currentTarget) }, 'Use another…') : null,
          h('button', { class: 'btn ghost small', onclick: () => { delete shot.setupRef; ui.changed(); ui.full(); } }, 'Unlink')));
    } else {
      if (ref) parts.push(h('p', { class: 'warn small' }, 'The linked setup was deleted.'));
      if (shot.diagram) parts.push(h('div', { class: 'sb-diagram' }, h('img', { src: shot.diagram, alt: 'Camera setup' })));
      else parts.push(h('p', { class: 'muted small' }, 'Plan where the camera and actors stand. Draw the set once in a sketch; every shot gets its own setup on it.'));
      parts.push(h('div', { class: 'row-gap' },
        h('button', { class: 'btn small primary', onclick: (e) => newSetup(e.currentTarget) }, '+ New setup for this shot'),
        sketches.some((x) => x.setups.length) ? h('button', { class: 'btn small', onclick: (e) => linkMenu(e.currentTarget) }, 'Link a setup…') : null,
        h('button', { class: 'btn ghost small', onclick: () => sbPickImage(shot, ui, 'diagram') }, shot.diagram ? 'Change picture…' : 'Or use a picture…'),
        shot.diagram ? h('button', { class: 'btn ghost small', onclick: () => { shot.diagram = ''; ui.changed(); ui.sync(shot, 'diagram'); } }, 'Remove picture') : null));
    }
    return h('div', { class: 'ins-section' }, ...parts);
  }

  function sbBoard(d, ui) {
    const sel = sbSel(d);
    const nums = SD.storyboardNumbers(state.project, d);
    const script = sbSource(d);
    const board = h('div', { class: 'sb-board size-' + d.settings.size + (d.settings.details ? '' : ' no-details'), style: `--ratio:${SD.FRAME_RATIOS[d.ratio]}` });
    if (!d.sequences.length) {
      const scripts = state.project.documents.filter((x) => x.kind === 'script' && SD.getScenes(x).length);
      board.append(h('div', { class: 'empty-state story-empty' },
        h('div', { class: 'empty-icon' }, '🎞️'),
        h('h3', {}, 'Plan your shots'),
        h('p', { class: 'muted' }, 'A storyboard has a sequence for each scene, and a row of shots in each sequence. Give every shot a picture — a photo, a sketch you draw here, or anything you paste — and say what the camera does.'),
        h('div', { class: 'row-gap center' },
          scripts.length ? h('button', { class: 'btn primary', onclick: (e) => sbBuildMenu(e.currentTarget, d, ui.full) }, 'Build from a script…') : null,
          h('button', { class: 'btn', onclick: () => { sbAddSequence(d); ui.full(); } }, '+ Add sequence'))));
      return board;
    }
    d.sequences.forEach((seq) => {
      const secs = seq.shots.reduce((n, x) => n + (+x.duration || 0), 0);
      board.append(h('section', { class: 'sb-seq' },
        h('div', { class: 'sb-seq-head' + (!sel.shot && sel.seq === seq.id ? ' on' : '') + (seq.orphan ? ' orphan' : ''), dataset: { seqhead: seq.id } },
          h('button', { class: 'sb-seq-title', onclick: () => ui.select({ seq: seq.id }) },
            h('span', { class: 'sb-seq-num' }, (seq.sceneId ? 'Scene ' : 'Sequence ') + nums.get(seq.id)),
            h('span', { class: 'sb-seq-name' }, seq.title || 'Untitled sequence')),
          seq.orphan ? h('span', { class: 'warn small' }, 'scene deleted from the script') : null,
          h('span', { class: 'muted small' }, `${seq.shots.length} shot${seq.shots.length === 1 ? '' : 's'}` + (secs ? ' · ' + SD.formatSeconds(secs) : '')),
          h('span', { class: 'push-right row-gap' },
            !seq.shots.length && script && seq.sceneId && !seq.orphan ? h('button', { class: 'btn ghost small', title: 'One shot per action paragraph and speaker', onclick: () => sbDraft(d, seq, ui.full) }, 'Draft shots from the scene') : null,
            h('button', { class: 'btn ghost small', onclick: () => { sbAddShot(d, seq); ui.full(); } }, '+ Shot'))),
        h('div', { class: 'sb-shots', dataset: { seq: seq.id } },
          seq.shots.map((shot, i) => sbCard(d, seq, shot, i, nums, sel, ui)),
          h('button', { class: 'sb-add', title: 'Add a shot (or drop pictures here)', onclick: () => { sbAddShot(d, seq); ui.full(); } }, h('span', {}, '+'), h('small', {}, 'Shot')))));
    });
    board.append(h('p', { class: 'muted small sb-help' }, 'Double-click a frame to add a picture, or drop pictures from your computer onto it. Paste (Ctrl+V) puts a copied picture in the selected shot. Drag a frame to move the shot.'));
    return board;
  }

  function sbCard(d, seq, shot, i, nums, sel, ui) {
    const no = nums.get(seq.id) + SD.shotLetters(i);
    const pick = () => ui.select({ seq: seq.id, shot: shot.id });
    return h('div', { class: 'sb-card' + (sel.shot === shot.id ? ' on' : ''), dataset: { card: shot.id }, onmousedown: () => { if (sbSel(d).shot !== shot.id) pick(); } },
      h('div', { class: 'sb-frame', draggable: 'true', title: 'Double-click to add a picture · drag to move', dataset: { shot: shot.id, frame: 'Double-click, drop or paste a picture' }, ondblclick: () => sbPickImage(shot, ui) },
        sbFrameKids(shot, 'Double-click, drop or paste a picture')),
      h('div', { class: 'sb-card-head' },
        h('span', { class: 'sb-no' }, no),
        h('span', { class: 'sb-meta', dataset: { shot: shot.id, meta: '1' } }, sbMeta(shot)),
        h('button', {
          class: 'icon-btn sb-more', title: 'More…', 'aria-label': 'Shot options',
          onclick: (e) => popupMenu(e.currentTarget, [
            { label: 'Picture…', run: () => sbPickImage(shot, ui) },
            { label: 'Draw…', run: () => sbDraw(d, shot, ui) },
            { label: 'Play from here', run: () => sbPlay(d, shot.id) },
            '-',
            { label: 'Insert shot after', run: () => { pick(); sbAddShot(d); ui.full(); } },
            { label: 'Duplicate', run: () => { const c = Object.assign(SD.newShot(), JSON.parse(JSON.stringify(shot)), { id: SD.uid() }); seq.shots.splice(seq.shots.indexOf(shot) + 1, 0, c); ui.changed(); ui.full(); } },
            { label: 'Delete shot', danger: true, run: () => { seq.shots.splice(seq.shots.indexOf(shot), 1); state.sbSel = { doc: d.id, seq: seq.id }; ui.changed(); ui.full(); } },
          ]),
        }, '⋯')),
      sbField('textarea', shot, 'caption', ui, { class: 'sb-cap', rows: 3, placeholder: 'What do we see?', spellcheck: true }));
  }

  function sbList(d, ui) {
    const sel = sbSel(d);
    const nums = SD.storyboardNumbers(state.project, d);
    if (!d.sequences.some((s) => s.shots.length)) return h('div', { class: 'empty-state' }, h('p', {}, 'No shots yet. Add them on the Board tab, or type them here after adding a sequence.'), h('button', { class: 'btn', onclick: () => { sbAddShot(d); ui.full(); } }, '+ Add shot'));
    const body = [];
    for (const seq of d.sequences) {
      body.push(h('tr', { class: 'sl-seq' }, h('th', { colspan: 9 }, h('button', { onclick: () => ui.select({ seq: seq.id }) }, (seq.sceneId ? 'Scene ' : 'Sequence ') + nums.get(seq.id) + ' — ' + (seq.title || 'Untitled')))));
      seq.shots.forEach((shot, i) => body.push(h('tr', { class: sel.shot === shot.id ? 'on' : '', dataset: { card: shot.id }, onfocusin: () => { if (sbSel(d).shot !== shot.id) ui.select({ seq: seq.id, shot: shot.id }); }, onclick: () => { if (sbSel(d).shot !== shot.id) ui.select({ seq: seq.id, shot: shot.id }); } },
        h('td', { class: 'sl-no' }, nums.get(seq.id) + SD.shotLetters(i)),
        h('td', { class: 'sl-pic' }, h('div', { class: 'sb-frame mini', dataset: { shot: shot.id, frame: '' }, ondblclick: () => sbPickImage(shot, ui) }, sbFrameKids(shot, ''))),
        h('td', {}, sbField('textarea', shot, 'caption', ui, { class: 'sl-in', rows: 2, placeholder: 'What do we see?' })),
        h('td', {}, sbTypeSelect(shot, ui, 'sl-in')),
        h('td', {}, sbMoveSelect(shot, ui, 'sl-in')),
        h('td', {}, sbField('input', shot, 'lens', ui, { class: 'sl-in', placeholder: '35mm', size: 5 })),
        h('td', {}, sbField('input', shot, 'duration', ui, { class: 'sl-in num', type: 'number', min: 0, step: 0.5, placeholder: '0' })),
        h('td', {}, sbField('textarea', shot, 'audio', ui, { class: 'sl-in', rows: 2, placeholder: 'Sound / dialogue' })),
        h('td', {}, sbField('textarea', shot, 'notes', ui, { class: 'sl-in', rows: 2, placeholder: 'Notes' })))));
    }
    const st = SD.storyboardStats(d);
    return h('div', { class: 'sl-wrap' },
      h('table', { class: 'shot-list' },
        h('thead', {}, h('tr', {}, ['Shot', 'Picture', 'Description', 'Type', 'Camera', 'Lens', 'Sec', 'Sound', 'Notes'].map((c) => h('th', {}, c)))),
        h('tbody', {}, body),
        h('tfoot', {}, h('tr', {}, h('td', { colspan: 6 }, `${st.shots} shots`), h('td', { dataset: { total: '1' } }, SD.formatSeconds(st.seconds)), h('td', { colspan: 2 })))));
  }

  function sbPanel(d, ui) {
    const sec = (...kids) => h('div', { class: 'ins-section' }, ...kids);
    const sel = sbSel(d);
    const script = sbSource(d);
    const f = sel.shot && sbFind(d, sel.shot);
    if (f) {
      const { seq, shot, index } = f;
      const no = sbShotNo(d, seq, index);
      return [
        sec(h('div', { class: 'ins-kicker' }, `Shot ${no} · ${seq.title || 'Untitled sequence'}`),
          h('div', { class: 'sb-frame big', style: `--ratio:${SD.FRAME_RATIOS[d.ratio]}`, dataset: { shot: shot.id, frame: 'No picture yet' }, ondblclick: () => sbPickImage(shot, ui) }, sbFrameKids(shot, 'No picture yet')),
          h('div', { class: 'row-gap' },
            h('button', { class: 'btn small', onclick: () => sbPickImage(shot, ui) }, shot.image ? 'Change picture…' : 'Picture…'),
            h('button', { class: 'btn small', onclick: () => sbDraw(d, shot, ui) }, shot.drawing ? '✏️ Edit drawing' : '✏️ Draw'),
            shot.image ? h('button', { class: 'btn ghost small', onclick: () => { shot.image = ''; ui.changed(); ui.sync(shot, 'image'); } }, 'Remove picture') : null,
            shot.drawing ? h('button', { class: 'btn ghost small', onclick: () => { shot.drawing = ''; ui.changed(); ui.sync(shot, 'drawing'); } }, 'Clear drawing') : null)),
        sec(h('label', { class: 'lbl' }, 'What do we see?'),
          sbField('textarea', shot, 'caption', ui, { class: 'input', rows: 4, placeholder: 'Action in this shot' }),
          h('div', { class: 'sb-grid2' },
            h('div', {}, h('label', { class: 'lbl' }, 'Shot type'), sbTypeSelect(shot, ui, 'select')),
            h('div', {}, h('label', { class: 'lbl' }, 'Camera'), sbMoveSelect(shot, ui, 'select')),
            h('div', {}, h('label', { class: 'lbl' }, 'Lens'), sbField('input', shot, 'lens', ui, { class: 'input', placeholder: 'e.g. 35mm' })),
            h('div', {}, h('label', { class: 'lbl' }, 'Seconds'), sbField('input', shot, 'duration', ui, { class: 'input', type: 'number', min: 0, step: 0.5, placeholder: '0' })))),
        sec(h('label', { class: 'lbl' }, 'Sound & dialogue'),
          sbField('textarea', shot, 'audio', ui, { class: 'input', rows: 2, placeholder: 'Lines, music, effects' }),
          h('label', { class: 'lbl' }, 'Notes'),
          sbField('textarea', shot, 'notes', ui, { class: 'input', rows: 2, placeholder: 'Lighting, props, VFX…' })),
        sbSetupSection(d, seq, shot, index, no, ui),
        sec(h('div', { class: 'row-gap' },
          h('button', { class: 'btn small', disabled: index === 0, title: 'Move earlier', onclick: () => { seq.shots.splice(index, 1); seq.shots.splice(index - 1, 0, shot); ui.changed(); ui.full(); } }, '←'),
          h('button', { class: 'btn small', disabled: index === seq.shots.length - 1, title: 'Move later', onclick: () => { seq.shots.splice(index, 1); seq.shots.splice(index + 1, 0, shot); ui.changed(); ui.full(); } }, '→'),
          h('button', { class: 'btn small', onclick: () => sbPlay(d, shot.id) }, '▶ Play from here'),
          h('button', { class: 'btn small danger', onclick: () => { seq.shots.splice(index, 1); state.sbSel = { doc: d.id, seq: seq.id }; ui.changed(); ui.full(); } }, 'Delete'))),
      ];
    }
    const seq = sel.seq && d.sequences.find((s) => s.id === sel.seq);
    if (seq) {
      const si = d.sequences.indexOf(seq);
      const scene = script && seq.sceneId ? SD.getScenes(script).find((s) => s.id === seq.sceneId) : null;
      const secs = seq.shots.reduce((n, x) => n + (+x.duration || 0), 0);
      return [
        sec(h('div', { class: 'ins-kicker' }, seq.sceneId ? `Scene ${SD.storyboardNumbers(state.project, d).get(seq.id)}${script ? ' · from “' + script.name + '”' : ''}` : `Sequence ${si + 1}`),
          seq.orphan ? h('p', { class: 'warn small' }, 'This scene is no longer in the script. The shots are kept.') : null,
          h('textarea', { class: 'input', rows: 2, value: seq.title, placeholder: 'Name this sequence', oninput: (e) => { seq.title = e.target.value; if (seq.sceneId) seq.customTitle = true; ui.changed(); const t = document.querySelector(`[data-seqhead="${seq.id}"] .sb-seq-name`); if (t) t.textContent = seq.title || 'Untitled sequence'; } }),
          scene && scene.el.synopsis ? h('p', { class: 'muted small' }, scene.el.synopsis) : null,
          h('p', { class: 'muted small' }, `${seq.shots.length} shots` + (secs ? ` · ${SD.formatSeconds(secs)}` : '') + (scene ? ` · ${SD.eighths(scene.lines)} pages of script` : ''))),
        sec(h('div', { class: 'row-gap' },
          h('button', { class: 'btn small', onclick: () => { sbAddShot(d, seq); ui.full(); } }, '+ Shot'),
          scene ? h('button', { class: 'btn small', title: 'One shot per action paragraph and speaker', onclick: () => sbDraft(d, seq, ui.full) }, 'Draft shots from the scene') : null,
          scene ? h('button', { class: 'btn small', onclick: () => { state.docId = script.id; state.view = 'script'; renderDocList(); renderView(); requestAnimationFrame(() => editor.goTo(seq.sceneId)); } }, 'Go to scene') : null),
        h('div', { class: 'row-gap' },
          h('button', { class: 'btn small', disabled: si === 0, title: 'Move earlier', onclick: () => { d.sequences.splice(si, 1); d.sequences.splice(si - 1, 0, seq); ui.changed(); ui.full(); } }, '↑'),
          h('button', { class: 'btn small', disabled: si === d.sequences.length - 1, title: 'Move later', onclick: () => { d.sequences.splice(si, 1); d.sequences.splice(si + 1, 0, seq); ui.changed(); ui.full(); } }, '↓'),
          h('button', {
            class: 'btn small danger', onclick: async () => {
              if (seq.shots.length && !(await modal({ title: 'Delete this sequence?', body: `Its ${seq.shots.length} shots are deleted too.`, buttons: [{ label: 'Cancel', value: false }, { label: 'Delete', value: true, primary: true, danger: true }] }))) return;
              d.sequences.splice(si, 1); state.sbSel = { doc: d.id }; ui.changed(); ui.full();
            },
          }, 'Delete sequence'))),
      ];
    }
    const st = SD.storyboardStats(d);
    const s = d.settings;
    return [
      sec(h('div', { class: 'ins-kicker' }, 'Storyboard'),
        h('p', { class: 'muted small' }, 'Click a shot to edit it. Each sequence follows one scene of your script; shots are numbered by scene (3A, 3B…).'),
        h('p', { class: 'muted small' }, `${st.sequences} sequences · ${st.shots} shots · ${st.pictures} with pictures` + (st.seconds ? ` · ${SD.formatSeconds(st.seconds)}` : ''))),
      sec(h('label', { class: 'lbl' }, 'Frame shape'),
        h('select', { class: 'select', onchange: (e) => { d.ratio = e.target.value; ui.changed(); ui.full(); } }, Object.keys(SD.FRAME_RATIOS).map((r) => h('option', { value: r, selected: r === d.ratio }, r + (r === '16:9' ? ' (HD video)' : r === '2.39:1' ? ' (cinemascope)' : r === '9:16' ? ' (phone, vertical)' : r === '4:3' ? ' (classic TV)' : '')))),
        h('label', { class: 'lbl' }, 'Card size'),
        h('div', { class: 'seg' }, [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']].map(([k, l]) => h('button', { class: 'btn small' + (s.size === k ? ' primary' : ''), onclick: () => { s.size = k; ui.changed(); ui.full(); } }, l))),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.details, onchange: (e) => { s.details = e.target.checked; ui.changed(); ui.full(); } }), ' Show shot type and camera on the cards')),
      sec(h('label', { class: 'lbl' }, 'Script'),
        h('p', { class: 'muted small' }, d.sourceId ? `Linked to “${script ? script.name : 'a deleted script'}”. Update to add sequences for new scenes; your shots are kept.` : 'Make a sequence for each scene of a script, or add sequences by hand.'),
        h('button', { class: 'btn small', onclick: (e) => sbBuildMenu(e.currentTarget, d, ui.full) }, d.sourceId ? 'Update from script…' : 'Build from a script…')),
    ];
  }

  // ---------- drawing pad ----------
  async function sbDraw(d, shot, ui) {
    const ratio = SD.FRAME_RATIOS[d.ratio];
    const W = ratio >= 1 ? 1280 : Math.round(1280 * ratio), H = ratio >= 1 ? Math.round(1280 / ratio) : 1280;
    const cv = h('canvas', { width: W, height: H, class: 'sb-draw-canvas' });
    const ctx = cv.getContext('2d');
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (shot.drawing) await new Promise((res) => { const im = new Image(); im.onload = () => { ctx.drawImage(im, 0, 0, W, H); res(); }; im.onerror = res; im.src = shot.drawing; });
    const tool = { kind: 'pen', color: '#1b1b1b', size: 6 };
    const undo = [];
    const snap = () => { undo.push(ctx.getImageData(0, 0, W, H)); if (undo.length > 40) undo.shift(); };
    const bg = shot.image ? h('img', { src: shot.image, alt: '', class: 'sb-draw-bg' }) : null;
    const stage = h('div', { class: 'sb-draw-stage', style: `aspect-ratio:${W}/${H}; width:min(100%, calc(62vh * ${W / H}))` }, bg, cv);

    const toolBtns = {};
    const setTool = (k) => { tool.kind = k; for (const [kk, b] of Object.entries(toolBtns)) b.classList.toggle('primary', kk === k); };
    const colorBtns = [];
    const COLORS = ['#1b1b1b', '#8b8d98', '#ffffff', '#d64541', '#e8a33d', '#2f9e66', '#2f6fd6', '#8e44ad'];
    const bar = h('div', { class: 'sb-draw-bar' },
      ['pen', 'arrow', 'box', 'eraser'].map((k) => (toolBtns[k] = h('button', { class: 'btn small', onclick: () => setTool(k) }, { pen: '✏️ Pen', arrow: '➜ Arrow', box: '▭ Box', eraser: '⌫ Eraser' }[k]))),
      h('span', { class: 'sb-draw-colors' }, COLORS.map((c) => { const b = h('button', { class: 'swatch' + (c === tool.color ? ' on' : ''), style: `background:${c}`, 'aria-label': 'Colour ' + c, onclick: () => { tool.color = c; colorBtns.forEach((x) => x.classList.toggle('on', x === b)); if (tool.kind === 'eraser') setTool('pen'); } }); colorBtns.push(b); return b; })),
      h('label', { class: 'sb-draw-size', title: 'Line thickness' }, 'Size', h('input', { type: 'range', min: 1, max: 40, value: tool.size, oninput: (e) => { tool.size = +e.target.value; } })),
      h('button', { class: 'btn small', title: 'Undo (Ctrl+Z)', onclick: () => { if (undo.length) ctx.putImageData(undo.pop(), 0, 0); } }, '↶ Undo'),
      h('button', { class: 'btn small', onclick: () => { snap(); ctx.clearRect(0, 0, W, H); } }, 'Clear'),
      bg ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => { bg.hidden = !e.target.checked; } }), ' Show picture') : null);
    setTool('pen');

    const pt = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) }; };
    const width = (e) => tool.size * (W / 640) * (e.pointerType === 'pen' && e.pressure > 0 ? 0.35 + e.pressure : 1);
    let down = null;
    const shape = (a, b) => {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = tool.color; ctx.fillStyle = tool.color; ctx.lineWidth = tool.size * (W / 640);
      if (tool.kind === 'box') { ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)); return; }
      const ang = Math.atan2(b.y - a.y, b.x - a.x), head = Math.max(14, ctx.lineWidth * 3.2);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x - Math.cos(ang) * head * 0.6, b.y - Math.sin(ang) * head * 0.6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - head * Math.cos(ang - 0.45), b.y - head * Math.sin(ang - 0.45));
      ctx.lineTo(b.x - head * Math.cos(ang + 0.45), b.y - head * Math.sin(ang + 0.45));
      ctx.closePath(); ctx.fill();
    };
    cv.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      cv.setPointerCapture(e.pointerId);
      snap();
      const p = pt(e);
      down = { start: p, last: p, mid: p, base: tool.kind === 'arrow' || tool.kind === 'box' ? ctx.getImageData(0, 0, W, H) : null };
      if (!down.base) {
        ctx.globalCompositeOperation = tool.kind === 'eraser' ? 'destination-out' : 'source-over';
        ctx.fillStyle = tool.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, width(e) / 2, 0, Math.PI * 2); ctx.fill();
      }
    });
    cv.addEventListener('pointermove', (e) => {
      if (!down) return;
      const p = pt(e);
      if (down.base) { ctx.putImageData(down.base, 0, 0); shape(down.start, p); return; }
      const mid = { x: (down.last.x + p.x) / 2, y: (down.last.y + p.y) / 2 };
      ctx.globalCompositeOperation = tool.kind === 'eraser' ? 'destination-out' : 'source-over';
      ctx.strokeStyle = tool.color;
      ctx.lineWidth = tool.kind === 'eraser' ? tool.size * 3 * (W / 640) : width(e);
      ctx.beginPath(); ctx.moveTo(down.mid.x, down.mid.y); ctx.quadraticCurveTo(down.last.x, down.last.y, mid.x, mid.y); ctx.stroke();
      down.last = p; down.mid = mid;
    });
    const up = () => { down = null; ctx.globalCompositeOperation = 'source-over'; };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && undo.length) { e.preventDefault(); ctx.putImageData(undo.pop(), 0, 0); } };
    document.addEventListener('keydown', onKey);

    const save = await modal({
      title: 'Draw shot ' + (() => { const f = sbFind(d, shot.id); return f ? sbShotNo(d, f.seq, f.index) : ''; })(),
      body: h('div', { class: 'sb-draw' }, bar, stage, h('p', { class: 'muted small' }, shot.image ? 'You draw on a layer over the picture. The picture itself is not changed.' : 'Tip: stick figures and arrows are enough. Arrows show where people or the camera move.')),
      wide: true,
      buttons: [{ label: 'Cancel', value: false }, { label: 'Save drawing', value: true, primary: true }],
    });
    document.removeEventListener('keydown', onKey);
    if (!save) return;
    const px = ctx.getImageData(0, 0, W, H).data;
    let blank = true;
    for (let i = 3; i < px.length; i += 16) if (px[i]) { blank = false; break; }
    shot.drawing = blank ? '' : cv.toDataURL('image/png');
    ui.changed();
    ui.sync(shot, 'drawing');
  }

  // ---------- play (animatic) ----------
  function sbPlay(d, fromShotId) {
    const nums = SD.storyboardNumbers(state.project, d);
    const list = d.sequences.flatMap((seq) => seq.shots.map((shot, i) => ({ seq, shot, no: nums.get(seq.id) + SD.shotLetters(i) })));
    if (!list.length) { toast('Add some shots first.'); return; }
    let at = Math.max(0, list.findIndex((x) => x.shot.id === fromShotId));
    let playing = false, timer = null, startedAt = 0;
    const len = (x) => (+x.shot.duration || 3) * 1000;
    const frame = h('div', { class: 'sb-play-frame', style: `--ratio:${SD.FRAME_RATIOS[d.ratio]}` });
    const info = h('div', { class: 'sb-play-info' });
    const counter = h('span', { class: 'sb-play-count' });
    const bar = h('div', { class: 'sb-play-progress' }, h('div', {}));
    const playBtn = h('button', { class: 'btn', onclick: () => toggle() }, '▶ Play');
    const show = () => {
      const x = list[at];
      frame.replaceChildren(...sbFrameKids(x.shot, null), !x.shot.image && !x.shot.drawing ? h('div', { class: 'sb-play-text' }, x.shot.caption || '—') : null);
      info.replaceChildren(
        h('div', { class: 'sb-play-line' }, h('strong', {}, x.no), ' ', x.seq.title, x.shot.shotType || x.shot.move ? h('span', { class: 'sb-play-meta' }, sbMeta(x.shot)) : null),
        x.shot.image || x.shot.drawing ? h('div', { class: 'sb-play-cap' }, x.shot.caption) : null,
        x.shot.audio ? h('div', { class: 'sb-play-audio' }, '♪ ' + x.shot.audio) : null);
      counter.textContent = `${at + 1} / ${list.length}`;
    };
    const tick = () => {
      const t = (performance.now() - startedAt) / len(list[at]);
      bar.firstChild.style.width = Math.min(100, t * 100) + '%';
      if (t >= 1) {
        if (at >= list.length - 1) { stop(); return; }
        at++; startedAt = performance.now(); show();
      }
    };
    const play = () => { if (at >= list.length - 1) at = 0; playing = true; startedAt = performance.now(); playBtn.textContent = '⏸ Pause'; show(); clearInterval(timer); timer = setInterval(tick, 40); };
    const stop = () => { playing = false; clearInterval(timer); playBtn.textContent = '▶ Play'; };
    const toggle = () => (playing ? stop() : play());
    const go = (k) => { at = Math.max(0, Math.min(list.length - 1, k)); startedAt = performance.now(); bar.firstChild.style.width = '0%'; show(); };
    const close = () => { stop(); document.removeEventListener('keydown', onKey, true); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); overlay.remove(); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); go(at + 1); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(at - 1); }
      else if (e.key === ' ') { e.preventDefault(); toggle(); }
      else if (e.key === 'Home') { e.preventDefault(); go(0); }
    };
    const overlay = h('div', { class: 'sb-play', role: 'dialog', 'aria-label': 'Play storyboard' },
      h('div', { class: 'sb-play-top' }, h('strong', {}, d.name), counter,
        h('span', { class: 'push-right row-gap' },
          h('button', { class: 'btn ghost', title: 'Full screen', onclick: () => { if (document.fullscreenElement) document.exitFullscreen(); else overlay.requestFullscreen && overlay.requestFullscreen().catch(() => {}); } }, '⛶'),
          h('button', { class: 'btn ghost', title: 'Close (Esc)', onclick: close }, '✕'))),
      h('div', { class: 'sb-play-stage', onclick: () => go(at + 1) }, frame),
      info,
      bar,
      h('div', { class: 'sb-play-controls' },
        h('button', { class: 'btn', title: 'Previous (←)', onclick: () => go(at - 1) }, '⏮'),
        playBtn,
        h('button', { class: 'btn', title: 'Next (→)', onclick: () => go(at + 1) }, '⏭'),
        h('span', { class: 'muted small' }, 'Shots without a length show for 3 seconds · Space plays, arrows step, Esc closes')));
    document.body.append(overlay);
    document.addEventListener('keydown', onKey, true);
    show();
  }

  // ---------- export / print ----------
  function sbShotListCSV(d) {
    const nums = SD.storyboardNumbers(state.project, d);
    const q = (v) => { const s = String(v == null ? '' : v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const rows = [['Scene', 'Shot', 'Sequence', 'Shot type', 'Camera', 'Lens', 'Seconds', 'Description', 'Sound', 'Notes']];
    for (const seq of d.sequences) seq.shots.forEach((x, i) => rows.push([nums.get(seq.id), nums.get(seq.id) + SD.shotLetters(i), seq.title, SD.shotTypeLabel(x.shotType) || x.shotType, x.move, x.lens, x.duration || '', x.caption, x.audio, x.notes]));
    return '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n');
  }

  async function printStoryboard(d) {
    const cols = h('select', { class: 'select' }, [2, 3, 4].map((n) => h('option', { value: n, selected: n === 3 }, n + ' shots across')));
    const what = h('select', { class: 'select' }, h('option', { value: 'board', selected: (state.sbTab || 'board') === 'board' }, 'Storyboard frames'), h('option', { value: 'list', selected: state.sbTab === 'list' }, 'Shot list (table)'));
    const cDetails = h('input', { type: 'checkbox', checked: true });
    const cSound = h('input', { type: 'checkbox', checked: true });
    const cBreak = h('input', { type: 'checkbox', checked: false });
    const body = h('div', { class: 'print-opts' },
      h('label', { class: 'lbl' }, 'Print'), what,
      h('label', { class: 'lbl' }, 'Layout'), cols,
      h('label', { class: 'check' }, cDetails, ' Shot type, camera, lens and length'),
      h('label', { class: 'check' }, cSound, ' Sound and notes'),
      h('label', { class: 'check' }, cBreak, ' Start each sequence on a new page'));
    const ok = await modal({ title: 'Print storyboard', body, buttons: [{ label: 'Cancel', value: false }, { label: 'Print / PDF', value: true, primary: true }] });
    if (!ok) return;
    const nums = SD.storyboardNumbers(state.project, d);
    const root = $('#print-root');
    root.className = 'print-board cols-' + cols.value + (cBreak.checked ? ' seq-break' : '');
    root.style.setProperty('--ratio', SD.FRAME_RATIOS[d.ratio]);
    const kids = [h('h1', {}, [state.project.title, d.name].filter(Boolean).join(' — '))];
    if (what.value === 'list') {
      kids.push(h('table', { class: 'pb-list' },
        h('thead', {}, h('tr', {}, ['Shot', '', 'Description', 'Type', 'Camera', 'Lens', 'Sec', cSound.checked ? 'Sound / notes' : null].filter((x) => x != null).map((c) => h('th', {}, c)))),
        h('tbody', {}, d.sequences.flatMap((seq) => [
          h('tr', { class: 'pb-seqrow' }, h('td', { colspan: 8 }, (seq.sceneId ? 'Scene ' : 'Sequence ') + nums.get(seq.id) + ' — ' + (seq.title || 'Untitled'))),
          ...seq.shots.map((x, i) => h('tr', {},
            h('td', { class: 'pb-no' }, nums.get(seq.id) + SD.shotLetters(i)),
            h('td', { class: 'pb-thumb' }, x.image || x.drawing ? h('div', { class: 'pb-frame' }, sbFrameKids(x, null)) : ''),
            h('td', {}, x.caption), h('td', {}, x.shotType), h('td', {}, x.move), h('td', {}, x.lens), h('td', {}, x.duration || ''),
            cSound.checked ? h('td', {}, [x.audio, x.notes].filter(Boolean).join(' — ')) : null)),
        ]))));
    } else {
      for (const seq of d.sequences) {
        if (!seq.shots.length) continue;
        kids.push(h('section', { class: 'pb-seq' },
          h('h2', {}, (seq.sceneId ? 'Scene ' : 'Sequence ') + nums.get(seq.id) + ' — ' + (seq.title || 'Untitled')),
          h('div', { class: 'pb-grid' }, seq.shots.map((x, i) => h('div', { class: 'pb-card' },
            h('div', { class: 'pb-frame' }, sbFrameKids(x, null)),
            h('div', { class: 'pb-head' }, h('strong', {}, nums.get(seq.id) + SD.shotLetters(i)), cDetails.checked ? ' ' + sbMeta(x) : ''),
            x.caption ? h('div', { class: 'pb-cap' }, x.caption) : null,
            cSound.checked && x.audio ? h('div', { class: 'pb-small' }, '♪ ' + x.audio) : null,
            cSound.checked && x.notes ? h('div', { class: 'pb-small' }, x.notes) : null)))));
      }
    }
    root.replaceChildren(...kids);
    const decoded = Promise.all([...root.querySelectorAll('img')].map((im) => (im.decode ? im.decode().catch(() => {}) : null)));
    await Promise.race([decoded, new Promise((r) => setTimeout(r, 1500))]);
    const pageStyle = $('#page-size-style');
    const before = pageStyle.textContent;
    pageStyle.textContent = `@page { size: ${state.project.settings.pageSize === 'a4' ? 'A4' : 'letter'} landscape; margin: 0.45in; }`;
    const docTitle = document.title;
    document.title = safeName((state.project.title || 'Storyboard') + ' - ' + d.name);
    window.addEventListener('afterprint', () => { pageStyle.textContent = before; document.title = docTitle; }, { once: true });
    window.print();
  }

  // ---------- Notes (rich text) ----------
  function renderNote(root, d) {
    if (typeof d.html !== 'string') d.html = SD.textToHtml(d.text);
    const ed = h('div', { class: 'note-rich', contentEditable: 'true', spellcheck: true, 'data-placeholder': 'Ideas, outlines, research, character bios…' });
    ed.innerHTML = SD.sanitizeHtml(d.html);
    const save = () => {
      d.html = ed.innerHTML;
      d.text = ed.innerText.replace(/\n{3,}/g, '\n\n').trim();
      ed.classList.toggle('is-empty', !d.text);
      markDirty();
      renderStatusSoon();
    };
    ed.classList.toggle('is-empty', !ed.textContent.trim());
    ed.addEventListener('input', save);
    ed.addEventListener('paste', (e) => {
      const html = e.clipboardData.getData('text/html');
      const text = e.clipboardData.getData('text/plain');
      if (!html && !text) return;
      e.preventDefault();
      document.execCommand('insertHTML', false, html ? SD.sanitizeHtml(html) : SD.textToHtml(text) || SD.escapeHtml(text));
    });
    ed.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 'b' || k === 'i' || k === 'u') { e.preventDefault(); noteCmd({ b: 'bold', i: 'italic', u: 'underline' }[k]); }
    });
    root.append(h('div', { class: 'note-wrap' }, noteAboutBar(d), h('div', { class: 'note-page' }, ed)));
    setTimeout(() => ed.focus(), 0);
  }

  // Which characters, locations… a note is about; their catalog pages list the note.
  function noteAboutBar(d) {
    d.about = d.about || [];
    const bar = h('div', { class: 'note-about' });
    const draw = () => {
      const items = d.about.map((id) => state.project.catalog.find((c) => c.id === id)).filter(Boolean);
      bar.replaceChildren(h('span', { class: 'muted small' }, 'About:'),
        ...items.map((c) => h('span', { class: 'chip', style: `--chip:${SD.categoryById(c.category).color}` },
          h('button', { class: 'chip-name', title: 'Open in the catalog', onclick: () => openCatalogItem(c.id) }, c.name || 'Unnamed'),
          h('button', { class: 'chip-x', 'aria-label': 'Remove ' + c.name, onclick: () => { d.about = d.about.filter((x) => x !== c.id); markDirty(); draw(); } }, '×'))),
        h('button', {
          class: 'btn ghost small', onclick: (e) => {
            const pick = state.project.catalog.filter((c) => !d.about.includes(c.id) && c.name.trim()).sort((a, b) => (a.category === 'character' ? 0 : 1) - (b.category === 'character' ? 0 : 1) || a.name.localeCompare(b.name)).slice(0, 60);
            if (!pick.length) { toast('Add characters or locations to the Master Catalog first.'); return; }
            popupMenu(e.currentTarget, pick.map((c) => ({ label: SD.categoryById(c.category).one + ': ' + c.name, run: () => { d.about.push(c.id); markDirty(); draw(); } })));
          },
        }, items.length ? '+ Link' : '+ Link to a character, location…'));
    };
    draw();
    return bar;
  }

  // A new note about a catalog item, filed in a folder such as “Character notes”.
  function newNoteAbout(c) {
    const p = state.project;
    const fname = SD.categoryById(c.category).one + ' notes';
    let f = p.folders.find((x) => x.name === fname);
    if (!f) { f = { id: SD.uid(), name: fname, open: true }; p.folders.push(f); }
    const d = SD.newNote((c.name || 'Untitled') + ' — notes');
    d.folder = f.id; d.about = [c.id];
    p.documents.push(d);
    f.open = true;
    markDirty();
    selectDoc(d.id);
  }

  function noteCmd(cmd, arg) {
    const ed = $('.note-rich');
    if (!ed) return;
    if (!ed.contains(document.getSelection().anchorNode)) ed.focus();
    document.execCommand(cmd, false, arg);
    ed.dispatchEvent(new Event('input'));
  }

  function noteToolbar(d) {
    const b = (label, title, run, cls = '') => h('button', { class: 'btn ghost small note-btn ' + cls, title, onmousedown: (e) => e.preventDefault(), onclick: run }, label);
    return [
      h('div', { class: 'tb-group' },
        b('H1', 'Big heading', () => noteCmd('formatBlock', '<h1>')),
        b('H2', 'Heading', () => noteCmd('formatBlock', '<h2>')),
        b('H3', 'Small heading', () => noteCmd('formatBlock', '<h3>')),
        b('¶', 'Normal text', () => noteCmd('formatBlock', '<p>'))),
      h('div', { class: 'tb-group' },
        b('B', 'Bold (Ctrl+B)', () => noteCmd('bold'), 'fb'),
        b('I', 'Italic (Ctrl+I)', () => noteCmd('italic'), 'fi'),
        b('U', 'Underline (Ctrl+U)', () => noteCmd('underline'), 'fu'),
        b('S', 'Strike through', () => noteCmd('strikeThrough'), 'fs')),
      h('div', { class: 'tb-group' },
        b('• List', 'Bulleted list', () => noteCmd('insertUnorderedList')),
        b('1. List', 'Numbered list', () => noteCmd('insertOrderedList')),
        b('❝ Quote', 'Quote', () => noteCmd('formatBlock', '<blockquote>')),
        b('―', 'Divider line', () => noteCmd('insertHorizontalRule')),
        b('✕ Format', 'Remove formatting from the selection', () => { noteCmd('removeFormat'); noteCmd('formatBlock', '<p>'); })),
      h('div', { class: 'tb-group' },
        h('button', { class: 'btn ghost small', title: 'Print or save as PDF', onclick: () => printNote(d) }, 'Print')),
    ];
  }

  function printNote(d) {
    const body = h('div', { class: 'note-print' });
    body.innerHTML = SD.sanitizeHtml(d.html || SD.textToHtml(d.text));
    printNodes('print-note', [h('h1', { class: 'note-print-title' }, d.name), body], { title: d.name, margin: '0.9in' });
  }

  // ---------- Master catalog ----------
  const catalogById = (id) => state.project.catalog.find((c) => c.id === id) || null;

  // Open the catalog on one item (or create it when missing).
  function openCatalogItem(id, create) {
    syncEditor();
    let item = id ? catalogById(id) : null;
    if (!item && create) {
      item = SD.findCatalogItem(state.project, create.category, create.name);
      if (!item) {
        item = SD.newCatalogItem(create.category, create.name);
        state.project.catalog.push(item);
        markDirty();
      }
    }
    if (!item) return;
    state.catalogSel = item.id;
    state.catalogFilter = 'all';
    state.catalogSearch = '';
    state.docId = '__catalog';
    document.body.classList.remove('show-sidebar', 'show-inspector');
    renderDocList();
    renderView();
  }

  function itemSubtitle(c) {
    const actorOf = (ch) => catalogById(ch.links.playedBy);
    if (c.category === 'character') { const a = actorOf(c); return [c.fields.function, a ? 'played by ' + a.name : ''].filter(Boolean).join(' · '); }
    if (c.category === 'actor') {
      const roles = state.project.catalog.filter((x) => x.category === 'character' && x.links.playedBy === c.id).map((x) => x.name);
      return roles.length ? 'plays ' + roles.join(', ') : 'no role yet';
    }
    const users = SD.linkIds(c, 'usedBy').map(catalogById).filter(Boolean).map((x) => x.name);
    if (users.length) return users.join(', ');
    return (c.description || '').split('\n')[0];
  }

  function avatarNode(c, cls = 'avatar') {
    const cat = SD.categoryById(c.category);
    if (c.media && c.media[0]) return h('img', { class: cls, src: c.media[0].data, alt: '' });
    return h('span', { class: cls + ' initial', style: `--chip:${cat.color}` }, (c.name.trim()[0] || '?').toUpperCase());
  }

  function renderCatalog(root) {
    const p = state.project;
    const wrap = h('div', { class: 'catalog' });
    const listPane = h('div', { class: 'cat-list-pane' });
    const detailPane = h('div', { class: 'cat-detail-pane' });
    wrap.append(listPane, detailPane);
    root.append(wrap);
    if (state.catalogSel && !catalogById(state.catalogSel)) state.catalogSel = null;

    const renderList = () => {
      const q = (state.catalogSearch || '').trim().toLowerCase();
      const filter = state.catalogFilter;
      const counts = {};
      p.catalog.forEach((c) => { counts[c.category] = (counts[c.category] || 0) + 1; });
      const match = (c) => (filter === 'all' || c.category === filter) &&
        (!q || [c.name, c.description, c.tags, ...Object.values(c.fields)].join(' ').toLowerCase().includes(q));
      const groups = SD.CATEGORIES.map((cat) => ({ cat, items: p.catalog.filter((c) => c.category === cat.id && match(c)).sort((a, b) => a.name.localeCompare(b.name)) }))
        .filter((g) => g.items.length);

      const search = h('input', {
        class: 'input', type: 'search', placeholder: 'Search names, tags, notes…', value: state.catalogSearch || '',
        oninput: (e) => { state.catalogSearch = e.target.value; renderListBody(); },
      });
      const filterSel = h('select', { class: 'select', onchange: (e) => { state.catalogFilter = e.target.value; renderList(); } },
        h('option', { value: 'all' }, `All categories (${p.catalog.length})`),
        SD.CATEGORIES.map((c) => h('option', { value: c.id, selected: c.id === filter }, `${c.label}${counts[c.id] ? ' (' + counts[c.id] + ')' : ''}`)));
      const body = h('div', { class: 'cat-list' });
      const renderListBody = () => {
        const q2 = (state.catalogSearch || '').trim().toLowerCase();
        const m2 = (c) => (state.catalogFilter === 'all' || c.category === state.catalogFilter) &&
          (!q2 || [c.name, c.description, c.tags, ...Object.values(c.fields)].join(' ').toLowerCase().includes(q2));
        const gs = SD.CATEGORIES.map((cat) => ({ cat, items: p.catalog.filter((c) => c.category === cat.id && m2(c)).sort((a, b) => a.name.localeCompare(b.name)) })).filter((g) => g.items.length);
        body.replaceChildren(...(gs.length ? gs.map(({ cat, items }) => h('div', { class: 'cat-group' },
          h('div', { class: 'cat-group-head', style: `--chip:${cat.color}` }, h('span', { class: 'dot' }), cat.label, h('span', { class: 'count' }, items.length)),
          items.map((c) => h('button', {
            class: 'cat-row-item' + (c.id === state.catalogSel ? ' active' : ''), dataset: { id: c.id },
            onclick: () => { state.catalogSel = c.id; renderList(); renderDetail(); },
          }, avatarNode(c), h('span', { class: 'cat-row-text' }, h('span', { class: 'cat-row-name' }, c.name || h('em', {}, 'Unnamed')), h('span', { class: 'cat-row-sub' }, itemSubtitle(c))))))) : [
          h('div', { class: 'empty-state small' }, p.catalog.length ? 'Nothing matches.' : 'Your catalog is empty. Add characters, actors, locations and props — or import them from your scripts.'),
        ]));
      };
      void groups;
      renderListBody();
      listPane.replaceChildren(
        h('div', { class: 'cat-list-head' },
          h('div', { class: 'cat-list-title' }, h('h2', {}, 'Master Catalog'),
            h('button', { class: 'btn primary small', onclick: (e) => addMenu(e.currentTarget) }, '+ Add')),
          search, filterSel,
          h('button', { class: 'btn ghost small', onclick: scanScripts, title: 'Find character names and locations in your scripts' }, 'Import characters & locations from scripts')),
        body);
      renderList.body = renderListBody;
    };

    const addMenu = (anchor) => {
      const groupsOrder = [...new Set(SD.CATEGORIES.map((c) => c.group))];
      const items = [];
      groupsOrder.forEach((g, i) => {
        if (i) items.push('-');
        SD.CATEGORIES.filter((c) => c.group === g).forEach((c) => items.push({ label: c.one, run: () => addItem(c.id) }));
      });
      popupMenu(anchor, items);
    };
    const addItem = (category) => {
      const item = SD.newCatalogItem(category, '');
      p.catalog.push(item);
      state.catalogSel = item.id;
      if (state.catalogFilter !== 'all' && state.catalogFilter !== category) state.catalogFilter = category;
      markDirty();
      renderList();
      renderDetail();
      renderDocList();
      setTimeout(() => detailPane.querySelector('.item-name')?.focus(), 0);
    };

    const scanScripts = () => {
      let added = 0;
      for (const d of p.documents) {
        if (d.kind !== 'script') continue;
        for (const e of d.elements) {
          if (e.type === 'character') { const n = SD.charName(e.text); if (n && !SD.findCatalogItem(p, 'character', n)) { p.catalog.push(SD.newCatalogItem('character', n)); added++; } }
          if (e.type === 'scene' && d.scriptType !== 'comic') { const l = SD.parseSceneHeading(e.text).location; if (l && !SD.findCatalogItem(p, 'location', l)) { p.catalog.push(SD.newCatalogItem('location', l)); added++; } }
        }
      }
      if (added) markDirty();
      toast(added ? `Added ${added} new item${added > 1 ? 's' : ''} from your scripts.` : 'Everything in your scripts is already in the catalog.');
      renderList();
      renderDocList();
    };

    const renderDetail = () => {
      const c = catalogById(state.catalogSel);
      if (!c) {
        detailPane.replaceChildren(h('div', { class: 'empty-state' },
          h('div', { class: 'empty-icon' }, '🗂️'),
          h('p', {}, 'Pick an item on the left, or add a new one.'),
          h('p', { class: 'muted small' }, 'Tip: link a Character to an Actor with “Played by”, then print an Actor pack so the actor sees exactly who their character is.')));
        return;
      }
      detailPane.replaceChildren(itemDetail(c, {
        onRename: () => renderList.body(),
        onStructure: () => { renderList(); renderDetail(); renderDocList(); },
        onDelete: () => { state.catalogSel = null; renderList(); renderDetail(); renderDocList(); },
      }));
      detailPane.scrollTop = 0;
    };

    renderList();
    renderDetail();
  }

  function autoGrow(ta) {
    const fit = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, 600) + 'px'; };
    ta.addEventListener('input', fit);
    requestAnimationFrame(fit);
    return ta;
  }

  function itemDetail(c, cb) {
    const p = state.project;
    const cat = SD.categoryById(c.category);
    const changed = () => markDirty();

    // ----- one field -----
    const fieldNode = (f) => {
      const id = 'f-' + c.id + '-' + f.key;
      let control;
      if (f.type === 'link') control = linkControl(c, f, cb);
      else if (f.type === 'select') {
        control = h('select', { class: 'select', id, onchange: (e) => { if (e.target.value) c.fields[f.key] = e.target.value; else delete c.fields[f.key]; changed(); cb.onRename(); } },
          h('option', { value: '' }, '—'), f.options.map((o) => h('option', { value: o, selected: c.fields[f.key] === o }, o)));
        if (c.fields[f.key] && !f.options.includes(c.fields[f.key])) control.append(h('option', { value: c.fields[f.key], selected: true }, c.fields[f.key]));
      } else if (f.type === 'textarea') {
        control = autoGrow(h('textarea', { class: 'input', id, rows: 2, value: c.fields[f.key] || '', oninput: (e) => { c.fields[f.key] = e.target.value; changed(); } }));
      } else {
        control = h('input', { class: 'input', id, type: f.type === 'email' ? 'email' : 'text', value: c.fields[f.key] || '', oninput: (e) => { c.fields[f.key] = e.target.value; changed(); } });
      }
      const extra = [];
      if (f.map) extra.push(h('a', { class: 'small-link', href: '#', onclick: (e) => { e.preventDefault(); const a = (c.fields[f.key] || c.name).trim(); if (a) window.open('https://www.openstreetmap.org/search?query=' + encodeURIComponent(a), '_blank', 'noopener'); } }, 'Open in map ↗'));
      if (f.type === 'url' && c.fields[f.key]) extra.push(h('a', { class: 'small-link', href: /^https?:/i.test(c.fields[f.key]) ? c.fields[f.key] : 'https://' + c.fields[f.key], target: '_blank', rel: 'noopener' }, 'Open link ↗'));
      return h('div', { class: 'ffield' + (f.wide || f.type === 'link' && f.multi ? ' wide' : '') },
        h('label', { class: 'lbl', for: id }, f.label), control,
        f.help ? h('div', { class: 'help-text' }, f.help) : null, extra);
    };

    const filled = (sec) => sec.fields.filter((f) => (f.type === 'link' ? SD.linkIds(c, f.key).length : (c.fields[f.key] || '').trim())).length;
    const sections = SD.formFor(c.category).map((sec, i) => {
      const n = filled(sec);
      const det = h('details', { class: 'fsection', open: i === 0 || n > 0 || state.openSections?.has(c.category + sec.title) },
        h('summary', {}, sec.title, n ? h('span', { class: 'fcount' }, n + '/' + sec.fields.length) : null),
        h('div', { class: 'fgrid' }, sec.fields.map(fieldNode)));
      det.addEventListener('toggle', () => {
        state.openSections = state.openSections || new Set();
        if (det.open) state.openSections.add(c.category + sec.title); else state.openSections.delete(c.category + sec.title);
      });
      return det;
    });

    // ----- reverse links ("Plays", "Wardrobe", …) -----
    const inverse = SD.inverseLinksTo(c.category).map(({ sourceCategory, field }) => {
      const sources = p.catalog.filter((x) => x.category === sourceCategory);
      const linked = sources.filter((x) => SD.linkIds(x, field.key).includes(c.id));
      if (!linked.length && !['Plays', 'Wardrobe', 'Props'].includes(field.inverse)) return null;
      const srcCat = SD.categoryById(sourceCategory);
      const addSel = h('select', {
        class: 'select small',
        onchange: (e) => {
          const v = e.target.value;
          if (!v) return;
          let src = v === '__new' ? null : catalogById(v);
          if (!src) { src = SD.newCatalogItem(sourceCategory, ''); p.catalog.push(src); }
          if (field.multi) src.links[field.key] = [...new Set([...SD.linkIds(src, field.key), c.id])];
          else src.links[field.key] = c.id;
          changed();
          if (v === '__new') { state.catalogSel = src.id; }
          cb.onStructure();
        },
      }, h('option', { value: '' }, `+ ${field.multi ? 'Add' : 'Assign'} ${srcCat.one.toLowerCase()}…`),
      sources.filter((x) => !linked.includes(x)).map((x) => h('option', { value: x.id }, (x.name || 'Unnamed') + (!field.multi && x.links[field.key] ? ' (currently ' + (catalogById(x.links[field.key])?.name || '?') + ')' : ''))),
      h('option', { value: '__new' }, `New ${srcCat.one.toLowerCase()}…`));
      return h('div', { class: 'ffield wide' },
        h('label', { class: 'lbl' }, field.inverse),
        h('div', { class: 'link-list' },
          linked.map((x) => linkChip(x, () => {
            if (field.multi) x.links[field.key] = SD.linkIds(x, field.key).filter((id) => id !== c.id);
            else delete x.links[field.key];
            changed(); cb.onStructure();
          })),
          addSel));
    }).filter(Boolean);

    // ----- where it appears -----
    const usage = (SD.catalogUsage(p).get(c.id) || []);
    const byDoc = new Map();
    for (const u of usage) { if (!byDoc.has(u.doc)) byDoc.set(u.doc, []); byDoc.get(u.doc).push(u.scene); }
    let stats = null;
    if (c.category === 'character') {
      const n = c.name.trim().toUpperCase();
      let speeches = 0, words = 0;
      for (const d of p.documents) if (d.kind === 'script') { const s = characterStats(d).find((x) => x.name === n); if (s) { speeches += s.speeches; words += s.words; } }
      if (speeches) stats = `${speeches} speeches · ${words.toLocaleString()} words of dialogue`;
    }
    const appears = h('details', { class: 'fsection', open: true },
      h('summary', {}, 'Appears in', usage.length ? h('span', { class: 'fcount' }, usage.length + ' scene' + (usage.length > 1 ? 's' : '')) : null),
      h('div', { class: 'fbody' },
        stats ? h('p', { class: 'muted small' }, stats) : null,
        usage.length ? [...byDoc.entries()].map(([d, scenes]) => h('div', { class: 'appears' },
          h('div', { class: 'appears-doc' }, d.name),
          scenes.map((s) => h('button', { class: 'appears-scene', onclick: () => { state.docId = d.id; state.view = 'script'; renderDocList(); renderView(); requestAnimationFrame(() => editor.goTo(s.id)); } },
            h('span', { class: 'scene-num' }, s.number), (s.el.text || '').toUpperCase() || 'Untitled scene'))))
          : h('p', { class: 'muted small' }, c.category === 'character' ? 'Not in any scene yet. Scenes are found from the character name in your scripts.' : c.category === 'location' ? 'Not in any scene heading yet.' : 'Not tagged in any scene yet. Tag it from the scene panel next to the script.')));
    const notesAbout = p.documents.filter((x) => x.kind === 'note' && (x.about || []).includes(c.id));
    appears.querySelector('.fbody').append(h('div', { class: 'appears' },
      h('div', { class: 'appears-doc' }, 'Notes'),
      notesAbout.map((nd) => h('button', { class: 'appears-scene', onclick: () => selectDoc(nd.id) }, h('span', { class: 'scene-num' }, '📝'), nd.name)),
      h('button', { class: 'btn ghost small', onclick: () => newNoteAbout(c) }, '+ New note about ' + (c.name || 'this'))));

    // ----- photos & media -----
    const fileIn = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: async (e) => {
      const files = [...e.target.files];
      e.target.value = '';
      for (const f of files) {
        try { c.media.push({ id: SD.uid(), name: f.name, data: await SD.imageToDataUrl(f) }); } catch (err) { toast('Could not read ' + f.name); }
      }
      changed(); cb.onStructure();
    } });
    const media = h('details', { class: 'fsection', open: true },
      h('summary', {}, 'Photos & media', c.media.length ? h('span', { class: 'fcount' }, c.media.length) : null),
      h('div', { class: 'fbody' },
        h('div', { class: 'gallery' },
          c.media.map((m, i) => h('div', { class: 'thumb' },
            h('img', { src: m.data, alt: m.name || '', onclick: () => modal({ title: m.name || c.name, wide: true, body: h('img', { class: 'big-img', src: m.data, alt: '' }), buttons: [{ label: 'Close', value: true, primary: true }] }) }),
            h('div', { class: 'thumb-actions' },
              i ? h('button', { class: 'icon-btn', title: 'Make main photo', 'aria-label': 'Make main photo', onclick: () => { c.media.splice(i, 1); c.media.unshift(m); changed(); cb.onStructure(); } }, '★') : h('span', { class: 'thumb-main' }, 'Main'),
              h('button', { class: 'icon-btn', title: 'Remove photo', 'aria-label': 'Remove photo', onclick: () => { c.media.splice(i, 1); changed(); cb.onStructure(); } }, '×')))),
          h('button', { class: 'thumb add', onclick: () => fileIn.click() }, '+ Add photo')),
        fileIn,
        h('p', { class: 'muted small' }, 'Photos are shrunk and stored inside the project file.')));

    // ----- custom fields -----
    const customList = h('div', { class: 'fgrid' });
    const renderCustom = () => customList.replaceChildren(...c.custom.map((cf, i) => h('div', { class: 'ffield wide custom-field' },
      h('div', { class: 'custom-head' },
        h('input', { class: 'lbl-input', value: cf.label, placeholder: 'Field name', oninput: (e) => { cf.label = e.target.value; changed(); } }),
        h('button', { class: 'icon-btn', title: 'Remove field', 'aria-label': 'Remove field', onclick: () => { c.custom.splice(i, 1); changed(); renderCustom(); } }, '×')),
      autoGrow(h('textarea', { class: 'input', rows: 1, value: cf.value, oninput: (e) => { cf.value = e.target.value; changed(); } })))));
    renderCustom();
    const custom = h('details', { class: 'fsection', open: c.custom.length > 0 },
      h('summary', {}, 'Your own fields', c.custom.length ? h('span', { class: 'fcount' }, c.custom.length) : null),
      h('div', { class: 'fbody' }, customList,
        h('button', { class: 'btn ghost small', onclick: () => { c.custom.push({ label: '', value: '' }); changed(); renderCustom(); customList.querySelector('.custom-field:last-child .lbl-input')?.focus(); } }, '+ Add a field')));

    // ----- header -----
    const avatar = h('button', { class: 'item-avatar', title: c.media.length ? 'Photos' : 'Add a photo', onclick: () => fileIn.click() }, avatarNode(c, 'avatar big'));
    const catSel = h('select', { class: 'select small', title: 'Category', onchange: (e) => { c.category = e.target.value; changed(); cb.onStructure(); } },
      SD.CATEGORIES.map((k) => h('option', { value: k.id, selected: k.id === c.category }, k.one)));
    const actions = [];
    if (c.category === 'character') actions.push(h('button', { class: 'btn small', onclick: () => printSheets('character', c) }, '🖨 Character sheet'));
    if (c.category === 'actor') actions.push(h('button', { class: 'btn small', onclick: () => printSheets('actor', c) }, '🖨 Actor pack'));
    actions.push(h('button', {
      class: 'btn ghost small danger', onclick: async () => {
        const ok = await modal({ title: 'Delete “' + (c.name || 'item') + '”?', body: 'It is also removed from scene breakdowns and from any links to other items.', buttons: [{ label: 'Cancel', value: false }, { label: 'Delete', value: true, primary: true, danger: true }] });
        if (!ok) return;
        p.catalog.splice(p.catalog.indexOf(c), 1);
        SD.unlinkEverywhere(p, c.id);
        changed(); cb.onDelete();
      },
    }, 'Delete'));

    return h('div', { class: 'item-detail', style: `--chip:${cat.color}` },
      h('div', { class: 'item-head' },
        avatar,
        h('div', { class: 'item-head-main' },
          h('div', { class: 'item-kicker' }, h('span', { class: 'dot' }), catSel),
          h('input', { class: 'item-name', value: c.name, placeholder: cat.one + ' name', oninput: (e) => { c.name = e.target.value; changed(); cb.onRename(); } }),
          h('div', { class: 'item-actions' }, actions))),
      h('div', { class: 'fsection plain' },
        h('label', { class: 'lbl' }, 'Description'),
        autoGrow(h('textarea', { class: 'input', rows: 3, placeholder: c.category === 'character' ? 'Who is this person, in a few lines?' : 'Description…', value: c.description, oninput: (e) => { c.description = e.target.value; changed(); } })),
        h('label', { class: 'lbl' }, 'Tags'),
        h('input', { class: 'input', placeholder: 'Searchable keywords', value: c.tags, oninput: (e) => { c.tags = e.target.value; changed(); } })),
      inverse.length ? h('details', { class: 'fsection', open: true }, h('summary', {}, 'Linked'), h('div', { class: 'fgrid' }, inverse)) : null,
      sections,
      appears,
      everywhereSection(c),
      media,
      custom);
  }

  function linkChip(x, onRemove) {
    const cat = SD.categoryById(x.category);
    return h('span', { class: 'chip link-chip', style: `--chip:${cat.color}` },
      h('button', { class: 'chip-name', title: 'Open', onclick: () => openCatalogItem(x.id) }, avatarNode(x, 'avatar tiny'), x.name || 'Unnamed'),
      onRemove ? h('button', { class: 'chip-x', title: 'Remove link', 'aria-label': 'Remove link to ' + x.name, onclick: onRemove }, '×') : null);
  }

  // A "link" field: pick one (or several) items of the target category.
  function linkControl(c, f, cb) {
    const p = state.project;
    const target = SD.categoryById(f.target);
    const ids = SD.linkIds(c, f.key);
    const linked = ids.map(catalogById).filter(Boolean);
    const sel = h('select', {
      class: 'select small',
      onchange: (e) => {
        const v = e.target.value;
        if (!v) return;
        let t = v === '__new' ? null : catalogById(v);
        if (!t) { t = SD.newCatalogItem(f.target, ''); p.catalog.push(t); }
        if (f.multi) c.links[f.key] = [...new Set([...ids, t.id])];
        else c.links[f.key] = t.id;
        markDirty();
        if (v === '__new') state.catalogSel = t.id;
        cb.onStructure();
      },
    }, h('option', { value: '' }, linked.length && !f.multi ? 'Change…' : `+ Choose ${target.one.toLowerCase()}…`),
    p.catalog.filter((x) => x.category === f.target && !ids.includes(x.id)).sort((a, b) => a.name.localeCompare(b.name)).map((x) => h('option', { value: x.id }, x.name || 'Unnamed')),
    h('option', { value: '__new' }, `New ${target.one.toLowerCase()}…`));
    return h('div', { class: 'link-list' },
      linked.map((x) => linkChip(x, () => {
        if (f.multi) c.links[f.key] = ids.filter((id) => id !== x.id);
        else delete c.links[f.key];
        markDirty(); cb.onStructure();
      })),
      sel);
  }

  // ---------- Character sheets & actor packs (printable) ----------
  function sheetFields(c) {
    const out = [];
    for (const sec of SD.formFor(c.category)) {
      const rows = [];
      for (const f of sec.fields) {
        if (f.type === 'link') {
          const names = SD.linkIds(c, f.key).map(catalogById).filter(Boolean).map((x) => x.name);
          if (names.length) rows.push([f.label, names.join(', ')]);
        } else if ((c.fields[f.key] || '').trim()) rows.push([f.label, c.fields[f.key]]);
      }
      if (rows.length) out.push([sec.title, rows]);
    }
    const custom = c.custom.filter((x) => (x.value || '').trim()).map((x) => [x.label || 'Note', x.value]);
    if (custom.length) out.push(['More', custom]);
    return out;
  }

  function characterScenes(name) {
    const n = name.trim().toUpperCase();
    const res = [];
    for (const d of state.project.documents) {
      if (d.kind !== 'script') continue;
      for (const s of SD.getScenes(d)) if (SD.sceneCharacters(d, s).includes(n)) res.push({ doc: d, scene: s });
    }
    return res;
  }

  function sheetNode(c, opts) {
    const p = state.project;
    const cat = SD.categoryById(c.category);
    const kv = (rows) => h('dl', { class: 'sheet-kv' }, rows.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
    const parts = [];
    const sub = [];
    if (c.category === 'character') {
      if (c.fields.fullName) sub.push(c.fields.fullName);
      const actor = catalogById(c.links.playedBy);
      if (actor) sub.push('played by ' + actor.name);
    }
    parts.push(h('header', { class: 'sheet-head' },
      c.media[0] ? h('img', { class: 'sheet-photo', src: c.media[0].data, alt: '' }) : null,
      h('div', {},
        h('div', { class: 'sheet-kicker' }, cat.one + ' · ' + (p.title || '')),
        h('h1', {}, c.name || 'Unnamed'),
        sub.length ? h('div', { class: 'sheet-sub' }, sub.join(' — ')) : null)));
    if (c.description) parts.push(h('p', { class: 'sheet-desc' }, c.description));
    for (const [title, rows] of sheetFields(c)) {
      if (opts.private === false && /contact|wardrobe sizes|availability/i.test(title)) continue;
      parts.push(h('section', { class: 'sheet-sec' }, h('h2', {}, title), kv(rows)));
    }
    if (c.category === 'character' && opts.scenes) {
      const sc = characterScenes(c.name);
      if (sc.length) {
        parts.push(h('section', { class: 'sheet-sec' }, h('h2', {}, `Scenes (${sc.length})`),
          h('table', { class: 'sheet-scenes' }, sc.map(({ doc, scene }) => h('tr', {},
            h('td', {}, scene.number), h('td', { class: 'mono' }, (scene.el.text || '').toUpperCase()), h('td', {}, SD.eighths(scene.lines) + ' pg'),
            h('td', {}, scene.el.synopsis || ''), p.documents.filter((x) => x.kind === 'script').length > 1 ? h('td', { class: 'muted' }, doc.name) : null)))));
      }
      const wardrobe = p.catalog.filter((x) => x.category !== 'character' && SD.linkIds(x, 'usedBy').includes(c.id));
      if (wardrobe.length) {
        parts.push(h('section', { class: 'sheet-sec' }, h('h2', {}, 'Wardrobe, props & more'),
          kv(wardrobe.map((x) => [SD.categoryById(x.category).one, x.name + (x.description ? ' — ' + x.description : '')]))));
      }
    }
    return h('article', { class: 'sheet' }, parts);
  }

  function sidesNode(c) {
    const n = c.name.trim().toUpperCase();
    const out = [];
    for (const { doc, scene } of characterScenes(c.name)) {
      const body = h('div', { class: scriptTextClasses() });
      body.dataset.scriptType = doc.scriptType;
      let mine = false;
      for (let i = scene.start; i < scene.end; i++) {
        const e = doc.elements[i];
        if (e.type === 'character') mine = SD.charName(e.text) === n;
        else if (!['dialogue', 'parenthetical'].includes(e.type)) mine = false;
        const div = h('div', { class: 'el' + (mine ? ' mine' : '') + (e.text ? '' : ' is-empty') }, e.text || ' ');
        div.dataset.type = e.type;
        body.append(div);
      }
      out.push(h('section', { class: 'sides' }, h('div', { class: 'sides-label' }, `${doc.name} — scene ${scene.number}`), body));
    }
    return out;
  }

  async function printSheets(kind, item) {
    syncEditor();
    const chars = kind === 'actor'
      ? state.project.catalog.filter((x) => x.category === 'character' && x.links.playedBy === item.id)
      : [item];
    const cScenes = h('input', { type: 'checkbox', checked: true });
    const cSides = h('input', { type: 'checkbox', checked: kind === 'actor' });
    const cPrivate = h('input', { type: 'checkbox', checked: false });
    const body = h('div', {},
      h('p', {}, kind === 'actor'
        ? (chars.length ? `A pack for ${item.name || 'this actor'} with the profile of ${chars.map((x) => x.name).join(', ')}.` : 'This actor has no role yet. Link a character with “Played by” first — the pack will only contain the actor page.')
        : `A printable profile of ${item.name || 'this character'}.`),
      h('label', { class: 'check' }, cScenes, ' List the scenes the character is in'),
      h('label', { class: 'check' }, cSides, ' Include sides — the full text of those scenes, with the character\'s lines marked'),
      kind === 'actor' ? h('label', { class: 'check' }, cPrivate, ' Include the actor\'s own contact, sizes and availability') : null);
    const ok = await modal({ title: kind === 'actor' ? 'Print actor pack' : 'Print character sheet', body, buttons: [{ label: 'Cancel', value: false }, { label: 'Print / PDF', value: true, primary: true }] });
    if (!ok) return;
    const root = $('#print-root');
    root.className = 'print-sheets';
    root.replaceChildren();
    if (kind === 'actor') root.append(sheetNode(item, { private: cPrivate.checked }));
    for (const ch of chars) {
      root.append(sheetNode(ch, { scenes: cScenes.checked }));
      if (cSides.checked) {
        const sides = sidesNode(ch);
        if (sides.length) root.append(h('div', { class: 'sides-wrap' }, h('h2', { class: 'sides-title' }, 'Sides — ' + ch.name), sides));
      }
    }
    document.title = safeName((item.name || 'Sheet') + (kind === 'actor' ? ' - actor pack' : ' - character sheet'));
    window.print();
  }

  // =====================================================================
  // status bar
  // =====================================================================
  function renderStatus() {
    const bar = $('#status-left');
    const d = currentDoc();
    if (isHome()) { bar.textContent = `${state.project.documents.length} documents  ·  ${state.project.catalog.length} catalog items  ·  Ctrl+Shift+F searches everything`; return; }
    if (!d || isCatalog()) { bar.textContent = isCatalog() ? `${state.project.catalog.length} catalog items` : ''; return; }
    if (d.kind === 'note') { bar.textContent = `Notes · ${((d.text || '').match(/\S+/g) || []).length.toLocaleString()} words`; return; }
    if (d.kind === 'storyline') {
      const evs = d.beats.reduce((n, b) => n + b.events.length, 0);
      bar.textContent = `Storyline  ·  ${d.rows.length} characters  ·  ${d.beats.length} moments  ·  ${evs} events`;
      return;
    }
    if (SD.KINDS[d.kind]) { bar.textContent = SD.KINDS[d.kind].status ? SD.KINDS[d.kind].status(d) : SD.KINDS[d.kind].label; return; }
    if (d.kind === 'storyboard') {
      const st = SD.storyboardStats(d);
      bar.textContent = `Storyboard  ·  ${st.sequences} sequences  ·  ${st.shots} shots  ·  ${st.pictures} with pictures` + (st.seconds ? `  ·  running time ${SD.formatSeconds(st.seconds)}` : '');
      return;
    }
    const est = SD.estimate(d);
    const scenes = d.elements.filter((e) => e.type === SD.SCRIPT_TYPES[d.scriptType].sceneType).length;
    const parts = [SD.SCRIPT_TYPES[d.scriptType].label];
    if (state.view === 'script') {
      const cur = editor.curBlock;
      if (cur) parts.push(SD.labelFor(d.scriptType, cur.dataset.type));
      const line = est.lineAt[Math.min(state.caretIndex, est.lineAt.length - 1)] || 0;
      parts.push(`Page ${SD.pageOfLine(line)} of ~${est.pages}`);
    } else parts.push(`~${est.pages} pages`);
    parts.push(`${scenes} ${d.scriptType === 'comic' ? 'pages' : 'scenes'}`, `${SD.wordCount(d).toLocaleString()} words`);
    bar.textContent = parts.join('  ·  ');
  }

  // =====================================================================
  // files
  // =====================================================================
  const safeName = (s) => String(s || 'Untitled').replace(/[\\/:*?"<>|]+/g, '').trim() || 'Untitled';

  function download(name, data, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function writeHandle(handle, data) {
    const w = await handle.createWritable();
    await w.write(data);
    await w.close();
  }

  async function saveProject(saveAs = false) {
    syncEditor();
    state.project.modified = new Date().toISOString();
    const data = JSON.stringify(state.project, null, 1);
    const suggested = state.fileName && /\.(scriptdesk|json)$/i.test(state.fileName) ? state.fileName : safeName(state.project.title) + SD.FILE_EXT;
    try {
      if (!saveAs && state.fileHandle) {
        await writeHandle(state.fileHandle, data);
      } else if (window.showSaveFilePicker) {
        const hnd = await window.showSaveFilePicker({ suggestedName: suggested, types: [{ description: 'Scriptdesk project', accept: { 'application/json': [SD.FILE_EXT, '.json'] } }] });
        await writeHandle(hnd, data);
        state.fileHandle = hnd;
        state.fileName = hnd.name;
      } else {
        download(suggested, data, 'application/json');
        state.fileName = suggested;
      }
      state.dirty = false;
      renderSaveState();
      autosave();
      toast('Saved ' + state.fileName);
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      console.error(e);
      // e.g. picker blocked — fall back to a plain download
      download(suggested, data, 'application/json');
      state.fileName = suggested;
      state.dirty = false;
      renderSaveState();
      autosave();
    }
  }

  async function confirmDiscard(what) {
    if (!state.dirty) return true;
    const v = await modal({
      title: 'Save changes first?',
      body: `“${state.project.title}” has changes that aren't saved to a project file. ${what}`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'Discard changes', value: 'discard', danger: true }, { label: 'Save first', value: 'save', primary: true }],
    });
    if (!v) return false;
    if (v === 'save') { await saveProject(); return !state.dirty; }
    return true;
  }

  async function newProject() {
    if (!(await confirmDiscard('Start a new project anyway?'))) return;
    setProject(SD.newProject());
    toast('New project created.');
  }

  const OPEN_EXTS = ['.scriptdesk', '.json', '.celtx', '.fountain', '.spmd', '.txt', '.fdx'];

  async function openDialog() {
    if (window.showOpenFilePicker) {
      try {
        const [hnd] = await window.showOpenFilePicker({
          types: [{ description: 'Projects & scripts', accept: { 'application/octet-stream': OPEN_EXTS } }],
        });
        await openFile(await hnd.getFile(), hnd);
      } catch (e) {
        if (e && e.name === 'AbortError') return;
        if (e && e.name === 'SecurityError') { $('#file-input').click(); return; }
        console.error(e);
        toast('Could not open: ' + e.message);
      }
    } else {
      $('#file-input').click();
    }
  }

  async function openFile(file, handle) {
    const name = file.name;
    const ext = (name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    const base = name.replace(/\.[^.]+$/, '');
    try {
      if (ext === '.celtx') {
        toast('Reading Celtx project…');
        const res = await SD.Celtx.import(file);
        await importDocs(res.documents, res.title, res.catalog);
      } else if (['.fountain', '.spmd', '.txt'].includes(ext)) {
        const parsed = SD.Fountain.parse(await file.text());
        const d = SD.newScript(parsed.elements.some((e) => e.type === 'act') ? 'teleplay' : 'screenplay', base);
        d.elements = parsed.elements;
        Object.assign(d.titlePage, parsed.titlePage);
        await importDocs([d], parsed.titlePage.title || base);
      } else if (ext === '.fdx') {
        const parsed = SD.FDX.parse(await file.text());
        const d = SD.newScript(parsed.elements.some((e) => e.type === 'act') ? 'teleplay' : 'screenplay', base);
        d.elements = parsed.elements;
        Object.assign(d.titlePage, parsed.titlePage);
        await importDocs([d], parsed.titlePage.title || base);
      } else {
        let data;
        try { data = JSON.parse(await file.text()); } catch (e) { throw new Error('This file is not a Scriptdesk project.'); }
        if (data && data.app === 'scriptdesk-review-comments') { await importReview(data, name); return; }
        const p = SD.migrate(data);
        if (!(await confirmDiscard('Open “' + name + '” anyway?'))) return;
        setProject(p, { fileHandle: handle || null, fileName: name });
        toast('Opened ' + name);
      }
    } catch (e) {
      console.error(e);
      modal({ title: 'Could not open file', body: e.message || String(e) });
    }
  }

  function projectHasContent() {
    const p = state.project;
    return p.catalog.length > 0 || p.documents.some((d) => (d.kind === 'note' ? d.text.trim() : d.kind === 'storyline' ? d.beats.length : d.kind === 'storyboard' ? d.sequences.length : SD.KINDS[d.kind] ? SD.KINDS[d.kind].hasContent(d) : d.elements.some((e) => e.text.trim())));
  }

  async function importDocs(docs, title, catalog = []) {
    let mode = 'new';
    if (projectHasContent()) {
      mode = await modal({
        title: 'Import ' + (docs.length !== 1 ? docs.length + ' documents' : '“' + docs[0].name + '”') + (catalog.length ? ' and ' + catalog.length + ' catalog items' : ''),
        body: 'Add to the project you have open, or start a new project with it?',
        buttons: [{ label: 'Cancel', value: null }, { label: 'New project', value: 'new' }, { label: 'Add to this project', value: 'add', primary: true }],
      });
      if (!mode) return;
    }
    if (mode === 'new') {
      if (projectHasContent() && !(await confirmDiscard('Start a new project anyway?'))) return;
      const p = SD.newProject();
      p.title = title || 'Imported Project';
      p.documents = docs.length ? docs : p.documents;
      p.catalog = catalog;
      setProject(p);
      state.dirty = true;
      renderSaveState();
      autosave();
    } else {
      state.project.documents.push(...docs);
      // merge catalog: reuse an existing item with the same category and name
      const remap = new Map();
      for (const c of catalog) {
        const same = SD.findCatalogItem(state.project, c.category, c.name);
        if (same) remap.set(c.id, same.id); else state.project.catalog.push(c);
      }
      if (remap.size) {
        const fix = (id) => remap.get(id) || id;
        for (const c of catalog) for (const k of Object.keys(c.links)) c.links[k] = Array.isArray(c.links[k]) ? c.links[k].map(fix) : fix(c.links[k]);
        for (const d of docs) if (d.elements) for (const e of d.elements) if (e.items) e.items = e.items.map(fix);
      }
      markDirty();
      if (docs.length) selectDoc(docs[0].id); else selectDoc('__catalog');
    }
    toast(`Imported ${docs.length} document${docs.length !== 1 ? 's' : ''}` + (catalog.length ? ` and ${catalog.length} catalog items.` : '.'));
  }

  function scriptForExport() {
    const d = currentDoc();
    if (d && d.kind === 'script') return d;
    const s = state.project.documents.find((x) => x.kind === 'script');
    if (!s) toast('There is no script in this project to export.');
    return s;
  }

  function exportAs(kind) {
    syncEditor();
    const d = scriptForExport();
    if (!d) return;
    const name = safeName(d.titlePage.title || d.name);
    if (kind === 'fountain') download(name + '.fountain', SD.Fountain.export(d), 'text/plain;charset=utf-8');
    if (kind === 'fdx') download(name + '.fdx', SD.FDX.export(d), 'application/xml');
    if (kind === 'txt') download(name + '.txt', SD.toPlainText(d), 'text/plain;charset=utf-8');
  }

  // ---------- printing ----------
  function printScript() {
    syncEditor();
    const cur = currentDoc();
    if (cur && cur.kind === 'storyboard') { printStoryboard(cur); return; }
    if (cur && cur.kind === 'storyline') { printStoryline(cur); return; }
    if (cur && SD.KINDS[cur.kind]) { if (SD.KINDS[cur.kind].print) SD.KINDS[cur.kind].print(cur); else toast('This document has nothing to print.'); return; }
    if (cur && cur.kind === 'note') { printNote(cur); return; }
    const d = scriptForExport();
    if (!d) return;
    const root = $('#print-root');
    root.className = 'print-script';
    root.replaceChildren();
    const tp = d.titlePage;
    if (tp.enabled !== false && (tp.title || tp.author)) root.append(titlePageNode(tp));
    const body = h('div', { class: scriptTextClasses() });
    body.dataset.scriptType = d.scriptType;
    const elNode = (e) => {
      const div = h('div', { class: 'el' + (e.text ? '' : ' is-empty') + (e.type === 'act' && !/^\s*END OF/i.test(e.text) ? ' act-start' : '') });
      if (e.text) SD.fillFormatted(div, e.text, e.fmt); else div.textContent = ' ';
      div.dataset.type = e.type;
      return div;
    };
    for (const g of SD.dualGroups(d.elements)) {
      if (g.pair) body.append(h('div', { class: 'dual-pair' }, g.pair.map((col) => h('div', { class: 'dual-col' }, col.map(elNode)))));
      else body.append(elNode(g));
    }
    root.append(body);
    document.title = safeName(tp.title || d.name);
    window.print();
  }

  function printReport(d) {
    const root = $('#print-root');
    root.className = 'print-report';
    root.replaceChildren(h('h1', {}, `${d.titlePage.title || d.name} — ${({ scenes: 'Scene report', characters: 'Character report', locations: 'Location report', breakdown: 'Breakdown sheets' })[state.reportTab]}`), buildReport(d, state.reportTab));
    window.print();
  }

  window.addEventListener('afterprint', () => {
    $('#print-root').replaceChildren();
    document.title = state.project.title + ' — Scriptdesk';
  });

  // =====================================================================
  // settings, theme, zoom
  // =====================================================================
  function scriptTextClasses() {
    const s = state.project.settings;
    return 'script-text' + (s.sceneNumbers ? ' scene-numbers' : '') + (s.boldScenes ? ' bold-scenes' : '');
  }

  function applyProjectSettings() {
    const s = state.project.settings;
    const ed = $('#editor');
    ed.classList.toggle('scene-numbers', !!s.sceneNumbers);
    ed.classList.toggle('bold-scenes', !!s.boldScenes);
    $('#page-size-style').textContent = `@page { size: ${s.pageSize === 'a4' ? 'A4' : 'letter'}; }`;
    document.body.dataset.pageSize = s.pageSize;
  }

  function applyTheme(v) {
    if (v === 'light' || v === 'dark') document.documentElement.dataset.theme = v;
    else delete document.documentElement.dataset.theme;
    state.theme = v;
  }

  function applyZoom(z) {
    state.zoom = z;
    document.documentElement.style.setProperty('--zoom', z / 100);
    store.set(KEYS.zoom, String(z));
    editor && editor.closeAC();
  }

  function openSettings() {
    const s = state.project.settings;
    const radio = (name, value, label, checked, on) => h('label', { class: 'radio' }, h('input', { type: 'radio', name, value, checked, onchange: on }), label);
    const body = h('div', { class: 'settings' },
      h('h3', {}, 'Appearance (this browser)'),
      h('div', { class: 'radio-row' },
        ['system', 'light', 'dark'].map((t) => radio('theme', t, t[0].toUpperCase() + t.slice(1), state.theme === t, () => { applyTheme(t); store.set(KEYS.theme, t); }))),
      h('h3', {}, 'Page (saved in project)'),
      h('div', { class: 'radio-row' },
        radio('page', 'letter', 'US Letter', s.pageSize !== 'a4', () => { s.pageSize = 'letter'; applyProjectSettings(); markDirty(); }),
        radio('page', 'a4', 'A4', s.pageSize === 'a4', () => { s.pageSize = 'a4'; applyProjectSettings(); markDirty(); })),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.sceneNumbers, onchange: (e) => { s.sceneNumbers = e.target.checked; applyProjectSettings(); renderToolbar(); markDirty(); } }), ' Show scene numbers'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.boldScenes, onchange: (e) => { s.boldScenes = e.target.checked; applyProjectSettings(); markDirty(); } }), ' Bold scene headings'),
      h('h3', {}, 'Browser copy'),
      h('p', { class: 'muted small' }, 'Your open project is also kept in this browser so a refresh does not lose work. That copy is not a backup — save the project file.'),
      h('button', {
        class: 'btn danger small',
        onclick: () => { store.del(KEYS.autosave); idb.del(KEYS.autosave).catch(() => {}); toast('Browser copy cleared. It will be saved again on your next change.'); },
      }, 'Clear browser copy'));
    modal({ title: 'Settings', body, buttons: [{ label: 'Done', value: true, primary: true }] });
  }

  function openHelp() {
    const row = (k, v) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, v));
    modal({
      title: 'How it works',
      wide: true,
      body: h('div', { class: 'help' },
        h('p', {}, 'Scriptdesk keeps everything in one project file. Nothing is uploaded anywhere: use ', h('strong', {}, 'Open'), ' to load a file from your computer and ', h('strong', {}, 'Save'), ' to write it back. Your current work is also kept in this browser between visits.'),
        h('h3', {}, 'Writing'),
        h('table', { class: 'keys-table' },
          row('Enter', 'New element (Scene → Action, Character → Dialogue, Dialogue → Character…)'),
          row('Enter on empty line', 'Switch to Action; on an empty Action, switch to Scene Heading'),
          row('Tab', 'Change the element type (Action → Character → Transition…)'),
          row('Shift+Tab', 'Cycle backwards through element types'),
          row('Ctrl+1 … 8', 'Pick an element type directly'),
          row('Shift+Enter', 'New element of the same type'),
          row('↑ ↓ then Enter/Tab', 'Pick an autocomplete suggestion (names, locations, times, transitions)'),
          row('Ctrl+Z / Ctrl+Y', 'Undo / redo'),
          row('Ctrl+S', 'Save project file'),
          row('Ctrl+O', 'Open a project or import a script'),
          row('Ctrl+F', 'Find in the script (Ctrl+H: find & replace)'),
          row('Ctrl+Alt+M', 'Comment on the selected words'),
          row('Ctrl+D', 'Dual dialogue for the speech the cursor is in'),
          row('Ctrl+Shift+F', 'Search the whole project'),
          row('Ctrl+click', 'On a character name or scene heading: open its catalog page'),
          row('Ctrl+P', 'Print / save as PDF')),
        h('h3', {}, 'Shortcuts while typing'),
        h('ul', {},
          h('li', {}, 'Typing ', h('code', {}, 'int. '), ' or ', h('code', {}, 'ext. '), ' in an Action line turns it into a Scene Heading.'),
          h('li', {}, 'Typing ', h('code', {}, '('), ' at the start of Dialogue turns it into a Parenthetical.'),
          h('li', {}, 'Typing ', h('code', {}, '('), ' after a character name suggests (V.O.), (O.S.), (CONT\'D).')),
        h('h3', {}, 'Files'),
        h('ul', {},
          h('li', {}, h('strong', {}, '.scriptdesk'), ' — the project file (all scripts, notes, catalog).'),
          h('li', {}, h('strong', {}, '.celtx'), ' — old Celtx desktop projects can be imported.'),
          h('li', {}, h('strong', {}, '.fountain / .fdx / .txt'), ' — import and export to Fountain, Final Draft and plain text.'),
          h('li', {}, 'Print / PDF uses your browser\'s print dialog: choose “Save as PDF”. Turn off “Headers and footers” in that dialog for a clean page.'))),
      buttons: [{ label: 'Got it', value: true, primary: true }],
    });
  }

  // =====================================================================
  // modal, prompt, popup menus, toast
  // =====================================================================
  function modal({ title, body, buttons = [{ label: 'OK', value: true, primary: true }], wide }) {
    return new Promise((resolve) => {
      const prevFocus = document.activeElement;
      const close = (v) => {
        wrap.remove();
        document.removeEventListener('keydown', onKey, true);
        if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true });
        resolve(v);
      };
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); } };
      const wrap = h('div', { class: 'modal-backdrop', onmousedown: (e) => { if (e.target === wrap) close(null); } },
        h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
          h('h2', {}, title),
          h('div', { class: 'modal-body' }, typeof body === 'string' ? h('p', {}, body) : body),
          h('div', { class: 'modal-actions' }, buttons.map((b) => h('button', {
            class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''),
            onclick: () => close(typeof b.value === 'function' ? b.value() : b.value),
          }, b.label)))));
      $('#modal-root').append(wrap);
      document.addEventListener('keydown', onKey, true);
      setTimeout(() => {
        const inp = wrap.querySelector('.modal-body input:not([type=checkbox]):not([type=radio]), .modal-body select');
        if (inp) { inp.focus(); inp.select && inp.select(); } else wrap.querySelector('.btn.primary')?.focus();
      }, 0);
    });
  }

  function promptText(title, value) {
    const inp = h('input', { class: 'input', value: value || '' });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.closest('.modal').querySelector('.btn.primary').click(); } });
    return modal({ title, body: inp, buttons: [{ label: 'Cancel', value: null }, { label: 'OK', value: () => inp.value, primary: true }] });
  }

  function popupMenu(anchor, items) {
    closeMenus();
    const menu = h('div', { class: 'dropdown-menu floating open', role: 'menu' }, items.filter(Boolean).map((it) => it === '-'
      ? h('div', { class: 'menu-sep' })
      : h('button', { class: 'menu-item' + (it.danger ? ' danger' : ''), role: 'menuitem', onclick: () => { menu.remove(); it.run(); } }, it.label)));
    // Open after the current click has finished bubbling, so the global
    // "click outside closes menus" handler doesn't close it straight away.
    setTimeout(() => {
      document.body.append(menu);
      const r = anchor.getBoundingClientRect();
      menu.style.top = Math.max(8, Math.min(r.bottom + 4, window.innerHeight - menu.offsetHeight - 8)) + 'px';
      menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)) + 'px';
      menu.style.maxHeight = (window.innerHeight - 16) + 'px';
      menu.style.overflowY = 'auto';
    }, 0);
  }

  function closeMenus() {
    document.querySelectorAll('.dropdown-menu.floating').forEach((m) => m.remove());
    document.querySelectorAll('.dropdown.open').forEach((d) => d.classList.remove('open'));
  }

  function toast(msg) {
    const t = h('div', { class: 'toast', role: 'status' }, msg);
    $('#toasts').append(t);
    setTimeout(() => t.classList.add('out'), 3200);
    setTimeout(() => t.remove(), 3700);
  }

  // =====================================================================
  // wiring
  // =====================================================================
  function bindChrome() {
    const actions = {
      new: newProject,
      open: openDialog,
      save: () => saveProject(false),
      saveas: () => saveProject(true),
      print: printScript,
      'export-fountain': () => exportAs('fountain'),
      'export-fdx': () => exportAs('fdx'),
      'export-txt': () => exportAs('txt'),
      settings: openSettings,
      help: openHelp,
      goals: openGoals,
      search: () => openSearch(),
      'review-copy': makeReviewCopy,
      'add-folder': () => addFolder(),
      example: (a) => openExample(a.dataset.file, a.dataset.name),
      install: () => installApp(),
      'add-screenplay': () => addDoc('screenplay'),
      'add-stageplay': () => addDoc('stageplay'),
      'add-audioplay': () => addDoc('audioplay'),
      'add-comic': () => addDoc('comic'),
      'add-av': () => addDoc('av'),
      'add-teleplay': () => addDoc('teleplay'),
      'add-sitcom': () => addDoc('sitcom'),
      'add-note': () => addDoc('note'),
      'add-storyline': () => addDoc('storyline'),
      'add-storyboard': () => addDoc('storyboard'),
      ...Object.fromEntries(Object.keys(SD.KINDS).map((k) => ['add-' + k, () => addDoc(k)])),
      'toggle-sidebar': () => document.body.classList.toggle('show-sidebar'),
    };
    document.addEventListener('click', (e) => {
      const a = e.target.closest('[data-action]');
      if (a) {
        closeMenus();
        const run = actions[a.dataset.action];
        if (run) run(a);
        else {
          // Happens when the browser mixes a new page with old cached scripts.
          console.warn('Scriptdesk: no handler for action', a.dataset.action);
          toast('This button needs the latest version of Scriptdesk — press Ctrl+F5 to reload.');
        }
        return;
      }
      const dd = e.target.closest('[data-dropdown]');
      if (dd) {
        const wrap = dd.closest('.dropdown');
        const was = wrap.classList.contains('open');
        closeMenus();
        if (!was) wrap.classList.add('open');
        return;
      }
      if (!e.target.closest('.dropdown-menu')) closeMenus();
      if (!e.target.closest('.sidebar, [data-action="toggle-sidebar"]')) document.body.classList.remove('show-sidebar');
    });

    $('#project-title').addEventListener('input', (e) => {
      state.project.title = e.target.value;
      document.title = (e.target.value || 'Untitled') + ' — Scriptdesk';
      markDirty();
    });
    $('#project-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });

    $('#file-input').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (f) await openFile(f, null);
    });

    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) { if (e.key === 'Escape') closeMenus(); return; }
      const k = e.key.toLowerCase();
      const inScript = currentDoc() && currentDoc().kind === 'script';
      if (k === 'f' && inScript && !e.shiftKey) { e.preventDefault(); openFind(false); return; }
      if (k === 'h' && inScript) { e.preventDefault(); openFind(true); return; }
      if (k === 'm' && e.altKey && inScript) { e.preventDefault(); addComment(); return; }
      if (k === 'd' && inScript && state.view === 'script' && !e.shiftKey) { e.preventDefault(); toggleDual(); return; }
      if (k === 'f' && e.shiftKey) { e.preventDefault(); openSearch(); return; }
      if (k === 's') { e.preventDefault(); saveProject(e.shiftKey); }
      else if (k === 'o') { e.preventDefault(); openDialog(); }
      else if (k === 'p') { e.preventDefault(); printScript(); }
    });

    // drop a file anywhere to open / import it
    window.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); document.body.classList.add('file-drag'); } });
    window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('file-drag'); });
    window.addEventListener('drop', (e) => {
      document.body.classList.remove('file-drag');
      if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); openFile(e.dataTransfer.files[0], null); }
    });

    window.addEventListener('beforeunload', (e) => {
      if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  // =====================================================================
  // highlights (CSS Custom Highlight API — no extra markup in the editor)
  // =====================================================================
  const HL = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined';
  function setHighlight(name, ranges) {
    if (!HL) return;
    if (ranges.length) CSS.highlights.set(name, new Highlight(...ranges)); else CSS.highlights.delete(name);
  }
  const blockById = (id) => editor.root.querySelector(`[data-id="${CSS.escape(id)}"]`);
  const refreshHighlights = debounce(() => {
    const showing = editor.doc && !$('#editor-wrap').hidden;
    // comments
    const cr = [];
    if (showing) {
      for (const e of editor.doc.elements) {
        for (const c of e.comments || []) {
          if (c.done || !c.quote) continue;
          const b = blockById(e.id);
          if (!b) continue;
          const pos = commentPos(e, c);
          const r = pos && editor.rangeIn(b, pos[0], pos[1]);
          if (r) cr.push(r);
        }
      }
    }
    setHighlight('sd-comment', cr);
    // find
    const fr = [], cur = [];
    if (showing && finder.open) {
      finder.matches.forEach((m, i) => {
        if (m.docId !== editor.doc.id) return;
        const b = blockById(m.elId);
        const r = b && editor.rangeIn(b, m.start, m.end);
        if (r) (i === finder.index ? cur : fr).push(r);
      });
    }
    setHighlight('sd-find', fr);
    setHighlight('sd-find-cur', cur);
  }, 50);

  // =====================================================================
  // comments — attached to a script line, optionally to words in it
  // =====================================================================
  function commentPos(e, c) {
    if (!c.quote) return null;
    if (e.text.slice(c.start, c.end) === c.quote) return [c.start, c.end];
    const i = e.text.indexOf(c.quote);
    return i >= 0 ? [i, i + c.quote.length] : null;
  }
  const commentCount = (d) => d.elements.reduce((n, e) => n + (e.comments || []).filter((c) => !c.done).length, 0);
  const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); } catch (e) { return ''; } };

  async function addComment() {
    const d = currentDoc();
    if (!d || d.kind !== 'script') { toast('Open a script to add a comment.'); return; }
    if (state.view !== 'script') setView('script');
    const info = editor.selectionInfo();
    if (!info) { toast('Click in the script where the comment belongs.'); return; }
    editor.sync();
    const el = d.elements.find((e) => e.id === info.block.dataset.id);
    if (!el) return;
    const ta = h('textarea', { class: 'input', rows: 4, placeholder: 'Your comment (Ctrl+Enter to add)' });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ta.closest('.modal').querySelector('.btn.primary').click(); } });
    setTimeout(() => ta.focus(), 30);
    const v = await modal({
      title: 'Add a comment',
      body: h('div', {}, info.text ? h('blockquote', { class: 'cm-quote' }, info.text) : h('p', { class: 'muted small' }, 'On the line “' + (el.text.slice(0, 90) || 'empty line') + (el.text.length > 90 ? '…' : '') + '”. Select words first to comment on them.'), ta),
      buttons: [{ label: 'Cancel', value: null }, { label: 'Add comment', value: () => ta.value, primary: true }],
    });
    if (!v || !v.trim()) return;
    editor.pushUndo(editor.snapshot());
    (el.comments = el.comments || []).push({ id: SD.uid(), text: v.trim(), quote: info.text, start: info.start, end: info.end, created: new Date().toISOString(), done: false });
    commentsChanged();
  }

  function commentsChanged() {
    editor.refreshMarks();
    editor.refreshState();
    markDirty();
    renderInspector();
    renderToolbar();
  }

  function goComment(d, el, c) {
    if (state.docId !== d.id) { syncEditor(); state.docId = d.id; state.editorStale = true; renderDocList(); }
    if (state.view !== 'script') state.view = 'script';
    renderView();
    const pos = commentPos(el, c);
    requestAnimationFrame(() => editor.selectRange(el.id, pos ? pos[0] : 0, pos ? pos[1] : 0));
    setTimeout(() => { if (!editor.root.contains(getSelection().anchorNode)) editor.selectRange(el.id, pos ? pos[0] : 0, pos ? pos[1] : 0); }, 80);
  }

  function commentCard(d, el, c, opts = {}) {
    return h('div', { class: 'cm-card' + (c.done ? ' done' : '') + (opts.on ? ' on' : '') },
      h('button', { class: 'cm-where', title: 'Show in the script', onclick: () => { if (opts.close) opts.close(); goComment(d, el, c); } },
        c.quote ? '“' + c.quote.slice(0, 80) + (c.quote.length > 80 ? '…' : '') + '”' : (el.text.slice(0, 60) || '(empty line)') + (el.text.length > 60 ? '…' : '')),
      h('textarea', { class: 'input cm-text', rows: 2, value: c.text, oninput: (e) => { c.text = e.target.value; editor.refreshState(); markDirty(); } }),
      h('div', { class: 'cm-foot' },
        h('span', { class: 'muted small' }, (c.author ? c.author + ' · ' : '') + fmtDate(c.created) + (c.done ? ' · resolved' : '')),
        h('span', { class: 'push-right' },
          h('button', { class: 'btn ghost small', onclick: () => { c.done = !c.done; commentsChanged(); if (opts.refresh) opts.refresh(); } }, c.done ? 'Reopen' : '✓ Resolve'),
          h('button', { class: 'btn ghost small danger', onclick: () => { editor.pushUndo(editor.snapshot()); el.comments = el.comments.filter((x) => x !== c); if (!el.comments.length) delete el.comments; commentsChanged(); if (opts.refresh) opts.refresh(); } }, 'Delete'))));
  }

  // Comments of one scene, for the scene panel.
  function sceneCommentsSection(d, sc) {
    syncEditor();
    const curId = editor.curBlock && editor.curBlock.dataset.id;
    const items = [];
    for (let i = sc.start; i < sc.end; i++) for (const c of d.elements[i].comments || []) items.push([d.elements[i], c]);
    const open = items.filter(([, c]) => !c.done);
    return h('div', { class: 'ins-section' },
      h('div', { class: 'cm-head-row' }, h('label', { class: 'lbl' }, `Comments${open.length ? ' (' + open.length + ')' : ''}`),
        h('button', { class: 'btn ghost small', title: 'Comment on the selected words or the current line (Ctrl+Alt+M)', onmousedown: (e) => e.preventDefault(), onclick: addComment }, '+ Comment')),
      open.length ? open.map(([el, c]) => commentCard(d, el, c, { on: el.id === curId })) : h('p', { class: 'muted small' }, 'Select words in the script and add a comment, for notes to yourself or from a reader.'),
      items.length > open.length ? h('p', { class: 'muted small' }, `${items.length - open.length} resolved — see 💬 in the toolbar.`) : null);
  }

  async function showAllComments(d) {
    syncEditor();
    let showDone = false;
    const list = h('div', { class: 'cm-list' });
    let closeModal = null;
    const draw = () => {
      const scenes = SD.getScenes(d);
      const sceneAt = (i) => { let s = null; for (const x of scenes) if (x.start <= i) s = x; return s; };
      const rows = [];
      d.elements.forEach((el, i) => (el.comments || []).forEach((c) => { if (showDone || !c.done) rows.push([el, c, sceneAt(i)]); }));
      list.replaceChildren(...(rows.length ? rows.map(([el, c, sc]) => h('div', {},
        h('div', { class: 'cm-scene' }, sc ? `Scene ${sc.number} · ${sc.el.text.toUpperCase().slice(0, 50)}` : 'Before the first scene'),
        commentCard(d, el, c, { close: () => closeModal && closeModal(), refresh: draw }))) : [h('p', { class: 'muted' }, showDone ? 'No comments in this script.' : 'No open comments. Select words in the script and press 💬 Comment.')]));
    };
    draw();
    const p = modal({
      title: 'Comments in “' + d.name + '”', wide: true,
      body: h('div', {}, h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => { showDone = e.target.checked; draw(); } }), ' Show resolved comments'), list),
      buttons: [{ label: 'Close', value: true, primary: true }],
    });
    closeModal = () => { const b = document.querySelector('.modal-backdrop:last-child .modal-actions .btn'); if (b) b.click(); };
    await p;
  }

  // =====================================================================
  // find & replace
  // =====================================================================
  const finder = { open: false, q: '', rep: '', caseSensitive: false, word: false, scope: 'doc', matches: [], index: -1, el: null };

  function buildFindBar() {
    const q = h('input', {
      class: 'input fb-q', placeholder: 'Find', 'aria-label': 'Find',
      oninput: (e) => { finder.q = e.target.value; finder.index = -1; runFind(); },
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); } else if (e.key === 'Escape') { e.preventDefault(); closeFind(true); } },
    });
    const r = h('input', {
      class: 'input fb-r', placeholder: 'Replace with', 'aria-label': 'Replace with',
      oninput: (e) => { finder.rep = e.target.value; },
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); replaceOne(); } else if (e.key === 'Escape') { e.preventDefault(); closeFind(true); } },
    });
    const opt = (label, key, title) => h('button', { class: 'btn ghost small fb-opt', title, 'aria-pressed': 'false', onclick: (e) => { finder[key] = !finder[key]; e.currentTarget.classList.toggle('on', finder[key]); e.currentTarget.setAttribute('aria-pressed', String(finder[key])); finder.index = -1; runFind(); } }, label);
    finder.count = h('span', { class: 'fb-count' });
    finder.qEl = q; finder.rEl = r;
    finder.el = h('div', { class: 'find-bar', role: 'search', hidden: true },
      h('div', { class: 'fb-row' },
        h('button', { class: 'icon-btn fb-toggle', title: 'Show / hide replace', 'aria-label': 'Show replace', onclick: () => finder.el.classList.toggle('with-replace') }, '⇅'),
        q, finder.count,
        opt('Aa', 'caseSensitive', 'Match case'), opt('W', 'word', 'Whole words only'),
        h('select', { class: 'select small fb-scope', title: 'Where to search', onchange: (e) => { finder.scope = e.target.value; finder.index = -1; runFind(); } },
          h('option', { value: 'doc' }, 'This script'), h('option', { value: 'all' }, 'All scripts')),
        h('button', { class: 'icon-btn', title: 'Previous (Shift+Enter)', 'aria-label': 'Previous match', onclick: () => stepFind(-1) }, '↑'),
        h('button', { class: 'icon-btn', title: 'Next (Enter)', 'aria-label': 'Next match', onclick: () => stepFind(1) }, '↓'),
        h('button', { class: 'icon-btn', title: 'Close (Esc)', 'aria-label': 'Close find', onclick: () => closeFind(true) }, '✕')),
      h('div', { class: 'fb-row fb-rep' }, r,
        h('button', { class: 'btn small', onclick: replaceOne }, 'Replace'),
        h('button', { class: 'btn small', onclick: replaceAll }, 'Replace all'),
        h('button', { class: 'btn ghost small', title: 'Rename a character in cues, dialogue, action, the catalog and the storyline', onclick: () => renameCharacter() }, 'Rename character…')));
    $('.workspace').append(finder.el);
  }

  function openFind(withReplace) {
    const d = currentDoc();
    if (!d || d.kind !== 'script') { toast('Open a script to search it.'); return; }
    if (state.view !== 'script') setView('script');
    if (!finder.el) buildFindBar();
    const sel = editor.selectionInfo();
    if (sel && sel.text && sel.text.length < 80) { finder.q = sel.text; finder.qEl.value = sel.text; }
    finder.el.hidden = false;
    finder.open = true;
    if (withReplace) finder.el.classList.add('with-replace');
    finder.index = -1;
    runFind();
    finder.qEl.focus();
    finder.qEl.select();
  }

  function closeFind(selectCurrent) {
    if (!finder.el) return;
    const m = finder.matches[finder.index];
    finder.el.hidden = true;
    finder.open = false;
    refreshHighlights();
    if (selectCurrent && m && editor.doc && m.docId === editor.doc.id) editor.selectRange(m.elId, m.start, m.end);
  }

  function findRegex(q) {
    if (!q) return null;
    let src = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (finder.word) src = '(?<![\\p{L}\\p{N}_])' + src + '(?![\\p{L}\\p{N}_])';
    return new RegExp(src, 'gu' + (finder.caseSensitive ? '' : 'i'));
  }

  function runFind() {
    if (!finder.open) return;
    syncEditor();
    const re = findRegex(finder.q);
    const cur = currentDoc();
    const docs = finder.scope === 'all' ? state.project.documents.filter((x) => x.kind === 'script') : cur && cur.kind === 'script' ? [cur] : [];
    finder.matches = [];
    if (re) {
      for (const doc of docs) {
        doc.elements.forEach((el, i) => {
          re.lastIndex = 0;
          let m;
          while ((m = re.exec(el.text))) {
            if (!m[0].length) { re.lastIndex++; continue; }
            finder.matches.push({ docId: doc.id, elId: el.id, elIndex: i, start: m.index, end: m.index + m[0].length });
          }
        });
      }
    }
    if (finder.index < 0 || finder.index >= finder.matches.length) {
      const k = finder.matches.findIndex((m) => cur && m.docId === cur.id && m.elIndex >= state.caretIndex);
      finder.index = finder.matches.length ? Math.max(0, k) : -1;
    }
    updateFindUI();
    refreshHighlights();
  }

  function updateFindUI() {
    const n = finder.matches.length;
    finder.count.textContent = !finder.q ? '' : n ? `${finder.index + 1} of ${n}` : 'No matches';
    finder.count.classList.toggle('none', !!finder.q && !n);
  }

  function stepFind(dir) {
    const n = finder.matches.length;
    if (!n) return;
    finder.index = (finder.index + dir + n) % n;
    showMatch();
  }

  function showMatch() {
    const m = finder.matches[finder.index];
    if (!m) return;
    if (state.docId !== m.docId) {
      syncEditor();
      state.docId = m.docId; state.view = 'script'; state.editorStale = true;
      renderDocList(); renderView();
    }
    const b = blockById(m.elId);
    if (b) b.scrollIntoView({ block: 'center' });
    updateFindUI();
    refreshHighlights();
  }

  // Replace a list of matches (from any script), with undo for the open one.
  function applyReplacements(list, textFor) {
    syncEditor();
    const byDoc = new Map();
    for (const m of list) { if (!byDoc.has(m.docId)) byDoc.set(m.docId, []); byDoc.get(m.docId).push(m); }
    for (const [docId, ms] of byDoc) {
      const doc = state.project.documents.find((x) => x.id === docId);
      if (!doc) continue;
      const open = editor.doc === doc && !state.editorStale;
      if (open) editor.pushUndo(editor.snapshot());
      const els = new Map(doc.elements.map((e) => [e.id, e]));
      ms.sort((a, b) => (a.elId === b.elId ? b.start - a.start : 0));
      for (const m of ms) {
        const e = els.get(m.elId);
        if (!e) continue;
        const old = e.text.slice(m.start, m.end);
        SD.editText(e, m.start, m.end, textFor(old));
      }
      if (open) { editor.render(); editor.lastState = editor.snapshot(); }
      else if (editor.doc === doc) state.editorStale = true;
    }
    markDirty();
    refreshDerived();
  }

  function replaceOne() {
    const m = finder.matches[finder.index];
    if (!m) return;
    applyReplacements([m], () => finder.rep);
    runFind();
    if (finder.matches.length) showMatch();
  }

  function replaceAll() {
    const n = finder.matches.length;
    if (!n) return;
    applyReplacements(finder.matches.slice(), () => finder.rep);
    finder.index = -1;
    runFind();
    toast(`Replaced ${n} match${n === 1 ? '' : 'es'}. Undo (Ctrl+Z) works in the open script.`);
  }

  // Rename a character in cues, mentions, the catalog and the storyline.
  async function renameCharacter(fromName) {
    syncEditor();
    const p = state.project;
    const names = new Set();
    for (const d of p.documents) if (d.kind === 'script') for (const e of d.elements) if (e.type === 'character') { const n = SD.charName(e.text); if (n) names.add(n); }
    for (const c of p.catalog) if (c.category === 'character' && c.name.trim()) names.add(c.name.trim().toUpperCase());
    if (!names.size) { toast('There are no characters yet.'); return; }
    const from = h('select', { class: 'select' }, [...names].sort().map((n) => h('option', { value: n, selected: n === fromName }, n)));
    const to = h('input', { class: 'input', placeholder: 'New name' });
    const cb = (label, on = true) => { const i = h('input', { type: 'checkbox', checked: on }); return [i, h('label', { class: 'check' }, i, ' ' + label)]; };
    const [cCues, lCues] = cb('Character cues (the name above dialogue)');
    const [cText, lText] = cb('Mentions in action, dialogue and scene headings (whole word, keeps CAPITALS / Capitals)');
    const [cCat, lCat] = cb('The character’s catalog profile');
    const [cMore, lMore] = cb('Storyline lines, storyboard captions and beat board cards');
    const preview = h('p', { class: 'muted small' });
    const plan = (dry) => renameCharacterRun(from.value, to.value.trim(), { cues: cCues.checked, text: cText.checked, catalog: cCat.checked, more: cMore.checked }, dry);
    const upd = () => { const n = to.value.trim() ? plan(true) : null; preview.textContent = n ? `${n.cues} cues · ${n.text} mentions · ${n.catalog} catalog profile · ${n.more} in other documents` : 'Type the new name.'; };
    [from, to, cCues, cText, cCat, cMore].forEach((x) => x.addEventListener('input', upd));
    [cCues, cText, cCat, cMore].forEach((x) => x.addEventListener('change', upd));
    upd();
    const ok = await modal({
      title: 'Rename a character everywhere',
      body: h('div', {}, h('label', { class: 'lbl' }, 'Character'), from, h('label', { class: 'lbl' }, 'New name'), to, lCues, lText, lCat, lMore, preview),
      buttons: [{ label: 'Cancel', value: false }, { label: 'Rename', value: true, primary: true }],
    });
    if (!ok || !to.value.trim()) return;
    const n = plan(false);
    runFind();
    renderView();
    toast(`Renamed: ${n.cues} cues, ${n.text} mentions${n.catalog ? ', the catalog profile' : ''}${n.more ? ', ' + n.more + ' elsewhere' : ''}.`);
  }

  function renameCharacterRun(fromU, toName, opt, dry) {
    const p = state.project;
    const toU = toName.toUpperCase();
    const title = toName.replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
    const re = new RegExp('(?<![\\p{L}\\p{N}_])' + fromU.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}_])', 'giu');
    const cased = (m) => (m === m.toUpperCase() ? toU : m[0] === m[0].toUpperCase() ? title : toName.toLowerCase());
    const n = { cues: 0, text: 0, catalog: 0, more: 0 };
    const replaceIn = (s, count) => s.replace(re, (m) => { n[count]++; return cased(m); });
    const list = [];
    for (const d of p.documents) {
      if (d.kind !== 'script') continue;
      d.elements.forEach((e) => {
        if (e.type === 'character') {
          if (opt.cues && SD.charName(e.text) === fromU) {
            const i = e.text.toUpperCase().indexOf(fromU);
            n.cues++;
            list.push({ docId: d.id, elId: e.id, start: i, end: i + fromU.length, to: toU });
          }
        } else if (opt.text) {
          re.lastIndex = 0;
          let m;
          while ((m = re.exec(e.text))) { n.text++; list.push({ docId: d.id, elId: e.id, start: m.index, end: m.index + m[0].length, to: cased(m[0]) }); }
        }
      });
    }
    if (opt.catalog) for (const c of p.catalog) if (c.category === 'character' && c.name.trim().toUpperCase() === fromU) { n.catalog++; if (!dry) c.name = c.name === c.name.toUpperCase() ? toU : title; }
    if (opt.more) {
      for (const d of p.documents) {
        if (d.kind === 'storyline') for (const r of d.rows) if (!r.charId && (r.name || '').toUpperCase() === fromU) { n.more++; if (!dry) r.name = toU; }
        if (d.kind === 'storyboard') for (const sq of d.sequences) for (const x of sq.shots) for (const k of ['caption', 'audio', 'notes']) { const before = n.more; const v = replaceIn(x[k] || '', 'more'); if (!dry && n.more !== before) x[k] = v; }
        if (d.kind === 'beatboard') for (const b of d.beats) for (const c of b.cards) if (c.text) { const before = n.more; const v = replaceIn(c.text, 'more'); if (!dry && n.more !== before) c.text = v; }
      }
    }
    if (!dry && list.length) {
      syncEditor();
      for (const [docId, ms] of groupBy(list, (m) => m.docId)) {
        const doc = p.documents.find((x) => x.id === docId);
        const open = editor.doc === doc && !state.editorStale;
        if (open) editor.pushUndo(editor.snapshot());
        const els = new Map(doc.elements.map((e) => [e.id, e]));
        ms.sort((a, b) => b.start - a.start);
        for (const m of ms) SD.editText(els.get(m.elId), m.start, m.end, m.to);
        if (open) { editor.render(); editor.lastState = editor.snapshot(); }
        else if (editor.doc === doc) state.editorStale = true;
      }
    }
    if (!dry) markDirty();
    return n;
  }
  const groupBy = (arr, key) => { const m = new Map(); for (const x of arr) { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };

  // =====================================================================
  // table read (speech synthesis)
  // =====================================================================
  const reader = { on: false, paused: false, docId: null, queue: [], at: 0, speaker: null, bar: null };
  const speechOK = () => 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  const readSettings = () => {
    const s = state.project.settings;
    const t = (s.tableRead = s.tableRead && typeof s.tableRead === 'object' ? s.tableRead : {});
    for (const [k, v] of Object.entries({ voices: {}, narrator: '', rate: 1, headings: true, action: true, parens: false, names: false })) if (t[k] == null) t[k] = v;
    return t;
  };
  const voiceList = () => (speechOK() ? speechSynthesis.getVoices() : []);
  const hashOf = (s) => { let x = 7; for (const c of s) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x; };

  // a voice and a pitch for each character, so they sound different even with few voices
  function voiceFor(name) {
    const rs = readSettings();
    const all = voiceList();
    const lang = (document.documentElement.lang || 'en').slice(0, 2);
    const pool = all.filter((v) => v.lang && v.lang.toLowerCase().startsWith(lang));
    const list = pool.length ? pool : all;
    const chosen = name ? rs.voices[name] : rs.narrator;
    let v = all.find((x) => x.voiceURI === chosen) || null;
    if (!v && list.length) v = name ? list[(hashOf(name) % Math.max(1, list.length - 1)) + (list.length > 1 ? 1 : 0)] || list[0] : list[0];
    const pitch = name ? 0.8 + (hashOf(name + '#') % 9) * 0.06 : 1;
    return { voice: v, pitch };
  }

  function spokenScene(t) {
    return t.replace(/^\s*INT\.\/EXT\.?\s*/i, 'Interior, exterior. ').replace(/^\s*I\/E\.?\s*/i, 'Interior, exterior. ').replace(/^\s*INT\.?\s+/i, 'Interior. ').replace(/^\s*EXT\.?\s+/i, 'Exterior. ').replace(/^\s*EST\.?\s+/i, 'Establishing. ').replace(/\s+-\s+/g, '. ');
  }

  function buildReadQueue(d, fromIndex) {
    const rs = readSettings();
    const q = [];
    let speaker = null;
    for (let i = 0; i < d.elements.length; i++) {
      const e = d.elements[i];
      const t = (e.text || '').trim();
      if (e.type === 'character') { speaker = SD.charName(t) || speaker; if (i >= fromIndex && rs.names && t) q.push({ id: e.id, text: speaker, who: null }); continue; }
      if (i < fromIndex || !t) continue;
      if (e.type === 'dialogue') q.push({ id: e.id, text: t, who: speaker });
      else if (e.type === 'parenthetical') { if (rs.parens) q.push({ id: e.id, text: t.replace(/[()]/g, ''), who: null }); }
      else if (e.type === 'scene' || e.type === 'page') { if (rs.headings) q.push({ id: e.id, text: e.type === 'scene' ? spokenScene(t) : t, who: null }); speaker = null; }
      else if (rs.action) q.push({ id: e.id, text: t, who: null });
    }
    return q;
  }

  // Chrome stops long utterances, so speak in sentence-sized pieces.
  const chunks = (t) => (t.match(/[^.!?…]+[.!?…]*["”’)]*\s*|.+$/g) || [t]).reduce((out, s) => { if (out.length && (out[out.length - 1] + s).length < 180) out[out.length - 1] += s; else out.push(s); return out; }, []);

  function startTableRead() {
    const d = currentDoc();
    if (!d || d.kind !== 'script') { toast('Open a script for a table read.'); return; }
    if (!speechOK()) { toast('This browser cannot read aloud. Try Chrome, Edge or Safari.'); return; }
    if (state.view !== 'script') setView('script');
    syncEditor();
    stopTableRead(true);
    const from = Math.max(0, Math.min(state.caretIndex || 0, d.elements.length - 1));
    reader.queue = buildReadQueue(d, from);
    if (!reader.queue.length) { toast('Nothing to read from here. Put the cursor earlier in the script.'); return; }
    // which scene each line belongs to, so the read can time whole scenes
    reader.sceneOf = new Map();
    let cur = null;
    const st = SD.SCRIPT_TYPES[d.scriptType].sceneType;
    d.elements.forEach((e, i) => { if (e.type === st) cur = { id: e.id, start: i }; if (cur) reader.sceneOf.set(e.id, cur); });
    reader.lastOf = new Map();
    reader.queue.forEach((q, i) => { const sc = reader.sceneOf.get(q.id); if (sc) reader.lastOf.set(sc.id, i); });
    reader.ms = new Map();
    reader.from = from;
    Object.assign(reader, { on: true, paused: false, docId: d.id, at: 0 });
    showReadBar();
    speakCurrent();
  }

  function speakCurrent() {
    if (!reader.on) return;
    speechSynthesis.cancel();
    const item = reader.queue[reader.at];
    if (!item) { stopTableRead(); toast('Table read finished.'); return; }
    editor.root.querySelectorAll('.el.reading').forEach((b) => b.classList.remove('reading'));
    const b = blockById(item.id);
    if (b) { b.classList.add('reading'); b.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    updateReadBar(item);
    const { voice, pitch } = voiceFor(item.who);
    const parts = chunks(item.text);
    const token = (reader.token = {});
    let k = 0;
    const t0 = performance.now();
    const next = () => {
      if (reader.token !== token || !reader.on) return;
      if (k >= parts.length) { timeRead(item, performance.now() - t0); reader.at++; speakCurrent(); return; }
      const u = new SpeechSynthesisUtterance(parts[k++]);
      if (voice) { u.voice = voice; u.lang = voice.lang; }
      u.pitch = pitch;
      u.rate = readSettings().rate || 1;
      u.onend = next;
      u.onerror = (e) => { if (e.error !== 'interrupted' && e.error !== 'canceled') next(); };
      speechSynthesis.speak(u);
    };
    next();
  }

  function stopTableRead(silent) {
    reader.on = false;
    reader.token = null;
    if (speechOK()) speechSynthesis.cancel();
    editor.root.querySelectorAll('.el.reading').forEach((b) => b.classList.remove('reading'));
    if (reader.bar) reader.bar.hidden = true;
    if (!silent) renderToolbar();
  }

  function pauseTableRead() {
    if (!reader.on) return;
    if (reader.paused) { reader.paused = false; speakCurrent(); }
    else { reader.paused = true; reader.token = null; speechSynthesis.cancel(); }
    updateReadBar(reader.queue[reader.at]);
  }

  function showReadBar() {
    if (!reader.bar) {
      reader.who = h('strong', { class: 'rb-who' });
      reader.pos = h('span', { class: 'rb-pos muted small' });
      reader.pauseBtn = h('button', { class: 'btn small', onclick: pauseTableRead }, '⏸ Pause');
      reader.bar = h('div', { class: 'read-bar', role: 'region', 'aria-label': 'Table read' },
        h('span', { class: 'rb-icon' }, '🔊'), reader.who, reader.pos,
        h('span', { class: 'push-right row-gap' },
          h('button', { class: 'btn small', title: 'Previous line', onclick: () => { reader.at = Math.max(0, reader.at - 1); reader.paused = false; speakCurrent(); } }, '⏮'),
          reader.pauseBtn,
          h('button', { class: 'btn small', title: 'Next line', onclick: () => { reader.at++; reader.paused = false; speakCurrent(); } }, '⏭'),
          h('select', { class: 'select small', title: 'Speed', onchange: (e) => { readSettings().rate = +e.target.value; markDirty(); } }, [0.8, 1, 1.15, 1.3, 1.5].map((r) => h('option', { value: r, selected: r === (readSettings().rate || 1) }, r + '×'))),
          h('button', { class: 'btn ghost small', onclick: () => tableReadVoices() }, 'Voices…'),
          h('button', { class: 'btn small', title: 'Stop', onclick: () => stopTableRead() }, '■ Stop')));
      $('.workspace').append(reader.bar);
    }
    reader.bar.hidden = false;
  }

  function updateReadBar(item) {
    if (!reader.bar || !item) return;
    reader.who.textContent = item.who || 'Narrator';
    reader.pos.textContent = `${reader.at + 1} / ${reader.queue.length}`;
    reader.pauseBtn.textContent = reader.paused ? '▶ Resume' : '⏸ Pause';
  }

  async function tableReadVoices() {
    const rs = readSettings();
    const d = state.project.documents.find((x) => x.id === (reader.docId || state.docId));
    const voices = voiceList();
    if (!voices.length) { toast('No voices are available yet. Try again in a moment.'); return; }
    const names = d && d.kind === 'script' ? characterStats(d).map((c) => c.name) : [];
    const sel = (cur, name) => {
      const auto = voiceFor(name).voice;
      return h('select', { class: 'select small', dataset: { name: name || '' } },
        h('option', { value: '' }, 'Automatic' + (auto ? ' (' + auto.name + ')' : '')),
        voices.map((v) => h('option', { value: v.voiceURI, selected: v.voiceURI === cur }, `${v.name} — ${v.lang}`)));
    };
    const test = (name, s) => h('button', { class: 'btn ghost small', onclick: () => { const u = new SpeechSynthesisUtterance(name ? 'This is ' + name.toLowerCase() + '.' : 'I read the scene headings and the action.'); const v = voices.find((x) => x.voiceURI === s.value) || voiceFor(name).voice; if (v) u.voice = v; u.pitch = voiceFor(name).pitch; speechSynthesis.cancel(); speechSynthesis.speak(u); } }, '▶');
    const nSel = sel(rs.narrator, null);
    const rows = names.map((n) => { const s = sel(rs.voices[n], n); return h('div', { class: 'tr-row' }, h('span', { class: 'tr-name' }, n), s, test(n, s)); });
    const box = (k, label) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: rs[k], dataset: { k } }), ' ' + label);
    const opts = h('div', {}, box('headings', 'Read scene headings'), box('action', 'Read action'), box('parens', 'Read parentheticals'), box('names', 'Say the character name before each speech'));
    const ok = await modal({
      title: 'Table read voices', wide: true,
      body: h('div', { class: 'tr-voices' },
        h('div', { class: 'tr-row' }, h('span', { class: 'tr-name' }, 'Narrator'), nSel, test(null, nSel)),
        rows.length ? rows : h('p', { class: 'muted small' }, 'Characters appear here once the script has dialogue.'),
        opts,
        h('p', { class: 'muted small' }, 'Which voices you get depends on your browser and computer. Characters sharing a voice get a different pitch.')),
      buttons: [{ label: 'Cancel', value: false }, { label: 'Save', value: true, primary: true }],
    });
    if (!ok) return;
    rs.narrator = nSel.value;
    for (const r of rows) { const s = r.querySelector('select'); if (s.value) rs.voices[s.dataset.name] = s.value; else delete rs.voices[s.dataset.name]; }
    opts.querySelectorAll('input[data-k]').forEach((i) => { rs[i.dataset.k] = i.checked; });
    markDirty();
    if (reader.on) { const d2 = state.project.documents.find((x) => x.id === reader.docId); const id = reader.queue[reader.at] && reader.queue[reader.at].id; reader.queue = buildReadQueue(d2, Math.max(0, d2.elements.findIndex((e) => e.id === id))); reader.at = 0; }
  }
  if (speechOK()) speechSynthesis.getVoices(); // starts loading the voice list

  // =====================================================================
  // script health
  // =====================================================================
  const NARR = new Set(['action', 'shot', 'general', 'panel', 'caption', 'sfx', 'sound', 'music', 'audio', 'transition']);
  const wordsIn = (t) => ((t || '').match(/[\p{L}\p{N}'’-]+/gu) || []).length;

  function healthData(d) {
    const scenes = SD.getScenes(d);
    const est = scenes.estimate || SD.estimate(d);
    const per = scenes.map((s) => {
      let dw = 0, aw = 0, speeches = 0;
      const who = new Map();
      let speaker = null;
      for (let i = s.start + 1; i < s.end; i++) {
        const e = d.elements[i];
        if (e.type === 'character') speaker = SD.charName(e.text);
        else if (e.type === 'dialogue') { const w = wordsIn(e.text); dw += w; speeches++; if (speaker) who.set(speaker, (who.get(speaker) || 0) + w); }
        else if (NARR.has(e.type)) aw += wordsIn(e.text);
      }
      return { scene: s, dw, aw, speeches, who };
    });
    // where in the script each speech is (0…1), for the character heatmap
    const segs = 10;
    const chars = new Map();
    let speaker = null;
    d.elements.forEach((e, i) => {
      if (e.type === 'character') speaker = SD.charName(e.text);
      else if (e.type === 'dialogue' && speaker) {
        const pos = Math.min(segs - 1, Math.floor((est.lineAt[i] / Math.max(1, est.totalLines)) * segs));
        if (!chars.has(speaker)) chars.set(speaker, { name: speaker, words: 0, lines: 0, segs: new Array(segs).fill(0), longest: 0, longestText: '' });
        const c = chars.get(speaker);
        const w = wordsIn(e.text);
        c.words += w; c.lines++; c.segs[pos] += w;
        if (w > c.longest) { c.longest = w; c.longestText = e.text; }
      }
    });
    return { scenes, per, est, chars: [...chars.values()].sort((a, b) => b.words - a.words), segs };
  }

  let tipEl = null;
  function chartTip(e, html) {
    if (!tipEl) { tipEl = h('div', { class: 'chart-tip', role: 'tooltip' }); document.body.append(tipEl); }
    if (!html) { tipEl.hidden = true; return; }
    tipEl.hidden = false;
    tipEl.innerHTML = html;
    const x = Math.min(window.innerWidth - tipEl.offsetWidth - 10, e.clientX + 14);
    const y = Math.max(8, e.clientY - tipEl.offsetHeight - 12);
    tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
  }
  const esc = SD.escapeHtml;
  const hoverable = (el, html) => { el.addEventListener('mousemove', (e) => chartTip(e, html)); el.addEventListener('mouseleave', (e) => chartTip(e, null)); return el; };

  function healthReport(d) {
    const H = healthData(d);
    const wrap = h('div', { class: 'health viz-root' });
    if (!H.scenes.length) { wrap.append(h('p', { class: 'muted' }, 'Add scenes to see how the script is shaped.')); return wrap; }
    const lens = H.per.map((x) => x.scene.lines / SD.LINES_PER_PAGE);
    const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
    const totDW = H.per.reduce((n, x) => n + x.dw, 0), totAW = H.per.reduce((n, x) => n + x.aw, 0);
    const silent = H.per.filter((x) => !x.speeches).length;
    const longest = H.per.reduce((a, b) => (b.scene.lines > a.scene.lines ? b : a));
    const tile = (v, l, sub) => h('div', { class: 'stat' }, h('div', { class: 'stat-v' }, v), h('div', { class: 'stat-l' }, l), sub ? h('div', { class: 'stat-sub' }, sub) : null);
    wrap.append(h('div', { class: 'health-tiles' },
      tile(SD.eighths(avg * SD.LINES_PER_PAGE), 'Average scene (pages)', 'Most screenplays: 1–3 pages'),
      tile('Sc ' + longest.scene.number, 'Longest scene', SD.eighths(longest.scene.lines) + ' pages'),
      tile(Math.round((totDW / Math.max(1, totDW + totAW)) * 100) + '%', 'Of the words are dialogue', totAW + totDW ? `${totDW.toLocaleString()} dialogue · ${totAW.toLocaleString()} action` : ''),
      tile(silent, 'Scenes without dialogue'),
      tile(H.chars.length, 'Speaking characters', H.chars.filter((c) => c.lines === 1).length + ' with a single line')));

    // 1. scene lengths
    const maxLen = Math.max(...lens, 1);
    const nSc = H.scenes.length, L = 36;
    const bw = nSc <= 12 ? 40 : nSc <= 40 ? 20 : 12;
    const W = L + nSc * bw + 70, CH = 150;
    const svg1 = svgEl('svg', { viewBox: `0 0 ${W} ${CH + 20}`, width: W, height: CH + 20, class: 'hchart', role: 'img', 'aria-label': 'Length of each scene in pages' });
    const y = (v) => CH - (v / maxLen) * (CH - 10);
    [0.5, 1, 2, 3, 5].filter((v) => v < maxLen).forEach((v) => { svg1.append(svgEl('line', { x1: L, x2: W - 70, y1: y(v), y2: y(v), class: 'hgrid' }), svgEl('text', { x: 2, y: y(v) - 3, class: 'haxis' }, v + ' pg')); });
    H.per.forEach((x, i) => {
      const v = lens[i];
      const r = svgEl('path', { d: barPath(L + i * bw + 1, y(v), Math.max(2, bw - 2), CH - y(v)), class: 'hbar s1' });
      const hit = svgEl('rect', { x: L + i * bw, y: 0, width: bw, height: CH, class: 'hhit' });
      const g = svgEl('g', {}, r, hit);
      hoverable(g, `<b>Scene ${x.scene.number}</b><br>${esc(x.scene.el.text.toUpperCase() || 'Untitled')}<br>${SD.eighths(x.scene.lines)} pages · page ${x.scene.page}`);
      g.addEventListener('click', () => goToScene(x.scene.id));
      svg1.append(g);
    });
    svg1.append(svgEl('line', { x1: L, x2: W - 70, y1: y(avg), y2: y(avg), class: 'havg' }), svgEl('text', { x: W - 66, y: y(avg) + 3, class: 'haxis' }, 'average ' + SD.eighths(avg * SD.LINES_PER_PAGE)));
    svg1.append(svgEl('line', { x1: L, x2: W - 70, y1: CH, y2: CH, class: 'hbase' }));
    svg1.append(svgEl('text', { x: L, y: CH + 15, class: 'haxis' }, 'Scene 1'), svgEl('text', { x: W - 70, y: CH + 15, class: 'haxis end' }, 'Scene ' + H.scenes.length));
    wrap.append(chartCard('Scene lengths', 'Pages per scene, in script order. Click a bar to jump to the scene. Long runs of long scenes can feel slow; a sudden run of short ones speeds things up.', svg1));

    // 2. dialogue vs action per scene (100% stacked)
    const svg2 = svgEl('svg', { viewBox: `0 0 ${W} ${CH + 20}`, width: W, height: CH + 20, class: 'hchart', role: 'img', 'aria-label': 'Share of dialogue and action words per scene' });
    H.per.forEach((x, i) => {
      const t = x.dw + x.aw;
      const g = svgEl('g', {});
      if (!t) g.append(svgEl('rect', { x: L + i * bw + 1, y: CH - 2, width: Math.max(2, bw - 2), height: 2, class: 'hempty' }));
      else {
        const hd = (x.dw / t) * CH, ha = CH - hd;
        if (ha > 0) g.append(svgEl('rect', { x: L + i * bw + 1, y: 0, width: Math.max(2, bw - 2), height: Math.max(0, ha - (hd > 0 ? 1 : 0)), class: 'hbar s2', rx: 2 }));
        if (hd > 0) g.append(svgEl('rect', { x: L + i * bw + 1, y: CH - hd + (ha > 0 ? 1 : 0), width: Math.max(2, bw - 2), height: Math.max(0, hd - (ha > 0 ? 1 : 0)), class: 'hbar s1', rx: 2 }));
      }
      g.append(svgEl('rect', { x: L + i * bw, y: 0, width: bw, height: CH, class: 'hhit' }));
      hoverable(g, `<b>Scene ${x.scene.number}</b><br><span class="tip-key s1"></span>Dialogue ${x.dw} words<br><span class="tip-key s2"></span>Action ${x.aw} words`);
      g.addEventListener('click', () => goToScene(x.scene.id));
      svg2.append(g);
    });
    svg2.append(svgEl('line', { x1: L, x2: W - 70, y1: CH / 2, y2: CH / 2, class: 'hgrid' }), svgEl('text', { x: 2, y: CH / 2 - 3, class: 'haxis' }, '50%'));
    wrap.append(chartCard('Dialogue and action', 'Share of words in each scene.', svg2,
      h('div', { class: 'legend' }, h('span', {}, h('i', { class: 'key s1' }), 'Dialogue'), h('span', {}, h('i', { class: 'key s2' }), 'Action'))));

    wrap.append(...tensionAndTime(d, H));

    // 3. who speaks where (heatmap)
    const top = H.chars.slice(0, 12);
    if (top.length) {
      const maxCell = Math.max(1, ...top.flatMap((c) => c.segs));
      const grid = h('div', { class: 'heat', style: `--segs:${H.segs}` },
        h('div', { class: 'heat-corner' }),
        Array.from({ length: H.segs }, (_, i) => h('div', { class: 'heat-col' }, i === 0 ? 'Start' : i === H.segs - 1 ? 'End' : i === H.segs / 2 ? 'Middle' : '')),
        top.map((c) => [
          h('div', { class: 'heat-name', title: c.name }, c.name),
          c.segs.map((w, i) => hoverable(h('div', { class: 'heat-cell', style: `--a:${w ? 0.12 + 0.88 * (w / maxCell) : 0}` }), `<b>${esc(c.name)}</b><br>${w} words spoken in the ${ordinal(i + 1)} tenth of the script`)),
        ]));
      wrap.append(chartCard('Who speaks where', `Words spoken by the ${top.length} biggest speaking parts, across ten equal stretches of the script. Darker means more. Gaps show where a character disappears.`, grid,
        h('div', { class: 'legend' }, h('span', {}, 'Fewer words'), h('i', { class: 'ramp' }), h('span', {}, 'More words'))));

      // 4. share of dialogue
      const total = top.reduce((n, c) => n + c.words, 0) || 1;
      const bars = h('div', { class: 'share' }, top.map((c) => hoverable(h('div', { class: 'share-row' },
        h('span', { class: 'share-name' }, c.name),
        h('span', { class: 'share-track' }, h('span', { class: 'share-bar', style: `width:${(c.words / top[0].words) * 100}%` })),
        h('span', { class: 'share-v' }, Math.round((c.words / total) * 100) + '%')), `<b>${esc(c.name)}</b><br>${c.words} words in ${c.lines} speeches<br>Longest speech: ${c.longest} words`)));
      wrap.append(chartCard('Share of the dialogue', 'Of all words spoken by these characters.', bars));
    }

    // 5. lists to check
    const speeches = [];
    let sp = null;
    d.elements.forEach((e) => { if (e.type === 'character') sp = SD.charName(e.text); else if (e.type === 'dialogue') speeches.push({ who: sp, w: wordsIn(e.text), text: e.text, id: e.id }); });
    const longSp = speeches.sort((a, b) => b.w - a.w).slice(0, 5).filter((x) => x.w > 0);
    wrap.append(h('div', { class: 'health-lists' },
      h('section', { class: 'chart-card' }, h('h3', {}, 'Longest speeches'),
        longSp.length ? h('ol', {}, longSp.map((x) => h('li', {}, h('button', { class: 'linklike', onclick: () => { state.view = 'script'; renderView(); requestAnimationFrame(() => editor.goTo(x.id)); } }, x.who || '—'), ` · ${x.w} words — “${x.text.slice(0, 70)}${x.text.length > 70 ? '…' : ''}”`))) : h('p', { class: 'muted small' }, 'No dialogue yet.')),
      h('section', { class: 'chart-card' }, h('h3', {}, 'Worth a look'),
        h('ul', {},
          H.per.filter((x) => x.scene.lines / SD.LINES_PER_PAGE > 4).map((x) => h('li', {}, `Scene ${x.scene.number} is ${SD.eighths(x.scene.lines)} pages long.`)),
          H.chars.filter((c) => c.lines === 1).slice(0, 8).map((c) => h('li', {}, `${c.name} speaks only once — could the line go to someone else?`)),
          H.chars.slice(0, 6).filter((c) => c.segs.slice(3, 7).every((w) => !w) && c.segs.some((w) => w)).map((c) => h('li', {}, `${c.name} is silent through the middle of the script.`)),
          h('li', { class: 'muted' }, 'Page counts are estimates (55 lines a page).')))));
    return wrap;
  }
  const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
  const SVGNS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs, ...kids) {
    const e = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    for (const k of kids) e.append(k);
    return e;
  }
  // bar with 4px rounded top, square at the baseline
  function barPath(x, y, w, hgt) {
    const r = Math.min(4, w / 2, hgt);
    return `M${x},${y + hgt}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt}Z`;
  }
  const chartCard = (title, sub, chart, legend) => h('section', { class: 'chart-card' }, h('h3', {}, title), h('p', { class: 'muted small' }, sub), legend || null, h('div', { class: 'chart-scroll' }, chart));

  // =====================================================================
  // writing goals & sprint timer
  // =====================================================================
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  function projectWords() {
    let n = 0;
    for (const d of state.project.documents) {
      if (d.kind === 'script') n += SD.wordCount(d);
      else if (d.kind === 'note') n += wordsIn(d.text);
    }
    return n;
  }
  function goals() {
    const p = state.project;
    p.writingLog = p.writingLog && typeof p.writingLog === 'object' ? p.writingLog : {};
    const g = (p.settings.goals = p.settings.goals && typeof p.settings.goals === 'object' ? p.settings.goals : {});
    for (const [k, v] of Object.entries({ daily: 0, pages: 0, work: 25, rest: 5, breaks: false })) if (g[k] == null) g[k] = v;
    return g;
  }
  function logToday() {
    goals();
    const log = state.project.writingLog;
    const k = today();
    if (!log[k]) log[k] = { base: projectWords(), words: 0, minutes: 0 };
    return log[k];
  }
  const trackWords = debounce(() => {
    if (!state.project) return;
    const e = logToday();
    e.words = Math.max(0, projectWords() - e.base);
    renderGoalChip();
  }, 1500);

  const timer = { running: false, mode: 'work', endsAt: 0, left: 0, minutes: 25, handle: null, startedWords: 0, workMs: 0, tickAt: 0 };
  function chime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [660, 880].forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
        const t = ctx.currentTime + i * 0.25;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        o.start(t); o.stop(t + 0.55);
      });
    } catch (e) { /* no sound */ }
  }
  function startTimer(min, mode = 'work') {
    clearInterval(timer.handle);
    Object.assign(timer, { running: true, mode, minutes: min, endsAt: Date.now() + min * 60000, tickAt: Date.now() });
    if (mode === 'work') timer.startedWords = projectWords();
    timer.handle = setInterval(tickTimer, 500);
    tickTimer();
  }
  function stopTimer(done) {
    if (timer.running && timer.mode === 'work') addWorkTime();
    clearInterval(timer.handle);
    timer.running = false;
    if (!done) toast('Timer stopped.');
    renderGoalChip();
  }
  function addWorkTime() {
    const ms = Date.now() - timer.tickAt;
    timer.tickAt = Date.now();
    const e = logToday();
    e.minutes = Math.round(((e.minutes || 0) + ms / 60000) * 10) / 10;
    markDirty();
  }
  function tickTimer() {
    const left = timer.endsAt - Date.now();
    if (left <= 0) {
      const g = goals();
      if (timer.mode === 'work') {
        addWorkTime();
        const w = projectWords() - timer.startedWords;
        chime();
        if (g.breaks) { toast(`Sprint done: ${Math.max(0, w)} words. Take a ${g.rest}-minute break.`); startTimer(g.rest, 'rest'); }
        else { toast(`Time is up! ${Math.max(0, w)} words in this sprint.`); stopTimer(true); }
      } else { chime(); toast('Break over — back to writing.'); startTimer(g.work, 'work'); }
      return;
    }
    timer.left = left;
    renderGoalChip();
  }
  function renderGoalChip() {
    const chip = $('#goal-chip');
    if (!chip || !state.project) return;
    const g = goals();
    const e = state.project.writingLog[today()];
    const words = e ? e.words : 0;
    const parts = [];
    if (timer.running) { const s = Math.ceil(timer.left / 1000); parts.push((timer.mode === 'rest' ? '☕ ' : '⏱ ') + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')); }
    if (g.daily) parts.push(`${words}/${g.daily}`);
    chip.textContent = parts.length ? parts.join(' · ') : '⏱';
    chip.classList.toggle('active', timer.running);
    chip.classList.toggle('met', !!g.daily && words >= g.daily);
    chip.style.setProperty('--goal', g.daily ? Math.min(100, (words / g.daily) * 100) + '%' : '0%');
    chip.title = timer.running ? (timer.mode === 'rest' ? 'Break' : 'Writing sprint') + ' running — click for goals and timer' : 'Writing goals and sprint timer';
  }

  async function openGoals() {
    const g = goals();
    const e = logToday();
    e.words = Math.max(0, projectWords() - e.base);
    const scripts = state.project.documents.filter((d) => d.kind === 'script');
    const pages = scripts.reduce((n, d) => n + SD.estimate(d).pages, 0);
    const num = (val, onset, props = {}) => h('input', Object.assign({ class: 'input', type: 'number', min: 0, value: val || '', oninput: (ev) => { onset(Math.max(0, +ev.target.value || 0)); markDirty(); renderGoalChip(); } }, props));
    // last 14 days
    const days = [];
    for (let i = 13; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); days.push([d, state.project.writingLog[k]]); }
    const max = Math.max(g.daily || 0, ...days.map(([, x]) => (x ? x.words : 0)), 1);
    let streak = 0;
    for (let i = days.length - 1; i >= 0; i--) { const x = days[i][1]; if (x && x.words > 0) streak++; else if (i !== days.length - 1) break; }
    const hist = h('div', { class: 'goal-hist', role: 'img', 'aria-label': 'Words written per day, last 14 days' }, days.map(([d, x]) => hoverable(h('div', { class: 'gh-col' },
      h('div', { class: 'gh-bar' + (g.daily && x && x.words >= g.daily ? ' met' : ''), style: `height:${((x ? x.words : 0) / max) * 100}%` }),
      h('div', { class: 'gh-day' }, d.toLocaleDateString(undefined, { weekday: 'narrow' }))), `<b>${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</b><br>${x ? x.words : 0} words${x && x.minutes ? ' · ' + Math.round(x.minutes) + ' min in sprints' : ''}`)));
    if (g.daily) hist.style.setProperty('--goal-y', (100 - (g.daily / max) * 100) + '%');
    const timerBox = h('div', { class: 'goal-timer' });
    const drawTimer = () => timerBox.replaceChildren(
      timer.running
        ? h('div', { class: 'row-gap' }, h('span', { class: 'goal-big' }, $('#goal-chip').textContent.split(' · ')[0]), h('button', { class: 'btn', onclick: () => { stopTimer(); drawTimer(); } }, '■ Stop'))
        : h('div', { class: 'row-gap' }, [10, 15, 25, 45, 60].map((m) => h('button', { class: 'btn small', onclick: () => { startTimer(m); drawTimer(); toast(`Writing sprint: ${m} minutes. Go!`); } }, m + ' min')),
          h('button', { class: 'btn small', onclick: async () => { const v = await promptText('Sprint length in minutes', '30'); if (+v > 0) { startTimer(+v); drawTimer(); } } }, 'Other…')));
    drawTimer();
    await modal({
      title: 'Writing goals & timer', wide: true,
      body: h('div', { class: 'goals' },
        h('div', { class: 'health-tiles' },
          h('div', { class: 'stat' }, h('div', { class: 'stat-v' }, e.words.toLocaleString()), h('div', { class: 'stat-l' }, 'Words written today'), g.daily ? h('div', { class: 'stat-sub' }, e.words >= g.daily ? 'Goal reached 🎉' : `${g.daily - e.words} to go`) : null),
          h('div', { class: 'stat' }, h('div', { class: 'stat-v' }, streak), h('div', { class: 'stat-l' }, 'Day streak')),
          h('div', { class: 'stat' }, h('div', { class: 'stat-v' }, pages + (g.pages ? ' / ' + g.pages : '')), h('div', { class: 'stat-l' }, 'Script pages (est.)'), g.pages ? h('div', { class: 'stat-sub' }, Math.min(100, Math.round((pages / g.pages) * 100)) + '% of the target') : null)),
        h('h3', {}, 'Last 14 days'), hist,
        h('h3', {}, 'Goals'),
        h('div', { class: 'sb-grid2' },
          h('label', {}, h('span', { class: 'lbl' }, 'Words per day'), num(g.daily, (v) => { g.daily = v; }, { placeholder: 'e.g. 500' })),
          h('label', {}, h('span', { class: 'lbl' }, 'Target length (pages)'), num(g.pages, (v) => { g.pages = v; }, { placeholder: 'e.g. 100' }))),
        h('h3', {}, 'Sprint timer'),
        timerBox,
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: g.breaks, onchange: (ev) => { g.breaks = ev.target.checked; markDirty(); } }), ' Scheduled breaks: after each sprint, a break, then the next sprint starts by itself'),
        h('div', { class: 'sb-grid2' },
          h('label', {}, h('span', { class: 'lbl' }, 'Sprint (minutes)'), num(g.work, (v) => { g.work = v || 25; })),
          h('label', {}, h('span', { class: 'lbl' }, 'Break (minutes)'), num(g.rest, (v) => { g.rest = v || 5; }))),
        h('p', { class: 'muted small' }, 'Words written = how much the project grew today (scripts and notes). The history is saved in the project file.')),
      buttons: [{ label: 'Close', value: true, primary: true }],
    });
  }

  // =====================================================================
  // review copy: a single HTML file a reader comments on; their comments come back as a file
  // =====================================================================
  async function makeReviewCopy() {
    syncEditor();
    const scripts = state.project.documents.filter((x) => x.kind === 'script');
    if (!scripts.length) { toast('There is no script to send.'); return; }
    const cur = currentDoc();
    const which = h('select', { class: 'select' }, scripts.map((d) => h('option', { value: d.id, selected: cur && cur.id === d.id }, d.name)));
    const msg = h('textarea', { class: 'input', rows: 3, placeholder: 'A note for the reader, e.g. “Does the ending land? Is Act 2 too long?”' });
    const ok = await modal({
      title: 'Review copy',
      body: h('div', {},
        h('p', {}, 'Makes one HTML file you can send to a reader. They open it in any browser — no account, no install — select words, write comments, and send you back a small comments file. Drop that file onto Scriptdesk to add their comments to your script.'),
        h('label', { class: 'lbl' }, 'Script'), which,
        h('label', { class: 'lbl' }, 'Message for the reader'), msg),
      buttons: [{ label: 'Cancel', value: false }, { label: 'Download review copy', value: true, primary: true }],
    });
    if (!ok) return;
    const d = scripts.find((x) => x.id === which.value);
    let css = '';
    try { css = await (await fetch('css/script.css')).text(); } catch (e) { /* the copy still works with the fallback font */ }
    const data = {
      app: 'scriptdesk-review', version: 1, docId: d.id, docName: d.name, project: state.project.title, scriptType: d.scriptType,
      created: new Date().toISOString(), message: msg.value.trim(), sceneNumbers: !!state.project.settings.sceneNumbers,
      titlePage: d.titlePage, elements: d.elements.map((e) => Object.assign({ id: e.id, type: e.type, text: e.text }, e.fmt ? { fmt: e.fmt } : null, e.dual ? { dual: true } : null)),
    };
    download(safeName((d.titlePage.title || d.name) + ' - review copy') + '.html', SD.reviewCopyHTML(data, css), 'text/html;charset=utf-8');
    toast('Review copy downloaded. Send it to your reader.');
  }

  async function importReview(data, fileName) {
    const docs = state.project.documents.filter((x) => x.kind === 'script');
    const d = docs.find((x) => x.id === data.docId) || docs.find((x) => x.name === data.docName);
    if (!d) { modal({ title: 'Which script?', body: `These comments are for “${data.docName}”, which is not in the project you have open. Open that project first, then drop the comments file again.` }); return; }
    syncEditor();
    const known = new Set(d.elements.flatMap((e) => (e.comments || []).map((c) => c.id)));
    let added = 0, moved = 0;
    for (const c of data.comments || []) {
      if (!c || !c.text || known.has(c.id)) continue;
      let el = d.elements.find((e) => e.id === c.elId);
      let note = '';
      if (!el) { el = d.elements[0]; moved++; note = ' (on a line that has since been deleted)'; }
      if (editor.doc === d && !state.editorStale && !added) editor.pushUndo(editor.snapshot());
      (el.comments = el.comments || []).push({ id: c.id || SD.uid(), text: String(c.text) + note, quote: note ? '' : c.quote || '', start: +c.start || 0, end: +c.end || 0, created: c.created || new Date().toISOString(), done: false, author: data.reviewer || 'Reader' });
      added++;
    }
    if (editor.doc === d) { state.editorStale = true; }
    markDirty();
    state.docId = d.id; state.view = 'script';
    renderDocList(); renderView();
    toast(added ? `Added ${added} comment${added === 1 ? '' : 's'} from ${data.reviewer || 'your reader'} to “${d.name}”.` + (moved ? ` ${moved} were on lines you deleted; they are on the first line.` : '') : 'These comments were already added.');
  }

  // =====================================================================
  // dual dialogue
  // =====================================================================
  function toggleDual() {
    const d = currentDoc();
    if (!d || d.kind !== 'script' || state.view !== 'script') return;
    const info = editor.selectionInfo();
    if (!info) { toast('Put the cursor in the second speech.'); return; }
    editor.sync();
    let i = d.elements.findIndex((e) => e.id === info.block.dataset.id);
    while (i > 0 && SD.SPEECH_TYPES.has(d.elements[i].type)) i--;
    const cue = d.elements[i];
    if (!cue || cue.type !== 'character') { toast('Put the cursor in a speech (its character name or dialogue).'); return; }
    if (!cue.dual && !SD.canBeDual(d.elements, i)) { toast('Dual dialogue needs another speech right before this one.'); return; }
    editor.pushUndo(editor.snapshot());
    if (cue.dual) delete cue.dual; else cue.dual = true;
    editor.refreshMarks();
    editor.refreshState();
    markDirty();
    renderStatusSoon();
    toast(cue.dual ? 'Dual dialogue: printed side by side with the speech before.' : 'No longer dual dialogue.');
  }

  // =====================================================================
  // scene temperature, read time and screen time
  // =====================================================================
  const TEMP_WORDS = ['Still', 'Calm', 'Quiet', 'Easy', 'Uneasy', 'Rising', 'Tense', 'Charged', 'Gripping', 'Explosive', 'Peak'];
  const fmtTime = (sec) => { sec = Math.round(sec || 0); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };
  const estSeconds = (sc) => (sc.lines / SD.LINES_PER_PAGE) * 60;
  // best guess of how long a scene plays: stopwatch, else table read, else one page a minute
  const sceneSeconds = (sc) => (sc.el.timing && sc.el.timing.manual) || (sc.el.timing && sc.el.timing.read) || estSeconds(sc);
  const runtimeOf = (d) => SD.getScenes(d).reduce((n, sc) => n + sceneSeconds(sc), 0);

  function timeRead(item, ms) {
    const sc = reader.sceneOf && reader.sceneOf.get(item.id);
    if (!sc) return;
    reader.ms.set(sc.id, (reader.ms.get(sc.id) || 0) + ms);
    // a scene counts once every line of it was read, from its start
    if (reader.lastOf.get(sc.id) !== reader.at || reader.from > sc.start) return;
    const d = state.project.documents.find((x) => x.id === reader.docId);
    const el = d && d.elements.find((e) => e.id === sc.id);
    if (!el) return;
    el.timing = Object.assign({}, el.timing, { read: Math.round((reader.ms.get(sc.id) / 1000) * (readSettings().rate || 1)) });
    editor.refreshState();
    markDirty();
    if (state.sceneId === sc.id) renderInspector();
  }

  const stopwatch = { sceneId: null, started: 0, handle: null };
  function sceneTempSection(d, sc) {
    const e = sc.el;
    const touched = () => { editor.refreshState(); markDirty(); };
    const t = e.timing || {};
    const label = h('span', { class: 'temp-word' }, e.temp == null ? 'not set' : `${e.temp} · ${TEMP_WORDS[e.temp]}`);
    const swOut = h('span', { class: 'sw-out' }, stopwatch.sceneId === sc.id ? fmtTime((Date.now() - stopwatch.started) / 1000) : '');
    const swBtn = h('button', {
      class: 'btn small' + (stopwatch.sceneId === sc.id ? ' primary' : ''), onclick: () => {
        if (stopwatch.sceneId === sc.id) {
          clearInterval(stopwatch.handle);
          e.timing = Object.assign({}, e.timing, { manual: Math.round((Date.now() - stopwatch.started) / 1000) });
          stopwatch.sceneId = null;
          touched(); renderInspector();
          toast('Timed scene ' + sc.number + ': ' + fmtTime(e.timing.manual));
        } else {
          clearInterval(stopwatch.handle);
          stopwatch.sceneId = sc.id; stopwatch.started = Date.now();
          stopwatch.handle = setInterval(() => { const o = $('#inspector .sw-out'); if (o && stopwatch.sceneId) o.textContent = fmtTime((Date.now() - stopwatch.started) / 1000); }, 500);
          renderInspector();
        }
      },
    }, stopwatch.sceneId === sc.id ? '■ Stop' : '⏱ Time it');
    return h('div', { class: 'ins-section' },
      h('label', { class: 'lbl' }, 'Temperature'),
      h('div', { class: 'temp-row' },
        h('span', { class: 'muted small' }, 'calm'),
        h('input', { type: 'range', min: 0, max: 10, step: 1, value: e.temp == null ? 5 : e.temp, class: 'temp-range' + (e.temp == null ? ' unset' : ''), style: `--t:${e.temp == null ? 5 : e.temp}`, 'aria-label': 'Scene temperature', oninput: (ev) => { e.temp = +ev.target.value; ev.target.classList.remove('unset'); ev.target.style.setProperty('--t', e.temp); label.textContent = `${e.temp} · ${TEMP_WORDS[e.temp]}`; touched(); } }),
        h('span', { class: 'muted small' }, 'intense')),
      h('div', { class: 'temp-foot' }, label, e.temp != null ? h('button', { class: 'linklike small', onclick: () => { delete e.temp; touched(); renderInspector(); } }, 'clear') : null),
      h('label', { class: 'lbl' }, 'Screen time'),
      h('div', { class: 'time-grid' },
        h('span', {}, 'Estimate'), h('strong', {}, fmtTime(estSeconds(sc))), h('span', { class: 'muted small' }, '1 page ≈ 1 minute'),
        h('span', {}, 'Table read'), h('strong', {}, t.read ? fmtTime(t.read) : '—'), h('span', { class: 'muted small' }, t.read ? 'from 🔊 Table read' : 'read the whole scene aloud'),
        h('span', {}, 'Stopwatch'), h('strong', {}, t.manual ? fmtTime(t.manual) : '—'), h('span', {}, swBtn, ' ', swOut, t.manual && stopwatch.sceneId !== sc.id ? h('button', { class: 'linklike small', onclick: () => { delete e.timing.manual; touched(); renderInspector(); } }, 'clear') : null)),
      h('p', { class: 'muted small' }, 'Time a rehearsal or read it yourself with the stopwatch. The best timing is used for the running time in Reports → Health.'));
  }

  // charts for the health report: the tension curve and the timings
  function tensionAndTime(d, H) {
    const out = [];
    const temps = H.per.filter((x) => x.scene.el.temp != null);
    const n = H.scenes.length, L = 36, bw = n <= 12 ? 40 : n <= 40 ? 20 : 12, W = L + n * bw + 20, CH = 140;
    const x = (i) => L + i * bw + bw / 2, y = (t) => CH - (t / 10) * (CH - 14);
    if (temps.length >= 2) {
      const svg = svgEl('svg', { viewBox: `0 0 ${W} ${CH + 20}`, width: W, height: CH + 20, class: 'hchart', role: 'img', 'aria-label': 'Scene temperature across the script' });
      [0, 5, 10].forEach((v) => svg.append(svgEl('line', { x1: L, x2: W - 20, y1: y(v), y2: y(v), class: 'hgrid' }), svgEl('text', { x: 2, y: y(v) + 3, class: 'haxis' }, v === 0 ? 'calm' : v === 10 ? 'intense' : '5')));
      const pts = temps.map((t) => [x(H.per.indexOf(t)), y(t.scene.el.temp)]);
      svg.append(svgEl('path', { d: `M${pts[0][0]},${CH} ` + pts.map((p) => `L${p[0]},${p[1]}`).join(' ') + ` L${pts[pts.length - 1][0]},${CH} Z`, class: 'harea s1' }));
      svg.append(svgEl('polyline', { points: pts.map((p) => p.join(',')).join(' '), class: 'hline s1' }));
      temps.forEach((t, k) => {
        const g = svgEl('g', {}, svgEl('circle', { cx: pts[k][0], cy: pts[k][1], r: 5, class: 'hdot s1' }), svgEl('rect', { x: pts[k][0] - bw / 2, y: 0, width: bw, height: CH, class: 'hhit' }));
        hoverable(g, `<b>Scene ${t.scene.number}</b><br>${esc(t.scene.el.text.toUpperCase())}<br>Temperature ${t.scene.el.temp} · ${TEMP_WORDS[t.scene.el.temp]}`);
        g.addEventListener('click', () => goToScene(t.scene.id));
        svg.append(g);
      });
      out.push(chartCard('Tension curve', 'The temperature you gave each scene (scene panel → Temperature). Most stories climb with dips to breathe; a long flat stretch can feel slow.', svg));
    } else out.push(h('section', { class: 'chart-card' }, h('h3', {}, 'Tension curve'), h('p', { class: 'muted small' }, 'Give scenes a temperature (calm to intense) in the scene panel next to the script, and their curve appears here.')));
    // timing
    const measured = H.per.filter((p) => p.scene.el.timing && (p.scene.el.timing.read || p.scene.el.timing.manual));
    const total = H.scenes.reduce((n2, sc) => n2 + sceneSeconds(sc), 0);
    const est = H.scenes.reduce((n2, sc) => n2 + estSeconds(sc), 0);
    const card = h('section', { class: 'chart-card' }, h('h3', {}, 'Running time'),
      h('p', { class: 'muted small' }, `About ${fmtTime(total)} (minutes:seconds)` + (measured.length ? ` — ${measured.length} of ${n} scenes timed, the others estimated. The page estimate alone says ${fmtTime(est)}.` : ` — estimated at one page a minute. Time scenes with 🔊 Table read or the stopwatch in the scene panel to make it real.`)));
    if (measured.length) {
      const mx = Math.max(...H.scenes.map((sc) => Math.max(estSeconds(sc), (sc.el.timing && (sc.el.timing.manual || sc.el.timing.read)) || 0)), 1);
      const yy = (v) => CH - (v / mx) * (CH - 10);
      const svg = svgEl('svg', { viewBox: `0 0 ${W} ${CH + 20}`, width: W, height: CH + 20, class: 'hchart', role: 'img', 'aria-label': 'Estimated and measured time per scene' });
      H.per.forEach((p, i) => {
        const sc = p.scene, m = sc.el.timing && (sc.el.timing.manual || sc.el.timing.read), e2 = estSeconds(sc), half = Math.max(2, bw / 2 - 2);
        const g = svgEl('g', {}, svgEl('path', { d: barPath(L + i * bw + 1, yy(e2), half, CH - yy(e2)), class: 'hbar s1' }));
        if (m) g.append(svgEl('path', { d: barPath(L + i * bw + 3 + half, yy(m), half, CH - yy(m)), class: 'hbar s2' }));
        g.append(svgEl('rect', { x: L + i * bw, y: 0, width: bw, height: CH, class: 'hhit' }));
        hoverable(g, `<b>Scene ${sc.number}</b><br><span class="tip-key s1"></span>Estimate ${fmtTime(e2)}<br><span class="tip-key s2"></span>${m ? (sc.el.timing.manual ? 'Stopwatch ' : 'Table read ') + fmtTime(m) : 'Not timed yet'}`);
        g.addEventListener('click', () => goToScene(sc.id));
        svg.append(g);
      });
      svg.append(svgEl('line', { x1: L, x2: W - 20, y1: CH, y2: CH, class: 'hbase' }));
      card.append(h('div', { class: 'legend' }, h('span', {}, h('i', { class: 'key s1' }), 'Estimate (pages)'), h('span', {}, h('i', { class: 'key s2' }), 'Measured (read or stopwatch)')), h('div', { class: 'chart-scroll' }, svg));
    }
    out.push(card);
    return out;
  }

  // =====================================================================
  // voice check: one character's lines in a row, and their habits
  // =====================================================================
  const STOP = new Set('the a an and or but if then so to of in on at for with from by as is are was were be been am i you he she it we they me him her us them my your his its our their this that these those there here what who do does did not no yes just oh well um uh hey ok okay can will would could should have has had get got go going gonna know like all up out about into over than too very really now one'.split(' '));
  function linesOf(name) {
    const out = [];
    for (const d of state.project.documents) {
      if (d.kind !== 'script') continue;
      const scenes = SD.getScenes(d);
      let sp = null, paren = '';
      d.elements.forEach((e, i) => {
        if (e.type === 'character') { sp = SD.charName(e.text); paren = ''; }
        else if (e.type === 'parenthetical') paren = e.text;
        else if (e.type === 'dialogue' && sp === name && e.text.trim()) { let sc = null; for (const x of scenes) if (x.start <= i) sc = x; out.push({ d, e, sc, paren, text: e.text }); }
        else if (!SD.SPEECH_TYPES.has(e.type)) sp = null;
      });
    }
    return out;
  }
  function voiceStats(lines) {
    const words = lines.flatMap((l) => (l.text.toLowerCase().match(/[\p{L}\p{N}'’]+/gu) || []));
    const freq = new Map();
    for (const w of words) if (!STOP.has(w) && w.length > 2) freq.set(w, (freq.get(w) || 0) + 1);
    const grams = new Map();
    for (const l of lines) {
      const ws = l.text.toLowerCase().match(/[\p{L}\p{N}'’]+/gu) || [];
      for (let n = 2; n <= 3; n++) for (let i = 0; i + n <= ws.length; i++) { const g = ws.slice(i, i + n).join(' '); if (ws.slice(i, i + n).every((w) => STOP.has(w))) continue; grams.set(g, (grams.get(g) || 0) + 1); }
    }
    const count = (re) => lines.filter((l) => re.test(l.text.trim())).length;
    return {
      lines: lines.length, words: words.length, avg: lines.length ? words.length / lines.length : 0,
      unique: new Set(words).size, longest: lines.reduce((a, b) => (b.text.length > (a ? a.text.length : 0) ? b : a), null),
      questions: count(/\?["”’)]*$/), exclaims: count(/!["”’)]*$/), trails: count(/(\.\.\.|…|—|--)["”’)]*$/),
      top: [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12), phrases: [...grams.entries()].filter((x) => x[1] > 1).sort((a, b) => b[1] - a[1]).slice(0, 8), freq,
    };
  }
  async function voiceCheck(name, other) {
    syncEditor();
    const names = [...new Set(state.project.documents.filter((d) => d.kind === 'script').flatMap((d) => characterStats(d).filter((c) => c.speeches).map((c) => c.name)))];
    if (!names.length) { toast('No one speaks yet.'); return; }
    name = name && names.includes(name) ? name : names[0];
    const body = h('div', { class: 'vcx' });
    const selA = h('select', { class: 'select' }, names.map((n) => h('option', { value: n, selected: n === name }, n)));
    const selB = h('select', { class: 'select' }, h('option', { value: '' }, '— compare with… —'), names.map((n) => h('option', { value: n, selected: n === other }, n)));
    const filter = h('input', { class: 'input', placeholder: 'Find in their lines…' });
    const column = (n, otherFreq) => {
      const lines = linesOf(n);
      const st = voiceStats(lines);
      const pct = (v) => (st.lines ? Math.round((v / st.lines) * 100) + '%' : '—');
      // words this character uses much more than everyone else
      const all = new Map();
      for (const nn of names) if (nn !== n) for (const [w, c] of voiceStats(linesOf(nn)).freq) all.set(w, (all.get(w) || 0) + c);
      const own = [...st.freq.entries()].filter(([w, c]) => c >= 2 && (all.get(w) || 0) <= c / 3).sort((a, b) => b[1] - a[1]).slice(0, 8);
      const q = filter.value.trim().toLowerCase();
      const shown = q ? lines.filter((l) => l.text.toLowerCase().includes(q)) : lines;
      return h('div', { class: 'vc-colx' },
        h('h3', {}, n),
        h('div', { class: 'health-tiles small' },
          h('div', { class: 'stat' }, h('div', { class: 'stat-v' }, st.lines), h('div', { class: 'stat-l' }, 'speeches')),
          h('div', { class: 'stat' }, h('div', { class: 'stat-v' }, st.avg.toFixed(1)), h('div', { class: 'stat-l' }, 'words a speech')),
          h('div', { class: 'stat' }, h('div', { class: 'stat-v' }, st.words ? Math.round((st.unique / st.words) * 100) + '%' : '—'), h('div', { class: 'stat-l' }, 'different words'))),
        h('p', { class: 'small' }, `Questions ${pct(st.questions)} · exclamations ${pct(st.exclaims)} · trails off ${pct(st.trails)}`),
        st.top.length ? h('p', { class: 'small' }, h('strong', {}, 'Favourite words: '), st.top.map(([w, c]) => `${w} (${c})`).join(', ')) : null,
        st.phrases.length ? h('p', { class: 'small' }, h('strong', {}, 'Repeats: '), st.phrases.map(([g, c]) => `“${g}” ×${c}`).join(', ')) : null,
        own.length ? h('p', { class: 'small' }, h('strong', {}, 'Words only they use: '), own.map(([w]) => w).join(', ')) : null,
        h('ol', { class: 'vc-lines' }, shown.map((l) => h('li', {},
          h('button', { class: 'linklike vc-where', title: 'Go to this line', onclick: () => { const b = document.querySelector('.modal-backdrop:last-child .modal-actions .btn'); if (b) b.click(); state.docId = l.d.id; state.view = 'script'; state.editorStale = true; renderDocList(); renderView(); setTimeout(() => editor.goTo(l.e.id), 30); } }, l.sc ? 'Sc ' + l.sc.number : '—'),
          l.paren ? h('em', { class: 'muted' }, ' ' + l.paren + ' ') : ' ', l.text))));
    };
    const draw = () => body.replaceChildren(
      h('div', { class: 'row-gap' }, selA, selB, filter),
      h('p', { class: 'muted small' }, 'Read the lines in one go: does the character sound like the same person all the way through, and different from the others?'),
      h('div', { class: 'vc-cols' + (selB.value ? ' two' : '') }, column(selA.value), selB.value ? column(selB.value) : null));
    [selA, selB].forEach((x) => x.addEventListener('change', draw));
    filter.addEventListener('input', debounce(draw, 200));
    draw();
    await modal({ title: 'Voice check', wide: true, body, buttons: [{ label: 'Close', value: true, primary: true }] });
  }

  // =====================================================================
  // links everywhere: everything about a catalog item, across the project
  // =====================================================================
  function everywhereSection(c) {
    const p = state.project;
    const upper = (c.name || '').trim().toUpperCase();
    const wordRe = upper ? new RegExp('(?<![\\p{L}\\p{N}_])' + upper.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}_])', 'iu') : null;
    const rows = [];
    const row = (icon, text, go) => rows.push(h('button', { class: 'appears-scene ew-row', onclick: go }, h('span', { class: 'scene-num' }, icon), text));
    const open = (d, after) => () => { selectDoc(d.id); if (after) setTimeout(after, 60); };
    for (const d of p.documents) {
      if (d.kind === 'relations' && SD.KINDS.relations) {
        const keys = [c.id, 'name:' + upper];
        const mine = d.links.filter((l) => keys.includes(l.a) || keys.includes(l.b));
        for (const l of mine) {
          const otherKey = keys.includes(l.a) ? l.b : l.a;
          const o = p.catalog.find((x) => x.id === otherKey);
          const kind = (SD.REL_KINDS.find((k) => k.id === l.kind) || {});
          row(kind.icon || '🕸️', `${kind.label || 'Relationship'} with ${o ? o.name : otherKey.replace(/^name:/, '')}${l.label ? ' — ' + l.label : ''} (${d.name})`, open(d));
        }
      }
      if (d.kind === 'moodboard' && (d.about || []).includes(c.id)) row('🎨', `Mood board “${d.name}” (${d.cards.length} cards)`, open(d));
      if (d.kind === 'storyline' && d.rows.some((r) => r.charId === c.id || (r.name || '').toUpperCase() === upper)) row('〰️', `A line in the storyline “${d.name}”`, open(d));
      if (d.kind === 'storyboard' && wordRe) {
        const nums = SD.storyboardNumbers(p, d);
        const hits = [];
        for (const sq of d.sequences) sq.shots.forEach((x, i) => { if (wordRe.test([x.caption, x.audio, x.notes].join(' '))) hits.push({ no: nums.get(sq.id) + SD.shotLetters(i), sq, x }); });
        if (hits.length) row('🎞️', `In storyboard shots ${hits.slice(0, 8).map((x) => x.no).join(', ')}${hits.length > 8 ? '…' : ''}`, () => { state.sbSel = { doc: d.id, seq: hits[0].sq.id, shot: hits[0].x.id }; selectDoc(d.id); });
      }
      if (d.kind === 'beatboard' && wordRe) { const n = d.beats.reduce((k, b) => k + b.cards.filter((x) => x.text && wordRe.test(x.text)).length, 0); if (n) row('🧭', `${n} note card${n === 1 ? '' : 's'} on “${d.name}”`, open(d)); }
      if (d.kind === 'schedule' && SD.KINDS.schedule) {
        const script = p.documents.find((x) => x.id === d.sourceId);
        if (!script) continue;
        const scenes = SD.getScenes(script);
        const inScene = (sc) => (c.category === 'character' ? SD.sceneCharacters(script, sc).includes(upper) : c.category === 'location' ? SD.locationMatches(SD.parseSceneHeading(sc.el.text).location, c.name) || (sc.el.items || []).includes(c.id) : (sc.el.items || []).includes(c.id));
        const ids = new Set(scenes.filter(inScene).map((sc) => sc.id));
        const days = d.days.map((x, i) => (x.scenes.some((id) => ids.has(id)) ? 'Day ' + (i + 1) + (x.date ? ' (' + x.date + ')' : '') : null)).filter(Boolean);
        if (days.length) row('📅', `Shoots on ${days.join(', ')}`, open(d));
      }
      if (d.kind === 'locmap' && c.category === 'location') row('🗺️', c.fields.lat ? `On the map “${d.name}”` : `Not on the map “${d.name}” yet — place it there`, open(d));
      if (d.kind === 'budget' && SD.KINDS.budget) {
        const target = c.category === 'character' ? p.catalog.find((x) => x.id === (c.links || {}).playedBy) : c;
        if (target) { const pr = SD.itemPrice(target); row('💶', pr.set ? `Budget: ${pr.price} ${pr.unit}${target !== c ? ' (' + target.name + ')' : ''}` : `No price yet in the budget${target !== c ? ' for ' + target.name : ''}`, open(d)); }
      }
    }
    if (c.category === 'character') {
      for (const d of p.documents) {
        if (d.kind !== 'script') continue;
        const n = d.elements.reduce((k, e) => k + (e.comments || []).filter((x) => !x.done && wordRe && wordRe.test(x.text + ' ' + (x.quote || ''))).length, 0);
        if (n) row('💬', `${n} open comment${n === 1 ? '' : 's'} mention them in “${d.name}”`, () => showAllComments(d));
      }
    }
    return h('details', { class: 'fsection', open: true },
      h('summary', {}, 'Everywhere', rows.length ? h('span', { class: 'fcount' }, rows.length) : null),
      h('div', { class: 'fbody' },
        c.category === 'character' ? h('div', { class: 'row-gap' }, h('button', { class: 'btn small', onclick: () => voiceCheck(upper) }, '🗣 Voice check'), h('button', { class: 'btn small', onclick: () => openSearch(c.name) }, '🔍 Find everywhere')) : h('div', { class: 'row-gap' }, h('button', { class: 'btn small', onclick: () => openSearch(c.name) }, '🔍 Find everywhere')),
        rows.length ? rows : h('p', { class: 'muted small' }, 'Relationships, mood boards, storyboard shots, shoot days, the budget and the map appear here once they mention this.')));
  }

  // Ctrl+click a character cue or a scene heading to open its catalog page
  document.addEventListener('click', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const b = e.target.closest && e.target.closest('#editor .el');
    if (!b) return;
    const text = b.textContent.trim();
    if (b.dataset.type === 'character') {
      const n = SD.charName(text);
      if (!n) return;
      e.preventDefault();
      const it = SD.findCatalogItem(state.project, 'character', n);
      openCatalogItem(it ? it.id : null, { category: 'character', name: n });
    } else if (b.dataset.type === 'scene') {
      const loc = SD.parseSceneHeading(text).location;
      if (!loc) return;
      e.preventDefault();
      const it = state.project.catalog.find((c) => c.category === 'location' && SD.locationMatches(loc, c.name));
      openCatalogItem(it ? it.id : null, { category: 'location', name: loc });
    }
  });

  // =====================================================================
  // search the whole project
  // =====================================================================
  function searchProject(q) {
    const p = state.project;
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return [];
    const out = [];
    const hit = (t) => t && String(t).toLowerCase().includes(needle);
    const add = (group, icon, title, text, go) => out.push({ group, icon, title, text: String(text || ''), go });
    syncEditor();
    for (const d of p.documents) {
      if (d.kind === 'script') {
        const scenes = SD.getScenes(d);
        d.elements.forEach((e, i) => {
          let sc = null; for (const x of scenes) if (x.start <= i) sc = x;
          const where = `${d.name}${sc ? ' · scene ' + sc.number : ''}`;
          const goEl = (start) => () => { state.docId = d.id; state.view = 'script'; state.editorStale = true; renderDocList(); renderView(); setTimeout(() => { const k = e.text.toLowerCase().indexOf(needle); editor.selectRange(e.id, start != null ? start : Math.max(0, k), start != null ? start : Math.max(0, k) + (k >= 0 ? needle.length : 0)); }, 40); };
          if (hit(e.text)) add('Scripts', SD.SCRIPT_TYPES[d.scriptType].icon, where, e.text, goEl());
          if (hit(e.synopsis)) add('Scripts', '📇', where + ' · synopsis', e.synopsis, goEl(0));
          if (hit(e.notes)) add('Scripts', '🗒️', where + ' · scene notes', e.notes, goEl(0));
          for (const c of e.comments || []) if (hit(c.text) || hit(c.quote)) add('Comments', '💬', where + (c.author ? ' · ' + c.author : ''), c.text, () => goComment(d, e, c));
          for (const v of e.versions || []) for (const x of v.elements) if (hit(x.text)) add('Scripts', '🗂️', where + ' · version “' + v.name + '”', x.text, goEl(0));
        });
      } else if (d.kind === 'note') {
        if (hit(d.name) || hit(d.text)) add('Notes', '📝', d.name, d.text, () => selectDoc(d.id));
      } else if (d.kind === 'storyboard') {
        const nums = SD.storyboardNumbers(p, d);
        for (const sq of d.sequences) sq.shots.forEach((x, i) => { const t = [x.caption, x.audio, x.notes].filter(Boolean).join(' · '); if (hit(t)) add('Storyboard', '🎞️', `${d.name} · shot ${nums.get(sq.id)}${SD.shotLetters(i)}`, t, () => { state.sbSel = { doc: d.id, seq: sq.id, shot: x.id }; selectDoc(d.id); }); });
      } else if (d.kind === 'beatboard') {
        for (const b of d.beats) { if (hit(b.title) || hit(b.hint)) add('Beat boards', '🧭', d.name + ' · beat', b.title + ' — ' + b.hint, () => selectDoc(d.id)); for (const c of b.cards) if (hit(c.text)) add('Beat boards', '🧭', d.name + ' · ' + b.title, c.text, () => selectDoc(d.id)); }
      } else if (d.kind === 'timeline') {
        for (const e of d.events) if (hit(e.text)) add('Timeline', '⏳', d.name + ' · backstory', e.text, () => selectDoc(d.id));
        for (const [id, w] of Object.entries(d.when)) if (hit(w)) add('Timeline', '⏳', d.name + ' · when', w, () => selectDoc(d.id));
      } else if (d.kind === 'moodboard') {
        for (const c of d.cards) if (hit(c.text) || hit(c.caption) || hit(c.url)) add('Mood boards', '🎨', d.name, c.text || c.caption || c.url, () => selectDoc(d.id));
      } else if (d.kind === 'schedule') {
        d.days.forEach((x, i) => { if (hit(x.notes)) add('Schedule', '📅', `${d.name} · day ${i + 1}`, x.notes, () => selectDoc(d.id)); });
        for (const e of d.events) if (hit(e.title) || hit(e.notes)) add('Schedule', '📅', `${d.name} · ${e.date}`, e.title + (e.notes ? ' — ' + e.notes : ''), () => { state.kindTab.schedule = 'calendar'; selectDoc(d.id); });
      } else if (d.kind === 'relations') {
        for (const l of d.links) { const t = [l.label, ...l.changes.map((c) => c.label)].filter(Boolean).join(' · '); if (hit(t)) add('Relationships', '🕸️', d.name, t, () => { selectDoc(d.id); }); }
      } else if (d.kind === 'budget') {
        for (const m of d.manual) if (hit(m.label)) add('Budget', '💶', d.name, m.label, () => selectDoc(d.id));
      }
      if (hit(d.name) && d.kind !== 'note') add('Documents', '📄', d.name, (SD.KINDS[d.kind] || {}).label || d.kind, () => selectDoc(d.id));
    }
    for (const c of p.catalog) {
      const fields = Object.values(c.fields || {}).filter((v) => typeof v === 'string');
      const t = [c.name, c.description, c.tags, ...fields, ...(c.custom || []).map((x) => x.value)].filter(Boolean).join(' · ');
      if (hit(t)) add('Catalog', '🗂️', SD.categoryById(c.category).one + ': ' + c.name, hit(c.name) ? c.description || '' : t, () => openCatalogItem(c.id));
    }
    return out;
  }

  async function openSearch(initial) {
    const input = h('input', { class: 'input search-in', placeholder: 'Search scripts, notes, catalog, comments, storyboard, schedule…', value: initial || '' });
    const list = h('div', { class: 'search-results' });
    let results = [], sel = 0, closeIt = null;
    const mark = (text) => {
      const t = text.replace(/\s+/g, ' ');
      const q = input.value.trim().toLowerCase();
      const i = t.toLowerCase().indexOf(q);
      if (i < 0) return t.slice(0, 140);
      const a = Math.max(0, i - 50);
      return [a ? '…' : '', t.slice(a, i), h('mark', {}, t.slice(i, i + q.length)), t.slice(i + q.length, i + q.length + 90), t.length > i + q.length + 90 ? '…' : ''];
    };
    const draw = () => {
      results = searchProject(input.value);
      sel = Math.min(sel, Math.max(0, results.length - 1));
      const groups = new Map();
      results.slice(0, 300).forEach((r, i) => { if (!groups.has(r.group)) groups.set(r.group, []); groups.get(r.group).push([r, i]); });
      list.replaceChildren(...(input.value.trim().length < 2 ? [h('p', { class: 'muted small' }, 'Type at least two letters.')] : results.length ? [...groups.entries()].map(([g, rs]) => h('div', { class: 'sr-group' },
        h('div', { class: 'sr-head' }, g, h('span', { class: 'muted' }, ' ' + rs.length)),
        rs.map(([r, i]) => h('button', { class: 'sr-item' + (i === sel ? ' on' : ''), dataset: { i }, onclick: () => go(i) }, h('span', { class: 'sr-icon' }, r.icon), h('span', { class: 'sr-body' }, h('span', { class: 'sr-title' }, r.title), h('span', { class: 'sr-text' }, mark(r.text))))))) : [h('p', { class: 'muted' }, 'Nothing found.')]));
      if (results.length > 300) list.append(h('p', { class: 'muted small' }, `Showing the first 300 of ${results.length}.`));
    };
    const go = (i) => { const r = results[i]; if (!r) return; if (closeIt) closeIt(); setTimeout(() => r.go(), 20); };
    input.addEventListener('input', debounce(() => { sel = 0; draw(); }, 150));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, Math.min(results.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1))); list.querySelectorAll('.sr-item').forEach((b) => b.classList.toggle('on', +b.dataset.i === sel)); const on = list.querySelector('.sr-item.on'); if (on) on.scrollIntoView({ block: 'nearest' }); }
      if (e.key === 'Enter') { e.preventDefault(); go(sel); }
    });
    draw();
    const pr = modal({ title: 'Search everything', wide: true, body: h('div', { class: 'search-box' }, input, list), buttons: [{ label: 'Close', value: true }] });
    closeIt = () => { const b = document.querySelector('.modal-backdrop:last-child .modal-actions .btn'); if (b) b.click(); };
    setTimeout(() => { input.focus(); input.select(); }, 30);
    await pr;
  }

  // =====================================================================
  // project home
  // =====================================================================
  function renderHome(root) {
    const p = state.project;
    syncEditor();
    const scripts = p.documents.filter((d) => d.kind === 'script');
    const main = scripts.slice().sort((a, b) => b.elements.length - a.elements.length)[0] || null;
    const g = goals();
    const today = logToday();
    const pages = scripts.reduce((n, d) => n + SD.estimate(d).pages, 0);
    const words = scripts.reduce((n, d) => n + SD.wordCount(d), 0);
    const tile = (v, l, sub, onclick) => h(onclick ? 'button' : 'div', { class: 'stat' + (onclick ? ' click' : ''), onclick }, h('div', { class: 'stat-v' }, v), h('div', { class: 'stat-l' }, l), sub ? h('div', { class: 'stat-sub' }, sub) : null);
    const sec = (title, ...kids) => h('section', { class: 'chart-card home-sec' }, h('h3', {}, title), ...kids);

    // what needs attention
    const todo = [];
    const need = (icon, text, go) => todo.push(h('button', { class: 'home-todo', onclick: go }, h('span', {}, icon), h('span', {}, text)));
    if (main) {
      const scs = SD.getScenes(main);
      const noSyn = scs.filter((s) => !s.el.synopsis).length;
      if (noSyn) need('📇', `${noSyn} scene${noSyn === 1 ? '' : 's'} in “${main.name}” without a synopsis`, () => { state.docId = main.id; state.view = 'cards'; renderDocList(); renderView(); });
      const noTemp = scs.filter((s) => s.el.temp == null).length;
      if (noTemp && noTemp < scs.length) need('🌡', `${noTemp} scene${noTemp === 1 ? '' : 's'} without a temperature`, () => selectDoc(main.id));
    }
    for (const d of scripts) { const n = commentCount(d); if (n) need('💬', `${n} open comment${n === 1 ? '' : 's'} in “${d.name}”`, () => showAllComments(d)); }
    const actors = p.catalog.filter((c) => c.category === 'actor');
    if (actors.length && main) {
      const cast = new Set(p.catalog.filter((c) => c.category === 'character' && c.links && c.links.playedBy).map((c) => c.name.trim().toUpperCase()));
      const uncast = characterStats(main).filter((c) => c.speeches && !cast.has(c.name));
      if (uncast.length) need('🎭', `${uncast.length} speaking part${uncast.length === 1 ? '' : 's'} not cast: ${uncast.slice(0, 5).map((c) => c.name).join(', ')}`, () => selectDoc('__catalog'));
    }
    for (const d of p.documents) {
      if (d.kind === 'beatboard') { const n = d.beats.filter((b) => !b.cards.length).length; if (n) need('🧭', `${n} empty beat${n === 1 ? '' : 's'} on “${d.name}”`, () => selectDoc(d.id)); }
      if (d.kind === 'schedule') { const src = p.documents.find((x) => x.id === d.sourceId); if (src) { const all = SD.getScenes(src).length; const done = new Set(d.days.flatMap((x) => x.scenes)).size; if (all > done) need('📅', `${all - done} scene${all - done === 1 ? '' : 's'} not scheduled in “${d.name}”`, () => selectDoc(d.id)); } }
      if (d.kind === 'budget' && SD.KINDS.budget) { const st = SD.KINDS.budget.status(d); const m = st.match(/(\d+) items without a price/); if (m && +m[1]) need('💶', `${m[1]} item${+m[1] === 1 ? '' : 's'} without a price in “${d.name}”`, () => selectDoc(d.id)); }
      if (d.kind === 'locmap') { const n = p.catalog.filter((c) => c.category === 'location' && !c.fields.lat).length; if (n) need('🗺️', `${n} location${n === 1 ? '' : 's'} not on the map`, () => selectDoc(d.id)); }
    }

    const recent = p.documents.filter((d) => d.modified).sort((a, b) => b.modified.localeCompare(a.modified)).slice(0, 6);
    const icon = (d) => (SD.KINDS[d.kind] ? SD.KINDS[d.kind].icon : d.kind === 'note' ? '📝' : d.kind === 'storyline' ? '〰️' : d.kind === 'storyboard' ? '🎞️' : SD.SCRIPT_TYPES[d.scriptType].icon);
    const ago = (iso) => { const m = (Date.now() - new Date(iso).getTime()) / 60000; return m < 1 ? 'just now' : m < 60 ? Math.round(m) + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : new Date(iso).toLocaleDateString(); };
    const cast = main ? characterStats(main).filter((c) => c.speeches).slice(0, 10) : [];
    const searchIn = h('input', { class: 'input home-search', placeholder: '🔍  Search the whole project…', onkeydown: (e) => { if (e.key === 'Enter') openSearch(e.target.value); } });

    let curve = null;
    if (main) {
      const all = SD.getScenes(main);
      const temps = all.filter((s) => s.el.temp != null);
      if (temps.length >= 2) {
        const W = 600, CH = 90;
        const x = (i) => 10 + (i / Math.max(1, all.length - 1)) * (W - 20), y = (t) => CH - (t / 10) * (CH - 10);
        const pts = temps.map((s) => `${x(all.indexOf(s))},${y(s.el.temp)}`).join(' ');
        curve = svgEl('svg', { viewBox: `0 0 ${W} ${CH}`, class: 'home-curve', role: 'img', 'aria-label': 'Tension curve' }, svgEl('polyline', { points: pts, class: 'hline s1' }), ...temps.map((s) => svgEl('circle', { cx: x(all.indexOf(s)), cy: y(s.el.temp), r: 4, class: 'hdot s1' })));
      }
    }

    root.append(h('div', { class: 'view-pad home viz-root' },
      h('div', { class: 'home-top' },
        h('div', { class: 'home-title' },
          h('h1', {}, p.title || 'Untitled project'),
          h('textarea', { class: 'home-logline', rows: 2, value: p.logline || '', placeholder: 'Your logline: who wants what, what stands in the way, and what is at stake — in one or two sentences.', oninput: (e) => { p.logline = e.target.value; markDirty(); } })),
        searchIn),
      h('div', { class: 'health-tiles' },
        tile(pages, 'Script pages (est.)', g.pages ? Math.min(100, Math.round((pages / g.pages) * 100)) + '% of ' + g.pages : null),
        tile(words.toLocaleString(), 'Words in scripts'),
        main ? tile(fmtTime(runtimeOf(main)), 'Running time', 'of “' + main.name + '”', () => { state.docId = main.id; state.view = 'reports'; state.reportTab = 'health'; renderDocList(); renderView(); }) : null,
        tile((today.words || 0).toLocaleString() + (g.daily ? ' / ' + g.daily : ''), 'Words today', g.daily && today.words >= g.daily ? 'Goal reached 🎉' : 'goal & sprint timer: ⏱', openGoals),
        tile(p.catalog.length, 'Catalog items', null, () => selectDoc('__catalog'))),
      h('div', { class: 'home-grid' },
        sec('Needs attention', todo.length ? h('div', { class: 'home-todos' }, todo) : h('p', { class: 'muted small' }, 'Nothing waiting. 🎉')),
        sec('Recently changed', recent.length ? h('div', { class: 'home-list' }, recent.map((d) => h('button', { class: 'home-doc', onclick: () => selectDoc(d.id) }, h('span', {}, icon(d)), h('span', { class: 'home-doc-name' }, d.name), h('span', { class: 'muted small' }, ago(d.modified))))) : h('p', { class: 'muted small' }, 'Documents you change show up here.')),
        sec('Cast', cast.length ? h('div', { class: 'home-list' }, cast.map((c) => { const it = SD.findCatalogItem(p, 'character', c.name); const actor = it && it.links && it.links.playedBy && p.catalog.find((x) => x.id === it.links.playedBy); return h('div', { class: 'home-cast' }, h('button', { class: 'linklike', onclick: () => openCatalogItem(it ? it.id : null, { category: 'character', name: c.name }) }, c.name), h('span', { class: 'muted small' }, `${c.speeches} speeches${actor ? ' · ' + actor.name : ''}`), h('button', { class: 'btn ghost small', title: 'Voice check', onclick: () => voiceCheck(c.name) }, '🗣')); })) : h('p', { class: 'muted small' }, 'Characters appear once your script has dialogue.')),
        sec('Tension', curve ? [curve, h('p', { class: 'muted small' }, `“${main.name}”: the temperature of each scene, start to end.`)] : h('p', { class: 'muted small' }, 'Give scenes a temperature in the scene panel to see the shape of the story here.')),
        sec('Documents', h('div', { class: 'home-list' }, p.documents.map((d) => h('button', { class: 'home-doc', onclick: () => selectDoc(d.id) }, h('span', {}, icon(d)), h('span', { class: 'home-doc-name' }, d.name), h('span', { class: 'muted small' }, d.kind === 'script' ? SD.SCRIPT_TYPES[d.scriptType].label : (SD.KINDS[d.kind] || {}).label || (d.kind === 'note' ? 'Notes' : d.kind === 'storyline' ? 'Storyline' : 'Storyboard')))))))));
  }

  // Print any nodes through #print-root.
  async function printNodes(className, nodes, opts = {}) {
    const root = $('#print-root');
    root.className = className;
    root.removeAttribute('style');
    root.replaceChildren(...nodes);
    const decoded = Promise.all([...root.querySelectorAll('img')].map((im) => (im.decode ? im.decode().catch(() => {}) : null)));
    await Promise.race([decoded, new Promise((r) => setTimeout(r, 1500))]);
    const pageStyle = $('#page-size-style');
    const before = pageStyle.textContent;
    const size = state.project.settings.pageSize === 'a4' ? 'A4' : 'letter';
    pageStyle.textContent = `@page { size: ${size}${opts.landscape ? ' landscape' : ''}; margin: ${opts.margin || '0.6in'}; }`;
    const docTitle = document.title;
    if (opts.title) document.title = safeName(opts.title);
    window.addEventListener('afterprint', () => { pageStyle.textContent = before; document.title = docTitle; }, { once: true });
    window.print();
  }

  // What the plug-in document kinds may use.
  SD.ui = {
    h, $, modal, promptText, popupMenu, toast, download, safeName, debounce, printNodes,
    get state() { return state; },
    get project() { return state.project; },
    markDirty: () => markDirty(),
    currentDoc: () => currentDoc(),
    renderView: () => renderView(),
    renderNavigator: () => renderNavigator(),
    renderNavigatorSoon: () => renderNavigatorSoon(),
    renderStatus: () => renderStatus(),
    renderStatusSoon: () => renderStatusSoon(),
    renderDocList: () => renderDocList(),
    openCatalogItem: (id, create) => openCatalogItem(id, create),
    goToScene: (docId, sceneId) => { syncEditor(); state.docId = docId; state.view = 'script'; state.editorStale = true; renderDocList(); renderView(); requestAnimationFrame(() => editor.goTo(sceneId)); setTimeout(() => editor.goTo(sceneId), 60); },
    syncEditor: () => syncEditor(),
    tab: (kind, fallback) => state.kindTab[kind] || fallback,
  };

  async function openExample(path, name) {
    try {
      const res = await fetch(path);
      if (!res.ok) throw new Error(res.status);
      const file = new File([await res.blob()], (name || path.split('/').pop()));
      await openFile(file, null);
      state.fileName = null;
      renderSaveState();
    } catch (e) {
      modal({ title: 'Could not load the example', body: 'The example file could not be loaded. If you opened index.html straight from your computer, the examples only work on the website or a local server.' });
    }
  }

  function toastAction(msg, label, fn) {
    const t = h('div', { class: 'toast with-action', role: 'status' }, h('span', {}, msg), h('button', { class: 'btn small', onclick: () => { t.remove(); fn(); } }, label));
    $('#toasts').append(t);
    setTimeout(() => t.classList.add('out'), 12000);
    setTimeout(() => t.remove(), 12500);
  }

  let installEvent = null;
  async function installApp() {
    if (!installEvent) { modal({ title: 'Install Scriptdesk', body: 'In Chrome or Edge, use the install icon at the right of the address bar. In Safari on iPhone or iPad, tap Share and then “Add to Home Screen”. On a Mac in Safari, use File → Add to Dock.' }); return; }
    installEvent.prompt();
    await installEvent.userChoice.catch(() => {});
    installEvent = null;
    $('#install-btn').hidden = true;
  }

  function setupOffline() {
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; const b = $('#install-btn'); if (b) b.hidden = false; });
    window.addEventListener('appinstalled', () => { const b = $('#install-btn'); if (b) b.hidden = true; toast('Scriptdesk is installed. It works without an internet connection.'); });
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    // while developing on this computer the offline copy would hide your changes; add ?sw=1 to test it
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && !/[?&]sw=1/.test(location.search)) {
      navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
      return;
    }
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) toastAction('A new version of Scriptdesk is ready.', 'Reload', () => { if (state.dirty) autosave(); setTimeout(() => location.reload(), 300); });
        });
      });
    }).catch(() => {});
    // files opened with the installed app (double-click a .scriptdesk file)
    if ('launchQueue' in window) {
      window.launchQueue.setConsumer(async (params) => {
        for (const handle of params.files || []) { const f = await handle.getFile(); await openFile(f, handle); break; }
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => { init(); setupOffline(); });
})();
