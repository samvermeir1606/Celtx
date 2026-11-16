/* Builds the example projects in examples/ with Scriptdesk's own code.
   Run with:  node tools/build-examples.js   */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
global.window = {};
global.document = { addEventListener() {} };
if (typeof navigator === 'undefined') global.navigator = { language: 'en' };
for (const f of ['formats', 'catalog', 'storyline', 'storyboard', 'beatboard', 'sketch', 'schedule', 'budget', 'timeline', 'relations', 'moodboard', 'locmap']) {
  new Function(fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'))();
}
const SD = window.SD;
let n = 0;
SD.uid = () => 'ex' + (++n).toString(36).padStart(5, '0');
SD.ui = { project: null };

// "S: INT. …" scene · "A:" action · "C:" character · "P:" parenthetical · "D:" dialogue · "T:" transition
// "ACT:" act break · "V:" video · "AU:" audio · "SND:" sound · "MUS:" music · "=" synopsis of the last scene
// **bold** *italic* _underline_ inside the text become formatting
function script(type, name, src, tp) {
  const d = SD.newScript(type, name);
  const map = { S: 'scene', A: 'action', C: 'character', P: 'parenthetical', D: 'dialogue', T: 'transition', ACT: 'act', V: 'shot', AU: 'audio', SND: 'sound', MUS: 'music', SHOT: 'shot' };
  const els = [];
  for (const raw of src.trim().split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('=')) { els[els.length - 1].synopsis = line.slice(1).trim(); continue; }
    if (line.startsWith('#')) { const last = [...els].reverse().find((e) => e.type === 'scene'); last.color = line.slice(1).trim(); continue; }
    const m = line.match(/^([A-Z]+):\s?(.*)$/);
    const type2 = map[m[1]];
    const r = SD.markupToFmt(m[2]);
    const e = { id: SD.uid(), type: type2, text: r.text };
    if (type2 === 'character' && / \^$/.test(e.text)) { e.text = e.text.replace(/\s*\^$/, ''); e.dual = true; }
    if (r.fmt.length) e.fmt = r.fmt;
    els.push(e);
  }
  d.elements = els;
  Object.assign(d.titlePage, tp || {});
  return d;
}
const scenesOf = (d) => SD.getScenes(d);
const item = (category, name, fields, extra) => Object.assign(SD.newCatalogItem(category, name), { fields: fields || {} }, extra || {});
const save = (file, p) => { fs.writeFileSync(path.join(root, 'examples', file), JSON.stringify(SD.migrate(p), null, 1)); console.log('wrote', file); };
const note = (name, html, about, folder) => { const d = SD.newNote(name); d.html = html; d.text = SD.htmlToPlain ? html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : ''; d.about = about || []; if (folder) d.folder = folder; return d; };

