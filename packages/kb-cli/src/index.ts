import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  KnowledgeBaseService,
  type KnowledgeBaseConfig,
  type KnowledgeEntityKind,
  type KnowledgeWorkspaceCapabilities,
  type KnowledgeLexicalBackend,
  type KnowledgeSearchMode
} from '@emmassist-co/kb-core';
import { FileKnowledgeStore } from '@emmassist-co/kb-storage-file';
import { startKnowledgeBaseCliDaemon } from './daemon.js';
import {
  executeKnowledgeBaseCloudflareDeployCommand,
  executeKnowledgeBaseCloudflareVerifyCommand,
  renderKnowledgeBaseCloudflareHelp
} from './cloudflare-deploy.js';
import { resolveKnowledgeBaseRemoteAuth } from './remote-auth.js';
import {
  executeKnowledgeBaseSyncCommand,
  renderKnowledgeBaseSyncHelp,
  summarizeKnowledgeBaseSyncResult
} from './sync.js';
import {
  executeKnowledgeBaseSyncDaemonCommand,
  renderKnowledgeBaseSyncDaemonHelp,
  summarizeKnowledgeBaseSyncDaemonResult
} from './sync-daemon.js';

type JsonObject = Record<string, unknown>;
type KnowledgeRelationsFilter = NonNullable<Parameters<KnowledgeBaseService['listRelations']>[0]>;

export interface KnowledgeBaseCliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface KnowledgeBaseCliOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdin?: string;
  executor?: KnowledgeBaseCliExecutor;
  readFile?: (filePath: string) => Promise<string>;
  transport?: KnowledgeBaseCliTransport;
  cloudflareDeploy?: (
    argv: string[],
    options?: {
      cwd?: string;
      env?: Record<string, string | undefined>;
    }
  ) => Promise<unknown>;
  cloudflareVerify?: (
    argv: string[],
    options?: {
      cwd?: string;
      env?: Record<string, string | undefined>;
    }
  ) => Promise<unknown>;
}

export type KnowledgeBaseCliTransport =
  | {
      mode: 'local';
      tenantId: string;
      rootDir?: string;
      backend?: 'file' | 'r2-mirror';
      config?: KnowledgeBaseConfig;
    }
  | {
      mode: 'http';
      baseUrl: string;
      token?: string;
      fetch?: typeof fetch;
    };

interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

interface KnowledgeBaseCliExecutor {
  inspect(): Promise<unknown>;
  list(): Promise<unknown>;
  get(id: string): Promise<unknown>;
  delete(id: string): Promise<unknown>;
  captureSource(input: JsonObject): Promise<unknown>;
  listEvents(): Promise<unknown>;
  getEvent(id: string): Promise<unknown>;
  deleteEvent(id: string): Promise<unknown>;
  listDrafts(): Promise<unknown>;
  getDraft(entityId: string): Promise<unknown>;
  putDraft(input: JsonObject): Promise<unknown>;
  deleteDraft(entityId: string): Promise<unknown>;
  listRelations(input: JsonObject): Promise<unknown>;
  replaceRelations(input: JsonObject): Promise<unknown>;
  clearRelations(input: JsonObject): Promise<unknown>;
  search(input: JsonObject): Promise<unknown>;
  queryRelations(input: JsonObject): Promise<unknown>;
  remember(input: JsonObject): Promise<unknown>;
  record(input: JsonObject): Promise<unknown>;
  relate(input: JsonObject): Promise<unknown>;
  annotate(input: JsonObject): Promise<unknown>;
  related(id: string): Promise<unknown>;
  links(id: string): Promise<unknown>;
  traverse(input: JsonObject): Promise<unknown>;
  rebuild(): Promise<unknown>;
  doctor(): Promise<unknown>;
  export(): Promise<unknown>;
  serve(input: JsonObject): Promise<unknown>;
}

export type { KnowledgeBaseCliExecutor };

const DEFAULT_CONFIG: KnowledgeBaseConfig = {
  enabled: true,
  mode: 'basic',
  writePolicy: 'mixed',
  persistence: {
    backend: 'file',
    cacheRefreshPolicy: 'none',
    rootDir: '.kb'
  },
  ingest: {
    agentTurns: false,
    userCorrections: false,
    workspaceSignals: false,
    externalResearch: false
  }
};

