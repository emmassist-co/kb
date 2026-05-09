import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AgentAdapter, AgentRunOptions, CandidateMutationResult, CommandRunner } from './types.js';
import { buildAutoresearchPrompt, promptSha256 } from './prompt.js';

export class CodexExecAgentAdapter implements AgentAdapter {
  constructor(
    private readonly runner: CommandRunner,
    private readonly options: {
      onLog?: (message: string) => void;
    } = {}
  ) {}

  async runCandidate(options: AgentRunOptions): Promise<CandidateMutationResult> {
    const prompt = buildAutoresearchPrompt(readFileSync(options.promptPath, 'utf8'), options.structuredContext);
    const outputPath = path.join(path.dirname(options.promptPath), 'last-message.json');
    const eventsPath = path.join(path.dirname(options.promptPath), 'events.jsonl');
    const schemaPath = path.resolve(options.cwd, 'eval/autoresearch/agent-output.schema.json');
    mkdirSync(path.dirname(outputPath), { recursive: true });
    const args = [
      'exec',
      '--json',
      '--sandbox',
      'workspace-write',
      '--cd',
      options.cwd,
      '--output-last-message',
      outputPath,
      '--output-schema',
      schemaPath
    ];
    if (options.model) {
      args.push('--model', options.model);
    }
    args.push('-');

    this.options.onLog?.(`[agent] starting codex model=${options.model ?? 'default'} cwd=${options.cwd}`);
    const startedAt = Date.now();
    const result = await this.runner.run('codex', args, {
      cwd: options.cwd,
      stdinText: prompt
    });
    this.options.onLog?.(`[agent] finished codex exit=${result.exitCode} duration_ms=${Date.now() - startedAt}`);
    writeFileSync(eventsPath, result.stdout, 'utf8');
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || 'codex exec failed.');
    }

    const finalMessage = readFileSync(outputPath, 'utf8');
    const sessionId = parseSessionId(result.stdout);
    return {
      finalMessage,
      sessionId,
      rawEventsPath: eventsPath
    };
  }
}

function parseSessionId(eventsJsonl: string): string | undefined {
  for (const line of eventsJsonl.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const sessionId = parsed.session_id ?? parsed.sessionId;
      if (typeof sessionId === 'string' && sessionId) return sessionId;
    } catch {}
  }
  return undefined;
}
