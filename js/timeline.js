/* Scriptdesk — timeline: the order scenes are told (plot) next to the order they happen (story) */
(function () {
  'use strict';
  const SD = (window.SD = window.SD || {});
  SD.KINDS = SD.KINDS || {};

  const K = {
    icon: '⏳',
    label: 'Timeline',
    create(project, name) {
      const scripts = project.documents.filter((x) => x.kind === 'script');
      return K.normalize({ id: SD.uid(), kind: 'timeline', name, sourceId: scripts.length === 1 ? scripts[0].id : null });
    },
    normalize(d) {
      d.order = Array.isArray(d.order) ? d.order : []; // story order: scene ids and backstory event ids
      d.events = Array.isArray(d.events) ? d.events : []; // things that happen but are not shown
      d.when = d.when && typeof d.when === 'object' ? d.when : {}; // "1998", "Day 3, night", "20 years earlier"
      for (const e of d.events) { e.id = e.id || SD.uid(); e.text = e.text || ''; }
      return d;
    },
    hasContent: (d) => d.events.length > 0 || Object.keys(d.when).length > 0,
    status(d) {
      const t = build(d);
      if (!t) return 'Timeline  ·  link a script';
      return `Timeline  ·  ${t.scenes.length} scenes  ·  ${t.flashbacks} flashback${t.flashbacks === 1 ? '' : 's'}  ·  ${t.forwards} flash-forward${t.forwards === 1 ? '' : 's'}  ·  ${d.events.length} backstory events`;
    },
    navigator(d) {
      const t = build(d);
      return { label: 'As it happened', empty: 'Link a script to see its scenes.', items: t ? t.story.map((x, i) => ({ num: i + 1, text: x.label, len: x.jump === 'back' ? '↶' : x.jump === 'fwd' ? '↷' : '', onclick: () => { const el = document.querySelector(`.tl-item[data-id="${x.id}"]`); if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } })) : [] };
    },
    toolbar(d) {
      const { h } = SD.ui;
      return [
        h('button', { class: 'btn small', onclick: () => addEvent(d) }, '+ Backstory event'),
        h('button', { class: 'btn small', onclick: (e) => linkMenu(e.currentTarget, d) }, source(d) ? '🎬 ' + source(d).name : 'Link a script…'),
        h('button', { class: 'btn ghost small', title: 'Put the story order back to the script order', onclick: () => { if (confirm('Put every scene back in script order? Backstory events stay where they are relative to the start.')) { d.order = d.order.filter((id) => d.events.some((e) => e.id === id)); SD.ui.markDirty(); SD.ui.renderView(); } } }, 'Reset order'),
        h('div', { class: 'tb-group' }, h('button', { class: 'btn ghost small', onclick: () => K.print(d) }, 'Print')),
      ];
    },
    render(root, d) { renderTimeline(root, d); },
    print(d) {
      const { h, printNodes, project } = SD.ui;
      const t = build(d);
      if (!t) return;
      printNodes('print-timeline', [
        h('h1', {}, [project.title, d.name].filter(Boolean).join(' — ')),
        h('div', { class: 'ptl' },
          h('div', {}, h('h2', {}, 'As told (the script)'), h('ol', {}, t.scenes.map((x) => h('li', {}, x.label, d.when[x.id] ? h('em', {}, ' — ' + d.when[x.id]) : null)))),
          h('div', {}, h('h2', {}, 'As it happened (the story)'), h('ol', {}, t.story.map((x) => h('li', { class: x.event ? 'ev' : '' }, x.event ? '◆ ' + x.label : x.label, d.when[x.id] ? h('em', {}, ' — ' + d.when[x.id]) : null, x.jump === 'back' ? ' (flashback)' : x.jump === 'fwd' ? ' (flash-forward)' : ''))))),
      ], { title: d.name });
    },
  };
  SD.KINDS.timeline = K;

  const source = (d) => SD.ui.project.documents.find((x) => x.id === d.sourceId && x.kind === 'script') || null;

  function linkMenu(anchor, d) {
    const U = SD.ui;
    const scripts = U.project.documents.filter((x) => x.kind === 'script');
    if (!scripts.length) { U.toast('There is no script in this project yet.'); return; }
    U.popupMenu(anchor, scripts.map((s) => ({ label: (s.id === d.sourceId ? '✓ ' : '') + s.name, run: () => { d.sourceId = s.id; U.markDirty(); U.renderView(); } })));
  }

  // Scenes in script order, and everything in story order. New scenes are slotted in after the scene before them.
  function build(d) {
    const script = source(d);
    if (!script) return null;
    const scenes = SD.getScenes(script).map((s, i) => ({ id: s.id, n: i, number: s.number, label: `${s.number}. ${(s.el.text || 'Untitled').toUpperCase()}`, synopsis: s.el.synopsis || '', color: s.el.color || '' }));
    const byId = new Map(scenes.map((s) => [s.id, s]));
    const evById = new Map(d.events.map((e) => [e.id, e]));
    let order = d.order.filter((id) => byId.has(id) || evById.has(id));
    for (const s of scenes) {
      if (order.includes(s.id)) continue;
      const prev = s.n > 0 ? scenes[s.n - 1].id : null;
      const at = prev ? order.indexOf(prev) + 1 : 0;
      order.splice(at > 0 ? at : prev ? order.length : 0, 0, s.id);
    }
    for (const e of d.events) if (!order.includes(e.id)) order.unshift(e.id);
    d.order = order;
    // a jump back in script order = flashback, a jump ahead past what comes next = flash-forward
    const story = order.map((id) => (byId.has(id) ? Object.assign({}, byId.get(id)) : { id, event: true, label: evById.get(id).text || 'Untitled event', e: evById.get(id) }));
    const pos = new Map(story.map((x, i) => [x.id, i]));
    let flashbacks = 0, forwards = 0;
    // the longest run of scenes told in story order is the main line; the rest jump back or ahead
    const P = scenes.map((sc) => pos.get(sc.id));
    const len = P.map(() => 1), prevIdx = P.map(() => -1);
    for (let i = 0; i < P.length; i++) for (let j = 0; j < i; j++) if (P[j] < P[i] && len[j] + 1 > len[i]) { len[i] = len[j] + 1; prevIdx[i] = j; }
    const main = new Set();
    let k = len.indexOf(Math.max(0, ...len));
    while (k >= 0) { main.add(k); k = prevIdx[k]; }
    scenes.forEach((sc, i) => {
      if (main.has(i)) return;
      let j = i - 1; while (j >= 0 && !main.has(j)) j--;
      let n2 = i + 1; while (n2 < scenes.length && !main.has(n2)) n2++;
      const back = j >= 0 ? P[i] < P[j] : n2 < scenes.length ? P[i] < P[n2] : false;
      story[pos.get(sc.id)].jump = back ? 'back' : 'fwd';
      if (back) flashbacks++; else forwards++;
    });
    return { script, scenes, story, pos, flashbacks, forwards };
  }

  async function addEvent(d, afterId) {
    const U = SD.ui;
    const text = await U.promptText('Something that happens but is not shown', '');
    if (!text || !text.trim()) return;
    const e = { id: SD.uid(), text: text.trim() };
    d.events.push(e);
    const at = afterId ? d.order.indexOf(afterId) + 1 : 0;
    d.order.splice(at, 0, e.id);
    U.markDirty();
    U.renderView();
  }

  function renderTimeline(root, d) {
    const U = SD.ui;
    const { h } = U;
    const t = build(d);
    if (!t) {
      root.append(h('div', { class: 'empty-state story-empty' }, h('div', { class: 'empty-icon' }, '⏳'), h('h3', {}, 'Story order vs. plot order'),
        h('p', { class: 'muted' }, 'On the left, your scenes in the order you tell them. On the right, the order they really happen. Drag scenes on the right to put them in story order; flashbacks and flash-forwards show up as crossing lines. Add backstory events that happen before or between scenes but are never shown.'),
        h('div', { class: 'row-gap center' }, h('button', { class: 'btn primary', onclick: (e) => linkMenu(e.currentTarget, d) }, 'Link a script…'))));
      return;
    }
    const changed = () => { U.markDirty(); U.renderStatusSoon(); U.renderNavigatorSoon(); };
    const redraw = () => { const sc = root.scrollTop; U.renderView(); const ov = document.querySelector('#other-view'); if (ov) ov.scrollTop = sc; };
    const ROW = 52;
    const whenIn = (id) => h('input', { class: 'tl-when', dataset: { for: id }, value: d.when[id] || '', placeholder: 'When?', title: 'When it happens, e.g. “1998”, “Day 3, night”, “20 years earlier”', oninput: (e) => { if (e.target.value.trim()) d.when[id] = e.target.value; else delete d.when[id]; changed(); syncWhen(id, e.target); } });
    const syncWhen = (id, src) => root.querySelectorAll(`.tl-when[data-for="${id}"]`).forEach((x) => { if (x !== src) x.value = d.when[id] || ''; });

    const left = h('ol', { class: 'tl-list tl-told' }, t.scenes.map((s) => h('li', { class: 'tl-item', dataset: { id: s.id }, style: s.color ? `--c:${s.color}` : '' },
      h('div', { class: 'tl-label', title: s.synopsis }, s.label),
      whenIn(s.id))));
    const right = h('ol', { class: 'tl-list tl-story' }, t.story.map((x, i) => h('li', { class: 'tl-item' + (x.event ? ' ev' : '') + (x.jump ? ' jump-' + x.jump : ''), draggable: 'true', dataset: { id: x.id }, style: x.color ? `--c:${x.color}` : '' },
      h('span', { class: 'tl-grip', title: 'Drag to change when it happens' }, '⋮⋮'),
      x.event
        ? h('input', { class: 'tl-evtext', value: x.e.text, oninput: (e) => { x.e.text = e.target.value; changed(); } })
        : h('div', { class: 'tl-label', title: x.synopsis }, x.label),
      x.jump ? h('span', { class: 'tl-jump', title: x.jump === 'back' ? 'Told after a later scene: a flashback' : 'Told before scenes that happen earlier: a flash-forward' }, x.jump === 'back' ? '↶ flashback' : '↷ flash-forward') : null,
      whenIn(x.id),
      h('button', { class: 'icon-btn', title: 'More', 'aria-label': 'Options', onclick: (e) => U.popupMenu(e.currentTarget, [
        { label: 'Add a backstory event after this', run: () => addEvent(d, x.id) },
        { label: 'Move earlier', run: () => { if (i > 0) { d.order.splice(i, 1); d.order.splice(i - 1, 0, x.id); changed(); redraw(); } } },
        { label: 'Move later', run: () => { if (i < d.order.length - 1) { d.order.splice(i, 1); d.order.splice(i + 1, 0, x.id); changed(); redraw(); } } },
        x.event ? '-' : null,
        x.event ? { label: 'Delete event', danger: true, run: () => { d.events = d.events.filter((y) => y.id !== x.id); d.order = d.order.filter((y) => y !== x.id); changed(); redraw(); } } : null,
      ]) }, '⋯'))));

    // lines from each scene as told to where it happens
    const H = Math.max(t.scenes.length, t.story.length) * ROW + 10;
    const lines = h('div', { class: 'tl-lines' });
    const svgLines = t.scenes.map((s) => {
      const y1 = s.n * ROW + ROW / 2, y2 = t.pos.get(s.id) * ROW + ROW / 2;
      const x = t.story[t.pos.get(s.id)];
      const cls = x.jump === 'back' ? 'back' : x.jump === 'fwd' ? 'fwd' : '';
      return `<path class="tl-link ${cls}" d="M0,${y1} C60,${y1} 60,${y2} 120,${y2}"/>`;
    }).join('');
    lines.innerHTML = `<svg viewBox="0 0 120 ${H}" width="120" height="${H}" preserveAspectRatio="none">${svgLines}</svg>`;

    const wrap = h('div', { class: 'view-pad tl', style: `--row:${ROW}px` },
      h('div', { class: 'tl-head' },
        h('div', {}, h('h3', {}, 'As told'), h('p', { class: 'muted small' }, 'The order of the script.')),
        h('div', {}),
        h('div', {}, h('h3', {}, 'As it happened'), h('p', { class: 'muted small' }, 'Drag to put things in the order they happen. ◆ = backstory, not shown.'))),
      h('div', { class: 'tl-grid' }, left, lines, right),
      h('div', { class: 'legend' }, h('span', {}, h('i', { class: 'tl-key' }), 'in order'), h('span', {}, h('i', { class: 'tl-key back' }), 'flashback (↶)'), h('span', {}, h('i', { class: 'tl-key fwd' }), 'flash-forward (↷)')));

    let drag = null;
    right.addEventListener('dragstart', (e) => { const li = e.target.closest && e.target.closest('.tl-item'); if (!li || e.target.closest('input')) return; drag = li.dataset.id; e.dataTransfer.setData('text/x-scriptdesk-time', drag); e.dataTransfer.effectAllowed = 'move'; li.classList.add('dragging'); });
    right.addEventListener('dragend', () => { drag = null; right.querySelectorAll('.dragging, .drop-before, .drop-after').forEach((x) => x.classList.remove('dragging', 'drop-before', 'drop-after')); });
    const spot = (e) => { const li = e.target.closest('.tl-item'); if (!li) return null; const r = li.getBoundingClientRect(); return { li, after: e.clientY > r.top + r.height / 2 }; };
    right.addEventListener('dragover', (e) => { if (!drag) return; e.preventDefault(); right.querySelectorAll('.drop-before, .drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after')); const s = spot(e); if (s) s.li.classList.add(s.after ? 'drop-after' : 'drop-before'); });
    right.addEventListener('drop', (e) => {
      if (!drag) return;
      e.preventDefault();
      const s = spot(e);
      if (!s || s.li.dataset.id === drag) return;
      d.order = d.order.filter((id) => id !== drag);
      d.order.splice(d.order.indexOf(s.li.dataset.id) + (s.after ? 1 : 0), 0, drag);
      drag = null;
      changed();
      redraw();
    });
    root.append(wrap);
  }
})();