export async function runKnowledgeBaseCli(
  argv: string[],
  options: KnowledgeBaseCliOptions = {}
): Promise<KnowledgeBaseCliResult> {
  try {
    const parsed = parseArgs(argv);
    const command = parsed.positionals[0] ?? 'help';
    if (command === 'help' || parsed.flags.help) {
      const topic = parsed.positionals[1];
      return { stdout: `${renderHelp(topic)}\n`, stderr: '', exitCode: 0 };
    }
    if (command === 'schema') {
      const topic = requireSchemaCommand(parsed.positionals[1]);
      return {
        stdout: `${JSON.stringify(renderSchema(topic), null, 2)}\n`,
        stderr: '',
        exitCode: 0
      };
    }
    if (command === 'validate') {
      const topic = requireSchemaCommand(parsed.positionals[1]);
      const errors = validatePayload(topic, await loadJsonValue(parsed, options));
      if (errors.length > 0) {
        throw new Error(renderValidationErrors(topic, errors));
      }
      return {
        stdout: `${JSON.stringify({ ok: true, command: topic, valid: true }, null, 2)}\n`,
        stderr: '',
        exitCode: 0
      };
    }
    if (command === 'sync') {
      const result = await executeKnowledgeBaseSyncCommand(buildSubcommandArgv(parsed, 1), options);
      return {
        stdout: `${renderOutput(summarizeKnowledgeBaseSyncResult(result, {
          verbose: parsed.flags.verbose === true,
          changes: parsed.flags.changes === true,
          conflicts: parsed.flags.conflicts === true,
          stats: parsed.flags.stats === true
        }), 'json')}\n`,
        stderr: '',
        exitCode: 0
      };
    }
    if (command === 'daemon') {
      const result = await executeKnowledgeBaseSyncDaemonCommand(buildSubcommandArgv(parsed, 1), options);
      const action = parsed.positionals[1] ?? 'status';
      return {
        stdout: result.stdout
          ? `${renderOutput(summarizeKnowledgeBaseSyncDaemonResult(result, {
            action,
            verbose: parsed.flags.verbose === true,
            logs: parsed.flags.logs === true,
            stats: parsed.flags.stats === true
          }), 'json')}\n`
          : '',
        stderr: result.stderr ? `${result.stderr}\n` : '',
        exitCode: result.exitCode
      };
    }
    if (command === 'cloudflare') {
      const action = parsed.positionals[1] ?? 'help';
      if (action === 'help' || parsed.flags.help) {
        return {
          stdout: `${renderKnowledgeBaseCloudflareHelp()}\n`,
          stderr: '',
          exitCode: 0
        };
      }
      if (action === 'deploy') {
        const result = await (options.cloudflareDeploy ?? executeKnowledgeBaseCloudflareDeployCommand)(
          buildSubcommandArgv(parsed, 2),
          {
            cwd: options.cwd,
            env: options.env
          }
        );
        return {
          stdout: `${renderOutput(result, 'json')}\n`,
          stderr: '',
          exitCode: 0
        };
      }
      if (action === 'verify') {
        const result = await (options.cloudflareVerify ?? executeKnowledgeBaseCloudflareVerifyCommand)(
          buildSubcommandArgv(parsed, 2),
          {
            cwd: options.cwd,
            env: options.env
          }
        );
        return {
          stdout: `${renderOutput(result, 'json')}\n`,
          stderr: '',
          exitCode: 0
        };
      }
      if (action !== 'deploy' && action !== 'verify') {
        throw new Error(`Unknown kb cloudflare command: ${action}`);
      }
    }
    const executor = await createExecutor(options);
    const format = typeof parsed.flags.format === 'string' ? parsed.flags.format : 'json';
    const data = await executeCommand(executor, parsed, options);
    return {
      stdout: `${renderOutput(data, format)}\n`,
      stderr: '',
      exitCode: 0
    };
  } catch (error) {
    return {
      stdout: '',
      stderr: `${error instanceof Error ? error.message : String(error)}\n`,
      exitCode: 1
    };
  }
}

async function createExecutor(options: KnowledgeBaseCliOptions): Promise<KnowledgeBaseCliExecutor> {
  if (options.executor) return options.executor;
  const transport = resolveTransport(options);
  if (transport.mode === 'http') {
    return createHttpExecutor(transport);
  }
  const config = transport.config ?? {
    ...DEFAULT_CONFIG,
    persistence: {
      ...DEFAULT_CONFIG.persistence,
      rootDir: transport.rootDir ?? DEFAULT_CONFIG.persistence.rootDir
    }
  };
  const rootDir = transport.rootDir ?? path.resolve(options.cwd ?? process.cwd(), config.persistence.rootDir, transport.tenantId);
  const service = new KnowledgeBaseService(
    transport.tenantId,
    config,
    new FileKnowledgeStore(rootDir, config.mode)
  );
  const capabilities = buildLocalCapabilities(transport, config.mode, rootDir);
  return {
    inspect: async () => ({
      ...capabilities,
      summary: await service.list()
    }),
    list: () => service.list(),
    get: (id) => service.get(id),
    delete: (id) => service.deleteRecord(id),
    captureSource: (input) => service.captureSource(coerceCaptureSourceInput(input)),
    listEvents: () => service.listEvents(),
    getEvent: (id) => service.getEvent(id),
    deleteEvent: (id) => service.deleteEvent(id),
    listDrafts: () => service.listDrafts(),
    getDraft: (entityId) => service.getDraft(entityId),
    putDraft: (input) => service.updateEntityDraft(coerceDraftInput(input)),
    deleteDraft: (entityId) => service.deleteDraft(entityId),
    listRelations: (input) => service.listRelations(coerceRelationsFilterInput(input)),
    replaceRelations: (input) => service.replaceRelations(coerceReplaceRelationsInput(input)),
    clearRelations: (input) => service.clearRelations(coerceOriginInput(input)),
    search: (input) => service.search(coerceSearchInput(input)),
    queryRelations: (input) => service.queryRelations(coerceRelationInput(input)),
    remember: (input) => service.remember(input as Parameters<KnowledgeBaseService['remember']>[0]),
    record: (input) => service.record(input as Parameters<KnowledgeBaseService['record']>[0]),
    relate: (input) => service.relate(input as Parameters<KnowledgeBaseService['relate']>[0]),
    annotate: (input) => service.annotate(input as Parameters<KnowledgeBaseService['annotate']>[0]),
    related: (id) => service.related(id),
    links: (id) => service.links(id),
    traverse: (input) => service.traverse(input as Parameters<KnowledgeBaseService['traverse']>[0]),
    rebuild: async () => {
      const exported = await service.export();
      return {
        ok: true,
        version: null,
        rebuiltAt: new Date().toISOString(),
        counts: {
          entities: exported.entities.length,
          sources: exported.sources.length,
          events: exported.events.length,
          links: exported.links.length,
          drafts: exported.drafts.length,
          registry: exported.entities.length
        }
      };
    },
    doctor: () => service.doctor(),
    export: () => service.export()
    ,
    serve: (input) => startServe(input, transport.tenantId, options, config)
  };
}