// =====================================================================
// 1. The Last Ferry — a short film with every part of Scriptdesk filled in
// =====================================================================
{
  const sp = script('screenplay', 'The Last Ferry', `
S: EXT. HARBOUR - DAWN
= Elsa readies the old ferry for its last day. Across the water, the new bridge is nearly finished.
#
A: Fog sits low on the water. Gulls. A small car ferry, the MARGIT, rocks against the quay, rust showing through white paint.
A: Across the strait, the grey arch of a *new bridge* is almost closed. One last section hangs from a crane.
A: ELSA (70s), wool cap, hands like rope, coils a mooring line the way she has done ten thousand times.
A: She pats the ferry's hull.
C: ELSA
D: One more. Then you can sleep.
S: INT. FERRY WHEELHOUSE - DAWN
= Her son Tomas, the bridge engineer, calls on the radio. She refuses to come to the opening.
A: Brass, wood, a cracked leather seat. The VHF RADIO crackles.
C: TOMAS (V.O.)
P: (on radio)
D: Mum. Margit. Come in, Margit.
A: Elsa lets it ring twice more before she picks up the handset.
C: ELSA
D: Margit here.
C: TOMAS (V.O.)
D: The ceremony is at four. They kept you a seat. Front row.
C: ELSA
D: I have a crossing at four.
C: TOMAS (V.O.)
D: There is no crossing at four. That's the _point_.
A: She hangs the handset back on its hook. Gently. Then she starts the engine.
S: INT. FERRY CAR DECK - DAY
= Elsa finds Noor, a runaway teenager, hiding in a delivery van.
A: Three vehicles. A camper, a farm truck, and a white DELIVERY VAN with its back door not quite shut.
A: Elsa walks the deck, checking straps. She stops. Listens. A phone *buzzes* inside the van.
A: She yanks the door open. NOOR (16), hood up, backpack clutched to her chest, stares back.
C: NOOR
D: I paid. I paid the driver.
C: ELSA
D: The driver doesn't own my boat.
A: The phone buzzes again. *MUM* on the screen. Noor kills it.
S: EXT. FERRY DECK - DAY
= On the open deck they trade stories. Noor is running away; Elsa remembers her first crossing.
#
A: Wind. Spray. Elsa pours coffee from a dented THERMOS into two cups. Noor takes one without saying thanks.
C: NOOR
D: Everyone says the bridge is better. Ten minutes instead of forty.
C: ELSA
D: Everyone is right.
C: NOOR
D: So why are you still doing this?
A: Elsa looks at the water a long moment.
C: ELSA
D: My father let me steer when I was younger than you. I thought the island moved toward us. Every time. Like it was coming to meet me.
C: NOOR
P: (small)
D: Where I'm going, nobody comes to meet you.
S: INT. FERRY WHEELHOUSE - DAY
= The engine falters in the fog. Elsa puts Noor at the wheel while she fixes it.
A: The engine coughs. Stops. Silence, except for the water.
A: Elsa grabs a toolbox. Points at the wheel.
C: ELSA
D: Keep her nose on the light. Don't let the current turn you.
C: NOOR
D: I can't drive a boat!
C: ELSA
D: Nobody can. You just argue with it.
A: Elsa disappears below. Noor grips the wheel. Through the fog, a GREEN LIGHT blinks on the island pier.
A: The engine catches. Noor laughs, surprised at herself.
S: EXT. ISLAND PIER - DAY
= Tomas is waiting at the pier. Noor calls her mother.
A: The Margit bumps the pier. TOMAS (40s), hard hat under his arm, catches the line before Elsa can throw it.
C: TOMAS
D: You could have just said no on the radio.
C: ELSA
D: I did say no.
C: TOMAS
D: Mum, about the bridge —
C: ELSA ^
D: Don't you dare thank me.
A: Behind them Noor holds her phone to her ear. She turns away to talk. We don't hear it. We see her nod.
S: EXT. FERRY DECK - DUSK
= The last crossing home: Elsa, Tomas and the ferry pass under the new bridge.
#
A: The Margit crosses back. Tomas stands beside his mother at the rail. Above them the bridge is lit for the ceremony.
A: The ferry passes *under* it. For a moment the whole deck is in shadow.
C: TOMAS
D: You know you'll be able to drive across in ten minutes.
C: ELSA
D: I know.
A: On the shrinking pier, Noor waves. Elsa lifts one hand from the rail.
T: FADE OUT.
`, { title: 'The Last Ferry', author: 'A Scriptdesk example', draftDate: 'Example draft' });
  sp.elements.find((e) => e.text.startsWith('The engine coughs')).comments = [{ id: SD.uid(), text: 'Could we hear the silence for longer here? Hold on the fog.', quote: 'Silence, except for the water.', start: 23, end: 54, created: '2026-01-10T10:00:00.000Z', done: false, author: 'Anna (reader)' }];
  sp.elements.find((e) => e.text.startsWith('Where I')).comments = [{ id: SD.uid(), text: 'Best line in the script. Keep it.', quote: '', start: 0, end: 0, created: '2026-01-10T10:05:00.000Z', done: false, author: 'Anna (reader)' }];

  const elsa = item('character', 'ELSA', { age: 'Early 70s', occupation: 'Ferry captain', want: 'To make the last crossing on her own terms', need: 'To let her son into her world before it disappears', personality: 'Dry, stubborn, kind in actions rather than words' }, { description: 'Has run the Margit for 41 years. Her late husband was the engineer.' });
  const noor = item('character', 'NOOR', { age: '16', want: 'To get as far from home as possible', need: 'Someone to meet her halfway' }, { description: 'Runs away to the island to stay with a cousin who does not know she is coming.' });
  const tomas = item('character', 'TOMAS', { age: 'Mid 40s', occupation: 'Bridge engineer' }, { description: 'Elsa’s son. Built the bridge that ends her job, and feels guilty about being proud of it.' });
  const aElsa = item('actor', 'Marit Holm', { price: '650', priceUnit: 'per shoot day', email: 'agent@example.com' });
  const aNoor = item('actor', 'Yara Benali', { price: '400', priceUnit: 'per shoot day' });
  const aTomas = item('actor', 'Pieter de Vries', { price: '500', priceUnit: 'per shoot day' });
  elsa.links.playedBy = aElsa.id; noor.links.playedBy = aNoor.id; tomas.links.playedBy = aTomas.id;
  const harbour = item('location', 'HARBOUR', { price: '250', priceUnit: 'per shoot day', address: 'Old ferry quay, Svendborg', lat: '55.059400', lng: '10.613200' });
  const ferry = item('location', 'FERRY', { price: '1800', priceUnit: 'per shoot day', facilities: 'Working car ferry with crew, 3 vehicles on deck', lat: '55.040000', lng: '10.598000' }, { description: 'The Margit, a 1968 car ferry. Rented with her own crew.' });
  const pier = item('location', 'ISLAND PIER', { price: '150', priceUnit: 'per shoot day', address: 'Ferry pier, Tåsinge', lat: '55.012000', lng: '10.587000' });
  const thermos = item('prop', 'Dented thermos', { price: '15', priceUnit: 'one-off' });
  const radio = item('prop', 'VHF radio handset', { price: '20', priceUnit: 'per shoot day' });
  const backpack = item('prop', 'Noor’s backpack', { price: '35', priceUnit: 'one-off' });
  const coat = item('wardrobe', 'Elsa’s captain coat', { price: '120', priceUnit: 'one-off' }, { links: { usedBy: [elsa.id] } });
  const van = item('vehicle', 'White delivery van', { price: '90', priceUnit: 'per shoot day' });
  const dop = item('crew', 'Director of photography', { price: '450', priceUnit: 'per shoot day', position: 'DoP' });
  const sound = item('crew', 'Sound recordist', { price: '320', priceUnit: 'per shoot day' });
  const gaffer = item('crew', 'Gaffer', { price: '280', priceUnit: 'per shoot day' });
  const fog = item('sfx', 'Fog machine', { price: '140', priceUnit: 'per shoot day' });
  const sc = scenesOf(sp);
  const tag = (i, ...items) => { sc[i].el.items = items.map((x) => x.id); };
  [2, 3, 6, 4, 9, 5, 7].forEach((t, i) => { sc[i].el.temp = t; });
  sc[0].el.timing = { manual: 58 };
  sc[3].el.timing = { read: 96 };
  tag(0, harbour, coat); tag(1, radio, coat); tag(2, van, backpack); tag(3, thermos, coat, backpack); tag(4, fog, coat); tag(5, pier, backpack); tag(6, coat);

  const p = SD.newProject();
  SD.ui.project = p;
  p.title = 'The Last Ferry';
  p.logline = 'On the last day before a bridge replaces her ferry, a stubborn old captain finds a runaway teenager on board — and has one crossing left to make peace with her son.';
  p.documents = [sp];
  p.catalog = [elsa, noor, tomas, aElsa, aNoor, aTomas, harbour, ferry, pier, thermos, radio, backpack, coat, van, dop, sound, gaffer, fog];
  p.settings.sceneNumbers = true;
  p.settings.goals = { daily: 500, pages: 10, work: 25, rest: 5, breaks: true };

  // storyline
  const sl = SD.newStoryline('Who meets whom');
  SD.syncStorylineFromScript(p, sl, sp);
  sl.beats[2].events.push({ id: SD.uid(), kind: 'meet', label: 'Elsa finds Noor', rows: sl.rows.filter((r) => ['ELSA', 'NOOR'].includes(r.name)).map((r) => r.id) });
  sl.beats[4].events.push({ id: SD.uid(), kind: 'turn', label: 'Noor steers', rows: sl.rows.filter((r) => r.name === 'NOOR').map((r) => r.id) });
  sl.beats[6].events.push({ id: SD.uid(), kind: 'love', label: 'Mother and son, together', rows: sl.rows.filter((r) => ['ELSA', 'TOMAS'].includes(r.name)).map((r) => r.id) });

  // sketch: the car deck, with a setup per shot
  const sk = SD.KINDS.sketch.create(p, 'Car deck — plan');
  sk.items.push(
    { id: SD.uid(), type: 'wall', x1: 120, y1: 120, x2: 1080, y2: 120, color: '#444' },
    { id: SD.uid(), type: 'wall', x1: 120, y1: 680, x2: 1080, y2: 680, color: '#444' },
    { id: SD.uid(), type: 'wall', x1: 120, y1: 120, x2: 120, y2: 680, color: '#444' },
    { id: SD.uid(), type: 'rect', x: 900, y: 140, w: 160, h: 120, color: '#8b8d98', label: 'Stairs to deck' },
    { id: SD.uid(), type: 'car', x: 760, y: 420, rot: 180, scale: 1.6, color: '#e6e1d6', label: 'Delivery van' },
    { id: SD.uid(), type: 'car', x: 420, y: 250, rot: 180, scale: 1.4, color: '#2f9e66', label: 'Farm truck' },
    { id: SD.uid(), type: 'car', x: 420, y: 560, rot: 180, scale: 1.4, color: '#2f6fd6', label: 'Camper' },
    { id: SD.uid(), type: 'text', x: 600, y: 160, label: 'Bow ramp →', size: 18, color: '#555' });
  const s1 = SD.sketchSetups.create(sk, 'Shot 3A — wide');
  sk.items.push(
    { id: SD.uid(), type: 'camera', x: 200, y: 400, rot: 0, scale: 1, color: '#2f2f35', label: 'A cam, 24mm', setup: s1.id },
    { id: SD.uid(), type: 'person', x: 560, y: 400, rot: 0, scale: 1, color: '#d64541', label: 'ELSA', setup: s1.id },
    { id: SD.uid(), type: 'arrow', x1: 580, y1: 400, x2: 690, y2: 420, color: '#d64541', setup: s1.id });
  const s2 = SD.sketchSetups.create(sk, 'Shot 3B — the van door');
  sk.items.push(
    { id: SD.uid(), type: 'camera', x: 600, y: 470, rot: 0, scale: 1, color: '#2f2f35', label: 'A cam, 50mm', setup: s2.id },
    { id: SD.uid(), type: 'person', x: 690, y: 440, rot: 0, scale: 1, color: '#d64541', label: 'ELSA', setup: s2.id },
    { id: SD.uid(), type: 'person', x: 820, y: 430, rot: 180, scale: 1, color: '#8e44ad', label: 'NOOR (in van)', setup: s2.id },
    { id: SD.uid(), type: 'light', x: 960, y: 560, rot: 210, scale: 1, color: '#e8a33d', label: 'Practical', setup: s2.id });

  // storyboard
  const sb = SD.newStoryboard('Storyboard');
  SD.syncStoryboardFromScript(p, sb, sp);
  sb.sequences[0].shots.push(
    SD.newShot({ caption: 'Fog on the water. The bridge, almost closed, far away.', shotType: 'EWS', move: 'Static', duration: 5, audio: 'Gulls, distant crane' }),
    SD.newShot({ caption: 'Elsa coils the mooring line.', shotType: 'MS', move: 'Handheld', duration: 4 }),
    SD.newShot({ caption: 'Her hand on the hull.', shotType: 'ECU', move: 'Static', duration: 3, audio: 'ELSA: One more. Then you can sleep.' }));
  sb.sequences[2].shots.push(
    SD.newShot({ caption: 'Elsa walks the deck between the vehicles, checking straps.', shotType: 'WS', move: 'Tracking', lens: '24mm', duration: 6, setupRef: { sketch: sk.id, setup: s1.id } }),
    SD.newShot({ caption: 'The van door flies open: Noor stares back.', shotType: 'MCU', move: 'Static', lens: '50mm', duration: 3, setupRef: { sketch: sk.id, setup: s2.id }, audio: 'Phone buzzing' }));

  // beat board
  const bb = SD.KINDS.beatboard.create(p, 'Story circle');
  bb.template = 'storyCircle';
  bb.beats = SD.BEAT_TEMPLATES.storyCircle.beats.map(([title, hint, pct]) => ({ id: SD.uid(), title, hint, pct, cards: [] }));
  bb.sourceId = sp.id;
  const put = (beat, i) => bb.beats[beat].cards.push({ id: SD.uid(), sceneId: sc[i].id });
  put(0, 0); put(1, 1); put(2, 2); put(3, 3); put(4, 4); put(6, 5); put(7, 6);
  bb.beats[5].cards.push({ id: SD.uid(), text: 'What does Elsa give up? Maybe she misses the ceremony on purpose — and Tomas sees it.', color: '#ffd9cc' });

  // schedule
  const sch = SD.KINDS.schedule.create(p, 'Shooting schedule');
  sch.sourceId = sp.id;
  sch.days = [
    { id: SD.uid(), date: '2026-05-04', call: '06:00', notes: 'Dawn scenes first. Fog machine on board.', scenes: [sc[0].id, sc[1].id, sc[4].id] },
    { id: SD.uid(), date: '2026-05-05', call: '07:00', notes: 'Ferry sailing all day. Golden hour for the last scene.', scenes: [sc[2].id, sc[3].id, sc[6].id] },
    { id: SD.uid(), date: '2026-05-06', call: '08:00', notes: '', scenes: [sc[5].id] },
  ];
  sch.events = [{ id: SD.uid(), date: '2026-04-28', title: 'Table read', notes: 'At the production office' }, { id: SD.uid(), date: '2026-04-30', title: 'Location scout: the Margit', notes: '' }];
  Object.assign(sch.callsheet, { company: 'Northern Light Films (example)', producer: 'J. Example', director: 'A. Example', contact: 'production@example.com', location: 'Base: old ferry quay car park', weather: 'Check the marine forecast' });

  // budget
  const bg = SD.KINDS.budget.create(p, 'Budget');
  bg.scheduleId = sch.id;
  bg.currency = 'EUR';
  bg.manual.find((m) => m.label.startsWith('Catering')).rate = 260;
  bg.manual.find((m) => m.label === 'Insurance').rate = 450;
  bg.manual.find((m) => m.label === 'Editing').rate = 900;
  bg.manual.find((m) => m.label.startsWith('Music')).rate = 600;
  bg.manual.push({ id: SD.uid(), group: 'transport', label: 'Camera package rental', unit: 'per shoot day', rate: 350, qty: '' });

  // notes in a folder, linked to the characters
  const folder = { id: SD.uid(), name: 'Character notes', open: true };
  p.folders = [folder];
  const n1 = note('Elsa — notes', '<h2>Elsa</h2><p>She never says what she feels. She <b>does</b> things: the coffee, the steering wheel, the hand on the hull.</p><ul><li>41 years on the same crossing</li><li>Husband Jens died six years ago — he kept the engine running</li><li>Doesn’t hate the bridge. Hates being <i>thanked</i>.</li></ul><blockquote>“Nobody can drive a boat. You just argue with it.”</blockquote>', [elsa.id], folder.id);
  const n2 = note('Noor — notes', '<h2>Noor</h2><p>Not running <i>from</i> something dramatic. Running because nobody noticed she was sad.</p><p>Her cousin on the island doesn’t know she’s coming. The phone call on the pier is the turn: she lets her mother come and get her.</p>', [noor.id], folder.id);
  const n3 = note('Ideas & research', '<h2>Research</h2><ul><li>Real ferries replaced by bridges: talk to a retired captain</li><li>VHF radio etiquette: “Margit, Margit, this is…”</li></ul><h3>Possible title</h3><p><b>The Last Ferry</b> / <i>Crossing</i> / <i>Margit</i></p>', []);
  // an alternative ending for the last scene
  const last = sc[sc.length - 1];
  last.el.versionName = 'Under the bridge';
  last.el.versions = [{ id: SD.uid(), name: 'At the ceremony', created: '2026-01-12T09:00:00.000Z', elements: [
    { id: SD.uid(), type: 'action', text: 'Elsa ties up the Margit for the last time. Up on the bridge, a brass band starts to play.' },
    { id: SD.uid(), type: 'action', text: 'She climbs the stairs to the ceremony in her captain’s coat. Tomas sees her and stops mid-speech.' },
    { id: SD.uid(), type: 'character', text: 'TOMAS' },
    { id: SD.uid(), type: 'dialogue', text: 'The front row is still free.' },
    { id: SD.uid(), type: 'transition', text: 'FADE OUT.' },
  ] }];

  // story order vs plot order: what happened before the film
  const tl = SD.KINDS.timeline.create(p, 'Timeline');
  tl.sourceId = sp.id;
  const ev1 = { id: SD.uid(), text: 'Elsa’s father lets her steer the ferry for the first time' };
  const ev2 = { id: SD.uid(), text: 'Elsa’s husband Jens, the ferry’s engineer, dies' };
  const ev3 = { id: SD.uid(), text: 'Building of the bridge begins — Tomas is the engineer' };
  tl.events = [ev1, ev2, ev3];
  tl.order = [ev1.id, ev2.id, ev3.id, ...sc.map((x) => x.id)];
  Object.assign(tl.when, { [ev1.id]: '1962', [ev2.id]: '6 years ago', [ev3.id]: '3 years ago', [sc[0].id]: 'The last day, dawn', [sc[3].id]: 'Mid-morning', [sc[5].id]: 'Noon', [sc[6].id]: 'Dusk' });

  // who feels what about whom, and how it changes
  const rel = SD.KINDS.relations.create(p, 'Relationships');
  rel.sourceId = sp.id;
  rel.nodes = { [elsa.id]: { x: 550, y: 220 }, [noor.id]: { x: 300, y: 500 }, [tomas.id]: { x: 800, y: 500 } };
  rel.links = [
    { id: SD.uid(), a: elsa.id, b: tomas.id, kind: 'family', label: 'mother & son, not talking', changes: [{ id: SD.uid(), sceneId: sc[6].id, kind: 'love', label: 'side by side again' }] },
    { id: SD.uid(), a: elsa.id, b: noor.id, kind: 'rivals', label: 'stowaway', from: sc[2].id, changes: [{ id: SD.uid(), sceneId: sc[4].id, kind: 'friends', label: 'she lets Noor steer' }] },
    { id: SD.uid(), a: tomas.id, b: elsa.id, kind: 'secret', label: 'proud of the bridge, ashamed of it', directed: true, changes: [] },
  ];

  // the look and feel
  const mb = SD.KINDS.moodboard.create(p, 'Mood board');
  mb.about = [ferry.id, elsa.id];
  mb.columns = 3;
  mb.cards = [
    { id: SD.uid(), type: 'text', text: 'Grey, wet, quiet. The warmth is in the hands, never in the light.', caption: 'The feeling', wide: true },
    { id: SD.uid(), type: 'palette', colors: ['#2e3b42', '#5f7480', '#a7b4b8', '#e3e0d6', '#b5452b'], caption: 'Sea fog + the rust-red of the Margit' },
    { id: SD.uid(), type: 'palette', colors: ['#3d2b1f', '#8a5a3b', '#d9a066', '#f2e3c6', '#556b2f'], caption: 'Inside the wheelhouse: wood and brass' },
    { id: SD.uid(), type: 'text', text: '“Nobody can drive a boat. You just argue with it.”', caption: 'Elsa' },
    { id: SD.uid(), type: 'text', text: 'Sounds: the diesel engine, gulls, the VHF radio hiss, rope on steel.', caption: 'Sound' },
    { id: SD.uid(), type: 'link', url: 'https://www.openstreetmap.org/#map=13/55.04/10.6', caption: 'The real crossing' },
  ];

  // where everything is
  const lm = SD.KINDS.locmap.create(p, 'Location map');
  lm.scheduleId = sch.id;
  lm.base = { lat: 55.0612, lng: 10.6098, label: 'Base: quay car park' };

  p.documents.push(sl, tl, rel, sb, sk, bb, mb, sch, lm, bg, n3, n1, n2);
  p.writingLog = {};
  save('the-last-ferry.scriptdesk', p);
}

