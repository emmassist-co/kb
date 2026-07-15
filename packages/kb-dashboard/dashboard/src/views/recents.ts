import { escapeHtml } from '../markdown';
import type { DashboardState } from '../state';

export function recentsView(state: DashboardState): string {
  const events = [...state.events].sort((left, right) => String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? ''))).slice(0, 50);
  return `
    <section class="panel">
      <div class="section-head"><h2>Recent activity</h2><p class="muted">Events and write traces are read-only here. Entity and source references open their record details.</p></div>
      ${events.length === 0 ? '<p class="empty">No events recorded yet.</p>' : events.map((event) => `
        <article class="event-row">
          <time>${escapeHtml(event.createdAt ?? 'unknown time')}</time>
          <strong>${escapeHtml(event.summary ?? event.id ?? 'event')}</strong>
          ${eventReferences(event.entityIds ?? [], event.sourceIds ?? [])}
        </article>
      `).join('')}
    </section>
  `;
}

function eventReferences(entityIds: string[], sourceIds: string[]): string {
  if (entityIds.length === 0 && sourceIds.length === 0) return '<small>No linked records</small>';
  return `<div class="event-links">
    ${entityIds.map((id) => `<button class="chip linked" data-action="select-record" data-kind="entity" data-id="${escapeHtml(id)}">${escapeHtml(id)}</button>`).join('')}
    ${sourceIds.map((id) => `<button class="chip linked" data-action="select-record" data-kind="source" data-id="${escapeHtml(id)}">${escapeHtml(id)}</button>`).join('')}
  </div>`;
}
