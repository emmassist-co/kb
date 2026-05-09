import type { EntityDocument, KnowledgeSearchResult, SourceDocument } from './types.js';

export interface Bm25Index {
  docs: Bm25IndexedDocument[];
  docFrequencies: Map<string, number>;
  averageLengthByField: Map<string, number>;
  averageLength: number;
}

export interface Bm25IndexedDocument {
  id: string;
  kind: 'entity' | 'source';
  entityKind?: EntityDocument['meta']['kind'];
  title: string;
  sourceIds: string[];
  excerpt: string;
  fields: Bm25IndexedField[];
  length: number;
}

export interface Bm25IndexedField {
  name: string;
  weight: number;
  b: number;
  normalizedText: string;
  termFrequency: Map<string, number>;
  length: number;
}

const FIELD_WEIGHTS = {
  entity: {
    title: 6,
    aliases: 5,
    handles: 4.5,
    tags: 2,
    truth: 2.25,
    timeline: 1
  },
  source: {
    title: 5,
    summary: 2.5,
    content: 1,
    tags: 2
  }
} as const;

const FIELD_B = {
  title: 0.2,
  alias: 0.25,
  handle: 0.25,
  tag: 0.35,
  truth: 0.75,
  timeline: 0.85,
  summary: 0.7,
  content: 0.9
} as const;

const EXACT_FIELD_BOOST = {
  title: 4.5,
  alias: 4,
  handle: 3.5,
  tag: 1.5,
  truth: 1.5,
  timeline: 0.5,
  summary: 1.5,
  content: 0.5
} as const;

const PHRASE_FIELD_BOOST = {
  title: 1.75,
  alias: 1.5,
  handle: 1.25,
  tag: 0.75,
  truth: 0.5,
  timeline: 0.25,
  summary: 0.5,
  content: 0.2
} as const;

const K1 = 1.5;
const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'for',
  'how',
  'in',
  'is',
  'of',
  'on',
  'or',
  'that',
  'the',
  'to',
  'what',
  'when',
  'where',
  'which',
  'who'
]);

export function buildBm25Index(input: {
  entities: EntityDocument[];
  sources: SourceDocument[];
}): Bm25Index {
  const docs: Bm25IndexedDocument[] = [
    ...input.entities.map(indexEntity),
    ...input.sources.map(indexSource)
  ];
  const docFrequencies = new Map<string, number>();
  const fieldLengthTotals = new Map<string, number>();
  const fieldDocCounts = new Map<string, number>();
  let totalLength = 0;

  for (const doc of docs) {
    totalLength += doc.length;
    const uniqueTerms = new Set<string>();
    for (const field of doc.fields) {
      fieldLengthTotals.set(field.name, (fieldLengthTotals.get(field.name) ?? 0) + field.length);
      fieldDocCounts.set(field.name, (fieldDocCounts.get(field.name) ?? 0) + 1);
      for (const term of field.termFrequency.keys()) uniqueTerms.add(term);
    }
    for (const term of uniqueTerms) {
      docFrequencies.set(term, (docFrequencies.get(term) ?? 0) + 1);
    }
  }

  const averageLengthByField = new Map<string, number>();
  for (const [fieldName, total] of fieldLengthTotals) {
    averageLengthByField.set(fieldName, total / Math.max(fieldDocCounts.get(fieldName) ?? 1, 1));
  }

  return {
    docs,
    docFrequencies,
    averageLengthByField,
    averageLength: docs.length > 0 ? totalLength / docs.length : 0
  };
}

export function scoreBm25Index(input: {
  index: Bm25Index;
  query: string;
  limit: number;
  kind?: EntityDocument['meta']['kind'];
}): KnowledgeSearchResult[] {
  const queryTokens = tokenizeBm25Raw(input.query);
  const terms = [...new Set(queryTokens)];
  const normalizedQuery = queryTokens.join(' ');
  if (terms.length === 0) return [];
  const totalDocs = input.index.docs.length;
  const results: KnowledgeSearchResult[] = [];

  for (const doc of input.index.docs) {
    if (input.kind && doc.entityKind && doc.entityKind !== input.kind) continue;
    if (input.kind && doc.kind === 'source') continue;

    let score = 0;
    const matchedTerms = new Set<string>();
    const matchedFields = new Set<string>();
    const reasons = new Set<string>();
    let exactBoost = 0;

    for (const term of terms) {
      let weightedTf = 0;
      let matched = false;
      for (const field of doc.fields) {
        const tf = field.termFrequency.get(term) ?? 0;
        if (tf <= 0) continue;
        matched = true;
        const averageFieldLength = Math.max(input.index.averageLengthByField.get(field.name) ?? field.length, 1);
        const normalization = (1 - field.b) + field.b * (field.length / averageFieldLength);
        weightedTf += field.weight * (tf / Math.max(normalization, 0.1));
        matchedFields.add(field.name);
      }
      if (!matched || weightedTf <= 0) continue;
      matchedTerms.add(term);
      const df = input.index.docFrequencies.get(term) ?? 0;
      const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));
      const numerator = weightedTf * (K1 + 1);
      const denominator = weightedTf + K1;
      score += idf * (numerator / denominator);
    }

    if (score <= 0) continue;
    if (normalizedQuery) {
      for (const field of doc.fields) {
        if (!field.normalizedText) continue;
        if (field.normalizedText === normalizedQuery) {
          exactBoost = Math.max(exactBoost, EXACT_FIELD_BOOST[field.name as keyof typeof EXACT_FIELD_BOOST] ?? 0);
          reasons.add(`exact-field:${field.name}`);
        } else if (normalizedQuery.length >= 4 && field.normalizedText.includes(normalizedQuery)) {
          exactBoost = Math.max(exactBoost, PHRASE_FIELD_BOOST[field.name as keyof typeof PHRASE_FIELD_BOOST] ?? 0);
          reasons.add(`phrase-field:${field.name}`);
        }
      }
    }
    score += exactBoost;
    results.push({
      id: doc.id,
      kind: doc.kind,
      entityKind: doc.entityKind,
      title: doc.title,
      score: Number(score.toFixed(3)),
      reason: [...matchedTerms].map((term) => `bm25:${term}`).concat([...reasons]),
      matchedFields: [...matchedFields],
      sourceIds: doc.sourceIds,
      confidence: scoreToConfidence(score),
      ambiguous: score < 2,
      excerpt: doc.excerpt,
      retrievalMode: 'search-only'
    });
  }

  return results
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, input.limit);
}

