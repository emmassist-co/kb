export interface KbRuntimeContext {
  tenantId: string;
  backend: string;
  canonical: boolean;
  workspaceRole: 'canonical-production' | 'runtime-support';
}

export function createKbRuntimeContext(env: Record<string, unknown>): KbRuntimeContext {
  const backend = String(env.KB_BACKEND ?? 'runtime');
  const canonical = backend.trim().toLowerCase() === 'cloudflare';
  return {
    tenantId: String(env.WORKSPACE_TENANT_ID ?? env.KB_TENANT_ID ?? 'default'),
    backend,
    canonical,
    workspaceRole: canonical ? 'canonical-production' : 'runtime-support'
  };
}

export function renderKbRuntimeContract(context: KbRuntimeContext): string {
  return [
    'KB runtime contract',
    '',
    'Current workspace context:',
    `  tenant: ${context.tenantId}`,
    `  backend: ${context.backend}`,
    `  canonical: ${context.canonical ? 'yes' : 'no'}`,
    `  workspace role: ${context.workspaceRole}`,
    '',
    'Default runtime loop:',
    '  1. Use `kb search` before answering tenant-specific factual questions.',
    '  2. Use `kb query-relations` when the question is relation-shaped: owner, founder, approver, vendor-for, works-for.',
    '  3. Use `kb recall` only when the runtime explicitly wants a read-only trust-aware context bundle before it answers.',
    '  4. Use `kb remember` for new evidence, corrections, or source-backed facts.',
    '  5. Use `kb record` only when you already have an explicit canonical structured record to write.',
    '  6. Use `kb relate` for standalone explicit edges between existing entities.',
    '  7. Use `kb annotate` for timeline or provenance updates, not for relation creation.',
    '',
    'Write discipline:',
    '  - Read first if the fact may already exist.',
    '  - Separate evidence from compiled truth.',
    '  - Prefer `--json -` or `--json @file.json` for writes.',
    '  - Verify risky writes with `kb links`, `kb related`, or `kb traverse`.',
    '',
    'Do not use operator repair commands unless you are explicitly fixing KB state.',
    'If you need them, ask for `kb help operator`.'
  ].join('\n');
}
