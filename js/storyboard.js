/* Scriptdesk — storyboard: sequences (one per scene) holding shots.
   Each shot has a picture, an optional drawing on top of it, a caption and camera details. */
(function () {
  'use strict';
  const SD = (window.SD = window.SD || {});

  SD.SHOT_TYPES = [
    ['EWS', 'Extreme wide shot'], ['VWS', 'Very wide shot'], ['WS', 'Wide shot'], ['FS', 'Full shot'],
    ['MWS', 'Medium wide shot'], ['MS', 'Medium shot'], ['MCU', 'Medium close-up'], ['CU', 'Close-up'],
    ['ECU', 'Extreme close-up'], ['OTS', 'Over the shoulder'], ['2S', 'Two shot'], ['POV', 'Point of view'],
    ['INS', 'Insert'], ['EST', 'Establishing shot'], ['AER', 'Aerial'],
  ].map(([abbr, label]) => ({ abbr, label }));

  SD.CAMERA_MOVES = ['Static', 'Pan', 'Tilt', 'Zoom in', 'Zoom out', 'Dolly in', 'Dolly out', 'Tracking', 'Crane', 'Handheld', 'Steadicam', 'Whip pan'];

  SD.FRAME_RATIOS = { '16:9': 16 / 9, '2.39:1': 2.39, '1.85:1': 1.85, '4:3': 4 / 3, '1:1': 1, '9:16': 9 / 16 };

  SD.shotTypeLabel = (abbr) => (SD.SHOT_TYPES.find((t) => t.abbr === abbr) || {}).label || '';

  // Map free text such as "VERY WIDE SHOT:" or "Close up" onto a shot type.
  SD.matchShotType = (text) => {
    const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const want = norm(text);
    if (!want) return '';
    const t = SD.SHOT_TYPES.find((x) => norm(x.abbr) === want || norm(x.label) === want || norm(x.label).replace('SHOT', '') === want);
    return t ? t.abbr : '';
  };

  SD.newShot = (props) => Object.assign({ id: SD.uid(), caption: '', shotType: '', move: '', lens: '', duration: 0, audio: '', notes: '', image: '', drawing: '', diagram: '' }, props || {});

  SD.newStoryboard = (name) => ({
    id: SD.uid(),
    kind: 'storyboard',
    name: name || 'Storyboard',
    sourceId: null,
    ratio: '16:9',
    sequences: [],
    settings: { size: 'm', details: true },
  });

  SD.normalizeStoryboard = (d) => {
    const base = SD.newStoryboard(d.name);
    if (!SD.FRAME_RATIOS[d.ratio]) d.ratio = base.ratio;
    d.settings = Object.assign({}, base.settings, d.settings || {});
    d.sequences = Array.isArray(d.sequences) ? d.sequences : [];
    for (const s of d.sequences) {
      s.id = s.id || SD.uid();
      s.title = s.title || '';
      s.shots = (Array.isArray(s.shots) ? s.shots : []).map((x) => SD.newShot(x));
    }
    return d;
  };

  // Shot letters: A…Z, then AA, AB…
  SD.shotLetters = (i) => {
    let s = '';
    i += 1;
    while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
    return s;
  };

  // Number of each sequence: the scene number when linked to a script, its position otherwise.
  SD.storyboardNumbers = (project, d) => {
    const script = project.documents.find((x) => x.id === d.sourceId && x.kind === 'script');
    const sceneNo = new Map(script ? SD.getScenes(script).map((s) => [s.id, s.number]) : []);
    const out = new Map();
    d.sequences.forEach((s, i) => out.set(s.id, s.sceneId && sceneNo.has(s.sceneId) ? sceneNo.get(s.sceneId) : (s.number || i + 1)));
    return out;
  };

  SD.storyboardStats = (d) => {
    const shots = d.sequences.flatMap((s) => s.shots);
    return { sequences: d.sequences.length, shots: shots.length, seconds: shots.reduce((n, x) => n + (+x.duration || 0), 0), pictures: shots.filter((x) => x.image || x.drawing).length };
  };

  SD.formatSeconds = (sec) => {
    sec = Math.round(sec || 0);
    const m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + String(s).padStart(2, '0');
  };

  const sceneTitle = (script, scene) => (script.scriptType === 'comic' ? 'PAGE ' + scene.number + (scene.el.text ? ' — ' : '') : '') + (scene.el.text || '').toUpperCase();

  // One sequence per scene. Shots you made are kept; sequences whose scene was deleted stay, marked.
  SD.syncStoryboardFromScript = (project, d, script) => {
    d.sourceId = script.id;
    const scenes = SD.getScenes(script);
    const bySceneId = new Map(d.sequences.filter((s) => s.sceneId).map((s) => [s.sceneId, s]));
    const after = new Map();
    let anchor = null;
    for (const s of d.sequences) {
      if (s.sceneId) anchor = s.sceneId;
      else { if (!after.has(anchor)) after.set(anchor, []); after.get(anchor).push(s); }
    }
    const live = new Set(scenes.map((s) => s.id));
    const result = [...(after.get(null) || [])];
    let added = 0;
    for (const scene of scenes) {
      let s = bySceneId.get(scene.id);
      if (!s) { s = { id: SD.uid(), sceneId: scene.id, title: '', shots: [] }; added++; }
      delete s.orphan;
      if (!s.customTitle) s.title = sceneTitle(script, scene);
      s.number = scene.number;
      result.push(s, ...(after.get(scene.id) || []));
    }
    for (const s of d.sequences) if (s.sceneId && !live.has(s.sceneId)) { s.orphan = true; result.push(s); }
    for (const [k, list] of after) if (k && !live.has(k)) result.push(...list);
    d.sequences = [...new Set(result)];
    return { scenes: scenes.length, added };
  };

  // Suggest shots for a scene: one per action paragraph, plus a shot per speaker change.
  SD.draftShotsForScene = (script, sceneId) => {
    const scene = SD.getScenes(script).find((s) => s.id === sceneId);
    if (!scene) return [];
    const shots = [];
    const els = script.elements;
    let lastSpeaker = null;
    for (let i = scene.start + 1; i < scene.end; i++) {
      const e = els[i];
      const text = (e.text || '').trim();
      if (!text) continue;
      if (e.type === 'action' || e.type === 'panel' || e.type === 'shot') {
        shots.push(SD.newShot({ caption: text, shotType: shots.length ? '' : 'WS' }));
        lastSpeaker = null;
      } else if (e.type === 'character') {
        const who = SD.charName(text);
        if (who && who !== lastSpeaker) {
          const line = els[i + 1] && els[i + 1].type === 'parenthetical' ? els[i + 2] : els[i + 1];
          shots.push(SD.newShot({ caption: who + (line && line.text ? ': “' + line.text.trim() + '”' : ''), shotType: 'MCU', audio: line && line.text ? who + ': ' + line.text.trim() : '' }));
          lastSpeaker = who;
        }
      }
    }
    return shots;
  };
})();
