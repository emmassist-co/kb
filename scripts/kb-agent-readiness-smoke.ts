import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

interface ParsedArgs {
  mode: 'local-pack' | 'published';
  spec?: string;
  keep: boolean;
  skipBuild: boolean;
}

const REQUIRED_SKILLS = ['kb-local-setup', 'kb-write', 'kb-cloudflare-setup'];
const LOCAL_PACK_WORKSPACES = [
  '@emmassist-co/kb-core',
  '@emmassist-co/kb-http',
  '@emmassist-co/kb-storage-file',
  '@emmassist-co/kb-cli'
];

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    mode: 'local-pack',
    keep: false,
    skipBuild: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--local-pack') {
      parsed.mode = 'local-pack';
      continue;
    }
    if (arg === '--published') {
      parsed.mode = 'published';
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) {
        parsed.spec = next;
        index += 1;
      }
      continue;
    }
    if (arg === '--keep') {
      parsed.keep = true;
      continue;
    }
    if (arg === '--skip-build') {
      parsed.skipBuild = true;
      continue;
    }
    if (arg === '--help') {
      printHelpAndExit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function run(command: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv; input?: string; timeoutMs?: number }) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    input: options.input,
    encoding: 'utf8',
    stdio: options.input ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
    timeout: options.timeoutMs ?? 120_000
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error([
      `Command failed: ${command} ${args.join(' ')}`,
      result.stdout?.trim() ? `stdout:\n${result.stdout.trim()}` : '',
      result.stderr?.trim() ? `stderr:\n${result.stderr.trim()}` : ''
    ].filter(Boolean).join('\n'));
  }
  return result.stdout ?? '';
}

function packLocalWorkspaces(repoRoot: string, packDir: string, skipBuild: boolean): string[] {
  if (!skipBuild) {
    run('npm', ['run', 'build:public'], { cwd: repoRoot, timeoutMs: 300_000 });
  }

  return LOCAL_PACK_WORKSPACES.map((workspace) => {
    const output = run('npm', ['pack', '--workspace', workspace, '--pack-destination', packDir], {
      cwd: repoRoot,
      timeoutMs: 120_000
    }).trim().split('\n').filter(Boolean).at(-1);
    if (!output) throw new Error(`npm pack produced no output for ${workspace}`);
    return path.join(packDir, output);
  });
}

function installCli(parsed: ParsedArgs, repoRoot: string, tempProject: string, packDir: string) {
  if (parsed.mode === 'published') {
    const spec = parsed.spec ?? '@emmassist-co/kb-cli@latest';
    run('npm', ['install', spec, '--@emmassist-co:registry=https://npm.pkg.github.com'], {
      cwd: tempProject,
      timeoutMs: 180_000
    });
    return;
  }

  const tarballs = packLocalWorkspaces(repoRoot, packDir, parsed.skipBuild);
  run('npm', ['install', ...tarballs], { cwd: tempProject, timeoutMs: 180_000 });
}

function assertJsonCommand(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  const stdout = run(command, args, { cwd, env, timeoutMs: 120_000 });
  return JSON.parse(stdout) as Record<string, unknown>;
}

function verifyCliRoundTrip(tempProject: string) {
  const rootDir = path.join(tempProject, '.kb');
  const env = {
    ...process.env,
    KB_ROOT_DIR: rootDir,
    KB_WORKSPACE_ID: 'agent-readiness-smoke'
  };

  const inspect = assertJsonCommand('npx', ['kb', 'inspect'], tempProject, env) as {
    backend?: string;
    workspaceRole?: string;
  };
  if (inspect.backend !== 'file' || inspect.workspaceRole !== 'local-development') {
    throw new Error(`Unexpected kb inspect payload: ${JSON.stringify(inspect)}`);
  }

  const legacyInspect = assertJsonCommand('npx', ['kb-local', 'inspect'], tempProject, env) as {
    backend?: string;
    workspaceRole?: string;
  };
  if (legacyInspect.backend !== inspect.backend || legacyInspect.workspaceRole !== inspect.workspaceRole) {
    throw new Error(`kb-local inspect drifted from kb inspect: ${JSON.stringify(legacyInspect)}`);
  }

  const memory = {
    intent: 'fact_update',
    summary: 'Agent readiness smoke can write KB memory',
    content: 'The fresh-folder smoke installed the CLI, used the kb binary, wrote memory, and searched it back.'
  };
  run('npx', ['kb', 'remember', '--json', '-'], {
    cwd: tempProject,
    env,
    input: `${JSON.stringify(memory)}\n`,
    timeoutMs: 120_000
  });

  const search = assertJsonCommand('npx', ['kb', 'search', '--json', '{"query":"Agent readiness smoke write KB memory"}'], tempProject, env) as {
    results?: Array<{ title?: string }>;
  };
  if (!search.results?.some((result) => result.title === memory.summary)) {
    throw new Error(`Search did not retrieve smoke memory: ${JSON.stringify(search)}`);
  }
}