function createHttpExecutor(
  transport: Extract<KnowledgeBaseCliTransport, { mode: 'http' }>
): KnowledgeBaseCliExecutor {
  const doFetch = transport.fetch ?? fetch;
  const request = async (pathname: string, init?: { method?: string; body?: unknown }): Promise<unknown> => {
    const headers: Record<string, string> = {};
    if (init?.body) {
      headers['content-type'] = 'application/json';
    }
    if (transport.token) {
      headers.authorization = `Bearer ${transport.token}`;
    }
    const response = await doFetch(`${transport.baseUrl}${pathname}`, {
      method: init?.method ?? 'GET',
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined
    });
    const payload = await response.json() as { ok?: boolean; data?: unknown; error?: { message?: string } };
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error?.message ?? `HTTP ${response.status}`);
    }
    return payload.data ?? payload;
  };
  return {
    inspect: async () => {
      const payload = await request('/v1/inspect') as { data?: unknown; capabilities?: unknown };
      return payload.data ?? payload.capabilities ?? payload;
    },
    list: () => request('/v1/entities'),
    get: (id) => request(`/v1/entities/${encodeURIComponent(id)}`),
    delete: (id) => request(`/v1/entities/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    captureSource: (input) => request('/v1/capture-source', { method: 'POST', body: coerceCaptureSourceInput(input) }),
    listEvents: () => request('/v1/events'),
    getEvent: (id) => request(`/v1/events/${encodeURIComponent(id)}`),
    deleteEvent: (id) => request(`/v1/events/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    listDrafts: () => request('/v1/drafts'),
    getDraft: (entityId) => request(`/v1/drafts/${encodeURIComponent(entityId)}`),
    putDraft: (input) => {
      const payload = coerceDraftInput(input);
      return request(`/v1/drafts/${encodeURIComponent(payload.entityId)}`, { method: 'PUT', body: payload });
    },
    deleteDraft: (entityId) => request(`/v1/drafts/${encodeURIComponent(entityId)}`, { method: 'DELETE' }),
    listRelations: (input) => request(buildRelationsPath(coerceRelationsFilterInput(input))),
    replaceRelations: (input) => request('/v1/relations', { method: 'PUT', body: coerceReplaceRelationsInput(input) }),
    clearRelations: (input) => request(buildClearRelationsPath(coerceOriginInput(input)), { method: 'DELETE' }),
    search: (input) => request('/v1/search', { method: 'POST', body: coerceSearchInput(input) }),
    queryRelations: (input) => request('/v1/query-relations', { method: 'POST', body: coerceRelationInput(input) }),
    remember: (input) => request('/v1/remember', { method: 'POST', body: input }),
    record: (input) => request('/v1/record', { method: 'POST', body: input }),
    relate: (input) => request('/v1/relate', { method: 'POST', body: input }),
    annotate: (input) => request('/v1/annotate', { method: 'POST', body: input }),
    related: (id) => request(`/v1/entities/${encodeURIComponent(id)}/related`),
    links: (id) => request(`/v1/entities/${encodeURIComponent(id)}/links`),
    traverse: (input) => request('/v1/traverse', { method: 'POST', body: input }),
    rebuild: () => request('/v1/rebuild', { method: 'POST', body: {} }),
    doctor: () => request('/v1/doctor'),
    export: () => request('/v1/export')
    ,
    serve: async () => {
      throw new Error('Serve is only supported in local mode');
    }
  };
}

async function executeCommand(
  executor: KnowledgeBaseCliExecutor,
  parsed: ParsedArgs,
  options: KnowledgeBaseCliOptions
): Promise<unknown> {
  const [command] = parsed.positionals;
  switch (command) {
    case 'inspect':
      return executor.inspect();
    case 'list':
      return executor.list();
    case 'get':
      return executor.get(readId(parsed));
    case 'delete':
      return executor.delete(readId(parsed));
    case 'capture-source':
      return executor.captureSource(await loadJsonPayload(parsed, options));
    case 'events':
      return executor.listEvents();
    case 'get-event':
      return executor.getEvent(readId(parsed));
    case 'delete-event':
      return executor.deleteEvent(readId(parsed));
    case 'drafts':
      return executor.listDrafts();
    case 'get-draft':
      return executor.getDraft(readId(parsed));
    case 'put-draft':
      return executor.putDraft(await loadJsonPayload(parsed, options));
    case 'delete-draft':
      return executor.deleteDraft(readId(parsed));
    case 'relations':
      return executor.listRelations(buildRelationsFilterPayload(parsed));
    case 'replace-relations':
      return executor.replaceRelations(await loadJsonPayload(parsed, options));
    case 'clear-relations':
      return executor.clearRelations(buildOriginPayload(parsed));
    case 'search':
      return executor.search(await loadJsonPayload(parsed, options));
    case 'query-relations':
      return executor.queryRelations(await loadJsonPayload(parsed, options));
    case 'remember':
      assertRememberUsesJsonPayload(parsed);
      return executor.remember(coerceRememberInput(await loadJsonPayload(parsed, options)));
    case 'record':
      return executor.record(coerceRecordInput(await loadJsonPayload(parsed, options)));
    case 'relate':
      return executor.relate(coerceRelateInput(await loadJsonPayload(parsed, options)));
    case 'record-batch':
      return executeBatch(await loadJsonArray(parsed, options), (entry) => executor.record(coerceRecordInput(entry)));
    case 'annotate':
      return executor.annotate(coerceAnnotateInput(await loadJsonPayload(parsed, options)));
    case 'annotate-batch':
      return executeBatch(await loadJsonArray(parsed, options), (entry) => executor.annotate(coerceAnnotateInput(entry)));
    case 'related':
      return executor.related(readId(parsed));
    case 'links':
      return executor.links(readId(parsed));
    case 'traverse':
      return executor.traverse(buildTraversePayload(parsed));
    case 'rebuild':
      return executor.rebuild();
    case 'doctor':
      return executor.doctor();
    case 'export':
      return executor.export();
    case 'serve':
      return executor.serve(buildServePayload(parsed));
    default:
      throw new Error(`Unknown kb command: ${command}`);
  }
}

