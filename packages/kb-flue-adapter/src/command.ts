import type { KnowledgeLinkOrigin, KnowledgeStore } from '@emmassist-co/kb-core/store';
import type { KnowledgeEntityKind } from '@emmassist-co/kb-core/types';
import type { InMemoryFs } from 'just-bash';
import type {
  FlueKbHostAdapter,
  FlueKbKnowledgeBaseConfig,
  FlueKbProductConfig,
  FlueKbRuntime,
  FlueKbService
} from './config.js';

interface FlueCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface FlueCommandLike {
  name: string;
  execute(args: string[]): Promise<FlueCommandResult>;
}

const SUPPORTED_DIRECT_COMMANDS = new Set([
  'inspect',
  'list',
  'get',
  'delete',
  'capture-source',
  'events',
  'get-event',
  'delete-event',
  'drafts',
  'get-draft',
  'put-draft',
  'delete-draft',
  'relations',
  'replace-relations',
  'clear-relations',
  'search',
  'query-relations',
  'remember',
  'record',
  'relate',
  'annotate',
  'record-batch',
  'annotate-batch',
  'schema',
  'validate',
  'related',
  'links',
  'traverse',
  'rebuild',
  'doctor',
  'export'
]);

const MUTATION_COMMANDS = new Set([
  'delete',
  'remember',
  'record',
  'relate',
  'annotate',
  'record-batch',
  'annotate-batch'
]);

type WorkspaceRole = 'canonical-production' | 'runtime-support';

interface KbSurfaceContext {
  tenantId: string;
  backend: string;
  transport: 'flue';
  canonical: boolean;
  workspaceRole: WorkspaceRole;
}


export function createKbCommand(
  fs: InMemoryFs,
  env: Record<string, unknown>,
  options: { runtime?: FlueKbRuntime; host: FlueKbHostAdapter }
): FlueCommandLike {
  return {
    name: 'kb',
    execute: async (args) => {
      const parsed = parseSimpleArgs(args);
      const command = parsed.positionals[0] ?? 'help';
      const helpTopic = command === 'help' ? parsed.positionals[1] : command;
      const format = readString(parsed.flags.format);

      if (command === 'help' || parsed.flags.help) {
        if (helpTopic === 'runtime') {
          return renderRuntimeHelp(fs, env, options.host);
        }
        if (helpTopic === 'operator') {
          return renderOperatorHelp();
        }
        if (helpTopic === 'memory-read') {
          return renderMemoryReadHelp();
        }
        if (helpTopic === 'memory-write') {
          return renderMemoryWriteHelp();
        }
        if (!helpTopic) {
          return renderPublicHelp();
        }
        return executeDirectCommand(fs, env, args, options.runtime, options.host);
      }

      if (command === 'inspect') {
        return executeInspect(fs, env, options.runtime, options.host);
      }

      if (command === 'schema') {
        return executeSchema(parsed);
      }

      if (command === 'validate') {
        return executeValidate(fs, args, parsed);
      }

      if (command === 'delete') {
        return executeDelete(fs, env, options.runtime, options.host, parsed);
      }

      if (command === 'memory-read') {
        return executeMemoryRead(fs, env, options.runtime, options.host, args, parsed);
      }

      if (command === 'memory-write') {
        return executeMemoryWrite(fs, env, options.runtime, options.host, args, parsed);
      }

      if (command === 'restore-canonical') {
        return executeRestoreCanonical(format, options.runtime);
      }

      if (!SUPPORTED_DIRECT_COMMANDS.has(command)) {
        return renderFailure(
          `Unknown kb command: ${command}`,
          format,
          2,
          'VALIDATION_ERROR',
          { command, duration_ms: 0 }
        );
      }

      const result = await executeDirectCommand(fs, env, args, options.runtime, options.host);
      return MUTATION_COMMANDS.has(command) ? addMutationAction(command, result) : result;
    }
  };
}

