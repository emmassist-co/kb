import './styles.css';
import * as d3 from 'd3';
import { KbApi, loadConfig, type KnowledgeRelation } from './api';
import { renderMarkdown } from './markdown';
import { inventoryView } from './views/inventory';
import { recordsView, selectRecord } from './views/records';
import { graphView } from './views/graph';
import { recentsView } from './views/recents';
import { initialState, type DashboardTab } from './state';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Dashboard root not found');

const state = initialState();
let api: KbApi;
let graphClickTimer: number | null = null;

void boot();

async function boot(): Promise<void> {
  try {
    api = new KbApi(await loadConfig());
    await refreshData();
    await applyRouteSelection();
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  }
  render();
}

async function refreshData(): Promise<void> {
  state.inspect = await api.inspect();
  const [doctor, events, relations] = await Promise.allSettled([api.doctor(), api.events(), api.relations()]);
  state.doctor = doctor.status === 'fulfilled' ? doctor.value : { warning: doctor.reason instanceof Error ? doctor.reason.message : String(doctor.reason) };
  state.events = events.status === 'fulfilled' ? events.value : [];
  state.relations = relations.status === 'fulfilled' ? relations.value : [];
  state.status = 'Ready';
}

function render(): void {
  app.innerHTML = `
    <div class="app-shell">
      <nav class="sidebar" aria-label="Dashboard navigation">
        <div class="brand"><span>kb</span><strong>Dashboard</strong></div>
        ${navButton('overview', 'Overview')}
        ${navButton('records', 'Records')}
        ${navButton('graph', 'Graph')}
        ${navButton('recents', 'Recents')}
        <p class="mode">${api?.readOnly ? 'Read-only' : 'Write-enabled'} local surface</p>
      </nav>
      <main>
        <header class="topbar"><span>${state.status}</span>${state.error ? `<strong class="error">${state.error}</strong>` : ''}</header>
        ${activeView()}
      </main>
    </div>
  `;
  bindEvents();
  renderGraphMap();
}

function navButton(tab: DashboardTab, label: string): string {
  return `<button class="nav ${state.tab === tab ? 'active' : ''}" data-tab="${tab}">${label}</button>`;
}

function activeView(): string {
  switch (state.tab) {
    case 'records': return recordsView(state, api?.readOnly ?? true);
    case 'graph': return graphView(state);
    case 'recents': return recentsView(state);
    default: return inventoryView(state);
  }
}

function bindEvents(): void {
  app.onclick = async (event) => {
    const target = event.target as HTMLElement;
    const actionElement = target.closest<HTMLElement>('[data-action]');
    const button = target.closest<HTMLButtonElement>('button');
    if (!actionElement && !button) return;

    const tab = button?.dataset.tab as DashboardTab | undefined;
    const action = actionElement?.dataset.action ?? button?.dataset.action;

    if (tab) {
      state.tab = tab;
      writeRoute();
      render();
      return;
    }

    if (action === 'select-record') {
      try {
        await openRecord(actionElement?.dataset.kind as 'entity' | 'source', actionElement?.dataset.id ?? '');
        state.error = null;
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
      }
      render();
      return;
    }

    if (action === 'graph-preview-record') {
      try {
        const id = actionElement?.dataset.id ?? '';
        await loadGraphPreview(id);
        writeRoute({ tab: 'graph', previewKind: 'entity', previewId: id });
        state.error = null;
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
      }
      render();
      return;
    }

    if (action === 'load-more-records') {
      state.recordVisibleCount += 50;
      render();
      return;
    }

    if (action === 'graph-show-global') {
      state.selected = null;
      state.document = null;
      state.selectedRelations = [];
      state.selectedLinks = [];
      state.selectedRelated = [];
      state.graphPreviewDocument = null;
      state.graphPreviewRelations = [];
      writeRoute();
      render();
      return;
    }

    if (action === 'link-selected-entity') {
      await linkSelectedEntity();
      return;
    }

    if (action === 'toggle-raw-frontmatter') {
      const raw = app.querySelector<HTMLElement>('.raw-frontmatter');
      if (raw) raw.hidden = !raw.hidden;
      return;
    }

    if (action === 'save-document') {
      if (!state.document || !state.selected) return;
      if (!confirm('Save markdown changes to the local KB?')) return;
      try {
        state.document = await api.saveDocument(state.document.kind, state.document.id, state.draftMarkdown, state.document.revision);
        state.draftMarkdown = state.document.markdown;
        state.status = 'Saved';
        state.error = null;
        await refreshData();
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
      }
      render();
    }
  };

  app.querySelectorAll<HTMLElement>('.record-row').forEach((row) => {
    const openRow = async (): Promise<void> => {
      try {
        await openRecord(row.dataset.kind as 'entity' | 'source', row.dataset.id ?? '');
        state.error = null;
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
      }
      render();
    };
    row.addEventListener('click', (event) => {
      event.stopPropagation();
      void openRow();
    });
    row.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      void openRow();
    });
  });
  app.querySelector<HTMLInputElement>('[data-field="record-search"]')?.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement;
    const selectionStart = input.selectionStart;
    const selectionEnd = input.selectionEnd;
    state.recordSearch = input.value;
    state.recordVisibleCount = 50;
    render();
    const nextInput = app.querySelector<HTMLInputElement>('[data-field="record-search"]');
    nextInput?.focus();
    if (nextInput && selectionStart !== null && selectionEnd !== null) nextInput.setSelectionRange(selectionStart, selectionEnd);
  });
  app.querySelector<HTMLTextAreaElement>('[data-field="markdown"]')?.addEventListener('input', (event) => {
    state.draftMarkdown = (event.target as HTMLTextAreaElement).value;
    refreshEditorPreview();
  });
}

