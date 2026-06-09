import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { KnowledgeBaseService } from '../../packages/kb-core/src/service.js';
import type { KnowledgeBaseConfig } from '../../packages/kb-core/src/types.js';
import { FileKnowledgeStore } from '../../packages/kb-storage-file/src/file-store.js';
import type { EntityDraft, KnowledgeEntityKind, KnowledgeEvent, KnowledgeExportSnapshot, KnowledgeSearchResult } from '../../packages/kb-core/src/types.js';
import type { EvalCategoryResult, EvalPage, EvalScorecard } from './types.js';

export interface SeededKnowledgeBaseInput {
  pages?: EvalPage[];
  entities?: Array<{
    id: string;
    kind: KnowledgeEntityKind;
    title: string;
    aliases?: string[];
    handles?: string[];
    tags?: string[];
    sources?: string[];
    currentTruth?: string;
    openQuestions?: string[];
    timeline?: string[];
  }>;
  sources?: Array<{
    id: string;
    kind?: 'note' | 'research' | 'workspace' | 'chat';
    title: string;
    url?: string;
    authors?: string[];
    tags?: string[];
    linkedEntities?: string[];
    summary?: string;
    content: string;
    citations?: string[];
    createdAt?: string;
  }>;
  events?: KnowledgeEvent[];
  drafts?: EntityDraft[];
  consolidate?: string[];
}

export async function withSeededKnowledgeBase<T>(
  input: SeededKnowledgeBaseInput,
  run: (ctx: { service: KnowledgeBaseService; rootDir: string; snapshot: () => Promise<KnowledgeExportSnapshot> }) => Promise<T>
): Promise<T> {
  const kbRootDir = mkdtempSync(path.join(tmpdir(), 'kb-eval-'));
  const env = {
    KB_ROOT_DIR: kbRootDir,
    WORKSPACE_TENANT_ID: 'workspace-template'
  };
  const config = createEvalKnowledgeBaseConfig();
  const service = createKnowledgeBaseService(env, 'workspace-template', config);

  try {
    for (const page of input.pages ?? []) {
      await service.createEntity({
        id: page.id,
        kind: mapKind(page.type),
        title: page.title,
        aliases: page.aliases,
        handles: page.handles,
        tags: page.tags ?? [page.type],
        sources: page.sources,
        currentTruth: page.compiledTruth,
        timeline: page.timeline ? page.timeline.split('\n').map((line) => line.trim()).filter(Boolean) : []
      });
    }

    for (const page of input.pages ?? []) {
      if (!page.relations?.length) continue;
      await service.importStructuredLinks({
        origin: { kind: 'seed', id: page.id },
        links: page.relations.flatMap((relation) =>
          relation.targets.map((targetId) => ({
            type: relation.type,
            fromId: page.id,
            toId: targetId,
            confidence: 0.97,
            evidenceKind: 'structured' as const
          }))
        )
      });
    }

    for (const entity of input.entities ?? []) {
      await service.createEntity(entity);
    }

    for (const source of input.sources ?? []) {
      await service.captureSource({
        id: source.id,
        kind: source.kind,
        title: source.title,
        url: source.url,
        authors: source.authors,
        tags: source.tags,
        linkedEntities: source.linkedEntities,
        summary: source.summary,
        content: source.content,
        citations: source.citations,
        extractEntities: false,
        createdAt: source.createdAt
      });
    }

    for (const event of input.events ?? []) {
      await service.appendEvent(event);
    }

    for (const draft of input.drafts ?? []) {
      await service.updateEntityDraft({
        entityId: draft.entityId,
        title: draft.title,
        kind: draft.kind,
        summary: draft.summary,
        openQuestions: draft.openQuestions,
        sourceIds: draft.sourceIds,
        timelineNotes: draft.timelineNotes
      });
    }

    for (const entityId of input.consolidate ?? []) {
      await service.consolidate(entityId);
    }

    return await run({
      service,
      rootDir: kbRootDir,
      snapshot: () => service.export()
    });
  } finally {
    rmSync(kbRootDir, { force: true, recursive: true });
  }
}

function createEvalKnowledgeBaseConfig(): KnowledgeBaseConfig {
  return {
    enabled: true,
    mode: 'basic',
    writePolicy: 'mixed',
    persistence: {
      backend: 'file',
      cacheRefreshPolicy: 'per-run',
      rootDir: '.kb'
    },
    ingest: {
      agentTurns: false,
      userCorrections: false,
      workspaceSignals: false,
      externalResearch: false
    }
  };
}

function createKnowledgeBaseService(env: Record<string, unknown>, tenantId: string, config: KnowledgeBaseConfig): KnowledgeBaseService {
  const configuredRoot = config.persistence.rootDir || '.kb';
  const rootDir = typeof env.KB_ROOT_DIR === 'string' && env.KB_ROOT_DIR !== ''
    ? env.KB_ROOT_DIR
    : path.resolve(process.cwd(), configuredRoot, tenantId);
  return new KnowledgeBaseService(
    tenantId,
    config,
    new FileKnowledgeStore(rootDir, config.mode)
  );
}

