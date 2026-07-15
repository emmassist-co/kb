import { escapeHtml, renderMarkdown } from '../markdown';
import type { DashboardState } from '../state';

export function graphView(state: DashboardState): string {
  const focusedId = state.selected?.id;
  const selectedId = state.graphPreviewDocument?.id ?? focusedId;
  const relations = focusedId
    ? state.relations.filter((relation) => relation.fromId === focusedId || relation.toId === focusedId)
    : state.relations;
  const capped = relations.slice(0, 160);
  const allEntities = state.inspect?.summary?.entities ?? [];
  const graphNodes = focusedId
    ? allEntities.filter((entity) => entity.id === focusedId || capped.some((relation) => relation.fromId === entity.id || relation.toId === entity.id))
    : allEntities;
  return `
    <section class="graph-layout">
      <div class="panel graph-panel">
        <div class="section-head">
          <div><h2>Graph map</h2><p class="muted">${focusedId ? `Focused on ${escapeHtml(focusedId)}` : selectedId ? `Selected ${escapeHtml(selectedId)} in the global graph` : 'Global force-directed relation map. Click a node to preview it; double-click to open full details.'}</p></div>
          ${focusedId ? '<button class="ghost" data-action="graph-show-global">Show global graph</button>' : '<span class="health-badge ok">Global graph</span>'}
        </div>
        ${relations.length > capped.length ? `<p class="alert">Showing first ${capped.length} of ${relations.length} relations.</p>` : ''}
        <div class="graph-map" data-graph='${escapeHtml(JSON.stringify(capped))}' data-nodes='${escapeHtml(JSON.stringify(graphNodes))}' data-selected-id="${escapeHtml(selectedId ?? '')}">
          ${graphNodes.length === 0 ? '<p class="empty large">No entities to map yet.</p>' : '<svg role="img" aria-label="Knowledge graph map"></svg>'}
        </div>
        <div class="graph-legend"><span><i class="legend-node"></i> entity</span><span><i class="legend-link"></i> relation</span><span>${graphNodes.length} entities · ${capped.length} edges · isolated entities are shown as standalone points</span><span>Click preview · double-click open · drag nodes · scroll zoom</span></div>
      </div>
      ${graphPreview(state)}
    </section>
  `;
}

function graphPreview(state: DashboardState): string {
  const doc = state.graphPreviewDocument;
  if (!doc) {
    return `
      <aside class="graph-preview panel">
        <div class="empty large">Click an entity node to preview its frontmatter, links, and markdown excerpt here.</div>
      </aside>
    `;
  }
  const meta = doc.parsed.meta ?? {};
  const title = String(meta.title ?? doc.id);
  const relationCount = state.graphPreviewRelations.length;
  return `
    <aside class="graph-preview panel">
      <div class="graph-preview-head">
        <p class="eyebrow">${escapeHtml(String(meta.kind ?? doc.kind))}</p>
        <h2>${escapeHtml(title)}</h2>
        <p class="record-id">${escapeHtml(doc.id)}</p>
        <button class="primary" data-action="select-record" data-kind="entity" data-id="${escapeHtml(doc.id)}">Open full detail</button>
      </div>
      <dl class="preview-meta">
        ${meta.confidence ? `<div><dt>Confidence</dt><dd>${escapeHtml(String(meta.confidence))}</dd></div>` : ''}
        ${meta.freshnessStatus ? `<div><dt>Freshness</dt><dd>${escapeHtml(String(meta.freshnessStatus))}</dd></div>` : ''}
        <div><dt>Relations</dt><dd>${relationCount}</dd></div>
      </dl>
      ${previewChips('Sources', meta.sources, 'source')}
      ${previewChips('Linked entities', meta.linkedEntities, 'entity')}
      ${state.graphPreviewRelations.length ? `<section class="preview-relations"><h3>Nearby edges</h3>${state.graphPreviewRelations.slice(0, 8).map((relation) => `<article><strong>${escapeHtml(relation.type)}</strong><span><button data-action="graph-preview-record" data-id="${escapeHtml(relation.fromId)}">${escapeHtml(relation.fromId)}</button> → <button data-action="graph-preview-record" data-id="${escapeHtml(relation.toId)}">${escapeHtml(relation.toId)}</button></span></article>`).join('')}</section>` : ''}
      <section class="preview-excerpt"><h3>Markdown preview</h3>${renderMarkdown(markdownExcerpt(doc.markdown))}</section>
    </aside>
  `;
}

function previewChips(title: string, value: unknown, kind: 'entity' | 'source'): string {
  if (!Array.isArray(value) || value.length === 0) return '';
  return `<section class="chip-section"><h3>${escapeHtml(title)}</h3><div class="chips">${value.slice(0, 10).map((id) => `<button class="chip linked" data-action="select-record" data-kind="${kind}" data-id="${escapeHtml(String(id))}">${escapeHtml(String(id))}</button>`).join('')}</div></section>`;
}

function markdownExcerpt(markdown: string): string {
  const withoutFrontmatter = markdown.replace(/^---[\s\S]*?---\s*/, '').trim();
  return withoutFrontmatter.length > 1200 ? `${withoutFrontmatter.slice(0, 1200)}\n\n…` : withoutFrontmatter;
}