async function executeDirectCommand(
  fs: InMemoryFs,
  env: Record<string, unknown>,
  args: string[],
  runtime: FlueKbRuntime | undefined,
  host: FlueKbHostAdapter
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const startedAt = Date.now();
  const normalizedArgs = normalizeAgentFriendlyArgs(args);
  const parsed = parseSimpleArgs(normalizedArgs);
  const command = parsed.positionals[0] ?? 'help';
  const format = readString(parsed.flags.format);
  const emptyQueryResult = buildEmptyQueryResult(command, parsed);
  if (emptyQueryResult) {
    return renderSuccess(emptyQueryResult, { command, duration_ms: 0 });
  }

  try {
    const runtimeProductConfig = await resolveRuntimeProductConfig(fs, env, host);
    const kbRuntime = runtime ?? host.createRuntime(env, runtimeProductConfig.tenant.id, runtimeProductConfig.knowledgeBase);
    if (command === 'rebuild') {
      return renderSuccess(await kbRuntime.rebuild(), { command, duration_ms: Date.now() - startedAt });
    }
    const service = await resolveCommandService(fs, env, runtime, host);
    let result: { stdout: string; stderr: string; exitCode: number };

    switch (command) {
      case 'list':
        result = renderSuccess(await service.list(), { command, duration_ms: Date.now() - startedAt });
        break;
      case 'get': {
        const id = readDeleteId(parsed);
        result = renderSuccess(await service.get(id), { command, duration_ms: Date.now() - startedAt });
        break;
      }
      case 'capture-source': {
        const payloadResult = await resolveJsonPayload(fs, parsed, command, ['kb capture-source --json {"title":"Finance note","content":"..."}']);
        if ('error' in payloadResult) return renderFailure(payloadResult.error, format, 2, 'VALIDATION_ERROR', { command, duration_ms: 0 });
        result = renderSuccess(await service.captureSource(payloadResult.payload as Parameters<FlueKbService['captureSource']>[0]), { command, duration_ms: Date.now() - startedAt });
        break;
      }
      case 'events':
        result = renderSuccess(await service.listEvents(), { command, duration_ms: Date.now() - startedAt });
        break;
      case 'get-event': {
        const id = readDeleteId(parsed);
        result = renderSuccess(await service.getEvent(id), { command, duration_ms: Date.now() - startedAt });
        break;
      }
      case 'delete-event': {
        const id = readDeleteId(parsed);
        result = renderSuccess(await service.deleteEvent(id), { command, duration_ms: Date.now() - startedAt });
        break;
      }
      case 'drafts':
        result = renderSuccess(await service.listDrafts(), { command, duration_ms: Date.now() - startedAt });
        break;
      case 'get-draft': {
        const id = readDeleteId(parsed);
        result = renderSuccess(await service.getDraft(id), { command, duration_ms: Date.now() - startedAt });
        break;
      }
      case 'put-draft': {
        const payloadResult = await resolveJsonPayload(fs, parsed, command, ['kb put-draft --json {"entityId":"vendor-stripe","title":"Stripe"}']);
        if ('error' in payloadResult) return renderFailure(payloadResult.error, format, 2, 'VALIDATION_ERROR', { command, duration_ms: 0 });
        result = renderSuccess(await service.updateEntityDraft(payloadResult.payload as Parameters<FlueKbService['updateEntityDraft']>[0]), { command, duration_ms: Date.now() - startedAt });
        break;
      }
      case 'delete-draft': {
        const id = readDeleteId(parsed);
        result = renderSuccess(await service.deleteDraft(id), { command, duration_ms: Date.now() - startedAt });
        break;
      }
      case 'relations': {
        result = renderSuccess(await service.listRelations({
          entityId: readString(parsed.flags['entity-id']) ?? readString(parsed.flags.entityId),
          originKind: readString(parsed.flags['origin-kind']) as Parameters<FlueKbService['clearRelations']>[0]['kind'],
          originId: readString(parsed.flags['origin-id']),
          type: readString(parsed.flags.type)
        }), { command, duration_ms: Date.now() - startedAt });
        break;
      }
      case 'replace-relations': {
        const payloadResult = await resolveJsonPayload(fs, parsed, command, ['kb replace-relations --json {"origin":{"kind":"entity","id":"vendor-stripe"},"links":[]}']);
        if ('error' in payloadResult) return renderFailure(payloadResult.error, format, 2, 'VALIDATION_ERROR', { command, duration_ms: 0 });
        result = renderSuccess(await service.replaceRelations(payloadResult.payload as Parameters<FlueKbService['replaceRelations']>[0]), { command, duration_ms: Date.now() - startedAt });
        break;
      }
      case 'clear-relations': {
        const originKind = readString(parsed.flags['origin-kind']);
        const originId = readString(parsed.flags['origin-id']);
        if (!originKind || !originId) return renderFailure('clear-relations requires --origin-kind and --origin-id.', format, 2, 'VALIDATION_ERROR', { command, duration_ms: 0 });
        result = renderSuccess(await service.clearRelations({ kind: originKind as Parameters<FlueKbService['clearRelations']>[0]['kind'], id: originId }), { command, duration_ms: Date.now() - startedAt });
        break;
      }
      case 'search': {
        const payloadResult = await resolveJsonPayload(fs, parsed, command, ['kb search --json {"query":"billing stripe","limit":5}']);
        if ('error' in payloadResult) return renderFailure(payloadResult.error, format, 2, 'VALIDATION_ERROR', { command, duration_ms: 0 });
        result = renderSuccess(await service.search(payloadResult.payload as unknown as Parameters<FlueKbService['search']>[0]), { command, duration_ms: Date.now() - startedAt });
        break;
      }
      case 'query-relations': {
        const payloadResult = await resolveJsonPayload(fs, parsed, command, ['kb query-relations --json {"query":"founder of acme","limit":5}']);
        if ('error' in payloadResult) return renderFailure(payloadResult.error, format, 2, 'VALIDATION_ERROR', { command, duration_ms: 0 });
        result = renderSuccess(await service.queryRelations(payloadResult.payload as unknown as Parameters<FlueKbService['queryRelations']>[0]), { command, duration_ms: Date.now() - startedAt });
        break;
      }
      case 'remember': {
        const payloadResult = await resolveJsonPayload(fs, parsed, command, ['kb remember --json {"intent":"fact_update","summary":"..."}']);
        if ('error' in payloadResult) return renderFailure(payloadResult.error, format, 2, 'VALIDATION_ERROR', { command, duration_ms: 0 });
        const issues = validateRememberPayload(payloadResult.payload as Record<string, unknown>);
        if (issues.length > 0) return renderFailure(`Invalid remember payload: ${issues.join(' ')}`, format, 2, 'VALIDATION_ERROR', { command, duration_ms: 0 });
        const rememberPayload = normalizeRememberExecutionPayload(payloadResult.payload as Record<string, unknown>);
        result = renderSuccess(await service.remember(rememberPayload), { command, duration_ms: Date.now() - startedAt });
        break;
      }
      case 'record': {
        const payloadResult = await resolveJsonPayload(fs, parsed, command, ['kb record --json {"entity":{"id":"vendor-stripe","kind":"vendor","title":"Stripe"}}']);
        if ('error' in payloadResult) return renderFailure(payloadResult.error, format, 2, 'VALIDATION_ERROR', { command, duration_ms: 0 });
        const issues = validateRecordPayload(payloadResult.payload as Record<string, unknown>);
        if (issues.length > 0) return renderFailure(`Invalid record payload: ${issues.join(' ')}`, format, 2, 'VALIDATION_ERROR', { command, duration_ms: 0 });
        result = renderSuccess(await service.record(payloadResult.payload as Parameters<FlueKbService['record']>[0]), { command, duration_ms: Date.now() - startedAt });
        break;
      }
      case 'relate': {
        const payloadResult = await resolveJsonPayload(fs, parsed, command, ['kb relate --json {"type":"owns","fromId":"person-alex","toId":"company-acme"}']);
        if ('error' in payloadResult) return renderFailure(payloadResult.error, format, 2, 'VALIDATION_ERROR', { command, duration_ms: 0 });
        const issues = validateRelatePayload(payloadResult.payload as Record<string, unknown>);
        if (issues.length > 0) return renderFailure(`Invalid relate payload: ${issues.join(' ')}`, format, 2, 'VALIDATION_ERROR', { command, duration_ms: 0 });
        result = renderSuccess(await service.relate(payloadResult.payload as Parameters<FlueKbService['relate']>[0]), { command, duration_ms: Date.now() - startedAt });
        break;
      }
      case 'annotate': {
        const payloadResult = await resolveJsonPayload(fs, parsed, command, ['kb annotate --json {"entity_ids":["vendor-stripe"],"summary":"..."}']);
        if ('error' in payloadResult) return renderFailure(payloadResult.error, format, 2, 'VALIDATION_ERROR', { command, duration_ms: 0 });
        const issues = validateAnnotatePayload(payloadResult.payload as Record<string, unknown>);
        if (issues.length > 0) return renderFailure(`Invalid annotate payload: ${issues.join(' ')}`, format, 2, 'VALIDATION_ERROR', { command, duration_ms: 0 });
        result = renderSuccess(await service.annotate(normalizeAnnotateExecutionPayload(payloadResult.payload as Record<string, unknown>)), { command, duration_ms: Date.now() - startedAt });
        break;
      }
      case 'record-batch': {
        const payloadResult = await resolveJsonPayload(fs, parsed, command, ['kb record-batch --json [{"entity":{"id":"person-alex","kind":"person","title":"Alex"}}]'], true);
        if ('error' in payloadResult) return renderFailure(payloadResult.error, format, 2, 'VALIDATION_ERROR', { command, duration_ms: 0 });
        const issues = validateRecordBatchPayload(payloadResult.payload);
        if (issues.length > 0) return renderFailure(`Invalid record-batch payload: ${issues.join(' ')}`, format, 2, 'VALIDATION_ERROR', { command, duration_ms: 0 });
        const items = [] as Awaited<ReturnType<FlueKbService['record']>>[];
        for (const item of payloadResult.payload as Record<string, unknown>[]) {
          items.push(await service.record(item as Parameters<FlueKbService['record']>[0]));
        }
        result = renderSuccess({ count: items.length, items }, { command, duration_ms: Date.now() - startedAt });
        break;
      }
      case 'annotate-batch': {
        const payloadResult = await resolveJsonPayload(fs, parsed, command, ['kb annotate-batch --json [{"entity_ids":["vendor-stripe"],"summary":"..."}]'], true);
        if ('error' in payloadResult) return renderFailure(payloadResult.error, format, 2, 'VALIDATION_ERROR', { command, duration_ms: 0 });
        const issues = validateAnnotateBatchPayload(payloadResult.payload);
        if (issues.length > 0) return renderFailure(`Invalid annotate-batch payload: ${issues.join(' ')}`, format, 2, 'VALIDATION_ERROR', { command, duration_ms: 0 });
        const items = [] as Awaited<ReturnType<FlueKbService['annotate']>>[];
        for (const item of payloadResult.payload as Record<string, unknown>[]) {
          items.push(await service.annotate(normalizeAnnotateExecutionPayload(item)));
        }
        result = renderSuccess({ count: items.length, items }, { command, duration_ms: Date.now() - startedAt });
        break;
      }
      case 'related': {
        const id = readDeleteId(parsed);
        result = renderSuccess(await service.related(id), { command, duration_ms: Date.now() - startedAt });
        break;
      }
      case 'links': {
        const id = readDeleteId(parsed);
        result = renderSuccess(await service.links(id), { command, duration_ms: Date.now() - startedAt });
        break;
      }
      case 'traverse': {
        const id = readDeleteId(parsed);
        result = renderSuccess(await service.traverse({
          id,
          type: readString(parsed.flags.type),
          direction: readString(parsed.flags.direction) as Parameters<FlueKbService['traverse']>[0]['direction'],
          depth: parsed.flags.depth ? Number(parsed.flags.depth) : undefined,
          explicitOnly: parsed.flags['explicit-only'] === true,
          originKind: readString(parsed.flags['origin-kind']) as Parameters<FlueKbService['traverse']>[0]['originKind']
        }), { command, duration_ms: Date.now() - startedAt });
        break;
      }
      case 'doctor':
        result = renderSuccess(await service.doctor(), { command, duration_ms: Date.now() - startedAt });
        break;
      case 'export':
        result = renderSuccess(await service.export(), { command, duration_ms: Date.now() - startedAt });
        break;
      default:
        return renderFailure(`Unknown kb command: ${command}`, format, 2, 'VALIDATION_ERROR', { command, duration_ms: 0 });
    }

    return result;
  } catch (error) {
    return renderFailure(error instanceof Error ? error.message : String(error), format, 1, 'COMMAND_FAILED', { command, duration_ms: Date.now() - startedAt });
  }
}

async function resolveCommandService(
  fs: InMemoryFs,
  env: Record<string, unknown>,
  runtime: FlueKbRuntime | undefined,
  host: FlueKbHostAdapter
): Promise<FlueKbService> {
  const productConfig = await resolveRuntimeProductConfig(fs, env, host);
  return runtime
    ? await runtime.getService()
    : host.createService(env, productConfig.tenant.id, productConfig.knowledgeBase);
}

async function executeMemoryRead(
  fs: InMemoryFs,
  env: Record<string, unknown>,
  runtime: FlueKbRuntime | undefined,
  host: FlueKbHostAdapter,
  args: string[],
  parsed: { positionals: string[]; flags: Record<string, string | boolean> }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const format = readString(parsed.flags.format);
  const command = 'memory-read';
  const startedAt = Date.now();
  const payloadResult = await resolveMemoryPayload(fs, args, parsed, command, [
    'kb memory-read --json {"subjectEntityId":"vendor-kinto","memoryKind":"vendor"}',
    'kb memory-read --json {"query":"employee reimbursements","memoryKind":"procedure"}'
  ]);
  if ('error' in payloadResult) {
    return renderFailure(payloadResult.error, format, 2, 'VALIDATION_ERROR', { command, duration_ms: 0 });
  }
  const payload = payloadResult.payload;
  const issues = validateMemoryReadPayload(payload);
  if (issues.length > 0) {
    return renderFailure(`Invalid memory-read payload: ${issues.join(' ')}`, format, 2, 'VALIDATION_ERROR', { command, duration_ms: 0 });
  }
  const service = await resolveCommandService(fs, env, runtime, host);
  const data = await service.readMemory({
    query: readString(payload.query),
    subjectEntityId: readString(payload.subjectEntityId) ?? readString(payload.subject_entity_id),
    memoryKind: readString(payload.memoryKind) as Parameters<FlueKbService['readMemory']>[0]['memoryKind'],
    userId: readString(payload.userId) ?? readString(payload.user_id),
    proposedValue: readString(payload.proposedValue) ?? readString(payload.proposed_value),
    includeCandidates: payload.includeCandidates === true || payload.include_candidates === true,
    includeSuperseded: payload.includeSuperseded === true || payload.include_superseded === true,
    limit: typeof payload.limit === 'number' ? payload.limit : undefined
  });
  return renderSuccess(data, { command, duration_ms: Date.now() - startedAt });
}

