import type { KnowledgeBaseService } from '@emmassist-co/kb-core';
import type {
  SemanticEntityDiff,
  SemanticMirrorDiff,
  SemanticSourceDiff
} from './diff.js';

type RecordInput = Parameters<KnowledgeBaseService['record']>[0];
type RecordSourceInput = Parameters<KnowledgeBaseService['recordSource']>[0];
type AnnotateInput = Parameters<KnowledgeBaseService['annotate']>[0];

export type SemanticCompileFailureCode =
  | 'diff_failed'
  | 'destructive_edit'
  | 'unsupported_mutation';

export type SemanticMutationCommand =
  | { kind: 'record'; payload: RecordInput }
  | { kind: 'record-source'; payload: RecordSourceInput }
  | { kind: 'annotate'; payload: AnnotateInput };

export type SemanticMutationPlan =
  | {
      ok: true;
      path: string;
      recordKind: 'entity' | 'source';
      commands: SemanticMutationCommand[];
    }
  | {
      ok: false;
      path: string;
      code: SemanticCompileFailureCode;
      message: string;
      issues?: string[];
    };

export function compileSemanticMirrorDiff(diff: SemanticMirrorDiff): SemanticMutationPlan {
  if (!diff.ok) {
    return {
      ok: false,
      path: diff.path,
      code: 'diff_failed',
      message: diff.message,
      issues: diff.issues
    };
  }

  return diff.recordKind === 'entity'
    ? compileEntityDiff(diff.path, diff.diff)
    : compileSourceDiff(diff.path, diff.diff);
}

function compileEntityDiff(path: string, diff: SemanticEntityDiff): SemanticMutationPlan {
  if (diff.operation === 'create') {
    return {
      ok: true,
      path,
      recordKind: 'entity',
      commands: [{
        kind: 'record',
        payload: {
          entity: {
            id: diff.next.meta.id,
            kind: diff.next.meta.kind,
            title: diff.next.meta.title,
            aliases: diff.next.meta.aliases,
            handles: diff.next.meta.handles,
            tags: diff.next.meta.tags,
            status: diff.next.meta.status,
            owners: diff.next.meta.owners,
            sources: diff.next.sources,
            confidence: diff.next.meta.confidence,
            currentTruth: diff.next.currentTruth,
            openQuestions: diff.next.openQuestions,
            timeline: diff.next.timeline,
            supersedes: diff.next.meta.supersedes,
            freshnessStatus: diff.next.meta.freshnessStatus,
            lastReviewedAt: diff.next.meta.lastReviewedAt
          }
        }
      }]
    };
  }

  const baseline = diff.baseline;
  if (!baseline) {
    return failure(path, 'unsupported_mutation', 'Entity update is missing a baseline record.');
  }

  const metaArrayIssues = [
    ensureAppendOnlyArray('aliases', baseline.meta.aliases, diff.next.meta.aliases),
    ensureAppendOnlyArray('handles', baseline.meta.handles, diff.next.meta.handles),
    ensureAppendOnlyArray('tags', baseline.meta.tags, diff.next.meta.tags),
    ensureAppendOnlyArray('owners', baseline.meta.owners, diff.next.meta.owners),
    ensureAppendOnlyArray('supersedes', baseline.meta.supersedes ?? [], diff.next.meta.supersedes ?? []),
    ensureAppendOnlyArray('source references', baseline.sources, diff.next.sources)
  ].filter((issue): issue is string => Boolean(issue));
  if (metaArrayIssues.length > 0) {
    return failure(path, 'destructive_edit', `Entity edit requires exact rewrite semantics: ${path}`, metaArrayIssues);
  }
  if (diff.openQuestions.state === 'rewrite') {
    return failure(path, 'destructive_edit', `Entity open questions rewrite is not supported in semantic sync: ${path}`);
  }
  if (diff.timeline.state === 'rewrite') {
    return failure(path, 'destructive_edit', `Entity timeline rewrite is not supported in semantic sync: ${path}`);
  }
  if (diff.sources.state === 'rewrite') {
    return failure(path, 'destructive_edit', `Entity source reference rewrite is not supported in semantic sync: ${path}`);
  }

  const entity: RecordInput['entity'] = {
    id: diff.next.meta.id,
    kind: diff.next.meta.kind,
    title: diff.next.meta.title
  };
  if (diff.changedMetaFields.includes('aliases')) entity.aliases = appendedValues(baseline.meta.aliases, diff.next.meta.aliases);
  if (diff.changedMetaFields.includes('handles')) entity.handles = appendedValues(baseline.meta.handles, diff.next.meta.handles);
  if (diff.changedMetaFields.includes('tags')) entity.tags = appendedValues(baseline.meta.tags, diff.next.meta.tags);
  if (diff.changedMetaFields.includes('status')) entity.status = diff.next.meta.status;
  if (diff.changedMetaFields.includes('owners')) entity.owners = appendedValues(baseline.meta.owners, diff.next.meta.owners);
  if (diff.changedMetaFields.includes('sources')) entity.sources = appendedValues(baseline.sources, diff.next.sources);
  if (diff.changedMetaFields.includes('confidence')) entity.confidence = diff.next.meta.confidence;
  if (diff.changedMetaFields.includes('supersedes')) entity.supersedes = appendedValues(baseline.meta.supersedes ?? [], diff.next.meta.supersedes ?? []);
  if (diff.changedMetaFields.includes('freshnessStatus')) entity.freshnessStatus = diff.next.meta.freshnessStatus;
  if (diff.changedMetaFields.includes('lastReviewedAt')) entity.lastReviewedAt = diff.next.meta.lastReviewedAt;
  if (diff.currentTruthChanged) entity.currentTruth = diff.next.currentTruth;
  if (diff.openQuestions.state === 'additive') entity.openQuestions = diff.openQuestions.added;

  const commands: SemanticMutationCommand[] = [];
  if (hasEntityMutation(entity)) {
    commands.push({ kind: 'record', payload: { entity } });
  }
  for (const line of diff.timeline.added) {
    commands.push({ kind: 'annotate', payload: compileTimelineAnnotation(diff.next.meta.id, line) });
  }
  return {
    ok: true,
    path,
    recordKind: 'entity',
    commands
  };
}

