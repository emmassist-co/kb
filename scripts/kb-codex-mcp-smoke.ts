import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

interface ParsedArgs {
  tenantId: string;
  rootDir: string;
  prompt: string;
  keepCodexHome: boolean;
  scopes: string;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();
  await ensureLocalNodeModules(repoRoot);

  const tempRoot = await mkdtemp(path.join(tmpdir(), 'kb-codex-mcp-'));
  const codexHome = path.join(tempRoot, '.codex');
  await mkdir(codexHome, { recursive: true });
  await copyCodexAuth(codexHome);
  await writeFile(path.join(codexHome, 'config.toml'), '', 'utf8');

  const serverScript = path.resolve(repoRoot, 'scripts/kb-mcp-stdio.ts');
  const promptPath = path.join(tempRoot, 'last-message.txt');
  const env = {
    ...process.env,
    CODEX_HOME: codexHome
  };

  await runCommand('codex', [
    'mcp',
    'add',
    'kb-local-smoke',
    '--',
    'node',
    '--import',
    'tsx/esm',
    serverScript,
    '--tenant-id',
    parsed.tenantId,
    '--root-dir',
    parsed.rootDir,
    '--cwd',
    repoRoot,
    '--scopes',
    parsed.scopes
  ], { cwd: repoRoot, env, timeoutMs: 30000 });

  const mcpList = await runCommand('codex', ['mcp', 'get', 'kb-local-smoke'], { cwd: repoRoot, env, timeoutMs: 15000 });
  const execResult = await runCommand('codex', [
    'exec',
    '--skip-git-repo-check',
    '-c',
    'approval_policy="never"',
    '--cd',
    repoRoot,
    '--output-last-message',
    promptPath,
    '--json',
    parsed.prompt
  ], { cwd: repoRoot, env, timeoutMs: 120000 });

  const lastMessage = existsSync(promptPath)
    ? await readFile(promptPath, 'utf8')
    : '';

  const result = {
    ok: execResult.exitCode === 0,
    codexHome,
    tenantId: parsed.tenantId,
    rootDir: parsed.rootDir,
    mcp: mcpList.stdout.trim(),
    exec: {
      exitCode: execResult.exitCode,
      stdout: execResult.stdout,
      stderr: execResult.stderr,
      lastMessage
    }
  };

  console.log(JSON.stringify(result, null, 2));

  if (!parsed.keepCodexHome) {
    await rm(tempRoot, { recursive: true, force: true });
  }

  if (execResult.exitCode !== 0) {
    process.exit(execResult.exitCode);
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  let tenantId = 'default';
  let rootDir: string | undefined;
  let keepCodexHome = false;
  let scopes = 'kb.read,kb.write,kb.operator';
  let prompt = [
    'Use the configured kb-local-smoke MCP server.',
    'Call the capabilities tool first.',
    'Then answer with the tenant id, backend, workspace role, and whether the MCP connection worked.'
  ].join(' ');

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--tenant-id') {
      tenantId = requireValue(argv[++index], '--tenant-id');
      continue;
    }
    if (value === '--root-dir') {
      rootDir = path.resolve(requireValue(argv[++index], '--root-dir'));
      continue;
    }
    if (value === '--prompt') {
      prompt = requireValue(argv[++index], '--prompt');
      continue;
    }
    if (value === '--keep-codex-home') {
      keepCodexHome = true;
      continue;
    }
    if (value === '--scopes') {
      scopes = requireValue(argv[++index], '--scopes');
      continue;
    }
    if (value === '--help') {
      printHelpAndExit(0);
    }
    throw new Error(`Unknown flag: ${value}`);
  }

  return {
    tenantId,
    rootDir: rootDir ?? path.resolve(process.cwd(), '.kb', tenantId),
    prompt,
    keepCodexHome,
    scopes
  };
}

async function copyCodexAuth(targetCodexHome: string): Promise<void> {
  const sourceCodexHome = path.join(process.env.HOME ?? '', '.codex');
  const authPath = path.join(sourceCodexHome, 'auth.json');
  if (!existsSync(authPath)) {
    throw new Error(`Missing Codex auth file at ${authPath}. Run codex login first.`);
  }
  await cp(authPath, path.join(targetCodexHome, 'auth.json'));
}

async function ensureLocalNodeModules(repoRoot: string): Promise<void> {
  const target = path.join(repoRoot, 'node_modules');
  if (existsSync(target)) return;
  const sibling = path.resolve(repoRoot, '..', 'kb', 'node_modules');
  if (!existsSync(sibling)) {
    throw new Error(`Could not find node_modules at ${sibling}. Install dependencies first.`);
  }
  await symlink(sibling, target);
}

async function runCommand(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
  }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
    }, options.timeoutMs);
    child.on('error', reject);
    child.on('close', (exitCode) => {
      clearTimeout(timeout);
      resolve({
        stdout,
        stderr,
        exitCode: exitCode ?? 1
      });
    });
  });
}

function requireValue(value: string | undefined, flag: string): string {
  if (!value) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function printHelpAndExit(code: number): never {
  const text = [
    'kb-codex-mcp-smoke',
    '',
    'Create a disposable CODEX_HOME, register the local KB MCP server, and run a Codex exec smoke prompt.',
    '',
    'Flags:',
    '  --tenant-id TENANT_ID',
    '  --root-dir PATH',
    '  --prompt TEXT',
    '  --scopes kb.read,kb.write,kb.operator',
    '  --keep-codex-home'
  ].join('\n');
  if (code === 0) {
    console.log(text);
  } else {
    console.error(text);
  }
  process.exit(code);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
