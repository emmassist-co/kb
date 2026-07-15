import type { DashboardState } from '../state';
import { escapeHtml } from '../markdown';

type DoctorDetail = {
  code?: string;
  severity?: string;
  message?: string;
  entityId?: string;
  sourceId?: string;
  path?: string;
  nextAction?: string;
  [key: string]: unknown;
};

type DoctorReport = {
  ok?: boolean;
  issues?: string[];
  details?: DoctorDetail[];
  warning?: string;
  [key: string]: unknown;
};

export function inventoryView(state: DashboardState): string {
  const summary = state.inspect?.summary;
  const doctor = normalizeDoctor(state.doctor);
  const cards = [
    ['Entities', summary?.entities.length ?? 0],
    ['Sources', summary?.sources.length ?? 0],
    ['Link types', summary?.links.length ?? 0],
    ['Events', state.events.length]
  ];
  return `
    <section class="hero-panel">
      <div>
        <p class="eyebrow">${escapeHtml(state.inspect?.workspaceRole ?? 'local-development')}</p>
        <h1>KB Dashboard</h1>
        <p class="muted">Inspect local knowledge, review graph shape, and edit supported markdown documents from the browser.</p>
      </div>
      <dl class="meta-grid">
        <div><dt>Workspace</dt><dd>${escapeHtml(state.inspect?.tenantId ?? 'unknown')}</dd></div>
        <div><dt>Backend</dt><dd>${escapeHtml(state.inspect?.backend ?? 'file')}</dd></div>
        <div><dt>Canonical</dt><dd>${state.inspect?.canonical ? 'yes' : 'no'}</dd></div>
        <div><dt>Root</dt><dd title="${escapeHtml(state.inspect?.rootDir ?? '')}">${escapeHtml(state.inspect?.rootDir ?? 'n/a')}</dd></div>
      </dl>
    </section>
    <section class="stat-grid">${cards.map(([label, value]) => `<article><span>${label}</span><strong>${value}</strong></article>`).join('')}</section>
    ${readinessPanel(doctor)}
  `;
}

function normalizeDoctor(input: unknown): DoctorReport {
  return input && typeof input === 'object' ? input as DoctorReport : { warning: 'Doctor report is not loaded yet.' };
}

function readinessPanel(doctor: DoctorReport): string {
  const details = Array.isArray(doctor.details) ? doctor.details : [];
  const issues = Array.isArray(doctor.issues) ? doctor.issues : [];
  const ok = doctor.ok === true && !doctor.warning;
  const severityCounts = countBySeverity(details, issues, doctor.warning);
  return `
    <section class="panel readiness-panel">
      <div class="section-head">
        <div>
          <p class="eyebrow">Doctor / readiness</p>
          <h2>${ok ? 'Ready for local work' : 'Needs attention'}</h2>
          <p class="muted">Structured checks from the KB doctor, grouped by severity with suggested next actions.</p>
        </div>
        <span class="health-badge ${ok ? 'ok' : 'warn'}">${ok ? 'Healthy' : `${severityCounts.total} issue${severityCounts.total === 1 ? '' : 's'}`}</span>
      </div>
      <div class="readiness-grid">
        ${readinessCard('Errors', severityCounts.error, 'Blocks safe operation', 'error')}
        ${readinessCard('Warnings', severityCounts.warning, 'Worth reviewing soon', 'warning')}
        ${readinessCard('Info', severityCounts.info, 'Context only', 'info')}
        ${readinessCard('Next actions', nextActions(details).length, 'Actionable repairs', 'action')}
      </div>
      ${doctor.warning ? `<div class="alert">${escapeHtml(doctor.warning)}</div>` : ''}
      ${details.length > 0 ? `<div class="issue-list">${details.map(issueCard).join('')}</div>` : issues.length > 0 ? `<div class="issue-list">${issues.map((issue) => issueCard({ severity: 'warning', message: issue })).join('')}</div>` : '<div class="empty readiness-empty">No doctor issues found.</div>'}
      ${nextActions(details).length > 0 ? `<section class="next-actions"><h3>Suggested next actions</h3>${nextActions(details).map((action) => `<span class="chip">${escapeHtml(action)}</span>`).join('')}</section>` : ''}
      <details class="raw-doctor"><summary>Raw doctor output</summary><pre>${escapeHtml(JSON.stringify(doctor, null, 2))}</pre></details>
    </section>
  `;
}

function readinessCard(label: string, value: number, caption: string, tone: string): string {
  return `<article class="readiness-card ${tone}"><span>${escapeHtml(label)}</span><strong>${value}</strong><small>${escapeHtml(caption)}</small></article>`;
}

function countBySeverity(details: DoctorDetail[], issues: string[], warning?: string): { error: number; warning: number; info: number; total: number } {
  const counts = { error: 0, warning: 0, info: 0, total: 0 };
  for (const detail of details) {
    const severity = String(detail.severity ?? 'warning').toLowerCase();
    if (severity === 'error' || severity === 'blocker') counts.error += 1;
    else if (severity === 'info') counts.info += 1;
    else counts.warning += 1;
  }
  if (details.length === 0) counts.warning += issues.length;
  if (warning) counts.warning += 1;
  counts.total = counts.error + counts.warning + counts.info;
  return counts;
}

function issueCard(issue: DoctorDetail): string {
  const severity = String(issue.severity ?? 'warning').toLowerCase();
  const tone = severity === 'error' || severity === 'blocker' ? 'error' : severity === 'info' ? 'info' : 'warning';
  return `
    <article class="issue-card ${tone}">
      <div>
        <span class="issue-severity">${escapeHtml(severity)}</span>
        <strong>${escapeHtml(issue.message ?? issue.code ?? 'Doctor issue')}</strong>
      </div>
      <div class="issue-meta">
        ${issue.code ? `<span>${escapeHtml(issue.code)}</span>` : ''}
        ${issue.entityId ? `<button class="chip linked" data-action="select-record" data-kind="entity" data-id="${escapeHtml(issue.entityId)}">${escapeHtml(issue.entityId)}</button>` : ''}
        ${issue.sourceId ? `<button class="chip linked" data-action="select-record" data-kind="source" data-id="${escapeHtml(issue.sourceId)}">${escapeHtml(issue.sourceId)}</button>` : ''}
        ${issue.path ? `<span>${escapeHtml(issue.path)}</span>` : ''}
      </div>
      ${issue.nextAction ? `<p class="next-action"><strong>Next:</strong> ${escapeHtml(issue.nextAction)}</p>` : ''}
    </article>
  `;
}

function nextActions(details: DoctorDetail[]): string[] {
  return Array.from(new Set(details.map((detail) => detail.nextAction).filter((action): action is string => typeof action === 'string' && action.length > 0))).slice(0, 8);
}
