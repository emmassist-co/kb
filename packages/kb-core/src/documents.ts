import YAML from 'yaml';
import type {
  EntityDocument,
  EntityFrontmatter,
  KnowledgeFreshnessStatus,
  KnowledgeEntityKind,
  KnowledgeSourceKind,
  SourceDocument,
  SourceFrontmatter
} from './types.js';

const ENTITY_KINDS = new Set<KnowledgeEntityKind>([
  'company',
  'person',
  'process',
  'project',
  'policy',
  'vendor',
  'decision',
  'system',
  'team',
  'meeting'
]);
const SOURCE_KINDS = new Set<KnowledgeSourceKind>(['note', 'research', 'workspace', 'chat']);
const CONFIDENCE_VALUES = new Set(['low', 'medium', 'high']);
const FRESHNESS_VALUES = new Set<KnowledgeFreshnessStatus>(['fresh', 'needs_review', 'stale']);

export function createEmptyEntity(input: {
  id: string;
  tenantId: string;
  kind: KnowledgeEntityKind;
  title: string;
  aliases?: string[];
  handles?: string[];
  tags?: string[];
  status?: string;
  owners?: string[];
  sources?: string[];
  updatedAt?: string;
  confidence?: 'low' | 'medium' | 'high';
  currentTruth?: string;
  openQuestions?: string[];
  timeline?: string[];
  supersedes?: string[];
  freshnessStatus?: KnowledgeFreshnessStatus;
  lastReviewedAt?: string;
}): EntityDocument {
  return {
    meta: {
      id: input.id,
      tenantId: input.tenantId,
      kind: input.kind,
      title: input.title,
      aliases: uniqueStrings(input.aliases ?? []),
      handles: uniqueStrings(input.handles ?? []),
      tags: uniqueStrings(input.tags ?? []),
      status: optionalString(input.status),
      owners: uniqueStrings(input.owners ?? []),
      sources: uniqueStrings(input.sources ?? []),
      updatedAt: input.updatedAt ?? new Date().toISOString(),
      confidence: input.confidence ?? 'medium',
      supersedes: uniqueStrings(input.supersedes ?? []),
      freshnessStatus: optionalFreshness(input.freshnessStatus),
      lastReviewedAt: optionalString(input.lastReviewedAt)
    },
    currentTruth: normalizeBlock(input.currentTruth ?? ''),
    openQuestions: uniqueStrings(input.openQuestions ?? []),
    timeline: uniqueStrings(input.timeline ?? []),
    sources: uniqueStrings(input.sources ?? [])
  };
}

export function createSourceDocument(input: {
  id: string;
  tenantId: string;
  kind: KnowledgeSourceKind;
  title: string;
  url?: string;
  authors?: string[];
  tags?: string[];
  linkedEntities?: string[];
  createdAt?: string;
  summary?: string;
  content?: string;
  citations?: string[];
  rawSourceRef?: string;
  supersedes?: string[];
  freshnessStatus?: KnowledgeFreshnessStatus;
  lastReviewedAt?: string;
}): SourceDocument {
  return {
    meta: {
      id: input.id,
      tenantId: input.tenantId,
      kind: input.kind,
      title: input.title,
      url: optionalString(input.url),
      authors: uniqueStrings(input.authors ?? []),
      tags: uniqueStrings(input.tags ?? []),
      linkedEntities: uniqueStrings(input.linkedEntities ?? []),
      createdAt: input.createdAt ?? new Date().toISOString(),
      rawSourceRef: optionalString(input.rawSourceRef),
      supersedes: uniqueStrings(input.supersedes ?? []),
      freshnessStatus: optionalFreshness(input.freshnessStatus),
      lastReviewedAt: optionalString(input.lastReviewedAt)
    },
    summary: normalizeBlock(input.summary ?? ''),
    content: normalizeBlock(input.content ?? ''),
    citations: uniqueStrings(input.citations ?? [])
  };
}

