import { spawn } from 'node:child_process';
import type { CommandRunner } from './types.js';

export class ShellCommandRunner implements CommandRunner {
  async run(command: string, args: string[], options: { cwd: string; env?: Record<string, string | undefined>; stdinText?: string }) {
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
      child.on('error', reject);
      child.on('close', (code) => {
        resolve({
          exitCode: code ?? 1,
          stdout,
          stderr
        });
      });
    });
  }
}
