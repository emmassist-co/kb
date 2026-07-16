import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  EntityDraft,
  KnowledgeBaseMode,
  KnowledgeEntityRegistryEntry,
  KnowledgeEvent,
  KnowledgeLinkOrigin,
  KnowledgeStore,
  KnowledgeLink,
  KnowledgeLock,
  KnowledgePromotionProposal,
  KnowledgeReviewItem
} from '@emmassist-co/kb-core';

interface FileStoreManifest {
  mode: KnowledgeBaseMode;
}

interface FileLockRecord {
  token: string;
  expiresAt: number;
}

export class FileKnowledgeStore implements KnowledgeStore {
  private readonly manifestPath: string;
  private readonly entityDir: string;
  private readonly sourceDir: string;
  private readonly draftDir: string;
  private readonly proposalDir: string;
  private readonly reviewDir: string;
  private readonly eventPath: string;
  private readonly linkPath: string;
  private readonly registryPath: string;
  private readonly lockDir: string;

  constructor(private readonly rootDir: string, private readonly configuredMode: KnowledgeBaseMode) {
    this.manifestPath = path.join(rootDir, 'manifest.json');
    this.entityDir = path.join(rootDir, 'entities');
    this.sourceDir = path.join(rootDir, 'sources');
    this.draftDir = path.join(rootDir, 'drafts');
    this.proposalDir = path.join(rootDir, 'proposals');
    this.reviewDir = path.join(rootDir, 'reviews');
    this.eventPath = path.join(rootDir, 'events.jsonl');
    this.linkPath = path.join(rootDir, 'links.jsonl');
    this.registryPath = path.join(rootDir, 'registry.json');
    this.lockDir = path.join(rootDir, '.locks');
  }

  async mode(): Promise<KnowledgeBaseMode> {
    const manifest = await this.readManifest();
    return manifest.mode;
  }

  async getEntityMarkdown(id: string): Promise<string | null> {
    return this.readOptionalFile(path.join(this.entityDir, `${id}.md`));
  }

  async listEntityMarkdown(): Promise<Array<{ id: string; markdown: string }>> {
    return this.listMarkdownDir(this.entityDir);
  }

  async putEntityMarkdown(id: string, markdown: string): Promise<void> {
    await this.ensureReady();
    await writeFile(path.join(this.entityDir, `${id}.md`), markdown, 'utf8');
  }