function resolveTransport(options: KnowledgeBaseCliOptions): KnowledgeBaseCliTransport {
  if (options.transport) return options.transport;
  const env = options.env ?? process.env;
  const baseUrl = env.KB_BASE_URL;
  if (baseUrl) {
    return {
      mode: 'http',
      baseUrl,
      ...resolveKnowledgeBaseRemoteAuth(env)
    };
  }
  const backend = readCliBackend(env.KB_BACKEND);
  const tenantId = env.KB_TENANT_ID ?? env.WORKSPACE_TENANT_ID ?? 'default';
  if (backend === 'cloudflare' || backend === 'r2' || backend === 'http') {
    throw new Error(
      `KB_BACKEND=${backend} is not a direct local CLI workspace. Use KB_BASE_URL to target the canonical deployed kb-http surface, or use KB_BACKEND=file|r2-mirror for support workspaces.`
    );
  }
  if (backend === 'r2-mirror') {
    return {
      mode: 'local',
      tenantId,
      backend,
      rootDir: env.KB_ROOT_DIR ?? path.resolve(options.cwd ?? process.cwd(), env.KB_R2_MIRROR_ROOT ?? '.kb-r2', tenantId)
    };
  }
  return {
    mode: 'local',
    tenantId,
    backend,
    rootDir: env.KB_ROOT_DIR
  };
}

async function loadJsonPayload(parsed: ParsedArgs, options: KnowledgeBaseCliOptions): Promise<JsonObject> {
  return parseJsonObject(await loadJsonValue(parsed, options));
}

