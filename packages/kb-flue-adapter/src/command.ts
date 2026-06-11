import type { Command } from '@flue/sdk/client';
import { runKnowledgeBaseCli, type KnowledgeBaseCliExecutor } from '@emmassist-co/kb-cli';
import type { KnowledgeBaseService } from '@emmassist-co/kb-core';
import { createKbRuntimeContext, renderKbRuntimeContract } from './runtime-contract.js';

export interface KnowledgeBaseRuntimeLike {
  getService(): Promise<KnowledgeBaseService>;
  flush(): Promise<null>;
  rebuild(): Promise<unknown>;
}

export interface CreateKbCommandOptions {
  runtime?: KnowledgeBaseRuntimeLike;
  telemetry?: {
    log(event: KbRuntimeTelemetryEvent): void;
  };
}

export interface KbRuntimeTelemetryEvent {
  type: 'kb_runtime_query';
  operation: 'search' | 'query-relations';
  query: string;
  mode: string;
  resultCount: number;
  resultIds: string[];
  payloadBytes: number;
  estimatedTokens: number;
  durationMs: number;
  relationType?: string;
  anchorId?: string;
}

export interface WorkspaceFsLike {
  readFileBuffer(path: string): Promise<Uint8Array | Buffer>;
}

export function createKbCommand(
  fs: WorkspaceFsLike,
  env: Record<string, unknown>,
  options: CreateKbCommandOptions = {}
): Command {
  return {
    name: 'kb',
    execute: async (args: string[]) => {
      const meta = {
        command: args[0] ?? 'help',
        duration_ms: 0
      };
      const startedAt = Date.now();
      const parsed = parseSimpleArgs(args);
      const format = typeof parsed.flags.format === 'string' ? parsed.flags.format : undefined;
      const helpTopic = meta.command === 'help' ? parsed.positionals[1] : meta.command;

      try {
        if (!shouldUsePackageCli(meta.command) || meta.command === 'help' || parsed.flags.help) {
          return renderLocalHelp(helpTopic, env);
        }
        const result = await runKnowledgeBaseCli(args, {
          cwd: process.cwd(),
          env: Object.fromEntries(
            Object.entries(env).map(([key, value]) => [key, value == null ? undefined : String(value)])
          ),
          executor: options.runtime ? await createRuntimeExecutor(options.runtime, env, options.telemetry) : undefined,
          readFile: async (target) => {
            const resolved = target.startsWith('/workspace/')
              ? target
              : `/workspace/${target.replace(/^\//, '')}`;
            const bytes = await fs.readFileBuffer(resolved);
            return new TextDecoder().decode(bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes));
          }
        });
        meta.duration_ms = Date.now() - startedAt;
        if (result.exitCode !== 0) {
          return wrapFailure(result.stderr, format, meta);
        }
        if (parsed.positionals[0] !== 'help') {
          return {
            stdout: `${JSON.stringify({ ok: true, data: parseMaybeJson(result.stdout), meta }, null, 2)}\n`,
            stderr: '',
            exitCode: 0
          };
        }
        return result;
      } catch (error) {
        meta.duration_ms = Date.now() - startedAt;
        return wrapFailure(
          error instanceof Error ? error.message : String(error),
          format,
          meta
        );
      }
    }
  };
}

function shouldUsePackageCli(commandName: string): boolean {
  return new Set([
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
  ]).has(commandName);
}

