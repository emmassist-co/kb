import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createKbCommand } from '../packages/kb-flue-adapter/src/command.js';
import type { FlueKbHostAdapter, FlueKbRuntime, FlueKbService } from '../packages/kb-flue-adapter/src/config.js';

const fs = {} as never;

function createHost(service: Partial<FlueKbService> = {}, runtimeOverrides: Partial<FlueKbRuntime> = {} as Partial<FlueKbRuntime>) {
  const fullService = {
    async list() {
      return { mode: 'basic', entities: [], sources: [], links: [] };
    },
    async get() {
      return null;
    },
    async captureSource(payload: unknown) {
      return payload;
    },
    async listEvents() {
      return [];
    },
    async getEvent() {
      return null;
    },
    async deleteEvent() {
      return { deleted: true };
    },
    async listDrafts() {
      return [];
    },
    async getDraft() {
      return null;
    },
    async updateEntityDraft(payload: unknown) {
      return payload;
    },
    async deleteDraft() {
      return { deleted: true };
    },
    async listRelations() {
      return { links: [] };
    },
    async replaceRelations(payload: unknown) {
      return payload;
    },
    async clearRelations(payload: unknown) {
      return payload;
    },
    async search(payload: unknown) {
      return { ...(payload as Record<string, unknown>), results: [] };
    },
    async queryRelations(payload: unknown) {
      return { ...(payload as Record<string, unknown>), results: [] };
    },
    async remember(payload: unknown) {
      return payload;
    },
    async record(payload: unknown) {
      return payload;
    },
    async relate(payload: unknown) {
      return payload;
    },
    async annotate(payload: unknown) {
      return payload;
    },
    async related() {
      return { links: [] };
    },
    async links() {
      return { links: [] };
    },
    async traverse() {
      return { links: [] };
    },
    async doctor() {
      return { ok: true };
    },
    async export() {
      return { ok: true };
    },
    async deleteRecord(id: string) {
      return { deleted: true, id };
    },
    async readMemory(payload: unknown) {
      return { query: payload, shared: [], user: [], conflicts: [] };
    },
    async writeMemory(payload: unknown) {
      return { memory: payload, verification: [{ id: 'memory_1' }] };
    },
    ...service
  } satisfies FlueKbService;

  const runtime: FlueKbRuntime = {
    async getService() {
      return fullService;
    },
    async rebuild() {
      return { rebuilt: true };
    },
    async restoreCanonical() {
      return { restored: true };
    },
    ...runtimeOverrides
  };

  const host: FlueKbHostAdapter = {
    async resolveProductConfig() {
      return {
        tenant: { id: 'acme' },
        knowledgeBase: {
          enabled: true,
          mode: 'runtime',
          writePolicy: 'evidence-first',
          persistence: { backend: 'cloudflare' }
        }
      };
    },
    createRuntime() {
      return runtime;
    },
    createService() {
      return fullService;
    }
  };

  return { host, runtime, service: fullService };
}

test('kb flue adapter help exposes memory-first public commands', async () => {
  const { host } = createHost();
  const command = createKbCommand(fs, {}, { host });

  const help = await command.execute(['help']);
  assert.equal(help.exitCode, 0);
  assert.match(help.stdout, /kb memory-read --json/);
  assert.match(help.stdout, /kb memory-write --json/);
  assert.match(help.stdout, /kb schema memory-read/);
  assert.match(help.stdout, /kb help memory-write/);
  assert.doesNotMatch(help.stdout, /kb recall --json/);
  assert.doesNotMatch(help.stdout, /kb evidence --id/);
  assert.doesNotMatch(help.stdout, /kb submit-proposal --json/);

  const memoryHelp = await command.execute(['help', 'memory-write']);
  assert.equal(memoryHelp.exitCode, 0);
  assert.match(memoryHelp.stdout, /kb memory-write --json/);
  assert.match(memoryHelp.stdout, /explicit_correction|explicit_confirmation/);
});

test('kb flue adapter supports scoped memory reads and writes through the host service', async () => {
  const reads: unknown[] = [];
  const writes: unknown[] = [];
  const { host } = createHost({
    async readMemory(payload: unknown) {
      reads.push(payload);
      return {
        shared: [{ summary: 'Kinto should use transport.' }],
        user: [],
        conflicts: []
      };
    },
    async writeMemory(payload: unknown) {
      writes.push(payload);
      return {
        scope: 'user',
        memoryKind: 'user_preference',
        verification: [{ id: 'memory_user_1' }]
      };
    }
  });
  const command = createKbCommand(fs, {}, { host });

  const read = await command.execute(['memory-read', '--json', '{"subjectEntityId":"vendor-kinto","memoryKind":"vendor"}']);
  assert.equal(read.exitCode, 0);
  assert.equal(reads.length, 1);
  assert.match(read.stdout, /transport/);

  const write = await command.execute([
    'memory-write',
    '--json',
    '{"scope":"user","memoryKind":"user_preference","summary":"Keep replies short.","userId":"alex","policy":"explicit_confirmation"}'
  ]);
  assert.equal(write.exitCode, 0);
  assert.equal(writes.length, 1);
  assert.match(write.stdout, /memory_user_1/);
});

test('kb flue adapter inspect and runtime help expose the mounted runtime contract', async () => {
  const { host } = createHost();
  const command = createKbCommand(fs, {}, { host });

  const inspect = await command.execute(['inspect']);
  assert.equal(inspect.exitCode, 0);
  const payload = JSON.parse(inspect.stdout) as { data?: { workspaceRole?: string; launchTrust?: { promise?: string } } };
  assert.equal(payload.data?.workspaceRole, 'runtime-support');
  assert.equal(payload.data?.launchTrust?.promise, 'Important company facts do not get lost.');

  const runtime = await command.execute(['help', 'runtime']);
  assert.equal(runtime.exitCode, 0);
  assert.match(runtime.stdout, /tenant: acme/);
  assert.match(runtime.stdout, /backend: cloudflare/);
  assert.match(runtime.stdout, /kb memory-read/);
  assert.match(runtime.stdout, /kb search/);
});

test('published kb flue adapter stays direct and host-agnostic', async () => {
  const packageJson = JSON.parse(
    readFileSync(path.resolve(process.cwd(), 'packages/kb-flue-adapter/package.json'), 'utf8')
  ) as { version?: string; dependencies?: Record<string, string>; peerDependencies?: Record<string, string> };
  const source = readFileSync(path.resolve(process.cwd(), 'packages/kb-flue-adapter/src/command.ts'), 'utf8');

  assert.equal(packageJson.version, '0.9.1');
  assert.equal(packageJson.dependencies?.['just-bash'], '^2.14.4');
  assert.equal(packageJson.dependencies?.['@emmassist-co/kb-cli'], undefined);
  assert.equal(packageJson.peerDependencies?.['@flue/sdk'], undefined);
  assert.doesNotMatch(source, /runKnowledgeBaseCli/);
  assert.doesNotMatch(source, /KnowledgeBaseCliExecutor/);
  assert.doesNotMatch(source, /@flue\/sdk\/client/);
  assert.doesNotMatch(source, /\.\.\/\.\.\/src\//);
});