async function loadJsonArray(parsed: ParsedArgs, options: KnowledgeBaseCliOptions): Promise<JsonObject[]> {
  const value = await loadJsonValue(parsed, options);
  if (!Array.isArray(value)) {
    throw new Error('Expected a JSON array payload');
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Expected object entries in JSON array payload at index ${index}`);
    }
    return entry as JsonObject;
  });
}

async function loadJsonValue(parsed: ParsedArgs, options: KnowledgeBaseCliOptions): Promise<unknown> {
  const raw = typeof parsed.flags.json === 'string' ? parsed.flags.json : '{}';
  return JSON.parse(await readJsonInput(raw, options) || '{}') as unknown;
}

async function readJsonInput(raw: string, options: KnowledgeBaseCliOptions): Promise<string> {
  if (raw === '-') return options.stdin ?? '';
  if (raw.startsWith('@')) {
    const target = path.resolve(options.cwd ?? process.cwd(), raw.slice(1));
    if (options.readFile) return options.readFile(target);
    return readFile(target, 'utf8');
  }
  if (looksLikeJsonFilePath(raw)) {
    throw new Error('JSON value for --json looks like a file path. Use `--json @file.json` to read from disk or `--json -` for stdin.');
  }
  return raw;
}

function parseJsonObject(parsed: unknown): JsonObject {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object payload');
  }
  return parsed as JsonObject;
}

function coerceSearchInput(input: JsonObject): Parameters<KnowledgeBaseService['search']>[0] {
  return {
    query: requireString(input.query, 'query'),
    kind: readString(input.kind) as KnowledgeEntityKind | undefined,
    limit: readNumber(input.limit) ?? 10,
    assistQuery: readBoolean(input.assistQuery),
    mode: readString(input.mode) as KnowledgeSearchMode | undefined,
    lexicalBackend: readString(input.lexicalBackend) as KnowledgeLexicalBackend | undefined
  };
}

function coerceCaptureSourceInput(input: JsonObject): Parameters<KnowledgeBaseService['captureSource']>[0] {
  return {
    id: readString(input.id),
    kind: readString(input.kind) as Parameters<KnowledgeBaseService['captureSource']>[0]['kind'],
    title: requireString(input.title, 'title'),
    url: readString(input.url),
    authors: readStringArray(input.authors),
    tags: readStringArray(input.tags),
    linkedEntities: readStringArray(input.linkedEntities) ?? readStringArray(input.linked_entities),
    summary: readString(input.summary),
    content: requireString(input.content, 'content'),
    citations: readStringArray(input.citations),
    extractEntities: readBoolean(input.extractEntities) ?? readBoolean(input.extract_entities),
    createdAt: readString(input.createdAt) ?? readString(input.created_at)
  };
}

function coerceRecordInput(input: JsonObject): Parameters<KnowledgeBaseService['record']>[0] {
  const errors = validatePayload('record', input);
  if (errors.length > 0) throw new Error(renderValidationErrors('record', errors));
  return input as Parameters<KnowledgeBaseService['record']>[0];
}

function coerceRelateInput(input: JsonObject): Parameters<KnowledgeBaseService['relate']>[0] {
  const errors = validatePayload('relate', input);
  if (errors.length > 0) throw new Error(renderValidationErrors('relate', errors));
  return input as Parameters<KnowledgeBaseService['relate']>[0];
}

function coerceRelationInput(input: JsonObject): Parameters<KnowledgeBaseService['queryRelations']>[0] {
  return {
    query: requireString(input.query, 'query'),
    limit: readNumber(input.limit) ?? 10,
    mode: readString(input.mode) as Extract<KnowledgeSearchMode, 'graph-only' | 'graph-first-hybrid'> | undefined,
    lexicalBackend: readString(input.lexicalBackend) as KnowledgeLexicalBackend | undefined,
    currentOnly: readBoolean(input.currentOnly),
    asOf: readString(input.asOf)
  };
}

function coerceAnnotateInput(input: JsonObject): Parameters<KnowledgeBaseService['annotate']>[0] {
  const errors = validatePayload('annotate', input);
  if (errors.length > 0) throw new Error(renderValidationErrors('annotate', errors));
  const entityIds = readStringArray(input.entityIds) ?? readStringArray(input.entity_ids);
  return {
    entityIds: entityIds ?? [],
    summary: requireString(input.summary, 'summary'),
    effectiveAt: readString(input.effectiveAt) ?? readString(input.effective_at),
    sourceIds: readStringArray(input.sourceIds) ?? readStringArray(input.source_ids),
    provenance: readString(input.provenance)
  };
}

function coerceDraftInput(input: JsonObject): Parameters<KnowledgeBaseService['updateEntityDraft']>[0] {
  return {
    entityId: requireString(input.entityId ?? input.entity_id, 'entityId'),
    title: readString(input.title),
    kind: readString(input.kind) as KnowledgeEntityKind | undefined,
    summary: readString(input.summary),
    openQuestions: readStringArray(input.openQuestions) ?? readStringArray(input.open_questions),
    sourceIds: readStringArray(input.sourceIds) ?? readStringArray(input.source_ids),
    timelineNotes: readStringArray(input.timelineNotes) ?? readStringArray(input.timeline_notes)
  };
}

function coerceRelationsFilterInput(input: JsonObject): KnowledgeRelationsFilter {
  return {
    entityId: readString(input.entityId) ?? readString(input.entity_id),
    originKind: (readString(input.originKind) ?? readString(input.origin_kind)) as KnowledgeRelationsFilter['originKind'],
    originId: readString(input.originId) ?? readString(input.origin_id),
    type: readString(input.type)
  };
}

function coerceReplaceRelationsInput(input: JsonObject): Parameters<KnowledgeBaseService['replaceRelations']>[0] {
  const origin = input.origin;
  if (!origin || typeof origin !== 'object' || Array.isArray(origin)) {
    throw new Error('Missing required field: origin');
  }
  if (!Array.isArray(input.links)) {
    throw new Error('Missing required field: links');
  }
  return {
    origin: coerceOriginInput(origin as JsonObject),
    links: input.links.map((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`Invalid relation link at index ${index}`);
      }
      const link = entry as JsonObject;
      return {
        type: requireString(link.type, `links[${index}].type`),
        fromId: requireString(link.fromId ?? link.from_id, `links[${index}].fromId`),
        toId: requireString(link.toId ?? link.to_id, `links[${index}].toId`),
        sourceIds: readStringArray(link.sourceIds) ?? readStringArray(link.source_ids),
        confidence: readNumber(link.confidence),
        evidenceKind: (readString(link.evidenceKind) ?? readString(link.evidence_kind)) as Parameters<KnowledgeBaseService['replaceRelations']>[0]['links'][number]['evidenceKind'],
        createdAt: readString(link.createdAt) ?? readString(link.created_at)
      };
    })
  };
}

function coerceOriginInput(input: JsonObject): Parameters<KnowledgeBaseService['clearRelations']>[0] {
  return {
    kind: requireEnum(input.kind ?? input.originKind ?? input.origin_kind, 'origin.kind', ['entity', 'source', 'event', 'seed']),
    id: requireString(input.id ?? input.originId ?? input.origin_id, 'origin.id')
  };
}

function coerceRememberInput(input: JsonObject): Parameters<KnowledgeBaseService['remember']>[0] {
  const errors = validatePayload('remember', input);
  if (errors.length > 0) throw new Error(renderValidationErrors('remember', errors));
  return {
    ...(input as Parameters<KnowledgeBaseService['remember']>[0]),
    intent: requireEnum(
      input.intent,
      'intent',
      ['source_capture', 'fact_update', 'correction', 'company_profile', 'person_profile']
    ) as Parameters<KnowledgeBaseService['remember']>[0]['intent'],
    summary: requireString(input.summary, 'summary')
  };
}

function buildTraversePayload(parsed: ParsedArgs): JsonObject {
  return {
    id: readId(parsed),
    type: readString(parsed.flags.type),
    direction: readString(parsed.flags.direction),
    depth: typeof parsed.flags.depth === 'string' ? Number.parseInt(parsed.flags.depth, 10) : undefined,
    explicitOnly: readBoolean(parsed.flags['explicit-only']),
    originKind: readString(parsed.flags['origin-kind'])
  };
}

function buildRelationsFilterPayload(parsed: ParsedArgs): JsonObject {
  return {
    entityId: readString(parsed.flags['entity-id']) ?? readString(parsed.flags.entityId),
    originKind: readString(parsed.flags['origin-kind']) ?? readString(parsed.flags.originKind),
    originId: readString(parsed.flags['origin-id']) ?? readString(parsed.flags.originId),
    type: readString(parsed.flags.type)
  };
}

function buildOriginPayload(parsed: ParsedArgs): JsonObject {
  return {
    originKind: readString(parsed.flags['origin-kind']) ?? readString(parsed.flags.originKind),
    originId: readString(parsed.flags['origin-id']) ?? readString(parsed.flags.originId)
  };
}

function buildServePayload(parsed: ParsedArgs): JsonObject {
  return {
    host: readString(parsed.flags.host),
    port: typeof parsed.flags.port === 'string' ? Number.parseInt(parsed.flags.port, 10) : undefined
  };
}

function readId(parsed: ParsedArgs): string {
  if (typeof parsed.flags.id === 'string' && parsed.flags.id) return parsed.flags.id;
  const positional = parsed.positionals[1];
  if (positional) return positional;
  throw new Error('Missing required id');
}

function renderOutput(data: unknown, format: string): string {
  if (format === 'json') return JSON.stringify(data, null, 2);
  if (typeof data === 'string') return data;
  return JSON.stringify(data, null, 2);
}

type SchemaCommand = 'remember' | 'record' | 'relate' | 'annotate' | 'search' | 'query-relations' | 'record-batch' | 'annotate-batch';

function renderHelp(topic?: string): string {
  if (topic && isSchemaCommand(topic)) {
    const schema = renderSchema(topic);
    return [
      `kb ${topic}`,
      '',
      schema.note,
      '',
      `Required: ${schema.required.join(', ') || '(none)'}`,
      `Optional: ${schema.optional.join(', ') || '(none)'}`,
      ...Object.entries(schema.enums).map(([key, values]) => `${key}: ${values.join(', ')}`)
    ].join('\n');
  }
  if (topic === 'operator') {
    return [
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
    ].join('\n');
  }
  return [
    'kb <command> [flags]',
    '',
    'Default agent surface:',
    '  kb inspect',
    '  kb list',
    '  kb get <id>',
    '  kb delete --id ENTITY_ID',
    '  kb search --json \'{"query":"...","mode":"search-only|graph-only|graph-first-hybrid"}\'',
    '  kb query-relations --json \'{"query":"founder of acme","mode":"graph-only|graph-first-hybrid"}\'',
    '  kb remember --json @payload.json',
    '  kb record --json @payload.json',
    '  kb relate --json @payload.json',
    '  kb annotate --json @payload.json',
    '  kb record-batch --json @records.json',
    '  kb annotate-batch --json @annotations.json',
    '  kb schema <remember|record|relate|annotate|search|query-relations|record-batch|annotate-batch>',
    '  kb validate <remember|record|relate|annotate|search|query-relations|record-batch|annotate-batch> --json @payload.json',
    '  kb related --id ENTITY_ID',
    '  kb links --id ENTITY_ID',
    '  kb traverse --id ENTITY_ID [--type RELATION] [--direction in|out|both] [--depth 1] [--explicit-only] [--origin-kind entity|source|event|seed]',
    '  kb rebuild',
    '  kb doctor',
    '  kb export',
    '  kb serve [--host 127.0.0.1] [--port 3001]',
    '  kb sync <pull|status|push>',
    '  kb daemon <start|stop|restart|status|logs|once>',
    '  kb cloudflare deploy --tenant-id TENANT_ID [--workspace PATH] [--worker-name NAME] [--bucket NAME] [--host-url URL] [--secret VALUE]',
    '  kb cloudflare verify [--host-url URL] [--token VALUE] [--tenant-id ID]',
    '  kb help operator',
    '',
    'Notes:',
    '  - Use `kb record` for structured entities.',
    '  - Use `kb relate` for explicit relation edges between existing entities.',
    '  - Only use `record.relations[]` when you are already creating or rewriting the entity in the same payload.',
    '  - Do not use `kb annotate` for relation edges; it is only for timeline/provenance updates.',
    '  - Use `kb remember` for facts, sources, corrections, and narrative evidence capture.',
    '  - Use `kb query-relations` for relation-shaped questions; `kb search` is lexical/hybrid retrieval.',
    '  - `kb inspect` must tell you tenant, backend, canonicality, and whether you are on a production or support surface before writes.',
    '  - Use `KB_BASE_URL` to target a deployed KB and `KB_API_TOKEN` for protected remote hosts. `KB_BEARER_TOKEN` is accepted as a compatibility alias.',
    '  - Use `kb cloudflare deploy` to scaffold a protected Cloudflare KB host and verify both `/v1` and `/mcp`.',
    '  - Use `kb cloudflare verify` to recheck an existing protected Cloudflare KB host without redeploying it.',
    '  - Operator-only repair surfaces are intentionally hidden from the default help. Run `kb help operator` only when you need direct state repair or inspection.',
    '  - Prefer `kb validate ... --json @file.json` before large write batches.',
    '  - `kb sync` and `kb daemon` are local-only mirror operations for `KB_BACKEND=r2-mirror`.',
    '',
    'Local Mirror Help:',
    `  ${renderKnowledgeBaseSyncHelp()}`,
    `  ${renderKnowledgeBaseSyncDaemonHelp()}`
  ].join('\n');
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) {
      positionals.push(value);
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

export function buildSubcommandArgv(parsed: ParsedArgs, commandIndex: number): string[] {
  const argv = parsed.positionals.slice(commandIndex);
  for (const [key, value] of Object.entries(parsed.flags)) {
    if (key === 'help' || key === 'format') continue;
    argv.push(`--${key}`);
    if (value !== true) argv.push(String(value));
  }
  return argv;
}

function buildLocalCapabilities(
  transport: Extract<KnowledgeBaseCliTransport, { mode: 'local' }>,
  mode: KnowledgeBaseConfig['mode'],
  rootDir: string
): KnowledgeWorkspaceCapabilities {
  const backend = transport.backend ?? 'file';
  return {
    tenantId: transport.tenantId,
    backend,
    transport: 'local',
    mode,
    canonical: false,
    workspaceRole: backend === 'r2-mirror' ? 'mirror-support' : 'local-development',
    rootDir
  };
}

function buildRelationsPath(input: KnowledgeRelationsFilter): string {
  const params = new URLSearchParams();
  if (input.entityId) params.set('entityId', input.entityId);
  if (input.originKind) params.set('originKind', input.originKind);
  if (input.originId) params.set('originId', input.originId);
  if (input.type) params.set('type', input.type);
  const query = params.toString();
  return query ? `/v1/relations?${query}` : '/v1/relations';
}

function buildClearRelationsPath(origin: Parameters<KnowledgeBaseService['clearRelations']>[0]): string {
  const params = new URLSearchParams({
    originKind: origin.kind,
    originId: origin.id
  });
  return `/v1/relations?${params.toString()}`;
}

function requireString(value: unknown, field: string): string {
  const parsed = readString(value);
  if (!parsed) throw new Error(`Missing required field: ${field}`);
  return parsed;
}

function requireEnum<T extends string>(value: unknown, field: string, options: readonly T[]): T {
  const parsed = requireString(value, field);
  if ((options as readonly string[]).includes(parsed)) return parsed as T;
  throw new Error(`Invalid value for ${field}: ${parsed}. Expected one of: ${options.join(', ')}`);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function looksLikeJsonFilePath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed === '-') return false;
  return /^([/.]|[A-Za-z]:[\\/])/.test(trimmed) && /\.json$/i.test(trimmed);
}

function assertRememberUsesJsonPayload(parsed: ParsedArgs): void {
  if (typeof parsed.flags.json === 'string') return;
  const rememberFieldFlags = ['intent', 'summary', 'content', 'entities', 'relations', 'source', 'effectiveAt', 'effective_at', 'confidence'];
  if (rememberFieldFlags.some((flag) => flag in parsed.flags)) {
    throw new Error(
      'kb remember accepts payloads only through --json. Use `kb remember --json @payload.json`, `kb remember --json \'{"intent":"source_capture","summary":"..."}\'`, or `kb remember --json -`.'
    );
  }
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  return strings.length > 0 ? strings : undefined;
}

