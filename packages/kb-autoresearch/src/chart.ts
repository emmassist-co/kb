import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadRunConfig } from './config.js';
import type { ExperimentLedgerEntry, KbAutoresearchRunConfig, ScoreBreakdown } from './types.js';

interface ChartPoint {
  index: number;
  runId: string;
  iteration: number;
  timestamp: string;
  decision: ExperimentLedgerEntry['decision'];
  changedFiles: string[];
  candidateCommit?: string;
  rejectReason?: string;
  finalMessage?: string;
  unifiedDiffLines: number;
  durationMinutes?: number;
  beforeCategoryPasses: number;
  beforeHoldoutCategoryPasses: number;
  beforeWeightedScore: number;
  beforeHoldoutWeightedScore: number;
  categoryPasses: number;
  holdoutCategoryPasses: number;
  weightedScore: number;
  holdoutWeightedScore: number;
  categoryPassDelta?: number;
  holdoutCategoryPassDelta?: number;
  weightedDelta?: number;
  holdoutWeightedDelta?: number;
  protectedMetrics: Record<string, number>;
}

export function writeAutoresearchChart(repoRoot: string, runId?: string): string {
  const config = runId ? loadRunConfig(repoRoot, runId) : loadCurrentConfig(repoRoot);
  const ledger = readLedger(config.paths.ledgerPath).filter((entry) => !runId || entry.runId === runId);
  const points = buildChartPoints(ledger);
  const html = renderChartHtml({
    scopeLabel: runId ? config.runId : 'all-runs',
    points,
    generatedAt: new Date().toISOString()
  });
  const outputPath = runId
    ? path.join(config.paths.runRoot, 'chart.html')
    : path.join(config.paths.currentRoot, 'chart.html');
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, html, 'utf8');
  return outputPath;
}

function buildChartPoints(ledger: ExperimentLedgerEntry[]): ChartPoint[] {
  let current: ScoreBreakdown | undefined;
  return ledger.map((entry, index) => {
    current ??= entry.scoreBefore ?? entry.scoreAfter;
    if (!current) {
      throw new Error(`Ledger entry ${entry.runId}#${entry.iteration} is missing score state.`);
    }
    if (entry.scoreAfter) {
      current = entry.scoreAfter;
    }
    const durationMinutes = durationBetween(entry.startedAt, entry.completedAt);
    const before = entry.scoreBefore ?? current;
    const after = entry.scoreAfter ?? before;
    return {
      index,
      runId: entry.runId,
      iteration: entry.iteration,
      timestamp: entry.completedAt,
      decision: entry.decision,
      changedFiles: entry.changedFiles,
      candidateCommit: entry.candidateCommit,
      rejectReason: entry.rejectReason,
      finalMessage: entry.finalMessage,
      unifiedDiffLines: entry.unifiedDiffLines,
      durationMinutes,
      beforeCategoryPasses: before.categoryPasses,
      beforeHoldoutCategoryPasses: before.holdoutCategoryPasses,
      beforeWeightedScore: before.weightedScore,
      beforeHoldoutWeightedScore: before.holdoutWeightedScore,
      categoryPasses: after.categoryPasses,
      holdoutCategoryPasses: after.holdoutCategoryPasses,
      weightedScore: after.weightedScore,
      holdoutWeightedScore: after.holdoutWeightedScore,
      categoryPassDelta: entry.scoreDelta?.categoryPassDelta,
      holdoutCategoryPassDelta: entry.scoreDelta?.holdoutCategoryPassDelta,
      weightedDelta: entry.scoreDelta?.weightedDelta,
      holdoutWeightedDelta: entry.scoreDelta?.holdoutWeightedDelta,
      protectedMetrics: after.protectedMetrics
    };
  });
}