async function executeMemoryWrite(
  fs: InMemoryFs,
  env: Record<string, unknown>,
  runtime: FlueKbRuntime | undefined,
  host: FlueKbHostAdapter,
  args: string[],
  parsed: { positionals: string[]; flags: Record<string, string | boolean> }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const format = readString(parsed.flags.format);
  const command = 'memory-write';
  const startedAt = Date.now();
  const payloadResult = await resolveMemoryPayload(fs, args, parsed, command, [
    'kb memory-write --json {"scope":"user","memoryKind":"user_preference","summary":"Start bookkeeping answers with ALEX: and keep them to one short sentence.","userId":"alex","policy":"explicit_confirmation"}',
    'kb memory-write --json {"scope":"instance","memoryKind":"vendor","subjectEntityId":"vendor-kinto","summary":"Kinto should use vehicle subscription as the recurring category.","policy":"explicit_correction"}'
  ]);
  if ('error' in payloadResult) {
    return renderFailure(payloadResult.error, format, 2, 'VALIDATION_ERROR', { command, duration_ms: 0 });
  }
  const payload = payloadResult.payload;
  const issues = validateMemoryWritePayload(payload);
  if (issues.length > 0) {
    return renderFailure(`Invalid memory-write payload: ${issues.join(' ')}`, format, 2, 'VALIDATION_ERROR', { command, duration_ms: 0 });
  }
  const scope = readString(payload.scope);
  const memoryKind = readString(payload.memoryKind) ?? readString(payload.memory_kind);
  const summary = readString(payload.summary);
  const policy = readString(payload.policy);
  const subjectPayload = typeof payload.subject === 'object' && payload.subject !== null && !Array.isArray(payload.subject)
    ? payload.subject as Record<string, unknown>
    : null;
  const service = await resolveCommandService(fs, env, runtime, host);
  const data = await service.writeMemory({
    scope: scope as Parameters<FlueKbService['writeMemory']>[0]['scope'],
    memoryKind: memoryKind as Parameters<FlueKbService['writeMemory']>[0]['memoryKind'],
    summary: summary!,
    subjectEntityId: readString(payload.subjectEntityId) ?? readString(payload.subject_entity_id),
    subject: subjectPayload && readString(subjectPayload.title) && readString(subjectPayload.kind)
      ? {
          id: readString(subjectPayload.id),
          kind: readString(subjectPayload.kind) as Exclude<KnowledgeEntityKind, 'memory'>,
          title: readString(subjectPayload.title)!,
          aliases: Array.isArray(subjectPayload.aliases) ? subjectPayload.aliases.filter((entry): entry is string => typeof entry === 'string') : undefined
        }
      : undefined,
    userId: readString(payload.userId) ?? readString(payload.user_id),
    reasoningNote: readString(payload.reasoningNote) ?? readString(payload.reasoning_note),
    confidence: readString(payload.confidence) as Parameters<FlueKbService['writeMemory']>[0]['confidence'],
    policy: policy as Parameters<FlueKbService['writeMemory']>[0]['policy'],
    repeatThreshold: typeof payload.repeatThreshold === 'number' ? payload.repeatThreshold : (typeof payload.repeat_threshold === 'number' ? payload.repeat_threshold : undefined),
    sourceIds: Array.isArray(payload.sourceIds) ? payload.sourceIds.filter((entry): entry is string => typeof entry === 'string') : undefined,
    effectiveAt: readString(payload.effectiveAt) ?? readString(payload.effective_at)
  });
  return renderSuccess({ action: 'kb_memory_written', ...data }, { command, duration_ms: Date.now() - startedAt });
}

async function executeSchema(
  parsed: { positionals: string[]; flags: Record<string, string | boolean> }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const target = parsed.positionals[1];
  if (target === 'memory-read') {
    return renderSuccess(buildMemoryReadSchema(), { command: 'schema', duration_ms: 0 });
  }
  if (target === 'memory-write') {
    return renderSuccess(buildMemoryWriteSchema(), { command: 'schema', duration_ms: 0 });
  }
  if (target === 'remember') {
    return renderSuccess(buildRememberSchema(), { command: 'schema', duration_ms: 0 });
  }
  if (target === 'record') {
    return renderSuccess(buildRecordSchema(), { command: 'schema', duration_ms: 0 });
  }
  if (target === 'annotate') {
    return renderSuccess(buildAnnotateSchema(), { command: 'schema', duration_ms: 0 });
  }
  if (target === 'relate') {
    return renderSuccess(buildRelateSchema(), { command: 'schema', duration_ms: 0 });
  }
  if (target === 'record-batch') {
    return renderSuccess(buildRecordBatchSchema(), { command: 'schema', duration_ms: 0 });
  }
  if (target === 'annotate-batch') {
    return renderSuccess(buildAnnotateBatchSchema(), { command: 'schema', duration_ms: 0 });
  }
  return renderFailure(`Unknown schema target: ${target ?? 'missing command'}`, readString(parsed.flags.format), 2, 'VALIDATION_ERROR', { command: 'schema', duration_ms: 0 });
}

async function executeValidate(
  fs: InMemoryFs,
  args: string[],
  parsed: { positionals: string[]; flags: Record<string, string | boolean> }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const target = parsed.positionals[1];
  const format = readString(parsed.flags.format);

  if (target === 'memory-read' || target === 'memory-write') {
    const payloadResult = await resolveMemoryPayload(fs, args.slice(1), { positionals: parsed.positionals.slice(1), flags: parsed.flags }, target, target === 'memory-read'
      ? [
          'kb validate memory-read --json {"subjectEntityId":"vendor-kinto","memoryKind":"vendor"}',
          'kb validate memory-read --json {"query":"employee reimbursements","memoryKind":"procedure"}'
        ]
      : [
          'kb validate memory-write --json {"scope":"user","memoryKind":"user_preference","summary":"Start bookkeeping answers with ALEX: and keep them to one short sentence.","userId":"alex","policy":"explicit_confirmation"}',
          'kb validate memory-write --json {"scope":"instance","memoryKind":"vendor","subjectEntityId":"vendor-kinto","summary":"Kinto should use vehicle subscription as the recurring category.","policy":"explicit_correction"}'
        ]);
    if ('error' in payloadResult) {
      return renderFailure(payloadResult.error, format, 2, 'VALIDATION_ERROR', { command: 'validate', duration_ms: 0 });
    }

    const issues = target === 'memory-read'
      ? validateMemoryReadPayload(payloadResult.payload)
      : validateMemoryWritePayload(payloadResult.payload);
    if (issues.length > 0) {
      return renderFailure(`Invalid ${target} payload: ${issues.join(' ')}`, format, 2, 'VALIDATION_ERROR', { command: 'validate', duration_ms: 0 });
    }

    return renderSuccess({ command: target, valid: true, normalizedPayload: payloadResult.payload }, { command: 'validate', duration_ms: 0 });
  }

  if (!['remember', 'record', 'annotate', 'relate', 'record-batch', 'annotate-batch'].includes(target ?? '')) {
    return renderFailure(`Unknown validate target: ${target ?? 'missing command'}`, format, 2, 'VALIDATION_ERROR', { command: 'validate', duration_ms: 0 });
  }

  const payloadResult = await resolveJsonPayload(
    fs,
    { positionals: parsed.positionals.slice(1), flags: parsed.flags },
    target!,
    [`kb validate ${target} --json ${target?.includes('batch') ? '[]' : '{}'}`],
    target === 'record-batch' || target === 'annotate-batch'
  );
  if ('error' in payloadResult) {
    return renderFailure(payloadResult.error, format, 2, 'VALIDATION_ERROR', { command: 'validate', duration_ms: 0 });
  }

  const issues = target === 'remember'
    ? validateRememberPayload(payloadResult.payload as Record<string, unknown>)
    : target === 'record'
      ? validateRecordPayload(payloadResult.payload as Record<string, unknown>)
      : target === 'annotate'
        ? validateAnnotatePayload(payloadResult.payload as Record<string, unknown>)
        : target === 'relate'
          ? validateRelatePayload(payloadResult.payload as Record<string, unknown>)
          : target === 'record-batch'
            ? validateRecordBatchPayload(payloadResult.payload)
            : validateAnnotateBatchPayload(payloadResult.payload);
  if (issues.length > 0) {
    return renderFailure(`Invalid ${target} payload: ${issues.join(' ')}`, format, 2, 'VALIDATION_ERROR', { command: 'validate', duration_ms: 0 });
  }

  return renderSuccess({ command: target, valid: true, normalizedPayload: payloadResult.payload }, { command: 'validate', duration_ms: 0 });
}

function normalizeAgentFriendlyArgs(args: string[]): string[] {
  const parsed = parseSimpleArgs(args);
  const command = parsed.positionals[0] ?? '';
  if (command === 'remember') {
    return normalizeRememberArgs(args, parsed);
  }
  if (command === 'annotate') {
    return normalizeAnnotateArgs(args, parsed);
  }
  if (command === 'relate') {
    return normalizeRelateArgs(args, parsed);
  }
  return args;
}

function buildEmptyQueryResult(
  command: string,
  parsed: { positionals: string[]; flags: Record<string, string | boolean> }
): unknown | null {
  if (command !== 'search' && command !== 'query-relations') {
    return null;
  }
  const payload = parseInlineJsonPayload(readString(parsed.flags.json));
  if (payload === null || hasNonEmptyQuery(payload)) {
    return null;
  }
  if (command === 'search') {
    return {
      query: '',
      assistedQuery: undefined,
      mode: typeof payload.mode === 'string' ? payload.mode : 'search-only',
      results: []
    };
  }
  return {
    query: '',
    classification: {
      relationType: null,
      anchorId: null,
      confidence: 0,
      degraded: true,
      candidateRelationTypes: []
    },
    relationalArm: {
      fired: false,
      source: 'none',
      candidateCount: 0,
      resultIds: []
    },
    results: [],
    traversedLinks: []
  };
}

