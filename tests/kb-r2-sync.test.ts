import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  buildTenantKbPrefix,
  collectLocalMirrorFiles,
  createTenantKbSyncManifest,
  mergeTenantKbText,
  planTenantKbPull,
  planTenantKbPush,
  planTenantKbStatus,
  resolveTenantKbMirrorRoot,
  resolveTenantKbManifestPath,
  type TenantKbSyncManifest
} from '../packages/kb-cli/src/r2-sync-lib.js';
import {
  classifySemanticMirrorPath,
  isSemanticEditableMirrorPath
} from '../packages/kb-cli/src/semantic-sync/contract.js';
import {
  parseKbR2SyncArgs,
  renderKbR2SyncHelp
} from '../scripts/kb-r2-sync.ts';

test('buildTenantKbPrefix trims root slashes and scopes to tenant', () => {
  assert.equal(buildTenantKbPrefix('.kb', 'tenant-a'), '.kb/tenant-a/');
  assert.equal(buildTenantKbPrefix('/.kb/', 'tenant-a'), '.kb/tenant-a/');
});

test('resolveTenantKbMirrorRoot defaults to repo tmp sync directory', () => {
  const cwd = '/repo/admin';

  assert.equal(
    resolveTenantKbMirrorRoot({ cwd, tenantId: 'tenant-a' }),
    path.join(cwd, '.tmp', 'kb-sync', 'tenant-a')
  );
});

test('resolveTenantKbMirrorRoot honors explicit root override', () => {
  const cwd = '/repo/admin';

  assert.equal(
    resolveTenantKbMirrorRoot({
      cwd,
      tenantId: 'tenant-a',
      rootDir: '/tmp/custom-sync'
    }),
    path.join('/tmp/custom-sync', 'tenant-a')
  );
});

test('resolveTenantKbManifestPath places manifest inside tenant mirror root', () => {
  const mirrorRoot = '/repo/admin/.tmp/kb-sync/tenant-a';

  assert.equal(
    resolveTenantKbManifestPath(mirrorRoot),
    path.join(mirrorRoot, '.kb-sync-manifest.json')
  );
});

test('semantic mirror path contract marks only entity and source markdown as human-editable', () => {
  assert.deepEqual(classifySemanticMirrorPath('entities/vendor-acme.md'), {
    path: 'entities/vendor-acme.md',
    pathClass: 'editable-record',
    recordKind: 'entity',
    reason: 'entity_markdown'
  });
  assert.deepEqual(classifySemanticMirrorPath('sources/src_123.md'), {
    path: 'sources/src_123.md',
    pathClass: 'editable-record',
    recordKind: 'source',
    reason: 'source_markdown'
  });
  assert.equal(isSemanticEditableMirrorPath('entities/vendor-acme.md'), true);
  assert.equal(isSemanticEditableMirrorPath('events/evt-1.json'), false);
  assert.deepEqual(classifySemanticMirrorPath('events/evt-1.json'), {
    path: 'events/evt-1.json',
    pathClass: 'support-only',
    reason: 'generated_event'
  });
});