// =====================================================================
// 2. Night Shift — a single-camera TV drama pilot
// =====================================================================
{
  const tv = script('teleplay', 'Night Shift — Pilot', `
ACT: TEASER
S: INT. ST. AUGUSTA HOSPITAL - EMERGENCY ROOM - NIGHT
A: Fluorescent hum. A vending machine clunks. Empty plastic chairs.
A: DR. IMANI COLE (30s), scrubs, coffee in each hand, pushes through the doors with her hip.
C: IMANI
D: Who ordered the quiet? Because I want a refund.
A: The ambulance doors BANG open. Two PARAMEDICS wheel in a gurney. On it: a man in a tuxedo, soaking wet, *laughing*.
C: PARAMEDIC
D: Found him in the river. Says he's fine. Says his name is Frank Sinatra.
C: IMANI
P: (setting the coffees down)
D: They always are.
ACT: END OF TEASER
ACT: ACT ONE
S: INT. ER - TRAUMA BAY 2 - CONTINUOUS
A: Imani shines a light in "FRANK's" eyes. Mid 50s, silver hair, wedding ring.
C: FRANK
D: You have kind eyes. Tired, but kind.
C: IMANI
D: I've been awake for nineteen hours. Who are you really?
C: FRANK
D: Tonight? Somebody who finally did something brave.
A: Imani notices a hospital bracelet already on his wrist. Faded. From *this* hospital.
S: INT. ER - NURSES' STATION - NIGHT
A: Charge nurse BEN OKAFOR (40s) types with two fingers. Imani slaps the old bracelet on the desk.
C: IMANI
D: Run this number.
C: BEN
D: That's an old system number. Before the merger.
C: IMANI
D: So it's _old_. Run it anyway.
A: Ben types. Stops. Looks up.
C: BEN
D: Imani. This man died here. Eleven years ago.
ACT: END OF ACT ONE
`, { title: 'Night Shift', episode: 'Episode 101\n“Pilot”', author: 'A Scriptdesk example', draftDate: 'Example draft' });
  const p = SD.newProject();
  SD.ui.project = p;
  p.title = 'Night Shift';
  p.documents = [tv];
  p.catalog = [item('character', 'IMANI', { age: '30s', occupation: 'Emergency doctor' }, { description: 'Brilliant, exhausted, funny when she should sleep.' }), item('character', 'FRANK', {}, { description: 'Says he is Frank Sinatra. Hospital records say he died eleven years ago.' }), item('character', 'BEN', { occupation: 'Charge nurse' })];
  const series = note('Series bible', '<h1>Night Shift</h1><p>A hospital drama where every night shift brings one patient who should not exist.</p><h2>Season one</h2><ol><li>Pilot — the man who died eleven years ago</li><li>The girl who remembers tomorrow</li><li>Two patients, one name</li></ol>', []);
  const bb = SD.KINDS.beatboard.create(p, 'Pilot structure');
  bb.template = 'threeAct';
  bb.beats = SD.BEAT_TEMPLATES.threeAct.beats.map(([title, hint, pct]) => ({ id: SD.uid(), title, hint, pct, cards: [] }));
  bb.sourceId = tv.id;
  const sc = scenesOf(tv);
  bb.beats[0].cards.push({ id: SD.uid(), sceneId: sc[0].id });
  bb.beats[1].cards.push({ id: SD.uid(), sceneId: sc[1].id });
  bb.beats[2].cards.push({ id: SD.uid(), sceneId: sc[2].id });
  bb.beats[4].cards.push({ id: SD.uid(), text: 'Act Two: Imani finds Frank’s widow — she remarried, and she is a patient upstairs.', color: '#d6f0ff' });
  p.documents.push(bb, series);
  save('night-shift-pilot.scriptdesk', p);
}