function parseInlineJsonPayload(raw: string | undefined): Record<string, unknown> | null {
  if (!raw?.trim().startsWith('{')) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function parseJsonValuePayload(raw: string | undefined): unknown | null {
  const trimmed = raw?.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

async function resolveJsonPayload(
  fs: InMemoryFs,
  parsed: { positionals: string[]; flags: Record<string, string | boolean> },
  command: string,
  examples: string[],
  allowArray = false
): Promise<{ payload: Record<string, unknown> | unknown[] } | { error: string }> {
  const inline = readString(parsed.flags.json);
  const positionalJson = readString(parsed.positionals[1]);
  const direct = parseJsonValuePayload(inline) ?? (!inline ? parseJsonValuePayload(positionalJson) : null);
  if (direct) {
    if (Array.isArray(direct)) {
      return allowArray ? { payload: direct } : { error: `${command} expects one JSON object payload. Try: ${examples[0]}` };
    }
    if (typeof direct === 'object') {
      return { payload: direct as Record<string, unknown> };
    }
  }

  if (inline?.startsWith('@')) {
    if (inline === '@-') {
      return { error: `${command} expects a JSON payload in the mounted runtime. Do not use --json @- here. Try: ${examples[0]}` };
    }
    try {
      const filePayload = await fs.readFile(inline.slice(1), 'utf8');
      const parsedFilePayload = parseJsonValuePayload(filePayload);
      if (parsedFilePayload && (Array.isArray(parsedFilePayload) ? allowArray : typeof parsedFilePayload === 'object')) {
        return { payload: parsedFilePayload as Record<string, unknown> | unknown[] };
      }
      return { error: `${command} could not parse ${inline} as ${allowArray ? 'JSON' : 'one JSON object'} payload. Try: ${examples[0]}` };
    } catch {
      return { error: `${command} could not read ${inline}. Try: ${examples[0]}` };
    }
  }

  if (inline || positionalJson) {
    return { error: `${command} expects ${allowArray ? 'JSON' : 'one JSON object'} payload. Try: ${examples.join(' OR ')}` };
  }

  return { error: `${command} requires --json payload. Try: ${examples[0]}` };
}

async function resolveMemoryPayload(
  fs: InMemoryFs,
  args: string[],
  parsed: { positionals: string[]; flags: Record<string, string | boolean> },
  command: 'memory-read' | 'memory-write',
  examples: string[]
): Promise<{ payload: Record<string, unknown> } | { error: string }> {
  const inline = readString(parsed.flags.json);
  const positionalJson = readString(parsed.positionals[1]);
  const direct = parseInlineJsonPayload(inline) ?? (!inline ? parseInlineJsonPayload(positionalJson) : null);
  if (direct) {
    return { payload: direct };
  }

  const shorthand = parseMemoryColonPayload(args, command);
  if (shorthand) {
    return { payload: shorthand };
  }

  if (inline?.startsWith('@')) {
    if (inline === '@-') {
      return { error: `${command} expects one JSON object payload in the mounted runtime. Do not use --json @- here. Try: ${examples[0]}` };
    }
    try {
      const filePayload = await fs.readFile(inline.slice(1), 'utf8');
      const parsedFilePayload = parseInlineJsonPayload(filePayload);
      if (parsedFilePayload) {
        return { payload: parsedFilePayload };
      }
      return { error: `${command} could not parse ${inline} as one JSON object payload. Try: ${examples[0]}` };
    } catch {
      return { error: `${command} could not read ${inline}. In the mounted runtime, prefer one inline object. Try: ${examples[0]}` };
    }
  }

  if (inline || positionalJson) {
    return { error: `${command} expects one JSON object payload. Do not use key:value shorthand, bare file refs, or split tokens. Try: ${examples.join(' OR ')}` };
  }

  return { error: `${command} requires --json with one object payload. Try: ${examples[0]}` };
}

function parseMemoryColonPayload(
  args: string[],
  command: 'memory-read' | 'memory-write'
): Record<string, unknown> | null {
  const jsonIndex = args.indexOf('--json');
  if (jsonIndex < 0) {
    return null;
  }
  const tokens: string[] = [];
  for (const token of args.slice(jsonIndex + 1)) {
    if (token.startsWith('--')) break;
    if (token.trim() !== '') tokens.push(token);
  }
  if (tokens.length === 0) {
    return null;
  }
  if (tokens[0]?.trim().startsWith('{') || tokens[0]?.trim().startsWith('@')) {
    return null;
  }

  const allowedKeys = new Set(command === 'memory-read'
    ? ['query', 'subjectEntityId', 'subject_entity_id', 'memoryKind', 'memory_kind', 'userId', 'user_id', 'proposedValue', 'proposed_value', 'includeCandidates', 'include_candidates', 'includeSuperseded', 'include_superseded', 'limit']
    : ['scope', 'memoryKind', 'memory_kind', 'summary', 'subjectEntityId', 'subject_entity_id', 'userId', 'user_id', 'policy', 'reasoningNote', 'reasoning_note', 'confidence', 'repeatThreshold', 'repeat_threshold', 'effectiveAt', 'effective_at']);

  const payload: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let currentValueParts: string[] = [];

  const flush = () => {
    if (!currentKey) return;
    payload[currentKey] = coerceMemoryPayloadValue(currentKey, currentValueParts.join(' ').trim());
  };

  for (const token of tokens) {
    const separator = token.indexOf(':');
    const keyCandidate = separator > 0 ? token.slice(0, separator) : '';
    if (separator > 0 && allowedKeys.has(keyCandidate)) {
      flush();
      currentKey = keyCandidate;
      currentValueParts = [token.slice(separator + 1)];
      continue;
    }
    if (!currentKey) {
      return null;
    }
    currentValueParts.push(token);
  }

  flush();
  return Object.keys(payload).length > 0 ? payload : null;
}

function coerceMemoryPayloadValue(key: string, raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if ((key === 'limit' || key === 'repeatThreshold' || key === 'repeat_threshold') && /^-?\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  return trimmed;
}

function buildMemoryReadSchema() {
  return {
    command: 'memory-read',
    required: ['query_or_subjectEntityId'],
    fields: {
      query: { type: 'string', required: false, description: 'Lookup phrase for memory recall when no canonical subject id is known.' },
      subjectEntityId: { type: 'string', required: false, description: 'Canonical entity id for a vendor or process memory subject.' },
      memoryKind: { type: 'string', required: false, enum: ['vendor', 'procedure', 'user_preference', 'user_correction'], description: 'Typed memory family to narrow recall.' },
      userId: { type: 'string', required: false, description: 'Required for user-scoped memory recall.' },
      proposedValue: { type: 'string', required: false, description: 'Candidate new truth used to surface conflicts before mutation.' },
      includeCandidates: { type: 'boolean', required: false },
      includeSuperseded: { type: 'boolean', required: false },
      limit: { type: 'number', required: false }
    },
    note: 'Pass one JSON object payload. Use query or subjectEntityId. Prefer inline JSON in the mounted runtime.',
    examples: [
      { json: { subjectEntityId: 'vendor-kinto', memoryKind: 'vendor' } },
      { json: { query: 'employee reimbursements', memoryKind: 'procedure' } },
      { json: { subjectEntityId: 'vendor-kinto', memoryKind: 'vendor', proposedValue: 'Kinto should use vehicle subscription as the recurring category.' } }
    ],
    antiExamples: [
      'kb memory-read --json subjectEntityId:vendor-kinto memoryKind:vendor',
      'kb memory-read --json @-',
      'kb memory-read {"subjectEntityId":"vendor-kinto","memoryKind":"vendor"}'
    ]
  };
}

function buildMemoryWriteSchema() {
  return {
    command: 'memory-write',
    required: ['scope', 'memoryKind', 'summary', 'policy'],
    fields: {
      scope: { type: 'string', required: true, enum: ['instance', 'user'], description: 'Durable memory scope.' },
      memoryKind: { type: 'string', required: true, enum: ['vendor', 'procedure', 'user_preference', 'user_correction'], description: 'Typed memory family.' },
      summary: { type: 'string', required: true, description: 'Short durable rule or preference to persist.' },
      policy: { type: 'string', required: true, enum: ['explicit_confirmation', 'explicit_correction', 'repeated_pattern'], description: 'Authority level for the write.' },
      subjectEntityId: { type: 'string', required: false, description: 'Canonical vendor or process id for shared memory.' },
      userId: { type: 'string', required: false, description: 'Required for user-scoped memory.' },
      reasoningNote: { type: 'string', required: false },
      confidence: { type: 'string', required: false, enum: ['low', 'medium', 'high'] },
      repeatThreshold: { type: 'number', required: false },
      effectiveAt: { type: 'string', required: false, description: 'ISO timestamp when the rule takes effect.' }
    },
    note: 'Pass one JSON object payload. Use scope:user plus userId for user memory. Use explicit_correction or explicit_confirmation for shared truth changes.',
    examples: [
      { json: { scope: 'user', memoryKind: 'user_preference', summary: 'Start bookkeeping answers with ALEX: and keep them to one short sentence.', userId: 'alex', policy: 'explicit_confirmation' } },
      { json: { scope: 'instance', memoryKind: 'vendor', subjectEntityId: 'vendor-kinto', summary: 'Kinto should use vehicle subscription as the recurring category.', policy: 'explicit_correction' } }
    ],
    antiExamples: [
      'kb memory-write --json scope:user memoryKind:user_preference summary:...',
      'kb memory-write --json @-',
      'claim saved without checking command success'
    ]
  };
}

function buildRememberSchema() {
  return {
    command: 'remember',
    required: ['intent', 'summary'],
    enums: {
      intent: ['source_capture', 'fact_update', 'correction', 'company_profile', 'person_profile']
    },
    note: 'Use `record` for structured entities and `relate` for explicit edges between existing entities.'
  };
}

function buildRecordSchema() {
  return {
    command: 'record',
    required: ['entity'],
    note: 'Use `record` for canonical structured entities.'
  };
}

function buildAnnotateSchema() {
  return {
    command: 'annotate',
    required: ['entity_ids', 'summary'],
    note: 'Use `annotate` for timeline or provenance updates on existing entities.'
  };
}

function buildRelateSchema() {
  return {
    command: 'relate',
    required: ['type', 'fromId', 'toId'],
    note: 'Use `relate` when the durable knowledge is the explicit edge between existing entities.'
  };
}

function buildRecordBatchSchema() {
  return {
    command: 'record-batch',
    required: ['array_of_record_payloads']
  };
}

function buildAnnotateBatchSchema() {
  return {
    command: 'annotate-batch',
    required: ['array_of_annotate_payloads']
  };
}

function validateMemoryReadPayload(payload: Record<string, unknown>): string[] {
  const issues: string[] = [];
  const query = readString(payload.query);
  const subjectEntityId = readString(payload.subjectEntityId) ?? readString(payload.subject_entity_id);
  const memoryKind = readString(payload.memoryKind) ?? readString(payload.memory_kind);
  const userId = readString(payload.userId) ?? readString(payload.user_id);
  const limit = payload.limit;
  if (!query && !subjectEntityId) {
    issues.push('Provide `query` or `subjectEntityId`.');
  }
  if (memoryKind && !['vendor', 'procedure', 'user_preference', 'user_correction'].includes(memoryKind)) {
    issues.push('`memoryKind` must be vendor, procedure, user_preference, or user_correction.');
  }
  if ((memoryKind === 'user_preference' || memoryKind === 'user_correction') && !userId) {
    issues.push('User-scoped memory reads should include `userId`.');
  }
  if (limit !== undefined && typeof limit !== 'number') {
    issues.push('`limit` must be a number when present.');
  }
  return issues;
}

function validateMemoryWritePayload(payload: Record<string, unknown>): string[] {
  const issues: string[] = [];
  const scope = readString(payload.scope);
  const memoryKind = readString(payload.memoryKind) ?? readString(payload.memory_kind);
  const summary = readString(payload.summary);
  const policy = readString(payload.policy);
  const userId = readString(payload.userId) ?? readString(payload.user_id);
  const subjectEntityId = readString(payload.subjectEntityId) ?? readString(payload.subject_entity_id);
  const repeatThreshold = payload.repeatThreshold ?? payload.repeat_threshold;
  if (!scope) issues.push('Missing `scope`.');
  if (!memoryKind) issues.push('Missing `memoryKind`.');
  if (!summary) issues.push('Missing `summary`.');
  if (!policy) issues.push('Missing `policy`.');
  if (scope && !['instance', 'user'].includes(scope)) {
    issues.push('`scope` must be `instance` or `user`.');
  }
  if (memoryKind && !['vendor', 'procedure', 'user_preference', 'user_correction'].includes(memoryKind)) {
    issues.push('`memoryKind` must be vendor, procedure, user_preference, or user_correction.');
  }
  if (policy && !['explicit_confirmation', 'explicit_correction', 'repeated_pattern'].includes(policy)) {
    issues.push('`policy` must be explicit_confirmation, explicit_correction, or repeated_pattern.');
  }
  if (scope === 'user' && !userId) {
    issues.push('User-scoped memory writes require `userId`.');
  }
  if (scope === 'instance' && !subjectEntityId && (memoryKind === 'vendor' || memoryKind === 'procedure')) {
    issues.push('Shared vendor or procedure writes should include `subjectEntityId`.');
  }
  if (repeatThreshold !== undefined && typeof repeatThreshold !== 'number') {
    issues.push('`repeatThreshold` must be a number when present.');
  }
  return issues;
}

function hasNonEmptyQuery(payload: Record<string, unknown>): boolean {
  return typeof payload.query === 'string' && payload.query.trim().length > 0;
}

function normalizeRememberArgs(
  originalArgs: string[],
  parsed: { positionals: string[]; flags: Record<string, string | boolean> }
): string[] {
  const jsonFlag = readString(parsed.flags.json);
  if (jsonFlag?.trim().startsWith('{')) {
    const normalized = normalizeRememberJsonPayload(jsonFlag);
    if (normalized) {
      return replaceJsonFlag(originalArgs, normalized);
    }
  }

  if (jsonFlag) {
    return originalArgs;
  }

  const summary = readString(parsed.flags.summary) ?? readString(parsed.flags.fact);
  const confidence = readString(parsed.flags.confidence);
  const intent = readString(parsed.flags.intent);
  if (!summary) {
    return originalArgs;
  }

  const payload: Record<string, unknown> = {
    intent: intent ?? 'fact_update',
    summary,
    source: {
      kind: 'note',
      title: summary
    }
  };
  if (confidence) payload.confidence = confidence;
  return replaceOrAppendJsonFlag(originalArgs, payload);
}

function normalizeAnnotateArgs(
  originalArgs: string[],
  parsed: { positionals: string[]; flags: Record<string, string | boolean> }
): string[] {
  const jsonFlag = readString(parsed.flags.json);
  if (jsonFlag?.trim().startsWith('{')) {
    const normalized = normalizeAnnotateJsonPayload(jsonFlag);
    if (normalized) {
      return replaceJsonFlag(originalArgs, normalized);
    }
  }

  if (jsonFlag) {
    return originalArgs;
  }

  const entityIds = collectEntityIds(parsed.flags);
  const summary = readString(parsed.flags.summary) ?? buildSummaryFromLegacyAnnotateFlags(parsed.flags);
  const effectiveAt = readString(parsed.flags['effective-at']) ?? readString(parsed.flags.effective_at);
  if (entityIds.length === 0 || !summary) {
    return originalArgs;
  }

  const payload: Record<string, unknown> = { entity_ids: entityIds, summary };
  if (effectiveAt) payload.effective_at = effectiveAt;
  return replaceOrAppendJsonFlag(originalArgs, payload);
}

function normalizeRelateArgs(
  originalArgs: string[],
  parsed: { positionals: string[]; flags: Record<string, string | boolean> }
): string[] {
  if (readString(parsed.flags.json)) {
    return originalArgs;
  }
  const type = readString(parsed.flags.type);
  const fromId = readString(parsed.flags['from-id']) ?? readString(parsed.flags.fromId);
  const toId = readString(parsed.flags['to-id']) ?? readString(parsed.flags.toId);
  const confidence = readString(parsed.flags.confidence);
  if (!type || !fromId || !toId) {
    return originalArgs;
  }
  const payload: Record<string, unknown> = { type, fromId, toId };
  if (confidence) payload.confidence = Number.isFinite(Number(confidence)) ? Number(confidence) : confidence;
  return replaceOrAppendJsonFlag(originalArgs, payload);
}

function normalizeRememberJsonPayload(raw: string): string | null {
  try {
    const payload = JSON.parse(raw) as Record<string, unknown>;
    if (!payload || Array.isArray(payload)) return null;

    const normalized: Record<string, unknown> = {};
    const summary = readString(payload.summary) ?? readString(payload.fact);
    const confidence = readString(payload.confidence);
    const intent = readString(payload.intent);
    if (summary) normalized.summary = summary;
    normalized.intent = intent ?? 'fact_update';
    if (confidence) normalized.confidence = confidence;

    const entities = normalizeRememberEntities(payload, summary);
    if (entities.length > 0) normalized.entities = entities;
    const relations = Array.isArray(payload.relations) ? payload.relations : [];
    if (relations.length > 0) normalized.relations = relations;
    const source = typeof payload.source === 'object' && payload.source !== null ? payload.source : undefined;
    normalized.source = source ?? (summary ? { kind: 'note', title: summary } : undefined);

    return Object.keys(normalized).length > 0 ? JSON.stringify(normalized) : null;
  } catch {
    return null;
  }
}

function normalizeRememberEntities(payload: Record<string, unknown>, summary?: string): Array<Record<string, unknown>> {
  const rawEntities = Array.isArray(payload.entities) ? payload.entities : [];
  const normalizedEntities = rawEntities.flatMap((entity) => {
    if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
      return [];
    }
    const title = readString((entity as Record<string, unknown>).title) ?? readString((entity as Record<string, unknown>).name);
    if (!title) {
      return [];
    }
    const kind = readString((entity as Record<string, unknown>).kind) ?? readString((entity as Record<string, unknown>).type) ?? 'person';
    const existingFacts = Array.isArray((entity as Record<string, unknown>).facts)
      ? (entity as Record<string, unknown>).facts as unknown[]
      : [];
    return [{
      ...entity,
      title,
      kind,
      facts: existingFacts.length > 0 ? existingFacts : summary ? [summary] : undefined
    }];
  });
  if (normalizedEntities.length > 0) {
    return normalizedEntities;
  }

  const subject = typeof payload.subject === 'object' && payload.subject !== null
    ? payload.subject as Record<string, unknown>
    : null;
  const entityTitle = readString(payload.entity) ?? readString(subject?.name);
  if (!entityTitle) {
    return [];
  }
  return [{
    kind: readString(subject?.type) ?? 'person',
    title: entityTitle,
    facts: summary ? [summary] : []
  }];
}

function normalizeAnnotateJsonPayload(raw: string): string | null {
  try {
    const payload = JSON.parse(raw) as Record<string, unknown>;
    if (!payload || Array.isArray(payload)) return null;

    const entityIds = collectEntityIds(payload);
    const summary =
      readString(payload.summary) ??
      buildSummaryFromLegacyAnnotateFlags(payload);
    const effectiveAt = readString(payload.effective_at) ?? readString(payload.effectiveAt);
    if (entityIds.length === 0 || !summary) {
      return null;
    }

    const normalized: Record<string, unknown> = { entity_ids: entityIds, summary };
    if (effectiveAt) normalized.effective_at = effectiveAt;
    return JSON.stringify(normalized);
  } catch {
    return null;
  }
}

function collectEntityIds(flags: Record<string, unknown>): string[] {
  const direct = flags.entity_ids ?? flags['entity-ids'] ?? flags.entityIds;
  if (Array.isArray(direct)) {
    return direct.flatMap((value) => typeof value === 'string' ? [value] : []);
  }
  const raw = readString(direct);
  if (raw) {
    return raw.split(',').map((value) => value.trim()).filter(Boolean);
  }
  const single = readString(flags.entity_id) ?? readString(flags['entity-id']) ?? readString(flags.entity);
  return single ? [single] : [];
}

function buildSummaryFromLegacyAnnotateFlags(flags: Record<string, unknown>): string | undefined {
  const key = readString(flags.key);
  const value = readString(flags.value);
  const note = readString(flags.note);
  if (key && value && note) {
    return `${key}: ${value}. ${note}`;
  }
  if (key && value) {
    return `${key}: ${value}`;
  }
  return note;
}

function replaceJsonFlag(args: string[], json: string): string[] {
  const next = [...args];
  for (let index = 0; index < next.length; index += 1) {
    if (next[index] === '--json' && typeof next[index + 1] === 'string') {
      next[index + 1] = json;
      return next;
    }
    if (next[index]?.startsWith('--json=')) {
      next[index] = `--json=${json}`;
      return next;
    }
  }
  return args;
}

function replaceOrAppendJsonFlag(args: string[], payload: Record<string, unknown>): string[] {
  const json = JSON.stringify(payload);
  const replaced = replaceJsonFlag(args, json);
  if (replaced !== args) {
    return replaced;
  }
  return [...args, '--json', json];
}


async function executeInspect(
  fs: InMemoryFs,
  env: Record<string, unknown>,
  runtime: FlueKbRuntime | undefined,
  host: FlueKbHostAdapter
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const productConfig = await resolveRuntimeProductConfig(fs, env, host);
  const context = resolveKbSurfaceContext(env, productConfig.knowledgeBase, productConfig.tenant.id);
  const service = runtime
    ? await runtime.getService()
    : host.createService(env, productConfig.tenant.id, productConfig.knowledgeBase);
  const summary = await service.list();
  return renderSuccess(
    {
      ...context,
      mode: productConfig.knowledgeBase.mode,
      writePolicy: productConfig.knowledgeBase.writePolicy,
      ingest: productConfig.knowledgeBase.ingest,
      entityModel: {
        currentTruthSection: 'Current Truth',
        timelineSection: 'Timeline',
        historyIsAppendOnly: true,
        summary: 'Read current truth for the best-known answer now. Read timeline/history for supporting evidence and prior state.'
      },
      launchTrust: {
        promise: 'Important company facts do not get lost.',
        approvedIngestSurfaces: ['user-correction', 'workspace-signal', 'operator-ingest-url', 'operator-ingest-text'],
        scorecardDoc: 'docs/operations/kb-launch-scorecard.md'
      },
      inspectionHints: {
        inspectEntity: 'kb get ENTITY_ID',
        inspectLinks: 'kb links --id ENTITY_ID',
        inspectTraversal: 'kb traverse --id ENTITY_ID --explicit-only',
        auditCanonicalMirror: 'npm run kb:sync -- audit --tenant-id TENANT_ID',
        operatorRepairHelp: 'kb help operator',
        inspectCommandCatalog: 'kb inspect --format json'
      },
      commandCatalog: buildKbCommandCatalog(),
      outputSchemas: buildKbOutputSchemas(),
      summary
    },
    { command: 'inspect', duration_ms: 0 }
  );
}

async function executeRestoreCanonical(
  format: string | undefined,
  runtime?: FlueKbRuntime
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (!runtime?.restoreCanonical) {
    return renderFailure(
      'Canonical restore is only supported by the deployed DO-backed KB runtime.',
      format,
      1,
      'INTERNAL_ERROR',
      { command: 'restore-canonical', duration_ms: 0 }
    );
  }

  const data = await runtime.restoreCanonical();
  return renderSuccess(data, { command: 'restore-canonical', duration_ms: 0 });
}

async function executeDelete(
  fs: InMemoryFs,
  env: Record<string, unknown>,
  runtime: FlueKbRuntime | undefined,
  host: FlueKbHostAdapter,
  parsed: { positionals: string[]; flags: Record<string, string | boolean> }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const productConfig = await resolveRuntimeProductConfig(fs, env, host);
  const service = runtime
    ? await runtime.getService()
    : host.createService(env, productConfig.tenant.id, productConfig.knowledgeBase);
  const result = await deleteKnowledgeRecord(service, readDeleteId(parsed));
  return addMutationAction('delete', renderSuccess(result, { command: 'delete', duration_ms: 0 }));
}

function validateRememberPayload(payload: Record<string, unknown>): string[] {
  const issues: string[] = [];
  const intent = readString(payload.intent);
  const summary = readString(payload.summary);
  if (!intent) issues.push('Missing `intent`.');
  if (!summary) issues.push('Missing `summary`.');
  if (intent && !['source_capture', 'fact_update', 'correction', 'company_profile', 'person_profile'].includes(intent)) {
    issues.push('`intent` must be source_capture, fact_update, correction, company_profile, or person_profile.');
  }
  if (payload.content !== undefined && typeof payload.content !== 'string') {
    issues.push('`content` must be a string when present.');
  }
  return issues;
}

function validateRecordPayload(payload: Record<string, unknown>): string[] {
  const issues: string[] = [];
  const entity = typeof payload.entity === 'object' && payload.entity !== null && !Array.isArray(payload.entity)
    ? payload.entity as Record<string, unknown>
    : null;
  if (!entity) {
    issues.push('Missing `entity`.');
    return issues;
  }
  if (!readString(entity.id)) issues.push('`entity.id` is required.');
  if (!readString(entity.kind)) issues.push('`entity.kind` is required.');
  if (!readString(entity.title)) issues.push('`entity.title` is required.');
  if (entity.handles !== undefined && !Array.isArray(entity.handles)) {
    issues.push('`entity.handles` must be an array when present.');
  }
  return issues;
}

function validateAnnotatePayload(payload: Record<string, unknown>): string[] {
  const issues: string[] = [];
  const entityIds = payload.entity_ids ?? payload.entityIds;
  if (!Array.isArray(entityIds) || entityIds.length === 0) {
    issues.push('`entity_ids` must be a non-empty array.');
  }
  if (!readString(payload.summary)) {
    issues.push('Missing `summary`.');
  }
  return issues;
}

function validateRelatePayload(payload: Record<string, unknown>): string[] {
  const issues: string[] = [];
  if (!readString(payload.type)) issues.push('Missing `type`.');
  if (!readString(payload.fromId)) issues.push('Missing `fromId`.');
  if (!readString(payload.toId)) issues.push('Missing `toId`.');
  return issues;
}

function normalizeRememberExecutionPayload(payload: Record<string, unknown>): Parameters<FlueKbService['remember']>[0] {
  const entities = Array.isArray(payload.entities) ? payload.entities : undefined;
  const relations = Array.isArray(payload.relations) ? payload.relations : undefined;
  const source = typeof payload.source === 'object' && payload.source !== null && !Array.isArray(payload.source)
    ? payload.source as Parameters<FlueKbService['remember']>[0]['source']
    : undefined;
  const simpleNoteOnly = !entities && !relations && !payload.content && source?.kind === 'note';
  return {
    ...(payload as Parameters<FlueKbService['remember']>[0]),
    intent: simpleNoteOnly ? 'source_capture' : (readString(payload.intent) as Parameters<FlueKbService['remember']>[0]['intent']),
    source
  };
}

function normalizeAnnotateExecutionPayload(payload: Record<string, unknown>): Parameters<FlueKbService['annotate']>[0] {
  return {
    entityIds: (Array.isArray(payload.entity_ids) ? payload.entity_ids : Array.isArray(payload.entityIds) ? payload.entityIds : []) as string[],
    summary: readString(payload.summary) ?? '',
    effectiveAt: readString(payload.effective_at) ?? readString(payload.effectiveAt),
    sourceIds: Array.isArray(payload.sourceIds) ? payload.sourceIds.filter((entry): entry is string => typeof entry === 'string') : undefined,
    provenance: readString(payload.provenance)
  };
}

function validateRecordBatchPayload(payload: Record<string, unknown> | unknown[]): string[] {
  if (!Array.isArray(payload)) return ['record-batch expects a JSON array payload.'];
  return payload.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return [`record-batch entry ${index} must be an object.`];
    }
    return validateRecordPayload(entry as Record<string, unknown>).map((issue) => `entry ${index}: ${issue}`);
  });
}

