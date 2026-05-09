import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AgentAdapter, AgentRunOptions, CandidateMutationResult, CommandRunner } from './types.js';
import { buildAutoresearchPrompt } from './prompt.js';

export class PiAgentAdapter implements AgentAdapter {
  constructor(
    private readonly runner: CommandRunner,
    private readonly options: {
      command?: string;
      provider?: string;
      onLog?: (message: string) => void;
    } = {}
  ) {}

  async preflight(options: { cwd: string; model?: string }): Promise<void> {
    const promptDir = path.join(options.cwd, 'artifacts', 'kb-autoresearch', 'pi-preflight');
    mkdirSync(promptDir, { recursive: true });
    const normalizedModel = normalizePiModel(this.options.provider, options.model);
    const isolatedPiHome = prepareIsolatedPiHome(promptDir, normalizedModel, this.options.provider);
    const command = this.options.command ?? 'npx';
    const args =
      command === 'npx'
        ? buildPiListModelsArgs(this.options.provider, normalizedModel, true)
        : buildPiListModelsArgs(this.options.provider, normalizedModel, false);
    const result = await this.runner.run(command, args, {
      cwd: resolvePiCwd(options.cwd),
      env: {
        PI_CODING_AGENT_DIR: isolatedPiHome,
        PI_OFFLINE: '1'
      }
    });
    const message = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n');
    if (isPiConfigurationFailure(message)) {
      throw new AgentConfigurationError(message);
    }
  }

  async runCandidate(runOptions: AgentRunOptions): Promise<CandidateMutationResult> {
    const promptDir = path.dirname(runOptions.promptPath);
    const outputPath = path.join(promptDir, 'last-message.txt');
    const eventsPath = path.join(promptDir, 'events.jsonl');
    mkdirSync(promptDir, { recursive: true });
    const basePrompt = readFileSync(runOptions.promptPath, 'utf8');
    const diagnosis = await this.runStep({
      step: 'diagnose',
      promptDir,
      cwd: runOptions.cwd,
      model: runOptions.model,
      basePrompt,
      structuredContext: runOptions.structuredContext
    });
    const edit = await this.runStep({
      step: 'edit',
      promptDir,
      cwd: runOptions.cwd,
      model: runOptions.model,
      basePrompt,
      structuredContext: runOptions.structuredContext,
      diagnosisSummary: diagnosis.finalMessage
    });
    writeFileSync(eventsPath, [diagnosis.rawOutput.trim(), edit.rawOutput.trim()].filter(Boolean).join('\n'), 'utf8');
    writeFileSync(outputPath, edit.finalMessage, 'utf8');
    return {
      finalMessage: edit.finalMessage,
      sessionId: edit.sessionId ?? diagnosis.sessionId,
      rawEventsPath: eventsPath
    };
  }

  private async runStep(input: {
    step: 'diagnose' | 'edit';
    promptDir: string;
    cwd: string;
    model?: string;
    basePrompt: string;
    structuredContext: AgentRunOptions['structuredContext'];
    diagnosisSummary?: string;
  }): Promise<{ sessionId?: string; finalMessage: string; rawOutput: string }> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const compact = attempt > 0;
      const prompt = buildAutoresearchPrompt(input.basePrompt, input.structuredContext, {
        compact,
        mode: input.step,
        diagnosisSummary: input.diagnosisSummary
      });
      const normalizedModel = normalizePiModel(this.options.provider, input.model);
      const isolatedPiHome = prepareIsolatedPiHome(input.promptDir, normalizedModel, this.options.provider);
      const command = this.options.command ?? 'npx';
      const args =
        command === 'npx'
          ? buildPiArgs(this.options.provider, normalizedModel, prompt, true)
          : buildPiArgs(this.options.provider, normalizedModel, prompt, false);
      const agentCwd = resolvePiCwd(input.cwd);

      this.options.onLog?.(
        `[agent] starting pi step=${input.step} provider=${this.options.provider ?? 'default'} model=${normalizedModel ?? 'default'} cwd=${agentCwd} attempt=${attempt + 1}${compact ? ' compact=1' : ''}`
      );
      const startedAt = Date.now();
      const result = await this.runner.run(command, args, {
        cwd: agentCwd,
        env: {
          PI_CODING_AGENT_DIR: isolatedPiHome,
          PI_OFFLINE: '1'
        }
      });
      this.options.onLog?.(
        `[agent] finished pi step=${input.step} exit=${result.exitCode} duration_ms=${Date.now() - startedAt} attempt=${attempt + 1}`
      );

      const parsed = parsePiJsonOutput(result.stdout);
      const errorMessage = result.exitCode !== 0
        ? result.stderr.trim() || parsed.errorMessage || 'pi run failed.'
        : parsed.errorMessage;
      if (errorMessage) {
        lastError = new Error(errorMessage);
        if (compact || !isContextLengthExceeded(errorMessage)) {
          throw lastError;
        }
        this.options.onLog?.(`[agent] retrying pi step=${input.step} after context overflow with compact prompt`);
        continue;
      }

