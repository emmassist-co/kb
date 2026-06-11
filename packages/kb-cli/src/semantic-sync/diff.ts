import {
  parseEntityDocument,
  parseSourceDocument,
  validateEntityDocument,
  validateSourceDocument
} from '@emmassist-co/kb-core/documents';
import type { EntityDocument, SourceDocument } from '@emmassist-co/kb-core';
import { classifySemanticMirrorPath } from './contract.js';

export type SemanticDiffFailureCode =
  | 'unsupported_path'
  | 'parse_error'
  | 'validation_error'
  | 'remote_drift';

export interface SemanticListChange {
  state: 'unchanged' | 'additive' | 'rewrite';
  added: string[];
  removed: string[];
}

export interface SemanticEntityDiff {
  kind: 'entity';
  operation: 'create' | 'update';
  entityId: string;
  changedMetaFields: Array<'title' | 'aliases' | 'handles' | 'tags' | 'status' | 'owners' | 'sources' | 'confidence' | 'supersedes' | 'freshnessStatus' | 'lastReviewedAt'>;
  currentTruthChanged: boolean;
  openQuestions: SemanticListChange;
  timeline: SemanticListChange;
  sources: SemanticListChange;
  baseline: EntityDocument | null;
  next: EntityDocument;
}

export interface SemanticSourceDiff {
  kind: 'source';
  operation: 'create' | 'update';
  sourceId: string;
  changedMetaFields: Array<'title' | 'url' | 'authors' | 'tags' | 'linkedEntities' | 'rawSourceRef' | 'supersedes' | 'freshnessStatus' | 'lastReviewedAt'>;
  summaryChanged: boolean;
  contentChanged: boolean;
  citations: SemanticListChange;
  baseline: SourceDocument | null;
  next: SourceDocument;
}

export type SemanticMirrorDiff =
  | { ok: true; path: string; recordKind: 'entity'; diff: SemanticEntityDiff }
  | { ok: true; path: string; recordKind: 'source'; diff: SemanticSourceDiff }
  | { ok: false; path: string; code: SemanticDiffFailureCode; message: string; issues?: string[] };

const ENTITY_META_FIELDS = ['title', 'aliases', 'handles', 'tags', 'status', 'owners', 'sources', 'confidence', 'supersedes', 'freshnessStatus', 'lastReviewedAt'] as const;
const SOURCE_META_FIELDS = ['title', 'url', 'authors', 'tags', 'linkedEntities', 'rawSourceRef', 'supersedes', 'freshnessStatus', 'lastReviewedAt'] as const;

export function diffSemanticMirrorRecord(input: {
  path: string;
  baselineMarkdown: string | null;
  editedMarkdown: string;
  canonicalMarkdown?: string | null;
}): SemanticMirrorDiff {
  const classification = classifySemanticMirrorPath(input.path);
  if (classification.pathClass !== 'editable-record' || !classification.recordKind) {
    return failure(input.path, 'unsupported_path', `Unsupported semantic mirror path: ${input.path}`);
  }
  if (input.canonicalMarkdown !== undefined && input.canonicalMarkdown !== input.baselineMarkdown) {
    return failure(input.path, 'remote_drift', `Canonical record changed since last sync: ${input.path}`);
  }

  return classification.recordKind === 'entity'
    ? diffEntityMirrorRecord(input.path, input.baselineMarkdown, input.editedMarkdown)
    : diffSourceMirrorRecord(input.path, input.baselineMarkdown, input.editedMarkdown);
}

function diffEntityMirrorRecord(
  path: string,
  baselineMarkdown: string | null,
  editedMarkdown: string
): SemanticMirrorDiff {
  const next = parseRecord(path, editedMarkdown, 'entity');
  if (!next.ok) return next;
  const issues = validateEntityDocument(next.value);
  if (issues.length > 0) return failure(path, 'validation_error', `Entity edit failed validation: ${path}`, issues);

  let baseline: EntityDocument | null = null;
  if (baselineMarkdown) {
    const parsed = parseRecord(path, baselineMarkdown, 'entity');
    if (!parsed.ok) return parsed;
    baseline = parsed.value;
    const baselineIssues = validateEntityDocument(baseline);
    if (baselineIssues.length > 0) {
      return failure(path, 'validation_error', `Baseline entity record is invalid: ${path}`, baselineIssues);
    }
  }

  return {
    ok: true,
    path,
    recordKind: 'entity',
    diff: {
      kind: 'entity',
      operation: baseline ? 'update' : 'create',
      entityId: next.value.meta.id,
      changedMetaFields: diffEntityMetaFields(baseline, next.value),
      currentTruthChanged: !baseline || baseline.currentTruth !== next.value.currentTruth,
      openQuestions: diffStringList(baseline?.openQuestions ?? [], next.value.openQuestions),
      timeline: diffStringList(baseline?.timeline ?? [], next.value.timeline),
      sources: diffStringList(baseline?.sources ?? [], next.value.sources),
      baseline,
      next: next.value
    }
  };
}