export function renderEntityDocument(doc: EntityDocument): string {
  const frontmatter = YAML.stringify({
    id: doc.meta.id,
    tenantId: doc.meta.tenantId,
    kind: doc.meta.kind,
    title: doc.meta.title,
    aliases: doc.meta.aliases,
    handles: doc.meta.handles,
    tags: doc.meta.tags,
    status: doc.meta.status,
    owners: doc.meta.owners,
    sources: doc.meta.sources,
    updatedAt: doc.meta.updatedAt,
    confidence: doc.meta.confidence,
    supersedes: doc.meta.supersedes,
    freshnessStatus: doc.meta.freshnessStatus,
    lastReviewedAt: doc.meta.lastReviewedAt
  }).trim();

  return [
    '---',
    frontmatter,
    '---',
    '',
    '## Current Truth',
    '',
    doc.currentTruth.trim(),
    '',
    '## Open Questions',
    '',
    ...renderBulletSection(doc.openQuestions),
    '',
    '## Timeline',
    '',
    ...renderBulletSection(doc.timeline),
    '',
    '## Sources',
    '',
    ...renderBulletSection(doc.sources.map((sourceId) => `[[${sourceId}]]`)),
    ''
  ].join('\n');
}

export function renderSourceDocument(doc: SourceDocument): string {
  const frontmatter = YAML.stringify({
    id: doc.meta.id,
    tenantId: doc.meta.tenantId,
    kind: doc.meta.kind,
    title: doc.meta.title,
    url: doc.meta.url,
    authors: doc.meta.authors,
    tags: doc.meta.tags,
    linkedEntities: doc.meta.linkedEntities,
    createdAt: doc.meta.createdAt,
    rawSourceRef: doc.meta.rawSourceRef,
    supersedes: doc.meta.supersedes,
    freshnessStatus: doc.meta.freshnessStatus,
    lastReviewedAt: doc.meta.lastReviewedAt
  }).trim();

  return [
    '---',
    frontmatter,
    '---',
    '',
    '## Summary',
    '',
    doc.summary.trim(),
    '',
    '## Content',
    '',
    doc.content.trim(),
    '',
    '## Citations',
    '',
    ...renderBulletSection(doc.citations),
    ''
  ].join('\n');
}

export function parseEntityDocument(markdown: string): EntityDocument {
  const { frontmatter, body } = splitFrontmatter(markdown);
  const meta = normalizeEntityFrontmatter(frontmatter);
  return {
    meta,
    currentTruth: sectionBody(body, 'Current Truth').trim(),
    openQuestions: parseBulletSection(sectionBody(body, 'Open Questions')),
    timeline: parseBulletSection(sectionBody(body, 'Timeline')),
    sources: parseBulletSection(sectionBody(body, 'Sources')).map(stripSourceLink)
  };
}

export function parseSourceDocument(markdown: string): SourceDocument {
  const { frontmatter, body } = splitFrontmatter(markdown);
  const meta = normalizeSourceFrontmatter(frontmatter);
  return {
    meta,
    summary: sectionBody(body, 'Summary').trim(),
    content: sectionBody(body, 'Content').trim(),
    citations: parseBulletSection(sectionBody(body, 'Citations'))
  };
}

export function validateEntityDocument(doc: EntityDocument): string[] {
  const issues: string[] = [];
  if (!doc.meta.id) issues.push('Entity frontmatter is missing `id`.');
  if (!doc.meta.tenantId) issues.push('Entity frontmatter is missing `tenantId`.');
  if (!ENTITY_KINDS.has(doc.meta.kind)) issues.push(`Unsupported entity kind: ${doc.meta.kind}.`);
  if (!doc.meta.title) issues.push('Entity frontmatter is missing `title`.');
  if (!CONFIDENCE_VALUES.has(doc.meta.confidence)) issues.push(`Unsupported entity confidence: ${doc.meta.confidence}.`);
  return issues;
}

