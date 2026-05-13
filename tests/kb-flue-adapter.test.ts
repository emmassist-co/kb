import test from 'node:test';
import assert from 'node:assert/strict';
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
