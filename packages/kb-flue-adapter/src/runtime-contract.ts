import { KNOWLEDGE_TRUST_SUBSTRATE_CONTRACT_VERSION } from '@emmassist-co/kb-core';

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
    `  trust substrate: ${KNOWLEDGE_TRUST_SUBSTRATE_CONTRACT_VERSION}`,
    '',
    'Default runtime loop:',
    '  1. Use `kb inspect` first if workspace/backend/canonicality is unknown.',
    '  2. Use `kb search` before answering tenant-specific factual questions; inspect returned `trust` caveats.',
    '  3. Use `kb query-relations` when the question is relation-shaped: owner, founder, approver, vendor-for, works-for.',
    '  4. Use `kb evidence --id ENTITY_ID` before asserting weak, surprising, stale, or caveated facts.',
    '  5. Use `kb recall` only when the runtime explicitly wants a read-only trust-aware context bundle before it answers.',
    '  6. Use `kb remember` for new raw evidence, corrections, or source-backed notes.',
    '  7. Use `kb submit-proposal` when evidence suggests canonical truth should change but review is needed.',
    '  8. Use `kb record` only when you already have an explicit canonical structured record to write.',
    '  9. Use `kb relate` for standalone explicit edges between existing entities.',
    '  10. Use `kb annotate` for timeline or provenance updates, not for relation creation.',
    '',
    'Trust and write discipline:',
    '  - Read first if the fact may already exist.',
    '  - Separate raw evidence from compiled current truth.',
    '  - Recall is read-only; the Flue runtime decides if and when to inject it.',
    '  - Raw notes and proposals do not become canonical truth until an authorized record/apply path runs.',
    '  - Prefer `--json -` or `--json @file.json` for writes.',
    '  - Verify risky writes with `kb evidence`, `kb links`, `kb related`, or `kb traverse`.',
    '  - Use `kb debt`, `kb reviews`, `kb review-proposal`, and `kb apply-proposal` only for explicit operator/review workflows.',
    '',
    'Do not use operator repair commands unless you are explicitly fixing KB state.',
    'If you need them, ask for `kb help operator`.'
  ].join('\n');
}
