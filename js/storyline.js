/* Scriptdesk — Storyline: a narrative chart with one line per character.
   Time runs left → right in "moments" (often scenes). In each moment, characters
   who are together are drawn as a bundle inside a group box; events (meetings,
   conflicts, turning points…) are marked on the lines of the characters involved. */
(function () {
  'use strict';
  const SD = window.SD;

  SD.STORY_PALETTE = ['#e5484d', '#0090ff', '#46a758', '#f76b15', '#8e4ec6', '#d6409f', '#12a594', '#e2a400', '#3e63dd', '#ad7f58', '#e93d82', '#5b5bd6', '#978365', '#00a2c7', '#29a383', '#8b8d98'];
  SD.STORY_EVENT_KINDS = [
    { id: 'meet', label: 'Meeting', icon: '🤝' },
    { id: 'conflict', label: 'Conflict', icon: '⚔️' },
    { id: 'turn', label: 'Turning point', icon: '↻' },
    { id: 'reveal', label: 'Revelation', icon: '💡' },
    { id: 'decision', label: 'Decision', icon: '❗' },
    { id: 'love', label: 'Romance', icon: '♥' },
    { id: 'loss', label: 'Loss / death', icon: '✝' },
    { id: 'other', label: 'Event', icon: '●' },
  ];
  const kindOf = (id) => SD.STORY_EVENT_KINDS.find((k) => k.id === id) || SD.STORY_EVENT_KINDS[SD.STORY_EVENT_KINDS.length - 1];

  SD.newStoryline = (name = 'Storyline') => ({
    id: SD.uid(), kind: 'storyline', name, sourceId: null, rows: [], beats: [],
    settings: { showAbsent: true, colWidth: 150 },
  });

  SD.normalizeStoryline = (d) => {
    d.rows = Array.isArray(d.rows) ? d.rows : [];
    d.beats = Array.isArray(d.beats) ? d.beats : [];
    d.settings = Object.assign({ showAbsent: true, colWidth: 150 }, d.settings || {});
    d.rows.forEach((r, i) => { r.id = r.id || SD.uid(); r.name = r.name || ''; r.color = r.color || SD.STORY_PALETTE[i % SD.STORY_PALETTE.length]; });
    d.beats.forEach((b) => {
      b.id = b.id || SD.uid(); b.label = b.label || '';
      b.groups = Array.isArray(b.groups) ? b.groups : [];
      b.events = Array.isArray(b.events) ? b.events : [];
      b.groups.forEach((g) => { g.id = g.id || SD.uid(); g.label = g.label || ''; g.members = Array.isArray(g.members) ? g.members : []; });
      b.events.forEach((e) => { e.id = e.id || SD.uid(); e.label = e.label || ''; e.kind = e.kind || 'other'; e.rows = Array.isArray(e.rows) ? e.rows : []; });
    });
    return d;
  };

  SD.storyRowName = (project, row) => {
    const c = row.charId && project.catalog.find((x) => x.id === row.charId);
    return (c ? c.name : row.name) || 'Unnamed';
  };

  SD.nextStoryColor = (d) => {
    const used = new Set(d.rows.map((r) => r.color));
    return SD.STORY_PALETTE.find((c) => !used.has(c)) || SD.STORY_PALETTE[d.rows.length % SD.STORY_PALETTE.length];
  };

  // ---------- build / update from a script ----------
  function scenesWithCast(script) {
    return SD.getScenes(script).map((s) => {
      const p = SD.parseSceneHeading(s.el.text);
      return { scene: s, chars: SD.sceneCharacters(script, s), where: script.scriptType === 'comic' ? 'Page ' + s.number : (p.location || s.el.text || 'Scene ' + s.number) };
    });
  }

  function rowForName(project, d, name) {
    const n = name.toUpperCase();
    let row = d.rows.find((r) => SD.storyRowName(project, r).toUpperCase() === n);
    if (!row) {
      const c = SD.findCatalogItem(project, 'character', n);
      row = { id: SD.uid(), name: n, charId: c ? c.id : null, color: SD.nextStoryColor(d) };
      d.rows.push(row);
    }
    return row;
  }

  // Sync moments with the scenes of a script. Moments you added yourself, and
  // events and extra groups you drew, are kept.
  SD.syncStorylineFromScript = (project, d, script) => {
    d.sourceId = script.id;
    const list = scenesWithCast(script);
    const bySceneId = new Map(d.beats.filter((b) => b.sceneId).map((b) => [b.sceneId, b]));
    // where do manual moments sit? after the nearest scene moment before them
    const after = new Map();
    let anchor = null;
    for (const b of d.beats) {
      if (b.sceneId) anchor = b.sceneId;
      else { if (!after.has(anchor)) after.set(anchor, []); after.get(anchor).push(b); }
    }
    const live = new Set(list.map((x) => x.scene.id));
    const result = [...(after.get(null) || [])];
    let added = 0;
    for (const { scene, chars, where } of list) {
      let b = bySceneId.get(scene.id);
      if (!b) { b = { id: SD.uid(), sceneId: scene.id, label: '', groups: [], events: [] }; added++; }
      if (!b.customLabel) b.label = (script.scriptType === 'comic' ? 'PAGE ' + scene.number + ' ' : '') + (scene.el.text || '').toUpperCase();
      b.number = scene.number;
      const ids = chars.map((n) => rowForName(project, d, n).id);
      if (!b.groups.length) b.groups.push({ id: SD.uid(), label: where, members: [] });
      const main = b.groups.find((g) => g.fromScript) || b.groups[0];
      main.fromScript = true;
      main.label = where;
      if (scene.el.color) main.color = scene.el.color;
      // characters found in the scene go to the scene group, unless you moved them to another group
      const elsewhere = new Set(b.groups.filter((g) => g !== main).flatMap((g) => g.members));
      const manual = (main.members || []).filter((id) => (main.manual || []).includes(id));
      main.members = [...new Set([...ids.filter((id) => !elsewhere.has(id)), ...manual])];
      result.push(b);
      result.push(...(after.get(scene.id) || []));
    }
    // moments whose scene was deleted stay at the end, so nothing you drew is lost
    for (const b of d.beats) if (b.sceneId && !live.has(b.sceneId)) { b.orphan = true; result.push(b); }
    for (const [k, list2] of after) if (k && !live.has(k)) result.push(...list2);
    d.beats = [...new Set(result)];
    return { scenes: list.length, added };
  };

  // ---------- layout ----------
  SD.layoutStoryline = (project, d) => {
    const colW = d.settings.colWidth || 150;
    const flat = Math.round(colW * 0.2);
    const left = 170, top = 78, right = 160;
    const B = d.beats.length;
    const rowIds = d.rows.map((r) => r.id);
    const rowSet = new Set(rowIds);
    const groupOf = d.beats.map((b) => {
      const m = new Map();
      b.groups.forEach((g, gi) => g.members.forEach((id) => { if (rowSet.has(id) && !m.has(id)) m.set(id, gi); }));
      return m;
    });
    // a character "lives" from first to last appearance (in a group or an event)
    const life = new Map();
    for (const id of rowIds) {
      let first = -1, last = -1;
      for (let b = 0; b < B; b++) {
        const here = groupOf[b].has(id) || d.beats[b].events.some((e) => e.rows.includes(id));
        if (here) { if (first < 0) first = b; last = b; }
      }
      life.set(id, [first, last]);
    }
    const alive = (id, b) => { const [f, l] = life.get(id); return f >= 0 && b >= f && b <= l; };
    const xOf = (b) => left + colW * b + colW / 2;

    const pos = new Map(rowIds.map((id) => [id, new Array(B).fill(null)]));
    const present = new Map(rowIds.map((id) => [id, new Array(B).fill(false)]));
    const prev = new Map(rowIds.map((id, i) => [id, top + 30 + i * 26]));
    const boxes = [];
    let maxY = top + 40;
    for (let b = 0; b < B; b++) {
      const beat = d.beats[b];
      const blocks = [];
      beat.groups.forEach((g, gi) => {
        const m = g.members.filter((id) => rowSet.has(id) && groupOf[b].get(id) === gi);
        if (m.length) blocks.push({ group: g, members: m });
      });
      if (d.settings.showAbsent) for (const id of rowIds) if (alive(id, b) && !groupOf[b].has(id)) blocks.push({ group: null, members: [id] });
      const key = (bl) => bl.members.reduce((s, id) => s + prev.get(id), 0) / bl.members.length;
      blocks.forEach((bl) => { bl.key = key(bl); bl.members.sort((a, c) => prev.get(a) - prev.get(c)); });
      blocks.sort((a, c) => a.key - c.key);
      let y = top + 14;
      for (const bl of blocks) {
        if (bl.group) {
          const boxTop = y;
          let yy = boxTop + 26;
          bl.members.forEach((id, i) => { if (i) yy += 13; pos.get(id)[b] = yy; present.get(id)[b] = true; prev.set(id, yy); });
          const boxBottom = yy + 12;
          boxes.push({ beat: b, group: bl.group, x0: xOf(b) - flat - 12, x1: xOf(b) + flat + 12, y0: boxTop, y1: boxBottom });
          y = boxBottom + 16;
        } else {
          const id = bl.members[0];
          y += 6;
          pos.get(id)[b] = y; prev.set(id, y);
          y += 18;
        }
      }
      maxY = Math.max(maxY, y);
    }
    return { colW, flat, left, top, xOf, pos, present, life, boxes, width: left + colW * B + right, height: maxY + 40 };
  };

  // ---------- SVG ----------
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const wrap2 = (s, n) => {
    const words = String(s).split(/\s+/).filter(Boolean);
    const lines = [''];
    for (const w of words) {
      const cur = lines[lines.length - 1];
      if (!cur) lines[lines.length - 1] = w;
      else if ((cur + ' ' + w).length <= n) lines[lines.length - 1] = cur + ' ' + w;
      else if (lines.length < 2) lines.push(w);
      else { lines[1] = (lines[1] + ' ' + w); }
    }
    return lines.map((l, i) => (i === 1 && l.length > n ? l.slice(0, n - 1) + '…' : l));
  };

  // opts: { selection: {type, id}, forExport: bool }
  SD.renderStorylineSVG = (project, d, opts = {}) => {
    const L = SD.layoutStoryline(project, d);
    const { xOf, flat, pos, present, life, boxes } = L;
    const sel = opts.selection || {};
    const selRow = sel.type === 'row' ? sel.id : null;
    const out = [];
    const font = 'font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif"';
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" class="story-svg${selRow ? ' has-sel' : ''}" width="${L.width}" height="${L.height}" viewBox="0 0 ${L.width} ${L.height}" ${font}>`);
    if (opts.forExport) out.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);
    // column guides & headers
    d.beats.forEach((b, i) => {
      const x = xOf(i);
      const on = sel.type === 'beat' && sel.id === b.id;
      out.push(`<line class="st-guide" x1="${x}" y1="${L.top - 6}" x2="${x}" y2="${L.height - 20}"/>`);
      const lines = wrap2(b.label || (b.sceneId ? '' : 'Moment ' + (i + 1)), Math.max(10, Math.floor(L.colW / 7)));
      out.push(`<g class="st-head${on ? ' on' : ''}${b.orphan ? ' orphan' : ''}" data-beat="${b.id}">`
        + `<rect x="${x - L.colW / 2 + 4}" y="6" width="${L.colW - 8}" height="${L.top - 20}" rx="8"/>`
        + `<text class="st-num" x="${x}" y="22" text-anchor="middle">${b.sceneId ? (b.orphan ? '× ' : '') + 'Scene ' + (b.number || i + 1) : '◆ ' + (i + 1)}</text>`
        + lines.map((l, k) => `<text class="st-label" x="${x}" y="${38 + k * 14}" text-anchor="middle">${esc(l)}</text>`).join('')
        + `</g>`);
    });
    // group boxes
    for (const bx of boxes) {
      const on = sel.type === 'group' && sel.id === bx.group.id;
      const col = bx.group.color || '#8b8d98';
      out.push(`<g class="st-group${on ? ' on' : ''}" data-beat="${d.beats[bx.beat].id}" data-group="${bx.group.id}">`
        + `<rect x="${bx.x0}" y="${bx.y0}" width="${bx.x1 - bx.x0}" height="${bx.y1 - bx.y0}" rx="12" fill="${col}" fill-opacity="0.1" stroke="${col}" stroke-opacity="0.35"/>`
        + `<text class="st-glabel" x="${bx.x0 + 8}" y="${bx.y0 + 14}">${esc(wrap2(bx.group.label || 'Together', Math.floor((bx.x1 - bx.x0 - 12) / 6))[0])}</text>`
        + `</g>`);
    }
    // character lines
    const rowsSvg = [];
    for (const r of d.rows) {
      const ys = pos.get(r.id), pr = present.get(r.id);
      const [first, last] = life.get(r.id);
      if (first < 0) continue;
      const segs = [];
      let lastB = -1;
      for (let b = first; b <= last; b++) {
        if (ys[b] == null) continue;
        const x = xOf(b), y = ys[b];
        if (lastB < 0) segs.push({ d: `M${x - flat} ${y} H${x}`, on: pr[b] });
        else {
          const x0 = xOf(lastB), y0 = ys[lastB];
          const xa = x0 + flat, xb = x - flat, mid = (xa + xb) / 2;
          segs.push({ d: `M${x0} ${y0} H${xa} C${mid} ${y0} ${mid} ${y} ${xb} ${y} H${x}`, on: pr[lastB] && pr[b] });
        }
        lastB = b;
      }
      if (lastB >= 0) segs.push({ d: `M${xOf(lastB)} ${ys[lastB]} H${xOf(lastB) + flat}`, on: pr[lastB] });
      const name = SD.storyRowName(project, r);
      const firstB = ys.findIndex((y) => y != null);
      const on = selRow === r.id;
      let g = `<g class="st-row${on ? ' sel' : ''}" data-row="${r.id}">`;
      for (const s of segs) g += `<path class="st-halo" d="${s.d}"/>`;
      for (const s of segs) g += `<path class="st-line${s.on ? '' : ' off'}" d="${s.d}" stroke="${r.color}"/>`;
      if (firstB >= 0) g += `<text class="st-name" x="${xOf(firstB) - flat - 8}" y="${ys[firstB] + 4}" text-anchor="end" fill="${r.color}">${esc(name)}</text>`;
      if (lastB >= 0 && lastB !== firstB) g += `<text class="st-name end" x="${xOf(lastB) + flat + 8}" y="${ys[lastB] + 4}" fill="${r.color}">${esc(name)}</text>`;
      g += '</g>';
      rowsSvg.push({ on: pr.some(Boolean), g });
    }
    out.push(...rowsSvg.filter((x) => !x.on).map((x) => x.g), ...rowsSvg.filter((x) => x.on).map((x) => x.g));
    // events
    d.beats.forEach((b, bi) => {
      const evs = b.events.filter((e) => e.rows.some((id) => pos.get(id) && pos.get(id)[bi] != null));
      evs.forEach((e, k) => {
        const x = xOf(bi) + (k - (evs.length - 1) / 2) * 18;
        const ys = e.rows.map((id) => ({ id, y: pos.get(id) && pos.get(id)[bi] })).filter((p) => p.y != null).sort((a, c) => a.y - c.y);
        const on = sel.type === 'event' && sel.id === e.id;
        const kind = kindOf(e.kind);
        let g = `<g class="st-event${on ? ' on' : ''}" data-beat="${b.id}" data-event="${e.id}">`;
        if (ys.length > 1) g += `<line class="st-elink" x1="${x}" y1="${ys[0].y}" x2="${x}" y2="${ys[ys.length - 1].y}"/>`;
        for (const p of ys) {
          const row = d.rows.find((r) => r.id === p.id);
          g += `<circle class="st-dot" cx="${x}" cy="${p.y}" r="6.5" stroke="${row ? row.color : '#555'}"/>`;
        }
        const label = (kind.icon + ' ' + (e.label || kind.label)).trim();
        const ly = ys[0].y - 14;
        g += `<text class="st-elabel" x="${x}" y="${ly}" text-anchor="middle">${esc(label.length > 34 ? label.slice(0, 33) + '…' : label)}</text>`;
        g += '</g>';
        out.push(g);
      });
    });
    out.push('</svg>');
    return { svg: out.join(''), layout: L };
  };

  // Inline styles for a stand-alone SVG download / print.
  SD.STORY_SVG_STYLE = `
    .st-guide{stroke:#000;stroke-opacity:.06;stroke-dasharray:3 5}
    .st-head rect{fill:transparent}
    .st-num{font-size:10px;font-weight:700;fill:#777;letter-spacing:.04em;text-transform:uppercase}
    .st-label{font-size:11px;fill:#333;font-family:"Courier Prime","Courier New",monospace}
    .st-glabel{font-size:10px;font-weight:600;fill:#555}
    .st-halo{fill:none;stroke:#fff;stroke-width:10;stroke-linecap:round}
    .st-line{fill:none;stroke-width:6;stroke-linecap:round;stroke-opacity:.92}
    .st-line.off{stroke-width:2;stroke-opacity:.4;stroke-dasharray:4 5}
    .st-name{font-size:12px;font-weight:700}
    .st-name.end{font-weight:600;opacity:.75}
    .st-elink{stroke:#222;stroke-width:1.5;stroke-opacity:.6}
    .st-dot{fill:#fff;stroke-width:3}
    .st-elabel{font-size:11px;font-weight:700;fill:#222;paint-order:stroke;stroke:#fff;stroke-width:4px;stroke-linejoin:round}`;
})();