async function createRuntimeExecutor(
  runtime: KnowledgeBaseRuntimeLike,
  env: Record<string, unknown>,
  telemetry?: CreateKbCommandOptions['telemetry']
): Promise<KnowledgeBaseCliExecutor> {
  let servicePromise: Promise<KnowledgeBaseService> | null = null;
  const getService = async () => {
    if (!servicePromise) servicePromise = runtime.getService();
    return servicePromise;
  };
  return {
    inspect: async () => ({
      tenantId: String(env.WORKSPACE_TENANT_ID ?? env.KB_TENANT_ID ?? 'default'),
      backend: String(env.KB_BACKEND ?? 'runtime'),
      transport: 'flue',
      mode: 'local',
      canonical: String(env.KB_BACKEND ?? '').trim().toLowerCase() === 'cloudflare',
      workspaceRole: String(env.KB_BACKEND ?? '').trim().toLowerCase() === 'cloudflare'
        ? 'canonical-production'
        : 'runtime-support',
      summary: await (await getService()).list()
    }),
    list: async () => (await getService()).list(),
    get: async (id) => (await getService()).get(id),
    delete: async (id) => (await getService()).deleteRecord(id),
    captureSource: async (input) => (await getService()).captureSource(input as Parameters<KnowledgeBaseService['captureSource']>[0]),
    listEvents: async () => (await getService()).listEvents(),
    getEvent: async (id) => (await getService()).getEvent(id),
    deleteEvent: async (id) => (await getService()).deleteEvent(id),
    listDrafts: async () => (await getService()).listDrafts(),
    getDraft: async (entityId) => (await getService()).getDraft(entityId),
    putDraft: async (input) => (await getService()).updateEntityDraft(input as Parameters<KnowledgeBaseService['updateEntityDraft']>[0]),
    deleteDraft: async (entityId) => (await getService()).deleteDraft(entityId),
    listRelations: async (input) => (await getService()).listRelations(input as Parameters<KnowledgeBaseService['listRelations']>[0]),
    replaceRelations: async (input) => (await getService()).replaceRelations(input as Parameters<KnowledgeBaseService['replaceRelations']>[0]),
    clearRelations: async (input) => (await getService()).clearRelations(input as unknown as Parameters<KnowledgeBaseService['clearRelations']>[0]),
    search: async (input) => {
      const startedAt = Date.now();
      const result = await (await getService()).search(input as unknown as Parameters<KnowledgeBaseService['search']>[0]);
      emitQueryTelemetry(
        telemetry,
        {
          operation: 'search',
          query: result.query,
          mode: result.mode,
          resultCount: result.results.length,
          resultIds: result.results.map((entry) => entry.id)
        },
        result,
        startedAt
      );
      return result;
    },
    queryRelations: async (input) => {
      const startedAt = Date.now();
      const typedInput = input as unknown as Parameters<KnowledgeBaseService['queryRelations']>[0];
      const result = await (await getService()).queryRelations(typedInput);
      emitQueryTelemetry(
        telemetry,
        {
          operation: 'query-relations',
          query: result.query,
          mode: typedInput.mode ?? 'graph-first-hybrid',
          resultCount: result.results.length,
          resultIds: result.results.map((entry) => entry.id),
          relationType: result.classification.relationType ?? undefined,
          anchorId: result.classification.anchorId ?? undefined
        },
        result,
        startedAt
      );
      return result;
    },
    remember: async (input) => (await getService()).remember(input as Parameters<KnowledgeBaseService['remember']>[0]),
    record: async (input) => (await getService()).record(input as Parameters<KnowledgeBaseService['record']>[0]),
    recordSource: async (input) => (await getService()).recordSource(input as Parameters<KnowledgeBaseService['recordSource']>[0]),
    relate: async (input) => (await getService()).relate(input as Parameters<KnowledgeBaseService['relate']>[0]),
    annotate: async (input) => (await getService()).annotate(input as Parameters<KnowledgeBaseService['annotate']>[0]),
    related: async (id) => (await getService()).related(id),
    links: async (id) => (await getService()).links(id),
    traverse: async (input) => (await getService()).traverse(input as Parameters<KnowledgeBaseService['traverse']>[0]),
    rebuild: () => runtime.rebuild(),
    doctor: async () => (await getService()).doctor(),
    export: async () => (await getService()).export(),
    serve: async () => {
      throw new Error('Serve is not supported through the Flue adapter.');
    }
  };
}

function emitQueryTelemetry(
  telemetry: CreateKbCommandOptions['telemetry'] | undefined,
  event: Omit<KbRuntimeTelemetryEvent, 'type' | 'payloadBytes' | 'estimatedTokens' | 'durationMs'>,
  payload: unknown,
  startedAt: number
): void {
  const serialized = JSON.stringify(payload);
  const payloadBytes = Buffer.byteLength(serialized, 'utf8');
  const record: KbRuntimeTelemetryEvent = {
    type: 'kb_runtime_query',
    ...event,
    payloadBytes,
    estimatedTokens: Math.ceil(payloadBytes / 4),
    durationMs: Date.now() - startedAt
  };
  if (telemetry) {
    telemetry.log(record);
    return;
  }
  console.log(JSON.stringify(record));
}

