/* Scriptdesk — production schedule: strip board, calendar, one-line schedule, call sheets */
(function () {
  'use strict';
  const SD = (window.SD = window.SD || {});
  SD.KINDS = SD.KINDS || {};

  const pad = (n) => String(n).padStart(2, '0');
  const iso = (dt) => dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
  const parseIso = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const nice = (s, opts) => { const dt = parseIso(s); return dt ? dt.toLocaleDateString(undefined, opts || { weekday: 'short', day: 'numeric', month: 'short' }) : ''; };

  // INT/EXT and DAY/NIGHT decide the strip colour, as on a paper strip board
  function classify(text) {
    const p = SD.parseSceneHeading(text || '');
    const set = (p.setting || '').toUpperCase();
    const ie = set.includes('INT') && set.includes('EXT') || set.startsWith('I/E') ? 'ie' : set.startsWith('EXT') ? 'ext' : set.startsWith('INT') ? 'int' : '';
    const t = (p.time || '').toUpperCase();
    const dn = /NIGHT|DUSK|EVENING|DARK/.test(t) ? 'night' : t ? 'day' : '';
    return { ie, dn, location: p.location || (text || '').toUpperCase(), time: p.time || '', setting: p.setting || '' };
  }

  const K = {
    icon: '📅',
    label: 'Schedule',
    create(project, name) {
      const scripts = project.documents.filter((x) => x.kind === 'script');
      return K.normalize({ id: SD.uid(), kind: 'schedule', name, sourceId: scripts.length === 1 ? scripts[0].id : null, days: [], events: [] }) || null;
    },
    normalize(d) {
      d.days = Array.isArray(d.days) ? d.days : [];
      d.events = Array.isArray(d.events) ? d.events : [];
      d.done = d.done && typeof d.done === 'object' ? d.done : {};
      d.callsheet = Object.assign({ company: '', contact: '', producer: '', director: '', location: '', weather: '', notes: '' }, d.callsheet || {});
      d.settings = Object.assign({ maxPages: 5, skipWeekends: true, sort: 'script' }, d.settings || {});
      for (const x of d.days) { x.id = x.id || SD.uid(); x.scenes = Array.isArray(x.scenes) ? x.scenes : []; x.date = x.date || ''; x.call = x.call || ''; x.notes = x.notes || ''; }
      for (const e of d.events) { e.id = e.id || SD.uid(); e.title = e.title || ''; e.date = e.date || ''; }
      return d;
    },
    hasContent: (d) => d.days.length > 0 || d.events.length > 0,
    tabs: [['strips', 'Strip board'], ['calendar', 'Calendar'], ['oneline', 'One-line schedule']],
    status(d) {
      const info = sceneInfo(d);
      const sched = new Set(d.days.flatMap((x) => x.scenes));
      const lines = [...info.values()].filter((s) => sched.has(s.id)).reduce((n, s) => n + s.lines, 0);
      return `Schedule  ·  ${d.days.length} shoot days  ·  ${[...sched].filter((id) => info.has(id)).length} of ${info.size} scenes scheduled  ·  ${lines ? SD.eighths(lines) : 0} pages`;
    },
    navigator(d) {
      const info = sceneInfo(d);
      return {
        label: 'Shoot days', empty: 'No shoot days yet.',
        items: d.days.map((x, i) => ({
          num: i + 1, text: (x.date ? nice(x.date) + ' · ' : '') + (x.scenes.length + ' scenes'),
          len: SD.eighths(x.scenes.reduce((n, id) => n + (info.get(id) ? info.get(id).lines : 0), 0)),
          onclick: () => { SD.ui.state.kindTab.schedule = 'strips'; SD.ui.renderView(); setTimeout(() => { const el = document.querySelector(`.ss-col[data-day="${x.id}"]`); if (el) el.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); }, 30); },
        })),
      };
    },
    toolbar(d) {
      const { h } = SD.ui;
      return [
        h('button', { class: 'btn small', onclick: () => { addDay(d); } }, '+ Shoot day'),
        h('button', { class: 'btn small', title: 'Fill shoot days with the scenes that are not scheduled yet', onclick: () => autoSchedule(d) }, 'Auto-schedule…'),
        h('button', { class: 'btn small', onclick: () => setDates(d) }, 'Set dates…'),
        h('button', { class: 'btn small', title: 'The script that is being shot', onclick: (e) => linkMenu(e.currentTarget, d) }, source(d) ? '🎬 ' + source(d).name : 'Link a script…'),
        h('div', { class: 'tb-group' },
          h('button', { class: 'btn ghost small', title: 'Production company, contacts and notes for call sheets', onclick: () => editCallsheet(d) }, 'Production info…'),
          h('button', { class: 'btn ghost small', title: 'Download the shoot days and events for a calendar app', onclick: () => SD.ui.download(SD.ui.safeName(d.name) + '.ics', toIcs(d), 'text/calendar;charset=utf-8') }, '.ics'),
          h('button', { class: 'btn ghost small', onclick: () => K.print(d) }, 'Print')),
      ];
    },
    render(root, d) {
      const tab = SD.ui.tab('schedule', 'strips');
      if (!source(d) && !d.days.length && tab !== 'calendar') { renderEmpty(root, d); return; }
      if (tab === 'calendar') renderCalendar(root, d);
      else if (tab === 'oneline') root.append(oneLine(d, false));
      else renderStrips(root, d);
    },
    async print(d) {
      const U = SD.ui;
      const { h } = U;
      const what = h('select', { class: 'select' },
        h('option', { value: 'oneline' }, 'One-line schedule'),
        h('option', { value: 'strips' }, 'Strip board'),
        d.days.map((x, i) => h('option', { value: 'call:' + x.id }, `Call sheet — Day ${i + 1}${x.date ? ' (' + nice(x.date) + ')' : ''}`)));
      const ok = await U.modal({ title: 'Print schedule', body: h('div', {}, h('label', { class: 'lbl' }, 'What to print'), what), buttons: [{ label: 'Cancel', value: false }, { label: 'Print / PDF', value: true, primary: true }] });
      if (!ok) return;
      const title = [U.project.title, d.name].filter(Boolean).join(' — ');
      if (what.value === 'oneline') U.printNodes('print-sched', [h('h1', {}, title + ' — one-line schedule'), oneLine(d, true)], { title: d.name });
      else if (what.value === 'strips') U.printNodes('print-sched', [h('h1', {}, title + ' — strip board'), stripTable(d)], { landscape: true, title: d.name });
      else U.printNodes('print-sched', [callSheet(d, d.days.find((x) => 'call:' + x.id === what.value))], { title: d.name + ' - call sheet' });
    },
  };
  SD.KINDS.schedule = K;

  const source = (d) => SD.ui.project.documents.find((x) => x.id === d.sourceId && x.kind === 'script') || null;

  // number, heading, length, cast for every scene of the linked script
  function sceneInfo(d) {
    const script = source(d);
    const out = new Map();
    if (!script) return out;
    const scenes = SD.getScenes(script);
    const castOrder = cast(d, script, scenes);
    for (const s of scenes) {
      const c = classify(s.el.text);
      const chars = SD.sceneCharacters(script, s);
      out.set(s.id, Object.assign(c, { id: s.id, number: s.number, heading: (s.el.text || '').toUpperCase(), lines: s.lines, synopsis: s.el.synopsis || '', chars, castIds: chars.map((n) => castOrder.get(n)).filter(Boolean).sort((a, b) => a - b), scene: s }));
    }
    return out;
  }
  // cast numbers: the character in the most scenes is 1
  function cast(d, script, scenes) {
    const count = new Map(), first = new Map();
    scenes.forEach((s, i) => SD.sceneCharacters(script, s).forEach((n) => { count.set(n, (count.get(n) || 0) + 1); if (!first.has(n)) first.set(n, i); }));
    const order = [...count.keys()].sort((a, b) => count.get(b) - count.get(a) || first.get(a) - first.get(b));
    return new Map(order.map((n, i) => [n, i + 1]));
  }
  // things to check on a shoot day: actors who cannot work, stunts, animals, effects
  function dayWarnings(d, x, info) {
    const p = SD.ui.project;
    const out = [];
    const scenes = x.scenes.map((id) => info.get(id)).filter(Boolean);
    const names = new Set(scenes.flatMap((s) => s.chars));
    for (const ch of p.catalog.filter((c) => c.category === 'character' && names.has(c.name.trim().toUpperCase()))) {
      const a = ch.links.playedBy && p.catalog.find((it) => it.id === ch.links.playedBy);
      if (a && x.date && !SD.availableOn(a, x.date)) out.push(`${a.name} (${ch.name}) is not available on this date`);
    }
    const tagged = [...new Set(scenes.flatMap((s) => s.scene.el.items || []))].map((id) => p.catalog.find((it) => it.id === id)).filter(Boolean);
    for (const it of tagged) {
      const f = it.fields;
      if (it.category === 'stunts' && (f.risk === 'High' || f.risk === 'Medium') && !(+f.rehearsalDays > 0)) out.push(`Stunt “${it.name}” has no rehearsal planned`);
      if (it.category === 'stunts' && f.risk === 'High' && f.insurance !== 'Arranged') out.push(`Stunt “${it.name}”: insurance not arranged`);
      if (it.category === 'animal' && f.welfare === 'Needed') out.push(`${it.name}: book an animal welfare officer`);
      if ((it.category === 'sfx' || it.category === 'vfx') && f.supervisor === 'Needed') out.push(`${it.name}: a supervisor is needed on set`);
      if (it.category === 'weapon' && /blank|real/i.test(f.weaponType || '') && !String(f.armourer || '').trim()) out.push(`${it.name}: needs an armourer`);
    }
    return out;
  }
  SD.scheduleDayWarnings = dayWarnings;
  const castList = (d) => { const s = source(d); return s ? [...cast(d, s, SD.getScenes(s)).entries()] : []; };
  const dayLines = (x, info) => x.scenes.reduce((n, id) => n + (info.get(id) ? info.get(id).lines : 0), 0);

  function addDay(d, after) {
    const U = SD.ui;
    const last = d.days[d.days.length - 1];
    let date = '';
    if (last && last.date) { const dt = parseIso(last.date); do dt.setDate(dt.getDate() + 1); while (d.settings.skipWeekends && (dt.getDay() === 0 || dt.getDay() === 6)); date = iso(dt); }
    const x = { id: SD.uid(), date, call: last ? last.call : '07:00', notes: '', scenes: [] };
    d.days.splice(after == null ? d.days.length : d.days.indexOf(after) + 1, 0, x);
    U.markDirty();
    U.renderView();
    setTimeout(() => { const el = document.querySelector(`.ss-col[data-day="${x.id}"]`); if (el) el.scrollIntoView({ inline: 'center', block: 'nearest' }); }, 30);
    return x;
  }

  function linkMenu(anchor, d) {
    const U = SD.ui;
    const scripts = U.project.documents.filter((x) => x.kind === 'script');
    if (!scripts.length) { U.toast('There is no script in this project yet.'); return; }
    U.popupMenu(anchor, scripts.map((s) => ({ label: (s.id === d.sourceId ? '✓ ' : '') + s.name + ' — ' + SD.getScenes(s).length + ' scenes', run: () => { if (d.sourceId !== s.id) d.days.forEach((x) => { x.scenes = []; }); d.sourceId = s.id; U.markDirty(); U.renderView(); } })));
  }

  function renderEmpty(root, d) {
    const { h } = SD.ui;
    root.append(h('div', { class: 'empty-state story-empty' },
      h('div', { class: 'empty-icon' }, '📅'),
      h('h3', {}, 'Plan the shoot'),
      h('p', { class: 'muted' }, 'Link the script you are shooting. Its scenes become strips you drag onto shoot days. Strips are coloured like a paper strip board: white for interior day, yellow for exterior day, blue for interior night, green for exterior night.'),
      h('div', { class: 'row-gap center' }, h('button', { class: 'btn primary', onclick: (e) => linkMenu(e.currentTarget, d) }, 'Link a script…'))));
  }

  // ---------- strip board ----------
  function strip(s, d, opts = {}) {
    const { h } = SD.ui;
    return h('div', { class: `ss-strip ${s.ie || 'none'} ${s.dn || 'none'}` + (d.done[s.id] ? ' done' : ''), draggable: opts.static ? null : 'true', dataset: { scene: s.id }, title: s.synopsis || s.heading },
      h('span', { class: 'ss-no' }, s.number),
      h('span', { class: 'ss-main' }, [(s.setting || '').replace(/\.$/, ''), s.location || s.heading].filter(Boolean).join(' · ') + (s.time ? ' — ' + s.time : '')),
      h('span', { class: 'ss-pg' }, SD.eighths(s.lines)),
      h('span', { class: 'ss-sub', title: s.chars.join(', ') }, s.castIds.length ? 'Cast ' + s.castIds.join(', ') : 'No cast', s.synopsis ? ' · ' + s.synopsis : ''),
      opts.static ? null : h('button', { class: 'ss-done', title: d.done[s.id] ? 'Shot — click to undo' : 'Mark as shot', 'aria-label': 'Mark as shot', onclick: () => { if (d.done[s.id]) delete d.done[s.id]; else d.done[s.id] = true; SD.ui.markDirty(); SD.ui.renderView(); } }, d.done[s.id] ? '✓' : '○'));
  }

  function renderStrips(root, d) {
    const U = SD.ui;
    const { h } = U;
    const info = sceneInfo(d);
    const scheduled = new Set(d.days.flatMap((x) => x.scenes));
    let unsched = [...info.values()].filter((s) => !scheduled.has(s.id));
    const sorts = { script: (a, b) => a.number - b.number, location: (a, b) => a.location.localeCompare(b.location) || a.number - b.number, look: (a, b) => (a.ie + a.dn).localeCompare(b.ie + b.dn) || a.location.localeCompare(b.location) || a.number - b.number };
    unsched.sort(sorts[d.settings.sort] || sorts.script);
    const changed = () => { U.markDirty(); U.renderStatusSoon(); U.renderNavigatorSoon(); };
    const redraw = () => { const sx = board.scrollLeft; U.renderView(); const nb = document.querySelector('.ss-board'); if (nb) nb.scrollLeft = sx; };

    const col = (x, i) => {
      const lines = dayLines(x, info);
      const over = lines / SD.LINES_PER_PAGE > d.settings.maxPages;
      return h('section', { class: 'ss-col', dataset: { day: x.id } },
        h('div', { class: 'ss-head' },
          h('div', { class: 'ss-row' }, h('strong', {}, 'Day ' + (i + 1)),
            h('input', { type: 'date', class: 'ss-date', value: x.date, title: 'Shoot date', onchange: (e) => { x.date = e.target.value; changed(); redraw(); } }),
            h('button', {
              class: 'icon-btn', title: 'Day options', 'aria-label': 'Day options',
              onclick: (e) => U.popupMenu(e.currentTarget, [
                { label: 'Print call sheet', run: () => U.printNodes('print-sched', [callSheet(d, x)], { title: d.name + ' - call sheet' }) },
                { label: 'Insert a day after', run: () => addDay(d, x) },
                { label: 'Move earlier', run: () => { if (i > 0) { d.days.splice(i, 1); d.days.splice(i - 1, 0, x); changed(); redraw(); } } },
                { label: 'Move later', run: () => { if (i < d.days.length - 1) { d.days.splice(i, 1); d.days.splice(i + 1, 0, x); changed(); redraw(); } } },
                '-',
                { label: 'Delete day (scenes go back)', danger: true, run: () => { d.days.splice(i, 1); changed(); redraw(); } },
              ]),
            }, '⋯')),
          h('div', { class: 'ss-row small' },
            h('label', { title: 'Call time' }, 'Call ', h('input', { type: 'time', class: 'ss-time', value: x.call, onchange: (e) => { x.call = e.target.value; changed(); } })),
            h('span', { class: 'ss-total' + (over ? ' over' : ''), title: over ? `More than ${d.settings.maxPages} pages` : '' }, `${x.scenes.length} sc · ${lines ? SD.eighths(lines) : 0} pg`)),
          h('textarea', { class: 'ss-notes', rows: 1, value: x.notes, placeholder: 'Notes for this day', oninput: (e) => { x.notes = e.target.value; changed(); } }),
          (() => { const w = dayWarnings(d, x, info); return w.length ? h('div', { class: 'ss-warn', title: w.join('\n') }, '⚠ ' + (w.length === 1 ? w[0] : w.length + ' things to check: ' + w.join(' · '))) : null; })()),
        h('div', { class: 'ss-strips', dataset: { drop: x.id } },
          x.scenes.map((id) => (info.get(id) ? strip(info.get(id), d) : null)),
          x.scenes.length ? null : h('div', { class: 'ss-gap' }, 'Drag scenes here')));
    };

    const board = h('div', { class: 'ss-board' },
      h('section', { class: 'ss-col ss-pool' },
        h('div', { class: 'ss-head' },
          h('div', { class: 'ss-row' }, h('strong', {}, 'Not scheduled'), h('span', { class: 'muted small' }, unsched.length + ' scenes')),
          h('div', { class: 'ss-row small' }, 'Sort ', h('select', { class: 'select small', onchange: (e) => { d.settings.sort = e.target.value; changed(); redraw(); } },
            [['script', 'Script order'], ['location', 'Location'], ['look', 'Int/Ext & Day/Night']].map(([k, l]) => h('option', { value: k, selected: d.settings.sort === k }, l))))),
        h('div', { class: 'ss-strips', dataset: { drop: 'pool' } }, unsched.map((s) => strip(s, d)), unsched.length ? null : h('div', { class: 'ss-gap' }, 'Every scene is scheduled 🎬'))),
      d.days.map(col),
      h('button', { class: 'bb-addcol', onclick: () => addDay(d) }, '+ Shoot day'));

    const legend = h('div', { class: 'ss-legend' },
      [['int day', 'Interior day'], ['ext day', 'Exterior day'], ['int night', 'Interior night'], ['ext night', 'Exterior night']].map(([c, l]) => h('span', {}, h('i', { class: 'ss-key ' + c }), l)),
      h('span', { class: 'muted' }, 'Numbers on the right are cast IDs: ' + castList(d).slice(0, 8).map(([n, i]) => i + ' ' + n).join(', ') + (castList(d).length > 8 ? '…' : '')));

    // drag strips between days
    let drag = null;
    board.addEventListener('dragstart', (e) => { const s = e.target.closest && e.target.closest('.ss-strip'); if (!s) return; drag = s.dataset.scene; e.dataTransfer.setData('text/x-scriptdesk-strip', drag); e.dataTransfer.effectAllowed = 'move'; s.classList.add('dragging'); });
    board.addEventListener('dragend', () => { drag = null; board.querySelectorAll('.dragging, .drop-on, .drop-before').forEach((x) => x.classList.remove('dragging', 'drop-on', 'drop-before')); });
    const target = (e) => { const c = e.target.closest('.ss-col'); const zone = c && c.querySelector('[data-drop]'); if (!zone) return null; const b = e.target.closest('.ss-strip'); return { zone, before: b && zone.contains(b) && b.dataset.scene !== drag ? b : null }; };
    board.addEventListener('dragover', (e) => {
      if (!drag) return;
      const t = target(e);
      board.querySelectorAll('.drop-on, .drop-before').forEach((x) => x.classList.remove('drop-on', 'drop-before'));
      if (!t) return;
      e.preventDefault();
      t.zone.classList.add('drop-on');
      if (t.before) t.before.classList.add('drop-before');
    });
    board.addEventListener('drop', (e) => {
      if (!drag) return;
      const t = target(e);
      if (!t) return;
      e.preventDefault();
      d.days.forEach((x) => { x.scenes = x.scenes.filter((id) => id !== drag); });
      if (t.zone.dataset.drop !== 'pool') {
        const day = d.days.find((x) => x.id === t.zone.dataset.drop);
        const bi = t.before ? day.scenes.indexOf(t.before.dataset.scene) : -1;
        day.scenes.splice(bi >= 0 ? bi : day.scenes.length, 0, drag);
      }
      drag = null;
      changed();
      redraw();
    });
    root.append(h('div', { class: 'ss' }, legend, board));
  }

  // ---------- helpers: auto-schedule, dates, production info ----------
  async function autoSchedule(d) {
    const U = SD.ui;
    const { h } = U;
    const info = sceneInfo(d);
    if (!info.size) { U.toast('Link a script with scenes first.'); return; }
    const scheduled = new Set(d.days.flatMap((x) => x.scenes));
    const todo = [...info.values()].filter((s) => !scheduled.has(s.id));
    if (!todo.length) { U.toast('Every scene is already scheduled.'); return; }
    const max = h('input', { class: 'input', type: 'number', min: 1, step: 0.5, value: d.settings.maxPages });
    const byLoc = h('input', { type: 'checkbox', checked: true });
    const byLook = h('input', { type: 'checkbox', checked: true });
    const start = h('input', { class: 'input', type: 'date', value: d.days.length && d.days[d.days.length - 1].date ? '' : iso(new Date()) });
    const ok = await U.modal({
      title: 'Auto-schedule ' + todo.length + ' scenes',
      body: h('div', {},
        h('p', { class: 'muted small' }, 'Makes new shoot days for the scenes that are not scheduled yet. You can drag strips around afterwards.'),
        h('label', { class: 'lbl' }, 'At most this many pages a day'), max,
        h('label', { class: 'check' }, byLoc, ' Shoot scenes at the same location together'),
        h('label', { class: 'check' }, byLook, ' Keep day and night scenes on separate days'),
        h('label', { class: 'lbl' }, 'First new shoot day (optional)'), start),
      buttons: [{ label: 'Cancel', value: false }, { label: 'Schedule', value: true, primary: true }],
    });
    if (!ok) return;
    d.settings.maxPages = Math.max(0.5, +max.value || 5);
    const limit = d.settings.maxPages * SD.LINES_PER_PAGE;
    const key = (s) => (byLook.checked ? s.dn + '|' : '') + (byLoc.checked ? s.location : '');
    todo.sort((a, b) => key(a).localeCompare(key(b)) || a.number - b.number);
    let cur = null, lines = 0, lastKey = null, added = 0;
    for (const s of todo) {
      const k = key(s);
      const newLook = byLook.checked && lastKey != null && k.split('|')[0] !== lastKey.split('|')[0];
      if (!cur || lines + s.lines > limit && cur.scenes.length || newLook) { cur = { id: SD.uid(), date: '', call: '07:00', notes: '', scenes: [] }; d.days.push(cur); lines = 0; added++; }
      cur.scenes.push(s.id); lines += s.lines; lastKey = k;
    }
    if (start.value) assignDates(d, start.value, d.settings.skipWeekends, d.days.length - added);
    U.markDirty();
    U.renderView();
    U.toast(`Made ${added} shoot day${added === 1 ? '' : 's'}.`);
  }

  function assignDates(d, startIso, skipWeekends, from = 0) {
    const dt = parseIso(startIso);
    if (!dt) return;
    for (let i = from; i < d.days.length; i++) {
      while (skipWeekends && (dt.getDay() === 0 || dt.getDay() === 6)) dt.setDate(dt.getDate() + 1);
      d.days[i].date = iso(dt);
      dt.setDate(dt.getDate() + 1);
    }
  }

  async function setDates(d) {
    const U = SD.ui;
    const { h } = U;
    if (!d.days.length) { U.toast('Add shoot days first.'); return; }
    const start = h('input', { class: 'input', type: 'date', value: d.days[0].date || iso(new Date()) });
    const skip = h('input', { type: 'checkbox', checked: d.settings.skipWeekends });
    const ok = await U.modal({ title: 'Set shoot dates', body: h('div', {}, h('p', { class: 'muted small' }, 'Gives every shoot day a date, one after the other.'), h('label', { class: 'lbl' }, 'Day 1 is on'), start, h('label', { class: 'check' }, skip, ' Skip Saturdays and Sundays')), buttons: [{ label: 'Cancel', value: false }, { label: 'Set dates', value: true, primary: true }] });
    if (!ok || !start.value) return;
    d.settings.skipWeekends = skip.checked;
    assignDates(d, start.value, skip.checked);
    U.markDirty();
    U.renderView();
  }

  async function editCallsheet(d) {
    const U = SD.ui;
    const { h } = U;
    const c = d.callsheet;
    const f = (label, key, multi) => h('label', {}, h('span', { class: 'lbl' }, label), h(multi ? 'textarea' : 'input', { class: 'input', rows: 2, value: c[key] || '', oninput: (e) => { c[key] = e.target.value; U.markDirty(); } }));
    await U.modal({
      title: 'Production info (for call sheets)', wide: true,
      body: h('div', { class: 'sb-grid2' }, f('Production company', 'company', true), f('Contact', 'contact', true), f('Producer', 'producer'), f('Director', 'director'), f('Base / location address', 'location', true), f('Weather', 'weather', true), h('div', { style: 'grid-column:1/-1' }, f('General notes', 'notes', true))),
      buttons: [{ label: 'Done', value: true, primary: true }],
    });
  }

  // ---------- calendar ----------
  const cal = { month: null };
  function renderCalendar(root, d) {
    const U = SD.ui;
    const { h } = U;
    const info = sceneInfo(d);
    if (!cal.month) { const first = d.days.find((x) => x.date) || d.events.find((x) => x.date); const dt = first ? parseIso(first.date) : new Date(); cal.month = new Date(dt.getFullYear(), dt.getMonth(), 1); }
    const m = cal.month;
    const start = new Date(m); start.setDate(1 - ((m.getDay() + 6) % 7));
    const todayIso = iso(new Date());
    const go = (k) => { cal.month = new Date(m.getFullYear(), m.getMonth() + k, 1); U.renderView(); };
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const dt = new Date(start); dt.setDate(start.getDate() + i);
      const key = iso(dt);
      const days = d.days.map((x, k) => [x, k]).filter(([x]) => x.date === key);
      const evs = d.events.filter((e) => e.date === key);
      cells.push(h('div', {
        class: 'cal-cell' + (dt.getMonth() !== m.getMonth() ? ' out' : '') + (key === todayIso ? ' today' : '') + (dt.getDay() === 0 || dt.getDay() === 6 ? ' weekend' : ''),
        onclick: (e) => { if (e.target.closest('.cal-chip')) return; cellMenu(e.currentTarget, d, key); },
      },
      h('div', { class: 'cal-date' }, dt.getDate()),
      days.map(([x, k]) => h('button', { class: 'cal-chip day', title: x.scenes.map((id) => info.get(id) ? 'Sc ' + info.get(id).number + ' ' + info.get(id).heading : '').join('\n'), onclick: () => { SD.ui.state.kindTab.schedule = 'strips'; U.renderView(); setTimeout(() => { const el = document.querySelector(`.ss-col[data-day="${x.id}"]`); if (el) el.scrollIntoView({ inline: 'center', block: 'nearest' }); }, 30); } },
        h('strong', {}, 'Day ' + (k + 1)), ` · ${x.scenes.length} sc · ${SD.eighths(dayLines(x, info)) || 0} pg`)),
      evs.map((ev) => h('button', { class: 'cal-chip ev', onclick: () => editEvent(d, ev) }, ev.title || 'Event'))));
    }
    root.append(h('div', { class: 'cal' },
      h('div', { class: 'cal-head' },
        h('button', { class: 'btn small', onclick: () => go(-1) }, '‹'),
        h('h2', {}, m.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })),
        h('button', { class: 'btn small', onclick: () => go(1) }, '›'),
        h('button', { class: 'btn ghost small', onclick: () => { cal.month = new Date(new Date().getFullYear(), new Date().getMonth(), 1); U.renderView(); } }, 'Today'),
        h('span', { class: 'muted small push-right' }, 'Click a day to add an event (a rehearsal, a fitting, a location scout…) or to move a shoot day there.')),
      h('div', { class: 'cal-grid' },
        ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => h('div', { class: 'cal-wd' }, w)),
        cells)));
  }

  function cellMenu(anchor, d, key) {
    const U = SD.ui;
    U.popupMenu(anchor, [
      { label: 'Add an event on ' + nice(key) + '…', run: () => { const ev = { id: SD.uid(), date: key, title: '', notes: '' }; editEvent(d, ev, true); } },
      d.days.length ? '-' : null,
      ...d.days.map((x, i) => ({ label: `Move Day ${i + 1} here` + (x.date ? ` (now ${nice(x.date)})` : ''), run: () => { x.date = key; U.markDirty(); U.renderView(); } })),
    ]);
  }

  async function editEvent(d, ev, isNew) {
    const U = SD.ui;
    const { h } = U;
    const t = h('input', { class: 'input', value: ev.title, placeholder: 'e.g. Table read, costume fitting' });
    const dt = h('input', { class: 'input', type: 'date', value: ev.date });
    const n = h('textarea', { class: 'input', rows: 3, value: ev.notes || '' });
    const v = await U.modal({
      title: isNew ? 'New event' : 'Event',
      body: h('div', {}, h('label', { class: 'lbl' }, 'What'), t, h('label', { class: 'lbl' }, 'Date'), dt, h('label', { class: 'lbl' }, 'Notes'), n),
      buttons: [isNew ? null : { label: 'Delete', value: 'delete', danger: true }, { label: 'Cancel', value: null }, { label: isNew ? 'Add' : 'Save', value: 'save', primary: true }].filter(Boolean),
    });
    if (v === 'delete') d.events = d.events.filter((x) => x !== ev);
    else if (v === 'save') { ev.title = t.value.trim() || 'Event'; ev.date = dt.value || ev.date; ev.notes = n.value; if (isNew) d.events.push(ev); }
    else return;
    U.markDirty();
    U.renderView();
  }

  // ---------- one-line schedule, strip table, call sheet ----------
  function oneLine(d, forPrint) {
    const { h } = SD.ui;
    const info = sceneInfo(d);
    const rows = [];
    const sceneRow = (s) => h('tr', { class: `ol-row ${s.ie} ${s.dn}` + (d.done[s.id] ? ' done' : '') },
      h('td', { class: 'ol-no' }, s.number), h('td', {}, (s.setting || '').replace(/\.$/, '')), h('td', {}, s.location), h('td', {}, s.time), h('td', { class: 'ol-pg' }, SD.eighths(s.lines)),
      h('td', { class: 'ol-cast' }, s.castIds.join(', ')), h('td', { class: 'ol-syn' }, s.synopsis));
    d.days.forEach((x, i) => {
      const lines = dayLines(x, info);
      rows.push(h('tr', { class: 'ol-day' }, h('td', { colspan: 7 }, h('strong', {}, `Day ${i + 1}`), x.date ? ' — ' + nice(x.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '', x.call ? ` · call ${x.call}` : '', ` · ${x.scenes.length} scenes · ${lines ? SD.eighths(lines) : 0} pages`, x.notes ? h('div', { class: 'ol-notes' }, x.notes) : null)));
      x.scenes.forEach((id) => { const s = info.get(id); if (s) rows.push(sceneRow(s)); });
    });
    const sched = new Set(d.days.flatMap((x) => x.scenes));
    const rest = [...info.values()].filter((s) => !sched.has(s.id));
    if (rest.length) { rows.push(h('tr', { class: 'ol-day' }, h('td', { colspan: 7 }, h('strong', {}, 'Not scheduled'), ` · ${rest.length} scenes`))); rest.forEach((s) => rows.push(sceneRow(s))); }
    const cl = castList(d);
    return h('div', { class: forPrint ? '' : 'view-pad' },
      h('table', { class: 'report one-line' },
        h('thead', {}, h('tr', {}, ['Sc', 'I/E', 'Set', 'D/N', 'Pages', 'Cast', 'Synopsis'].map((c) => h('th', {}, c)))),
        h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: 7, class: 'muted' }, 'Link a script and add shoot days.')))),
      cl.length ? h('p', { class: 'ol-castlist' }, h('strong', {}, 'Cast: '), cl.map(([n, i]) => `${i}. ${n}`).join('   ')) : null);
  }

  function stripTable(d) {
    const { h } = SD.ui;
    const info = sceneInfo(d);
    return h('div', { class: 'pss' }, d.days.map((x, i) => h('div', { class: 'pss-day' },
      h('div', { class: 'pss-head' }, `Day ${i + 1}${x.date ? ' · ' + nice(x.date) : ''} · ${SD.eighths(dayLines(x, info)) || 0} pg`),
      x.scenes.map((id) => (info.get(id) ? strip(info.get(id), d, { static: true }) : null)))));
  }

  function callSheet(d, x) {
    const { h, project } = SD.ui;
    const info = sceneInfo(d);
    const c = d.callsheet;
    const i = d.days.indexOf(x);
    const scenes = x.scenes.map((id) => info.get(id)).filter(Boolean);
    const chars = [...new Set(scenes.flatMap((s) => s.chars))];
    const catalog = project.catalog;
    const actorOf = (n) => { const ch = catalog.find((it) => it.category === 'character' && it.name.trim().toUpperCase() === n); const a = ch && ch.links && ch.links.playedBy && catalog.find((it) => it.id === ch.links.playedBy); return a ? a.name : ''; };
    const order = new Map(castList(d));
    // costumes worn today, per character
    const charItem = (n) => catalog.find((it) => it.category === 'character' && it.name.trim().toUpperCase() === n);
    const costumesOf = (n) => { const ch = charItem(n); return ch ? [...new Set(scenes.flatMap((s) => SD.wornIn(project, ch.id, s.id).map((w) => w.name)))].join(', ') : ''; };
    const tagged = [...new Set(scenes.flatMap((s) => s.scene.el.items || []))].map((id) => catalog.find((it) => it.id === id)).filter(Boolean);
    const sceneNos = (it) => scenes.filter((s) => (s.scene.el.items || []).includes(it.id)).map((s) => s.number).join(', ');
    const ofCat = (...cats) => tagged.filter((it) => cats.includes(it.category));
    const extras = ofCat('extras');
    const special = ofCat('stunts', 'sfx', 'vfx', 'weapon', 'animal', 'vehicle');
    const crew = catalog.filter((it) => it.category === 'crew' && SD.crewOnDay(it, x.id));
    const states = scenes.flatMap((s) => [...new Set([...(s.scene.el.items || []), ...s.chars.flatMap((n) => { const ch = charItem(n); return ch ? SD.wornIn(project, ch.id, s.id).map((w) => w.id) : []; })])].map((id) => catalog.find((it) => it.id === id)).filter((it) => it && SD.itemStates(it).length).map((it) => ({ s, it, at: SD.stateAt(project, it, s.id) })).filter((x) => x.at));
    const noteOf = (it) => { const f = it.fields; return [f.extraType, f.risk ? 'risk ' + f.risk.toLowerCase() : '', f.handler ? 'handler ' + f.handler : '', f.armourer ? 'armourer ' + f.armourer : '', f.coordinator ? 'coordinator ' + f.coordinator : '', f.safety || f.notes || f.see || ''].filter(Boolean).join(' · '); };
    const ml = (t) => String(t || '').split('\n').map((l) => h('div', {}, l));
    return h('div', { class: 'callsheet' },
      h('div', { class: 'cs-top' },
        h('div', {}, h('div', { class: 'cs-kicker' }, 'Call sheet'), h('h1', {}, project.title || d.name), c.company ? h('div', { class: 'cs-small' }, ml(c.company)) : null),
        h('div', { class: 'cs-day' }, h('div', { class: 'cs-big' }, 'Day ' + (i + 1) + ' of ' + d.days.length), x.date ? h('div', {}, nice(x.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })) : null, h('div', { class: 'cs-call' }, 'Call time: ', h('strong', {}, x.call || '—')))),
      h('div', { class: 'cs-grid' },
        c.producer ? h('div', {}, h('b', {}, 'Producer: '), c.producer) : null,
        c.director ? h('div', {}, h('b', {}, 'Director: '), c.director) : null,
        c.contact ? h('div', {}, h('b', {}, 'Contact: '), ml(c.contact)) : null,
        c.location ? h('div', {}, h('b', {}, 'Base: '), ml(c.location)) : null,
        c.weather ? h('div', {}, h('b', {}, 'Weather: '), ml(c.weather)) : null),
      h('h2', {}, 'Scenes'),
      h('table', { class: 'cs-table' }, h('thead', {}, h('tr', {}, ['Sc', 'Set', 'D/N', 'Pages', 'Cast', 'Synopsis'].map((t) => h('th', {}, t)))),
        h('tbody', {}, scenes.map((s) => h('tr', {}, h('td', {}, s.number), h('td', {}, `${(s.setting || '').replace(/\.$/, '')} ${s.location}`), h('td', {}, s.time), h('td', {}, SD.eighths(s.lines)), h('td', {}, s.castIds.join(', ')), h('td', {}, s.synopsis))))),
      h('h2', {}, 'Cast'),
      chars.length ? h('table', { class: 'cs-table' }, h('thead', {}, h('tr', {}, ['#', 'Character', 'Actor', 'Costume'].map((t) => h('th', {}, t)))),
        h('tbody', {}, chars.sort((a, b) => (order.get(a) || 99) - (order.get(b) || 99)).map((n) => h('tr', {}, h('td', {}, order.get(n) || ''), h('td', {}, n), h('td', {}, actorOf(n)), h('td', {}, costumesOf(n)))))) : h('p', {}, 'No speaking parts.'),
      extras.length ? [h('h2', {}, 'Extras'), h('table', { class: 'cs-table' }, h('thead', {}, h('tr', {}, ['Extras', 'Scenes', 'How many', 'Look'].map((t) => h('th', {}, t)))),
        h('tbody', {}, extras.map((it) => h('tr', {}, h('td', {}, it.name), h('td', {}, sceneNos(it)), h('td', {}, Math.max(...scenes.filter((s) => (s.scene.el.items || []).includes(it.id)).map((s) => SD.extrasIn(it, s.id)))), h('td', {}, it.fields.look || '')))))] : null,
      special.length ? [h('h2', {}, 'Stunts, effects, weapons, animals & vehicles'), h('table', { class: 'cs-table' }, h('thead', {}, h('tr', {}, ['Item', 'Kind', 'Scenes', 'Notes'].map((t) => h('th', {}, t)))),
        h('tbody', {}, special.map((it) => h('tr', {}, h('td', {}, it.name), h('td', {}, SD.categoryById(it.category).one), h('td', {}, sceneNos(it)), h('td', {}, noteOf(it))))))] : null,
      states.length ? [h('h2', {}, 'Continuity'), h('table', { class: 'cs-table' }, h('thead', {}, h('tr', {}, ['Sc', 'Item', 'State'].map((t) => h('th', {}, t)))),
        h('tbody', {}, states.map(({ s, it, at }) => h('tr', {}, h('td', {}, s.number), h('td', {}, it.name), h('td', {}, (at.state.label || '') + (at.state.note ? ' — ' + at.state.note : ''))))))] : null,
      crew.length ? [h('h2', {}, 'Crew'), h('table', { class: 'cs-table' }, h('thead', {}, h('tr', {}, ['Name', 'Department', 'Position', 'Phone'].map((t) => h('th', {}, t)))),
        h('tbody', {}, crew.sort((a, b) => (a.fields.department || '').localeCompare(b.fields.department || '')).map((it) => h('tr', {}, h('td', {}, it.name), h('td', {}, it.fields.department || ''), h('td', {}, it.fields.position || ''), h('td', {}, it.fields.cell || it.fields.phone || '')))))] : null,
      x.notes || c.notes ? [h('h2', {}, 'Notes'), x.notes ? h('p', {}, x.notes) : null, c.notes ? h('div', {}, ml(c.notes)) : null] : null);
  }

  // ---------- .ics ----------
  function toIcs(d) {
    const info = sceneInfo(d);
    const escI = (t) => String(t || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => '\\' + c);
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const day = (s) => s.replace(/-/g, '');
    const next = (s) => { const dt = parseIso(s); dt.setDate(dt.getDate() + 1); return day(iso(dt)); };
    const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Scriptdesk//Schedule//EN', 'CALSCALE:GREGORIAN'];
    d.days.forEach((x, i) => {
      if (!x.date) return;
      const sc = x.scenes.map((id) => info.get(id)).filter(Boolean);
      out.push('BEGIN:VEVENT', 'UID:' + x.id + '@scriptdesk', 'DTSTAMP:' + stamp,
        x.call ? 'DTSTART:' + day(x.date) + 'T' + x.call.replace(':', '') + '00' : 'DTSTART;VALUE=DATE:' + day(x.date),
        x.call ? 'DURATION:PT10H' : 'DTEND;VALUE=DATE:' + next(x.date),
        'SUMMARY:' + escI(`Shoot day ${i + 1}: scenes ${sc.map((s) => s.number).join(', ') || '—'}`),
        'DESCRIPTION:' + escI(sc.map((s) => `${s.number}. ${s.heading} (${SD.eighths(s.lines)} pg)`).join('\n') + (x.notes ? '\n\n' + x.notes : '')), 'END:VEVENT');
    });
    for (const e of d.events) {
      if (!e.date) continue;
      out.push('BEGIN:VEVENT', 'UID:' + e.id + '@scriptdesk', 'DTSTAMP:' + stamp, 'DTSTART;VALUE=DATE:' + day(e.date), 'DTEND;VALUE=DATE:' + next(e.date), 'SUMMARY:' + escI(e.title), e.notes ? 'DESCRIPTION:' + escI(e.notes) : null, 'END:VEVENT');
    }
    out.push('END:VCALENDAR');
    return out.filter(Boolean).join('\r\n') + '\r\n';
  }

  // Read the VEVENTs of an .ics file (used by the Celtx import).
  SD.parseIcs = (text) => {
    const lines = String(text || '').replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
    const events = [];
    let cur = null;
    for (const line of lines) {
      if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
      if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
      if (!cur) continue;
      const i = line.indexOf(':');
      if (i < 0) continue;
      const key = line.slice(0, i).split(';')[0].toUpperCase();
      cur[key] = line.slice(i + 1).replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
    }
    return events.map((e) => {
      const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/.exec(e.DTSTART || '');
      return Object.assign(e, { date: m ? `${m[1]}-${m[2]}-${m[3]}` : '', time: m && m[4] ? `${m[4]}:${m[5]}` : '' });
    });
  };
})();
