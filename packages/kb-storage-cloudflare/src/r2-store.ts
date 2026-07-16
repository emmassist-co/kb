import type {
  KnowledgeBaseMode,
  KnowledgeEntityRegistryEntry,
  KnowledgeEvent,
  KnowledgeLink,
  KnowledgePromotionProposal,
  KnowledgeReviewItem
} from '@emmassist-co/kb-core';
import {
  clonePersistedKnowledgeState,
  createEmptyPersistedKnowledgeState,
  type PersistedKnowledgeState
} from '@emmassist-co/kb-core/snapshot-store';
import type { KnowledgeLinkOrigin } from '@emmassist-co/kb-core/store';

interface R2ObjectBodyLike {
  text(): Promise<string>;
}

interface R2ObjectLike {
  text?: (() => Promise<string>) | null;
  body?: R2ObjectBodyLike | ReadableStream<unknown> | null;
}

interface R2BucketLike {
  get(key: string): Promise<R2ObjectLike | null>;
  put(key: string, value: string): Promise<unknown>;
  delete(keys: string | string[]): Promise<unknown>;
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{
    objects: Array<{ key: string }>;
    truncated?: boolean;
    cursor?: string;
  }>;
}

const CANONICAL_SCHEMA_VERSION = 'v2';

export class R2CanonicalKbStore {
  constructor(
    private readonly bucket: R2BucketLike,
    private readonly rootDir: string,
    private readonly tenantId: string,
    private readonly mode: KnowledgeBaseMode
  ) {}

  async load(): Promise<{ state: PersistedKnowledgeState; version: string | null }> {
    const state = createEmptyPersistedKnowledgeState(this.mode);
    const proposals = state.proposals ??= {};
    const reviewItems = state.reviewItems ??= {};
    const files = await this.listAllKeys();
    let version: string | null = null;
    for (const key of files) {
      const content = await this.readText(key);
      if (content === null) continue;
      const relative = key.slice(this.prefix().length);
      if (relative === 'meta/version.json') {
        version = parseVersion(content);
        continue;
      }
      if (relative.startsWith('entities/') && relative.endsWith('.md')) {
        state.entities[relative.slice('entities/'.length, -3)] = content;
        continue;
      }
      if (relative.startsWith('sources/') && relative.endsWith('.md')) {
        state.sources[relative.slice('sources/'.length, -3)] = content;
        continue;
      }
      if (relative.startsWith('registry/') && relative.endsWith('.json')) {
        const entry = JSON.parse(content) as KnowledgeEntityRegistryEntry;
        state.registry[relative.slice('registry/'.length, -5)] = entry;
        continue;
      }
      if (relative.startsWith('drafts/') && relative.endsWith('.json')) {
        state.drafts[relative.slice('drafts/'.length, -5)] = JSON.parse(content);
        continue;
      }
      if (relative.startsWith('proposals/') && relative.endsWith('.json')) {
        proposals[relative.slice('proposals/'.length, -5)] = JSON.parse(content) as KnowledgePromotionProposal;
        continue;
      }
      if (relative.startsWith('reviews/') && relative.endsWith('.json')) {
        reviewItems[relative.slice('reviews/'.length, -5)] = JSON.parse(content) as KnowledgeReviewItem;
        continue;
      }
      if (relative.startsWith('events/') && relative.endsWith('.json')) {
        state.events.push(JSON.parse(content) as KnowledgeEvent);
        continue;
      }
      if (relative.startsWith('links/') && relative.endsWith('.json')) {
        state.links.push(JSON.parse(content) as KnowledgeLink);
      }
    }
    state.events.sort((left, right) => left.id.localeCompare(right.id));
    state.links.sort((left, right) => left.id.localeCompare(right.id));
    return {
      state,
      version
    };
  }

  async readVersion(): Promise<string | null> {
    return parseVersion(await this.readText(this.key('meta/version.json')));
  }

  async save(state: PersistedKnowledgeState, version: string): Promise<void> {
    await this.rebuild(state, version);
  }