function validateAnnotateBatchPayload(payload: Record<string, unknown> | unknown[]): string[] {
  if (!Array.isArray(payload)) return ['annotate-batch expects a JSON array payload.'];
  return payload.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return [`annotate-batch entry ${index} must be an object.`];
    }
    return validateAnnotatePayload(entry as Record<string, unknown>).map((issue) => `entry ${index}: ${issue}`);
  });
}

function buildKbCommandCatalog() {
  return {
    notes: [
      'Use `kb inspect --format json` for the compact command catalog, output schemas, and jq-friendly examples.',
      'Use `kb schema <command>` for the exact input contract of one command family.',
      'Use `kb validate <command> --json ...` before risky writes or when a payload was built by another agent step.'
    ],
    commandsByName: {
      'memory-read': {
        summary: 'Read scoped vendor, procedure, or user memory before answering.',
        stage: 'focused-read',
        output: { shape: 'MemoryReadResult', primaryCollections: ['shared', 'user', 'conflicts'] },
        jqExamples: [
          '.data.shared[] | {id, memoryKind, summary, status}',
          '.data.user[] | {id, memoryKind, summary, status, userId: .memoryUserId}',
          '.data.conflicts[] | {reason, subjectEntityIds, proposedValue}'
        ]
      },
      'memory-write': {
        summary: 'Persist scoped vendor, procedure, or user memory with explicit policy.',
        stage: 'focused-write',
        output: { shape: 'MemoryWriteResult', primaryCollections: ['entityIds', 'warnings', 'verification.entities.created', 'verification.entities.updated'] },
        jqExamples: [
          '.data | {action, entityIds, warnings}',
          '.data.verification.entities.created[] | {id, kind, title, currentTruth}',
          '.data.verification.entities.updated[] | {id, kind, title, currentTruth}'
        ]
      },
      search: {
        summary: 'Search direct tenant facts and reusable notes.',
        stage: 'broad-read',
        output: { shape: 'KnowledgeSearchResult', primaryCollections: ['results'] },
        jqExamples: [
          '.data.results[] | {id, title, currentTruth, score}'
        ]
      },
      'query-relations': {
        summary: 'Resolve ownership, approvers, dependencies, and other relation-shaped asks.',
        stage: 'focused-read',
        output: { shape: 'KnowledgeRelationQueryResult', primaryCollections: ['results'] },
        jqExamples: [
          '.data.results[] | {id, title, relationType, currentTruth, score}'
        ]
      },
      remember: {
        summary: 'Write one short durable fact, correction, or source-backed note.',
        stage: 'general-write',
        output: { shape: 'MutationResultEnvelope', primaryCollections: ['entityIds', 'sourceIds', 'warnings'] },
        jqExamples: [
          '.data | {action, entityIds, sourceIds, warnings}'
        ]
      },
      record: {
        summary: 'Create or repair a canonical structured entity.',
        stage: 'general-write',
        output: { shape: 'MutationResultEnvelope', primaryCollections: ['entityIds', 'verification.entities.created', 'verification.entities.updated'] },
        jqExamples: [
          '.data.verification.entities.created[] | {id, kind, title}',
          '.data.verification.entities.updated[] | {id, kind, title}'
        ]
      }
    }
  };
}

