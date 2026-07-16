import type { KbApi, KnowledgeRelation } from '../api';
import { summarizeDiff } from '../diff';
import { escapeHtml, renderMarkdown } from '../markdown';
import type { DashboardState, SelectedRecord } from '../state';

const PRIMARY_META_FIELDS = ['id', 'tenantId', 'kind', 'title', 'confidence', 'freshnessStatus', 'updatedAt', 'createdAt', 'lastReviewedAt'];

export function recordsView(state: DashboardState, readOnly: boolean): string {
  const entities = (state.inspect?.summary?.entities ?? []).map((record) => ({ ...record, recordKind: 'entity' as const }));
  const sources = (state.inspect?.summary?.sources ?? []).map((record) => ({ ...record, recordKind: 'source' as const }));
  const records = [...entities, ...sources];
  const selected = state.selected;
  const query = state.recordSearch.trim().toLowerCase();
  const filtered = query ? records.filter((record) => [record.id, record.title, record.kind, record.recordKind].some((value) => value.toLowerCase().includes(query))) : records;
  const visible = filtered.slice(0, state.recordVisibleCount);
  return `
    <section class="workspace">
      <aside class="record-list" aria-label="Knowledge records">
        <div class="record-list-head">
          <h2>Records</h2>
          <small>${visible.length} / ${filtered.length}${query ? ` matching “${escapeHtml(state.recordSearch)}”` : ''}</small>
        </div>
        <input class="record-search" type="search" placeholder="Search records…" value="${escapeHtml(state.recordSearch)}" data-field="record-search" />
        ${records.length === 0 ? '<p class="empty">No entities or sources yet.</p>' : visible.map((record) => recordButton(record, selected)).join('')}
        ${filtered.length > visible.length ? `<button class="ghost load-more" data-action="load-more-records">Load ${Math.min(50, filtered.length - visible.length)} more</button>` : ''}
      </aside>
      <article class="editor-panel">
        ${selected && state.document ? editorMarkup(state, readOnly) : selected ? pendingRecordMarkup(state) : '<div class="empty large">Select an entity or source to inspect markdown, frontmatter, and connected links.</div>'}
      </article>
    </section>
  `;
}

function pendingRecordMarkup(state: DashboardState): string {
  const selected = state.selected;
  if (!selected) return '';
  return `<div class="empty large selected-pending">
    <div>
      <p class="eyebrow">${escapeHtml(selected.recordKind)} · ${escapeHtml(selected.kind)}</p>
      <h2>${escapeHtml(selected.title || selected.id)}</h2>
      <p class="record-id">${escapeHtml(selected.id)}</p>
      ${state.error ? `<div class="alert">${escapeHtml(state.error)}</div>` : '<p class="muted">Loading record detail…</p>'}
    </div>
  </div>`;
}

function recordButton(record: SelectedRecord, selected: SelectedRecord | null): string {
  const active = selected?.id === record.id && selected.recordKind === record.recordKind ? 'active' : '';
  return `<article class="record-row ${active}" tabindex="0" role="button" data-action="select-record" data-kind="${record.recordKind}" data-id="${escapeHtml(record.id)}" aria-label="Open ${escapeHtml(record.title || record.id)}">
    <span>${escapeHtml(record.title || record.id)}</span>
    <small>${record.recordKind} · ${escapeHtml(record.kind)}</small>
    <em class="record-open">Open</em>
  </article>`;
}