// =====================================================================
// 3. The Flatmates — a multi-camera sitcom
// =====================================================================
{
  const sc = script('sitcom', 'The Flatmates — “The Plant”', `
ACT: ACT ONE
S: INT. FLAT - KITCHEN - MORNING
A: Dishes everywhere. A sad, nearly dead house plant on the windowsill. LIV (late 20s) stares at it.
C: LIV
D: Sam. The plant.
C: SAM
D: What about the plant?
C: LIV
D: It's dead, Sam.
C: SAM
P: (offended)
D: It's *resting*.
A: SAM (late 20s) waters it with cold coffee.
C: LIV
D: My mother gave me that plant. She's coming on Saturday.
C: SAM
D: Then we have four days to perform a miracle.
S: INT. GARDEN CENTRE - DAY
A: Sam holds up two identical plants to a bored SHOP ASSISTANT (20s).
C: SAM
D: Which one looks more like it's been loved for three years?
C: SHOP ASSISTANT
D: They're both from Tuesday.
C: SAM
D: Perfect. Wrap the sadder one.
ACT: END OF ACT ONE
`, { title: 'The Flatmates', episode: 'Episode 3\n“The Plant”', author: 'A Scriptdesk example' });
  const p = SD.newProject();
  SD.ui.project = p;
  p.title = 'The Flatmates';
  p.documents = [sc];
  p.catalog = [item('character', 'LIV'), item('character', 'SAM'), item('prop', 'Nearly dead house plant', { price: '12', priceUnit: 'one-off' })];
  save('the-flatmates.scriptdesk', p);
}