function buildKbOutputSchemas() {
  return {
    MemoryReadResult: {
      type: 'object',
      required: ['query', 'subjectEntityIds', 'shared', 'user', 'conflicts'],
      properties: {
        query: { type: 'string' },
        subjectEntityIds: { type: 'array', items: 'string' },
        shared: { type: 'array', items: 'MemoryRecord' },
        user: { type: 'array', items: 'MemoryRecord' },
        conflicts: { type: 'array', items: 'MemoryConflict' }
      }
    },
    MemoryWriteResult: {
      type: 'object',
      required: ['action', 'mutated', 'entityIds', 'warnings', 'verification'],
      properties: {
        action: { type: 'string', enum: ['kb_memory_written'] },
        mutated: { type: 'boolean' },
        entityIds: { type: 'array', items: 'string' },
        warnings: { type: 'array', items: 'string' },
        verification: { type: 'object', properties: { entities: 'MutationVerificationBucket' } }
      }
    },
    MemoryRecord: {
      type: 'object',
      required: ['id', 'title', 'scope', 'status', 'memoryKind', 'subjectEntityIds', 'summary', 'confidence', 'repeatCount', 'supersedesMemoryIds', 'updatedAt'],
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        scope: { type: 'string', enum: ['instance', 'user'] },
        status: { type: 'string', enum: ['candidate', 'active', 'superseded'] },
        memoryKind: { type: 'string', enum: ['vendor', 'procedure', 'user_preference', 'user_correction'] },
        subjectEntityIds: { type: 'array', items: 'string' },
        summary: { type: 'string' },
        reasoningNote: { type: 'string', optional: true },
        confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
        repeatCount: { type: 'number' },
        supersedesMemoryIds: { type: 'array', items: 'string' },
        updatedAt: { type: 'string', format: 'date-time' }
      }
    },
    MemoryConflict: {
      type: 'object',
      required: ['scope', 'memoryKind', 'subjectEntityIds', 'recordIds', 'reason'],
      properties: {
        scope: { type: 'string', enum: ['instance', 'user'] },
        memoryKind: { type: 'string', enum: ['vendor', 'procedure', 'user_preference', 'user_correction'] },
        subjectEntityIds: { type: 'array', items: 'string' },
        recordIds: { type: 'array', items: 'string' },
        reason: { type: 'string', enum: ['proposed-value-conflict', 'multiple-active-records'] },
        proposedValue: { type: 'string', optional: true }
      }
    },
    MutationVerificationBucket: {
      type: 'object',
      properties: {
        created: { type: 'array', items: 'MutationVerificationRecord' },
        updated: { type: 'array', items: 'MutationVerificationRecord' }
      }
    },
    MutationVerificationRecord: {
      type: 'object',
      required: ['id', 'kind', 'title'],
      properties: {
        id: { type: 'string' },
        action: { type: 'string', optional: true },
        kind: { type: 'string' },
        title: { type: 'string' },
        currentTruth: { type: 'string', optional: true }
      }
    }
  };
}