function editorMarkup(state: DashboardState, readOnly: boolean): string {
  const doc = state.document!;
  const dirty = doc.markdown !== state.draftMarkdown;
  const changes = summarizeDiff(doc.markdown, state.draftMarkdown);
  const meta = doc.parsed.meta ?? {};
  return `
    <div class="record-hero">
      <div>
        <p class="eyebrow">${doc.kind} · ${escapeHtml(String(meta.kind ?? state.selected?.kind ?? 'unknown'))}</p>
        <h2>${escapeHtml(String(meta.title ?? doc.id))}</h2>
        <p class="record-id">${escapeHtml(doc.id)}</p>
      </div>
      <div class="record-actions">
        ${statusPill('confidence', meta.confidence)}
        ${statusPill('freshness', meta.freshnessStatus)}
        <button class="primary" data-action="save-document" ${readOnly || !dirty ? 'disabled' : ''}>Save markdown</button>
      </div>
    </div>
    ${enrichedFrontmatter(meta)}
    ${doc.kind === 'entity' ? linkEntityForm(state, readOnly) : ''}
    ${interestingLinks(state)}
    ${doc.validationIssues.length ? `<div class="alert">${doc.validationIssues.map(escapeHtml).join('<br>')}</div>` : ''}
    ${dirty ? `<div class="diff"><strong>Pending changes</strong><ul>${changes.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul></div>` : ''}
    <div class="split-editor">
      <label>Raw markdown<textarea spellcheck="false" data-field="markdown">${escapeHtml(state.draftMarkdown)}</textarea></label>
      <div class="preview" aria-label="Markdown preview">${renderMarkdown(state.draftMarkdown)}</div>
    </div>
  `;
}

function statusPill(label: string, value: unknown): string {
  if (!value) return '';
  return `<span class="pill"><small>${escapeHtml(label)}</small>${escapeHtml(String(value))}</span>`;
}

function enrichedFrontmatter(meta: Record<string, unknown>): string {
  const primary = PRIMARY_META_FIELDS
    .filter((field) => meta[field] !== undefined && meta[field] !== null && meta[field] !== '')
    .map((field) => `<div><dt>${fieldLabel(field)}</dt><dd>${renderMetaValue(meta[field])}</dd></div>`)
    .join('');
  const chips = ['aliases', 'handles', 'tags', 'owners', 'sources', 'linkedEntities', 'authors', 'supersedes']
    .filter((field) => Array.isArray(meta[field]) && (meta[field] as unknown[]).length > 0)
    .map((field) => `<section class="chip-section"><h3>${fieldLabel(field)}</h3><div class="chips">${(meta[field] as unknown[]).map((value) => metaChip(field, value)).join('')}</div></section>`)
    .join('');
  const rest = Object.fromEntries(Object.entries(meta).filter(([field]) => !PRIMARY_META_FIELDS.includes(field) && !['aliases', 'handles', 'tags', 'owners', 'sources', 'linkedEntities', 'authors', 'supersedes'].includes(field)));
  return `
    <section class="frontmatter enriched">
      <div class="section-head"><h3>Frontmatter</h3><button class="ghost" data-action="toggle-raw-frontmatter">Raw</button></div>
      <dl class="record-meta-grid">${primary || '<div><dt>Status</dt><dd>No core frontmatter fields found.</dd></div>'}</dl>
      ${chips}
      <pre class="raw-frontmatter" hidden>${escapeHtml(JSON.stringify({ ...meta, ...rest }, null, 2))}</pre>
    </section>
  `;
}

function fieldLabel(field: string): string {
  return field.replace(/[A-Z]/g, (match) => ` ${match.toLowerCase()}`).replace(/^./, (match) => match.toUpperCase());
}

function renderMetaValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((entry) => escapeHtml(String(entry))).join(', ');
  if (typeof value === 'string' && /^https?:\/\//.test(value)) {
    return `<a href="${escapeHtml(value)}" target="_blank" rel="noreferrer">${escapeHtml(value)}</a>`;
  }
  return escapeHtml(String(value));
}

function metaChip(field: string, value: unknown): string {
  const text = String(value);
  const isRecordRef = ['sources', 'linkedEntities', 'supersedes'].includes(field);
  if (isRecordRef) {
    const kind = field === 'sources' ? 'source' : 'entity';
    return `<button class="chip linked" data-action="select-record" data-kind="${kind}" data-id="${escapeHtml(text)}">${escapeHtml(text)}</button>`;
  }
  return `<span class="chip">${escapeHtml(text)}</span>`;
}

function linkEntityForm(state: DashboardState, readOnly: boolean): string {
  const currentId = state.document?.id ?? '';
  const entities = (state.inspect?.summary?.entities ?? []).filter((entity) => entity.id !== currentId);
  return `
    <section class="link-entity-panel">
      <div class="section-head"><h3>Link this entity</h3><p class="muted">Create an explicit graph relation from this entity to another entity.</p></div>
      <div class="link-entity-form">
        <input data-field="relation-type" placeholder="relation type" value="related_to" ${readOnly ? 'disabled' : ''} />
        <input data-field="relation-target" list="entity-id-options" placeholder="target entity id" ${readOnly ? 'disabled' : ''} />
        <input data-field="relation-sources" placeholder="source ids, comma-separated optional" ${readOnly ? 'disabled' : ''} />
        <button class="primary" data-action="link-selected-entity" ${readOnly ? 'disabled' : ''}>Add link</button>
      </div>
      <datalist id="entity-id-options">${entities.map((entity) => `<option value="${escapeHtml(entity.id)}">${escapeHtml(entity.title || entity.id)}</option>`).join('')}</datalist>
    </section>
  `;
}