// =====================================================================
// 4. The Lantern — an audio play
// =====================================================================
{
  const ap = script('audioplay', 'The Lantern', `
S: SCENE 1. A LIGHTHOUSE. NIGHT.
SND: WIND HOWLS AROUND STONE. A HEAVY DOOR SLAMS.
MUS: A LOW CELLO NOTE, HELD.
A: Footsteps on an iron spiral staircase, climbing, slowing.
C: GRETA
P: (out of breath)
D: Two hundred and twelve steps. Every night for thirty years, and I still count them.
SND: A MATCH STRIKES. A HISS AS THE LAMP CATCHES.
C: GRETA
D: There you are, old friend. Let's see who's out there tonight.
SND: FAINT, FAR OFF — A SHIP'S HORN. ONCE. TWICE.
C: GRETA
P: (sharp)
D: That's not a ship I know.
S: SCENE 2. THE LANTERN ROOM. LATER.
SND: THE LAMP TURNS WITH A SLOW MECHANICAL TICK.
C: RADIO VOICE
P: (distorted, through static)
D: Lighthouse... lighthouse, this is the *Esperanza*... we see your light... we've been seeing it for sixty years...
MUS: THE CELLO RISES, UNEASY.
C: GRETA
D: The Esperanza sank in nineteen sixty-four.
SND: STATIC SWALLOWS THE VOICE. ONLY WIND.
`, { title: 'The Lantern', author: 'A Scriptdesk example', credit: 'An audio drama by' });
  const p = SD.newProject();
  SD.ui.project = p;
  p.title = 'The Lantern';
  p.documents = [ap];
  p.catalog = [item('character', 'GRETA', { age: '60s' }, { description: 'The last lighthouse keeper on the coast.' }), item('character', 'RADIO VOICE'), item('sound', 'Wind and storm bed', { source: 'Library' }), item('music', 'Solo cello theme', { composer: 'TBC' })];
  save('the-lantern.scriptdesk', p);
}

