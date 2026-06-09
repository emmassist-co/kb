import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { KbAutoresearchCliOptions, KbAutoresearchRunConfig } from './types.js';

export function buildRunConfig(repoRoot: string, options: KbAutoresearchCliOptions): KbAutoresearchRunConfig {
  const runId = options.resumeRunId ?? new Date().toISOString().replace(/[:.]/g, '-');
  const artifactsRoot = path.resolve(repoRoot, 'artifacts/kb-autoresearch');
  const cacheRoot = path.join(artifactsRoot, 'cache');
  const currentRoot = path.join(artifactsRoot, 'current');
  const runRoot = path.join(artifactsRoot, 'runs', runId);
  const branchName = `kb-autoresearch/${runId}`;
  const agentBackend = options.agentBackend ?? 'codex';
  mkdirSync(runRoot, { recursive: true });
  return {
    ...options,
    agentBackend,
    agentCommand: options.agentCommand ?? (agentBackend === 'pi' ? path.resolve(repoRoot, 'node_modules/.bin/pi') : undefined),
    agentProvider: options.agentProvider ?? (agentBackend === 'pi' ? 'openai-codex' : undefined),
    model: options.model ?? (agentBackend === 'pi' ? 'gpt-5.3-codex-spark' : undefined),
    runId,
    createdAt: new Date().toISOString(),
    baseBranch: branchName,
    allowlist: ['src/lib/kb/service.ts', 'src/lib/kb/relations.ts', 'src/lib/kb/relation-rules.json'],
    kbRuntime: resolveKbRuntimeFromEnv(process.env),
    protectedMetrics: ['falseCertaintyRate', 'overclaimRate', 'falseMergeRate'],
    benchmarkPolicy: {
      screening: ['admin-world-v3 dev'],
      acceptance: ['admin-world-v3 holdout'],
      guardrails: ['core-six dev', 'core-six holdout', 'gbrain-world:github-benchmark'],
      skippedFromLoop: ['repo-docs dev', 'repo-docs holdout']
    },
    paths: {
      artifactsRoot,
      cacheRoot,
      currentRoot,
      runRoot,
      ledgerPath: path.join(artifactsRoot, 'ledger.jsonl'),
      resultsPath: path.join(artifactsRoot, 'results.jsonl'),
      briefingPath: path.join(runRoot, 'briefing.md'),
      logPath: path.join(runRoot, 'log.txt'),
      bestScorePath: path.join(runRoot, 'best-score.json'),
      promptRoot: path.join(runRoot, 'prompts'),
      reportPath: path.join(runRoot, 'report.md'),
      currentBestScorePath: path.join(currentRoot, 'best-score.json'),
      currentReportPath: path.join(currentRoot, 'report.md'),
      currentConfigPath: path.join(currentRoot, 'config.json'),
      currentStatusPath: path.join(currentRoot, 'status.json'),
      currentStatusMarkdownPath: path.join(currentRoot, 'status.md'),
      currentBriefingPath: path.join(currentRoot, 'briefing.md'),
      currentLogPath: path.join(currentRoot, 'log.txt')
    }
  };
}

function resolveKbRuntimeFromEnv(env: NodeJS.ProcessEnv): KbAutoresearchRunConfig['kbRuntime'] {
  const tenantId = env.KB_TENANT_ID ?? env.WORKSPACE_TENANT_ID ?? 'default';
  const baseUrl = env.KB_BASE_URL?.trim();
  const backend = env.KB_BACKEND?.trim().toLowerCase();
  if (baseUrl) {
    return {
      tenantId,
      backend: backend === 'r2-mirror' ? 'r2-mirror' : 'cloudflare',
      transport: 'http',
      canonical: true,
      workspaceRole: 'canonical-production',
      endpoint: baseUrl
    };
  }
  if (backend === 'r2-mirror') {
    return {
      tenantId,
      backend: 'r2-mirror',
      transport: 'local',
      canonical: false,
      workspaceRole: 'mirror-support'
    };
  }
  return {
    tenantId,
    backend: 'file',
    transport: 'local',
    canonical: false,
    workspaceRole: 'local-development'
  };
}

export function loadRunConfig(repoRoot: string, runId: string): KbAutoresearchRunConfig {
  const configPath = path.resolve(repoRoot, 'artifacts/kb-autoresearch/runs', runId, 'config.json');
  if (!existsSync(configPath)) {
    throw new Error(`Unknown autoresearch run: ${runId}`);
  }
  return JSON.parse(readFileSync(configPath, 'utf8')) as KbAutoresearchRunConfig;
}
