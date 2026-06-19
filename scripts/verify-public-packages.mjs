import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const tmpRoot = mkdtempSync(path.join(tmpdir(), 'kb-public-packages-'));
const packsDir = path.join(tmpRoot, 'packs');
const consumerDir = path.join(tmpRoot, 'consumer');
const npmCacheDir = path.join(tmpRoot, 'npm-cache');
const npmUserConfigPath = path.join(tmpRoot, 'npmrc');

const npmEnv = {
  ...process.env,
  npm_config_cache: npmCacheDir,
  npm_config_userconfig: npmUserConfigPath
};

const publicPackages = [
  {
    name: '@emmassist-co/kb-core',
    workspace: '@emmassist-co/kb-core',
    expectedEntries: ['package/dist/index.js', 'package/dist/index.d.ts'],
    forbiddenEntries: ['package/src/']
  },
  {
    name: '@emmassist-co/kb-storage-file',
    workspace: '@emmassist-co/kb-storage-file',
    expectedEntries: ['package/dist/index.js', 'package/dist/index.d.ts'],
    forbiddenEntries: ['package/src/']
  },
  {
    name: '@emmassist-co/kb-storage-cloudflare',
    workspace: '@emmassist-co/kb-storage-cloudflare',
    expectedEntries: ['package/dist/index.js', 'package/dist/index.d.ts', 'package/dist/r2-store.js'],
    forbiddenEntries: ['package/src/']
  },
  {
    name: '@emmassist-co/kb-http',
    workspace: '@emmassist-co/kb-http',
    expectedEntries: ['package/dist/index.js', 'package/dist/index.d.ts', 'package/dist/node-server.js'],
    forbiddenEntries: ['package/src/']
  },
  {
    name: '@emmassist-co/kb-mcp',
    workspace: '@emmassist-co/kb-mcp',
    expectedEntries: ['package/dist/index.js', 'package/dist/index.d.ts', 'package/dist/cloudflare-worker.js'],
    forbiddenEntries: ['package/src/']
  },
  {
    name: '@emmassist-co/kb-cli',
    workspace: '@emmassist-co/kb-cli',
    expectedEntries: ['package/bin/kb-local.mjs', 'package/dist/index.js', 'package/dist/main.js', 'package/dist/r2-sync-lib.js'],
    forbiddenEntries: ['package/src/']
  },
  {
    name: '@emmassist-co/kb-flue-adapter',
    workspace: '@emmassist-co/kb-flue-adapter',
    expectedEntries: ['package/dist/index.js', 'package/dist/index.d.ts', 'package/dist/command.js', 'package/dist/config.js'],
    forbiddenEntries: ['package/src/']
  }
];

mkdirSync(packsDir, { recursive: true });
mkdirSync(consumerDir, { recursive: true });
mkdirSync(npmCacheDir, { recursive: true });
writeFileSync(npmUserConfigPath, 'package-lock=false\n', 'utf8');

try {
  const packedTarballs = publicPackages.map((pkg) => {
    const packed = JSON.parse(execFileSync(
      'npm',
      ['pack', '--json', '--pack-destination', packsDir, '--workspace', pkg.workspace],
      { cwd: repoRoot, encoding: 'utf8', env: npmEnv }
    ));
    const filename = packed[0]?.filename;
    assert.equal(typeof filename, 'string', `npm pack did not return a filename for ${pkg.name}`);
    const tarballPath = path.join(packsDir, filename);
    const entries = execFileSync('tar', ['-tf', tarballPath], { encoding: 'utf8' })
      .split('\n')
      .map((entry) => entry.trim())
      .filter(Boolean);

    for (const expectedEntry of pkg.expectedEntries) {
      assert(entries.includes(expectedEntry), `${pkg.name} is missing packed entry ${expectedEntry}`);
    }
    for (const forbiddenEntry of pkg.forbiddenEntries) {
      assert(!entries.some((entry) => entry.startsWith(forbiddenEntry)), `${pkg.name} unexpectedly packed ${forbiddenEntry}`);
    }

    return tarballPath;
  });

  writeFileSync(path.join(consumerDir, 'package.json'), `${JSON.stringify({
    name: 'kb-public-consumer-smoke',
    private: true,
    type: 'module'
  }, null, 2)}\n`, 'utf8');

  execFileSync(
    'npm',
    ['install', '--prefer-offline', '--no-audit', '--no-fund', ...packedTarballs],
    { cwd: consumerDir, stdio: 'inherit', env: npmEnv }
  );

  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      [
        "const core = await import('@emmassist-co/kb-core');",
        "const http = await import('@emmassist-co/kb-http');",
        "const mcp = await import('@emmassist-co/kb-mcp');",
        "const storage = await import('@emmassist-co/kb-storage-file');",
        "const cloudflare = await import('@emmassist-co/kb-storage-cloudflare');",
        "const flueAdapter = await import('@emmassist-co/kb-flue-adapter');",
        "if (typeof core.KnowledgeBaseService !== 'function') throw new Error('kb-core export missing');",
        "if (typeof http.startKnowledgeBaseNodeServer !== 'function') throw new Error('kb-http export missing');",
        "if (typeof mcp.createKnowledgeBaseMcpServer !== 'function') throw new Error('kb-mcp export missing');",
        "if (typeof storage.FileKnowledgeStore !== 'function') throw new Error('kb-storage-file export missing');",
        "if (typeof cloudflare.R2CanonicalKbStore !== 'function') throw new Error('kb-storage-cloudflare export missing');",
        "if (typeof flueAdapter.createKbCommand !== 'function') throw new Error('kb-flue-adapter export missing');"
      ].join(' ')
    ],
    { cwd: consumerDir, stdio: 'inherit' }
  );

  const cliResult = spawnSync(
    path.join(consumerDir, 'node_modules', '.bin', 'kb-local'),
    ['help'],
    { cwd: consumerDir, encoding: 'utf8' }
  );
  if (cliResult.status !== 0) {
    throw new Error(cliResult.stderr || cliResult.stdout || 'packaged kb-local help failed');
  }
  assert.match(cliResult.stdout, /kb inspect/);
  assert.match(cliResult.stdout, /kb sync <pull\|status\|push>/);

  const installedCliManifest = JSON.parse(
    readFileSync(path.join(consumerDir, 'node_modules', '@emmassist-co', 'kb-cli', 'package.json'), 'utf8')
  );
  assert.equal(installedCliManifest.publishConfig?.registry, 'https://npm.pkg.github.com');
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}