async function executeBatch(
  entries: JsonObject[],
  execute: (entry: JsonObject) => Promise<unknown>
): Promise<{ ok: true; count: number; results: unknown[] }> {
  const results: unknown[] = [];
  for (const entry of entries) {
    results.push(await execute(entry));
  }
  return { ok: true, count: results.length, results };
}

function requireSchemaCommand(value: string | undefined): SchemaCommand {
  if (value && isSchemaCommand(value)) return value;
  throw new Error('Usage: kb schema <remember|record|relate|annotate|search|query-relations|record-batch|annotate-batch>');
}

function isSchemaCommand(value: string): value is SchemaCommand {
  return ['remember', 'record', 'relate', 'annotate', 'search', 'query-relations', 'record-batch', 'annotate-batch'].includes(value);
}

function renderSchema(command: SchemaCommand): {
  command: SchemaCommand;
  required: string[];
  optional: string[];
  enums: Record<string, string[]>;
  note: string;
} {
  switch (command) {
    case 'remember':
      return {
        command,
        required: ['intent', 'summary'],
        optional: ['content', 'entities', 'relations', 'source', 'effective_at', 'confidence'],
        enums: { intent: ['source_capture', 'fact_update', 'correction', 'company_profile', 'person_profile'] },
        note: 'Use `remember` for facts, sources, corrections, and narrative evidence. Use `record` for structured entities and `relate` for explicit edges.'
      };
    case 'record':
      return {
        command,
        required: ['entity', 'entity.id', 'entity.kind', 'entity.title'],
        optional: ['entity.currentTruth', 'entity.aliases', 'entity.handles', 'entity.tags', 'relatedEntities', 'relations', 'sources', 'events'],
        enums: { 'entity.kind': ['company', 'person', 'process', 'project', 'policy', 'vendor', 'decision', 'system', 'team', 'meeting'] },
        note: 'Use `record` for canonical structured entities. `relations[]` is only for edges included while creating or rewriting that record; for standalone explicit edges between existing entities, use `relate`.'
      };
    case 'relate':
      return {
        command,
        required: ['type', 'fromId', 'toId'],
        optional: ['sourceIds', 'confidence'],
        enums: {},
        note: 'Use `relate` to add an explicit relation edge between existing entities without rewriting the full record payload.'
      };
    case 'annotate':
      return {
        command,
        required: ['entity_ids|entityIds', 'summary'],
        optional: ['effective_at|effectiveAt', 'source_ids|sourceIds', 'provenance'],
        enums: {},
        note: 'Use `annotate` for timeline or provenance updates on existing entities. It does not create relation edges; use `relate` for that.'
      };
    case 'search':
      return {
        command,
        required: ['query'],
        optional: ['kind', 'limit', 'assistQuery', 'mode', 'lexicalBackend'],
        enums: {
          mode: ['search-only', 'graph-only', 'graph-first-hybrid'],
          lexicalBackend: ['legacy-lexical', 'bm25-lexical']
        },
        note: 'Use `search` for lexical or hybrid retrieval. For relation-shaped questions, prefer `query-relations`.'
      };
    case 'query-relations':
      return {
        command,
        required: ['query'],
        optional: ['limit', 'mode', 'lexicalBackend', 'currentOnly', 'asOf'],
        enums: {
          mode: ['graph-only', 'graph-first-hybrid'],
          lexicalBackend: ['legacy-lexical', 'bm25-lexical']
        },
        note: 'Use `query-relations` for explicit relation questions like founder, owner, advisor, or works-for.'
      };
    case 'record-batch':
      return {
        command,
        required: ['JSON array of record payloads'],
        optional: [],
        enums: {},
        note: 'Batch form of `record`. Each array entry must satisfy the `record` schema.'
      };
    case 'annotate-batch':
      return {
        command,
        required: ['JSON array of annotate payloads'],
        optional: [],
        enums: {},
        note: 'Batch form of `annotate`. Each array entry must satisfy the `annotate` schema.'
      };
  }
}

