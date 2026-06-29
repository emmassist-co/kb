import type { KnowledgeEntityKind, KnowledgePageFamily } from './types.js';

export function inferPageFamily(kind: KnowledgeEntityKind): KnowledgePageFamily {
  if (kind === 'process') return 'process';
  if (kind === 'meeting') return 'meeting';
  if (kind === 'project') return 'project';
  if (kind === 'decision') return 'decision';
  if (kind === 'policy') return 'policy';
  if (kind === 'system') return 'system';
  if (kind === 'team') return 'team';
  return 'entity';
}