function renderGraphMap(): void {
  const container = app.querySelector<HTMLElement>('.graph-map');
  const svgElement = container?.querySelector<SVGSVGElement>('svg');
  if (!container || !svgElement || !container.dataset.graph) return;

  const relations = JSON.parse(container.dataset.graph) as KnowledgeRelation[];
  const explicitNodes = JSON.parse(container.dataset.nodes ?? '[]') as Array<{ id: string; title?: string; kind?: string }>;
  if (relations.length === 0 && explicitNodes.length === 0) return;

  const width = Math.max(container.clientWidth, 720);
  const height = 620;
  const selectedId = container.dataset.selectedId || null;
  const degree = new Map<string, number>();
  const selectedNeighbors = new Set<string>();
  const nodeMap = new Map<string, { id: string; title?: string; kind?: string; degree: number; selected: boolean; neighbor: boolean }>();

  for (const relation of relations) {
    if (!selectedId) continue;
    if (relation.fromId === selectedId) selectedNeighbors.add(relation.toId);
    if (relation.toId === selectedId) selectedNeighbors.add(relation.fromId);
  }

  for (const explicitNode of explicitNodes) {
    nodeMap.set(explicitNode.id, { id: explicitNode.id, title: explicitNode.title, kind: explicitNode.kind, degree: 0, selected: explicitNode.id === selectedId, neighbor: selectedNeighbors.has(explicitNode.id) });
  }

  for (const relation of relations) {
    degree.set(relation.fromId, (degree.get(relation.fromId) ?? 0) + 1);
    degree.set(relation.toId, (degree.get(relation.toId) ?? 0) + 1);
    nodeMap.set(relation.fromId, { ...(nodeMap.get(relation.fromId) ?? { id: relation.fromId }), degree: 0, selected: relation.fromId === selectedId, neighbor: selectedNeighbors.has(relation.fromId) });
    nodeMap.set(relation.toId, { ...(nodeMap.get(relation.toId) ?? { id: relation.toId }), degree: 0, selected: relation.toId === selectedId, neighbor: selectedNeighbors.has(relation.toId) });
  }

  const nodes = Array.from(nodeMap.values()).map((node) => ({ ...node, degree: degree.get(node.id) ?? 0 }));
  const links = relations.map((relation) => ({ source: relation.fromId, target: relation.toId, type: relation.type, selected: Boolean(selectedId && (relation.fromId === selectedId || relation.toId === selectedId)) }));

  const svg = d3.select(svgElement)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', '100%')
    .attr('height', height);
  svg.selectAll('*').remove();

  const zoomLayer = svg.append('g');
  svg.call(d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.25, 4]).on('zoom', (event) => {
    zoomLayer.attr('transform', event.transform.toString());
  }));

  zoomLayer.append('defs').append('marker')
    .attr('id', 'arrowhead')
    .attr('viewBox', '0 -5 10 10')
    .attr('refX', 18)
    .attr('refY', 0)
    .attr('markerWidth', 6)
    .attr('markerHeight', 6)
    .attr('orient', 'auto')
    .append('path')
    .attr('d', 'M0,-5L10,0L0,5')
    .attr('fill', '#a49780');

  const link = zoomLayer.append('g')
    .attr('class', 'd3-links')
    .selectAll('line')
    .data(links)
    .join('line')
    .attr('class', (link) => `${link.selected ? 'selected' : selectedId ? 'dimmed' : ''}`)
    .attr('stroke-width', (link) => link.selected ? 3 : 1.4)
    .attr('marker-end', 'url(#arrowhead)');

  const linkLabel = zoomLayer.append('g')
    .attr('class', 'd3-link-labels')
    .selectAll('text')
    .data(links.filter((link, index) => link.selected || index < 80))
    .join('text')
    .attr('class', (link) => `${link.selected ? 'selected' : selectedId ? 'dimmed' : ''}`)
    .text((link) => link.type);

  const node = zoomLayer.append('g')
    .attr('class', 'd3-nodes')
    .selectAll('g')
    .data(nodes)
    .join('g')
    .attr('class', (node) => `d3-node ${node.selected ? 'selected' : ''} ${node.neighbor ? 'neighbor' : ''} ${selectedId && !node.selected && !node.neighbor ? 'dimmed' : ''}`)
    .call(d3.drag<SVGGElement, typeof nodes[number]>()
      .on('start', (event, node) => {
        if (!event.active) simulation.alphaTarget(0.25).restart();
        node.fx = node.x;
        node.fy = node.y;
      })
      .on('drag', (event, node) => {
        node.fx = event.x;
        node.fy = event.y;
      })
      .on('end', (event, node) => {
        if (!event.active) simulation.alphaTarget(0);
        node.fx = null;
        node.fy = null;
      }));

  node.append('circle').attr('r', (node) => node.selected ? Math.min(28, 13 + node.degree * 2.4) : Math.min(22, 8 + node.degree * 2.2));
  node.append('text').attr('dy', -14).text((node) => shortNodeLabel(node.title || node.id));
  node.append('title').text((node) => node.id);
  node.on('click', (_, node) => {
    if (graphClickTimer) window.clearTimeout(graphClickTimer);
    graphClickTimer = window.setTimeout(async () => {
      graphClickTimer = null;
      try {
        await loadGraphPreview(node.id);
        writeRoute({ tab: 'graph', previewKind: 'entity', previewId: node.id });
        state.error = null;
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
      }
      render();
    }, 220);
  });
  node.on('dblclick', async (event, node) => {
    event.stopPropagation();
    if (graphClickTimer) {
      window.clearTimeout(graphClickTimer);
      graphClickTimer = null;
    }
    try {
      await openRecord('entity', node.id);
      state.error = null;
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
    }
    render();
  });

  const selectedNode = selectedId ? nodes.find((node) => node.id === selectedId) : undefined;
  if (selectedNode) {
    selectedNode.fx = width / 2;
    selectedNode.fy = height / 2;
  }

  const simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink<typeof nodes[number], typeof links[number]>(links).id((node) => node.id).distance((link) => link.selected ? 82 : 120).strength((link) => link.selected ? 0.82 : 0.45))
    .force('charge', d3.forceManyBody<typeof nodes[number]>().strength((node) => node.selected ? -80 : node.neighbor ? -260 : -420))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('x', d3.forceX<typeof nodes[number]>((node) => node.selected ? width / 2 : node.neighbor ? width / 2 : width / 2).strength((node) => node.selected ? 0.8 : node.neighbor ? 0.08 : 0.015))
    .force('y', d3.forceY<typeof nodes[number]>((node) => node.selected ? height / 2 : node.neighbor ? height / 2 : height / 2).strength((node) => node.selected ? 0.8 : node.neighbor ? 0.08 : 0.015))
    .force('collision', d3.forceCollide<typeof nodes[number]>().radius((node) => Math.min(38, 18 + node.degree * 2.2)));

  simulation.on('tick', () => {
    link
      .attr('x1', (link) => nodeX(link.source))
      .attr('y1', (link) => nodeY(link.source))
      .attr('x2', (link) => nodeX(link.target))
      .attr('y2', (link) => nodeY(link.target));
    linkLabel
      .attr('x', (link) => (nodeX(link.source) + nodeX(link.target)) / 2)
      .attr('y', (link) => (nodeY(link.source) + nodeY(link.target)) / 2);
    node.attr('transform', (node) => `translate(${node.x ?? width / 2},${node.y ?? height / 2})`);
  });
}