function validatePayload(command: SchemaCommand, value: unknown): string[] {
  const errors: string[] = [];
  if (command === 'record-batch' || command === 'annotate-batch') {
    if (!Array.isArray(value)) return ['Expected a JSON array payload.'];
    value.forEach((entry, index) => {
      for (const error of validatePayload(command === 'record-batch' ? 'record' : 'annotate', entry)) {
        errors.push(`[${index}] ${error}`);
      }
    });
    return errors;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return ['Expected a JSON object payload.'];
  }
  const input = value as JsonObject;
  switch (command) {
    case 'remember': {
      if (!readString(input.intent)) {
        errors.push('Missing required field: intent');
      } else if (!['source_capture', 'fact_update', 'correction', 'company_profile', 'person_profile'].includes(String(input.intent))) {
        errors.push('Invalid value for intent. Expected one of: source_capture, fact_update, correction, company_profile, person_profile');
      }
      if (!readString(input.summary)) errors.push('Missing required field: summary');
      if (input.content !== undefined && typeof input.content !== 'string') {
        errors.push('Invalid field: content. Expected a string.');
      }
      return errors;
    }
    case 'record': {
      const entity = input.entity;
      if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
        errors.push('Missing required field: entity');
        return errors;
      }
      const record = entity as JsonObject;
      if (!readString(record.id)) errors.push('Missing required field: entity.id');
      if (!readString(record.kind)) {
        errors.push('Missing required field: entity.kind');
      } else if (!['company', 'person', 'process', 'project', 'policy', 'vendor', 'decision', 'system', 'team', 'meeting'].includes(String(record.kind))) {
        errors.push('Invalid value for entity.kind. Expected one of: company, person, process, project, policy, vendor, decision, system, team, meeting');
      }
      if (!readString(record.title)) errors.push('Missing required field: entity.title');
      validateOptionalStringArrayField(record.aliases, 'entity.aliases', errors);
      validateOptionalStringArrayField(record.handles, 'entity.handles', errors);
      validateOptionalStringArrayField(record.tags, 'entity.tags', errors);
      validateOptionalStringArrayField(record.owners, 'entity.owners', errors);
      validateOptionalStringArrayField(record.sources, 'entity.sources', errors);
      validateOptionalStringArrayField(record.openQuestions, 'entity.openQuestions', errors);
      validateOptionalStringArrayField(record.timeline, 'entity.timeline', errors);
      validateOptionalRecordArrayField(input.relatedEntities, 'relatedEntities', errors, (entry, prefix) => {
        validateOptionalStringArrayField(entry.aliases, `${prefix}.aliases`, errors);
      });
      validateOptionalRecordArrayField(input.relations, 'relations', errors, (entry, prefix) => {
        validateOptionalStringArrayField(entry.sourceIds, `${prefix}.sourceIds`, errors);
      });
      validateOptionalRecordArrayField(input.sources, 'sources', errors, (entry, prefix) => {
        validateOptionalStringArrayField(entry.authors, `${prefix}.authors`, errors);
        validateOptionalStringArrayField(entry.citations, `${prefix}.citations`, errors);
      });
      validateOptionalRecordArrayField(input.events, 'events', errors, (entry, prefix) => {
        validateOptionalStringArrayField(entry.entityIds, `${prefix}.entityIds`, errors);
        validateOptionalStringArrayField(entry.sourceIds, `${prefix}.sourceIds`, errors);
      });
      return errors;
    }
    case 'relate': {
      if (!readString(input.type)) errors.push('Missing required field: type');
      if (!readString(input.fromId)) errors.push('Missing required field: fromId');
      if (!readString(input.toId)) errors.push('Missing required field: toId');
      validateOptionalStringArrayField(input.sourceIds, 'sourceIds', errors);
      return errors;
    }
    case 'annotate': {
      const entityIds = readStringArray(input.entityIds) ?? readStringArray(input.entity_ids);
      if (!entityIds?.length) errors.push('Missing required field: entityIds or entity_ids');
      if (!readString(input.summary)) errors.push('Missing required field: summary');
      return errors;
    }
    case 'search': {
      if (!readString(input.query)) errors.push('Missing required field: query');
      return errors;
    }
    case 'query-relations': {
      if (!readString(input.query)) errors.push('Missing required field: query');
      return errors;
    }
  }
}

