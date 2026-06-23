export type KnowledgeBaseOperatorSeverity = 'error' | 'warning' | 'info';

export interface KnowledgeBaseOperatorIssue {
  path?: string;
  recordKind?: 'entity' | 'source';
  code: string;
  severity: KnowledgeBaseOperatorSeverity;
  message: string;
  issues?: string[];
  nextAction?: string;
}

export function summarizeOperatorIssues(issues: KnowledgeBaseOperatorIssue[]): {
  blockers: KnowledgeBaseOperatorIssue[];
  warnings: KnowledgeBaseOperatorIssue[];
  counts: {
    blockers: number;
    warnings: number;
    info: number;
  };
} {
  const blockers = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  return {
    blockers,
    warnings,
    counts: {
      blockers: blockers.length,
      warnings: warnings.length,
      info: issues.filter((issue) => issue.severity === 'info').length
    }
  };
}

export function compactNextActions(issues: KnowledgeBaseOperatorIssue[]): string[] {
  return [...new Set(issues.map((issue) => issue.nextAction).filter((action): action is string => Boolean(action)))];
}
