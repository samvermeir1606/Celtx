/* Scriptdesk — touch support: press and hold anything draggable, then move your finger to drag it.
   Phones and tablets don't reliably send HTML drag-and-drop events, so this sends them for us. */
(function () {
  'use strict';
  const HOLD_MS = 320, SLOP = 10;
  let pending = null, drag = null;

  const fire = (target, type, x, y, dt) => {
    if (!target) return false;
    const ev = new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt });
    target.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  const under = (x, y) => {
    if (drag && drag.ghost) drag.ghost.style.display = 'none';
    const el = document.elementFromPoint(x, y);
    if (drag && drag.ghost) drag.ghost.style.display = '';
    return el;
  };

  function begin() {
    const { src, x, y } = pending;
    pending = null;
    let dt;
    try { dt = new DataTransfer(); } catch (e) { return; }
    const r = src.getBoundingClientRect();
    const ghost = src.cloneNode(true);
    ghost.classList.add('touch-ghost');
    Object.assign(ghost.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', pointerEvents: 'none', zIndex: 1000, opacity: '0.85', transform: 'scale(1.03)' });
    document.body.append(ghost);
    drag = { src, dt, ghost, dx: x - r.left, dy: y - r.top, over: null, ok: false };
    fire(src, 'dragstart', x, y, dt);
    if (navigator.vibrate) navigator.vibrate(12);
  }

  function move(x, y) {
    drag.ghost.style.left = x - drag.dx + 'px';
    drag.ghost.style.top = y - drag.dy + 'px';
    const t = under(x, y);
    if (t !== drag.over) { if (drag.over) fire(drag.over, 'dragleave', x, y, drag.dt); if (t) fire(t, 'dragenter', x, y, drag.dt); drag.over = t; }
    drag.ok = fire(t, 'dragover', x, y, drag.dt);
    // scroll the nearest scrolling box near its edges
    const sc = t && t.closest('.bb-board, .ss-board, .sb-canvas, .view-scroll, #doc-list, .side-section, .bb-cards, .ss-strips');
    if (sc) {
      const b = sc.getBoundingClientRect();
      if (y < b.top + 40) sc.scrollTop -= 12; else if (y > b.bottom - 40) sc.scrollTop += 12;
      if (x < b.left + 40) sc.scrollLeft -= 12; else if (x > b.right - 40) sc.scrollLeft += 12;
    }
  }

  function end(x, y) {
    const d = drag;
    drag = null;
    const t = under(x, y);
    if (d.ok && t) fire(t, 'drop', x, y, d.dt);
    fire(d.src, 'dragend', x, y, d.dt);
    d.ghost.remove();
  }

  document.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { pending = null; return; }
    const t = e.target;
    if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
    const src = t.closest('[draggable="true"]');
    if (!src) return;
    const p = e.touches[0];
    pending = { src, x: p.clientX, y: p.clientY, timer: setTimeout(() => { if (pending) begin(); }, HOLD_MS) };
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    const p = e.touches[0];
    if (drag) { e.preventDefault(); move(p.clientX, p.clientY); return; }
    if (pending && Math.hypot(p.clientX - pending.x, p.clientY - pending.y) > SLOP) { clearTimeout(pending.timer); pending = null; }
  }, { passive: false });

  document.addEventListener('touchend', (e) => {
    if (pending) { clearTimeout(pending.timer); pending = null; }
    if (drag) { e.preventDefault(); const p = e.changedTouches[0]; end(p.clientX, p.clientY); }
  }, { passive: false });
  document.addEventListener('touchcancel', () => { if (pending) { clearTimeout(pending.timer); pending = null; } if (drag) { fire(drag.src, 'dragend', 0, 0, drag.dt); drag.ghost.remove(); drag = null; } });
  // a long press would otherwise open the browser's context menu on the item
  document.addEventListener('contextmenu', (e) => { if (drag || (pending && e.target.closest('[draggable="true"]'))) e.preventDefault(); });
  if (matchMedia('(pointer: coarse)').matches) document.documentElement.classList.add('touch');
})();