export function validateSourceDocument(doc: SourceDocument): string[] {
  const issues: string[] = [];
  if (!doc.meta.id) issues.push('Source frontmatter is missing `id`.');
  if (!doc.meta.tenantId) issues.push('Source frontmatter is missing `tenantId`.');
  if (!SOURCE_KINDS.has(doc.meta.kind)) issues.push(`Unsupported source kind: ${doc.meta.kind}.`);
  if (!doc.meta.title) issues.push('Source frontmatter is missing `title`.');
  return issues;
}

function splitFrontmatter(markdown: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/m.exec(markdown.trim());
  if (!match) {
    throw new Error('Markdown document is missing YAML frontmatter.');
  }
  return {
    frontmatter: (YAML.parse(match[1]) as Record<string, unknown>) ?? {},
    body: match[2].trim()
  };
}

function normalizeEntityFrontmatter(frontmatter: Record<string, unknown>): EntityFrontmatter {
  return {
    id: stringField(frontmatter.id),
    tenantId: stringField(frontmatter.tenantId),
    kind: stringField(frontmatter.kind) as KnowledgeEntityKind,
    title: stringField(frontmatter.title),
    aliases: stringList(frontmatter.aliases),
    handles: stringList(frontmatter.handles),
    tags: stringList(frontmatter.tags),
    status: optionalString(frontmatter.status),
    owners: stringList(frontmatter.owners),
    sources: stringList(frontmatter.sources),
    updatedAt: stringField(frontmatter.updatedAt),
    confidence: (optionalString(frontmatter.confidence) ?? 'medium') as EntityFrontmatter['confidence'],
    supersedes: stringList(frontmatter.supersedes),
    freshnessStatus: optionalFreshness(frontmatter.freshnessStatus),
    lastReviewedAt: optionalString(frontmatter.lastReviewedAt)
  };
}

function normalizeSourceFrontmatter(frontmatter: Record<string, unknown>): SourceFrontmatter {
  return {
    id: stringField(frontmatter.id),
    tenantId: stringField(frontmatter.tenantId),
    kind: stringField(frontmatter.kind) as KnowledgeSourceKind,
    title: stringField(frontmatter.title),
    url: optionalString(frontmatter.url),
    authors: stringList(frontmatter.authors),
    tags: stringList(frontmatter.tags),
    linkedEntities: stringList(frontmatter.linkedEntities),
    createdAt: stringField(frontmatter.createdAt),
    rawSourceRef: optionalString(frontmatter.rawSourceRef),
    supersedes: stringList(frontmatter.supersedes),
    freshnessStatus: optionalFreshness(frontmatter.freshnessStatus),
    lastReviewedAt: optionalString(frontmatter.lastReviewedAt)
  };
}

function sectionBody(body: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`## ${escaped}\\n\\n([\\s\\S]*?)(?=\\n## |$)`, 'm');
  const match = regex.exec(body);
  return match?.[1]?.trim() ?? '';
}

function parseBulletSection(section: string): string[] {
  if (!section.trim()) return [];
  return section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .filter((line) => line.toLowerCase() !== 'none')
    .filter(Boolean);
}

function renderBulletSection(lines: string[]): string[] {
  if (lines.length === 0) return ['- none'];
  return lines.map((line) => `- ${line}`);
}

function stripSourceLink(value: string): string {
  const match = /^\[\[(.+)\]\]$/.exec(value);
  return match?.[1] ?? value;
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalString(value: unknown): string | undefined {
  const text = stringField(value);
  return text === '' ? undefined : text;
}

function optionalFreshness(value: unknown): KnowledgeFreshnessStatus | undefined {
  const text = optionalString(value);
  if (!text) return undefined;
  return FRESHNESS_VALUES.has(text as KnowledgeFreshnessStatus)
    ? (text as KnowledgeFreshnessStatus)
    : undefined;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeBlock(value: string): string {
  return value.replace(/\r\n/g, '\n').trim();
}