async function openRecord(kind: 'entity' | 'source', id: string): Promise<void> {
  const records = kind === 'entity' ? state.inspect?.summary?.entities ?? [] : state.inspect?.summary?.sources ?? [];
  const summary = records.find((record) => record.id === id);
  state.selected = summary ? { ...summary, recordKind: kind } : { id, title: id, kind: 'unknown', recordKind: kind };
  state.document = null;
  state.selectedRelations = [];
  state.selectedLinks = [];
  state.selectedRelated = [];
  state.draftMarkdown = '';
  state.tab = 'records';
  state.status = `Loading ${kind}…`;
  writeRoute({ tab: 'records', kind, id });
  render();

  state.document = await api.document(kind, id);
  state.draftMarkdown = state.document.markdown;
  state.status = 'Ready';
  state.error = null;
  render();

  void loadSelectedRecordContext(kind, id);
}

async function loadSelectedRecordContext(kind: 'entity' | 'source', id: string): Promise<void> {
  try {
    if (kind === 'entity') {
      const [relations, links, related] = await Promise.allSettled([api.entityRelations(id), api.entityLinks(id), api.entityRelated(id)]);
      if (state.selected?.id !== id || state.selected.recordKind !== kind) return;
      state.selectedRelations = relations.status === 'fulfilled' ? relations.value : [];
      state.selectedLinks = links.status === 'fulfilled' ? links.value : [];
      state.selectedRelated = related.status === 'fulfilled' ? related.value : [];
    } else {
      if (state.selected?.id !== id || state.selected.recordKind !== kind) return;
      state.selectedRelations = state.relations.filter((relation) => relation.originId === id || relation.sourceIds?.includes(id));
      state.selectedLinks = [];
      state.selectedRelated = [];
    }
    render();
  } catch (error) {
    if (state.selected?.id !== id || state.selected.recordKind !== kind) return;
    state.error = error instanceof Error ? error.message : String(error);
    render();
  }
}