  async rebuild(state: PersistedKnowledgeState, version: string): Promise<void> {
    await this.reset();
    const snapshot = clonePersistedKnowledgeState(state);
    const proposals = snapshot.proposals ?? {};
    const reviewItems = snapshot.reviewItems ?? {};
    await this.putMeta(version);
    for (const [id, markdown] of sortedEntries(snapshot.entities)) {
      await this.putEntity(id, markdown);
    }
    for (const [id, markdown] of sortedEntries(snapshot.sources)) {
      await this.putSource(id, markdown);
    }
    for (const [id, entry] of sortedEntries(snapshot.registry)) {
      await this.putRegistryEntry(id, entry);
    }
    for (const event of [...snapshot.events].sort((left, right) => left.id.localeCompare(right.id))) {
      await this.putEvent(event);
    }
    for (const [id, draft] of sortedEntries(snapshot.drafts)) {
      await this.putDraft(id, draft);
    }
    for (const [id, proposal] of sortedEntries(proposals)) {
      await this.putProposal(id, proposal);
    }
    for (const [id, item] of sortedEntries(reviewItems)) {
      await this.putReviewItem(id, item);
    }
    const groupedLinks = new Map<string, KnowledgeLink[]>();
    for (const link of [...snapshot.links].sort((left, right) => left.id.localeCompare(right.id))) {
      if (!link.originKind || !link.originId) continue;
      const groupKey = `${link.originKind}:${link.originId}`;
      groupedLinks.set(groupKey, [...(groupedLinks.get(groupKey) ?? []), link]);
    }
    for (const [groupKey, links] of [...groupedLinks.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const [kind, id] = splitOriginKey(groupKey);
      await this.replaceLinksForOrigin({ kind, id }, links);
    }
  }

  async reset(): Promise<void> {
    const keys = await this.listAllKeys();
    if (keys.length > 0) {
      await this.bucket.delete(keys);
    }
  }

  async putMeta(version: string): Promise<void> {
    await this.bucket.put(
      this.key('meta/version.json'),
      `${JSON.stringify({
        version,
        schemaVersion: CANONICAL_SCHEMA_VERSION,
        updatedAt: new Date().toISOString()
      }, null, 2)}\n`
    );
  }

  async putEntity(id: string, markdown: string): Promise<void> {
    await this.bucket.put(this.key(`entities/${id}.md`), markdown);
  }

  async putSource(id: string, markdown: string): Promise<void> {
    await this.bucket.put(this.key(`sources/${id}.md`), markdown);
  }

  async putRegistryEntry(id: string, entry: KnowledgeEntityRegistryEntry): Promise<void> {
    await this.bucket.put(this.key(`registry/${id}.json`), `${JSON.stringify(entry, null, 2)}\n`);
  }

  async putDraft(id: string, draft: unknown): Promise<void> {
    await this.bucket.put(this.key(`drafts/${id}.json`), `${JSON.stringify(draft, null, 2)}\n`);
  }

  async deleteDraft(id: string): Promise<void> {
    await this.bucket.delete(this.key(`drafts/${id}.json`));
  }

  async putProposal(id: string, proposal: KnowledgePromotionProposal): Promise<void> {
    await this.bucket.put(this.key(`proposals/${id}.json`), `${JSON.stringify(proposal, null, 2)}\n`);
  }

  async deleteProposal(id: string): Promise<void> {
    await this.bucket.delete(this.key(`proposals/${id}.json`));
  }

  async putReviewItem(id: string, item: KnowledgeReviewItem): Promise<void> {
    await this.bucket.put(this.key(`reviews/${id}.json`), `${JSON.stringify(item, null, 2)}\n`);
  }

  async deleteReviewItem(id: string): Promise<void> {
    await this.bucket.delete(this.key(`reviews/${id}.json`));
  }

  async putEvent(event: KnowledgeEvent): Promise<void> {
    await this.bucket.put(this.key(`events/${event.id}.json`), `${JSON.stringify(event, null, 2)}\n`);
  }

  async replaceLinksForOrigin(origin: KnowledgeLinkOrigin, links: KnowledgeLink[]): Promise<void> {
    const prefix = this.key(`links/${origin.kind}/${origin.id}/`);
    const existing = await this.listAllKeys(prefix);
    if (existing.length > 0) {
      await this.bucket.delete(existing);
    }
    for (const link of [...links].sort((left, right) => left.id.localeCompare(right.id))) {
      await this.bucket.put(
        this.key(`links/${origin.kind}/${origin.id}/${link.id}.json`),
        `${JSON.stringify(link, null, 2)}\n`
      );
    }
  }

  private async listAllKeys(prefix = this.prefix()): Promise<string[]> {
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.bucket.list({
        prefix,
        cursor
      });
      keys.push(...page.objects.map((entry) => entry.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return keys.sort();
  }

  private async readText(key: string): Promise<string | null> {
    const object = await this.bucket.get(key);
    if (!object) return null;
    if (typeof object.text === 'function') {
      return object.text();
    }
    if (object.body && typeof (object.body as R2ObjectBodyLike).text === 'function') {
      return (object.body as R2ObjectBodyLike).text();
    }
    if (object.body) {
      return new Response(object.body as BodyInit).text();
    }
    return null;
  }

  private prefix(): string {
    return `${trimSlashes(this.rootDir)}/${this.tenantId}/`;
  }

  private key(relativePath: string): string {
    return `${this.prefix()}${relativePath}`;
  }
}

function parseVersion(content: string | null): string | null {
  if (!content) return null;
  const parsed = JSON.parse(content) as { version?: string };
  return parsed.version ?? null;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

function sortedEntries<T>(value: Record<string, T>): Array<[string, T]> {
  return Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
}

function splitOriginKey(value: string): [KnowledgeLinkOrigin['kind'], string] {
  const separator = value.indexOf(':');
  return [value.slice(0, separator) as KnowledgeLinkOrigin['kind'], value.slice(separator + 1)];
}
