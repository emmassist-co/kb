import path from 'node:path';
import type { CandidateDiffSummary } from './types.js';

export function validateCandidateDiff(
  diffSummary: CandidateDiffSummary,
  allowlist: string[],
  maxChangedFiles: number,
  maxUnifiedDiffLines: number
): { ok: boolean; reason?: string } {
  if (diffSummary.changedFiles.length === 0) {
    return { ok: false, reason: 'Candidate produced no file changes.' };
  }
  if (diffSummary.changedFiles.length > maxChangedFiles) {
    return { ok: false, reason: `Candidate changed too many files (${diffSummary.changedFiles.length}).` };
  }
  if (diffSummary.unifiedDiffLines > maxUnifiedDiffLines) {
    return { ok: false, reason: `Candidate diff is too large (${diffSummary.unifiedDiffLines} changed lines).` };
  }
  for (const file of diffSummary.changedFiles) {
    if (!isAllowedPath(file, allowlist)) {
      return { ok: false, reason: `Candidate touched forbidden path: ${file}` };
    }
  }
  return { ok: true };
}

export function isAllowedPath(file: string, allowlist: string[]): boolean {
  const normalized = path.posix.normalize(file.replace(/\\/g, '/'));
  return allowlist.some((allowed) => normalized === allowed || normalized.startsWith(`${allowed}/`));
}
