export function renderMarkdown(markdown: string): string {
  return markdown
    .split(/\n{2,}/)
    .map((block) => renderBlock(block.trim()))
    .join('');
}

function renderBlock(block: string): string {
  if (!block) return '';
  const heading = /^(#{1,3})\s+(.+)$/.exec(block);
  if (heading) {
    const level = heading[1].length;
    return `<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`;
  }
  if (block.split('\n').every((line) => /^[-*]\s+/.test(line))) {
    const items = block.split('\n').map((line) => `<li>${renderInlineMarkdown(line.replace(/^[-*]\s+/, ''))}</li>`).join('');
    return `<ul>${items}</ul>`;
  }
  return `<p>${renderInlineMarkdown(block).replace(/\n/g, '<br>')}</p>`;
}

function renderInlineMarkdown(value: string): string {
  const pattern = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let cursor = 0;
  let html = '';
  for (const match of value.matchAll(pattern)) {
    html += escapeHtml(value.slice(cursor, match.index));
    const id = match[1].trim();
    const label = (match[2] ?? id).trim();
    html += renderWikiLink(id, label);
    cursor = (match.index ?? 0) + match[0].length;
  }
  html += escapeHtml(value.slice(cursor));
  return html;
}

function renderWikiLink(id: string, label: string): string {
  const kind = inferWikiLinkKind(id);
  return `<button class="wiki-link" data-action="select-record" data-kind="${kind}" data-id="${escapeHtml(id)}">${escapeHtml(label)}</button>`;
}

function inferWikiLinkKind(id: string): 'entity' | 'source' {
  return /^(src|source)[_-]/i.test(id) ? 'source' : 'entity';
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