function compileSourceDiff(path: string, diff: SemanticSourceDiff): SemanticMutationPlan {
  return {
    ok: true,
    path,
    recordKind: 'source',
    commands: [{
      kind: 'record-source',
      payload: {
        source: {
          id: diff.next.meta.id,
          kind: diff.next.meta.kind,
          title: diff.next.meta.title,
          url: diff.next.meta.url,
          authors: diff.next.meta.authors,
          tags: diff.next.meta.tags,
          linkedEntities: diff.next.meta.linkedEntities,
          createdAt: diff.next.meta.createdAt,
          summary: diff.next.summary,
          content: diff.next.content,
          citations: diff.next.citations,
          rawSourceRef: diff.next.meta.rawSourceRef,
          supersedes: diff.next.meta.supersedes,
          freshnessStatus: diff.next.meta.freshnessStatus,
          lastReviewedAt: diff.next.meta.lastReviewedAt
        }
      }
    }]
  };
}

function hasEntityMutation(entity: RecordInput['entity']): boolean {
  return Boolean(
    entity.currentTruth
    || entity.aliases?.length
    || entity.handles?.length
    || entity.tags?.length
    || entity.status
    || entity.owners?.length
    || entity.sources?.length
    || entity.confidence
    || entity.openQuestions?.length
    || entity.supersedes?.length
    || entity.freshnessStatus
    || entity.lastReviewedAt
  );
}

function ensureAppendOnlyArray(label: string, baseline: string[], next: string[]): string | null {
  return isAppendOnlyArray(baseline, next)
    ? null
    : `${label} removed or reordered existing entries`;
}

function appendedValues(baseline: string[], next: string[]): string[] {
  return next.slice(baseline.length);
}

function isAppendOnlyArray(baseline: string[], next: string[]): boolean {
  return next.length >= baseline.length && baseline.every((value, index) => next[index] === value);
}

function compileTimelineAnnotation(entityId: string, line: string): AnnotateInput {
  const match = /^(\d{4}-\d{2}-\d{2}):\s*(.+)$/.exec(line);
  if (!match) {
    return {
      entityIds: [entityId],
      summary: line
    };
  }
  return {
    entityIds: [entityId],
    summary: match[2],
    effectiveAt: `${match[1]}T00:00:00.000Z`
  };
}

function failure(
  path: string,
  code: SemanticCompileFailureCode,
  message: string,
  issues?: string[]
): SemanticMutationPlan {
  return { ok: false, path, code, message, issues };
}