function renderValidationErrors(command: SchemaCommand, errors: string[]): string {
  return [`Invalid ${command} payload:`, ...errors.map((error) => `- ${error}`), `Run \`kb schema ${command}\` for the supported shape.`].join('\n');
}

function validateOptionalStringArrayField(value: unknown, field: string, errors: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push(`Invalid field: ${field}. Expected an array of strings.`);
    return;
  }
  if (value.some((entry) => typeof entry !== 'string' || entry.trim().length === 0)) {
    errors.push(`Invalid field: ${field}. Expected non-empty string entries.`);
  }
}

function validateOptionalRecordArrayField(
  value: unknown,
  field: string,
  errors: string[],
  validateEntry: (entry: JsonObject, prefix: string) => void
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push(`Invalid field: ${field}. Expected an array of objects.`);
    return;
  }
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`Invalid field: ${field}[${index}]. Expected an object.`);
      return;
    }
    validateEntry(entry as JsonObject, `${field}[${index}]`);
  });
}

function readCliBackend(value: string | undefined): 'file' | 'r2-mirror' | 'cloudflare' | 'r2' | 'http' {
  const normalized = value?.trim().toLowerCase();
  switch (normalized) {
    case 'r2-mirror':
      return 'r2-mirror';
    case 'cloudflare':
      return 'cloudflare';
    case 'r2':
      return 'r2';
    case 'http':
      return 'http';
    default:
      return 'file';
  }
}

async function startServe(
  input: JsonObject,
  tenantId: string,
  options: KnowledgeBaseCliOptions,
  config: KnowledgeBaseConfig
): Promise<unknown> {
  const server = await startKnowledgeBaseCliDaemon({
    tenantId,
    cwd: options.cwd,
    rootDir: options.env?.KB_ROOT_DIR,
    config,
    host: readString(input.host),
    port: readNumber(input.port)
  });
  const close = async () => {
    await server.close();
    process.exitCode = 0;
  };
  process.once('SIGINT', () => void close());
  process.once('SIGTERM', () => void close());
  return {
    ok: true,
    host: server.host,
    port: server.port,
    url: server.url
  };
}
