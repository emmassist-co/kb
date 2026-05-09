import { KnowledgeBaseService, type KnowledgeBaseConfig } from '@emmassist/kb-core';
import { startKnowledgeBaseNodeServer, type KnowledgeBaseNodeServerHandle } from '@emmassist/kb-http/node-server';
import { FileKnowledgeStore } from '@emmassist/kb-storage-file';
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
        mode: 'local',
        tenantId: options.tenantId,
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