function diffSourceMirrorRecord(
  path: string,
  baselineMarkdown: string | null,
  editedMarkdown: string
): SemanticMirrorDiff {
  const next = parseRecord(path, editedMarkdown, 'source');
  if (!next.ok) return next;
  const issues = validateSourceDocument(next.value);
  if (issues.length > 0) return failure(path, 'validation_error', `Source edit failed validation: ${path}`, issues);

  let baseline: SourceDocument | null = null;
  if (baselineMarkdown) {
    const parsed = parseRecord(path, baselineMarkdown, 'source');
    if (!parsed.ok) return parsed;
    baseline = parsed.value;
    const baselineIssues = validateSourceDocument(baseline);
    if (baselineIssues.length > 0) {
      return failure(path, 'validation_error', `Baseline source record is invalid: ${path}`, baselineIssues);
    }
  }

  return {
    ok: true,
    path,
    recordKind: 'source',
    diff: {
      kind: 'source',
      operation: baseline ? 'update' : 'create',
      sourceId: next.value.meta.id,
      changedMetaFields: diffSourceMetaFields(baseline, next.value),
      summaryChanged: !baseline || baseline.summary !== next.value.summary,
      contentChanged: !baseline || baseline.content !== next.value.content,
      citations: diffStringList(baseline?.citations ?? [], next.value.citations),
      baseline,
      next: next.value
    }
  };
}

function parseRecord(
  path: string,
  markdown: string,
  kind: 'entity'
): { ok: true; value: EntityDocument } | { ok: false; path: string; code: SemanticDiffFailureCode; message: string; issues?: string[] };
function parseRecord(
  path: string,
  markdown: string,
  kind: 'source'
): { ok: true; value: SourceDocument } | { ok: false; path: string; code: SemanticDiffFailureCode; message: string; issues?: string[] };
function parseRecord(path: string, markdown: string, kind: 'entity' | 'source') {
  try {
    return {
      ok: true,
      value: kind === 'entity' ? parseEntityDocument(markdown) : parseSourceDocument(markdown)
    };
  } catch (error) {
    return failure(path, 'parse_error', error instanceof Error ? error.message : String(error));
  }
}

function diffStringList(baseline: string[], next: string[]): SemanticListChange {
  if (equalStringArrays(baseline, next)) {
    return { state: 'unchanged', added: [], removed: [] };
  }
  if (isAppendOnlyAddition(baseline, next)) {
    return {
      state: 'additive',
      added: next.slice(baseline.length),
      removed: []
    };
  }
  return {
    state: 'rewrite',
    added: next.filter((entry) => !baseline.includes(entry)),
    removed: baseline.filter((entry) => !next.includes(entry))
  };
}

function diffEntityMetaFields(
  baseline: EntityDocument | null,
  next: EntityDocument
): SemanticEntityDiff['changedMetaFields'] {
  if (!baseline) {
    return [...ENTITY_META_FIELDS]
      .filter((field) => hasEntityMetaValue(next, field));
  }
  const fields: SemanticEntityDiff['changedMetaFields'] = [];
  for (const field of ENTITY_META_FIELDS) {
    if (!equalMetaValue(readEntityMetaValue(baseline, field), readEntityMetaValue(next, field))) {
      fields.push(field);
    }
  }
  return fields;
}

function diffSourceMetaFields(
  baseline: SourceDocument | null,
  next: SourceDocument
): SemanticSourceDiff['changedMetaFields'] {
  if (!baseline) {
    return [...SOURCE_META_FIELDS]
      .filter((field) => hasSourceMetaValue(next, field));
  }
  const fields: SemanticSourceDiff['changedMetaFields'] = [];
  for (const field of SOURCE_META_FIELDS) {
    if (!equalMetaValue(readSourceMetaValue(baseline, field), readSourceMetaValue(next, field))) {
      fields.push(field);
    }
  }
  return fields;
}

function readEntityMetaValue(record: EntityDocument, field: SemanticEntityDiff['changedMetaFields'][number]): unknown {
  return record.meta[field];
}

function readSourceMetaValue(record: SourceDocument, field: SemanticSourceDiff['changedMetaFields'][number]): unknown {
  return record.meta[field];
}

function hasEntityMetaValue(record: EntityDocument, field: SemanticEntityDiff['changedMetaFields'][number]): boolean {
  const value = readEntityMetaValue(record, field);
  return hasMeaningfulValue(value);
}

function hasSourceMetaValue(record: SourceDocument, field: SemanticSourceDiff['changedMetaFields'][number]): boolean {
  const value = readSourceMetaValue(record, field);
  return hasMeaningfulValue(value);
}

function hasMeaningfulValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== '';
}

function equalMetaValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) return equalStringArrays(left, right);
  return left === right;
}

function equalStringArrays(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isAppendOnlyAddition(baseline: string[], next: string[]): boolean {
  return next.length >= baseline.length && baseline.every((value, index) => next[index] === value);
}

function failure(
  path: string,
  code: SemanticDiffFailureCode,
  message: string,
  issues?: string[]
): { ok: false; path: string; code: SemanticDiffFailureCode; message: string; issues?: string[] } {
  return issues?.length
    ? { ok: false, path, code, message, issues }
    : { ok: false, path, code, message };
}
