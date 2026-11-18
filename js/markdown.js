/* Scriptdesk — Markdown for notes: Markdown to safe HTML and back.
   Covers headings, paragraphs, bold, italic, underline (<u>), strike, code, links, lists, task lists, quotes, dividers and code blocks. */
(function () {
  'use strict';
  const SD = (window.SD = window.SD || {});
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ---------- Markdown -> HTML ----------
  function inline(src) {
    const keep = [];
    const hold = (html) => { keep.push(html); return '\x00' + (keep.length - 1) + '\x00'; };
    let t = String(src);
    t = t.replace(/`([^`]+)`/g, (m, c) => hold('<code>' + esc(c) + '</code>'));
    t = t.replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)/g, (m, txt, url) => hold('<a href="' + esc(url) + '">' + inline(txt) + '</a>'));
    t = t.replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/g, (m, url) => hold('<a href="' + esc(url) + '">' + esc(url) + '</a>'));
    t = t.replace(/<u>([\s\S]*?)<\/u>/gi, (m, x) => hold('<u>' + inline(x) + '</u>'));
    t = esc(t);
    t = t.replace(/\*\*([^*]+?)\*\*/g, '<b>$1</b>').replace(/(^|[^\w])__([^_]+?)__(?!\w)/g, '$1<b>$2</b>');
    t = t.replace(/(^|[^*\w])\*([^*\s](?:[^*]*?[^*\s])?)\*(?!\*)/g, '$1<i>$2</i>').replace(/(^|[^\w])_([^_\s](?:[^_]*?[^_\s])?)_(?!\w)/g, '$1<i>$2</i>');
    t = t.replace(/~~([^~]+?)~~/g, '<s>$1</s>');
    return t.replace(/\x00(\d+)\x00/g, (m, i) => keep[+i]);
  }

  SD.markdownToHtml = (md) => {
    const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let para = [];
    const flush = () => { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } };
    const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*```/.test(line)) {
        flush();
        const code = [];
        for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
        out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>');
        continue;
      }
      if (!line.trim()) { flush(); continue; }
      let m;
      if ((m = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) { flush(); const n = Math.min(3, m[1].length); out.push(`<h${n}>${inline(m[2])}</h${n}>`); continue; }
      if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push('<hr>'); continue; }
      if (/^\s*>/.test(line)) {
        flush();
        const q = [];
        for (; i < lines.length && /^\s*>/.test(lines[i]); i++) q.push(lines[i].replace(/^\s*>\s?/, ''));
        i--;
        out.push('<blockquote>' + SD.markdownToHtml(q.join('\n')) + '</blockquote>');
        continue;
      }
      if (LIST.test(line)) {
        flush();
        const items = [];
        for (; i < lines.length && (LIST.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length)); i++) items.push(lines[i]);
        i--;
        out.push(listHtml(items));
        continue;
      }
      para.push(line.replace(/\s{2,}$/, ''));
    }
    flush();
    return out.join('');
  };
  // nested lists by indentation
  function listHtml(lines) {
    const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
    const parse = (start, indent) => {
      let html = '', i = start, tag = null;
      while (i < lines.length) {
        const m = lines[i].match(LIST);
        if (!m) { i++; continue; }
        const ind = m[1].replace(/\t/g, '  ').length;
        if (ind < indent) break;
        if (ind > indent) { const sub = parse(i, ind); html = html.replace(/<\/li>$/, sub.html + '</li>'); i = sub.next; continue; }
        const kind = /\d/.test(m[2]) ? 'ol' : 'ul';
        if (!tag) { tag = kind; html += `<${tag}>`; }
        else if (kind !== tag) { html += `</${tag}><${kind}>`; tag = kind; }
        let text = m[3];
        const task = text.match(/^\[([ xX])\]\s+(.*)$/);
        if (task) text = (task[1] === ' ' ? '☐ ' : '☑ ') + task[2];
        html += '<li>' + inline(text) + '</li>';
        i++;
      }
      return { html: tag ? html + `</${tag}>` : html, next: i };
    };
    return parse(0, (lines[0].match(LIST) || ['', ''])[1].length).html;
  }

  // ---------- HTML -> Markdown ----------
  SD.htmlToMarkdown = (html) => {
    const doc = new DOMParser().parseFromString('<body>' + (html || '') + '</body>', 'text/html');
    const inl = (node) => {
      let s = '';
      for (const c of node.childNodes) {
        if (c.nodeType === 3) { s += c.data.replace(/\s+/g, ' '); continue; }
        if (c.nodeType !== 1) continue;
        const t = c.tagName, inner = inl(c);
        if (t === 'BR') s += '  \n';
        else if (t === 'B' || t === 'STRONG') s += wrapMark(inner, '**');
        else if (t === 'I' || t === 'EM') s += wrapMark(inner, '*');
        else if (t === 'S' || t === 'DEL' || t === 'STRIKE') s += wrapMark(inner, '~~');
        else if (t === 'U') s += inner.trim() ? '<u>' + inner + '</u>' : inner;
        else if (t === 'CODE') s += '`' + c.textContent + '`';
        else if (t === 'A') s += c.getAttribute('href') ? `[${inner}](${c.getAttribute('href')})` : inner;
        else s += inner;
      }
      return s;
    };
    const blocks = (node, depth = 0) => {
      const out = [];
      let run = '';
      const flushRun = () => { if (run.trim()) out.push(run.trim()); run = ''; };
      for (const c of node.childNodes) {
        if (c.nodeType === 3 || (c.nodeType === 1 && !/^(P|DIV|H[1-6]|UL|OL|BLOCKQUOTE|HR|PRE)$/.test(c.tagName))) { run += c.nodeType === 3 ? c.data.replace(/\s+/g, ' ') : c.tagName === 'BR' ? '  \n' : inl({ childNodes: [c] }); continue; }
        flushRun();
        const t = c.tagName;
        if (/^H[1-6]$/.test(t)) out.push('#'.repeat(Math.min(3, +t[1])) + ' ' + inl(c).trim());
        else if (t === 'HR') out.push('---');
        else if (t === 'PRE') out.push('```\n' + c.textContent.replace(/\n$/, '') + '\n```');
        else if (t === 'BLOCKQUOTE') out.push(blocks(c, depth).split('\n').map((l) => (l ? '> ' + l : '>')).join('\n'));
        else if (t === 'UL' || t === 'OL') out.push(listMd(c, 0));
        else { const inner = /^(DIV)$/.test(t) && [...c.children].some((x) => /^(P|DIV|H[1-6]|UL|OL|BLOCKQUOTE|HR|PRE)$/.test(x.tagName)) ? blocks(c, depth) : inl(c).trim(); if (inner) out.push(inner); }
      }
      flushRun();
      return out.join('\n\n');
    };
    const listMd = (list, indent) => {
      const lines = [];
      let n = 1;
      for (const li of list.children) {
        if (li.tagName !== 'LI') continue;
        const own = h0(li);
        let text = inl(own).trim();
        text = text.replace(/^☐\s*/, '[ ] ').replace(/^☑\s*/, '[x] ');
        lines.push(' '.repeat(indent) + (list.tagName === 'OL' ? n++ + '. ' : '- ') + text);
        for (const sub of li.children) if (sub.tagName === 'UL' || sub.tagName === 'OL') lines.push(listMd(sub, indent + 2));
      }
      return lines.join('\n');
    };
    // an <li> without its nested lists
    const h0 = (li) => { const c = li.cloneNode(true); c.querySelectorAll('ul, ol').forEach((x) => x.remove()); return c; };
    return blocks(doc.body).replace(/\n{3,}/g, '\n\n').trim() + '\n';
  };
  // **bold** around text, keeping spaces outside the markers
  function wrapMark(s, m) {
    if (!s.trim()) return s;
    const lead = s.match(/^\s*/)[0], trail = s.match(/\s*$/)[0];
    return lead + m + s.trim() + m + trail;
  }

  // Does pasted plain text look like Markdown?
  SD.looksLikeMarkdown = (t) => /^(#{1,6}\s|\s*[-*+]\s|\s*\d+[.)]\s|>\s|```|---\s*$)/m.test(t) || /\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(https?:|`[^`\n]+`/.test(t);
})();
