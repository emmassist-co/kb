import { KnowledgeBaseService, type KnowledgeBaseConfig } from '@emmassist-co/kb-core';
import { startKnowledgeBaseNodeServer, type KnowledgeBaseNodeServerHandle } from '@emmassist-co/kb-http/node-server';
import { FileKnowledgeStore } from '@emmassist-co/kb-storage-file';
import path from 'node:path';

export interface KnowledgeBaseCliDaemonOptions {
  tenantId: string;
  cwd?: string;
  rootDir?: string;
  config?: KnowledgeBaseConfig;
  host?: string;
  port?: number;
}

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

export async function startKnowledgeBaseCliDaemon(
  options: KnowledgeBaseCliDaemonOptions
): Promise<KnowledgeBaseNodeServerHandle> {
  const config = options.config ?? DEFAULT_CONFIG;
  const rootDir = options.rootDir ?? path.resolve(options.cwd ?? process.cwd(), config.persistence.rootDir, options.tenantId);
  const service = new KnowledgeBaseService(
    options.tenantId,
    config,
    new FileKnowledgeStore(rootDir, config.mode)
  );
  return startKnowledgeBaseNodeServer(
    {
      service,
      capabilities: {
        backend: 'file',
        canonical: false,
        mode: 'local',
        workspaceRole: 'local-development',
        tenantId: options.tenantId,
        transport: 'http',
        rootDir
      },
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
      }
    },
    { host: options.host, port: options.port }
  );
}