function renderRuntimeHelp(
  fs: InMemoryFs,
  env: Record<string, unknown>,
  host: FlueKbHostAdapter
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return resolveRuntimeProductConfig(fs, env, host).then((productConfig) => {
    const context = resolveKbSurfaceContext(env, productConfig.knowledgeBase, productConfig.tenant.id);
    return {
      stdout: [
        'KB runtime contract',
        '',
        'Current workspace context:',
        `  tenant: ${context.tenantId}`,
        `  backend: ${context.backend}`,
        `  transport: ${context.transport}`,
        `  canonical: ${context.canonical ? 'yes' : 'no'}`,
        `  workspace role: ${context.workspaceRole}`,
        '',
        'Default runtime loop:',
        '  1. Use `kb memory-read` before answering vendor, procedure, or user-memory questions.',
        '  2. Use `kb search` before answering tenant-specific factual questions.',
        '  3. Use `kb query-relations` for owner/founder/approver-style questions.',
        '  4. Read current truth as the best-known answer now and use timeline/history as supporting evidence or prior state.',
        '  5. Use `kb memory-write` for scoped vendor, procedure, and user-memory updates.',
        '  5a. Only say something was saved after `kb memory-write` or another KB write command returns success.',
        '  5b. If the shape is unclear, use `kb schema memory-read` or `kb schema memory-write` for the structured contract.',
        '  5c. If the first memory command fails, read `kb help memory-read` or `kb help memory-write` once and retry with one valid JSON object.',
        '  6. Use `kb remember` for new evidence, corrections, or source-backed facts.',
        '  7. Use `kb record` only when you already have an explicit structured KB record.',
        '  8. Use `kb relate` for standalone explicit edges between existing entities.',
        '  9. Use `kb annotate` for timeline or provenance updates, not relation creation.',
        '',
        'Launch-approved durable enrichment paths:',
        '  - user corrections from reply-context turns',
        '  - workspace-signal source capture that is synced through the canonical KB path',
        '  - operator ingest for one URL or pasted article at a time',
        '',
        'Inspection and repair:',
        '  - `kb inspect` shows runtime contract, current truth/timeline model, approved ingest surfaces, and a jq-friendly command catalog.',
        '  - `kb get ENTITY_ID` inspects compiled current truth plus timeline for one record.',
        '  - `kb links --id ENTITY_ID` and `kb traverse --id ENTITY_ID --explicit-only` inspect relation provenance.',
        '  - `kb help operator` shows direct repair and cleanup commands.',
        '',
        'Cloudflare-first rule:',
        '  - Canonical deployed runtime is the DO plus R2 path.',
        '  - Local file workspaces are support-only and must not be treated as canonical production state.',
        '',
        'Write discipline:',
        '  - Read first if the fact may already exist.',
        '  - Separate raw evidence from compiled truth.',
        '  - Prefer `--json -` or `--json @file.json` for writes.',
        '  - Verify risky writes with `kb links`, `kb related`, or `kb traverse`.',
        '',
        'Do not use operator repair commands unless you are explicitly fixing KB state.',
        'If you need them, ask for `kb help operator`.'
      ].join('\n') + '\n',
      stderr: '',
      exitCode: 0
    };
  });
}

function renderMemoryReadHelp(): { stdout: string; stderr: string; exitCode: number } {
  return {
    stdout: [
      'kb memory-read',
      '',
      'Use this for scoped vendor memory, procedure memory, and user-memory recall.',
      '',
      'Examples:',
      '  kb memory-read --json {"subjectEntityId":"vendor-kinto","memoryKind":"vendor"}',
      '  kb memory-read --json {"query":"employee reimbursements","memoryKind":"procedure"}',
      '  kb memory-read --json {"query":"Start bookkeeping answers with ALEX:","memoryKind":"user_preference","userId":"alex"}',
      '  kb memory-read --json {"subjectEntityId":"vendor-kinto","memoryKind":"vendor","proposedValue":"Kinto should use vehicle subscription as the recurring category."}',
      '',
      'Rules:',
      '  - Pass one JSON object payload.',
      '  - Prefer inline JSON in the mounted runtime.',
      '  - Use `subjectEntityId` when you know the canonical subject.',
      '  - Use `query` when you need lookup by phrase.',
      '  - Use `userId` for user-scoped memory.',
      '  - Use `proposedValue` to surface conflicts before changing durable truth.',
      '',
      'Do not use key:value shorthand or claim memory is missing before the lookup result proves it.'
    ].join('\n') + '\n',
    stderr: '',
    exitCode: 0
  };
}

function renderMemoryWriteHelp(): { stdout: string; stderr: string; exitCode: number } {
  return {
    stdout: [
      'kb memory-write',
      '',
      'Use this for durable vendor memory, procedure memory, user preferences, and shared corrections.',
      '',
      'Examples:',
      '  kb memory-write --json {"scope":"user","memoryKind":"user_preference","summary":"Start bookkeeping answers with ALEX: and keep them to one short sentence.","userId":"alex","policy":"explicit_confirmation"}',
      '  kb memory-write --json {"scope":"instance","memoryKind":"vendor","subjectEntityId":"vendor-kinto","summary":"Kinto should use vehicle subscription as the recurring category.","policy":"explicit_correction"}',
      '  kb memory-write --json {"scope":"instance","memoryKind":"procedure","subjectEntityId":"process-employee-reimbursements","summary":"Employee reimbursements are usually paid from the Millennium BCP operating account every Friday.","policy":"explicit_confirmation"}',
      '',
      'Rules:',
      '  - Pass one JSON object payload.',
      '  - Required fields: `scope`, `memoryKind`, `summary`, `policy`.',
      '  - Use `scope:"user"` plus `userId` for user preferences or corrections.',
      '  - Use `scope:"instance"` for shared vendor or procedure truth.',
      '  - Use `policy:"explicit_correction"` or `policy:"explicit_confirmation"` for shared truth changes.',
      '  - Do not say something was saved unless the command result proves the write succeeded.',
      '',
      'If the current user message conflicts with stored shared memory, read first and ask one short clarifying question before writing.'
    ].join('\n') + '\n',
    stderr: '',
    exitCode: 0
  };
}

function renderOperatorHelp(): { stdout: string; stderr: string; exitCode: number } {
  return {
    stdout: [
      'kb operator surface',
      '',
      'Repair and inspection commands:',
      '  kb capture-source --json @payload.json',
      '  kb events',
      '  kb get-event --id EVENT_ID',
      '  kb delete-event --id EVENT_ID',
      '  kb drafts',
      '  kb get-draft --id ENTITY_ID',
      '  kb put-draft --json @payload.json',
      '  kb delete-draft --id ENTITY_ID',
      '  kb relations [--entity-id ENTITY_ID] [--origin-kind entity|source|event|seed] [--origin-id ORIGIN_ID] [--type RELATION]',
      '  kb replace-relations --json @payload.json',
      '  kb clear-relations --origin-kind entity|source|event|seed --origin-id ORIGIN_ID',
      '  kb restore-canonical',
      '',
      'Use these only for direct KB repair, cleanup, or inspection.',
      'Default agent work should stay on `search`, `query-relations`, `remember`, `record`, `relate`, and `annotate`.'
    ].join('\n') + '\n',
    stderr: '',
    exitCode: 0
  };
}