  async deleteEntityMarkdown(id: string): Promise<void> {
    try {
      await rm(path.join(this.entityDir, `${id}.md`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async getSourceMarkdown(id: string): Promise<string | null> {
    return this.readOptionalFile(path.join(this.sourceDir, `${id}.md`));
  }

  async listSourceMarkdown(): Promise<Array<{ id: string; markdown: string }>> {
    return this.listMarkdownDir(this.sourceDir);
  }

  async putSourceMarkdown(id: string, markdown: string): Promise<void> {
    await this.ensureReady();
    await writeFile(path.join(this.sourceDir, `${id}.md`), markdown, 'utf8');
  }

  async deleteSourceMarkdown(id: string): Promise<void> {
    try {
      await rm(path.join(this.sourceDir, `${id}.md`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async listEntityRegistry(): Promise<KnowledgeEntityRegistryEntry[]> {
    const raw = await this.readOptionalFile(this.registryPath);
    if (!raw) return [];
    return JSON.parse(raw) as KnowledgeEntityRegistryEntry[];
  }

  async putEntityRegistryEntry(entry: KnowledgeEntityRegistryEntry): Promise<void> {
    await this.ensureReady();
    const current = await this.listEntityRegistry();
    const next = [...current.filter((item) => item.entityId !== entry.entityId), entry].sort((left, right) =>
      left.entityId.localeCompare(right.entityId)
    );
    await writeFile(this.registryPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  }

  async deleteEntityRegistryEntry(entityId: string): Promise<void> {
    await this.ensureReady();
    const current = await this.listEntityRegistry();
    const next = current.filter((item) => item.entityId !== entityId);
    await writeFile(this.registryPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  }

  async appendEvent(event: KnowledgeEvent): Promise<void> {
    await this.ensureReady();
    const current = (await this.readOptionalFile(this.eventPath)) ?? '';
    const line = `${JSON.stringify(event)}\n`;
    await writeFile(this.eventPath, current + line, 'utf8');
  }

  async listEvents(): Promise<KnowledgeEvent[]> {
    const raw = await this.readOptionalFile(this.eventPath);
    if (!raw) return [];
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as KnowledgeEvent);
  }

  async replaceEvents(events: KnowledgeEvent[]): Promise<void> {
    await this.ensureReady();
    const payload = events.map((event) => JSON.stringify(event)).join('\n');
    await writeFile(this.eventPath, payload ? `${payload}\n` : '', 'utf8');
  }

  async getDraft(entityId: string): Promise<EntityDraft | null> {
    const raw = await this.readOptionalFile(path.join(this.draftDir, `${entityId}.json`));
    return raw ? (JSON.parse(raw) as EntityDraft) : null;
  }

  async putDraft(draft: EntityDraft): Promise<void> {
    await this.ensureReady();
    await writeFile(path.join(this.draftDir, `${draft.entityId}.json`), JSON.stringify(draft, null, 2), 'utf8');
  }

  async deleteDraft(entityId: string): Promise<void> {
    try {
      await rm(path.join(this.draftDir, `${entityId}.json`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async listDrafts(): Promise<EntityDraft[]> {
    return this.listJsonDir<EntityDraft>(this.draftDir);
  }

  async getPromotionProposal(proposalId: string): Promise<KnowledgePromotionProposal | null> {
    const raw = await this.readOptionalFile(path.join(this.proposalDir, `${proposalId}.json`));
    return raw ? (JSON.parse(raw) as KnowledgePromotionProposal) : null;
  }

  async putPromotionProposal(proposal: KnowledgePromotionProposal): Promise<void> {
    await this.ensureReady();
    await writeFile(path.join(this.proposalDir, `${proposal.id}.json`), JSON.stringify(proposal, null, 2), 'utf8');
  }

  async deletePromotionProposal(proposalId: string): Promise<void> {
    try {
      await rm(path.join(this.proposalDir, `${proposalId}.json`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async listPromotionProposals(): Promise<KnowledgePromotionProposal[]> {
    return this.listJsonDir<KnowledgePromotionProposal>(this.proposalDir);
  }

  async getReviewItem(itemId: string): Promise<KnowledgeReviewItem | null> {
    const raw = await this.readOptionalFile(path.join(this.reviewDir, `${itemId}.json`));
    return raw ? (JSON.parse(raw) as KnowledgeReviewItem) : null;
  }

  async putReviewItem(item: KnowledgeReviewItem): Promise<void> {
    await this.ensureReady();
    await writeFile(path.join(this.reviewDir, `${item.id}.json`), JSON.stringify(item, null, 2), 'utf8');
  }

  async deleteReviewItem(itemId: string): Promise<void> {
    try {
      await rm(path.join(this.reviewDir, `${itemId}.json`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async listReviewItems(): Promise<KnowledgeReviewItem[]> {
    return this.listJsonDir<KnowledgeReviewItem>(this.reviewDir);
  }

  async listLinks(): Promise<KnowledgeLink[]> {
    const raw = await this.readOptionalFile(this.linkPath);
    if (!raw) return [];
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as KnowledgeLink);
  }

  async replaceLinksForOrigin(origin: KnowledgeLinkOrigin, links: KnowledgeLink[]): Promise<void> {
    await this.ensureReady();
    const current = await this.listLinks();
    const next = current
      .filter((link) => !(link.originKind === origin.kind && link.originId === origin.id))
      .concat(links);
    const payload = next.map((link) => JSON.stringify(link)).join('\n');
    await writeFile(this.linkPath, payload ? `${payload}\n` : '', 'utf8');
  }

  async acquireEntityLock(entityId: string, ttlMs: number): Promise<KnowledgeLock | null> {
    await this.ensureReady();
    const lockPath = path.join(this.lockDir, `${entityId}.json`);
    const now = Date.now();
    const current = await this.readOptionalFile(lockPath);
    if (current) {
      const parsed = JSON.parse(current) as FileLockRecord;
      if (parsed.expiresAt > now) return null;
    }
    const lock = {
      key: entityId,
      token: crypto.randomUUID(),
      expiresAt: now + ttlMs
    };
    await writeFile(lockPath, JSON.stringify({ token: lock.token, expiresAt: lock.expiresAt }), 'utf8');
    return lock;
  }

  async releaseEntityLock(lock: KnowledgeLock): Promise<void> {
    const lockPath = path.join(this.lockDir, `${lock.key}.json`);
    const current = await this.readOptionalFile(lockPath);
    if (!current) return;
    const parsed = JSON.parse(current) as FileLockRecord;
    if (parsed.token !== lock.token) return;
    await rm(lockPath);
  }

  private async ensureReady(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    await mkdir(this.entityDir, { recursive: true });
    await mkdir(this.sourceDir, { recursive: true });
    await mkdir(this.draftDir, { recursive: true });
    await mkdir(this.proposalDir, { recursive: true });
    await mkdir(this.reviewDir, { recursive: true });
    await mkdir(this.lockDir, { recursive: true });
    if (!(await exists(this.manifestPath))) {
      await writeFile(this.manifestPath, JSON.stringify({ mode: this.configuredMode }, null, 2), 'utf8');
    }
  }

  private async readManifest(): Promise<FileStoreManifest> {
    await this.ensureReady();
    const raw = await readFile(this.manifestPath, 'utf8');
    return JSON.parse(raw) as FileStoreManifest;
  }

  private async listMarkdownDir(dir: string): Promise<Array<{ id: string; markdown: string }>> {
    await this.ensureReady();
    const entries = await readdir(dir);
    const results: Array<{ id: string; markdown: string }> = [];
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue;
      const markdown = await readFile(path.join(dir, entry), 'utf8');
      results.push({ id: entry.slice(0, -3), markdown });
    }
    return results.sort((left, right) => left.id.localeCompare(right.id));
  }

  private async listJsonDir<T>(dir: string): Promise<T[]> {
    await this.ensureReady();
    const entries = await readdir(dir);
    const results: T[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const raw = await readFile(path.join(dir, entry), 'utf8');
      results.push(JSON.parse(raw) as T);
    }
    return results.sort((left, right) => String((left as { id?: string; entityId?: string }).id ?? (left as { entityId?: string }).entityId ?? '').localeCompare(String((right as { id?: string; entityId?: string }).id ?? (right as { entityId?: string }).entityId ?? '')));
  }

  private async readOptionalFile(filePath: string): Promise<string | null> {
    try {
      return await readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