      return { finalMessage: parsed.finalMessage, sessionId: parsed.sessionId, rawOutput: result.stdout };
    }

    throw lastError ?? new Error('pi run failed.');
  }
}

function buildPiArgs(provider: string | undefined, model: string | undefined, prompt: string, includeBinaryName: boolean): string[] {
  const args = [
    ...(includeBinaryName ? ['pi'] : []),
    '-p',
    '--mode',
    'json',
    '--no-session',
    '--no-context-files',
    '--no-skills',
    '--no-extensions',
    '--no-prompt-templates',
    '--no-themes'
  ];
  if (provider) {
    args.push('--provider', provider);
  }
  if (model) {
    args.push('--model', model);
  }
  args.push(prompt);
  return args;
}

function buildPiListModelsArgs(provider: string | undefined, model: string | undefined, includeBinaryName: boolean): string[] {
  const args = [
    ...(includeBinaryName ? ['pi'] : []),
    '--list-models'
  ];
  if (provider) {
    args.push('--provider', provider);
  }
  if (model) {
    args.push('--model', model);
  }
  return args;
}

function prepareIsolatedPiHome(promptDir: string, model: string | undefined, provider: string | undefined): string {
  const homeDir = path.join(promptDir, 'pi-home');
  mkdirSync(homeDir, { recursive: true });
  const sourceAuthPath = resolveBestPiAuthSource(path.join(homeDir, 'auth.json'));
  if (!sourceAuthPath) {
    throw new Error(`Pi auth not found. Run \`./node_modules/.bin/pi\` and \`/login\` first.`);
  }
  copyFileSync(sourceAuthPath, path.join(homeDir, 'auth.json'));
  const settings = {
    defaultProvider: provider ?? 'openai-codex',
    defaultModel: model ?? 'gpt-5.3-codex-spark',
    enabledModels: model ? [model] : ['openai-codex/gpt-5.3-codex-spark'],
    hideThinkingBlock: true
  };
  writeFileSync(path.join(homeDir, 'settings.json'), JSON.stringify(settings, null, 2), 'utf8');
  return homeDir;
}

function resolvePiCwd(candidateRoot: string): string {
  const kbRoot = path.join(candidateRoot, 'src/lib/kb');
  return existsSync(kbRoot) ? kbRoot : candidateRoot;
}

function normalizePiModel(provider: string | undefined, model: string | undefined): string | undefined {
  if (!model) return model;
  if (model.includes('/')) return model;
  if (!provider) return model;
  return `${provider}/${model}`;
}

function resolveBestPiAuthSource(targetAuthPath: string): string | undefined {
  const candidates = [
    path.resolve(process.env.HOME ?? '', '.pi/agent/auth.json'),
    path.resolve(process.cwd(), 'artifacts/kb-autoresearch/pi-preflight/pi-home/auth.json'),
    targetAuthPath
  ];
  return candidates.find((candidate) => hasUsablePiAuth(candidate));
}

function hasUsablePiAuth(authPath: string): boolean {
  if (!existsSync(authPath)) return false;
  try {
    const parsed = JSON.parse(readFileSync(authPath, 'utf8')) as Record<string, unknown>;
    return Object.keys(parsed).length > 0;
  } catch {
    return false;
  }
}

function isPiConfigurationFailure(message: string): boolean {
  return /No API key found|No models available|No models match pattern/i.test(message);
}

export class AgentConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentConfigurationError';
  }
}

export function parsePiJsonOutput(output: string): {
  sessionId?: string;
  finalMessage: string;
  errorMessage?: string;
} {
  let sessionId: string | undefined;
  let finalMessage = '';
  let errorMessage: string | undefined;

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const event = JSON.parse(trimmed) as Record<string, unknown>;
      if (event.type === 'session' && typeof event.id === 'string') {
        sessionId = event.id;
      }
      if (event.type === 'turn_end' && isRecord(event.message)) {
        const message = event.message;
        const messageText = extractPiMessageText(message.content);
        if (messageText) finalMessage = messageText;
        if (typeof message.errorMessage === 'string' && message.errorMessage) {
          errorMessage = message.errorMessage;
        }
      }
      if (event.role === 'assistant' && typeof event.errorMessage === 'string' && event.errorMessage) {
        errorMessage = event.errorMessage;
      }
      if (event.type === 'error' && isRecord(event.error) && typeof event.error.message === 'string') {
        errorMessage = event.error.message;
      }
    } catch {}
  }

  return { sessionId, finalMessage, errorMessage };
}

function isContextLengthExceeded(message: string): boolean {
  return /context_length_exceeded/i.test(message);
}

function extractPiMessageText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (!isRecord(part)) return '';
      return typeof part.text === 'string' ? part.text : '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