export function tokenizeBm25(value: string): string[] {
  return [...new Set(tokenizeBm25Raw(value))];
}

function indexEntity(entity: EntityDocument): Bm25IndexedDocument {
  return createDocument({
    id: entity.meta.id,
    kind: 'entity',
    entityKind: entity.meta.kind,
    title: entity.meta.title,
    sourceIds: entity.sources,
    excerpt: compactExcerpt(entity.currentTruth || entity.timeline[0] || entity.meta.title),
    fields: [
      { name: 'title', weight: FIELD_WEIGHTS.entity.title, text: entity.meta.title },
      { name: 'alias', weight: FIELD_WEIGHTS.entity.aliases, text: entity.meta.aliases.join(' ') },
      { name: 'handle', weight: FIELD_WEIGHTS.entity.handles, text: entity.meta.handles.join(' ') },
      { name: 'tag', weight: FIELD_WEIGHTS.entity.tags, text: entity.meta.tags.join(' ') },
      { name: 'truth', weight: FIELD_WEIGHTS.entity.truth, text: entity.currentTruth },
      { name: 'timeline', weight: FIELD_WEIGHTS.entity.timeline, text: entity.timeline.join(' ') }
    ]
  });
}

function indexSource(source: SourceDocument): Bm25IndexedDocument {
  return createDocument({
    id: source.meta.id,
    kind: 'source',
    title: source.meta.title,
    sourceIds: [source.meta.id],
    excerpt: compactExcerpt(source.summary || source.content || source.meta.title),
    fields: [
      { name: 'title', weight: FIELD_WEIGHTS.source.title, text: source.meta.title },
      { name: 'summary', weight: FIELD_WEIGHTS.source.summary, text: source.summary },
      { name: 'content', weight: FIELD_WEIGHTS.source.content, text: source.content },
      { name: 'tag', weight: FIELD_WEIGHTS.source.tags, text: source.meta.tags.join(' ') }
    ]
  });
}

function createDocument(input: {
  id: string;
  kind: 'entity' | 'source';
  entityKind?: EntityDocument['meta']['kind'];
  title: string;
  sourceIds: string[];
  excerpt: string;
  fields: Array<{ name: string; weight: number; text: string }>;
}): Bm25IndexedDocument {
  const fields: Bm25IndexedField[] = [];
  let length = 0;

  for (const field of input.fields) {
    const rawTerms = tokenizeBm25Raw(field.text);
    if (rawTerms.length === 0) continue;
    const termFrequency = new Map<string, number>();
    for (const term of rawTerms) {
      termFrequency.set(term, (termFrequency.get(term) ?? 0) + 1);
    }
    const fieldLength = rawTerms.length;
    fields.push({
      name: field.name,
      weight: field.weight,
      b: FIELD_B[field.name as keyof typeof FIELD_B] ?? 0.75,
      normalizedText: rawTerms.join(' '),
      termFrequency,
      length: fieldLength
    });
    length += fieldLength;
  }

  return {
    id: input.id,
    kind: input.kind,
    entityKind: input.entityKind,
    title: input.title,
    sourceIds: input.sourceIds,
    excerpt: input.excerpt,
    fields,
    length
  };
}

function tokenizeBm25Raw(value: string): string[] {
  const normalized = value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9@.\s/]+/g, ' ');
  return normalized
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part && !STOPWORDS.has(part) && !/^\d+$/.test(part));
}

function compactExcerpt(text: string): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  return singleLine.length <= 160 ? singleLine : `${singleLine.slice(0, 157)}...`;
}

function scoreToConfidence(score: number): 'low' | 'medium' | 'high' {
  if (score >= 12) return 'high';
  if (score >= 4) return 'medium';
  return 'low';
}
