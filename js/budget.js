/* Scriptdesk — budget: what the production costs, from catalog prices × the days things are needed */
(function () {
  'use strict';
  const SD = (window.SD = window.SD || {});
  SD.KINDS = SD.KINDS || {};

  const GROUPS = [
    { id: 'cast', label: 'Cast', cats: ['actor', 'extras', 'stunts'] },
    { id: 'crew', label: 'Crew', cats: ['crew'] },
    { id: 'locations', label: 'Locations & sets', cats: ['location', 'set', 'setdressing'] },
    { id: 'art', label: 'Props, wardrobe & make-up', cats: ['prop', 'wardrobe', 'makeup', 'hair', 'weapon'] },
    { id: 'transport', label: 'Vehicles, animals & equipment', cats: ['vehicle', 'animal', 'equipment'] },
    { id: 'effects', label: 'Effects, sound & music', cats: ['sfx', 'vfx', 'sound', 'music'] },
    { id: 'general', label: 'Catering, travel & insurance', cats: [] },
    { id: 'post', label: 'Post-production', cats: [] },
    { id: 'other', label: 'Other', cats: ['other'] },
  ];
  const groupOf = (cat) => (GROUPS.find((g) => g.cats.includes(cat)) || GROUPS[GROUPS.length - 1]).id;
  const CURRENCIES = ['EUR', 'USD', 'GBP', 'CAD', 'AUD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'JPY', 'INR', 'BRL', 'ZAR', 'NZD'];
  const MANUAL_UNITS = ['per shoot day', 'per week', 'one-off', 'per item'];

  const K = {
    icon: '💶',
    label: 'Budget',
    create(project, name) {
      const sched = project.documents.find((x) => x.kind === 'schedule');
      const lang = (navigator.language || 'en').toLowerCase();
      const currency = /-(us)$/.test(lang) || lang === 'en' ? 'USD' : /-(gb)$/.test(lang) ? 'GBP' : 'EUR';
      return K.normalize({ id: SD.uid(), kind: 'budget', name, scheduleId: sched ? sched.id : '', currency, manual: [
        { id: SD.uid(), group: 'general', label: 'Catering (whole crew & cast)', unit: 'per shoot day', rate: 0, qty: '' },
        { id: SD.uid(), group: 'general', label: 'Insurance', unit: 'one-off', rate: 0, qty: '' },
        { id: SD.uid(), group: 'post', label: 'Editing', unit: 'per week', rate: 0, qty: '2' },
        { id: SD.uid(), group: 'post', label: 'Music & sound mix', unit: 'one-off', rate: 0, qty: '' },
      ] });
    },
    normalize(d) {
      d.manual = Array.isArray(d.manual) ? d.manual : [];
      d.over = d.over && typeof d.over === 'object' ? d.over : {};
      d.currency = CURRENCIES.includes(d.currency) ? d.currency : 'EUR';
      for (const [k, v] of Object.entries({ scheduleId: '', contingency: 10, tax: 0, pagesPerDay: 4, prepDays: 0, scriptId: '' })) if (d[k] == null) d[k] = v;
      for (const m of d.manual) { m.id = m.id || SD.uid(); m.group = GROUPS.some((g) => g.id === m.group) ? m.group : 'other'; m.unit = MANUAL_UNITS.includes(m.unit) ? m.unit : 'one-off'; m.rate = +m.rate || 0; }
      return d;
    },
    hasContent: (d) => d.manual.some((m) => m.rate) || Object.keys(d.over).length > 0,
    status(d) { const b = compute(d); return `Budget  ·  total ${money(d, b.total)}  ·  ${b.days} shoot days (${b.daysFrom})  ·  ${b.missing.length} items without a price`; },
    navigator(d) {
      const b = compute(d);
      return { label: 'Budget', empty: '', items: b.groups.filter((g) => g.lines.length).map((g) => ({ text: g.label, len: money(d, g.total, true), onclick: () => { const el = document.querySelector(`.bg-group[data-group="${g.id}"]`); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } })) };
    },
    toolbar(d) {
      const { h, download, safeName } = SD.ui;
      return [h('div', { class: 'tb-group' },
        h('button', { class: 'btn ghost small', title: 'Download as a spreadsheet', onclick: () => download(safeName(d.name) + '.csv', toCsv(d), 'text/csv;charset=utf-8') }, 'CSV'),
        h('button', { class: 'btn ghost small', onclick: () => K.print(d) }, 'Print'))];
    },
    render(root, d) { renderBudget(root, d); },
    print(d) {
      const { h, printNodes, project } = SD.ui;
      const b = compute(d);
      const rows = [];
      for (const g of b.groups) {
        if (!g.lines.length) continue;
        rows.push(h('tr', { class: 'pbg-group' }, h('td', { colspan: 4 }, g.label), h('td', { class: 'num' }, money(d, g.total))));
        for (const l of g.lines) if (!l.skip) rows.push(h('tr', {}, h('td', {}, l.label), h('td', { class: 'muted' }, l.basis), h('td', { class: 'num' }, fmtQty(l)), h('td', { class: 'num' }, money(d, l.rate)), h('td', { class: 'num' }, money(d, l.total))));
      }
      const foot = [['Subtotal', b.subtotal], [`Contingency (${d.contingency}%)`, b.contingencyAmt], d.tax ? [`Tax (${d.tax}%)`, b.taxAmt] : null, ['Total', b.total]].filter(Boolean);
      printNodes('print-budget', [
        h('h1', {}, [project.title, d.name].filter(Boolean).join(' — ')),
        h('p', {}, `${b.days} shoot days (${b.daysFrom}) · ${money(d, b.total / Math.max(1, b.days))} per shoot day`),
        h('table', { class: 'pbg' }, h('thead', {}, h('tr', {}, ['Item', 'Based on', 'Qty', 'Rate', 'Total'].map((t) => h('th', {}, t)))), h('tbody', {}, rows),
          h('tfoot', {}, foot.map(([l, v]) => h('tr', {}, h('td', { colspan: 4 }, l), h('td', { class: 'num' }, money(d, v)))))),
      ], { title: d.name });
    },
  };
  SD.KINDS.budget = K;

  const money = (d, v, short) => {
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: d.currency, maximumFractionDigits: short || Math.abs(v) >= 1000 ? 0 : 2 }).format(v || 0); } catch (e) { return d.currency + ' ' + Math.round(v || 0); }
  };
  const fmtQty = (l) => (l.unit === 'one-off' ? '1' : `${l.qty} ${l.unit === 'per shoot day' ? (l.qty === 1 ? 'day' : 'days') : l.unit === 'per week' ? (l.qty === 1 ? 'week' : 'weeks') : '×'}`);

  // ---------- the numbers ----------
  function compute(d) {
    const p = SD.ui.project;
    const sched = p.documents.find((x) => x.id === d.scheduleId && x.kind === 'schedule') || null;
    const script = (sched && p.documents.find((x) => x.id === sched.sourceId && x.kind === 'script')) || p.documents.find((x) => x.id === d.scriptId && x.kind === 'script') || p.documents.find((x) => x.kind === 'script' && SD.getScenes(x).length) || null;
    const scenes = script ? SD.getScenes(script) : [];
    const info = new Map(scenes.map((s) => [s.id, { s, chars: new Set(SD.sceneCharacters(script, s)), loc: (SD.parseSceneHeading(s.el.text).location || '').toUpperCase(), items: new Set(s.el.items || []), pages: s.lines / SD.LINES_PER_PAGE }]));
    const ppd = Math.max(0.25, +d.pagesPerDay || 4);
    const schedDays = sched ? sched.days.map((x) => x.scenes.filter((id) => info.has(id))).filter((x) => x.length) : [];
    const scheduled = new Set(schedDays.flat());
    const unsched = [...info.keys()].filter((id) => !scheduled.has(id));
    const pagesOf = (ids) => ids.reduce((n, id) => n + (info.get(id) ? info.get(id).pages : 0), 0);
    const estimateDays = (ids) => (ids.length ? Math.max(1, Math.ceil(pagesOf(ids) / ppd - 1e-9)) : 0);
    const totalDays = schedDays.length + estimateDays(unsched);
    const daysFrom = sched && schedDays.length ? (unsched.length ? `schedule + ${estimateDays(unsched)} estimated` : 'from the schedule') : `estimated at ${ppd} pages a day`;
    // how many shoot days a set of scenes needs
    const daysFor = (ids) => {
      const set = new Set(ids);
      const onDays = schedDays.filter((day) => day.some((id) => set.has(id))).length;
      return onDays + estimateDays(ids.filter((id) => !scheduled.has(id)));
    };
    const qtyFor = (unit, days, item) => (unit === 'per shoot day' ? days : unit === 'per week' ? Math.max(days ? 1 : 0, Math.ceil(days / 5)) : unit === 'per item' ? Math.max(1, parseInt((item && item.fields && item.fields.quantity) || '1', 10) || 1) : 1);
    const sceneIds = (pred) => [...info.values()].filter(pred).map((x) => x.s.id);

    const lines = [];
    const catalog = p.catalog;
    const chars = catalog.filter((c) => c.category === 'character');
    const cast = new Set();
    for (const it of catalog) {
      if (it.category === 'character') continue;
      const pr = SD.itemPrice(it);
      let ids = [], basis = '', days = 0;
      if (it.category === 'actor') {
        const plays = chars.filter((c) => c.links && c.links.playedBy === it.id);
        plays.forEach((c) => cast.add(c.id));
        const names = new Set(plays.map((c) => c.name.trim().toUpperCase()));
        ids = sceneIds((x) => [...x.chars].some((n) => names.has(n)) || plays.some((c) => x.items.has(c.id)));
        days = daysFor(ids);
        basis = plays.length ? `plays ${plays.map((c) => c.name).join(', ')} · ${ids.length} scenes` : 'not cast in a role yet';
      } else if (it.category === 'crew') {
        days = totalDays + (+d.prepDays || 0);
        basis = `${totalDays} shoot days` + (+d.prepDays ? ` + ${d.prepDays} prep` : '');
      } else {
        const n = it.name.trim().toUpperCase();
        ids = sceneIds((x) => x.items.has(it.id) || (it.category === 'location' && n && (x.loc === n || x.loc.startsWith(n + ' ') || x.loc.includes(' ' + n) || x.loc.startsWith(n))));
        days = daysFor(ids);
        basis = ids.length ? `${ids.length} scene${ids.length === 1 ? '' : 's'}` : it.category === 'location' ? 'in no scene heading yet' : 'not tagged in a scene';
      }
      const key = 'item:' + it.id;
      const o = d.over[key] || {};
      const auto = qtyFor(pr.unit, days, it);
      const qty = o.qty !== undefined && o.qty !== '' ? Math.max(0, +o.qty || 0) : auto;
      lines.push({ key, item: it, group: groupOf(it.category), label: it.name || 'Unnamed', basis, unit: pr.unit, rate: pr.price, priced: pr.set, qty, auto, skip: !!o.skip, total: o.skip ? 0 : qty * pr.price });
    }
    // speaking parts without an actor yet
    if (script) {
      const named = new Set(chars.filter((c) => cast.has(c.id)).map((c) => c.name.trim().toUpperCase()));
      const speaking = new Set([...info.values()].flatMap((x) => [...x.chars]));
      for (const n of speaking) {
        if (named.has(n)) continue;
        const ids = sceneIds((x) => x.chars.has(n));
        const ch = chars.find((c) => c.name.trim().toUpperCase() === n);
        lines.push({ key: 'char:' + n, char: ch || null, charName: n, group: 'cast', label: n, basis: `no actor yet · ${ids.length} scene${ids.length === 1 ? '' : 's'} · ${daysFor(ids)} days`, unit: 'per shoot day', rate: 0, priced: false, qty: daysFor(ids), auto: daysFor(ids), uncast: true, total: 0 });
      }
    }
    for (const m of d.manual) {
      const auto = qtyFor(m.unit, totalDays);
      const qty = m.qty !== undefined && m.qty !== '' ? Math.max(0, +m.qty || 0) : auto;
      lines.push({ key: 'manual:' + m.id, manual: m, group: m.group, label: m.label, basis: m.unit === 'per shoot day' && (m.qty === '' || m.qty == null) ? `${totalDays} shoot days` : '', unit: m.unit, rate: m.rate, priced: !!m.rate, qty, auto, skip: false, total: qty * (m.rate || 0) });
    }
    const groups = GROUPS.map((g) => { const ls = lines.filter((l) => l.group === g.id); return Object.assign({}, g, { lines: ls, total: ls.reduce((n, l) => n + l.total, 0) }); });
    const subtotal = groups.reduce((n, g) => n + g.total, 0);
    const contingencyAmt = subtotal * (Math.max(0, +d.contingency || 0) / 100);
    const taxAmt = (subtotal + contingencyAmt) * (Math.max(0, +d.tax || 0) / 100);
    const pages = script ? SD.estimate(script).pages : 0;
    return { groups, lines, subtotal, contingencyAmt, taxAmt, total: subtotal + contingencyAmt + taxAmt, days: totalDays, daysFrom, sched, script, pages, missing: lines.filter((l) => !l.priced && !l.skip && !l.manual) };
  }

  function toCsv(d) {
    const b = compute(d);
    const q = (v) => { const s = String(v == null ? '' : v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const rows = [['Group', 'Item', 'Based on', 'Quantity', 'Unit', 'Rate', 'Total']];
    for (const g of b.groups) for (const l of g.lines) if (!l.skip) rows.push([g.label, l.label, l.basis, l.unit === 'one-off' ? 1 : l.qty, l.unit, l.rate.toFixed(2), l.total.toFixed(2)]);
    rows.push([], ['', 'Subtotal', '', '', '', '', b.subtotal.toFixed(2)], ['', `Contingency ${d.contingency}%`, '', '', '', '', b.contingencyAmt.toFixed(2)], ['', `Tax ${d.tax}%`, '', '', '', '', b.taxAmt.toFixed(2)], ['', 'Total (' + d.currency + ')', '', '', '', '', b.total.toFixed(2)]);
    return '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n');
  }

  // ---------- view ----------
  function renderBudget(root, d) {
    const U = SD.ui;
    const { h } = U;
    const p = U.project;
    const b = compute(d);
    const changed = () => { U.markDirty(); U.renderStatusSoon(); U.renderNavigatorSoon(); };
    const redraw = () => { const sc = root.scrollTop; U.renderView(); const ov = document.querySelector('#other-view'); if (ov) ov.scrollTop = sc; };
    const later = U.debounce(redraw, 700);
    const num = (val, oninput, props = {}) => h('input', Object.assign({ class: 'input bg-num', type: 'number', min: 0, step: 'any', value: val === '' || val == null ? '' : val, oninput }, props));
    const schedules = p.documents.filter((x) => x.kind === 'schedule');
    const scripts = p.documents.filter((x) => x.kind === 'script');
    const tile = (v, l, sub) => h('div', { class: 'stat' }, h('div', { class: 'stat-v' }, v), h('div', { class: 'stat-l' }, l), sub ? h('div', { class: 'stat-sub' }, sub) : null);

    const settings = h('div', { class: 'bg-settings' },
      h('label', {}, h('span', { class: 'lbl' }, 'Shoot days from'), h('select', { class: 'select', onchange: (e) => { d.scheduleId = e.target.value; changed(); redraw(); } },
        h('option', { value: '' }, 'An estimate (pages per day)'), schedules.map((s) => h('option', { value: s.id, selected: s.id === d.scheduleId }, '📅 ' + s.name)))),
      !d.scheduleId && scripts.length > 1 ? h('label', {}, h('span', { class: 'lbl' }, 'Script'), h('select', { class: 'select', onchange: (e) => { d.scriptId = e.target.value; changed(); redraw(); } }, scripts.map((s) => h('option', { value: s.id, selected: s.id === (b.script && b.script.id) }, s.name)))) : null,
      h('label', { title: 'Used for scenes that are not on the schedule' }, h('span', { class: 'lbl' }, 'Pages a day'), num(d.pagesPerDay, (e) => { d.pagesPerDay = +e.target.value || 4; changed(); later(); }, { step: 0.5 })),
      h('label', { title: 'Extra paid days for the crew before the shoot' }, h('span', { class: 'lbl' }, 'Crew prep days'), num(d.prepDays, (e) => { d.prepDays = +e.target.value || 0; changed(); later(); })),
      h('label', {}, h('span', { class: 'lbl' }, 'Contingency %'), num(d.contingency, (e) => { d.contingency = +e.target.value || 0; changed(); later(); })),
      h('label', {}, h('span', { class: 'lbl' }, 'Tax %'), num(d.tax, (e) => { d.tax = +e.target.value || 0; changed(); later(); })),
      h('label', {}, h('span', { class: 'lbl' }, 'Currency'), h('select', { class: 'select', onchange: (e) => { d.currency = e.target.value; changed(); redraw(); } }, CURRENCIES.map((c) => h('option', { value: c, selected: c === d.currency }, c)))));

    const maxG = Math.max(1, ...b.groups.map((g) => g.total));
    const share = h('div', { class: 'share viz-root' }, b.groups.filter((g) => g.total > 0).map((g) => h('div', { class: 'share-row', title: `${g.label}: ${money(d, g.total)}` },
      h('span', { class: 'share-name' }, g.label), h('span', { class: 'share-track' }, h('span', { class: 'share-bar', style: `width:${(g.total / maxG) * 100}%` })), h('span', { class: 'share-v' }, Math.round((g.total / Math.max(1, b.subtotal)) * 100) + '%'))));

    const lineRow = (l) => {
      const it = l.item;
      const rateIn = l.manual
        ? num(l.manual.rate || '', (e) => { l.manual.rate = +e.target.value || 0; changed(); later(); })
        : l.uncast ? h('span', { class: 'muted small' }, 'needs an actor')
          : num(l.priced ? l.rate : '', (e) => { it.fields.price = e.target.value; changed(); later(); }, { placeholder: 'price' });
      const unitSel = l.uncast ? h('span', { class: 'muted small' }, 'per shoot day') : h('select', { class: 'select small', onchange: (e) => { if (l.manual) l.manual.unit = e.target.value; else it.fields.priceUnit = e.target.value; changed(); redraw(); } }, (l.manual ? MANUAL_UNITS : SD.PRICE_UNITS).map((u) => h('option', { value: u, selected: u === l.unit }, u)));
      const o = l.manual ? null : d.over[l.key] || {};
      const qtyIn = l.unit === 'one-off' ? h('span', { class: 'muted' }, '1') : num(l.manual ? l.manual.qty : o.qty, (e) => {
        if (l.manual) l.manual.qty = e.target.value;
        else { const ov = (d.over[l.key] = d.over[l.key] || {}); if (e.target.value === '') delete ov.qty; else ov.qty = e.target.value; if (!Object.keys(ov).length) delete d.over[l.key]; }
        changed(); later();
      }, { placeholder: String(l.auto), title: 'Leave empty to use ' + l.auto + ' (worked out for you)' });
      return h('tr', { class: (l.skip ? 'skip ' : '') + (!l.priced && !l.manual ? 'unpriced' : '') },
        h('td', {}, l.manual
          ? h('input', { class: 'input bg-label', value: l.manual.label, placeholder: 'What is it?', oninput: (e) => { l.manual.label = e.target.value; changed(); } })
          : h('button', { class: 'linklike', title: 'Open in the catalog', onclick: () => (it ? U.openCatalogItem(it.id) : U.openCatalogItem(l.char ? l.char.id : null, { category: 'character', name: l.charName })) }, l.label)),
        h('td', { class: 'muted small' }, l.basis),
        h('td', {}, qtyIn),
        h('td', {}, unitSel),
        h('td', {}, rateIn),
        h('td', { class: 'num' }, money(d, l.total)),
        h('td', {}, l.manual
          ? h('button', { class: 'icon-btn', title: 'Delete line', 'aria-label': 'Delete line', onclick: () => { d.manual = d.manual.filter((x) => x !== l.manual); changed(); redraw(); } }, '×')
          : l.uncast ? null : h('input', { type: 'checkbox', checked: !l.skip, title: 'Include in the budget', onchange: (e) => { const ov = (d.over[l.key] = d.over[l.key] || {}); if (e.target.checked) delete ov.skip; else ov.skip = true; if (!Object.keys(ov).length) delete d.over[l.key]; changed(); redraw(); } })));
    };

    const groups = b.groups.filter((g) => g.lines.length || ['general', 'post'].includes(g.id)).map((g) => h('section', { class: 'chart-card bg-group', dataset: { group: g.id } },
      h('div', { class: 'bg-ghead' }, h('h3', {}, g.label), h('strong', {}, money(d, g.total))),
      g.lines.length ? h('table', { class: 'bg-table' },
        h('thead', {}, h('tr', {}, ['Item', 'Based on', 'Qty', 'Unit', 'Rate', 'Total', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, g.lines.map(lineRow))) : h('p', { class: 'muted small' }, g.id === 'cast' ? 'Add actors in the Master Catalog and link them to characters with “Played by”.' : 'Nothing here yet.'),
      h('button', { class: 'btn ghost small', onclick: () => { d.manual.push({ id: SD.uid(), group: g.id, label: '', unit: 'one-off', rate: 0, qty: '' }); changed(); redraw(); setTimeout(() => { const ins = document.querySelectorAll(`.bg-group[data-group="${g.id}"] .bg-label`); if (ins.length) ins[ins.length - 1].focus(); }, 30); } }, '+ Add a line')));

    root.append(h('div', { class: 'view-pad bg' },
      h('div', { class: 'view-head' }, h('h2', {}, d.name),
        h('div', { class: 'stats' }, tile(money(d, b.total), 'Total', `incl. ${d.contingency}% contingency` + (d.tax ? ` and ${d.tax}% tax` : '')), tile(b.days, 'Shoot days', b.daysFrom), tile(money(d, b.total / Math.max(1, b.days)), 'Per shoot day'), b.pages ? tile(money(d, b.total / Math.max(1, b.pages)), 'Per script page', '≈ per minute of film') : null)),
      settings,
      b.missing.length ? h('div', { class: 'bg-missing' }, h('strong', {}, `${b.missing.length} item${b.missing.length === 1 ? '' : 's'} without a price: `),
        b.missing.slice(0, 12).map((l, i) => [i ? ', ' : '', h('button', { class: 'linklike', onclick: () => (l.item ? U.openCatalogItem(l.item.id) : U.openCatalogItem(l.char ? l.char.id : null, { category: 'character', name: l.charName })) }, l.label)]),
        b.missing.length > 12 ? '…' : '', h('span', { class: 'muted small' }, ' — type a price below, or in the item’s Budget section in the catalog.')) : null,
      b.subtotal ? h('section', { class: 'chart-card' }, h('h3', {}, 'Where the money goes'), share) : null,
      groups,
      h('section', { class: 'chart-card bg-totals' },
        h('table', {}, h('tbody', {},
          h('tr', {}, h('td', {}, 'Subtotal'), h('td', { class: 'num' }, money(d, b.subtotal))),
          h('tr', {}, h('td', {}, `Contingency (${d.contingency}%)`), h('td', { class: 'num' }, money(d, b.contingencyAmt))),
          d.tax ? h('tr', {}, h('td', {}, `Tax (${d.tax}%)`), h('td', { class: 'num' }, money(d, b.taxAmt))) : null,
          h('tr', { class: 'grand' }, h('td', {}, 'Total'), h('td', { class: 'num' }, money(d, b.total))))),
        h('p', { class: 'muted small' }, 'Prices live in the Master Catalog (each item has a Budget section). Days come from the production schedule, or are estimated from the script’s pages. Quantities you type here override the worked-out ones.'))));
  }
})();
