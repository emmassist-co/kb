import { spawn } from 'node:child_process';
import type { CommandRunner } from './types.js';

export class ShellCommandRunner implements CommandRunner {
  async run(
    command: string,
    args: string[],
    options: { cwd: string; env?: Record<string, string | undefined>; stdinText?: string; timeoutMs?: number }
  ) {
    return new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: {
          ...process.env,
          ...options.env
        },
        stdio: ['pipe', 'pipe', 'pipe']
      });
      let stdout = '';
      let stderr = '';
      const timeout = options.timeoutMs
        ? setTimeout(() => {
            stderr += `\nCommand timed out after ${options.timeoutMs}ms.`;
            child.kill('SIGTERM');
            setTimeout(() => child.kill('SIGKILL'), 1_000).unref();
          }, options.timeoutMs)
        : null;
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      if (options.stdinText) {
        child.stdin.write(options.stdinText);
      }
      child.stdin.end();
      child.on('error', (error) => {
        if (timeout) clearTimeout(timeout);
        reject(error);
      });
      child.on('close', (code) => {
        if (timeout) clearTimeout(timeout);
        resolve({
          exitCode: code ?? 1,
          stdout,
          stderr
        });
      });
    });
  }
}
