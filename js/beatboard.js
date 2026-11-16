/* Scriptdesk — beat board: story structure beats with scene cards and note cards pinned to them */
(function () {
  'use strict';
  const SD = (window.SD = window.SD || {});
  SD.KINDS = SD.KINDS || {};

  // [title, what happens here, where it usually falls (0–100 % of the story)]
  SD.BEAT_TEMPLATES = {
    threeAct: {
      label: 'Three acts',
      about: 'The classic set-up, confrontation and resolution.',
      beats: [
        ['Set-up', 'Who the hero is, what their world looks like and what is missing.', 0],
        ['Inciting incident', 'Something happens that upsets the normal world.', 12],
        ['Plot point 1', 'The hero commits and the story turns. End of act one.', 25],
        ['Rising action', 'Obstacles get harder; the hero tries and fails, learns.', 37],
        ['Midpoint', 'A big win or loss that raises the stakes and changes the goal.', 50],
        ['Plot point 2', 'The lowest point; everything seems lost. End of act two.', 75],
        ['Climax', 'The final confrontation; the hero acts on what they learned.', 88],
        ['Resolution', 'The new normal. What changed?', 97],
      ],
    },
    saveTheCat: {
      label: 'Save the Cat (15 beats)',
      about: 'Blake Snyder’s beat sheet, widely used for films.',
      beats: [
        ['Opening image', 'A snapshot of the hero and their world before the change.', 0],
        ['Theme stated', 'Someone hints at the lesson the hero needs to learn.', 5],
        ['Set-up', 'The hero’s life, flaws and the people around them.', 5],
        ['Catalyst', 'The event that sets the story in motion.', 10],
        ['Debate', 'The hero hesitates: should I go?', 15],
        ['Break into two', 'The hero chooses to act and enters a new world.', 20],
        ['B story', 'A new relationship that carries the theme.', 22],
        ['Fun and games', 'The promise of the premise: what the audience came for.', 30],
        ['Midpoint', 'A false victory or false defeat; the stakes go up.', 50],
        ['Bad guys close in', 'Outside pressure and inner doubts tighten.', 62],
        ['All is lost', 'The worst moment; often a death, real or symbolic.', 75],
        ['Dark night of the soul', 'The hero mourns and finally understands.', 78],
        ['Break into three', 'A new idea, from the A and B stories together.', 80],
        ['Finale', 'The hero proves they have changed.', 88],
        ['Final image', 'The opposite of the opening image.', 99],
      ],
    },
    herosJourney: {
      label: 'Hero’s journey (12 stages)',
      about: 'Christopher Vogler’s version of the monomyth.',
      beats: [
        ['Ordinary world', 'The hero at home, before the adventure.', 0],
        ['Call to adventure', 'A problem or a challenge appears.', 10],
        ['Refusal of the call', 'Fear or duty holds the hero back.', 15],
        ['Meeting the mentor', 'Someone gives advice, a gift or courage.', 20],
        ['Crossing the threshold', 'The hero leaves the familiar world.', 25],
        ['Tests, allies, enemies', 'The hero learns the rules of the new world.', 35],
        ['Approach', 'Preparing for the big challenge.', 45],
        ['The ordeal', 'The central crisis: facing the greatest fear.', 55],
        ['Reward', 'The hero takes the prize.', 65],
        ['The road back', 'Consequences; the way home has its own dangers.', 75],
        ['Resurrection', 'A final test where everything is at stake.', 88],
        ['Return with the elixir', 'The hero comes home changed, with something to share.', 97],
      ],
    },
    storyCircle: {
      label: 'Story circle (8 steps)',
      about: 'Dan Harmon’s simple circle, good for episodes and short films.',
      beats: [
        ['You', 'A character in their comfort zone.', 0],
        ['Need', 'They want something.', 12],
        ['Go', 'They enter an unfamiliar situation.', 25],
        ['Search', 'They adapt to it.', 37],
        ['Find', 'They get what they wanted.', 50],
        ['Take', 'They pay a heavy price for it.', 62],
        ['Return', 'They go back to where they started.', 75],
        ['Change', 'They are changed by it.', 90],
      ],
    },
    sevenPoint: {
      label: 'Seven-point structure',
      about: 'Dan Wells’ structure, planned from the ending backwards.',
      beats: [
        ['Hook', 'The starting state, the opposite of the resolution.', 0],
        ['Plot turn 1', 'The call that starts the conflict.', 15],
        ['Pinch 1', 'Pressure from the antagonist forces action.', 35],
        ['Midpoint', 'The hero moves from reacting to acting.', 50],
        ['Pinch 2', 'The plan fails; things get worse.', 62],
        ['Plot turn 2', 'The hero finds the last piece they need.', 80],
        ['Resolution', 'The climax and the new state.', 95],
      ],
    },
    blank: { label: 'Blank board', about: 'Start empty and add your own beats.', beats: [] },
  };

  const beatsFrom = (key) => (SD.BEAT_TEMPLATES[key] || SD.BEAT_TEMPLATES.blank).beats.map(([title, hint, pct]) => ({ id: SD.uid(), title, hint, pct, cards: [] }));
  const NOTE_COLORS = ['#fff4c2', '#ffd9cc', '#d6f0ff', '#dff5dc', '#eadcff', '#f1f1f1'];

  const K = {
    icon: '🧭',
    label: 'Beat Board',
    create(project, name) {
      const scripts = project.documents.filter((x) => x.kind === 'script');
      return { id: SD.uid(), kind: 'beatboard', name, sourceId: scripts.length === 1 ? scripts[0].id : null, template: '', beats: [] };
    },
    normalize(d) {
      d.beats = Array.isArray(d.beats) ? d.beats : [];
      d.template = d.template || '';
      for (const b of d.beats) { b.id = b.id || SD.uid(); b.title = b.title || ''; b.hint = b.hint || ''; b.cards = Array.isArray(b.cards) ? b.cards : []; for (const c of b.cards) c.id = c.id || SD.uid(); }
    },
    hasContent: (d) => d.beats.some((b) => b.cards.length) || (d.beats.length > 0 && d.template === 'blank'),
    status(d) {
      const cards = d.beats.reduce((n, b) => n + b.cards.length, 0);
      const script = source(d);
      const total = script ? SD.getScenes(script).length : 0;
      const placed = new Set(d.beats.flatMap((b) => b.cards.filter((c) => c.sceneId).map((c) => c.sceneId)));
      const empty = d.beats.filter((b) => !b.cards.length).length;
      return `Beat board  ·  ${d.beats.length} beats  ·  ${cards} cards` + (script ? `  ·  ${placed.size} of ${total} scenes placed` : '') + (empty ? `  ·  ${empty} empty beat${empty === 1 ? '' : 's'}` : '');
    },
    navigator(d) {
      return {
        label: 'Beats', empty: 'Pick a structure to get beats.',
        items: d.beats.map((b, i) => ({ num: i + 1, text: b.title || 'Untitled beat', len: b.cards.length || '', title: b.hint, onclick: () => { const el = document.querySelector(`.bb-col[data-beat="${b.id}"]`); if (el) el.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); } })),
      };
    },
    toolbar(d) {
      const { h } = SD.ui;
      return [
        h('button', { class: 'btn small', onclick: () => { addBeat(d); } }, '+ Beat'),
        h('button', { class: 'btn small', title: 'The script whose scenes you place on the board', onclick: (e) => linkMenu(e.currentTarget, d) }, source(d) ? '🎬 ' + source(d).name : 'Link a script…'),
        h('button', { class: 'btn small', onclick: (e) => templateMenu(e.currentTarget, d) }, 'Structure…'),
        h('div', { class: 'tb-group' }, h('button', { class: 'btn ghost small', title: 'Print the beat sheet', onclick: () => K.print(d) }, 'Print')),
      ];
    },
    render(root, d) { renderBoard(root, d); },
    print(d) {
      const { h, printNodes, project } = SD.ui;
      const script = source(d);
      const info = sceneInfo(d);
      const nodes = [h('h1', {}, [project.title, d.name].filter(Boolean).join(' — '))];
      for (const b of d.beats) {
        nodes.push(h('section', { class: 'pbb-beat' },
          h('h2', {}, b.title || 'Untitled beat', b.pct != null && b.pct !== '' ? h('span', { class: 'pbb-pct' }, ` · around ${b.pct}%`) : null),
          b.hint ? h('p', { class: 'pbb-hint' }, b.hint) : null,
          b.cards.length ? h('ul', {}, b.cards.map((c) => {
            const s = c.sceneId && info.get(c.sceneId);
            return h('li', {}, s ? [h('strong', {}, `Scene ${s.number} `), s.heading, s.synopsis ? ' — ' + s.synopsis : ''] : c.text);
          })) : h('p', { class: 'pbb-empty' }, '(nothing here yet)')));
      }
      if (script) nodes.push(h('p', { class: 'pbb-hint' }, `Scenes from “${script.name}”.`));
      printNodes('print-beats', nodes, { title: project.title + ' - ' + d.name });
    },
  };
  SD.KINDS.beatboard = K;

  const source = (d) => SD.ui.project.documents.find((x) => x.id === d.sourceId && x.kind === 'script') || null;

  // scene number, heading, synopsis and position (0–100 %) for the linked script
  function sceneInfo(d) {
    const script = source(d);
    const out = new Map();
    if (!script) return out;
    const scenes = SD.getScenes(script);
    const est = scenes.estimate;
    for (const s of scenes) {
      out.set(s.id, {
        scene: s, number: s.number, heading: (script.scriptType === 'comic' ? 'PAGE ' + s.number + ' ' : '') + (s.el.text || '').toUpperCase(),
        synopsis: s.el.synopsis || '', color: s.el.color || '', page: s.page,
        pct: Math.round((est.lineAt[s.start] / Math.max(1, est.totalLines)) * 100),
      });
    }
    return out;
  }

  function addBeat(d, after) {
    const U = SD.ui;
    const b = { id: SD.uid(), title: 'New beat', hint: '', pct: '', cards: [] };
    const i = after == null ? d.beats.length : d.beats.indexOf(after) + 1;
    d.beats.splice(i, 0, b);
    if (!d.template) d.template = 'blank';
    U.markDirty();
    U.renderView();
    setTimeout(() => { const el = document.querySelector(`.bb-col[data-beat="${b.id}"] .bb-title`); if (el) { el.scrollIntoView({ inline: 'center', block: 'nearest' }); el.focus(); el.select(); } }, 30);
  }

  function linkMenu(anchor, d) {
    const U = SD.ui;
    const scripts = U.project.documents.filter((x) => x.kind === 'script');
    if (!scripts.length) { U.toast('There is no script in this project yet.'); return; }
    U.popupMenu(anchor, [
      ...scripts.map((s) => ({ label: (s.id === d.sourceId ? '✓ ' : '') + s.name + ' — ' + SD.getScenes(s).length + ' scenes', run: () => { d.sourceId = s.id; U.markDirty(); U.renderView(); } })),
      d.sourceId ? '-' : null,
      d.sourceId ? { label: 'Unlink (keep only note cards)', run: () => { d.sourceId = null; d.beats.forEach((b) => { b.cards = b.cards.filter((c) => !c.sceneId); }); U.markDirty(); U.renderView(); } } : null,
    ]);
  }

  function templateMenu(anchor, d) {
    const U = SD.ui;
    U.popupMenu(anchor, Object.entries(SD.BEAT_TEMPLATES).map(([k, t]) => ({ label: (d.template === k ? '✓ ' : '') + t.label, run: () => applyTemplate(d, k) })));
  }

  async function applyTemplate(d, key) {
    const U = SD.ui;
    const cards = d.beats.flatMap((b) => b.cards);
    if (d.beats.length && d.template !== key) {
      const ok = await U.modal({ title: 'Switch to “' + SD.BEAT_TEMPLATES[key].label + '”?', body: cards.length ? `The beats are replaced. Your ${cards.length} cards go back: scene cards to the scene tray, note cards to the first beat.` : 'The current beats are replaced.', buttons: [{ label: 'Cancel', value: false }, { label: 'Switch', value: true, primary: true }] });
      if (!ok) return;
    }
    d.template = key;
    d.beats = beatsFrom(key);
    const notes = cards.filter((c) => !c.sceneId);
    if (notes.length) { if (!d.beats.length) d.beats.push({ id: SD.uid(), title: 'Notes', hint: '', pct: '', cards: [] }); d.beats[0].cards.push(...notes); }
    U.markDirty();
    U.renderView();
  }

  function renderBoard(root, d) {
    const U = SD.ui;
    const { h } = U;
    if (!d.beats.length && d.template !== 'blank') {
      root.append(h('div', { class: 'bb-pick' },
        h('div', { class: 'empty-icon' }, '🧭'),
        h('h2', {}, 'Pick a structure'),
        h('p', { class: 'muted' }, 'Beats are the big turning points of a story. Pin your scenes to them to see where the story is strong and where there are gaps.'),
        h('div', { class: 'bb-templates' }, Object.entries(SD.BEAT_TEMPLATES).map(([k, t]) => h('button', { class: 'bb-tpl', onclick: () => applyTemplate(d, k) },
          h('strong', {}, t.label), h('span', { class: 'muted small' }, t.about), t.beats.length ? h('span', { class: 'bb-tpl-beats' }, t.beats.map((b) => b[0]).join(' · ')) : null)))));
      return;
    }
    const info = sceneInfo(d);
    const script = source(d);
    const placed = new Set(d.beats.flatMap((b) => b.cards.filter((c) => c.sceneId).map((c) => c.sceneId)));
    const pages = script ? SD.estimate(script).pages : 0;
    let drag = null;
    const changed = () => { U.markDirty(); U.renderStatusSoon(); U.renderNavigatorSoon(); };
    const redraw = () => { const sx = board.scrollLeft; U.renderView(); const nb = document.querySelector('.bb-board'); if (nb) nb.scrollLeft = sx; };

    const sceneCard = (c, s, beat) => {
      const off = beat && beat.pct !== '' && beat.pct != null ? s.pct - beat.pct : 0;
      const warn = beat && Math.abs(off) > 15 ? (off < 0 ? 'early' : 'late') : '';
      return h('div', { class: 'bb-card scene', draggable: 'true', style: s.color ? `--card-color:${s.color}` : '', dataset: { card: c ? c.id : '', scene: s.scene.id } },
        h('div', { class: 'bb-card-top' },
          h('span', { class: 'bb-num' }, 'Sc ' + s.number),
          h('span', { class: 'bb-pos', title: `Starts on page ${s.page}, ${s.pct}% into the script` }, `p. ${s.page} · ${s.pct}%`),
          warn ? h('span', { class: 'bb-warn', title: `This beat usually comes around ${beat.pct}%. This scene is at ${s.pct}%.` }, warn === 'early' ? '◀ early' : 'late ▶') : null,
          h('button', { class: 'icon-btn bb-open', title: 'Open the scene', onclick: () => U.goToScene(script.id, s.scene.id) }, '↗'),
          c ? h('button', { class: 'icon-btn bb-x', title: 'Back to the scene tray', 'aria-label': 'Remove from beat', onclick: () => { beat.cards = beat.cards.filter((x) => x !== c); changed(); redraw(); } }, '×') : null),
        h('div', { class: 'bb-heading' }, s.heading || 'Untitled scene'),
        s.synopsis ? h('div', { class: 'bb-syn' }, s.synopsis) : null);
    };
    const noteCard = (c, beat) => h('div', { class: 'bb-card note', style: `--note:${c.color || NOTE_COLORS[0]}`, dataset: { card: c.id } },
      h('div', { class: 'bb-card-top', draggable: 'true', title: 'Drag to move' },
        h('span', { class: 'bb-num' }, 'Note'),
        h('span', { class: 'bb-colors' }, NOTE_COLORS.map((col) => h('button', { class: 'bb-dot' + (c.color === col ? ' on' : ''), style: `background:${col}`, 'aria-label': 'Colour', onclick: (e) => { c.color = col; e.currentTarget.closest('.bb-card').style.setProperty('--note', col); changed(); } }))),
        h('button', { class: 'icon-btn bb-x', title: 'Delete note', 'aria-label': 'Delete note', onclick: () => { beat.cards = beat.cards.filter((x) => x !== c); changed(); redraw(); } }, '×')),
      h('textarea', { class: 'bb-note', rows: 3, value: c.text || '', placeholder: 'An idea, a scene you still need…', oninput: (e) => { c.text = e.target.value; changed(); } }));

    const cols = d.beats.map((b, bi) => {
      const col = h('section', { class: 'bb-col' + (b.cards.length ? '' : ' empty'), dataset: { beat: b.id } },
        h('div', { class: 'bb-col-head' },
          h('div', { class: 'bb-col-row' },
            h('span', { class: 'bb-beatno' }, bi + 1),
            h('input', { class: 'bb-title', value: b.title, 'aria-label': 'Beat name', oninput: (e) => { b.title = e.target.value; changed(); } }),
            h('button', {
              class: 'icon-btn', title: 'Beat options', 'aria-label': 'Beat options',
              onclick: (e) => U.popupMenu(e.currentTarget, [
                { label: 'Insert a beat after', run: () => addBeat(d, b) },
                { label: 'Move left', run: () => { if (bi > 0) { d.beats.splice(bi, 1); d.beats.splice(bi - 1, 0, b); changed(); redraw(); } } },
                { label: 'Move right', run: () => { if (bi < d.beats.length - 1) { d.beats.splice(bi, 1); d.beats.splice(bi + 1, 0, b); changed(); redraw(); } } },
                '-',
                { label: 'Delete beat', danger: true, run: () => { d.beats.splice(bi, 1); changed(); redraw(); } },
              ]),
            }, '⋯')),
          h('div', { class: 'bb-col-row small' },
            h('label', { class: 'bb-pct', title: 'Where this beat usually falls in the story' }, '≈', h('input', { type: 'number', min: 0, max: 100, value: b.pct === '' || b.pct == null ? '' : b.pct, placeholder: '–', oninput: (e) => { b.pct = e.target.value === '' ? '' : Math.max(0, Math.min(100, +e.target.value)); changed(); } }), '%'),
            pages && b.pct !== '' && b.pct != null ? h('span', { class: 'muted' }, `page ~${Math.max(1, Math.round((b.pct / 100) * pages))}`) : null),
          h('textarea', { class: 'bb-hint', rows: 2, value: b.hint, placeholder: 'What happens in this beat?', oninput: (e) => { b.hint = e.target.value; changed(); } })),
        h('div', { class: 'bb-cards', dataset: { drop: b.id } },
          b.cards.map((c) => (c.sceneId ? (info.get(c.sceneId) ? sceneCard(c, info.get(c.sceneId), b) : h('div', { class: 'bb-card gone', dataset: { card: c.id } }, 'A scene that is no longer in the script.', h('button', { class: 'icon-btn bb-x', onclick: () => { b.cards = b.cards.filter((x) => x !== c); changed(); redraw(); } }, '×'))) : noteCard(c, b))),
          b.cards.length ? null : h('div', { class: 'bb-gap' }, 'Nothing here yet — a gap in the story?')),
        h('button', { class: 'btn ghost small bb-addnote', onclick: () => { b.cards.push({ id: SD.uid(), text: '', color: NOTE_COLORS[0] }); changed(); redraw(); setTimeout(() => { const t = document.querySelector(`.bb-col[data-beat="${b.id}"] .bb-card.note:last-of-type textarea`); if (t) t.focus(); }, 30); } }, '+ Note card'));
      return col;
    });

    const unplaced = [...info.values()].filter((s) => !placed.has(s.scene.id));
    const tray = h('aside', { class: 'bb-tray' },
      h('div', { class: 'bb-tray-head' }, h('strong', {}, 'Scenes'), h('span', { class: 'muted small' }, script ? `${unplaced.length} not placed` : '')),
      script
        ? h('div', { class: 'bb-cards', dataset: { drop: 'tray' } }, unplaced.length ? unplaced.map((s) => sceneCard(null, s, null)) : h('p', { class: 'muted small' }, 'Every scene is on the board.'))
        : h('div', { class: 'muted small bb-tray-empty' }, h('p', {}, 'Link a script to place its scenes on the beats.'), h('button', { class: 'btn small', onclick: (e) => linkMenu(e.currentTarget, d) }, 'Link a script…')),
      h('p', { class: 'muted small' }, 'Drag scenes onto a beat. ◀ early / late ▶ means a scene sits far from where that beat usually falls.'));

    const board = h('div', { class: 'bb-board' }, cols, h('button', { class: 'bb-addcol', onclick: () => addBeat(d) }, '+ Beat'));
    const wrap = h('div', { class: 'bb' }, tray, board);

    // drag & drop: scene cards from the tray or another beat, note cards between beats
    wrap.addEventListener('dragstart', (e) => {
      const card = e.target.closest && e.target.closest('.bb-card');
      if (!card || e.target.closest('textarea')) return;
      drag = { cardId: card.dataset.card, sceneId: card.dataset.scene };
      e.dataTransfer.setData('text/x-scriptdesk-beat', '1');
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging');
    });
    wrap.addEventListener('dragend', () => { drag = null; wrap.querySelectorAll('.dragging, .drop-on, .drop-before').forEach((x) => x.classList.remove('dragging', 'drop-on', 'drop-before')); });
    const target = (e) => {
      const zone = e.target.closest('[data-drop]') || (e.target.closest('.bb-col') && e.target.closest('.bb-col').querySelector('[data-drop]'));
      if (!zone) return null;
      const before = e.target.closest('.bb-card');
      return { zone, before: before && zone.contains(before) ? before : null };
    };
    wrap.addEventListener('dragover', (e) => {
      if (!drag) return;
      const t = target(e);
      wrap.querySelectorAll('.drop-on, .drop-before').forEach((x) => x.classList.remove('drop-on', 'drop-before'));
      if (!t) return;
      if (t.zone.dataset.drop === 'tray' && !drag.sceneId) return;
      e.preventDefault();
      t.zone.classList.add('drop-on');
      if (t.before) t.before.classList.add('drop-before');
    });
    wrap.addEventListener('drop', (e) => {
      if (!drag) return;
      const t = target(e);
      if (!t) return;
      e.preventDefault();
      let card = null;
      for (const b of d.beats) { const i = b.cards.findIndex((c) => c.id === drag.cardId); if (i >= 0) { card = b.cards.splice(i, 1)[0]; break; } }
      if (t.zone.dataset.drop !== 'tray') {
        if (!card) card = { id: SD.uid(), sceneId: drag.sceneId };
        const beat = d.beats.find((b) => b.id === t.zone.dataset.drop);
        const bi = t.before ? beat.cards.findIndex((c) => c.id === t.before.dataset.card) : -1;
        beat.cards.splice(bi >= 0 ? bi : beat.cards.length, 0, card);
      }
      drag = null;
      changed();
      redraw();
    });
    root.append(wrap);
  }
})();
