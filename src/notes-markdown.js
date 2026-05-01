// Minimal markdown for speaker notes: **bold**, *italic*, `code`, and
// `-` / `•` bullets with 2-space indent for nesting. Returns an HTML string;
// callers feed it to dangerouslySetInnerHTML.
const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const inline = (s) =>
  esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|\W)\*([^*]+)\*(?=\W|$)/g, '$1<i>$2</i>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

export function renderNotesMarkdown(src) {
  const lines = (src || '').split('\n');
  let html = '';
  let stack = [];
  let para = [];
  const flushPara = () => {
    if (para.length) {
      html += '<p>' + inline(para.join(' ')) + '</p>';
      para = [];
    }
  };
  const closeTo = (depth) => {
    while (stack.length > depth) {
      html += '</li></ul>';
      stack.pop();
    }
  };
  for (const raw of lines) {
    const m = raw.match(/^(\s*)[-•]\s+(.*)$/);
    if (m) {
      flushPara();
      const depth = Math.floor(m[1].length / 2) + 1;
      if (depth > stack.length) {
        html += '<ul>';
        stack.push(depth);
      } else {
        closeTo(depth);
        html += '</li>';
      }
      html += '<li>' + inline(m[2]);
    } else if (raw.trim() === '') {
      flushPara();
      closeTo(0);
    } else {
      if (stack.length) html += ' ' + inline(raw.trim());
      else para.push(raw.trim());
    }
  }
  flushPara();
  closeTo(0);
  return html;
}
