import { copyFileSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CandidateDiffSummary, CandidateWorkspaceSnapshot, CommandRunner } from './types.js';

export class CandidateWorkspaceManager {
  constructor(private readonly runner: CommandRunner, private readonly repoRoot: string) {}

  async ensureResearchBranch(branchName: string): Promise<string> {
    const snapshotCommit = await this.createResearchBaseCommit();
    await this.runner.run('git', ['branch', '--force', branchName, snapshotCommit], { cwd: this.repoRoot });
    return snapshotCommit;
  }

  async createCandidateWorktree(rootDir: string, branchName: string, iteration: number): Promise<CandidateWorkspaceSnapshot> {
    mkdirSync(rootDir, { recursive: true });
    const worktreePath = path.join(rootDir, `candidate-${String(iteration).padStart(4, '0')}`);
    rmSync(worktreePath, { force: true, recursive: true });
    const baseCommit = await this.revParse(branchName, this.repoRoot);
    const add = await this.runner.run('git', ['worktree', 'add', '--detach', worktreePath, baseCommit], { cwd: this.repoRoot });
    if (add.exitCode !== 0) {
      throw new Error(add.stderr.trim() || `Failed to create worktree: ${worktreePath}`);
    }
    this.linkSharedNodeModules(worktreePath);
    return {
      worktreePath,
      baseCommit,
      branchName
    };
  }

  async removeWorktree(worktreePath: string): Promise<void> {
    await this.runner.run('git', ['worktree', 'remove', '--force', worktreePath], { cwd: this.repoRoot });
    rmSync(worktreePath, { force: true, recursive: true });
  }

  async summarizeDiff(worktreePath: string): Promise<CandidateDiffSummary> {
    const names = await this.runner.run('git', ['diff', '--name-only'], { cwd: worktreePath });
    const diff = await this.runner.run('git', ['diff', '--unified=0'], { cwd: worktreePath });
    const changedFiles = names.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    return {
      changedFiles,
      unifiedDiffLines: diff.stdout.split('\n').filter((line) => line.startsWith('+') || line.startsWith('-')).length,
      diff: diff.stdout
    };
  }

  async commitCandidate(worktreePath: string, message: string): Promise<string> {
    const add = await this.runner.run('git', ['add', '-A'], { cwd: worktreePath });
    if (add.exitCode !== 0) throw new Error(add.stderr.trim() || 'Failed to stage candidate changes.');
    const commit = await this.runner.run(
      'git',
      ['-c', 'user.name=kb-autoresearch', '-c', 'user.email=kb-autoresearch@example.invalid', 'commit', '-m', message],
      { cwd: worktreePath }
    );
    if (commit.exitCode !== 0) {
      throw new Error(commit.stderr.trim() || 'Failed to commit candidate.');
    }
    return this.revParse('HEAD', worktreePath);
  }

  async fastForwardResearchBranch(branchName: string, commit: string): Promise<void> {
    const result = await this.runner.run('git', ['branch', '--force', branchName, commit], { cwd: this.repoRoot });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || `Failed to update branch ${branchName}.`);
    }
  }

  async revParse(ref: string, cwd: string): Promise<string> {
    const result = await this.runner.run('git', ['rev-parse', ref], { cwd });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || `Failed to rev-parse ${ref}.`);
    }
    return result.stdout.trim();
  }

  private async createResearchBaseCommit(): Promise<string> {
    const head = await this.revParse('HEAD', this.repoRoot);
    const status = await this.runner.run('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: this.repoRoot });
    if (!status.stdout.trim()) {
      return head;
    }

    const gitIndexPath = await this.resolveGitPath('index');
    const tempDir = mkdtempSync(path.join(tmpdir(), 'kb-autoresearch-index-'));
    const tempIndexPath = path.join(tempDir, 'index');
    try {
      if (existsSync(gitIndexPath)) {
        copyFileSync(gitIndexPath, tempIndexPath);
      } else {
        writeFileSync(tempIndexPath, '', 'utf8');
      }

      const env = {
        GIT_INDEX_FILE: tempIndexPath
      };
      const add = await this.runner.run('git', ['add', '-A'], { cwd: this.repoRoot, env });
      if (add.exitCode !== 0) {
        throw new Error(add.stderr.trim() || 'Failed to stage working tree snapshot.');
      }

      const tree = await this.runner.run('git', ['write-tree'], { cwd: this.repoRoot, env });
      if (tree.exitCode !== 0) {
        throw new Error(tree.stderr.trim() || 'Failed to write working tree snapshot.');
      }

      const commit = await this.runner.run(
        'git',
        ['commit-tree', tree.stdout.trim(), '-p', head, '-m', 'kb-autoresearch: working tree snapshot'],
        {
          cwd: this.repoRoot,
          env: {
            ...env,
            GIT_AUTHOR_NAME: 'kb-autoresearch',
            GIT_AUTHOR_EMAIL: 'kb-autoresearch@example.invalid',
            GIT_COMMITTER_NAME: 'kb-autoresearch',
            GIT_COMMITTER_EMAIL: 'kb-autoresearch@example.invalid'
          }
        }
      );
      if (commit.exitCode !== 0) {
        throw new Error(commit.stderr.trim() || 'Failed to create working tree snapshot commit.');
      }
      return commit.stdout.trim();
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  }

  private async resolveGitPath(target: string): Promise<string> {
    const result = await this.runner.run('git', ['rev-parse', '--git-path', target], { cwd: this.repoRoot });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || `Failed to resolve git path for ${target}.`);
    }
    return path.resolve(this.repoRoot, result.stdout.trim());
  }

  private linkSharedNodeModules(worktreePath: string): void {
    const sourceNodeModules = path.join(this.repoRoot, 'node_modules');
    const targetNodeModules = path.join(worktreePath, 'node_modules');
    if (!existsSync(sourceNodeModules) || existsSync(targetNodeModules)) return;
    symlinkSync(sourceNodeModules, targetNodeModules, 'dir');
  }
}