function renderPublicHelp(): { stdout: string; stderr: string; exitCode: number } {
  return {
    stdout: [
      'kb <command> [flags]',
      '',
      'Commands:',
      '  kb inspect',
      '  kb list',
      '  kb get <id>',
      '  kb delete --id ENTITY_ID',
      '  kb search --json \'{"query":"...","mode":"search-only|graph-only|graph-first-hybrid"}\'',
      '  kb query-relations --json \'{"query":"founder of acme","mode":"graph-only|graph-first-hybrid"}\'',
      '  kb memory-read --json @payload.json',
      '  kb memory-write --json @payload.json',
      '  kb help memory-read',
      '  kb help memory-write',
      '  kb schema <memory-read|memory-write|remember|record|relate|annotate|search|query-relations|record-batch|annotate-batch>',
      '  kb validate <memory-read|memory-write|remember|record|relate|annotate|search|query-relations|record-batch|annotate-batch> --json @payload.json',
      '  kb remember --json @payload.json',
      '  kb record --json @payload.json',
      '  kb relate --json @payload.json',
      '  kb annotate --json @payload.json',
      '  kb record-batch --json @records.json',
      '  kb annotate-batch --json @annotations.json',
      '  kb schema <memory-read|memory-write|remember|record|relate|annotate|search|query-relations|record-batch|annotate-batch>',
      '  kb validate <memory-read|memory-write|remember|record|relate|annotate|search|query-relations|record-batch|annotate-batch> --json @payload.json',
      '  kb related --id ENTITY_ID',
      '  kb links --id ENTITY_ID',
      '  kb traverse --id ENTITY_ID [--type RELATION] [--direction in|out|both] [--depth 1] [--explicit-only] [--origin-kind entity|source|event|seed]',
      '  kb rebuild',
      '  kb doctor',
      '  kb export',
      '',
      'Notes:',
      '  - Use `kb record` for structured entities.',
      '  - Use `kb relate` for explicit relation edges between existing entities.',
      '  - Only use `record.relations[]` when you are already creating or rewriting the entity in the same payload.',
      '  - Do not use `kb annotate` for relation edges; it is only for timeline/provenance updates.',
      '  - Use `kb memory-read` for scoped vendor, procedure, and user-memory recall.',
      '  - Use `kb memory-write` for scoped memory updates that need explicit scope and lifecycle handling.',
      '  - `kb schema memory-read` and `kb schema memory-write` show the structured contract for agents.',
      '  - `kb help memory-read` and `kb help memory-write` show the exact payloads for the mounted runtime.',
      '  - Do not use key:value shorthand like `scope:user` or claim a save succeeded unless the write result proves it.',
      '  - Use `kb remember` for facts, sources, corrections, and narrative evidence capture.',
      '  - Use `kb query-relations` for relation-shaped questions; `kb search` is lexical/hybrid retrieval.',
      '  - Prefer `kb validate ... --json @file.json` before large write batches.',
      '',
      'Extra help:',
      '  kb help runtime',
      '  kb help operator'
    ].join('\n') + '\n',
    stderr: '',
    exitCode: 0
  };
}

function resolveKbSurfaceContext(
  env: Record<string, unknown>,
  config: FlueKbKnowledgeBaseConfig,
  tenantId: string
): KbSurfaceContext {
  const explicit = String(env.KB_BACKEND ?? config.persistence?.backend ?? 'auto').trim().toLowerCase();
  const hasCanonicalBindings =
    typeof env.KB_STATE === 'object' &&
    env.KB_STATE !== null &&
    typeof env.KB_CANONICAL_R2 === 'object' &&
    env.KB_CANONICAL_R2 !== null;
  const hasPartialBindings =
    typeof env.KB_STATE !== 'undefined' || typeof env.KB_CANONICAL_R2 !== 'undefined';

  let backend = explicit;
  if (!backend || backend === 'auto') {
    if (hasCanonicalBindings) {
      backend = 'r2';
    } else if (hasPartialBindings) {
      backend = 'incomplete-bindings';
    } else {
      backend = 'file';
    }
  }
  const canonical = backend === 'r2' && hasCanonicalBindings;

  return {
    tenantId,
    backend,
    transport: 'flue',
    canonical,
    workspaceRole: canonical ? 'canonical-production' : 'runtime-support'
  };
}

function addMutationAction(
  command: string,
  result: { stdout: string; stderr: string; exitCode: number }
): { stdout: string; stderr: string; exitCode: number } {
  const action = mutationAction(command);
  if (!action || result.exitCode !== 0 || !result.stdout.trim()) {
    return result;
  }

  try {
    const payload = JSON.parse(result.stdout) as {
      ok?: boolean;
      data?: unknown;
      meta?: unknown;
    };
    if (!payload.ok || !payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
      return result;
    }
    return {
      ...result,
      stdout: `${JSON.stringify(
        {
          ...payload,
          data: {
            action,
            ...(payload.data as Record<string, unknown>)
          }
        },
        null,
        2
      )}\n`
    };
  } catch {
    return result;
  }
}

function mutationAction(command: string): string | null {
  switch (command) {
    case 'remember':
      return 'kb_remembered';
    case 'record':
    case 'record-batch':
      return 'kb_recorded';
    case 'relate':
      return 'kb_related';
    case 'annotate':
    case 'annotate-batch':
      return 'kb_annotated';
    case 'delete':
      return 'kb_deleted';
    default:
      return null;
  }
}

function renderSuccess(
  data: unknown,
  meta: { command: string; duration_ms: number }
): { stdout: string; stderr: string; exitCode: number } {
  return {
    stdout: `${JSON.stringify({ ok: true, data, meta }, null, 2)}\n`,
    stderr: '',
    exitCode: 0
  };
}

function renderFailure(
  message: string,
  format: string | undefined,
  exitCode: number,
  code: string,
  meta: { command: string; duration_ms: number }
): { stdout: string; stderr: string; exitCode: number } {
  if (format === 'json') {
    return {
      stdout: '',
      stderr: `${JSON.stringify({ ok: false, error: { code, message }, meta }, null, 2)}\n`,
      exitCode
    };
  }
  return {
    stdout: '',
    stderr: `${message}\n`,
    exitCode
  };
}

function parseSimpleArgs(argv: string[]): {
  positionals: string[];
  flags: Record<string, string | boolean>;
} {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value?.startsWith('--')) {
      if (value) positionals.push(value);
      continue;
    }
    const trimmed = value.slice(2);
    const separator = trimmed.indexOf('=');
    if (separator >= 0) {
      flags[trimmed.slice(0, separator)] = trimmed.slice(separator + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      flags[trimmed] = next;
      index += 1;
      continue;
    }
    flags[trimmed] = true;
  }

  return { positionals, flags };
}

function readDeleteId(parsed: { positionals: string[]; flags: Record<string, string | boolean> }): string {
  const flagId = readString(parsed.flags.id);
  if (flagId) return flagId;
  const positionalId = parsed.positionals[1];
  if (positionalId) return positionalId;
  throw new Error('Missing required id');
}

async function resolveRuntimeProductConfig(
  fs: InMemoryFs,
  env: Record<string, unknown>,
  host: FlueKbHostAdapter
): Promise<FlueKbProductConfig> {
  return host.resolveProductConfig(fs, env);
}

async function deleteKnowledgeRecord(service: FlueKbService, id: string): Promise<unknown> {
  const store = readStore(service);
  if (!store) {
    return service.deleteRecord(id);
  }

  const entityMarkdown = await store.getEntityMarkdown(id);
  if (entityMarkdown) {
    return service.deleteRecord(id);
  }

  const sourceMarkdown = await store.getSourceMarkdown(id);
  if (sourceMarkdown) {
    return service.deleteRecord(id);
  }

  const allLinks = await store.listLinks();
  const removed = allLinks.filter((link) => link.id === id);
  if (removed.length === 0) {
    return service.deleteRecord(id);
  }

  const remaining = allLinks.filter((link) => link.id !== id);
  const touchedOrigins = new Map<string, KnowledgeLinkOrigin>();
  for (const link of removed) {
    if (!link.originKind || !link.originId) continue;
    touchedOrigins.set(`${link.originKind}:${link.originId}`, {
      kind: link.originKind,
      id: link.originId
    });
  }

  const remainingByOrigin = new Map<string, typeof remaining>();
  for (const link of remaining) {
    if (!link.originKind || !link.originId) continue;
    const key = `${link.originKind}:${link.originId}`;
    const bucket = remainingByOrigin.get(key) ?? [];
    bucket.push(link);
    remainingByOrigin.set(key, bucket);
  }

  for (const origin of touchedOrigins.values()) {
    await store.replaceLinksForOrigin(origin, remainingByOrigin.get(`${origin.kind}:${origin.id}`) ?? []);
  }

  readInvalidateLexicalCaches(service)?.();

  return {
    id,
    kind: 'relation',
    deleted: true,
    removedLinks: removed.length,
    removedEvents: 0
  };
}

function readStore(service: FlueKbService): KnowledgeStore | null {
  const candidate = (service as unknown as { store?: unknown }).store;
  if (!candidate || typeof candidate !== 'object') return null;
  return typeof (candidate as KnowledgeStore).listLinks === 'function' &&
      typeof (candidate as KnowledgeStore).getEntityMarkdown === 'function' &&
      typeof (candidate as KnowledgeStore).replaceLinksForOrigin === 'function'
    ? candidate as KnowledgeStore
    : null;
}

function readInvalidateLexicalCaches(service: FlueKbService): (() => void) | null {
  const candidate = (service as unknown as { invalidateLexicalCaches?: unknown }).invalidateLexicalCaches;
  return typeof candidate === 'function' ? (candidate as (this: FlueKbService) => void).bind(service) : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
