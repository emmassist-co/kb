import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd(), 'eval/data/admin-world-v3');
const manifestPath = path.join(root, 'admin-world.json');

const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
const pagesById = new Map(raw.pages.map((page) => [page.id, page]));
const baseQueries = raw.queries.filter((query) => !query.id.includes('::confidence-variant'));
const existingIds = new Set(baseQueries.map((query) => query.id));

const variantQueries = [];
for (const query of baseQueries) {
  const variantId = `${query.id}::confidence-variant`;
  if (existingIds.has(variantId)) {
    continue;
  }
  const anchor = pagesById.get(query.anchorId);
  if (!anchor) {
    continue;
  }
  variantQueries.push({
    ...query,
    id: variantId,
    text: buildVariantText(query, anchor.title)
  });
  existingIds.add(variantId);
}

raw.queries = [...baseQueries, ...variantQueries];

const coverage = Object.fromEntries(
  raw.queries.reduce((map, query) => {
    const family = query.family ?? 'unknown';
    map.set(family, (map.get(family) ?? 0) + 1);
    return map;
  }, new Map())
);

raw.coverage = coverage;
raw.metadata = {
  ...(raw.metadata ?? {}),
  familyCounts: coverage,
  coverage,
  generation: {
    ...(raw.metadata?.generation ?? {}),
    confidenceVariantPasses: 2
  }
};

writeFileSync(manifestPath, `${JSON.stringify(raw, null, 2)}\n`);

function buildVariantText(query, anchorTitle) {
  const base = query.text.trim().replace(/\?$/, '');
  if (query.requiresTimeline) {
    return `Currently, ${lowercaseFirst(base)}?`;
  }
  if (query.usesAlias || query.indirectPhrasing) {
    return `Operationally, ${lowercaseFirst(base)}?`;
  }
  return `For the current setup, ${lowercaseFirst(base)}?`;
}

function lowercaseFirst(value) {
  return value.slice(0, 1).toLowerCase() + value.slice(1);
}
