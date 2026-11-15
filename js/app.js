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

  const state = {
    project: null,
    docId: null,
    view: 'script',
    fileHandle: null,
    fileName: null,
    dirty: false,
    sceneId: null,
    caretIndex: 0,
    reportTab: 'scenes',
    catalogFilter: 'all',
    editorStale: true,
  };
  let editor;

  // Read the editor back into the model — only while it is on screen and current,
  // otherwise its (stale) DOM would overwrite edits made in other views.
  const syncEditor = () => {
    if (editor && editor.doc && !state.editorStale && !$('#editor-wrap').hidden) editor.sync();
  };

  const currentDoc = () => state.project.documents.find((d) => d.id === state.docId) || null;
  const isCatalog = () => state.docId === '__catalog';

  // =====================================================================
  // init
  // =====================================================================
  function init() {
    applyTheme(store.get(KEYS.theme) || 'system');
    editor = new SD.ScriptEditor($('#editor'), {
      onChange: onEditorChange,
      onCaret,
      getSuggestions,
    });
    bindChrome();
    applyZoom(+store.get(KEYS.zoom) || 100);

    let restored = null;
    const saved = store.get(KEYS.autosave);
    if (saved) {
      try {
        const d = JSON.parse(saved);
        restored = SD.migrate(d.project);
        state.fileName = d.fileName || null;
        state.dirty = !!d.dirty;
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
    state.docId = first ? first.id : '__catalog';
    state.view = 'script';
    state.sceneId = null;
    state.editorStale = true;
    editor.histories = {};
    editor.doc = null;
    applyProjectSettings();
    renderAll();
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
  const autosave = debounce(() => {
    if (!state.project) return;
    const ok = store.set(KEYS.autosave, JSON.stringify({ project: state.project, fileName: state.fileName, dirty: state.dirty }));
    if (!ok && !autosave.warned) { autosave.warned = true; toast('Browser storage is full or blocked — remember to Save your project file.'); }
  }, 700);

  function markDirty() {
    state.dirty = true;
    state.project.modified = new Date().toISOString();
    renderSaveState();
    autosave();
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

  function onEditorChange() {
    markDirty();
    refreshDerived();
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
    if (type === 'transition') {
      return SD.TRANSITIONS.filter((t) => t.startsWith(up) && t !== up).map((t) => ({ label: t, value: t, complete: true }));
    }
    return [];
  }

  // =====================================================================
  // project tree (sidebar)
  // =====================================================================
  function renderDocList() {
    const list = $('#doc-list');
    const items = state.project.documents.map((d) => {
      const icon = d.kind === 'note' ? '📝' : SD.SCRIPT_TYPES[d.scriptType].icon;
      const sub = d.kind === 'note' ? 'Notes' : SD.SCRIPT_TYPES[d.scriptType].label;
      return h('li', {
        class: 'doc-item' + (d.id === state.docId ? ' active' : ''),
        title: sub,
        onclick: () => selectDoc(d.id),
        ondblclick: () => renameDoc(d),
      },
      h('span', { class: 'doc-icon' }, icon),
      h('span', { class: 'doc-name' }, d.name),
      h('button', { class: 'icon-btn doc-more', title: 'More…', 'aria-label': 'Document options', onclick: (e) => { e.stopPropagation(); docMenu(e.currentTarget, d); } }, '⋯'));
    });
    items.push(h('li', {
      class: 'doc-item catalog-item' + (isCatalog() ? ' active' : ''),
      onclick: () => selectDoc('__catalog'),
    }, h('span', { class: 'doc-icon' }, '🗂️'), h('span', { class: 'doc-name' }, 'Master Catalog'), h('span', { class: 'doc-count' }, state.project.catalog.length || '')));
    list.replaceChildren(...items);
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
    if (kind === 'note') d = SD.newNote(count((x) => x.kind === 'note') ? 'Notes ' + (count((x) => x.kind === 'note') + 1) : 'Notes');
    else {
      const n = count((x) => x.scriptType === kind);
      d = SD.newScript(kind, SD.SCRIPT_TYPES[kind].label + (n ? ' ' + (n + 1) : ''));
      d.titlePage.title = state.project.title !== 'Untitled Project' ? state.project.title : '';
    }
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
    const i = docs.indexOf(d), j = i + dir;
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
      { label: 'Delete…', danger: true, run: () => deleteDoc(d) },
    ];
    popupMenu(anchor, items);
  }

  // ---------- scene navigator ----------
  function renderNavigator() {
    const list = $('#scene-list');
    const d = currentDoc();
    if (!d || d.kind !== 'script') {
      list.replaceChildren(h('li', { class: 'side-empty' }, isCatalog() ? 'Pick a script to see its scenes.' : 'Notes have no scenes.'));
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
      else if (!d) ov.append(h('div', { class: 'empty-state' }, h('p', {}, 'This project has no documents. Use + in the sidebar to add one.')));
      else if (d.kind === 'note') renderNote(ov, d);
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
    if (!d) { tabs.replaceChildren(); return; }
    if (d.kind === 'note') { tabs.replaceChildren(h('div', { class: 'view-title' }, '📝 ' + d.name)); return; }
    const defs = [['script', 'Script'], ['title', 'Title Page'], ['cards', d.scriptType === 'comic' ? 'Page Cards' : 'Index Cards'], ['reports', 'Reports']];
    tabs.replaceChildren(...defs.map(([v, label]) => h('button', {
      class: 'tab' + (state.view === v ? ' active' : ''),
      onclick: () => setView(v),
    }, label)));
  }

  function renderToolbar() {
    const tb = $('#toolbar');
    const d = currentDoc();
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
      h('div', { class: 'tb-group' },
        h('button', { class: 'icon-btn', title: 'Undo (Ctrl+Z)', 'aria-label': 'Undo', onclick: () => editor.undo() }, '↶'),
        h('button', { class: 'icon-btn', title: 'Redo (Ctrl+Y)', 'aria-label': 'Redo', onclick: () => editor.redo() }, '↷')),
      h('label', { class: 'tb-check', title: 'Show scene numbers' },
        h('input', { type: 'checkbox', checked: s.sceneNumbers, onchange: (e) => { s.sceneNumbers = e.target.checked; applyProjectSettings(); markDirty(); } }), '#'),
      h('select', { class: 'select', title: 'Zoom', onchange: (e) => applyZoom(+e.target.value) },
        [75, 90, 100, 110, 125, 150].map((z) => h('option', { value: z, selected: z === state.zoom }, z + '%'))),
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
    const catSelect = h('select', { class: 'select' }, SD.CATEGORIES.filter((c) => c.id !== 'character' && c.id !== 'location').concat(SD.CATEGORIES.filter((c) => c.id === 'character' || c.id === 'location'))
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
        chars.length ? h('div', { class: 'chips' }, chars.map((n) => h('span', { class: 'chip', style: `--chip:${SD.categoryById('character').color}` }, n))) : h('p', { class: 'muted small' }, 'None yet — they appear automatically from Character elements.')),
      h('div', { class: 'ins-section' },
        h('label', { class: 'lbl' }, 'Breakdown'),
        items.length
          ? h('div', { class: 'breakdown' }, [...grouped.entries()].map(([cat, list]) => h('div', { class: 'bd-group' },
            h('div', { class: 'bd-cat', style: `--chip:${SD.categoryById(cat).color}` }, SD.categoryById(cat).label),
            h('div', { class: 'chips' }, list.map((it) => h('span', { class: 'chip', style: `--chip:${SD.categoryById(cat).color}` }, it.name,
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
    if (!item) { item = { id: SD.uid(), category, name, description: '' }; cat.push(item); }
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
    const tabs = [['scenes', 'Scenes'], ['characters', 'Characters'], ['locations', 'Locations'], ['breakdown', 'Breakdown sheets']];
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
        h('button', { class: 'btn small push-right', onclick: () => printReport(d) }, 'Print / PDF')),
      buildReport(d, state.reportTab)));
  }
  const stat = (label, value) => h('div', { class: 'stat' }, h('div', { class: 'stat-v' }, value), h('div', { class: 'stat-l' }, label));

  // ---------- Notes ----------
  function renderNote(root, d) {
    const ta = h('textarea', {
      class: 'note-editor', value: d.text, placeholder: 'Ideas, outlines, research, character bios…', spellcheck: true,
      oninput: (e) => { d.text = e.target.value; markDirty(); renderStatusSoon(); },
    });
    root.append(h('div', { class: 'note-wrap' }, ta));
    setTimeout(() => ta.focus(), 0);
  }

  // ---------- Master catalog ----------
  function renderCatalog(root) {
    const p = state.project;
    const usage = SD.catalogUsage(p);
    const filter = state.catalogFilter;
    const counts = {};
    p.catalog.forEach((c) => { counts[c.category] = (counts[c.category] || 0) + 1; });
    const visible = p.catalog.filter((c) => filter === 'all' || c.category === filter).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

    const addItem = () => {
      const item = { id: SD.uid(), category: filter === 'all' ? 'character' : filter, name: '', description: '' };
      p.catalog.push(item);
      markDirty();
      renderView();
      renderDocList();
      setTimeout(() => document.querySelector(`[data-item="${item.id}"] input`)?.focus(), 0);
    };

    const scan = () => {
      let added = 0;
      const has = (cat, n) => p.catalog.some((c) => c.category === cat && c.name.trim().toUpperCase() === n);
      for (const d of p.documents) {
        if (d.kind !== 'script') continue;
        for (const e of d.elements) {
          if (e.type === 'character') { const n = SD.charName(e.text); if (n && !has('character', n)) { p.catalog.push({ id: SD.uid(), category: 'character', name: n, description: '' }); added++; } }
          if (e.type === 'scene' && d.scriptType !== 'comic') { const l = SD.parseSceneHeading(e.text).location; if (l && !has('location', l)) { p.catalog.push({ id: SD.uid(), category: 'location', name: l, description: '' }); added++; } }
        }
      }
      if (added) markDirty();
      toast(added ? `Added ${added} new item${added > 1 ? 's' : ''} from your scripts.` : 'Everything in your scripts is already in the catalog.');
      renderView();
      renderDocList();
    };

    const card = (c) => {
      const used = usage.get(c.id) || [];
      const byDoc = new Map();
      for (const u of used) { if (!byDoc.has(u.doc)) byDoc.set(u.doc, []); byDoc.get(u.doc).push(u.scene.number); }
      const cat = SD.categoryById(c.category);
      return h('div', { class: 'cat-card', dataset: { item: c.id }, style: `--chip:${cat.color}` },
        h('div', { class: 'cat-row' },
          h('input', { class: 'cat-name', value: c.name, placeholder: 'Name', oninput: (e) => { c.name = e.target.value; markDirty(); } }),
          h('select', { class: 'select small', onchange: (e) => { c.category = e.target.value; markDirty(); renderView(); } },
            SD.CATEGORIES.map((k) => h('option', { value: k.id, selected: k.id === c.category }, k.one))),
          h('button', {
            class: 'icon-btn', title: 'Delete item', 'aria-label': 'Delete ' + c.name,
            onclick: async () => {
              const ok = await modal({ title: 'Delete “' + (c.name || 'item') + '”?', body: 'It will also be removed from every scene breakdown.', buttons: [{ label: 'Cancel', value: false }, { label: 'Delete', value: true, primary: true, danger: true }] });
              if (!ok) return;
              p.catalog.splice(p.catalog.indexOf(c), 1);
              for (const d of p.documents) if (d.elements) for (const e of d.elements) if (e.items) e.items = e.items.filter((x) => x !== c.id);
              markDirty(); renderView(); renderDocList();
            },
          }, '×')),
        h('textarea', { class: 'input cat-desc', rows: 3, placeholder: c.category === 'character' ? 'Description, age, look, backstory…' : 'Description…', value: c.description || '', oninput: (e) => { c.description = e.target.value; markDirty(); } }),
        h('div', { class: 'cat-usage muted small' },
          used.length ? [...byDoc.entries()].map(([d, nums]) => `${d.name}: scene${nums.length > 1 ? 's' : ''} ${nums.join(', ')}`).join(' · ') : 'Not used in any scene yet'));
    };

    root.append(h('div', { class: 'view-pad' },
      h('div', { class: 'view-head' },
        h('h2', {}, 'Master Catalog'),
        h('p', { class: 'muted' }, 'Everything your stories need: characters, locations, props and more. Shared by all scripts in this project.'),
        h('div', { class: 'row-gap' },
          h('button', { class: 'btn primary', onclick: addItem }, '+ Add item'),
          h('button', { class: 'btn', onclick: scan, title: 'Find character names and locations in your scripts' }, 'Import characters & locations from scripts'))),
      h('div', { class: 'subtabs wrap' },
        h('button', { class: 'tab' + (filter === 'all' ? ' active' : ''), onclick: () => { state.catalogFilter = 'all'; renderView(); } }, `All ${p.catalog.length}`),
        SD.CATEGORIES.filter((c) => counts[c.id] || c.id === filter || ['character', 'location', 'prop'].includes(c.id)).map((c) => h('button', {
          class: 'tab' + (filter === c.id ? ' active' : ''), style: `--chip:${c.color}`,
          onclick: () => { state.catalogFilter = c.id; renderView(); },
        }, h('span', { class: 'dot' }), `${c.label} ${counts[c.id] || 0}`))),
      visible.length ? h('div', { class: 'cat-grid' }, visible.map(card)) : h('div', { class: 'empty-state' }, h('p', {}, 'No items here yet.'))));
  }

  // =====================================================================
  // status bar
  // =====================================================================
  function renderStatus() {
    const bar = $('#status-left');
    const d = currentDoc();
    if (!d || isCatalog()) { bar.textContent = isCatalog() ? `${state.project.catalog.length} catalog items` : ''; return; }
    if (d.kind === 'note') { bar.textContent = `Notes · ${((d.text || '').match(/\S+/g) || []).length.toLocaleString()} words`; return; }
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
        await importDocs(res.documents, res.title);
      } else if (['.fountain', '.spmd', '.txt'].includes(ext)) {
        const parsed = SD.Fountain.parse(await file.text());
        const d = SD.newScript('screenplay', base);
        d.elements = parsed.elements;
        Object.assign(d.titlePage, parsed.titlePage);
        await importDocs([d], parsed.titlePage.title || base);
      } else if (ext === '.fdx') {
        const parsed = SD.FDX.parse(await file.text());
        const d = SD.newScript('screenplay', base);
        d.elements = parsed.elements;
        Object.assign(d.titlePage, parsed.titlePage);
        await importDocs([d], parsed.titlePage.title || base);
      } else {
        let data;
        try { data = JSON.parse(await file.text()); } catch (e) { throw new Error('This file is not a Scriptdesk project.'); }
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
    return p.catalog.length > 0 || p.documents.some((d) => (d.kind === 'note' ? d.text.trim() : d.elements.some((e) => e.text.trim())));
  }

  async function importDocs(docs, title) {
    let mode = 'new';
    if (projectHasContent()) {
      mode = await modal({
        title: 'Import ' + (docs.length > 1 ? docs.length + ' documents' : '“' + docs[0].name + '”'),
        body: 'Add to the project you have open, or start a new project with it?',
        buttons: [{ label: 'Cancel', value: null }, { label: 'New project', value: 'new' }, { label: 'Add to this project', value: 'add', primary: true }],
      });
      if (!mode) return;
    }
    if (mode === 'new') {
      if (projectHasContent() && !(await confirmDiscard('Start a new project anyway?'))) return;
      const p = SD.newProject();
      p.title = title || 'Imported Project';
      p.documents = docs;
      setProject(p);
      state.dirty = true;
      renderSaveState();
      autosave();
    } else {
      state.project.documents.push(...docs);
      markDirty();
      selectDoc(docs[0].id);
    }
    toast(`Imported ${docs.length} document${docs.length > 1 ? 's' : ''}.`);
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
    const d = scriptForExport();
    if (!d) return;
    const root = $('#print-root');
    root.className = 'print-script';
    root.replaceChildren();
    const tp = d.titlePage;
    if (tp.enabled !== false && (tp.title || tp.author)) root.append(titlePageNode(tp));
    const body = h('div', { class: scriptTextClasses() });
    body.dataset.scriptType = d.scriptType;
    for (const e of d.elements) {
      const div = h('div', { class: 'el' + (e.text ? '' : ' is-empty') }, e.text || ' ');
      div.dataset.type = e.type;
      body.append(div);
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
        onclick: () => { store.del(KEYS.autosave); toast('Browser copy cleared. It will be saved again on your next change.'); },
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
    document.body.append(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.top = Math.min(r.bottom + 4, window.innerHeight - menu.offsetHeight - 8) + 'px';
    menu.style.left = Math.min(r.left, window.innerWidth - menu.offsetWidth - 8) + 'px';
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
      'add-screenplay': () => addDoc('screenplay'),
      'add-stageplay': () => addDoc('stageplay'),
      'add-audioplay': () => addDoc('audioplay'),
      'add-comic': () => addDoc('comic'),
      'add-note': () => addDoc('note'),
      'toggle-sidebar': () => document.body.classList.toggle('show-sidebar'),
    };
    document.addEventListener('click', (e) => {
      const a = e.target.closest('[data-action]');
      if (a) { closeMenus(); actions[a.dataset.action]?.(); return; }
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

  document.addEventListener('DOMContentLoaded', init);
})();
