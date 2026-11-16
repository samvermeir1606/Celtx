/* Scriptdesk — mood board: pictures, colour palettes, quotes and references for a film, a scene or a character */
(function () {
  'use strict';
  const SD = (window.SD = window.SD || {});
  SD.KINDS = SD.KINDS || {};

  const K = {
    icon: '🎨',
    label: 'Mood Board',
    create(project, name) { return K.normalize({ id: SD.uid(), kind: 'moodboard', name, cards: [], about: [] }); },
    normalize(d) {
      d.cards = Array.isArray(d.cards) ? d.cards.filter((c) => c && c.type) : [];
      d.about = Array.isArray(d.about) ? d.about : [];
      d.columns = d.columns || 4;
      for (const c of d.cards) { c.id = c.id || SD.uid(); if (c.type === 'image' && !/^data:image\//.test(c.src || '')) c.src = ''; if (c.type === 'palette') c.colors = (Array.isArray(c.colors) ? c.colors : []).filter((x) => /^#[0-9a-f]{3,8}$/i.test(x)); }
      d.cards = d.cards.filter((c) => c.type !== 'link' || /^https?:\/\//i.test(c.url || ''));
      return d;
    },
    hasContent: (d) => d.cards.length > 0,
    status(d) { const n = (t) => d.cards.filter((c) => c.type === t).length; return `Mood board  ·  ${n('image')} pictures  ·  ${n('palette') + n('color')} palettes  ·  ${n('text')} notes  ·  ${n('link')} links  ·  drop or paste pictures`; },
    toolbar(d) {
      const { h } = SD.ui;
      return [
        h('button', { class: 'btn small', onclick: () => pickImages(d) }, '+ Pictures'),
        h('button', { class: 'btn small', onclick: () => add(d, { type: 'palette', colors: ['#2f3e46', '#52796f', '#84a98c', '#cad2c5', '#e9c46a'], caption: '' }) }, '+ Colours'),
        h('button', { class: 'btn small', onclick: () => add(d, { type: 'text', text: '', caption: '' }, true) }, '+ Words'),
        h('button', { class: 'btn small', onclick: () => addLink(d) }, '+ Link'),
        h('div', { class: 'tb-group' },
          h('select', { class: 'select small', title: 'Columns', onchange: (e) => { d.columns = +e.target.value; SD.ui.markDirty(); SD.ui.renderView(); } }, [2, 3, 4, 5, 6].map((n) => h('option', { value: n, selected: n === d.columns }, n + ' columns'))),
          h('button', { class: 'btn ghost small', onclick: () => K.print(d) }, 'Print')),
      ];
    },
    render(root, d) { renderBoard(root, d); },
    print(d) {
      const { h, printNodes, project } = SD.ui;
      const board = h('div', { class: 'mb-grid', style: `--cols:${d.columns}` }, d.cards.map((c) => cardView(d, c, true)));
      printNodes('print-mood', [h('h1', {}, [project.title, d.name].filter(Boolean).join(' — ')), board], { landscape: true, title: d.name });
    },
  };
  SD.KINDS.moodboard = K;

  function add(d, card, focus) {
    const c = Object.assign({ id: SD.uid() }, card);
    d.cards.push(c);
    SD.ui.markDirty();
    SD.ui.renderView();
    if (focus) setTimeout(() => { const t = document.querySelector(`.mb-card[data-card="${c.id}"] textarea`); if (t) t.focus(); }, 30);
    return c;
  }
  async function addImages(d, files, before) {
    let at = before ? d.cards.findIndex((c) => c.id === before) : d.cards.length;
    if (at < 0) at = d.cards.length;
    for (const f of files) {
      if (!/^image\//.test(f.type)) continue;
      try { d.cards.splice(at++, 0, { id: SD.uid(), type: 'image', src: await SD.imageToDataUrl(f, 1200), caption: '' }); } catch (e) { SD.ui.toast('A picture could not be read.'); }
    }
    SD.ui.markDirty();
    SD.ui.renderView();
  }
  function pickImages(d) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
    inp.addEventListener('change', () => addImages(d, [...inp.files]));
    inp.click();
  }
  async function addLink(d) {
    const url = await SD.ui.promptText('A link to a song, a film clip, a reference…', 'https://');
    if (!url || !/^https?:\/\/\S+\.\S+/.test(url.trim())) { if (url) SD.ui.toast('That does not look like a web address.'); return; }
    let host = '';
    try { host = new URL(url.trim()).hostname.replace(/^www\./, ''); } catch (e) { return; }
    add(d, { type: 'link', url: url.trim(), caption: host });
  }

  // the five main colours of a picture (a small k-means on a thumbnail)
  async function paletteOf(src, n = 5) {
    const im = new Image();
    await new Promise((r, j) => { im.onload = r; im.onerror = j; im.src = src; });
    const S = 48, cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const ctx = cv.getContext('2d');
    ctx.drawImage(im, 0, 0, S, S);
    const px = ctx.getImageData(0, 0, S, S).data;
    const pts = [];
    for (let i = 0; i < px.length; i += 4) pts.push([px[i], px[i + 1], px[i + 2]]);
    let cs = Array.from({ length: n }, (_, k) => pts[Math.floor(((k + 0.5) / n) * pts.length)].slice());
    for (let it = 0; it < 10; it++) {
      const sum = cs.map(() => [0, 0, 0, 0]);
      for (const p of pts) {
        let bi = 0, bd = Infinity;
        cs.forEach((c, k) => { const dd = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2; if (dd < bd) { bd = dd; bi = k; } });
        const s = sum[bi]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
      }
      cs = cs.map((c, k) => (sum[k][3] ? [sum[k][0] / sum[k][3], sum[k][1] / sum[k][3], sum[k][2] / sum[k][3], sum[k][3]] : c));
    }
    const hex = (c) => '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    // most common first, without near-identical colours
    const out = [];
    for (const c of cs.sort((a, b) => (b[3] || 0) - (a[3] || 0))) if (!out.some((o) => (o[0] - c[0]) ** 2 + (o[1] - c[1]) ** 2 + (o[2] - c[2]) ** 2 < 600)) out.push(c);
    return out.map(hex);
  }

  function cardView(d, c, forPrint) {
    const { h } = SD.ui;
    const U = SD.ui;
    const changed = () => { U.markDirty(); U.renderStatusSoon(); };
    const cap = forPrint ? (c.caption ? h('div', { class: 'mb-cap' }, c.caption) : null) : h('input', { class: 'mb-capin', value: c.caption || '', placeholder: 'Caption', oninput: (e) => { c.caption = e.target.value; changed(); } });
    let body;
    if (c.type === 'image') body = c.src ? h('img', { src: c.src, alt: c.caption || '' }) : h('div', { class: 'muted small' }, 'Missing picture');
    else if (c.type === 'palette') body = h('div', { class: 'mb-palette' }, (c.colors || []).map((col, i) => forPrint
      ? h('span', { class: 'mb-sw', style: `background:${col}` }, h('small', {}, col))
      : h('label', { class: 'mb-sw', style: `background:${col}`, title: 'Click to change' }, h('small', {}, col), h('input', { type: 'color', value: col, oninput: (e) => { c.colors[i] = e.target.value; e.target.parentElement.style.background = e.target.value; e.target.previousSibling.textContent = e.target.value; changed(); } }))));
    else if (c.type === 'text') body = forPrint ? h('blockquote', { class: 'mb-text' }, c.text) : h('textarea', { class: 'mb-text', rows: 3, value: c.text || '', placeholder: 'A line of dialogue, a feeling, a smell, a sound…', oninput: (e) => { c.text = e.target.value; changed(); } });
    else if (c.type === 'link') body = h('a', { class: 'mb-link', href: c.url, target: '_blank', rel: 'noopener' }, h('span', { class: 'mb-link-icon' }, /youtu|vimeo/.test(c.url) ? '▶' : /spotify|soundcloud|music/.test(c.url) ? '♫' : '↗'), h('span', {}, c.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)));
    const tools = forPrint ? null : h('div', { class: 'mb-tools' },
      c.type === 'image' && c.src ? h('button', { class: 'icon-btn', title: 'Take the colours of this picture', 'aria-label': 'Take colours', onclick: async () => { try { const colors = await paletteOf(c.src); d.cards.splice(d.cards.indexOf(c) + 1, 0, { id: SD.uid(), type: 'palette', colors, caption: c.caption ? 'Colours of ' + c.caption : '' }); U.markDirty(); U.renderView(); } catch (e) { U.toast('Could not read the colours.'); } } }, '🎨') : null,
      c.type === 'palette' ? h('button', { class: 'icon-btn', title: 'Add a colour', 'aria-label': 'Add a colour', onclick: () => { c.colors.push('#cccccc'); changed(); U.renderView(); } }, '+') : null,
      h('button', { class: 'icon-btn', title: c.wide ? 'Make narrow' : 'Make wide', 'aria-label': 'Toggle width', onclick: () => { c.wide = !c.wide; changed(); U.renderView(); } }, c.wide ? '⇥⇤' : '⇤⇥'),
      h('button', { class: 'icon-btn', title: 'Delete', 'aria-label': 'Delete card', onclick: () => { d.cards = d.cards.filter((x) => x !== c); U.markDirty(); U.renderView(); } }, '×'));
    return h('figure', { class: 'mb-card t-' + c.type + (c.wide ? ' wide' : ''), draggable: forPrint ? null : 'true', dataset: { card: c.id } }, tools, body, cap);
  }

  function renderBoard(root, d) {
    const U = SD.ui;
    const { h } = U;
    const aboutBar = h('div', { class: 'note-about' });
    const drawAbout = () => {
      const items = d.about.map((id) => U.project.catalog.find((c) => c.id === id)).filter(Boolean);
      aboutBar.replaceChildren(h('span', { class: 'muted small' }, 'For:'),
        ...items.map((c) => h('span', { class: 'chip', style: `--chip:${SD.categoryById(c.category).color}` }, h('button', { class: 'chip-name', onclick: () => U.openCatalogItem(c.id) }, c.name), h('button', { class: 'chip-x', 'aria-label': 'Remove ' + c.name, onclick: () => { d.about = d.about.filter((x) => x !== c.id); U.markDirty(); drawAbout(); } }, '×'))),
        h('button', { class: 'btn ghost small', onclick: (e) => { const pick = U.project.catalog.filter((c) => !d.about.includes(c.id) && c.name.trim()).slice(0, 60); if (!pick.length) { U.toast('Add characters or locations to the Master Catalog first.'); return; } U.popupMenu(e.currentTarget, pick.map((c) => ({ label: SD.categoryById(c.category).one + ': ' + c.name, run: () => { d.about.push(c.id); U.markDirty(); drawAbout(); } }))); } }, items.length ? '+ Link' : '+ Link to a character, location…'));
    };
    drawAbout();
    const grid = h('div', { class: 'mb-grid', style: `--cols:${d.columns}` }, d.cards.map((c) => cardView(d, c)));
    const wrap = h('div', { class: 'view-pad mb' }, aboutBar,
      d.cards.length ? grid : h('div', { class: 'empty-state mb-empty' }, h('div', { class: 'empty-icon' }, '🎨'), h('h3', {}, 'Collect the look and feel'),
        h('p', { class: 'muted' }, 'Drop pictures here, paste them (Ctrl+V), or use + Pictures. Pull a colour palette out of any picture with 🎨. Add words — a feeling, a line, a sound — and links to music or film clips.')));

    // drop pictures in; drag cards to reorder
    let drag = null;
    wrap.addEventListener('dragstart', (e) => { const c = e.target.closest && e.target.closest('.mb-card'); if (!c || e.target.closest('textarea, input')) return; drag = c.dataset.card; e.dataTransfer.setData('text/x-scriptdesk-card', drag); e.dataTransfer.effectAllowed = 'move'; c.classList.add('dragging'); });
    wrap.addEventListener('dragend', () => { drag = null; wrap.querySelectorAll('.dragging, .drop-before').forEach((x) => x.classList.remove('dragging', 'drop-before')); });
    wrap.addEventListener('dragover', (e) => {
      const files = !drag && [...e.dataTransfer.types].includes('Files');
      if (!drag && !files) return;
      e.preventDefault(); e.stopPropagation();
      wrap.querySelectorAll('.drop-before').forEach((x) => x.classList.remove('drop-before'));
      const c = e.target.closest('.mb-card'); if (c && c.dataset.card !== drag) c.classList.add('drop-before');
      wrap.classList.toggle('drop-on', !!files);
    });
    wrap.addEventListener('dragleave', (e) => { if (!wrap.contains(e.relatedTarget)) wrap.classList.remove('drop-on'); });
    wrap.addEventListener('drop', (e) => {
      const c = e.target.closest('.mb-card');
      wrap.classList.remove('drop-on');
      if (!drag) {
        const files = [...(e.dataTransfer.files || [])];
        if (!files.length) return;
        e.preventDefault(); e.stopPropagation();
        addImages(d, files, c && c.dataset.card);
        return;
      }
      e.preventDefault();
      const moving = d.cards.find((x) => x.id === drag);
      d.cards = d.cards.filter((x) => x !== moving);
      const at = c ? d.cards.findIndex((x) => x.id === c.dataset.card) : -1;
      d.cards.splice(at >= 0 ? at : d.cards.length, 0, moving);
      drag = null;
      U.markDirty();
      U.renderView();
    });
    root.append(wrap);
  }

  // paste a picture into the open mood board
  document.addEventListener('paste', (e) => {
    const d = SD.ui && SD.ui.currentDoc();
    if (!d || d.kind !== 'moodboard') return;
    if (e.target.closest && e.target.closest('input, textarea')) return;
    const files = [...(e.clipboardData ? e.clipboardData.items : [])].filter((i) => i.kind === 'file' && /^image\//.test(i.type)).map((i) => i.getAsFile());
    if (!files.length) return;
    e.preventDefault();
    addImages(d, files);
  });
})();