function interestingLinks(state: DashboardState): string {
  const recordId = state.selected?.id ?? '';
  const outgoing = state.selectedRelations.filter((relation) => relation.fromId === recordId).slice(0, 10);
  const incoming = state.selectedRelations.filter((relation) => relation.toId === recordId).slice(0, 10);
  const undirected = state.selectedRelations.filter((relation) => relation.fromId !== recordId && relation.toId !== recordId).slice(0, 10);
  const links = state.selectedLinks.slice(0, 10);
  const related = state.selectedRelated.slice(0, 8);
  const sourceRefs = Array.isArray(state.document?.parsed.meta?.sources) ? state.document?.parsed.meta?.sources as string[] : [];
  const linkedEntities = Array.isArray(state.document?.parsed.meta?.linkedEntities) ? state.document?.parsed.meta?.linkedEntities as string[] : [];
  const hasAnything = outgoing.length || incoming.length || undirected.length || links.length || related.length || sourceRefs.length || linkedEntities.length;
  return `
    <section class="interesting-links ${hasAnything ? '' : 'is-empty'}">
      <div class="section-head"><h3>Interesting links</h3><p class="muted">Direct references, graph edges, and nearby records for ${escapeHtml(recordId)}.</p></div>
      ${hasAnything ? `
        <div class="link-columns">
          ${referenceColumn('Sources', sourceRefs, 'source')}
          ${referenceColumn('Linked entities', linkedEntities, 'entity')}
          ${edgeColumn('Links to', outgoing, recordId)}
          ${edgeColumn('Linked from', incoming, recordId)}
          ${edgeColumn('Other matching edges', undirected, recordId)}
          ${edgeColumn('Materialized links', links, recordId)}
          ${relatedColumn('Related', related)}
        </div>
      ` : '<p class="empty">No graph edges or frontmatter references yet.</p>'}
    </section>
  `;
}

function referenceColumn(title: string, ids: string[], kind: 'entity' | 'source'): string {
  if (ids.length === 0) return '';
  return `<div class="link-column"><h4>${escapeHtml(title)}</h4>${ids.slice(0, 12).map((id) => `<button class="link-card" data-action="select-record" data-kind="${kind}" data-id="${escapeHtml(id)}">${escapeHtml(id)}</button>`).join('')}</div>`;
}

function edgeColumn(title: string, edges: KnowledgeRelation[], selectedId?: string): string {
  if (edges.length === 0) return '';
  return `<div class="link-column"><h4>${escapeHtml(title)}</h4>${edges.map((edge) => `
    <article class="link-card edge-card">
      <strong>${escapeHtml(edge.type)}</strong>
      <span>${edgeEndpoint(edge.fromId, selectedId)} <em>→</em> ${edgeEndpoint(edge.toId, selectedId)}</span>
      <small>${escapeHtml(edge.originKind ?? 'origin')} ${escapeHtml(edge.originId ?? '')}${edge.evidenceKind ? ` · ${escapeHtml(edge.evidenceKind)}` : ''}${edge.confidence ? ` · ${edge.confidence}` : ''}</small>
    </article>
  `).join('')}</div>`;
}

function edgeEndpoint(id: string, selectedId?: string): string {
  if (id === selectedId) return `<b class="edge-self">${escapeHtml(id)}</b>`;
  return `<button data-action="select-record" data-kind="entity" data-id="${escapeHtml(id)}">${escapeHtml(id)}</button>`;
}

function relatedColumn(title: string, entries: unknown[]): string {
  if (entries.length === 0) return '';
  return `<div class="link-column"><h4>${escapeHtml(title)}</h4>${entries.map((entry) => {
    const value = entry && typeof entry === 'object' ? entry as Record<string, unknown> : { id: String(entry) };
    const id = String(value.id ?? value.entityId ?? value.title ?? 'related');
    const kind = String(value.kind ?? 'entity') === 'source' ? 'source' : 'entity';
    return `<button class="link-card" data-action="select-record" data-kind="${kind}" data-id="${escapeHtml(id)}"><strong>${escapeHtml(String(value.title ?? id))}</strong><small>${escapeHtml(String(value.reason ?? value.kind ?? 'related'))}</small></button>`;
  }).join('')}</div>`;
}

export async function selectRecord(api: KbApi, state: DashboardState, kind: 'entity' | 'source', id: string): Promise<void> {
  const records = kind === 'entity' ? state.inspect?.summary?.entities ?? [] : state.inspect?.summary?.sources ?? [];
  const summary = records.find((record) => record.id === id);
  state.selected = summary ? { ...summary, recordKind: kind } : { id, title: id, kind: 'unknown', recordKind: kind };
  state.document = await api.document(kind, id);
  state.draftMarkdown = state.document.markdown;

  if (kind === 'entity') {
    const [relations, links, related] = await Promise.allSettled([api.entityRelations(id), api.entityLinks(id), api.entityRelated(id)]);
    state.selectedRelations = relations.status === 'fulfilled' ? relations.value : [];
    state.selectedLinks = links.status === 'fulfilled' ? links.value : [];
    state.selectedRelated = related.status === 'fulfilled' ? related.value : [];
  } else {
    state.selectedRelations = state.relations.filter((relation) => relation.originId === id || relation.sourceIds?.includes(id));
    state.selectedLinks = [];
    state.selectedRelated = [];
  }
}
