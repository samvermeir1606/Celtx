/* Scriptdesk — relationship map: characters as dots, relationships as lines that can change through the story */
(function () {
  'use strict';
  const SD = (window.SD = window.SD || {});
  SD.KINDS = SD.KINDS || {};

  SD.REL_KINDS = [
    { id: 'love', label: 'Love', icon: '❤', color: '#d6409f' },
    { id: 'family', label: 'Family', icon: '⌂', color: '#2f9e66' },
    { id: 'friends', label: 'Friends', icon: '☺', color: '#2f6fd6' },
    { id: 'work', label: 'Work', icon: '▣', color: '#6e6e78' },
    { id: 'rivals', label: 'Rivals', icon: '⚡', color: '#d98a00' },
    { id: 'enemies', label: 'Enemies', icon: '✕', color: '#d64541' },
    { id: 'secret', label: 'Secret', icon: '?', color: '#8e44ad' },
    { id: 'ended', label: 'Ended / broken', icon: '⌀', color: '#9a978f' },
  ];
  const kindOf = (id) => SD.REL_KINDS.find((k) => k.id === id) || SD.REL_KINDS[2];
  const W = 1100, H = 720;
  const view = { sel: null, connect: null };

  const K = {
    icon: '🕸️',
    label: 'Relationship Map',
    create(project, name) {
      const scripts = project.documents.filter((x) => x.kind === 'script');
      return K.normalize({ id: SD.uid(), kind: 'relations', name, sourceId: scripts.length === 1 ? scripts[0].id : null });
    },
    normalize(d) {
      d.nodes = d.nodes && typeof d.nodes === 'object' ? d.nodes : {};
      d.links = Array.isArray(d.links) ? d.links : [];
      d.hidden = Array.isArray(d.hidden) ? d.hidden : [];
      d.at = d.at == null ? -1 : d.at; // -1 = the whole story
      for (const l of d.links) { l.id = l.id || SD.uid(); l.changes = Array.isArray(l.changes) ? l.changes : []; l.kind = l.kind || 'friends'; for (const c of l.changes) c.id = c.id || SD.uid(); }
      return d;
    },
    hasContent: (d) => d.links.length > 0,
    status(d) { const m = model(d); return `Relationship map  ·  ${m.people.length} characters  ·  ${d.links.length} relationships` + (m.at >= 0 ? `  ·  after scene ${m.scenes[m.at].number}` : ''); },
    navigator(d) {
      const m = model(d);
      return { label: 'Relationships', empty: 'Click a character, then “Connect”.', items: d.links.map((l) => { const st = stateAt(l, m); return { text: `${nameOf(m, l.a)} ${l.directed ? '→' : '–'} ${nameOf(m, l.b)}`, len: kindOf(st.kind).icon, current: view.sel === 'l:' + l.id, onclick: () => { view.sel = 'l:' + l.id; SD.ui.renderView(); } }; }) };
    },
    toolbar(d) {
      const { h } = SD.ui;
      return [
        h('button', { class: 'btn small', onclick: (e) => linkMenu(e.currentTarget, d) }, source(d) ? '🎬 ' + source(d).name : 'Link a script…'),
        h('button', { class: 'btn small', title: 'Put the characters in a circle again', onclick: () => { d.nodes = {}; SD.ui.markDirty(); SD.ui.renderView(); } }, 'Tidy up'),
        h('div', { class: 'tb-group' },
          h('button', { class: 'btn ghost small', onclick: () => SD.ui.download(SD.ui.safeName(d.name) + '.svg', svgFor(d, model(d), { forExport: true }), 'image/svg+xml') }, 'SVG'),
          h('button', { class: 'btn ghost small', onclick: () => K.print(d) }, 'Print')),
      ];
    },
    render(root, d) { renderMap(root, d); },
    print(d) {
      const { h, printNodes, project } = SD.ui;
      const box = h('div', { class: 'print-rel-svg' });
      const m = model(d);
      box.innerHTML = svgFor(d, m, { forExport: true });
      printNodes('print-rel', [h('h1', {}, [project.title, d.name].filter(Boolean).join(' — ') + (m.at >= 0 ? ` (after scene ${m.scenes[m.at].number})` : '')), box,
        h('ul', { class: 'prel-list' }, d.links.map((l) => { const st = stateAt(l, m); return h('li', {}, `${nameOf(m, l.a)} ${l.directed ? '→' : '—'} ${nameOf(m, l.b)}: ${kindOf(st.kind).label}${st.label ? ' — ' + st.label : ''}`); }))], { landscape: true, title: d.name });
    },
  };
  SD.KINDS.relations = K;

  const source = (d) => SD.ui.project.documents.find((x) => x.id === d.sourceId && x.kind === 'script') || null;
  function linkMenu(anchor, d) {
    const U = SD.ui;
    const scripts = U.project.documents.filter((x) => x.kind === 'script');
    if (!scripts.length) { U.toast('There is no script in this project yet.'); return; }
    U.popupMenu(anchor, [...scripts.map((s) => ({ label: (s.id === d.sourceId ? '✓ ' : '') + s.name, run: () => { d.sourceId = s.id; U.markDirty(); U.renderView(); } })), d.sourceId ? { label: 'Unlink (catalog characters only)', run: () => { d.sourceId = null; d.at = -1; U.markDirty(); U.renderView(); } } : null]);
  }

  // characters: catalog characters plus speaking parts in the linked script
  function model(d) {
    const p = SD.ui.project;
    const script = source(d);
    const scenes = script ? SD.getScenes(script) : [];
    const firstIn = new Map();
    scenes.forEach((s, i) => SD.sceneCharacters(script, s).forEach((n) => { if (!firstIn.has(n)) firstIn.set(n, i); }));
    const people = [];
    const seen = new Set();
    for (const c of p.catalog.filter((x) => x.category === 'character' && x.name.trim())) { const n = c.name.trim().toUpperCase(); seen.add(n); people.push({ key: c.id, name: c.name.trim(), upper: n, item: c, first: firstIn.has(n) ? firstIn.get(n) : null }); }
    for (const [n, i] of firstIn) if (!seen.has(n)) people.push({ key: 'name:' + n, name: n, upper: n, item: null, first: i });
    const visible = people.filter((x) => !d.hidden.includes(x.key));
    // place anyone without a spot on a circle
    const free = visible.filter((x) => !d.nodes[x.key]);
    free.forEach((x, i) => { const a = (i / Math.max(1, free.length)) * Math.PI * 2 - Math.PI / 2; d.nodes[x.key] = { x: Math.round(W / 2 + Math.cos(a) * 270), y: Math.round(H / 2 + Math.sin(a) * 240) }; });
    const at = d.at >= 0 && d.at < scenes.length ? d.at : -1;
    return { people, visible, scenes, at, byKey: new Map(people.map((x) => [x.key, x])) };
  }
  const nameOf = (m, key) => (m.byKey.get(key) || { name: '?' }).name;
  const sceneIndex = (m, id) => m.scenes.findIndex((s) => s.id === id);
  // what a relationship is at the chosen point of the story
  function stateAt(l, m) {
    let kind = l.kind, label = l.label || '';
    const limit = m.at < 0 ? Infinity : m.at;
    const ch = l.changes.map((c) => ({ c, i: sceneIndex(m, c.sceneId) })).filter((x) => x.i >= 0 && x.i <= limit).sort((a, b) => a.i - b.i);
    for (const { c } of ch) { kind = c.kind; if (c.label) label = c.label; }
    const from = l.from ? sceneIndex(m, l.from) : -1;
    return { kind, label, exists: !(l.from && from >= 0 && from > limit), changed: ch.length > 0 };
  }

  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function svgFor(d, m, opts = {}) {
    const sel = opts.forExport ? null : view.sel;
    const pos = (k) => d.nodes[k] || { x: W / 2, y: H / 2 };
    const pairCount = new Map();
    let edges = '';
    for (const l of d.links) {
      if (!m.byKey.has(l.a) || !m.byKey.has(l.b) || d.hidden.includes(l.a) || d.hidden.includes(l.b)) continue;
      const st = stateAt(l, m);
      if (!st.exists) continue;
      const k = kindOf(st.kind);
      const A = pos(l.a), B = pos(l.b);
      const key = [l.a, l.b].sort().join('|');
      const nth = (pairCount.get(key) || 0); pairCount.set(key, nth + 1);
      const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
      const bend = (nth % 2 ? -1 : 1) * (18 + nth * 22) * (l.a < l.b ? 1 : -1);
      const mx = (A.x + B.x) / 2 - (dy / len) * bend, my = (A.y + B.y) / 2 + (dx / len) * bend;
      const r = 30;
      const ex = B.x - (dx / len) * (r + 4), ey = B.y - (dy / len) * (r + 4);
      const lx = 0.25 * A.x + 0.5 * mx + 0.25 * B.x, ly = 0.25 * A.y + 0.5 * my + 0.25 * B.y;
      const on = sel === 'l:' + l.id ? ' on' : '';
      const dash = st.kind === 'ended' || st.kind === 'secret' ? ' stroke-dasharray="7 6"' : '';
      edges += `<g class="rel-edge${on}" data-link="${esc(l.id)}"><path d="M${A.x},${A.y} Q${mx},${my} ${ex},${ey}" stroke="${k.color}"${dash} class="rel-line"${l.directed ? ` marker-end="url(#rel-arrow-${k.id})"` : ''}/><path d="M${A.x},${A.y} Q${mx},${my} ${ex},${ey}" class="rel-hit"/><g transform="translate(${lx} ${ly})"><rect x="-12" y="-11" width="24" height="22" rx="11" fill="#fff" stroke="${k.color}" stroke-width="2"/><text class="rel-icon" text-anchor="middle" dy="5" fill="${k.color}">${k.icon}</text>${st.label ? `<text class="rel-label" text-anchor="middle" y="26">${esc(st.label)}</text>` : ''}${st.changed ? `<circle cx="11" cy="-10" r="4" fill="${k.color}"/>` : ''}</g></g>`;
    }
    let nodes = '';
    for (const x of m.visible) {
      const P = pos(x.key);
      const absent = m.at >= 0 && (x.first == null || x.first > m.at);
      const on = sel === 'n:' + x.key ? ' on' : '';
      const conn = view.connect === x.key ? ' connecting' : '';
      const initials = x.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
      const cid = 'rc-' + x.key.replace(/[^a-zA-Z0-9_-]/g, '_');
      const photo = x.item && x.item.media && x.item.media[0] && /^data:image\//.test(x.item.media[0].data) ? x.item.media[0].data : '';
      nodes += `<g class="rel-node${on}${conn}${absent ? ' absent' : ''}" data-node="${esc(x.key)}" transform="translate(${P.x} ${P.y})"><circle r="30" class="rel-dot"/>${photo ? `<clipPath id="${cid}"><circle r="27"/></clipPath><image href="${esc(photo)}" x="-27" y="-27" width="54" height="54" preserveAspectRatio="xMidYMid slice" clip-path="url(#${cid})"/>` : `<text class="rel-init" text-anchor="middle" dy="6">${esc(initials)}</text>`}<text class="rel-name" text-anchor="middle" y="48">${esc(x.name)}</text></g>`;
    }
    const markers = SD.REL_KINDS.map((k) => `<marker id="rel-arrow-${k.id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${k.color}"/></marker>`).join('');
    const style = opts.forExport ? `<style>.rel-line{fill:none;stroke-width:3}.rel-hit{fill:none;stroke:transparent}.rel-dot{fill:#fff;stroke:#24211c;stroke-width:2.5}.rel-init{font:700 18px system-ui,sans-serif;fill:#24211c}.rel-name{font:700 14px system-ui,sans-serif;fill:#24211c;paint-order:stroke;stroke:#fff;stroke-width:4px}.rel-icon{font:700 13px system-ui,sans-serif}.rel-label{font:600 12px system-ui,sans-serif;fill:#444;paint-order:stroke;stroke:#fff;stroke-width:4px}.absent{opacity:.3}</style>` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" class="rel-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${style}<defs>${markers}</defs><rect class="rel-bg" width="${W}" height="${H}" fill="#fff"/>${edges}${nodes}</svg>`;
  }

  function renderMap(root, d) {
    const U = SD.ui;
    const { h } = U;
    const m = model(d);
    const canvas = h('div', { class: 'rel-canvas' });
    const panel = h('aside', { class: 'story-panel rel-panel' });
    const bar = h('div', { class: 'rel-bar' });
    root.append(h('div', { class: 'rel' }, h('div', { class: 'rel-main' }, bar, canvas), panel));
    const changed = () => { U.markDirty(); U.renderStatusSoon(); U.renderNavigatorSoon(); };
    const draw = () => { canvas.innerHTML = svgFor(d, m); };
    const full = () => { draw(); drawPanel(); drawBar(); U.renderNavigator(); U.renderStatus(); };
    const select = (s) => { view.sel = s; full(); };

    const drawBar = () => {
      const n = m.scenes.length;
      if (!n) { bar.replaceChildren(h('span', { class: 'muted small' }, source(d) ? 'The linked script has no scenes yet.' : 'Link a script to see how relationships change from scene to scene.')); return; }
      const label = h('strong', { class: 'rel-at' }, m.at < 0 ? 'The whole story' : `After scene ${m.scenes[m.at].number}`);
      const sub = h('span', { class: 'muted small rel-at-sub' }, m.at < 0 ? 'Showing how each relationship ends up.' : (m.scenes[m.at].el.text || '').toUpperCase());
      bar.replaceChildren(h('span', { class: 'muted small' }, 'Story so far'),
        h('input', { type: 'range', min: 0, max: n, value: m.at < 0 ? n : m.at, 'aria-label': 'Point in the story', oninput: (e) => { const v = +e.target.value; d.at = v >= n ? -1 : v; m.at = d.at; label.textContent = m.at < 0 ? 'The whole story' : `After scene ${m.scenes[m.at].number}`; sub.textContent = m.at < 0 ? 'Showing how each relationship ends up.' : (m.scenes[m.at].el.text || '').toUpperCase(); draw(); drawPanel(); U.renderStatusSoon(); U.markDirty(); } }),
        label, sub);
    };

    const sceneSelect = (value, onchange, first) => h('select', { class: 'select small', onchange: (e) => onchange(e.target.value) },
      h('option', { value: '' }, first), m.scenes.map((s) => h('option', { value: s.id, selected: s.id === value }, `Scene ${s.number}: ${(s.el.text || '').toUpperCase().slice(0, 40)}`)));
    const kindSelect = (value, onchange) => h('select', { class: 'select small', onchange: (e) => onchange(e.target.value) }, SD.REL_KINDS.map((k) => h('option', { value: k.id, selected: k.id === value }, `${k.icon} ${k.label}`)));

    const drawPanel = () => {
      const sec = (...k) => h('div', { class: 'ins-section' }, ...k);
      const s = view.sel || '';
      if (s.startsWith('l:')) {
        const l = d.links.find((x) => 'l:' + x.id === s);
        if (!l) { view.sel = null; drawPanel(); return; }
        const st = stateAt(l, m);
        panel.replaceChildren(
          sec(h('div', { class: 'ins-kicker' }, 'Relationship'),
            h('div', { class: 'ins-title' }, `${nameOf(m, l.a)} ${l.directed ? '→' : '–'} ${nameOf(m, l.b)}`),
            m.at >= 0 ? h('p', { class: 'muted small' }, `After scene ${m.scenes[m.at].number}: ${kindOf(st.kind).icon} ${kindOf(st.kind).label}${st.label ? ' — ' + st.label : ''}${st.exists ? '' : ' (not yet)'}`) : null),
          sec(h('label', { class: 'lbl' }, 'At the start'),
            kindSelect(l.kind, (v) => { l.kind = v; changed(); full(); }),
            h('input', { class: 'input', value: l.label || '', placeholder: 'In a few words: “sisters”, “owes him money”…', oninput: (e) => { l.label = e.target.value; changed(); draw(); } }),
            h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!l.directed, onchange: (e) => { l.directed = e.target.checked; changed(); full(); } }), ' One-way (an arrow): only one of them feels it'),
            h('label', { class: 'lbl' }, 'Begins'),
            sceneSelect(l.from || '', (v) => { if (v) l.from = v; else delete l.from; changed(); full(); }, 'Before the story starts')),
          sec(h('label', { class: 'lbl' }, 'How it changes'),
            l.changes.length ? l.changes.map((c) => h('div', { class: 'sp-card' },
              h('div', { class: 'sp-card-head' }, sceneSelect(c.sceneId, (v) => { c.sceneId = v; changed(); full(); }, 'Pick a scene'),
                h('button', { class: 'icon-btn', 'aria-label': 'Remove change', onclick: () => { l.changes = l.changes.filter((x) => x !== c); changed(); full(); } }, '×')),
              kindSelect(c.kind, (v) => { c.kind = v; changed(); full(); }),
              h('input', { class: 'input', value: c.label || '', placeholder: 'What changes? e.g. “finds out the truth”', oninput: (e) => { c.label = e.target.value; changed(); draw(); } }))) : h('p', { class: 'muted small' }, 'Relationships move: friends fall out, rivals fall in love. Add the scene where it changes.'),
            m.scenes.length ? h('button', { class: 'btn ghost small', onclick: () => { l.changes.push({ id: SD.uid(), sceneId: m.at >= 0 ? m.scenes[m.at].id : m.scenes[Math.floor(m.scenes.length / 2)].id, kind: 'ended', label: '' }); changed(); full(); } }, '+ Changes in a scene') : null),
          sec(h('button', { class: 'btn small danger', onclick: () => { d.links = d.links.filter((x) => x !== l); view.sel = null; changed(); full(); } }, 'Delete relationship')));
        return;
      }
      if (s.startsWith('n:')) {
        const key = s.slice(2);
        const x = m.byKey.get(key);
        if (!x) { view.sel = null; drawPanel(); return; }
        const mine = d.links.filter((l) => l.a === key || l.b === key);
        panel.replaceChildren(
          sec(h('div', { class: 'ins-kicker' }, 'Character'), h('div', { class: 'ins-title' }, x.name),
            x.first != null ? h('p', { class: 'muted small' }, `First appears in scene ${m.scenes[x.first].number}.`) : null,
            h('div', { class: 'row-gap' },
              h('button', { class: 'btn small primary', onclick: () => { view.connect = key; draw(); U.toast('Now click the character they are connected to.'); } }, 'Connect to…'),
              h('button', { class: 'btn small', onclick: () => U.openCatalogItem(x.item ? x.item.id : null, { category: 'character', name: x.name }) }, x.item ? 'Open profile' : 'Create profile'),
              h('button', { class: 'btn ghost small', title: 'Hide from this map', onclick: () => { d.hidden.push(key); view.sel = null; changed(); U.renderView(); } }, 'Hide'))),
          sec(h('label', { class: 'lbl' }, `Relationships (${mine.length})`),
            mine.length ? mine.map((l) => { const st = stateAt(l, m); const k = kindOf(st.kind); return h('button', { class: 'story-rowbtn', onclick: () => select('l:' + l.id) }, h('span', { style: `color:${k.color}` }, k.icon), `${nameOf(m, l.a === key ? l.b : l.a)} — ${k.label}${st.label ? ': ' + st.label : ''}`); }) : h('p', { class: 'muted small' }, 'None yet. Press “Connect to…”, then click another character.')));
        return;
      }
      const hidden = m.people.filter((x) => d.hidden.includes(x.key));
      panel.replaceChildren(
        sec(h('div', { class: 'ins-kicker' }, 'Relationship map'),
          h('p', { class: 'muted small' }, 'Drag characters to arrange them. Click a character and “Connect to…” to draw a relationship; click a line to say what it is and how it changes. Move the “Story so far” slider to watch the relationships change scene by scene.')),
        sec(h('label', { class: 'lbl' }, 'Kinds'), h('div', { class: 'rel-legend' }, SD.REL_KINDS.map((k) => h('span', {}, h('b', { style: `color:${k.color}` }, k.icon), ' ', k.label)))),
        hidden.length ? sec(h('label', { class: 'lbl' }, 'Hidden'), hidden.map((x) => h('button', { class: 'chip', onclick: () => { d.hidden = d.hidden.filter((y) => y !== x.key); changed(); U.renderView(); } }, '+ ' + x.name))) : null);
    };

    // dragging characters, clicking lines
    let drag = null;
    const pt = (e) => { const svg = canvas.querySelector('svg'); const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse()); return { x: p.x, y: p.y }; };
    canvas.addEventListener('pointerdown', (e) => {
      const node = e.target.closest('[data-node]');
      const edge = e.target.closest('[data-link]');
      if (node) {
        const key = node.dataset.node;
        if (view.connect && view.connect !== key) {
          const l = { id: SD.uid(), a: view.connect, b: key, kind: 'friends', label: '', changes: [] };
          d.links.push(l);
          view.connect = null;
          changed();
          select('l:' + l.id);
          return;
        }
        view.connect = null;
        const p = pt(e), o = d.nodes[key];
        drag = { key, dx: p.x - o.x, dy: p.y - o.y, moved: false };
        canvas.setPointerCapture(e.pointerId);
        if (view.sel !== 'n:' + key) { view.sel = 'n:' + key; drawPanel(); U.renderNavigator(); }
        return;
      }
      if (edge) { select('l:' + edge.dataset.link); return; }
      view.connect = null;
      if (view.sel) select(null);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const p = pt(e);
      d.nodes[drag.key] = { x: Math.round(Math.max(40, Math.min(W - 40, p.x - drag.dx))), y: Math.round(Math.max(40, Math.min(H - 60, p.y - drag.dy))) };
      drag.moved = true;
      draw();
    });
    const up = () => { if (drag && drag.moved) changed(); drag = null; draw(); };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    full();
  }
})();
