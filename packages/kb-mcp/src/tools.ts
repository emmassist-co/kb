import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  hydrateTrustSubstrateCapabilities,
  type KnowledgeBaseService,
  type KnowledgeWorkspaceCapabilities,
  type KnowledgeMutationResult,
  type KnowledgeRecallInput,
  type KnowledgeRelationQueryInput,
  type KnowledgeSearchInput
} from '@emmassist-co/kb-core';
import type { KnowledgeBaseAccessScope } from '@emmassist-co/kb-http/types';

export interface KnowledgeBaseMcpToolRegistrationOptions {
  service: KnowledgeBaseService;
  capabilities?: KnowledgeWorkspaceCapabilities;
  scopes: KnowledgeBaseAccessScope[];
  rebuild?: () => Promise<unknown>;
}

interface KnowledgeBaseMcpToolDescriptor {
  name: string;
  scope: KnowledgeBaseAccessScope;
  register(server: McpServer, options: KnowledgeBaseMcpToolRegistrationOptions): void;
}

export function registerKnowledgeBaseMcpTools(
  server: McpServer,
  options: KnowledgeBaseMcpToolRegistrationOptions
): void {
  for (const descriptor of getKnowledgeBaseMcpToolDescriptors()) {
    if (!options.scopes.includes(descriptor.scope)) continue;
    descriptor.register(server, options);
  }
}

export function listKnowledgeBaseMcpToolNames(
  scopes: KnowledgeBaseAccessScope[]
): string[] {
  return getKnowledgeBaseMcpToolDescriptors()
    .filter((descriptor) => scopes.includes(descriptor.scope))
    .map((descriptor) => descriptor.name);
}

function getKnowledgeBaseMcpToolDescriptors(): KnowledgeBaseMcpToolDescriptor[] {
  return [
    {
      name: 'capabilities',
      scope: 'kb.read',
      register(server, options) {
        server.registerTool('capabilities', {
          description: 'Inspect the deployed KB capability envelope.'
        }, async () => jsonToolResult(hydrateTrustSubstrateCapabilities(options.capabilities ?? {})));
      }
    },
    {
      name: 'inspect',
      scope: 'kb.read',
      register(server, options) {
        server.registerTool('inspect', {
          description: 'Return KB capabilities plus a compact workspace summary.'
        }, async () => jsonToolResult({
          ...hydrateTrustSubstrateCapabilities(options.capabilities ?? {}),
          summary: await options.service.list()
        }));
      }
    },
    {
      name: 'doctor',
      scope: 'kb.read',
      register(server, options) {
        server.registerTool('doctor', {
          description: 'Return KB health and persistence diagnostics.'
        }, async () => jsonToolResult(await options.service.doctor()));
      }
    },
    {
      name: 'search',
      scope: 'kb.read',
      register(server, options) {
        server.registerTool('search', {
          description: 'Run lexical or hybrid KB search.',
          inputSchema: {
            query: z.string(),
            limit: z.number().optional(),
            kind: z.string().optional(),
            assistQuery: z.boolean().optional(),
            mode: z.string().optional(),
            lexicalBackend: z.string().optional(),
            temporalFocus: z.string().optional(),
            evidenceOnly: z.boolean().optional()
          }
        }, async (input) => jsonToolResult(await options.service.search(input as KnowledgeSearchInput)));
      }
    },
    {
      name: 'query_relations',
      scope: 'kb.read',
      register(server, options) {
        server.registerTool('query_relations', {
          description: 'Run a relation-shaped KB query.',
          inputSchema: {
            query: z.string(),
            limit: z.number().optional(),
            mode: z.string().optional(),
            lexicalBackend: z.string().optional(),
            currentOnly: z.boolean().optional(),
            asOf: z.string().optional()
          }
        }, async (input) => jsonToolResult(await options.service.queryRelations(input as KnowledgeRelationQueryInput)));
      }
    },
    {
      name: 'evidence',
      scope: 'kb.read',
      register(server, options) {
        server.registerTool('evidence', {
          description: 'Return the current-truth evidence view for a KB entity.',
          inputSchema: {
            entityId: z.string()
          }
        }, async ({ entityId }) => jsonToolResult(await options.service.evidence(entityId)));
      }
    },
    {
      name: 'recall',
      scope: 'kb.read',
      register(server, options) {
        server.registerTool('recall', {
          description: 'Build a read-only trust-aware recall bundle for a query or entity set.',
          inputSchema: {
            query: z.string().optional(),
            purpose: z.string().optional(),
            entityIds: z.array(z.string()).optional(),
            limit: z.number().optional(),
            maxTokens: z.number().optional(),
            temporalFocus: z.string().optional()
          }
        }, async (input) => jsonToolResult(await options.service.recall(input as KnowledgeRecallInput)));
      }
    },
    {
      name: 'remember',
      scope: 'kb.write',
      register(server, options) {
        server.registerTool('remember', {
          description: 'Capture narrative facts, corrections, or evidence into the KB.',
          inputSchema: {
            payload: z.record(z.string(), z.any())
          }
        }, async ({ payload }) => mutationToolResult(await options.service.remember(payload as Parameters<KnowledgeBaseService['remember']>[0])));
      }
    },
    {
      name: 'record',
      scope: 'kb.write',
      register(server, options) {
        server.registerTool('record', {
          description: 'Create or update a structured KB entity.',
          inputSchema: {
            payload: z.record(z.string(), z.any())
          }
        }, async ({ payload }) => mutationToolResult(await options.service.record(payload as Parameters<KnowledgeBaseService['record']>[0])));
      }
    },
    {
      name: 'relate',
      scope: 'kb.write',
      register(server, options) {
        server.registerTool('relate', {
          description: 'Create or update an explicit KB relation edge.',
          inputSchema: {
            payload: z.record(z.string(), z.any())
          }
        }, async ({ payload }) => mutationToolResult(await options.service.relate(payload as Parameters<KnowledgeBaseService['relate']>[0])));
      }
    },
    {
      name: 'annotate',
      scope: 'kb.write',
      register(server, options) {
        server.registerTool('annotate', {
          description: 'Append timeline or provenance annotations to KB entities.',
          inputSchema: {
            payload: z.record(z.string(), z.any())
          }
        }, async ({ payload }) => mutationToolResult(await options.service.annotate(payload as Parameters<KnowledgeBaseService['annotate']>[0])));
      }
    },
    {
      name: 'export',
      scope: 'kb.operator',
      register(server, options) {
        server.registerTool('export', {
          description: 'Export the full KB snapshot.'
        }, async () => jsonToolResult(await options.service.export()));
      }
    },
    {
      name: 'rebuild',
      scope: 'kb.operator',
      register(server, options) {
        server.registerTool('rebuild', {
          description: 'Rebuild the canonical KB snapshot.'
        }, async () => {
          if (!options.rebuild) {
            throw new Error('KB rebuild is not available on this MCP host.');
          }
          return jsonToolResult(await options.rebuild());
        });
      }
    }
  ];
}

function jsonToolResult(payload: unknown): { content: Array<{ type: 'text'; text: string }>; structuredContent: Record<string, unknown> } {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload, null, 2)
      }
    ],
    structuredContent: asStructuredContent(payload)
  };
}

function mutationToolResult(payload: KnowledgeMutationResult) {
  return jsonToolResult(payload);
}

function asStructuredContent(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  return { value: payload };
}