function parseSimpleArgs(argv: string[]): { positionals: string[]; flags: Record<string, string | boolean> } {
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

function parseMaybeJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

function renderLocalHelp(commandName: string | undefined, env: Record<string, unknown>): { stdout: string; stderr: string; exitCode: number } {
  if (commandName === 'operator') {
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
        '',
        'Use these only for direct KB repair, cleanup, or inspection.',
        'Default agent work should stay on `search`, `query-relations`, `remember`, `record`, `relate`, and `annotate`.'
      ].join('\n') + '\n',
      stderr: '',
      exitCode: 0
    };
  }
  if (commandName === 'remember') {
    return {
      stdout: [
        'Usage: kb remember --json @payload.json',
        '   or: printf \'%s\\n\' \'{...}\' | kb remember --json -',
        '',
        'Required fields:',
        '  intent, summary',
        '',
        'Optional fields:',
        '  content, entities, relations, source, effective_at, confidence',
        '',
        'Use this for durable facts, corrections, and raw evidence capture.'
      ].join('\n') + '\n',
      stderr: '',
      exitCode: 0
    };
  }
  if (commandName === 'runtime') {
    return {
      stdout: `${renderKbRuntimeContract(createKbRuntimeContext(env))}\n`,
      stderr: '',
      exitCode: 0
    };
  }
  return {
    stdout: [
      'kb <command> [flags]',
      '',
      'Default runtime surface:',
      '  kb inspect',
      '  kb list',
      '  kb get <id>',
      '  kb search --json \'{"query":"...","mode":"search-only|graph-only|graph-first-hybrid","lexicalBackend":"legacy-lexical|bm25-lexical"}\' [--assist-query]',
      '  kb query-relations --json \'{"query":"...","mode":"graph-only|graph-first-hybrid","lexicalBackend":"legacy-lexical|bm25-lexical"}\'',
      '  kb remember --json @payload.json',
      '  kb record --json @payload.json',
      '  kb relate --json @payload.json',
      '  kb annotate --json @payload.json',
      '  kb related --id ENTITY_ID',
      '  kb links --id ENTITY_ID',
      '  kb traverse --id ENTITY_ID [--type RELATION] [--direction in|out|both] [--depth 1]',
      '  kb rebuild',
      '  kb doctor',
      '  kb export',
      '  kb help runtime',
      '  kb help operator',
      '',
      'Notes:',
      '  - Search first when the fact might already exist.',
      '  - Use `kb remember` for new facts, corrections, and evidence capture.',
      '  - Use `kb record` only when you already have an explicit structured KB record.',
      '  - Use `kb relate` for explicit relation edges between existing entities.',
      '  - Use `kb query-relations` for owner/founder/approver-style questions before falling back to broad search.',
      '  - Run `kb help runtime` for the current tenant/backend/canonicality contract.',
      '  - Run `kb help operator` only when you need direct KB repair or inspection.',
      '  - Prefer `--json -` or `--json @file.json` for write payload transport.'
    ].join('\n') + '\n',
    stderr: '',
    exitCode: 0
  };
}

function wrapFailure(
  stderr: string,
  format: string | undefined,
  meta: { command: string; duration_ms: number }
): { stdout: string; stderr: string; exitCode: number } {
  const message = stderr.trim() || 'KB CLI command failed';
  const code = inferErrorCode(message);
  const exitCode = inferExitCode(code);
  if (format === 'json') {
    return {
      stdout: '',
      stderr: `${JSON.stringify({
        ok: false,
        error: {
          code,
          message
        },
        meta
      }, null, 2)}\n`,
      exitCode
    };
  }
  return {
    stdout: '',
    stderr: `${message}\n`,
    exitCode
  };
}

function inferErrorCode(message: string): string {
  if (/Missing required field|Missing required JSON field|Usage:/i.test(message)) {
    return 'VALIDATION_ERROR';
  }
  if (/not found/i.test(message)) {
    return 'NOT_FOUND';
  }
  return 'INTERNAL_ERROR';
}

function inferExitCode(code: string): number {
  switch (code) {
    case 'VALIDATION_ERROR':
      return 2;
    case 'NOT_FOUND':
      return 4;
    default:
      return 1;
  }
}
