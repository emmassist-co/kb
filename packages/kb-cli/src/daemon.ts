import { KnowledgeBaseService, type KnowledgeBaseConfig } from '@emmassist-co/kb-core';
import { startKnowledgeBaseNodeServer, type KnowledgeBaseNodeServerHandle } from '@emmassist-co/kb-http';
import { FileKnowledgeStore } from '@emmassist-co/kb-storage-file';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

export interface KnowledgeBaseCliDashboardOptions {
  enabled?: boolean;
  assetsDir?: string;
  basePath?: string;
  readOnly?: boolean;
  token?: string;
}

export interface KnowledgeBaseCliDaemonOptions {
  tenantId: string;
  cwd?: string;
  rootDir?: string;
  config?: KnowledgeBaseConfig;
  host?: string;
  port?: number;
  dashboard?: KnowledgeBaseCliDashboardOptions;
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
  const dashboardToken = options.dashboard?.enabled && !options.dashboard.readOnly
    ? options.dashboard.token ?? randomBytes(18).toString('base64url')
    : undefined;
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
        rootDir,
        dashboard: options.dashboard?.enabled ? {
          readOnly: options.dashboard.readOnly ?? false,
          basePath: options.dashboard.basePath ?? '/dashboard'
        } : undefined
      },
      dashboard: dashboardToken ? {
        token: dashboardToken
      } : undefined,
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
    {
      host: options.host,
      port: options.port,
      dashboard: options.dashboard?.enabled ? {
        assetsDir: options.dashboard.assetsDir ?? await resolveOptionalDashboardAssetsDir(),
        basePath: options.dashboard.basePath ?? '/dashboard',
        readOnly: options.dashboard.readOnly ?? false,
        token: dashboardToken
      } : undefined
    }
  );
}

async function resolveOptionalDashboardAssetsDir(): Promise<string> {
  try {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<{
      resolveKnowledgeBaseDashboardAssetsDir?: () => string;
    }>;
    const dashboard = await dynamicImport('@emmassist-co/kb-dashboard');
    const resolveAssets = dashboard.resolveKnowledgeBaseDashboardAssetsDir;
    if (typeof resolveAssets === 'function') return resolveAssets();
  } catch {
    // Fall through to the actionable error below.
  }
  throw new Error('Dashboard assets were not found. Install @emmassist-co/kb-dashboard alongside @emmassist-co/kb-cli, or pass --assets-dir to kb dashboard.');
}