function renderChartHtml(input: {
  scopeLabel: string;
  generatedAt: string;
  points: ChartPoint[];
}): string {
  const accepted = input.points.filter((point) => point.decision === 'accepted').length;
  const rejected = input.points.filter((point) => point.decision === 'rejected').length;
  const noops = input.points.filter((point) => point.decision === 'noop').length;
  const latest = input.points.at(-1);
  const dataJson = JSON.stringify(input.points).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>KB Autoresearch Chart</title>
  <style>
    :root {
      --bg: #0b1020;
      --panel: #121a30;
      --panel-2: #0f1730;
      --text: #edf2ff;
      --muted: #9fb0d1;
      --grid: #2a3558;
      --dev: #67e8f9;
      --holdout: #fbbf24;
      --dev-pass: #34d399;
      --holdout-pass: #a78bfa;
      --accepted: #22c55e;
      --rejected: #ef4444;
      --noop: #94a3b8;
      --failed: #f97316;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: linear-gradient(180deg, #0b1020 0%, #0a0f1c 100%);
      color: var(--text);
    }
    .wrap { max-width: 1400px; margin: 0 auto; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    .sub { color: var(--muted); margin-bottom: 20px; }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }
    .card {
      background: rgba(18, 26, 48, 0.92);
      border: 1px solid rgba(159, 176, 209, 0.14);
      border-radius: 14px;
      padding: 14px 16px;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
    }
    .card .label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; }
    .card .value { margin-top: 6px; font-size: 22px; font-weight: 700; }
    .panel {
      background: rgba(18, 26, 48, 0.92);
      border: 1px solid rgba(159, 176, 209, 0.14);
      border-radius: 18px;
      padding: 16px;
      margin-bottom: 18px;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
    }
    .panel h2 { margin: 0 0 10px; font-size: 16px; }
    .legend { display: flex; gap: 14px; flex-wrap: wrap; color: var(--muted); font-size: 12px; margin-bottom: 10px; }
    .legend span::before {
      content: "";
      display: inline-block;
      width: 10px; height: 10px;
      border-radius: 999px;
      margin-right: 6px;
      vertical-align: middle;
      background: currentColor;
    }
    svg { width: 100%; height: auto; display: block; overflow: visible; }
    .axis text, .grid-label { fill: var(--muted); font-size: 11px; }
    .tooltip {
      position: fixed;
      max-width: 420px;
      background: rgba(9, 14, 28, 0.96);
      color: var(--text);
      border: 1px solid rgba(159, 176, 209, 0.25);
      border-radius: 12px;
      padding: 12px 14px;
      box-shadow: 0 16px 40px rgba(0,0,0,0.35);
      pointer-events: none;
      opacity: 0;
      transform: translateY(4px);
      transition: opacity 120ms ease, transform 120ms ease;
      z-index: 10;
      white-space: pre-wrap;
    }
    .tooltip.show { opacity: 1; transform: translateY(0); }
    .rows {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
    }
    @media (max-width: 1000px) {
      .rows { grid-template-columns: 1fr; }
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th, td {
      text-align: left;
      padding: 10px 8px;
      border-top: 1px solid rgba(159, 176, 209, 0.12);
      vertical-align: top;
    }
    th { color: var(--muted); font-weight: 600; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .decision {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 999px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-weight: 700;
    }
    .accepted { background: rgba(34, 197, 94, 0.15); color: #86efac; }
    .rejected { background: rgba(239, 68, 68, 0.15); color: #fca5a5; }
    .noop { background: rgba(148, 163, 184, 0.15); color: #cbd5e1; }
    .failed { background: rgba(249, 115, 22, 0.15); color: #fdba74; }
    .small { color: var(--muted); font-size: 12px; }
    .detail-card {
      background: rgba(15, 23, 48, 0.75);
      border: 1px solid rgba(159, 176, 209, 0.12);
      border-radius: 14px;
      padding: 14px;
      margin-top: 14px;
    }
    .detail-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px 16px;
      margin-top: 12px;
    }
    .detail-grid .k { color: var(--muted); font-size: 12px; }
    .detail-grid .v { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; margin-top: 2px; }
    .detail-block { margin-top: 12px; }
    .detail-block pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      line-height: 1.45;
      color: var(--text);
    }
    .markdown {
      color: var(--text);
      font-size: 13px;
      line-height: 1.55;
    }
    .markdown h1,
    .markdown h2,
    .markdown h3,
    .markdown h4 {
      margin: 0 0 8px;
      font-size: 14px;
    }
    .markdown p {
      margin: 0 0 10px;
    }
    .markdown ul {
      margin: 0 0 10px 18px;
      padding: 0;
    }
    .markdown li {
      margin: 0 0 6px;
    }
    .markdown pre {
      margin: 0 0 10px;
      padding: 10px 12px;
      border-radius: 10px;
      background: rgba(8, 12, 24, 0.8);
      border: 1px solid rgba(159, 176, 209, 0.12);
      overflow-x: auto;
    }
    .markdown code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      background: rgba(8, 12, 24, 0.65);
      border-radius: 6px;
      padding: 1px 4px;
    }
    .markdown pre code {
      background: transparent;
      padding: 0;
    }
    tr.clickable { cursor: pointer; }
    tr.clickable:hover td { background: rgba(103, 232, 249, 0.05); }
    tr.selected td { background: rgba(103, 232, 249, 0.09); }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>KB Autoresearch Evolution</h1>
    <div class="sub">Scope <span class="mono">${escapeHtml(input.scopeLabel)}</span> · generated ${escapeHtml(input.generatedAt)}</div>

    <div class="stats">
      <div class="card"><div class="label">Total Iterations</div><div class="value">${input.points.length}</div></div>
      <div class="card"><div class="label">Accepted</div><div class="value">${accepted}</div></div>
      <div class="card"><div class="label">Rejected</div><div class="value">${rejected}</div></div>
      <div class="card"><div class="label">No-op</div><div class="value">${noops}</div></div>
      <div class="card"><div class="label">Latest Dev Score</div><div class="value">${latest ? latest.weightedScore.toFixed(3) : 'n/a'}</div></div>
      <div class="card"><div class="label">Latest Holdout Score</div><div class="value">${latest ? latest.holdoutWeightedScore.toFixed(3) : 'n/a'}</div></div>
    </div>

    <div class="panel">
      <h2>Weighted Score Evolution</h2>
      <div class="legend">
        <span style="color: var(--dev)">Dev weighted score</span>
        <span style="color: var(--holdout)">Holdout weighted score</span>
      </div>
      <div id="score-chart"></div>
    </div>

    <div class="panel">
      <h2>Category Pass Evolution</h2>
      <div class="legend">
        <span style="color: var(--dev-pass)">Dev category passes</span>
        <span style="color: var(--holdout-pass)">Holdout category passes</span>
      </div>
      <div id="pass-chart"></div>
    </div>

    <div class="rows">
      <div class="panel">
        <h2>Iteration Timeline</h2>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Iter</th>
              <th>Decision</th>
              <th>Deltas</th>
              <th>Files</th>
            </tr>
          </thead>
          <tbody id="timeline-body"></tbody>
        </table>
      </div>
      <div class="panel">
        <h2>Details</h2>
        <div class="small">Click a point or an iteration row to pin its details. Hover still previews.</div>
        <div id="latest-detail" class="small" style="margin-top: 14px;"></div>
      </div>
    </div>
  </div>
  <div id="tooltip" class="tooltip"></div>

  <script>
    const points = ${dataJson};
    const tooltip = document.getElementById('tooltip');
    const timelineBody = document.getElementById('timeline-body');
    const latestDetail = document.getElementById('latest-detail');
    let selectedIndex = points.length > 0 ? points.length - 1 : -1;

    function fmtTs(ts) {
      return new Date(ts).toLocaleString();
    }
    function fmt(n, digits = 3) {
      return Number.isFinite(n) ? Number(n).toFixed(digits) : 'n/a';
    }
    function fmtSigned(n, digits = 3) {
      if (n === undefined || n === null || Number.isNaN(n)) return 'n/a';
      const fixed = Number(n).toFixed(digits);
      return Number(n) > 0 ? '+' + fixed : fixed;
    }
    function decisionClass(decision) {
      return decision === 'accepted' ? 'accepted' : decision === 'rejected' ? 'rejected' : decision === 'failed' ? 'failed' : 'noop';
    }
    function escapeHtml(value) {
      return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
    }
    function renderMarkdown(markdown) {
      const lines = String(markdown || '').replace(/\\r/g, '').split('\\n');
      const blocks = [];
      let paragraph = [];
      let list = [];
      let code = [];
      let inCode = false;
      function flushParagraph() {
        if (paragraph.length === 0) return;
        blocks.push('<p>' + renderInline(paragraph.join(' ')) + '</p>');
        paragraph = [];
      }
      function flushList() {
        if (list.length === 0) return;
        blocks.push('<ul>' + list.map((item) => '<li>' + renderInline(item) + '</li>').join('') + '</ul>');
        list = [];
      }
      function flushCode() {
        if (code.length === 0) return;
        blocks.push('<pre><code>' + escapeHtml(code.join('\\n')) + '</code></pre>');
        code = [];
      }
      for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        if (line.startsWith('\`\`\`')) {
          flushParagraph();
          flushList();
          if (inCode) {
            flushCode();
            inCode = false;
          } else {
            inCode = true;
          }
          continue;
        }
        if (inCode) {
          code.push(rawLine);
          continue;
        }
        const trimmed = line.trim();
        if (!trimmed) {
          flushParagraph();
          flushList();
          continue;
        }
        const heading = trimmed.match(/^(#{1,4})\\s+(.*)$/);
        if (heading) {
          flushParagraph();
          flushList();
          const level = Math.min(heading[1].length, 4);
          blocks.push('<h' + level + '>' + renderInline(heading[2]) + '</h' + level + '>');
          continue;
        }
        const listItem = trimmed.match(/^[-*]\\s+(.*)$/);
        if (listItem) {
          flushParagraph();
          list.push(listItem[1]);
          continue;
        }
        flushList();
        paragraph.push(trimmed);
      }
      flushParagraph();
      flushList();
      flushCode();
      return '<div class="markdown">' + blocks.join('') + '</div>';
    }
    function renderInline(text) {
      return escapeHtml(String(text))
        .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
        .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
        .replace(/\\*([^*]+)\\*/g, '<em>$1</em>');
    }
    function buildTooltip(point) {
      return [
        '<strong>Iteration ' + point.iteration + '</strong> · ' + escapeHtml(point.decision),
        escapeHtml(fmtTs(point.timestamp)),
        '',
        'Dev score: ' + fmt(point.weightedScore),
        'Holdout score: ' + fmt(point.holdoutWeightedScore),
        'Dev passes: ' + point.categoryPasses,
        'Holdout passes: ' + point.holdoutCategoryPasses,
        '',
        'Before dev score: ' + fmt(point.beforeWeightedScore),
        'Before holdout score: ' + fmt(point.beforeHoldoutWeightedScore),
        '',
        'Delta dev: ' + fmtSigned(point.weightedDelta),
        'Delta holdout: ' + fmtSigned(point.holdoutWeightedDelta),
        'Pass delta dev: ' + (point.categoryPassDelta ?? 'n/a'),
        'Pass delta holdout: ' + (point.holdoutCategoryPassDelta ?? 'n/a'),
        '',
        'Files: ' + (point.changedFiles.join(', ') || 'none'),
        point.candidateCommit ? ('Commit: ' + point.candidateCommit) : '',
        point.rejectReason ? ('Reason: ' + point.rejectReason) : '',
        point.finalMessage ? ('\\n' + escapeHtml(point.finalMessage)) : ''
      ].filter(Boolean).join('\\n');
    }
    function showTooltip(event, point) {
      tooltip.innerHTML = buildTooltip(point).replaceAll('\\n', '<br>');
      tooltip.classList.add('show');
      tooltip.style.left = (event.clientX + 16) + 'px';
      tooltip.style.top = (event.clientY + 16) + 'px';
      renderDetail(point, false);
    }
    function hideTooltip() {
      tooltip.classList.remove('show');
      if (selectedIndex >= 0) {
        renderDetail(points[selectedIndex], true);
      }
    }
    function renderDetail(point, pinned) {
      latestDetail.innerHTML =
        '<div><strong>Iteration ' + point.iteration + '</strong> · <span class="decision ' + decisionClass(point.decision) + '">' + escapeHtml(point.decision) + '</span></div>' +
        '<div class="small" style="margin-top:6px;">' + escapeHtml(fmtTs(point.timestamp)) + (pinned ? ' · pinned selection' : ' · hover preview') + '</div>' +
        '<div class="detail-card">' +
          '<div><strong>Score Change</strong></div>' +
          '<div class="detail-grid">' +
            metricCell('Dev weighted', fmt(point.beforeWeightedScore) + ' → ' + fmt(point.weightedScore), fmtSigned(point.weightedDelta)) +
            metricCell('Holdout weighted', fmt(point.beforeHoldoutWeightedScore) + ' → ' + fmt(point.holdoutWeightedScore), fmtSigned(point.holdoutWeightedDelta)) +
            metricCell('Dev passes', point.beforeCategoryPasses + ' → ' + point.categoryPasses, signedInt(point.categoryPassDelta)) +
            metricCell('Holdout passes', point.beforeHoldoutCategoryPasses + ' → ' + point.holdoutCategoryPasses, signedInt(point.holdoutCategoryPassDelta)) +
            metricCell('Diff lines', String(point.unifiedDiffLines), point.durationMinutes ? fmt(point.durationMinutes, 2) + ' min' : 'n/a') +
            metricCell('Files changed', String(point.changedFiles.length), point.changedFiles.join(', ') || 'none') +
          '</div>' +
          '<div class="detail-block"><div class="k">Protected metrics</div><pre>' + escapeHtml(JSON.stringify(point.protectedMetrics, null, 2)) + '</pre></div>' +
          (point.candidateCommit ? '<div class="detail-block"><div class="k">Commit</div><pre>' + escapeHtml(point.candidateCommit) + '</pre></div>' : '') +
          (point.finalMessage ? '<div class="detail-block"><div class="k">What changed</div>' + renderMarkdown(point.finalMessage) + '</div>' : '') +
          (!point.finalMessage && point.rejectReason ? '<div class="detail-block"><div class="k">Why it failed</div>' + renderMarkdown(point.rejectReason) + '</div>' : '') +
        '</div>';
      document.querySelectorAll('#timeline-body tr').forEach((row) => row.classList.remove('selected'));
      const selectedRow = document.querySelector('#timeline-body tr[data-point="' + point.index + '"]');
      if (selectedRow) selectedRow.classList.add('selected');
      document.querySelectorAll('circle[data-point]').forEach((node) => node.setAttribute('r', node.getAttribute('data-point') === String(point.index) ? '7' : '5'));
    }
    function metricCell(label, value, subvalue) {
      return '<div><div class="k">' + escapeHtml(label) + '</div><div class="v">' + escapeHtml(value) + '</div><div class="small">' + escapeHtml(subvalue) + '</div></div>';
    }
    function signedInt(value) {
      if (value === undefined || value === null) return 'n/a';
      return value > 0 ? '+' + value : String(value);
    }
    function selectPoint(index) {
      selectedIndex = index;
      renderDetail(points[index], true);
    }

    function createChart(targetId, series, options) {
      if (points.length === 0) {
        document.getElementById(targetId).innerHTML = '<div class="small">No autoresearch iterations recorded yet.</div>';
        return;
      }
      const width = 1200;
      const height = 320;
      const margin = { top: 20, right: 18, bottom: 32, left: 58 };
      const innerWidth = width - margin.left - margin.right;
      const innerHeight = height - margin.top - margin.bottom;
      const values = series.flatMap((line) => points.map((point) => point[line.key]));
      const min = Math.min(...values);
      const max = Math.max(...values);
      const padding = Math.max((max - min) * 0.08, options.minPadding ?? 1);
      const yMin = options.yMin ?? Math.max(0, min - padding);
      const yMax = options.yMax ?? max + padding;
      const x = (index) => margin.left + (points.length === 1 ? innerWidth / 2 : (index / (points.length - 1)) * innerWidth);
      const y = (value) => margin.top + innerHeight - ((value - yMin) / (yMax - yMin || 1)) * innerHeight;
      const grid = [];
      for (let i = 0; i < 5; i += 1) {
        const value = yMin + ((yMax - yMin) / 4) * i;
        const py = y(value);
        grid.push('<line x1="' + margin.left + '" y1="' + py + '" x2="' + (width - margin.right) + '" y2="' + py + '" stroke="var(--grid)" stroke-width="1" />');
        grid.push('<text class="grid-label" x="' + (margin.left - 10) + '" y="' + (py + 4) + '" text-anchor="end">' + value.toFixed(options.labelDigits ?? 1) + '</text>');
      }
      const lines = series.map((line) => {
        const d = points.map((point, index) => (index === 0 ? 'M' : 'L') + x(index) + ' ' + y(point[line.key])).join(' ');
        return '<path d="' + d + '" fill="none" stroke="' + line.color + '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />';
      }).join('');
      const dots = points.map((point, index) => {
        const stacked = series.map((line, lineIndex) => {
          const px = x(index);
          const py = y(point[line.key]);
          return '<circle data-point="' + index + '" data-series="' + lineIndex + '" cx="' + px + '" cy="' + py + '" r="5" fill="' + line.color + '" stroke="#0b1020" stroke-width="2" style="cursor:pointer" />';
        }).join('');
        return stacked;
      }).join('');
      const labels = points.map((point, index) => {
        if (points.length > 12 && index % Math.ceil(points.length / 6) !== 0 && index !== points.length - 1) return '';
        return '<text class="axis" x="' + x(index) + '" y="' + (height - 8) + '" text-anchor="middle">' + escapeHtml(String(point.iteration)) + '</text>';
      }).join('');
      document.getElementById(targetId).innerHTML =
        '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + escapeHtml(options.label) + '">' +
          grid.join('') +
          lines +
          dots +
          labels +
        '</svg>';
      document.querySelectorAll('#' + targetId + ' circle').forEach((node) => {
        node.addEventListener('mouseenter', (event) => showTooltip(event, points[Number(node.getAttribute('data-point'))]));
        node.addEventListener('mousemove', (event) => showTooltip(event, points[Number(node.getAttribute('data-point'))]));
        node.addEventListener('mouseleave', hideTooltip);
        node.addEventListener('click', () => selectPoint(Number(node.getAttribute('data-point'))));
      });
    }

    timelineBody.innerHTML = points.map((point) => {
      return '<tr class="clickable" data-point="' + point.index + '">' +
        '<td>' + escapeHtml(fmtTs(point.timestamp)) + '<div class="small mono">' + escapeHtml(point.runId) + '</div></td>' +
        '<td class="mono">' + point.iteration + '</td>' +
        '<td><span class="decision ' + decisionClass(point.decision) + '">' + escapeHtml(point.decision) + '</span></td>' +
        '<td class="mono">dev ' + escapeHtml(fmtSigned(point.weightedDelta)) + '<br>holdout ' + escapeHtml(fmtSigned(point.holdoutWeightedDelta)) + '</td>' +
        '<td>' + escapeHtml(point.changedFiles.join(', ') || 'none') + '</td>' +
      '</tr>';
    }).join('');
    document.querySelectorAll('#timeline-body tr[data-point]').forEach((row) => {
      row.addEventListener('click', () => selectPoint(Number(row.getAttribute('data-point'))));
    });

    createChart('score-chart', [
      { key: 'weightedScore', color: 'var(--dev)' },
      { key: 'holdoutWeightedScore', color: 'var(--holdout)' }
    ], { label: 'Weighted score evolution', labelDigits: 1, minPadding: 5 });

    createChart('pass-chart', [
      { key: 'categoryPasses', color: 'var(--dev-pass)' },
      { key: 'holdoutCategoryPasses', color: 'var(--holdout-pass)' }
    ], { label: 'Category pass evolution', yMin: 0, yMax: 6.5, labelDigits: 0, minPadding: 1 });

    if (points.length > 0) {
      selectPoint(points.length - 1);
    }
  </script>
</body>
</html>`;
}

function readLedger(ledgerPath: string): ExperimentLedgerEntry[] {
  if (!existsSync(ledgerPath)) return [];
  return readFileSync(ledgerPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ExperimentLedgerEntry);
}

function loadCurrentConfig(repoRoot: string): KbAutoresearchRunConfig {
  const currentConfigPath = path.resolve(repoRoot, 'artifacts/kb-autoresearch/current/config.json');
  if (!existsSync(currentConfigPath)) {
    throw new Error('No current autoresearch run found.');
  }
  return JSON.parse(readFileSync(currentConfigPath, 'utf8')) as KbAutoresearchRunConfig;
}

function durationBetween(startedAt?: string, completedAt?: string): number | undefined {
  if (!startedAt || !completedAt) return undefined;
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  return (end - start) / 60_000;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