export function searchResultDocs(results: KnowledgeSearchResult[]): Array<{
  pageId: string;
  score: number;
  rank: number;
  reason: string[];
  matchedFields: string[];
  sourceIds: string[];
  confidence: 'low' | 'medium' | 'high';
  ambiguous: boolean;
}> {
  return results.map((entry, index) => ({
    pageId: entry.id,
    score: entry.score,
    rank: index + 1,
    reason: entry.reason,
    matchedFields: entry.matchedFields,
    sourceIds: entry.sourceIds,
    confidence: entry.confidence,
    ambiguous: entry.ambiguous
  }));
}

export function writeScorecardArtifacts(
  scorecard: EvalScorecard,
  outputDir = path.resolve(process.cwd(), 'docs/benchmarks')
): { markdownPath: string; jsonPath: string } {
  mkdirSync(outputDir, { recursive: true });
  const markdownPath = path.join(outputDir, 'kb-scorecard-latest.md');
  const jsonPath = path.join(outputDir, 'kb-scorecard-latest.json');
  writeFileSync(markdownPath, renderScorecardMarkdown(scorecard), 'utf8');
  writeFileSync(jsonPath, `${JSON.stringify(scorecard, null, 2)}\n`, 'utf8');
  return { markdownPath, jsonPath };
}

export function summarizeOverall(categories: EvalCategoryResult[]): EvalScorecard['overall'] {
  const passed = categories.filter((category) => category.passed).length;
  return {
    passed: passed === categories.length,
    categoryPassRate: categories.length === 0 ? 0 : passed / categories.length,
    metrics: Object.fromEntries(categories.map((category) => [`${category.category}:pass`, category.passed ? 1 : 0]))
  };
}

export function renderScorecardMarkdown(scorecard: EvalScorecard): string {
  const lines = [
    '# KB Eval Scorecard',
    '',
    `Generated: ${scorecard.generatedAt}`,
    `Corpus: \`${scorecard.corpus}\``,
    `Provenance: \`${scorecard.provenance}\``,
    `Suite: \`${scorecard.suite}\``,
    '',
    `Overall passed: ${scorecard.overall.passed ? 'yes' : 'no'}`,
    `Category pass rate: ${(scorecard.overall.categoryPassRate * 100).toFixed(1)}%`,
    '',
    '| Category | Cases | Passed | Metrics |',
    '| --- | ---: | :---: | --- |'
  ];
  if (scorecard.policy) {
    lines.splice(8, 0, ...renderScorecardPolicy(scorecard.policy), '');
  }
  for (const category of scorecard.categories) {
    const metrics = Object.entries(category.metrics)
      .map(([key, value]) => `${key}=${(value * 100).toFixed(1)}%`)
      .join(', ');
    lines.push(`| ${category.category} | ${category.caseCount} | ${category.passed ? 'yes' : 'no'} | ${metrics} |`);
  }
  for (const category of scorecard.categories.filter((entry) => entry.failures.length > 0)) {
    lines.push('');
    lines.push(`## ${capitalize(category.category)} Failures`);
    lines.push('');
    for (const failure of category.failures.slice(0, 5)) {
      lines.push(`- \`${failure.caseId}\`: ${failure.summary}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function renderScorecardPolicy(policy: NonNullable<EvalScorecard['policy']>): string[] {
  const lines = ['## Policy', ''];
  if (policy.optimizeOn?.length) {
    lines.push(`- optimize on: ${policy.optimizeOn.map((entry) => `\`${entry}\``).join(', ')}`);
  }
  if (policy.confirmOn?.length) {
    lines.push(`- confirm on: ${policy.confirmOn.map((entry) => `\`${entry}\``).join(', ')}`);
  }
  if (policy.regressionGuardrails?.length) {
    lines.push(`- regression guardrails: ${policy.regressionGuardrails.map((entry) => `\`${entry}\``).join(', ')}`);
  }
  if (policy.externalReference?.length) {
    lines.push(`- external reference: ${policy.externalReference.map((entry) => `\`${entry}\``).join(', ')}`);
  }
  for (const note of policy.notes ?? []) {
    lines.push(`- note: ${note}`);
  }
  return lines;
}

function mapKind(type: string): KnowledgeEntityKind {
  switch (type) {
    case 'person':
      return 'person';
    case 'company':
      return 'company';
    case 'project':
      return 'project';
    case 'meeting':
      return 'meeting';
    case 'team':
      return 'team';
    case 'policy':
    case 'concept':
      return 'policy';
    case 'vendor':
      return 'vendor';
    case 'decision':
      return 'decision';
    case 'system':
    case 'source':
      return 'system';
    default:
      return 'process';
  }
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
