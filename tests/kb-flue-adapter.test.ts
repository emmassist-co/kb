import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { KnowledgeBaseService } from '../packages/kb-core/src/service.js';
import { createKbCommand } from '../packages/kb-flue-adapter/src/command.js';

test('kb flue adapter logs runtime telemetry for search requests', async () => {
  const events: unknown[] = [];
  const command = createKbCommand(
    {
      async readFileBuffer() {
        throw new Error('readFileBuffer should not be used in this test');
      }
    },
    {},
    {
      runtime: {
        async getService() {
          return {
            async search() {
              return {
                query: 'billing stripe',
                mode: 'graph-first-hybrid',
                results: [
                  {
                    id: 'vendor-stripe',
                    title: 'Stripe',
                    kind: 'vendor',
                    score: 0.99,
                    reason: ['contains:billing'],
                    matchedFields: ['currentTruth'],
                    sourceIds: ['src_1'],
                    confidence: 'high',
                    ambiguous: false
                  }
                ]
              };
            }
          } as Pick<KnowledgeBaseService, 'search'> as KnowledgeBaseService;
        },
        async flush() {
          return null;
        },
        async rebuild() {
          return null;
        }
      },
      telemetry: {
        log(event) {
          events.push(event);
        }
      }
    }
  );

  const result = await command.execute(['search', '--json', '{"query":"billing stripe","mode":"graph-first-hybrid"}']);

  assert.equal(result.exitCode, 0);
  assert.equal(events.length, 1);
  const event = events[0] as Record<string, unknown>;
  assert.equal(event.type, 'kb_runtime_query');
  assert.equal(event.operation, 'search');
  assert.equal(event.query, 'billing stripe');
  assert.equal(event.mode, 'graph-first-hybrid');
  assert.equal(event.resultCount, 1);
  assert.deepEqual(event.resultIds, ['vendor-stripe']);
  assert.equal(typeof event.payloadBytes, 'number');
  assert.equal(event.estimatedTokens, Math.ceil((event.payloadBytes as number) / 4));
  assert.equal(typeof event.durationMs, 'number');
  assert.ok((event.durationMs as number) >= 0);
});

test('kb flue adapter logs runtime telemetry for relation queries', async () => {
  const events: unknown[] = [];
  const command = createKbCommand(
    {
      async readFileBuffer() {
        throw new Error('readFileBuffer should not be used in this test');
      }
    },
    {},
    {
      runtime: {
        async getService() {
          return {
            async queryRelations() {
              return {
                query: 'Who works at Stripe?',
                mode: 'graph-only',
                classification: {
                  relationType: 'works_at',
                  anchorId: 'vendor-stripe'
                },
                results: [
                  {
                    id: 'person-jane',
                    title: 'Jane Smith',
                    kind: 'person',
                    score: 12,
                    reason: ['relation:works_at'],
                    matchedFields: ['graph'],
                    sourceIds: [],
                    confidence: 'high',
                    ambiguous: false
                  }
                ]
              };
            }
          } as Pick<KnowledgeBaseService, 'queryRelations'> as KnowledgeBaseService;
        },
        async flush() {
          return null;
        },
        async rebuild() {
          return null;
        }
      },
      telemetry: {
        log(event) {
          events.push(event);
        }
      }
    }
  );

  const result = await command.execute(['query-relations', '--json', '{"query":"Who works at Stripe?","mode":"graph-only"}']);

  assert.equal(result.exitCode, 0);
  assert.equal(events.length, 1);
  const event = events[0] as Record<string, unknown>;
  assert.equal(event.type, 'kb_runtime_query');
  assert.equal(event.operation, 'query-relations');
  assert.equal(event.query, 'Who works at Stripe?');
  assert.equal(event.mode, 'graph-only');
  assert.equal(event.resultCount, 1);
  assert.deepEqual(event.resultIds, ['person-jane']);
  assert.equal(event.relationType, 'works_at');
  assert.equal(event.anchorId, 'vendor-stripe');
  assert.equal(typeof event.payloadBytes, 'number');
  assert.equal(event.estimatedTokens, Math.ceil((event.payloadBytes as number) / 4));
  assert.equal(typeof event.durationMs, 'number');
  assert.ok((event.durationMs as number) >= 0);
});

test('kb flue adapter help exposes runtime context and operator-only repair topics', async () => {
  const command = createKbCommand(
    {
      async readFileBuffer() {
        throw new Error('readFileBuffer should not be used in this test');
      }
    },
    {
      WORKSPACE_TENANT_ID: 'acme',
      KB_BACKEND: 'cloudflare'
    }
  );

  const help = await command.execute(['help']);
  assert.equal(help.exitCode, 0);
  assert.match(help.stdout, /Default runtime surface:/);
  assert.match(help.stdout, /kb help runtime/);
  assert.match(help.stdout, /kb help operator/);
  assert.doesNotMatch(help.stdout, /kb capture-source --json/);

  const runtime = await command.execute(['help', 'runtime']);
  assert.equal(runtime.exitCode, 0);
  assert.match(runtime.stdout, /KB runtime contract/);
  assert.match(runtime.stdout, /tenant: acme/);
  assert.match(runtime.stdout, /backend: cloudflare/);
  assert.match(runtime.stdout, /canonical: yes/);
  assert.match(runtime.stdout, /workspace role: canonical-production/);
  assert.match(runtime.stdout, /Use `kb search` before answering tenant-specific factual questions/);

  const operator = await command.execute(['help', 'operator']);
  assert.equal(operator.exitCode, 0);
  assert.match(operator.stdout, /kb operator surface/);
  assert.match(operator.stdout, /kb capture-source --json @payload\.json/);
  assert.match(operator.stdout, /Use these only for direct KB repair, cleanup, or inspection\./);
});


test('kb flue adapter avoids legacy Flue SDK subpath imports and advertises the widened peer range', async () => {
  const commandSourcePath = path.resolve(process.cwd(), 'packages/kb-flue-adapter/src/command.ts');
  const packageJsonPath = path.resolve(process.cwd(), 'packages/kb-flue-adapter/package.json');
  const [commandSource, packageJsonText] = await Promise.all([
    readFile(commandSourcePath, 'utf8'),
    readFile(packageJsonPath, 'utf8')
  ]);
  const packageJson = JSON.parse(packageJsonText) as { peerDependencies?: Record<string, string> };

  assert.doesNotMatch(commandSource, /@flue\/sdk\/client/);
  assert.match(packageJson.peerDependencies?.['@flue/sdk'] ?? '', /1\.0\.0-beta\.1/);
});
