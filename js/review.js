/* Scriptdesk — review copy: one self-contained HTML file that a reader opens in any browser to comment on a script */
(function () {
  'use strict';
  const SD = (window.SD = window.SD || {});

  // Everything below runs inside the review copy, not in Scriptdesk.
  function viewer() {
    var data = JSON.parse(document.getElementById('sd-data').textContent);
    var KEY = 'scriptdesk-review:' + data.docId + ':' + data.created;
    var st = { name: '', comments: [] };
    try { var saved = JSON.parse(localStorage.getItem(KEY) || 'null'); if (saved) st = saved; } catch (e) { /* private window */ }
    var save = function () { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* not kept */ } };
    var $ = function (s) { return document.querySelector(s); };
    var el = function (tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    var uid = function () { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); };

    // the script
    var page = $('#sd-script');
    page.dataset.scriptType = data.scriptType;
    if (data.sceneNumbers) page.classList.add('scene-numbers');
    var fill = function (node, text, fmt) {
      if (!fmt || !fmt.length) { node.textContent = text; return; }
      var cuts = [0, text.length];
      fmt.forEach(function (r) { cuts.push(Math.min(r[0], text.length), Math.min(r[1], text.length)); });
      cuts = cuts.filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a, b) { return a - b; });
      for (var k = 0; k < cuts.length - 1; k++) {
        var t = text.slice(cuts[k], cuts[k + 1]), f = 0;
        fmt.forEach(function (r) { if (r[0] <= cuts[k] && cuts[k] < r[1]) f = r[2]; });
        var n = document.createTextNode(t);
        [[4, 'u'], [2, 'i'], [1, 'b']].forEach(function (x) { if (f & x[0]) { var w = document.createElement(x[1]); w.appendChild(n); n = w; } });
        node.appendChild(n);
      }
    };
    var mk = function (e) {
      var d = el('div', 'el' + (e.text ? '' : ' is-empty'));
      d.dataset.type = e.type; d.dataset.id = e.id;
      if (e.text) fill(d, e.text, e.fmt); else d.textContent = String.fromCharCode(160);
      return d;
    };
    var speechEnd = function (i) { var k = i + 1; while (k < data.elements.length && /^(parenthetical|dialogue)$/.test(data.elements[k].type)) k++; return k; };
    for (var i = 0; i < data.elements.length; i++) {
      var e = data.elements[i];
      if (e.type === 'character') {
        var j = speechEnd(i), n2 = data.elements[j];
        if (n2 && n2.type === 'character' && n2.dual) {
          var k2 = speechEnd(j), pair = el('div', 'dual-pair');
          [data.elements.slice(i, j), data.elements.slice(j, k2)].forEach(function (col) { var c = el('div', 'dual-col'); col.forEach(function (x) { c.appendChild(mk(x)); }); pair.appendChild(c); });
          page.appendChild(pair);
          i = k2 - 1;
          continue;
        }
      }
      page.appendChild(mk(e));
    }
    var tp = data.titlePage || {};
    $('#sd-title').textContent = tp.title || data.docName;
    $('#sd-by').textContent = [tp.credit, tp.author].filter(Boolean).join(' ');
    if (data.message) { $('#sd-msg').textContent = data.message; $('#sd-msg').hidden = false; }

    // where a selection sits: element and character offsets
    var blockOf = function (n) { while (n && !(n.dataset && n.dataset.id)) n = n.parentNode; return n; };
    var offsetIn = function (b, node, off) { var r = document.createRange(); r.selectNodeContents(b); try { r.setEnd(node, off); } catch (e) { return 0; } return r.toString().length; };
    var rangeIn = function (b, s, e) {
      var r = document.createRange(), w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT), n, pos = 0, ok = false;
      while ((n = w.nextNode())) { var len = n.length; if (!ok && s <= pos + len) { r.setStart(n, s - pos); ok = true; } if (ok && e <= pos + len) { r.setEnd(n, e - pos); return r; } pos += len; }
      return null;
    };

    var fab = $('#sd-add');
    var pending = null;
    document.addEventListener('selectionchange', function () {
      var sel = getSelection();
      if (!sel.rangeCount || sel.isCollapsed) { if (!$('#sd-form').contains(document.activeElement)) fab.hidden = true; return; }
      var r = sel.getRangeAt(0), b = blockOf(r.startContainer);
      if (!b || !page.contains(b)) { fab.hidden = true; return; }
      var z = blockOf(r.endContainer);
      var s = offsetIn(b, r.startContainer, r.startOffset), e = z === b ? offsetIn(b, r.endContainer, r.endOffset) : b.textContent.length;
      pending = { elId: b.dataset.id, start: s, end: e, quote: b.textContent.slice(s, e) };
      var rect = r.getBoundingClientRect();
      fab.style.top = (window.scrollY + rect.bottom + 6) + 'px';
      fab.style.left = Math.max(8, Math.min(window.innerWidth - 140, rect.left)) + 'px';
      fab.hidden = false;
    });
    page.addEventListener('click', function (ev) {
      var b = blockOf(ev.target);
      if (!b || !getSelection().isCollapsed) return;
      pending = { elId: b.dataset.id, start: 0, end: 0, quote: '' };
      fab.style.top = (window.scrollY + b.getBoundingClientRect().bottom + 6) + 'px';
      fab.style.left = Math.max(8, b.getBoundingClientRect().left) + 'px';
      fab.hidden = false;
    });
    fab.addEventListener('mousedown', function (e) { e.preventDefault(); });
    fab.addEventListener('click', function () { openForm(pending); });

    var form = $('#sd-form'), ta = $('#sd-text'), editing = null;
    var openForm = function (p, existing) {
      if (!p) return;
      editing = existing || null;
      pending = p;
      $('#sd-quote').textContent = p.quote ? '“' + p.quote + '”' : 'On this line';
      ta.value = existing ? existing.text : '';
      form.hidden = false; fab.hidden = true;
      setTimeout(function () { ta.focus(); }, 10);
    };
    $('#sd-cancel').onclick = function () { form.hidden = true; };
    $('#sd-save').onclick = function () {
      var t = ta.value.trim();
      if (!t) { form.hidden = true; return; }
      if (editing) editing.text = t;
      else st.comments.push({ id: uid(), elId: pending.elId, start: pending.start, end: pending.end, quote: pending.quote, text: t, created: new Date().toISOString() });
      save(); form.hidden = true; getSelection().removeAllRanges(); draw();
    };
    ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('#sd-save').click(); if (e.key === 'Escape') form.hidden = true; });

    var nameIn = $('#sd-name');
    nameIn.value = st.name || '';
    nameIn.oninput = function () { st.name = nameIn.value; save(); };

    var order = {};
    data.elements.forEach(function (e, i) { order[e.id] = i; });
    var draw = function () {
      var list = $('#sd-list');
      list.textContent = '';
      document.querySelectorAll('.el.has-c').forEach(function (n) { n.classList.remove('has-c'); });
      var items = st.comments.slice().sort(function (a, b) { return (order[a.elId] - order[b.elId]) || a.start - b.start; });
      $('#sd-count').textContent = items.length ? items.length + ' comment' + (items.length === 1 ? '' : 's') : 'No comments yet';
      var ranges = [];
      items.forEach(function (c) {
        var b = page.querySelector('[data-id="' + c.elId + '"]');
        if (b) { b.classList.add('has-c'); var r = c.quote && rangeIn(b, c.start, c.end); if (r) ranges.push(r); }
        var card = el('div', 'card');
        var where = el('button', 'where', c.quote ? '“' + c.quote.slice(0, 70) + (c.quote.length > 70 ? '…' : '') + '”' : (b ? b.textContent.slice(0, 50) : 'line'));
        where.onclick = function () { if (b) b.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
        card.appendChild(where);
        card.appendChild(el('div', 'text', c.text));
        var row = el('div', 'row');
        var ed = el('button', 'link', 'Edit'); ed.onclick = function () { openForm({ elId: c.elId, start: c.start, end: c.end, quote: c.quote }, c); };
        var del = el('button', 'link', 'Delete'); del.onclick = function () { if (confirm('Delete this comment?')) { st.comments = st.comments.filter(function (x) { return x !== c; }); save(); draw(); } };
        row.appendChild(ed); row.appendChild(del);
        card.appendChild(row);
        list.appendChild(card);
      });
      try { if (window.CSS && CSS.highlights) { if (ranges.length) CSS.highlights.set('rc', new Highlight(...ranges)); else CSS.highlights.delete('rc'); } } catch (e) { /* older browser */ }
    };
    draw();

    $('#sd-send').onclick = function () {
      if (!st.comments.length) { alert('Add a comment first: select words in the script, or click a line.'); return; }
      if (!st.name.trim()) { var n = prompt('Your name, so the writer knows who the comments are from:', ''); if (n == null) return; st.name = n.trim(); nameIn.value = st.name; save(); }
      var out = { app: 'scriptdesk-review-comments', version: 1, docId: data.docId, docName: data.docName, project: data.project, reviewer: st.name || 'Reader', sent: new Date().toISOString(), comments: st.comments };
      var blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (data.docName + ' - comments from ' + (st.name || 'reader')).replace(/[\\/:*?"<>|]+/g, '-') + '.scriptdesk-review';
      document.body.appendChild(a); a.click(); a.remove();
      $('#sd-sent').hidden = false;
    };
  }

  const STYLE = `
:root { --paper: #fff; --paper-text: #111; --paper-muted: #777; --accent: #a8432c; --bg: #ece8e1; --panel: #f8f6f2; --border: #dbd5ca; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: #24211c; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
.wrap { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 0; min-height: 100vh; }
.paper { width: 8.5in; max-width: calc(100% - 24px); margin: 24px auto 80px; background: var(--paper); padding: 1in 1in 1in 1.5in; box-shadow: 0 8px 28px rgba(0,0,0,.08); }
.head { text-align: center; margin-bottom: 0.5in; font-family: "Courier Prime", "Courier New", monospace; }
.head h1 { font-size: 14pt; text-transform: uppercase; text-decoration: underline; margin: 0 0 6px; }
.msg { background: #fff7e0; border: 1px solid #f1d58a; border-radius: 8px; padding: 10px 12px; margin: 0 0 0.4in; font: 13px/1.45 system-ui, sans-serif; white-space: pre-wrap; }
.el { cursor: text; }
.el.has-c { background: rgba(255, 197, 61, .18); }
::highlight(rc) { background: rgba(255, 190, 40, .5); }
aside { position: sticky; top: 0; height: 100vh; overflow-y: auto; background: var(--panel); border-left: 1px solid var(--border); padding: 16px; }
aside h2 { font-size: 15px; margin: 0 0 4px; }
.muted { color: #736c60; font-size: 12.5px; }
input, textarea { width: 100%; font: inherit; padding: 7px 9px; border: 1px solid var(--border); border-radius: 7px; background: #fff; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 34px; padding: 0 14px; border-radius: 8px; border: 1px solid var(--border); background: #fff; cursor: pointer; font: 600 13px system-ui, sans-serif; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; width: 100%; margin: 10px 0 4px; }
#sd-add { position: absolute; z-index: 5; box-shadow: 0 4px 14px rgba(0,0,0,.18); }
#sd-form { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); width: min(520px, calc(100% - 24px)); background: #fff; border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 16px 40px rgba(0,0,0,.2); padding: 12px; z-index: 6; }
#sd-quote { font: italic 12px/1.4 "Courier Prime", monospace; color: #736c60; margin-bottom: 6px; }
.row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 6px; }
.card { background: #fff; border: 1px solid var(--border); border-left: 3px solid #e8a33d; border-radius: 8px; padding: 8px; margin: 8px 0; }
.where { border: 0; background: none; padding: 0; font: italic 12px/1.35 "Courier Prime", monospace; color: #736c60; text-align: left; cursor: pointer; }
.card .text { margin: 4px 0; white-space: pre-wrap; }
.link { border: 0; background: none; color: var(--accent); cursor: pointer; font-size: 12px; padding: 0; }
.sent { background: #e6f4ea; border: 1px solid #a7d7b5; border-radius: 8px; padding: 8px 10px; font-size: 12.5px; }
[hidden] { display: none !important; }
@media (max-width: 900px) { .wrap { grid-template-columns: 1fr; } aside { position: static; height: auto; border-left: 0; border-top: 1px solid var(--border); } .paper { padding: 0.5in 0.4in; } }
@media print { aside, #sd-add, #sd-form { display: none !important; } .wrap { display: block; } .paper { box-shadow: none; margin: 0; } }
`;

  SD.reviewCopyHTML = (data, scriptCss) => {
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const bs = String.fromCharCode(92); // a backslash, so '<' and line separators cannot end the script tag early
    const json = JSON.stringify(data).replace(/</g, bs + 'u003c').replace(new RegExp(String.fromCharCode(0x2028), 'g'), bs + 'u2028').replace(new RegExp(String.fromCharCode(0x2029), 'g'), bs + 'u2029');
    // keep only the screen rules of the script stylesheet
    const css = String(scriptCss || '').replace(/@media print\s*\{[\s\S]*$/, '');
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc((data.titlePage && data.titlePage.title) || data.docName)} — review copy</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Courier+Prime:ital,wght@0,400;0,700;1,400;1,700&display=swap">
<style>${css}
${STYLE}</style></head>
<body>
<div class="wrap">
  <main><div class="paper">
    <div class="head"><h1 id="sd-title"></h1><div id="sd-by"></div></div>
    <div class="msg" id="sd-msg" hidden></div>
    <div id="sd-script" class="script-text"></div>
  </div></main>
  <aside>
    <h2>Your comments</h2>
    <p class="muted">Select words in the script (or click a line) and press “Comment”. Your comments are kept in this browser until you send them.</p>
    <label class="muted">Your name</label>
    <input id="sd-name" placeholder="Your name">
    <button class="btn primary" id="sd-send">Download comments for the writer</button>
    <p class="muted">Then send the downloaded file back to the writer (by e-mail, chat…).</p>
    <div class="sent" id="sd-sent" hidden>Downloaded. Send that file to the writer. You can keep commenting and download again.</div>
    <p class="muted" id="sd-count"></p>
    <div id="sd-list"></div>
    <p class="muted" style="margin-top:20px">Made with Scriptdesk.</p>
  </aside>
</div>
<button class="btn" id="sd-add" hidden>💬 Comment</button>
<div id="sd-form" hidden><div id="sd-quote"></div><textarea id="sd-text" rows="3" placeholder="Your comment (Ctrl+Enter to save)"></textarea>
<div class="row"><button class="btn" id="sd-cancel">Cancel</button><button class="btn" id="sd-save" style="background:#a8432c;color:#fff;border-color:#a8432c">Save comment</button></div></div>
<script type="application/json" id="sd-data">${json}</script>
<script>(${viewer.toString()})();</script>
</body></html>`;
  };
})();
