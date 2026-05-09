#!/usr/bin/env node
import { runKnowledgeBaseCliMain } from './main.js';

const result = await runKnowledgeBaseCliMain(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  stdin: await readStdin()
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exitCode = result.exitCode;

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
