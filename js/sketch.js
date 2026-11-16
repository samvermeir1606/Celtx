/* Scriptdesk — sketch: a top-down plan of a set with cameras, lights, actors, furniture, walls and movement arrows */
(function () {
  'use strict';
  const SD = (window.SD = window.SD || {});
  SD.KINDS = SD.KINDS || {};

  const W0 = 1200, H0 = 800;
  // symbols are drawn around (0,0), facing right; rot turns them, scale sizes them
  const SYMBOLS = {
    camera: { label: 'Camera', color: '#2f2f35', group: 'Crew', draw: (c, o) => `${o.fov !== false ? `<path d="M14,0 L150,-66 L150,66 Z" fill="${c}" fill-opacity="0.10" stroke="${c}" stroke-opacity="0.45" stroke-dasharray="5 5"/>` : ''}<rect x="-20" y="-13" width="30" height="26" rx="4" fill="${c}"/><path d="M9,-7 L23,-12 L23,12 L9,7 Z" fill="${c}"/><circle cx="-11" cy="-18" r="6" fill="none" stroke="${c}" stroke-width="3"/><circle cx="2" cy="-18" r="6" fill="none" stroke="${c}" stroke-width="3"/>` },
    light: { label: 'Light', color: '#e8a33d', group: 'Crew', draw: (c, o) => `${o.fov !== false ? `<path d="M10,0 L120,-44 L120,44 Z" fill="#ffc53d" fill-opacity="0.22"/>` : ''}<circle r="12" fill="${c}" stroke="#7a5200" stroke-width="2"/><rect x="10" y="-14" width="5" height="28" rx="2" fill="#7a5200"/>` },
    mic: { label: 'Boom mic', color: '#555', group: 'Crew', draw: (c) => `<line x1="-36" y1="0" x2="14" y2="0" stroke="${c}" stroke-width="3"/><ellipse cx="22" cy="0" rx="10" ry="6" fill="${c}"/>` },
    person: { label: 'Actor', color: '#2f6fd6', group: 'People', draw: (c) => `<ellipse rx="11" ry="19" fill="${c}"/><circle r="9" fill="${c}" stroke="#fff" stroke-width="2"/><path d="M8,-4 L15,0 L8,4 Z" fill="#fff"/>` },
    mark: { label: 'Mark (X)', color: '#d64541', group: 'People', draw: (c) => `<path d="M-9,-9 L9,9 M9,-9 L-9,9" stroke="${c}" stroke-width="4" stroke-linecap="round"/>` },
    table: { label: 'Table', color: '#c9a77c', group: 'Set', draw: (c) => `<rect x="-34" y="-20" width="68" height="40" rx="5" fill="${c}" stroke="#6b5030" stroke-width="2"/>` },
    chair: { label: 'Chair', color: '#a07850', group: 'Set', draw: (c) => `<rect x="-10" y="-10" width="20" height="20" rx="3" fill="${c}" stroke="#5a3f22" stroke-width="2"/><rect x="-15" y="-11" width="5" height="22" rx="2" fill="#5a3f22"/>` },
    sofa: { label: 'Sofa', color: '#8e6fb8', group: 'Set', draw: (c) => `<rect x="-38" y="-16" width="76" height="32" rx="7" fill="${c}" stroke="#4b3470" stroke-width="2"/><rect x="-38" y="-16" width="76" height="9" rx="4" fill="#4b3470" fill-opacity="0.6"/>` },
    bed: { label: 'Bed', color: '#e6e1d6', group: 'Set', draw: (c) => `<rect x="-28" y="-44" width="56" height="88" rx="5" fill="${c}" stroke="#777" stroke-width="2"/><rect x="-22" y="-39" width="44" height="14" rx="4" fill="#fff" stroke="#999"/>` },
    door: { label: 'Door', color: '#6b5030', group: 'Set', draw: (c) => `<line x1="-22" y1="0" x2="22" y2="0" stroke="#fff" stroke-width="9"/><path d="M-22,0 L-22,-44" stroke="${c}" stroke-width="3"/><path d="M-22,-44 A44,44 0 0 1 22,0" fill="none" stroke="${c}" stroke-width="1.5" stroke-dasharray="4 4"/>` },
    window: { label: 'Window', color: '#2f9ed6', group: 'Set', draw: (c) => `<rect x="-26" y="-5" width="52" height="10" fill="#fff" stroke="${c}" stroke-width="2"/><line x1="-26" y1="0" x2="26" y2="0" stroke="${c}" stroke-width="1.5"/>` },
    car: { label: 'Car', color: '#d64541', group: 'Set', draw: (c) => `<rect x="-46" y="-22" width="92" height="44" rx="12" fill="${c}" stroke="#000" stroke-opacity="0.35" stroke-width="2"/><rect x="8" y="-17" width="14" height="34" rx="4" fill="#fff" fill-opacity="0.7"/><rect x="-30" y="-17" width="10" height="34" rx="4" fill="#fff" fill-opacity="0.5"/>` },
    tree: { label: 'Tree', color: '#2f9e66', group: 'Set', draw: (c) => `<circle r="28" fill="${c}" fill-opacity="0.75" stroke="#1d6b44" stroke-width="2" stroke-dasharray="10 4"/><circle r="5" fill="#6b5030"/>` },
  };
  const SHAPES = {
    wall: { label: 'Wall', color: '#444' },
    arrow: { label: 'Movement arrow', color: '#d64541' },
    line: { label: 'Line', color: '#555' },
    rect: { label: 'Box / area', color: '#2f6fd6' },
    ellipse: { label: 'Circle / area', color: '#2f9e66' },
    text: { label: 'Text', color: '#222' },
    image: { label: 'Picture', color: '#888' },
  };
  SD.SKETCH_SYMBOLS = SYMBOLS;
  const isLine = (t) => t === 'wall' || t === 'arrow' || t === 'line';
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clampColor = (c, fallback) => (/^#[0-9a-f]{3,8}$/i.test(c || '') ? c : fallback);

  function itemSVG(it, sel) {
    const s = it.scale || 1;
    const on = sel === it.id ? ' on' : '';
    if (SYMBOLS[it.type]) {
      const c = clampColor(it.color, SYMBOLS[it.type].color);
      const label = it.label ? `<text class="sk-label" x="${it.x}" y="${it.y + 34 * s + 12}" text-anchor="middle">${esc(it.label)}</text>` : '';
      return `<g class="sk-item${on}" data-id="${esc(it.id)}"><g transform="translate(${it.x} ${it.y}) rotate(${it.rot || 0}) scale(${s})">${SYMBOLS[it.type].draw(c, it)}<circle r="30" class="sk-hit"/></g>${label}</g>`;
    }
    const c = clampColor(it.color, (SHAPES[it.type] || {}).color || '#444');
    if (isLine(it.type)) {
      const w = it.type === 'wall' ? 9 : it.type === 'arrow' ? 3 : 2;
      const dash = it.dashed || (it.type === 'arrow' && it.dashed !== false) ? ' stroke-dasharray="9 7"' : '';
      let head = '';
      if (it.type === 'arrow') {
        const a = Math.atan2(it.y2 - it.y1, it.x2 - it.x1), L = 16;
        const p = (da) => `${it.x2 - L * Math.cos(a + da)},${it.y2 - L * Math.sin(a + da)}`;
        head = `<path d="M${it.x2},${it.y2} L${p(0.45)} L${p(-0.45)} Z" fill="${c}"/>`;
      }
      const mx = (it.x1 + it.x2) / 2, my = (it.y1 + it.y2) / 2;
      const label = it.label ? `<text class="sk-label" x="${mx}" y="${my - 10}" text-anchor="middle">${esc(it.label)}</text>` : '';
      return `<g class="sk-item${on}" data-id="${esc(it.id)}"><line x1="${it.x1}" y1="${it.y1}" x2="${it.x2}" y2="${it.y2}" stroke="${c}" stroke-width="${w}" stroke-linecap="${it.type === 'wall' ? 'square' : 'round'}"${dash}/>${head}<line class="sk-hit" x1="${it.x1}" y1="${it.y1}" x2="${it.x2}" y2="${it.y2}" stroke-width="18"/>${label}</g>`;
    }
    if (it.type === 'rect' || it.type === 'ellipse') {
      const x = Math.min(it.x, it.x + it.w), y = Math.min(it.y, it.y + it.h), w = Math.abs(it.w), hh = Math.abs(it.h);
      const shape = it.type === 'rect' ? `<rect x="${x}" y="${y}" width="${w}" height="${hh}" rx="4"` : `<ellipse cx="${x + w / 2}" cy="${y + hh / 2}" rx="${w / 2}" ry="${hh / 2}"`;
      const label = it.label ? `<text class="sk-label" x="${x + w / 2}" y="${y + hh / 2 + 4}" text-anchor="middle">${esc(it.label)}</text>` : '';
      return `<g class="sk-item${on}" data-id="${esc(it.id)}">${shape} fill="${c}" fill-opacity="0.12" stroke="${c}" stroke-width="2"${it.dashed ? ' stroke-dasharray="8 6"' : ''}/>${label}</g>`;
    }
    if (it.type === 'image') {
      if (!/^data:image\//.test(it.src || '')) return '';
      return `<g class="sk-item${on}" data-id="${esc(it.id)}"><image href="${esc(it.src)}" x="${it.x}" y="${it.y}" width="${Math.abs(it.w)}" height="${Math.abs(it.h)}" preserveAspectRatio="xMidYMid meet" opacity="${it.opacity == null ? 1 : it.opacity}"/><rect class="sk-hit" x="${it.x}" y="${it.y}" width="${Math.abs(it.w)}" height="${Math.abs(it.h)}"/></g>`;
    }
    if (it.type === 'text') {
      return `<g class="sk-item${on}" data-id="${esc(it.id)}"><text x="${it.x}" y="${it.y}" fill="${c}" font-size="${(it.size || 18)}" font-weight="600" text-anchor="middle" dominant-baseline="middle">${esc(it.label || 'Text')}</text></g>`;
    }
    return '';
  }

  function handlesSVG(it) {
    if (!it) return '';
    const s = it.scale || 1;
    if (SYMBOLS[it.type]) {
      const r = ((it.rot || 0) * Math.PI) / 180, R = 52 * s;
      const hx = it.x + Math.cos(r) * R, hy = it.y + Math.sin(r) * R;
      return `<circle class="sk-ring" cx="${it.x}" cy="${it.y}" r="${34 * s}"/><line class="sk-aimline" x1="${it.x}" y1="${it.y}" x2="${hx}" y2="${hy}"/><circle class="sk-handle" data-handle="aim" cx="${hx}" cy="${hy}" r="8"><title>Drag to turn</title></circle>`;
    }
    if (isLine(it.type)) return `<circle class="sk-handle" data-handle="p1" cx="${it.x1}" cy="${it.y1}" r="8"/><circle class="sk-handle" data-handle="p2" cx="${it.x2}" cy="${it.y2}" r="8"/>`;
    if (it.type === 'rect' || it.type === 'ellipse' || it.type === 'image') return `<rect class="sk-ring" x="${Math.min(it.x, it.x + it.w)}" y="${Math.min(it.y, it.y + it.h)}" width="${Math.abs(it.w)}" height="${Math.abs(it.h)}"/><circle class="sk-handle" data-handle="size" cx="${it.x + it.w}" cy="${it.y + it.h}" r="8"/>`;
    if (it.type === 'text') return `<circle class="sk-ring" cx="${it.x}" cy="${it.y}" r="${(it.size || 18) * 0.9}"/>`;
    return '';
  }

  SD.sketchSVG = (d, opts = {}) => {
    const w = d.settings.w || W0, hh = d.settings.h || H0;
    let grid = '';
    if (d.settings.grid && !opts.forExport) {
      grid = `<defs><pattern id="skgrid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40,0 L0,0 0,40" fill="none" class="sk-gridline"/></pattern></defs><rect width="${w}" height="${hh}" fill="url(#skgrid)"/>`;
    }
    const style = opts.forExport ? `<style>.sk-label{font:600 14px system-ui,sans-serif;fill:#333}.sk-hit{fill:transparent;stroke:transparent}</style>` : '';
    const sel = opts.selection;
    const setup = opts.setup || null;
    const items = d.items.filter((it) => !it.setup || it.setup === setup).map((it) => itemSVG(it, sel)).join('');
    const handles = opts.forExport ? '' : handlesSVG(d.items.find((x) => x.id === sel));
    const draft = opts.draft ? itemSVG(opts.draft, null) : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" class="sk-svg" viewBox="0 0 ${w} ${hh}" width="${w}" height="${hh}">${style}<rect class="sk-bg" width="${w}" height="${hh}" fill="#fff"/>${grid}${items}${draft}${handles}</svg>`;
  };

  // PNG of a sketch, for the storyboard's camera setup diagram and for downloading
  SD.sketchToPng = async (d, maxW = 1200, setup = view.setup[d.id]) => {
    const w = d.settings.w || W0, hh = d.settings.h || H0;
    const k = Math.min(1, maxW / w);
    const url = URL.createObjectURL(new Blob([SD.sketchSVG(d, { forExport: true, setup })], { type: 'image/svg+xml' }));
    try {
      const im = new Image();
      await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = url; });
      const cv = document.createElement('canvas');
      cv.width = Math.round(w * k); cv.height = Math.round(hh * k);
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(im, 0, 0, cv.width, cv.height);
      return cv.toDataURL('image/png');
    } finally { URL.revokeObjectURL(url); }
  };

  // ---------- document kind ----------
  const view = { sel: null, tool: 'select', zoom: 1, hist: {}, setup: {} };
  // cameras, lights, mics, actors, marks and movement arrows belong to a setup; the rest is the set
  const PER_SETUP = new Set(['camera', 'light', 'mic', 'person', 'mark', 'arrow']);
  const activeSetup = (d) => (d.setups.some((x) => x.id === view.setup[d.id]) ? view.setup[d.id] : null);

  // Setups: one set, a layout of cameras and actors for each shot (used by the storyboard).
  SD.sketchSetups = {
    create(d, name, copyFrom) {
      const st = { id: SD.uid(), name: name || 'Setup ' + (d.setups.length + 1) };
      d.setups.push(st);
      if (copyFrom) for (const it of d.items.filter((x) => x.setup === copyFrom)) d.items.push(Object.assign(JSON.parse(JSON.stringify(it)), { id: SD.uid(), setup: st.id }));
      view.setup[d.id] = st.id;
      return st;
    },
    open(docId, setupId) {
      const U = SD.ui;
      view.setup[docId] = setupId || null;
      view.sel = null;
      U.syncEditor();
      U.state.docId = docId;
      U.renderDocList();
      U.renderView();
    },
    usedBy(d, setupId) {
      const out = [];
      for (const sb of SD.ui.project.documents) {
        if (sb.kind !== 'storyboard') continue;
        const nums = SD.storyboardNumbers(SD.ui.project, sb);
        for (const sq of sb.sequences) sq.shots.forEach((x, i) => { if (x.setupRef && x.setupRef.sketch === d.id && x.setupRef.setup === setupId) out.push(nums.get(sq.id) + SD.shotLetters(i)); });
      }
      return out;
    },
  };
  const hist = (d) => (view.hist[d.id] = view.hist[d.id] || { undo: [], redo: [] });
  const snap = (d) => { const hs = hist(d); hs.undo.push(JSON.stringify(d.items)); if (hs.undo.length > 80) hs.undo.shift(); hs.redo.length = 0; };

  const K = {
    icon: '📐',
    label: 'Sketch',
    create(project, name) { return { id: SD.uid(), kind: 'sketch', name, items: [], setups: [], settings: { grid: true, snap: true, w: W0, h: H0 } }; },
    normalize(d) {
      d.items = Array.isArray(d.items) ? d.items.filter((x) => x && x.type) : [];
      d.setups = (Array.isArray(d.setups) ? d.setups : []).filter((x) => x && x.id).map((x) => ({ id: x.id, name: x.name || 'Setup' }));
      const ids = new Set(d.setups.map((x) => x.id));
      for (const it of d.items) if (it.setup && !ids.has(it.setup)) delete it.setup;
      d.settings = Object.assign({ grid: true, snap: true, w: W0, h: H0 }, d.settings || {});
      for (const it of d.items) { it.id = it.id || SD.uid(); for (const k of ['x', 'y', 'x1', 'y1', 'x2', 'y2', 'w', 'h', 'rot', 'scale', 'size']) if (it[k] != null) it[k] = +it[k] || 0; }
    },
    hasContent: (d) => d.items.length > 0,
    status: (d) => `Sketch  ·  ${d.items.filter((x) => !x.setup).length} set pieces  ·  ${d.setups.length} setup${d.setups.length === 1 ? '' : 's'}  ·  Delete removes, Ctrl+Z undoes`,
    navigator(d) {
      return {
        label: 'Objects', empty: 'Add cameras, actors and set pieces from the palette.',
        items: d.items.filter((it) => !it.setup || it.setup === activeSetup(d)).map((it, i) => ({ num: i + 1, text: it.label || (SYMBOLS[it.type] || SHAPES[it.type] || {}).label || it.type, current: view.sel === it.id, onclick: () => { view.sel = it.id; SD.ui.renderView(); } })),
      };
    },
    toolbar(d) {
      const { h } = SD.ui;
      const zoomTo = (z) => { view.zoom = Math.max(0.25, Math.min(3, z)); applyZoom(d); };
      return [
        h('div', { class: 'tb-group' },
          h('button', { class: 'icon-btn', title: 'Undo (Ctrl+Z)', 'aria-label': 'Undo', onclick: () => undo(d) }, '↶'),
          h('button', { class: 'icon-btn', title: 'Redo (Ctrl+Y)', 'aria-label': 'Redo', onclick: () => redo(d) }, '↷')),
        h('div', { class: 'tb-group' },
          h('button', { class: 'btn ghost small', title: 'Zoom out', onclick: () => zoomTo(view.zoom / 1.25) }, '−'),
          h('button', { class: 'btn ghost small', title: 'Fit to the window', onclick: () => fit(d) }, 'Fit'),
          h('button', { class: 'btn ghost small', title: 'Zoom in', onclick: () => zoomTo(view.zoom * 1.25) }, '+')),
        h('div', { class: 'tb-group' },
          h('button', { class: 'btn ghost small', onclick: async () => SD.ui.download(SD.ui.safeName(d.name) + '.png', await (await fetch(await SD.sketchToPng(d, 2400))).blob()) }, 'PNG'),
          h('button', { class: 'btn ghost small', onclick: () => SD.ui.download(SD.ui.safeName(d.name) + '.svg', SD.sketchSVG(d, { forExport: true }), 'image/svg+xml') }, 'SVG'),
          h('button', { class: 'btn ghost small', onclick: () => K.print(d) }, 'Print')),
      ];
    },
    render(root, d) { renderSketch(root, d); },
    print(d) {
      const { h, printNodes, project } = SD.ui;
      const box = h('div', { class: 'print-sketch-svg' });
      box.innerHTML = SD.sketchSVG(d, { forExport: true });
      const svg = box.querySelector('svg');
      svg.removeAttribute('width'); svg.removeAttribute('height');
      printNodes('print-sketch', [h('h1', {}, [project.title, d.name].filter(Boolean).join(' — ')), box], { landscape: true, margin: '0.5in', title: d.name });
    },
  };
  SD.KINDS.sketch = K;

  function undo(d) { const hs = hist(d); const s = hs.undo.pop(); if (!s) return; hs.redo.push(JSON.stringify(d.items)); d.items = JSON.parse(s); view.sel = null; SD.ui.markDirty(); SD.ui.renderView(); }
  function redo(d) { const hs = hist(d); const s = hs.redo.pop(); if (!s) return; hs.undo.push(JSON.stringify(d.items)); d.items = JSON.parse(s); SD.ui.markDirty(); SD.ui.renderView(); }
  function applyZoom(d) {
    const svg = document.querySelector('.sk-canvas svg');
    if (svg) { svg.setAttribute('width', (d.settings.w || W0) * view.zoom); svg.setAttribute('height', (d.settings.h || H0) * view.zoom); }
  }
  function fit(d) {
    const c = document.querySelector('.sk-canvas');
    if (!c) return;
    view.zoom = Math.max(0.25, Math.min(2, Math.min((c.clientWidth - 40) / (d.settings.w || W0), (c.clientHeight - 40) / (d.settings.h || H0))));
    applyZoom(d);
  }

  function renderSketch(root, d) {
    const U = SD.ui;
    const { h } = U;
    const canvas = h('div', { class: 'sk-canvas' });
    const panel = h('aside', { class: 'story-panel sk-panel' });
    const palette = h('div', { class: 'sk-palette' });
    const setupBar = h('div', { class: 'sk-setups' });
    root.append(h('div', { class: 'sk' }, palette, h('div', { class: 'sk-main' }, setupBar, canvas), panel));
    const drawSetups = () => {
      const cur = activeSetup(d);
      const used = cur ? SD.sketchSetups.usedBy(d, cur) : [];
      const choose = (id) => { view.setup[d.id] = id || null; view.sel = null; draw(); drawPanel(); drawSetups(); U.renderNavigator(); U.renderStatus(); };
      setupBar.replaceChildren(
        h('span', { class: 'muted small' }, 'Showing'),
        h('select', { class: 'select small', title: 'The set is shared; each setup adds its own cameras, actors and arrows', onchange: (e) => choose(e.target.value) },
          h('option', { value: '' }, 'The set only (shared walls & furniture)'),
          d.setups.map((x) => { const u = SD.sketchSetups.usedBy(d, x.id).filter((n) => !x.name.includes(n)); return h('option', { value: x.id, selected: x.id === cur }, x.name + (u.length ? ' · shot ' + u.join(', ') : '')); })),
        h('button', { class: 'btn small', title: 'A new layout of cameras and actors on the same set', onclick: () => { SD.sketchSetups.create(d); changed(); choose(view.setup[d.id]); } }, '+ Setup'),
        cur ? h('button', { class: 'btn ghost small', title: 'Copy this setup to start the next shot', onclick: () => { SD.sketchSetups.create(d, d.setups.find((x) => x.id === cur).name + ' (copy)', cur); changed(); choose(view.setup[d.id]); } }, 'Duplicate') : null,
        cur ? h('button', { class: 'btn ghost small', onclick: async () => { const st = d.setups.find((x) => x.id === cur); const n = await U.promptText('Rename setup', st.name); if (n && n.trim()) { st.name = n.trim(); changed(); drawSetups(); } } }, 'Rename') : null,
        cur ? h('button', { class: 'btn ghost small danger', onclick: async () => { const ok = await U.modal({ title: 'Delete this setup?', body: 'Its cameras, actors and arrows are deleted. The set stays.' + (used.length ? ` Shot ${used.join(', ')} will lose its diagram.` : ''), buttons: [{ label: 'Cancel', value: false }, { label: 'Delete', value: true, primary: true, danger: true }] }); if (!ok) return; snap(d); d.items = d.items.filter((x) => x.setup !== cur); d.setups = d.setups.filter((x) => x.id !== cur); changed(); choose(null); } }, 'Delete') : null,
        h('span', { class: 'muted small sk-used' }, cur ? (used.length ? 'Used by storyboard shot ' + used.join(', ') : 'Not used by a storyboard shot yet') : d.setups.length ? 'Pick a setup to place cameras and actors for one shot.' : 'Draw the set, then add a setup for each shot.'));
    };
    const sel = () => d.items.find((x) => x.id === view.sel) || null;
    const g = (v) => (d.settings.snap ? Math.round(v / 10) * 10 : Math.round(v));
    let draft = null, act = null;

    const draw = () => {
      canvas.innerHTML = SD.sketchSVG(d, { selection: view.sel, draft, setup: activeSetup(d) });
      applyZoom(d);
      canvas.classList.toggle('drawing', view.tool !== 'select');
    };
    const changed = () => { U.markDirty(); U.renderNavigatorSoon(); U.renderStatusSoon(); };
    const select = (id) => { view.sel = id; draw(); drawPanel(); U.renderNavigator(); };
    const setTool = (t) => { view.tool = t; drawPalette(); draw(); };

    const center = () => {
      const svgEl = canvas.querySelector('svg');
      let x = d.settings.w / 2, y = d.settings.h / 2;
      if (svgEl) {
        // middle of the part of the plan that is on screen
        const c = canvas.getBoundingClientRect(), r = svgEl.getBoundingClientRect();
        const l = Math.max(c.left, r.left), t = Math.max(c.top, r.top), rt = Math.min(c.right, r.right), bt = Math.min(c.bottom, r.bottom);
        if (rt > l && bt > t) ({ x, y } = pt({ clientX: (l + rt) / 2, clientY: (t + bt) / 2 }));
      }
      return { x: g(Math.min(d.settings.w - 40, Math.max(40, x))), y: g(Math.min(d.settings.h - 40, Math.max(40, y))) };
    };
    const addSymbol = (type) => {
      snap(d);
      const c = center();
      const it = { id: SD.uid(), type, x: c.x + (d.items.length % 5) * 10, y: c.y + (d.items.length % 5) * 10, rot: 0, scale: 1, color: SYMBOLS[type].color, label: '' };
      if (PER_SETUP.has(type) && activeSetup(d)) it.setup = activeSetup(d);
      d.items.push(it);
      view.tool = 'select';
      changed(); drawPalette(); select(it.id);
    };

    const addImage = () => {
      const inp = h('input', { type: 'file', accept: 'image/*' });
      inp.addEventListener('change', async () => {
        const f = inp.files[0];
        if (!f) return;
        let src;
        try { src = await SD.imageToDataUrl(f, 1600); } catch (e) { U.toast('That picture could not be read.'); return; }
        const im = new Image();
        await new Promise((r) => { im.onload = r; im.onerror = r; im.src = src; });
        const k = Math.min((d.settings.w * 0.8) / (im.naturalWidth || 1), (d.settings.h * 0.8) / (im.naturalHeight || 1));
        const w = Math.round((im.naturalWidth || 400) * k), hh = Math.round((im.naturalHeight || 300) * k);
        snap(d);
        const it = { id: SD.uid(), type: 'image', src, x: Math.round((d.settings.w - w) / 2), y: Math.round((d.settings.h - hh) / 2), w, h: hh, opacity: 0.6 };
        d.items.unshift(it);
        changed(); select(it.id);
      });
      inp.click();
    };
    const drawPalette = () => {
      const groups = {};
      for (const [k, s] of Object.entries(SYMBOLS)) (groups[s.group] = groups[s.group] || []).push([k, s]);
      const icon = (type) => {
        const sv = SYMBOLS[type]
          ? `<svg viewBox="-60 -60 120 120" width="34" height="34">${SYMBOLS[type].draw(SYMBOLS[type].color, { fov: false })}</svg>`
          : `<svg viewBox="0 0 40 40" width="34" height="34">${{ wall: '<line x1="6" y1="20" x2="34" y2="20" stroke="#444" stroke-width="6"/>', arrow: '<line x1="6" y1="30" x2="30" y2="10" stroke="#d64541" stroke-width="3" stroke-dasharray="5 4"/><path d="M34,7 L24,10 L30,16 Z" fill="#d64541"/>', line: '<line x1="6" y1="30" x2="34" y2="10" stroke="#555" stroke-width="2"/>', rect: '<rect x="7" y="10" width="26" height="20" rx="3" fill="#2f6fd6" fill-opacity="0.15" stroke="#2f6fd6" stroke-width="2"/>', ellipse: '<ellipse cx="20" cy="20" rx="14" ry="11" fill="#2f9e66" fill-opacity="0.15" stroke="#2f9e66" stroke-width="2"/>', text: '<text x="20" y="27" font-size="20" font-weight="700" text-anchor="middle" fill="#222">T</text>', image: '<rect x="6" y="9" width="28" height="22" rx="3" fill="#eee" stroke="#888" stroke-width="2"/><path d="M9,28 L17,18 L23,24 L27,20 L32,28 Z" fill="#2f9e66"/><circle cx="26" cy="15" r="3" fill="#e8a33d"/>' }[type]}</svg>`;
        const b = h('button', { class: 'sk-tool' + (view.tool === type ? ' on' : ''), title: (SYMBOLS[type] || SHAPES[type]).label + (SYMBOLS[type] ? '' : type === 'image' ? ' — a floor plan or photo to draw over' : ' — then drag on the plan'), onclick: () => (SYMBOLS[type] ? addSymbol(type) : type === 'image' ? addImage() : setTool(view.tool === type ? 'select' : type)) });
        b.innerHTML = sv;
        b.append(h('span', {}, (SYMBOLS[type] || SHAPES[type]).label));
        return b;
      };
      palette.replaceChildren(
        h('button', { class: 'sk-tool sk-select' + (view.tool === 'select' ? ' on' : ''), title: 'Select and move (Esc)', onclick: () => setTool('select') }, h('span', { class: 'sk-cursor' }, '↖'), h('span', {}, 'Select')),
        ...Object.entries(groups).map(([gname, list]) => h('div', { class: 'sk-group' }, h('div', { class: 'sk-gname' }, gname), list.map(([k]) => icon(k)))),
        h('div', { class: 'sk-group' }, h('div', { class: 'sk-gname' }, 'Draw'), Object.keys(SHAPES).map(icon)));
    };

    const drawPanel = () => {
      const it = sel();
      const sec = (...k) => h('div', { class: 'ins-section' }, ...k);
      const COLORS = ['#2f2f35', '#8b8d98', '#d64541', '#e8a33d', '#2f9e66', '#2f6fd6', '#8e44ad', '#c9a77c'];
      if (!it) {
        panel.replaceChildren(
          sec(h('div', { class: 'ins-kicker' }, 'Sketch'),
            h('p', { class: 'muted small' }, 'Click a camera, actor or set piece in the palette to add it, then drag it into place. Drag the round handle to aim a camera or turn an actor. Walls, arrows and areas: pick the tool and drag on the plan.')),
          sec(h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: d.settings.grid, onchange: (e) => { d.settings.grid = e.target.checked; changed(); draw(); } }), ' Show grid'),
            h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: d.settings.snap, onchange: (e) => { d.settings.snap = e.target.checked; changed(); } }), ' Snap to the grid'),
            h('label', { class: 'lbl' }, 'Plan size'),
            h('select', { class: 'select', onchange: (e) => { const [w, hh] = e.target.value.split('x').map(Number); d.settings.w = w; d.settings.h = hh; changed(); draw(); } },
              [[1200, 800, 'Room'], [1600, 1000, 'Large'], [2400, 1400, 'Location'], [800, 800, 'Square']].map(([w, hh, l]) => h('option', { value: w + 'x' + hh, selected: d.settings.w === w && d.settings.h === hh }, `${l} (${w} × ${hh})`)))),
          sec(h('p', { class: 'muted small' }, 'Use a sketch as a shot’s camera setup in a storyboard: open the shot and choose “From a sketch…”.')));
        return;
      }
      const name = (SYMBOLS[it.type] || SHAPES[it.type] || {}).label || it.type;
      const set = (k, v, redraw = true) => { it[k] = v; changed(); if (redraw) draw(); };
      const kids = [
        sec(h('div', { class: 'ins-kicker' }, name),
          h('label', { class: 'lbl' }, it.type === 'text' ? 'Text' : 'Label'),
          h('input', { class: 'input', value: it.label || '', placeholder: it.type === 'person' ? 'Character name' : it.type === 'camera' ? 'e.g. A cam, 35mm' : 'Optional', oninput: (e) => set('label', e.target.value) }),
          h('label', { class: 'lbl' }, 'Colour'),
          h('div', { class: 'swatches' }, COLORS.map((c) => h('button', { class: 'swatch' + (it.color === c ? ' on' : ''), style: `background:${c}`, 'aria-label': 'Colour ' + c, onclick: () => { set('color', c); drawPanel(); } })))),
      ];
      if (SYMBOLS[it.type]) {
        kids.push(sec(
          h('label', { class: 'lbl' }, `Turn (${Math.round(it.rot || 0)}°)`),
          h('input', { type: 'range', min: -180, max: 180, step: 5, value: it.rot || 0, oninput: (e) => { set('rot', +e.target.value); e.target.previousSibling.textContent = `Turn (${e.target.value}°)`; } }),
          h('label', { class: 'lbl' }, 'Size'),
          h('input', { type: 'range', min: 0.4, max: 3, step: 0.1, value: it.scale || 1, oninput: (e) => set('scale', +e.target.value) }),
          it.type === 'camera' || it.type === 'light' ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: it.fov !== false, onchange: (e) => set('fov', e.target.checked) }), it.type === 'camera' ? ' Show what the camera sees' : ' Show the light beam') : null));
      }
      if (isLine(it.type) || it.type === 'rect' || it.type === 'ellipse') kids.push(sec(h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: it.type === 'arrow' ? it.dashed !== false : !!it.dashed, onchange: (e) => set('dashed', e.target.checked) }), ' Dashed')));
      if (it.type === 'image') kids.push(sec(h('label', { class: 'lbl' }, 'See-through'), h('input', { type: 'range', min: 0.15, max: 1, step: 0.05, value: it.opacity == null ? 1 : it.opacity, oninput: (e) => set('opacity', +e.target.value) }), h('p', { class: 'muted small' }, 'Pictures sit at the back, so you can draw over a floor plan or a photo of the location.')));
      if (it.type === 'text') kids.push(sec(h('label', { class: 'lbl' }, 'Size'), h('input', { type: 'range', min: 10, max: 60, value: it.size || 18, oninput: (e) => set('size', +e.target.value) })));
      if (activeSetup(d) || it.setup) kids.push(sec(h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!it.setup, onchange: (e) => { if (e.target.checked) it.setup = activeSetup(d); else delete it.setup; changed(); draw(); } }), ' Only in this setup'), h('p', { class: 'muted small' }, it.setup ? 'Other setups don’t show it.' : 'Part of the set: every setup shows it.')));
      kids.push(sec(h('div', { class: 'row-gap' },
        h('button', { class: 'btn small', title: 'Ctrl+D', onclick: () => duplicate() }, 'Duplicate'),
        h('button', { class: 'btn small', title: 'Bring to front', onclick: () => { snap(d); d.items = d.items.filter((x) => x !== it).concat(it); changed(); draw(); } }, 'To front'),
        h('button', { class: 'btn small', title: 'Send to back', onclick: () => { snap(d); d.items = [it, ...d.items.filter((x) => x !== it)]; changed(); draw(); } }, 'To back'),
        h('button', { class: 'btn small danger', title: 'Delete', onclick: () => remove() }, 'Delete'))));
      panel.replaceChildren(...kids);
    };

    const duplicate = () => {
      const it = sel(); if (!it) return;
      snap(d);
      const c = JSON.parse(JSON.stringify(it)); c.id = SD.uid();
      for (const k of ['x', 'y', 'x1', 'y1', 'x2', 'y2']) if (c[k] != null) c[k] += 20;
      d.items.push(c); changed(); select(c.id);
    };
    const remove = () => { const it = sel(); if (!it) return; snap(d); d.items = d.items.filter((x) => x !== it); changed(); select(null); };

    const pt = (e) => {
      const svg = canvas.querySelector('svg');
      const m = svg.getScreenCTM().inverse();
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
      return { x: p.x, y: p.y };
    };

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !canvas.querySelector('svg')) return;
      const p = pt(e);
      const hd = e.target.closest('[data-handle]');
      const itEl = e.target.closest('.sk-item');
      if (view.tool !== 'select' && !hd) {
        const t = view.tool;
        const x = g(p.x), y = g(p.y);
        if (t === 'text') {
          snap(d);
          const it = { id: SD.uid(), type: 'text', x, y, label: 'Text', size: 20, color: SHAPES.text.color };
          d.items.push(it); view.tool = 'select'; changed(); drawPalette(); select(it.id);
          setTimeout(() => { const i = panel.querySelector('input.input'); if (i) { i.focus(); i.select(); } }, 30);
          return;
        }
        draft = isLine(t) ? { id: 'draft', type: t, x1: x, y1: y, x2: x, y2: y, color: SHAPES[t].color } : { id: 'draft', type: t, x, y, w: 0, h: 0, color: SHAPES[t].color };
        act = { mode: 'create' };
      } else if (hd) {
        act = { mode: hd.dataset.handle, before: JSON.stringify(d.items) };
      } else if (itEl) {
        const it = d.items.find((x) => x.id === itEl.dataset.id);
        if (!it) return;
        if (view.sel !== it.id) { view.sel = it.id; drawPanel(); U.renderNavigator(); }
        act = { mode: 'move', it, start: p, orig: JSON.parse(JSON.stringify(it)), before: JSON.stringify(d.items), moved: false };
      } else {
        if (view.sel) select(null);
        return;
      }
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      draw();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!act) return;
      const p = pt(e);
      const it = sel();
      if (act.mode === 'create') {
        if (isLine(draft.type)) {
          let x2 = g(p.x), y2 = g(p.y);
          if (draft.type === 'wall' && !e.altKey) { if (Math.abs(x2 - draft.x1) > Math.abs(y2 - draft.y1) * 2.5) y2 = draft.y1; else if (Math.abs(y2 - draft.y1) > Math.abs(x2 - draft.x1) * 2.5) x2 = draft.x1; }
          draft.x2 = x2; draft.y2 = y2;
        } else { draft.w = g(p.x) - draft.x; draft.h = g(p.y) - draft.y; }
      } else if (act.mode === 'move') {
        const dx = p.x - act.start.x, dy = p.y - act.start.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) act.moved = true;
        const o = act.orig;
        if (o.x != null) { it.x = g(o.x + dx); it.y = g(o.y + dy); }
        if (o.x1 != null) { const sx = g(o.x1 + dx) - o.x1, sy = g(o.y1 + dy) - o.y1; it.x1 = o.x1 + sx; it.y1 = o.y1 + sy; it.x2 = o.x2 + sx; it.y2 = o.y2 + sy; }
      } else if (act.mode === 'aim') {
        let a = (Math.atan2(p.y - it.y, p.x - it.x) * 180) / Math.PI;
        if (!e.altKey) a = Math.round(a / 15) * 15;
        it.rot = a;
      } else if (act.mode === 'p1') { it.x1 = g(p.x); it.y1 = g(p.y); }
      else if (act.mode === 'p2') { it.x2 = g(p.x); it.y2 = g(p.y); }
      else if (act.mode === 'size') {
        if (it.type === 'image') { const r = (act.ratio = act.ratio || Math.abs(it.h / (it.w || 1))); it.w = Math.max(20, g(p.x) - it.x); it.h = Math.round(it.w * r); }
        else { it.w = g(p.x) - it.x; it.h = g(p.y) - it.y; }
      }
      draw();
    });
    const finish = () => {
      if (!act) return;
      if (act.mode === 'create') {
        const big = isLine(draft.type) ? Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) > 8 : Math.abs(draft.w) > 8 && Math.abs(draft.h) > 8;
        if (big) {
          snap(d);
          const it = Object.assign({}, draft, { id: SD.uid() });
          if (PER_SETUP.has(it.type) && activeSetup(d)) it.setup = activeSetup(d);
          if (it.type === 'rect' || it.type === 'ellipse') { if (it.w < 0) { it.x += it.w; it.w = -it.w; } if (it.h < 0) { it.y += it.h; it.h = -it.h; } }
          d.items.push(it);
          view.sel = it.id;
          changed();
        }
        draft = null;
      } else if (act.before && act.before !== JSON.stringify(d.items)) {
        const hs = hist(d); hs.undo.push(act.before); hs.redo.length = 0;
        changed();
      }
      act = null;
      draw();
      drawPanel();
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);

    view.keys = (e) => {
      if (!document.body.contains(canvas)) return;
      if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(d); else undo(d); return; }
      if (mod && k === 'y') { e.preventDefault(); redo(d); return; }
      if (mod && k === 'd') { e.preventDefault(); duplicate(); return; }
      if (e.key === 'Escape') { view.tool = 'select'; draft = null; act = null; drawPalette(); select(null); return; }
      const it = sel();
      if (!it) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(); return; }
      const step = e.shiftKey ? 10 : 1;
      const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (mv) {
        e.preventDefault();
        if (!view.nudging) { snap(d); view.nudging = true; setTimeout(() => { view.nudging = false; }, 600); }
        for (const [a, b] of [['x', 0], ['y', 1], ['x1', 0], ['y1', 1], ['x2', 0], ['y2', 1]]) if (it[a] != null) it[a] += mv[b];
        changed(); draw();
      }
    };

    drawPalette();
    drawSetups();
    draw();
    drawPanel();
    if (!view.zoomSet) { view.zoomSet = true; requestAnimationFrame(() => fit(d)); setTimeout(() => fit(d), 50); }
  }

  document.addEventListener('keydown', (e) => { const d = SD.ui && SD.ui.currentDoc(); if (d && d.kind === 'sketch' && view.keys) view.keys(e); });
})();