// =====================================================================
// 5. A plain Fountain file, to show importing
// =====================================================================
fs.writeFileSync(path.join(root, 'examples', 'the-cartographer.fountain'), `Title: The Cartographer
Credit: Written by
Author: A Scriptdesk example
Draft date: Example draft

FADE IN:

EXT. MOUNTAIN PASS - DAY

= A mapmaker reaches the edge of every map she has ever drawn.

Snow. Wind. HANNA (40s) kneels on a rock, a leather folio open on her knee. She draws the valley below with quick, sure lines.

She stops. The valley on her paper ends at the river. The real valley *doesn't*.

HANNA
(to herself)
That wasn't there yesterday.

A BOY (10), wrapped in too many scarves, appears beside her. She jumps.

BOY
It's always been there. You just never came this far.

HANNA
Nobody comes this far.

BOY
_You_ did.

> CUT TO:

INT. HANNA'S TENT - NIGHT

Lamp light. Hanna unrolls every map she owns. They all end at the same river.

She dips her pen. Hesitates. Then draws one new line past the edge.

>THE END<
`);
fs.writeFileSync(path.join(root, 'examples', 'index.json'), JSON.stringify([
  { file: 'examples/the-last-ferry.scriptdesk', title: 'The Last Ferry', kind: 'Short film with storyboard, sketch, schedule and budget' },
  { file: 'examples/night-shift-pilot.scriptdesk', title: 'Night Shift', kind: 'TV drama pilot' },
  { file: 'examples/the-flatmates.scriptdesk', title: 'The Flatmates', kind: 'Multi-camera sitcom' },
  { file: 'examples/the-lantern.scriptdesk', title: 'The Lantern', kind: 'Audio play' },
  { file: 'examples/the-cartographer.fountain', title: 'The Cartographer', kind: 'Fountain file' },
], null, 1));
console.log('done');