test('collectLocalMirrorFiles returns relative paths beneath the tenant mirror', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kb-sync-local-'));
  const mirrorRoot = path.join(root, 'tenant-a');

  try {
    mkdirSync(path.join(mirrorRoot, 'entities'), { recursive: true });
    writeFileSync(path.join(mirrorRoot, 'entities', 'vendor-acme.md'), '# Vendor\n', 'utf8');
    writeFileSync(path.join(mirrorRoot, '.kb-sync-manifest.json'), '{}\n', 'utf8');

    const files = await collectLocalMirrorFiles(mirrorRoot);

    assert.deepEqual(
      files.map((entry) => entry.path),
      ['entities/vendor-acme.md']
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('planTenantKbPull creates a manifest for an empty remote tenant', () => {
  const manifest = createTenantKbSyncManifest({
    tenantId: 'tenant-a',
    bucketName: 'administrative-agent-kb',
    prefix: '.kb/tenant-a/'
  });

  const plan = planTenantKbPull({
    remoteObjects: [],
    localFiles: [],
    manifest,
    deleteExtraLocal: false
  });

  assert.deepEqual(plan.downloads, []);
  assert.deepEqual(plan.staleLocalFiles, []);
  assert.deepEqual(plan.conflicts, []);
  assert.equal(plan.nextManifest.tenantId, 'tenant-a');
  assert.deepEqual(plan.nextManifest.files, {});
});

test('planTenantKbPull downloads only new or changed remote files and preserves local conflicts', () => {
  const manifest: TenantKbSyncManifest = {
    tenantId: 'tenant-a',
    bucketName: 'administrative-agent-kb',
    prefix: '.kb/tenant-a/',
    pulledAt: '2026-05-08T12:00:00.000Z',
    pushedAt: null,
    files: {
      'entities/same.md': { key: 'entities/same.md', remoteHash: 'same', localHash: 'same' },
      'entities/remote.md': { key: 'entities/remote.md', remoteHash: 'old-remote', localHash: 'old-local' },
      'entities/conflict.md': { key: 'entities/conflict.md', remoteHash: 'old-remote', localHash: 'old-local' }
    }
  };

  const plan = planTenantKbPull({
    manifest,
    remoteObjects: [
      { key: 'entities/same.md', hash: 'same', size: 1 },
      { key: 'entities/remote.md', hash: 'new-remote', size: 2 },
      { key: 'entities/conflict.md', hash: 'new-remote', size: 3 },
      { key: 'entities/new.md', hash: 'new', size: 4 }
    ],
    localFiles: [
      { path: 'entities/same.md', hash: 'same', size: 1 },
      { path: 'entities/remote.md', hash: 'old-local', size: 1 },
      { path: 'entities/conflict.md', hash: 'new-local', size: 5 }
    ],
    deleteExtraLocal: false
  });

  assert.deepEqual(plan.downloads.map((entry) => entry.key), ['entities/new.md', 'entities/remote.md']);
  assert.deepEqual(plan.conflicts, ['entities/conflict.md']);
});

test('planTenantKbStatus classifies unchanged modified added and deleted local files', () => {
  const manifest: TenantKbSyncManifest = {
    tenantId: 'tenant-a',
    bucketName: 'administrative-agent-kb',
    prefix: '.kb/tenant-a/',
    pulledAt: '2026-05-08T12:00:00.000Z',
    pushedAt: null,
    files: {
      'entities/vendor-acme.md': {
        key: 'entities/vendor-acme.md',
        remoteHash: 'same-hash',
        localHash: 'same-hash'
      },
      'entities/vendor-globex.md': {
        key: 'entities/vendor-globex.md',
        remoteHash: 'old-remote',
        localHash: 'old-local'
      },
      'entities/vendor-initech.md': {
        key: 'entities/vendor-initech.md',
        remoteHash: 'only-manifest',
        localHash: 'only-manifest'
      }
    }
  };

  const status = planTenantKbStatus({
    manifest,
    remoteObjects: [
      { key: 'entities/vendor-acme.md', hash: 'same-hash', size: 10 },
      { key: 'entities/vendor-globex.md', hash: 'old-remote', size: 10 },
      { key: 'entities/vendor-umbrella.md', hash: 'remote-only', size: 10 }
    ],
    localFiles: [
      { path: 'entities/vendor-acme.md', hash: 'same-hash', size: 10 },
      { path: 'entities/vendor-globex.md', hash: 'new-local', size: 11 },
      { path: 'entities/vendor-soylent.md', hash: 'local-only', size: 12 }
    ]
  });

  assert.deepEqual(
    status.entries.map((entry) => [entry.path, entry.state]),
    [
      ['entities/vendor-acme.md', 'unchanged'],
      ['entities/vendor-globex.md', 'modified-local'],
      ['entities/vendor-initech.md', 'deleted-local'],
      ['entities/vendor-soylent.md', 'added-local'],
      ['entities/vendor-umbrella.md', 'added-remote']
    ]
  );
});

test('planTenantKbStatus flags support-only local edits as rejected rather than editable drift', () => {
  const manifest: TenantKbSyncManifest = {
    tenantId: 'tenant-a',
    bucketName: 'administrative-agent-kb',
    prefix: '.kb/tenant-a/',
    pulledAt: '2026-05-08T12:00:00.000Z',
    pushedAt: null,
    files: {
      'events/evt-1.json': {
        key: 'events/evt-1.json',
        remoteHash: 'old-remote',
        localHash: 'old-remote'
      }
    }
  };

  const status = planTenantKbStatus({
    manifest,
    remoteObjects: [
      { key: 'events/evt-1.json', hash: 'old-remote', size: 10 }
    ],
    localFiles: [
      { path: 'events/evt-1.json', hash: 'new-local', size: 11 }
    ]
  });

  assert.deepEqual(status.entries, [
    { path: 'events/evt-1.json', state: 'rejected-local' }
  ]);
});

test('planTenantKbPush uploads only locally changed files', () => {
  const manifest: TenantKbSyncManifest = {
    tenantId: 'tenant-a',
    bucketName: 'administrative-agent-kb',
    prefix: '.kb/tenant-a/',
    pulledAt: '2026-05-08T12:00:00.000Z',
    pushedAt: null,
    files: {
      'entities/vendor-acme.md': {
        key: 'entities/vendor-acme.md',
        remoteHash: 'same-hash',
        localHash: 'same-hash'
      },
      'entities/vendor-globex.md': {
        key: 'entities/vendor-globex.md',
        remoteHash: 'old-remote',
        localHash: 'old-local'
      }
    }
  };

  const plan = planTenantKbPush({
    manifest,
    remoteObjects: [
      { key: 'entities/vendor-acme.md', hash: 'same-hash', size: 10 },
      { key: 'entities/vendor-globex.md', hash: 'old-remote', size: 10 }
    ],
    localFiles: [
      { path: 'entities/vendor-acme.md', hash: 'same-hash', size: 10 },
      { path: 'entities/vendor-globex.md', hash: 'new-local', size: 11 }
    ],
    deleteRemoteMissing: false,
    pushedAt: '2026-05-08T13:00:00.000Z'
  });

  assert.deepEqual(
    plan.uploads.map((entry) => entry.path),
    ['entities/vendor-globex.md']
  );
  assert.deepEqual(plan.deletions, []);
  assert.deepEqual(plan.conflicts, []);
  assert.equal(plan.nextManifest.files['entities/vendor-globex.md']?.localHash, 'new-local');
  assert.equal(plan.nextManifest.files['entities/vendor-globex.md']?.remoteHash, 'new-local');
});

test('planTenantKbPush reports conflicts when local and remote both changed', () => {
  const manifest: TenantKbSyncManifest = {
    tenantId: 'tenant-a',
    bucketName: 'administrative-agent-kb',
    prefix: '.kb/tenant-a/',
    pulledAt: '2026-05-08T12:00:00.000Z',
    pushedAt: null,
    files: {
      'entities/vendor-globex.md': {
        key: 'entities/vendor-globex.md',
        remoteHash: 'baseline-remote',
        localHash: 'baseline-local'
      }
    }
  };

  const plan = planTenantKbPush({
    manifest,
    remoteObjects: [{ key: 'entities/vendor-globex.md', hash: 'changed-remote', size: 10 }],
    localFiles: [{ path: 'entities/vendor-globex.md', hash: 'changed-local', size: 11 }],
    deleteRemoteMissing: false,
    pushedAt: '2026-05-08T13:00:00.000Z'
  });

  assert.deepEqual(plan.uploads, []);
  assert.deepEqual(plan.conflicts, ['entities/vendor-globex.md']);
});

test('planTenantKbPush refuses remote deletions unless explicitly enabled', () => {
  const manifest: TenantKbSyncManifest = {
    tenantId: 'tenant-a',
    bucketName: 'administrative-agent-kb',
    prefix: '.kb/tenant-a/',
    pulledAt: '2026-05-08T12:00:00.000Z',
    pushedAt: null,
    files: {
      'entities/vendor-initech.md': {
        key: 'entities/vendor-initech.md',
        remoteHash: 'old-remote',
        localHash: 'old-local'
      }
    }
  };

  const noDeletePlan = planTenantKbPush({
    manifest,
    remoteObjects: [{ key: 'entities/vendor-initech.md', hash: 'old-remote', size: 10 }],
    localFiles: [],
    deleteRemoteMissing: false,
    pushedAt: '2026-05-08T13:00:00.000Z'
  });

  assert.deepEqual(noDeletePlan.deletions, []);
  assert.deepEqual(noDeletePlan.skippedDeletions, ['entities/vendor-initech.md']);

  const deletePlan = planTenantKbPush({
    manifest,
    remoteObjects: [{ key: 'entities/vendor-initech.md', hash: 'old-remote', size: 10 }],
    localFiles: [],
    deleteRemoteMissing: true,
    pushedAt: '2026-05-08T13:00:00.000Z'
  });

  assert.deepEqual(deletePlan.deletions, ['entities/vendor-initech.md']);
  assert.deepEqual(deletePlan.skippedDeletions, []);
});

test('parseKbR2SyncArgs requires a command and tenant id for operational commands', () => {
  assert.throws(() => parseKbR2SyncArgs([]), /Usage: kb-r2-sync <pull\|status\|push>/);
  assert.throws(() => parseKbR2SyncArgs(['pull']), /Missing required flag: --tenant-id/);
});

test('parseKbR2SyncArgs resolves default mirror root under repo tmp sync path', () => {
  const parsed = parseKbR2SyncArgs(['status', '--tenant-id', 'workspace-template'], '/repo/admin');

  assert.equal(parsed.command, 'status');
  assert.equal(parsed.tenantId, 'workspace-template');
  assert.equal(parsed.mirrorRoot, '/repo/admin/.tmp/kb-sync/workspace-template');
});

test('parseKbR2SyncArgs enables merge by default and supports no-merge opt-out', () => {
  assert.equal(parseKbR2SyncArgs(['push', '--tenant-id', 'workspace-template'], '/repo/admin').mergeConflicts, true);
  assert.equal(parseKbR2SyncArgs(['push', '--tenant-id', 'workspace-template', '--no-merge'], '/repo/admin').mergeConflicts, false);
});

test('mergeTenantKbText automerges independent append-only edits', () => {
  const result = mergeTenantKbText({
    base: '## Timeline\n- old\n',
    local: '## Timeline\n- old\n- local\n',
    remote: '## Timeline\n- old\n- remote\n'
  });

  assert.deepEqual(result, {
    ok: true,
    content: '## Timeline\n- old\n- local\n- remote\n'
  });
});

test('mergeTenantKbText keeps conflict markers when edits cannot be safely automerged', () => {
  const result = mergeTenantKbText({
    base: 'status: old\n',
    local: 'status: local\n',
    remote: 'status: remote\n'
  });

  assert.equal(result.ok, false);
  assert.match(result.content, /<<<<<<< LOCAL/);
  assert.match(result.content, />>>>>>> REMOTE/);
});

test('renderKbR2SyncHelp documents commands and safety flags', () => {
  const help = renderKbR2SyncHelp();

  assert.match(help, /Usage: kb-r2-sync <pull\|status\|push>/);
  assert.match(help, /--tenant-id TENANT_ID/);
  assert.match(help, /--delete/);
});
