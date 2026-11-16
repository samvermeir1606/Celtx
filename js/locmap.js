/* Scriptdesk — location map: catalog locations as pins on a real map, with each shoot day's route.
   The map tiles come from OpenStreetMap, so the map needs an internet connection. */
(function () {
  'use strict';
  const SD = (window.SD = window.SD || {});
  SD.KINDS = SD.KINDS || {};

  const DAY_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#e87ba4', '#6250d6', '#008300', '#e34948', '#eda100'];
  let leaflet = null;
  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (!leaflet) {
      leaflet = new Promise((resolve, reject) => {
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
        document.head.append(css);
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
        s.onload = () => resolve(window.L);
        s.onerror = () => { leaflet = null; reject(new Error('offline')); };
        document.head.append(s);
      });
    }
    return leaflet;
  }

  const coords = (it) => { const la = parseFloat(it.fields && it.fields.lat), ln = parseFloat(it.fields && it.fields.lng); return isFinite(la) && isFinite(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180 ? [la, ln] : null; };
  const km = (a, b) => { const R = 6371, r = Math.PI / 180, dLa = (b[0] - a[0]) * r, dLn = (b[1] - a[1]) * r; const x = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
  const miles = () => /^en-us/i.test(navigator.language || '');
  const dist = (k) => (miles() ? (k * 0.621371).toFixed(1) + ' mi' : k.toFixed(1) + ' km');
  // does a scene heading's location belong to this catalog location?
  SD.locationMatches = (sceneLoc, name) => { const n = (name || '').trim().toUpperCase(); const l = (sceneLoc || '').toUpperCase(); return !!n && (l === n || l.startsWith(n + ' ') || l.startsWith(n + ' -') || l.includes(' ' + n)); };

  const K = {
    icon: '🗺️',
    label: 'Location Map',
    create(project, name) {
      const sched = project.documents.find((x) => x.kind === 'schedule');
      return K.normalize({ id: SD.uid(), kind: 'locmap', name, scheduleId: sched ? sched.id : '' });
    },
    normalize(d) {
      d.scheduleId = d.scheduleId || '';
      d.base = d.base && isFinite(d.base.lat) && isFinite(d.base.lng) ? d.base : null;
      d.hiddenDays = Array.isArray(d.hiddenDays) ? d.hiddenDays : [];
      return d;
    },
    hasContent: (d) => !!d.base,
    status(d) { const m = model(d); return `Location map  ·  ${m.locs.filter((x) => x.at).length} of ${m.locs.length} locations on the map` + (m.days.length ? `  ·  ${m.days.length} shoot days, ${dist(m.days.reduce((n, x) => n + x.km, 0))} of travel` : ''); },
    navigator(d) {
      const m = model(d);
      return { label: 'Locations', empty: 'Add locations to the Master Catalog.', items: m.locs.map((x) => ({ text: x.item.name, len: x.at ? '📍' : '', onclick: () => focusLoc(d, x.item.id) })) };
    },
    toolbar(d) {
      const { h } = SD.ui;
      const schedules = SD.ui.project.documents.filter((x) => x.kind === 'schedule');
      return [
        h('select', { class: 'select small', title: 'Draw the route of each shoot day from this schedule', onchange: (e) => { d.scheduleId = e.target.value; SD.ui.markDirty(); SD.ui.renderView(); } },
          h('option', { value: '' }, 'No shoot-day routes'), schedules.map((s) => h('option', { value: s.id, selected: s.id === d.scheduleId }, '📅 ' + s.name))),
        h('button', { class: 'btn small', title: 'Where the unit starts each day (parking, base camp, the office)', onclick: () => startPlacing(d, 'base') }, d.base ? '⛺ Move the base' : '⛺ Set the base'),
        h('div', { class: 'tb-group' }, h('button', { class: 'btn ghost small', onclick: () => K.print(d) }, 'Print')),
      ];
    },
    render(root, d) { renderMap(root, d); },
    print(d) {
      const { h, printNodes, project } = SD.ui;
      const m = model(d);
      printNodes('print-locmap', [
        h('h1', {}, [project.title, d.name].filter(Boolean).join(' — ')),
        h('table', { class: 'report' }, h('thead', {}, h('tr', {}, ['Location', 'Address', 'Coordinates', 'Scenes', 'Shoot days'].map((t) => h('th', {}, t)))),
          h('tbody', {}, m.locs.map((x) => h('tr', {}, h('td', {}, x.item.name), h('td', {}, (x.item.fields.address || '').replace(/\n/g, ', ')), h('td', {}, x.at ? x.at.map((v) => v.toFixed(5)).join(', ') : '—'), h('td', {}, x.scenes.map((s) => s.number).join(', ')), h('td', {}, x.days.map((i) => 'Day ' + (i + 1)).join(', ')))))),
        m.days.length ? h('table', { class: 'report' }, h('thead', {}, h('tr', {}, ['Shoot day', 'Route', 'Distance'].map((t) => h('th', {}, t)))),
          h('tbody', {}, m.days.map((x) => h('tr', {}, h('td', {}, `Day ${x.i + 1}${x.date ? ' · ' + x.date : ''}`), h('td', {}, [d.base ? d.base.label || 'Base' : null, ...x.stops.map((s) => s.item.name)].filter(Boolean).join(' → ')), h('td', {}, dist(x.km)))))) : null,
      ], { title: d.name });
    },
  };
  SD.KINDS.locmap = K;

  function model(d) {
    const p = SD.ui.project;
    const sched = p.documents.find((x) => x.id === d.scheduleId && x.kind === 'schedule') || null;
    const script = (sched && p.documents.find((x) => x.id === sched.sourceId)) || p.documents.find((x) => x.kind === 'script' && SD.getScenes(x).length) || null;
    const scenes = script ? SD.getScenes(script) : [];
    const sceneLoc = new Map(scenes.map((s) => [s.id, SD.parseSceneHeading(s.el.text).location || '']));
    const locs = p.catalog.filter((c) => c.category === 'location').map((item) => {
      const sc = scenes.filter((s) => (s.el.items || []).includes(item.id) || SD.locationMatches(sceneLoc.get(s.id), item.name));
      return { item, at: coords(item), scenes: sc, days: [] };
    });
    const days = [];
    if (sched) sched.days.forEach((day, i) => {
      const stops = [];
      for (const id of day.scenes) for (const l of locs) if (l.scenes.some((s) => s.id === id) && !stops.includes(l)) stops.push(l);
      stops.forEach((l) => l.days.push(i));
      const pts = [d.base ? [d.base.lat, d.base.lng] : null, ...stops.map((l) => l.at)].filter(Boolean);
      let total = 0;
      for (let k = 1; k < pts.length; k++) total += km(pts[k - 1], pts[k]);
      if (d.base && pts.length > 1) total += km(pts[pts.length - 1], pts[0]);
      days.push({ i, date: day.date, stops, pts, km: total, color: DAY_COLORS[i % DAY_COLORS.length], id: day.id });
    });
    return { locs, days, sched };
  }

  const view = { map: null, placing: null, docId: null };
  function focusLoc(d, id) {
    const it = SD.ui.project.catalog.find((c) => c.id === id);
    const at = it && coords(it);
    if (at && view.map) view.map.setView(at, Math.max(view.map.getZoom(), 14));
    else SD.ui.toast('This location is not on the map yet: use “Place on map” or “Find the address”.');
  }
  function startPlacing(d, what) {
    view.placing = what;
    const el = document.querySelector('.lm-map');
    if (el) el.classList.add('placing');
    SD.ui.toast(what === 'base' ? 'Click on the map where the base is.' : 'Click on the map to place this location.');
  }

  async function findAddress(d, it, done) {
    const U = SD.ui;
    const q = await U.promptText('Find on the map (searches OpenStreetMap)', (it ? (it.fields.address || it.name) : '').replace(/\n/g, ', '));
    if (!q || !q.trim()) return;
    let res;
    try { res = await (await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=6&q=' + encodeURIComponent(q.trim()))).json(); } catch (e) { U.toast('The address search needs an internet connection.'); return; }
    if (!res.length) { U.toast('Nothing found for “' + q + '”. Try a town or a street.'); return; }
    const pick = res.length === 1 ? res[0] : await U.modal({ title: 'Which one?', body: U.h('div', { class: 'lm-results' }, res.map((r) => U.h('button', { class: 'menu-item', onclick: (e) => { e.target.closest('.modal').__pick = r; e.target.closest('.modal').querySelector('.btn.primary').click(); } }, r.display_name))), buttons: [{ label: 'Cancel', value: null }, { label: 'Use', value: () => document.querySelector('.modal').__pick || null, primary: true }] });
    if (!pick) return;
    done([+pick.lat, +pick.lon]);
  }

  function renderMap(root, d) {
    const U = SD.ui;
    const { h } = U;
    const m = model(d);
    const mapEl = h('div', { class: 'lm-map' });
    const panel = h('aside', { class: 'story-panel lm-panel' });
    root.append(h('div', { class: 'lm' }, mapEl, panel));
    const changed = () => { U.markDirty(); U.renderStatusSoon(); U.renderNavigatorSoon(); };
    const setAt = (it, at) => { it.fields.lat = at[0].toFixed(6); it.fields.lng = at[1].toFixed(6); changed(); U.renderView(); };

    const sec = (...k) => h('div', { class: 'ins-section' }, ...k);
    panel.append(
      sec(h('div', { class: 'ins-kicker' }, 'Locations'),
        m.locs.length ? m.locs.map((x) => h('div', { class: 'lm-loc' + (x.at ? '' : ' off') },
          h('button', { class: 'linklike', onclick: () => focusLoc(d, x.item.id) }, (x.at ? '📍 ' : '○ ') + x.item.name),
          h('div', { class: 'muted small' }, `${x.scenes.length} scene${x.scenes.length === 1 ? '' : 's'}` + (x.days.length ? ' · Day ' + x.days.map((i) => i + 1).join(', ') : '')),
          h('div', { class: 'row-gap' },
            h('button', { class: 'btn ghost small', onclick: () => findAddress(d, x.item, (at) => setAt(x.item, at)) }, 'Find the address'),
            h('button', { class: 'btn ghost small', onclick: () => { view.placing = x.item.id; startPlacing(d, x.item.id); } }, x.at ? 'Move' : 'Place on map'),
            h('button', { class: 'btn ghost small', onclick: () => U.openCatalogItem(x.item.id) }, 'Details')))) : h('p', { class: 'muted small' }, 'Add locations to the Master Catalog (or tag them in your scenes) and they appear here.')),
      m.days.length ? sec(h('div', { class: 'ins-kicker' }, 'Shoot-day routes'),
        m.days.map((x) => h('label', { class: 'check lm-day' },
          h('input', { type: 'checkbox', checked: !d.hiddenDays.includes(x.id), onchange: (e) => { d.hiddenDays = e.target.checked ? d.hiddenDays.filter((y) => y !== x.id) : [...d.hiddenDays, x.id]; changed(); U.renderView(); } }),
          h('i', { class: 'lm-swatch', style: `background:${x.color}` }),
          h('span', {}, h('strong', {}, `Day ${x.i + 1}`), x.date ? ' · ' + x.date : '', h('br'), h('span', { class: 'muted small' }, (x.stops.length ? x.stops.map((s) => s.item.name).join(' → ') : 'no mapped locations') + ' · ' + dist(x.km))))),
        h('p', { class: 'muted small' }, (d.base ? 'Routes start and end at the base. ' : 'Set a base to include the trip there and back. ') + 'Distances are straight lines, not roads.')) : sec(h('p', { class: 'muted small' }, 'Choose a schedule in the toolbar to see the route of each shoot day.')),
      sec(h('p', { class: 'muted small' }, 'Map © OpenStreetMap contributors. Address searches are sent to OpenStreetMap; nothing else leaves your computer.')));

    loadLeaflet().then((L) => {
      if (!document.body.contains(mapEl)) return;
      const map = L.map(mapEl, { zoomControl: true });
      view.map = map;
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
      const pin = (label, color, big) => L.divIcon({ className: 'lm-pin-wrap', html: `<span class="lm-pin${big ? ' big' : ''}" style="--c:${color}"></span><span class="lm-pin-label">${SD.escapeHtml(label)}</span>`, iconSize: [24, 24], iconAnchor: [12, 24] });
      const bounds = [];
      for (const x of m.locs) {
        if (!x.at) continue;
        bounds.push(x.at);
        const mk = L.marker(x.at, { icon: pin(x.item.name, '#a8432c'), draggable: true, title: x.item.name }).addTo(map);
        mk.bindPopup(`<strong>${SD.escapeHtml(x.item.name)}</strong><br>${x.scenes.length} scene${x.scenes.length === 1 ? '' : 's'}${x.days.length ? '<br>Shoot day ' + x.days.map((i) => i + 1).join(', ') : ''}${x.item.fields.address ? '<br><small>' + SD.escapeHtml(x.item.fields.address) + '</small>' : ''}`);
        mk.on('dragend', () => { const ll = mk.getLatLng(); x.item.fields.lat = ll.lat.toFixed(6); x.item.fields.lng = ll.lng.toFixed(6); changed(); });
      }
      if (d.base) {
        bounds.push([d.base.lat, d.base.lng]);
        const mk = L.marker([d.base.lat, d.base.lng], { icon: pin(d.base.label || 'Base', '#24211c', true), draggable: true, title: 'Base' }).addTo(map);
        mk.on('dragend', () => { const ll = mk.getLatLng(); d.base.lat = ll.lat; d.base.lng = ll.lng; changed(); U.renderView(); });
      }
      for (const x of m.days) {
        if (d.hiddenDays.includes(x.id) || x.pts.length < 2) continue;
        const pts = d.base ? [...x.pts, x.pts[0]] : x.pts;
        L.polyline(pts, { color: x.color, weight: 4, opacity: 0.85, dashArray: '8 6' }).addTo(map).bindTooltip(`Day ${x.i + 1}: ${dist(x.km)}`);
      }
      const fit = () => {
        if (bounds.length > 1) map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 });
        else if (bounds.length) map.setView(bounds[0], 14);
        else map.setView([50.85, 4.35], 5);
      };
      fit();
      map.on('click', async (e) => {
        if (!view.placing) return;
        const what = view.placing;
        view.placing = null;
        mapEl.classList.remove('placing');
        if (what === 'base') { const label = d.base ? d.base.label : await U.promptText('Name of the base', 'Base camp'); d.base = { lat: e.latlng.lat, lng: e.latlng.lng, label: label || 'Base' }; changed(); U.renderView(); return; }
        const it = U.project.catalog.find((c) => c.id === what);
        if (it) setAt(it, [e.latlng.lat, e.latlng.lng]);
      });
      // the panel may still be settling its size: measure again, then frame the pins
      setTimeout(() => { map.invalidateSize(); fit(); }, 80);
    }).catch(() => {
      mapEl.replaceChildren(h('div', { class: 'empty-state' }, h('div', { class: 'empty-icon' }, '🗺️'), h('h3', {}, 'The map needs an internet connection'), h('p', { class: 'muted' }, 'Your locations, shoot days and distances are listed on the right and still work offline.')));
    });
  }
})();
