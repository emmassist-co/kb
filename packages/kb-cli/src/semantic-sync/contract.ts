export type SemanticMirrorPathClass = 'editable-record' | 'support-only' | 'daemon-state';
export type SemanticEditableRecordKind = 'entity' | 'source';

export interface SemanticMirrorPathClassification {
  path: string;
  pathClass: SemanticMirrorPathClass;
  recordKind?: SemanticEditableRecordKind;
  reason:
    | 'entity_markdown'
    | 'source_markdown'
    | 'daemon_manifest'
    | 'daemon_baseline'
    | 'daemon_conflict_artifact'
    | 'generated_draft'
    | 'generated_event'
    | 'generated_registry'
    | 'generated_relation'
    | 'generated_meta'
    | 'unsupported_path';
}

export function classifySemanticMirrorPath(entryPath: string): SemanticMirrorPathClassification {
  const normalized = normalizeMirrorPath(entryPath);

  if (normalized === '.kb-sync-manifest.json') {
    return { path: normalized, pathClass: 'daemon-state', reason: 'daemon_manifest' };
  }
  if (normalized.startsWith('.kb-sync-base/')) {
    return { path: normalized, pathClass: 'daemon-state', reason: 'daemon_baseline' };
  }
  if (normalized.startsWith('.kb-sync-conflicts/')) {
    return { path: normalized, pathClass: 'daemon-state', reason: 'daemon_conflict_artifact' };
  }
  if (normalized.startsWith('entities/') && normalized.endsWith('.md')) {
    return { path: normalized, pathClass: 'editable-record', recordKind: 'entity', reason: 'entity_markdown' };
  }
  if (normalized.startsWith('sources/') && normalized.endsWith('.md')) {
    return { path: normalized, pathClass: 'editable-record', recordKind: 'source', reason: 'source_markdown' };
  }
  if (normalized.startsWith('drafts/') && normalized.endsWith('.json')) {
    return { path: normalized, pathClass: 'support-only', reason: 'generated_draft' };
  }
  if (normalized.startsWith('events/') && normalized.endsWith('.json')) {
    return { path: normalized, pathClass: 'support-only', reason: 'generated_event' };
  }
  if (normalized.startsWith('registry/') && normalized.endsWith('.json')) {
    return { path: normalized, pathClass: 'support-only', reason: 'generated_registry' };
  }
  if (normalized.startsWith('links/')) {
    return { path: normalized, pathClass: 'support-only', reason: 'generated_relation' };
  }
  if (normalized === 'meta/version.json') {
    return { path: normalized, pathClass: 'support-only', reason: 'generated_meta' };
  }
  return { path: normalized, pathClass: 'support-only', reason: 'unsupported_path' };
}

export function isSemanticEditableMirrorPath(entryPath: string): boolean {
  return classifySemanticMirrorPath(entryPath).pathClass === 'editable-record';
}

function normalizeMirrorPath(entryPath: string): string {
  return entryPath.replaceAll('\\', '/').replace(/^\/+/, '');
}