async function loadGraphPreview(id: string): Promise<void> {
  const [document, relations] = await Promise.allSettled([api.document('entity', id), api.entityRelations(id)]);
  if (document.status === 'fulfilled') state.graphPreviewDocument = document.value;
  if (relations.status === 'fulfilled') state.graphPreviewRelations = relations.value;
}

async function linkSelectedEntity(): Promise<void> {
  if (!state.document || state.document.kind !== 'entity') return;
  const type = app.querySelector<HTMLInputElement>('[data-field="relation-type"]')?.value.trim() || 'related_to';
  const toId = app.querySelector<HTMLInputElement>('[data-field="relation-target"]')?.value.trim();
  const sourceIds = (app.querySelector<HTMLInputElement>('[data-field="relation-sources"]')?.value ?? '')
    .split(',')
    .map((sourceId) => sourceId.trim())
    .filter(Boolean);
  if (!toId) {
    state.error = 'Choose a target entity id before adding a link.';
    render();
    return;
  }
  try {
    await api.relate({ type, fromId: state.document.id, toId, sourceIds });
    await refreshData();
    await selectRecord(api, state, 'entity', state.document.id);
    state.status = 'Linked entities';
    state.error = null;
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  }
  render();
}

async function applyRouteSelection(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get('tab') as DashboardTab | null;
  if (tab && ['overview', 'records', 'graph', 'recents'].includes(tab)) state.tab = tab;
  const kind = params.get('kind') as 'entity' | 'source' | null;
  const id = params.get('id');
  if ((kind === 'entity' || kind === 'source') && id) {
    await openRecord(kind, id);
    return;
  }
  const previewId = params.get('previewId');
  if (previewId && state.tab === 'graph') await loadGraphPreview(previewId);
}

function writeRoute(override: { tab?: DashboardTab; kind?: 'entity' | 'source'; id?: string; previewKind?: 'entity'; previewId?: string } = {}): void {
  const params = new URLSearchParams();
  const tab = override.tab ?? state.tab;
  if (tab !== 'overview') params.set('tab', tab);
  const selectedKind = override.kind ?? state.selected?.recordKind;
  const selectedId = override.id ?? state.selected?.id;
  if (tab === 'records' && selectedKind && selectedId) {
    params.set('kind', selectedKind);
    params.set('id', selectedId);
  }
  if (tab === 'graph') {
    const previewId = override.previewId ?? state.graphPreviewDocument?.id;
    if (previewId) {
      params.set('previewKind', override.previewKind ?? 'entity');
      params.set('previewId', previewId);
    }
  }
  const query = params.toString();
  const next = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  window.history.replaceState(null, '', next);
}

function nodeX(node: string | { x?: number }): number {
  return typeof node === 'string' ? 0 : node.x ?? 0;
}

function nodeY(node: string | { y?: number }): number {
  return typeof node === 'string' ? 0 : node.y ?? 0;
}

function shortNodeLabel(id: string): string {
  const label = id.replace(/[-_]+/g, ' ');
  return label.length > 28 ? `${label.slice(0, 25)}…` : label;
}

function refreshEditorPreview(): void {
  const preview = app.querySelector<HTMLElement>('.preview');
  if (preview) preview.innerHTML = renderMarkdown(state.draftMarkdown);
  const save = app.querySelector<HTMLButtonElement>('[data-action="save-document"]');
  if (save && state.document) save.disabled = api.readOnly || state.document.markdown === state.draftMarkdown;
}
