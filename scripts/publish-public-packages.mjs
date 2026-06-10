import { readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repoRoot = process.cwd();
const dryRun = process.argv.includes('--dry-run');

const packages = [
  { name: '@emmassist-co/kb-core', manifestPath: 'packages/kb-core/package.json' },
  { name: '@emmassist-co/kb-storage-file', manifestPath: 'packages/kb-storage-file/package.json' },
  { name: '@emmassist-co/kb-storage-cloudflare', manifestPath: 'packages/kb-storage-cloudflare/package.json' },
  { name: '@emmassist-co/kb-http', manifestPath: 'packages/kb-http/package.json' },
  { name: '@emmassist-co/kb-mcp', manifestPath: 'packages/kb-mcp/package.json' },
  { name: '@emmassist-co/kb-cli', manifestPath: 'packages/kb-cli/package.json' }
];

for (const pkg of packages) {
  const manifest = JSON.parse(readFileSync(path.join(repoRoot, pkg.manifestPath), 'utf8'));
  const version = manifest.version;
  let publishedVersion = '';
  try {
    publishedVersion = execFileSync('npm', ['view', pkg.name, 'version'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    publishedVersion = '';
  }

  if (publishedVersion === version) {
    console.log(`skip ${pkg.name}@${version} already published`);
    continue;
  }

  if (dryRun) {
    console.log(`publish ${pkg.name}@${version} (registry has ${publishedVersion || 'none'})`);
    continue;
  }

  console.log(`publishing ${pkg.name}@${version} (registry has ${publishedVersion || 'none'})`);
  execFileSync('npm', ['publish', '--workspace', pkg.name], {
    cwd: repoRoot,
    stdio: 'inherit'
  });
}