function verifyPackageLocalSkills(tempProject: string) {
  const skillsHome = path.join(tempProject, '.skills-home');
  const skillsEnv = {
    ...process.env,
    HOME: skillsHome,
    XDG_CONFIG_HOME: path.join(skillsHome, '.config'),
    XDG_DATA_HOME: path.join(skillsHome, '.local', 'share'),
    XDG_CACHE_HOME: path.join(skillsHome, '.cache')
  };
  mkdirSync(skillsEnv.XDG_CONFIG_HOME, { recursive: true });
  mkdirSync(skillsEnv.XDG_DATA_HOME, { recursive: true });
  mkdirSync(skillsEnv.XDG_CACHE_HOME, { recursive: true });

  for (const skill of REQUIRED_SKILLS) {
    const skillPath = path.join(tempProject, 'node_modules', '@emmassist-co', 'kb-cli', 'skills', skill);
    if (!existsSync(path.join(skillPath, 'SKILL.md'))) {
      throw new Error(`Missing packaged skill: ${skillPath}`);
    }
    run('npx', ['-y', 'skills', 'add', skillPath, '--agent', 'codex', 'pi', 'claude-code', '--copy', '-y', '--full-depth'], {
      cwd: tempProject,
      env: skillsEnv,
      timeoutMs: 180_000
    });
  }

  const list = JSON.parse(run('npx', ['-y', 'skills', 'list', '--json'], {
    cwd: tempProject,
    env: skillsEnv,
    timeoutMs: 120_000
  })) as Array<{ name?: string }>;
  const names = new Set(list.map((skill) => skill.name));
  for (const required of REQUIRED_SKILLS) {
    if (!names.has(required)) {
      throw new Error(`skills list did not include ${required}: ${JSON.stringify(list)}`);
    }
  }

  const rendered = run('npx', ['-y', 'skills', 'use', path.join(tempProject, 'node_modules', '@emmassist-co', 'kb-cli', 'skills', 'kb-write'), '--skill', 'kb-write', '--full-depth'], {
    cwd: tempProject,
    env: skillsEnv,
    timeoutMs: 120_000
  });
  if (!rendered.includes('Use this when the task is to store') || !rendered.includes('kb remember --json -')) {
    throw new Error(`skills use did not render the kb-write prompt as expected:\n${rendered}`);
  }
}

function printHelpAndExit(code: number): never {
  const help = [
    'kb-agent-readiness-smoke',
    '',
    'Create a clean temp project, install KB CLI, verify kb/kb-local, install packaged skills, and search written memory.',
    '',
    'Flags:',
    '  --local-pack              Pack local workspaces and install them into the temp project (default)',
    '  --published [SPEC]        Install a published package spec, default @emmassist-co/kb-cli@latest',
    '  --skip-build              Skip npm run build:public before local packing',
    '  --keep                    Keep the temp project for inspection',
    '  --help'
  ].join('\n');
  if (code === 0) console.log(help);
  else console.error(help);
  process.exit(code);
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'kb-agent-readiness-'));
  const tempProject = path.join(tempRoot, 'project');
  const packDir = path.join(tempRoot, 'packs');
  try {
    mkdirSync(tempProject, { recursive: true });
    mkdirSync(packDir, { recursive: true });
    writeFileSync(path.join(tempProject, 'package.json'), `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`);
    run('git', ['init', '-q'], { cwd: tempProject });

    installCli(parsed, repoRoot, tempProject, packDir);
    verifyCliRoundTrip(tempProject);
    verifyPackageLocalSkills(tempProject);

    console.log(JSON.stringify({
      ok: true,
      mode: parsed.mode,
      tempProject: parsed.keep ? tempProject : undefined,
      verified: {
        bins: ['kb', 'kb-local'],
        skills: REQUIRED_SKILLS
      }
    }, null, 2));
  } finally {
    if (!parsed.keep) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
