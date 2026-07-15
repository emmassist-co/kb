import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type {
  ContradictionEvalCase,
  EvalCorpus,
  EvalPage,
  EvalQuery,
  FuzzyEvalCase,
  IdentityEvalCase,
  ProvenanceEvalCase,
  TemporalEvalCase
} from './types.js';
import type { SeededKnowledgeBaseInput } from './shared.js';

interface RichWorldPage {
  slug: string;
  type: string;
  title: string;
  compiled_truth: string;
  timeline: string | string[];
  aliases?: string[];
  _facts?: {
    type?: string;
    founders?: string[];
    employees?: string[];
    investors?: string[];
    advisors?: string[];
    attendees?: string[];
    related_companies?: string[];
    related_people?: string[];
    secondary_affiliations?: string[];
    notable_traits?: string[];
  };
}

interface AdminWorldManifest {
  corpusName: string;
  provenance: 'deterministic-synthetic-fixtures';
  pages: EvalPage[];
  queries: EvalQuery[];
  coverage?: Record<string, number>;
  metadata?: EvalCorpus['metadata'];
}

export function loadFixtureCorpus(rootDir: string): EvalCorpus {
  const pages = JSON.parse(readFileSync(path.join(rootDir, 'pages.json'), 'utf8')) as EvalPage[];
  const queries = JSON.parse(readFileSync(path.join(rootDir, 'queries.json'), 'utf8')) as EvalQuery[];
  return {
    corpusName: path.basename(rootDir),
    provenance: 'deterministic-synthetic-fixtures',
    pages,
    queries
  };
}

export function loadGbrainWorldCorpus(
  rootDir: string,
  contract: 'github-benchmark' | 'corpus-linkable' = 'github-benchmark'
): EvalCorpus {
  const files = readdirSync(rootDir).filter(
    (entry) =>
      entry.endsWith('.json') &&
      !entry.startsWith('_') &&
      entry !== 'calibration.json' &&
      entry !== 'canonical-relational-queries.json' &&
      entry !== 'tier5-fuzzy-queries.json' &&
      entry !== 'tier5_5-synthetic-queries.json'
  );
  const rawPages = files.map((fileName) => JSON.parse(readFileSync(path.join(rootDir, fileName), 'utf8')) as RichWorldPage);
  const existing = new Set(rawPages.map((page) => page.slug));
  const pages = rawPages.map((page) => ({
    id: normalizeSlug(page.slug),
    type: page.type,
    title: page.title,
    compiledTruth: String(page.compiled_truth ?? ''),
    timeline: Array.isArray(page.timeline) ? page.timeline.join('\n') : String(page.timeline ?? ''),
    aliases: page.aliases ?? [],
    relations: page._facts ? buildGbrainRelations(page, existing) : []
  }));
  const queries = contract === 'github-benchmark'
    ? buildGithubBenchmarkQueries(rawPages)
    : buildCorpusLinkableQueries(rawPages);
  return {
    corpusName: `gbrain-world-v1:${contract}:${rootDir}`,
    provenance: 'upstream-fictional-benchmark',
    pages,
    queries,
    metadata: {
      benchmarkTier: 'external-reference',
      benchmarkContractId: contract,
      benchmarkContractLabel:
        contract === 'github-benchmark'
          ? 'Exact GBrain GitHub benchmark contract'
          : 'All linkable vendored world-v1 relations',
      benchmarkFamilies: [...new Set(queries.map((query) => query.family ?? 'unknown'))],
      corpusSize: pages.length,
      queryCount: queries.length,
      familyCounts: Object.fromEntries(
        queries.reduce((map, query) => {
          const family = query.family ?? 'unknown';
          map.set(family, (map.get(family) ?? 0) + 1);
          return map;
        }, new Map<string, number>())
      )
    }
  };
}

export function loadRelationParaphraseCorpus(rootDir: string): EvalCorpus {
  return loadRelationGuardrailCorpus(rootDir, 'relation-paraphrase.json');
}

export function loadRelationTransferCorpus(rootDir: string): EvalCorpus {
  return loadRelationGuardrailCorpus(rootDir, 'relation-transfer.json');
}

function loadRelationGuardrailCorpus(rootDir: string, manifestFile: string): EvalCorpus {
  const raw = JSON.parse(readFileSync(path.join(rootDir, manifestFile), 'utf8')) as AdminWorldManifest;
  const familyCounts = Object.fromEntries(
    raw.queries.reduce((map, query) => {
      const family = query.family ?? 'unknown';
      map.set(family, (map.get(family) ?? 0) + 1);
      return map;
    }, new Map<string, number>())
  );
  const ambiguityRate = raw.queries.length
    ? raw.queries.filter((query) => query.intentionallyAmbiguous).length / raw.queries.length
    : 0;
  const wrongTypeDistractorRate = raw.queries.length
    ? raw.queries.filter((query) => (query.distractorGroups?.wrongType?.length ?? 0) > 0).length / raw.queries.length
    : 0;
  return {
    corpusName: raw.corpusName,
    provenance: raw.provenance,
    pages: raw.pages,
    queries: raw.queries,
    metadata: {
      ...raw.metadata,
      benchmarkTier: raw.metadata?.benchmarkTier ?? 'regression-guardrail',
      familyCounts,
      benchmarkFamilies: [...new Set(raw.queries.map((query) => query.family ?? 'unknown'))],
      corpusSize: raw.pages.length,
      queryCount: raw.queries.length,
      ambiguityRate,
      wrongTypeDistractorRate,
      coverage: raw.coverage ?? raw.metadata?.coverage
    }
  };
}

export function loadAdminWorldCorpus(rootDir: string, split: 'all' | 'dev' | 'holdout' = 'all'): EvalCorpus {
  const manifestPath = path.join(rootDir, 'admin-world.json');
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as AdminWorldManifest;
  const queries = split === 'all' ? raw.queries : raw.queries.filter((query) => query.split === split);
  const familyCounts = Object.fromEntries(
    queries.reduce((map, query) => {
      const family = query.family ?? 'unknown';
      map.set(family, (map.get(family) ?? 0) + 1);
      return map;
    }, new Map<string, number>())
  );
  const ambiguityRate = queries.length
    ? queries.filter((query) => query.intentionallyAmbiguous).length / queries.length
    : 0;
  const temporalCaseRate = queries.length
    ? queries.filter((query) => query.requiresTimeline).length / queries.length
    : 0;
  const distractorCaseRate = queries.length
    ? queries.filter((query) => (query.distractorIds?.length ?? 0) > 0).length / queries.length
    : 0;
  const aliasQueryRate = queries.length
    ? queries.filter((query) => query.usesAlias).length / queries.length
    : 0;
  const indirectPhrasingRate = queries.length
    ? queries.filter((query) => query.indirectPhrasing).length / queries.length
    : 0;
  const wrongTypeDistractorRate = queries.length
    ? queries.filter((query) => (query.distractorGroups?.wrongType?.length ?? 0) > 0).length / queries.length
    : 0;
  const distractorDensity = queries.length
    ? queries.reduce((sum, query) => sum + (query.distractorIds?.length ?? 0), 0) / queries.length
    : 0;
  return {
    corpusName: raw.corpusName,
    provenance: raw.provenance,
    pages: raw.pages,
    queries,
    metadata: {
      ...raw.metadata,
      benchmarkTier: raw.metadata?.benchmarkTier ?? 'product-core',
      split,
      familyCounts,
      ambiguityRate,
      temporalCaseRate,
      distractorCaseRate,
      aliasQueryRate,
      indirectPhrasingRate,
      wrongTypeDistractorRate,
      distractorDensity,
      coverage: raw.coverage ?? raw.metadata?.coverage
    }
  };
}

export function loadCoreSixFixtures(rootDir: string): {
  corpusName: string;
  corpusProvenance: 'deterministic-synthetic-fixtures';
  seed: SeededKnowledgeBaseInput;
  temporal: TemporalEvalCase[];
  identity: IdentityEvalCase[];
  provenanceCases: ProvenanceEvalCase[];
  contradictions: ContradictionEvalCase[];
  fuzzy: FuzzyEvalCase[];
} {
  const manifestPath = path.join(rootDir, 'core-six.json');
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    corpusName: string;
    seed: SeededKnowledgeBaseInput;
    temporal: TemporalEvalCase[];
    identity: IdentityEvalCase[];
    provenance: ProvenanceEvalCase[];
    contradictions: ContradictionEvalCase[];
    fuzzy: FuzzyEvalCase[];
    extends?: string;
    pick?: {
      temporal?: string[];
      identity?: string[];
      provenance?: string[];
      contradictions?: string[];
      fuzzy?: string[];
    };
  };
  if (!raw.extends) {
    return {
      corpusName: raw.corpusName,
      corpusProvenance: 'deterministic-synthetic-fixtures',
      seed: raw.seed,
      temporal: raw.temporal,
      identity: raw.identity,
      provenanceCases: raw.provenance,
      contradictions: raw.contradictions,
      fuzzy: raw.fuzzy
    };
  }
  const basePath = path.resolve(rootDir, raw.extends);
  const base = JSON.parse(readFileSync(basePath, 'utf8')) as typeof raw;
  return {
    corpusName: raw.corpusName,
    corpusProvenance: 'deterministic-synthetic-fixtures',
    seed: base.seed,
    temporal: pickCases(base.temporal, raw.pick?.temporal),
    identity: pickCases(base.identity, raw.pick?.identity),
    provenanceCases: pickCases(base.provenance, raw.pick?.provenance),
    contradictions: pickCases(base.contradictions, raw.pick?.contradictions),
    fuzzy: pickCases(base.fuzzy, raw.pick?.fuzzy)
  };
}

export function loadRepoDocsCorpus(manifestDir: string, docsRoot = path.resolve(process.cwd(), 'docs')): EvalCorpus {
  const queries = JSON.parse(readFileSync(path.join(manifestDir, 'queries.json'), 'utf8')) as EvalQuery[];
  const pages = JSON.parse(readFileSync(path.join(manifestDir, 'pages.json'), 'utf8')) as Array<{
    id: string;
    path: string;
    type: string;
    tags?: string[];
    aliases?: string[];
    handles?: string[];
  }>;
  return {
    corpusName: `repo-docs-v1:${docsRoot}`,
    provenance: 'first-party-repo-docs',
    pages: pages.map((page) => {
      const filePath = path.resolve(process.cwd(), page.path);
      const raw = readFileSync(filePath, 'utf8');
      const lines = raw.split('\n');
      const titleLine = lines.find((line) => /^#\s+/.test(line)) ?? `# ${page.id}`;
      const title = titleLine.replace(/^#\s+/, '').trim();
      return {
        id: page.id,
        type: page.type,
        title,
        compiledTruth: raw,
        timeline: '',
        tags: page.tags ?? [],
        aliases: page.aliases ?? [],
        handles: page.handles ?? []
      };
    }),
    queries
  };
}

function buildGithubBenchmarkQueries(pages: RichWorldPage[]): EvalQuery[] {
  const existing = new Set(pages.map((page) => page.slug));
  const queries: EvalQuery[] = [];

  for (const page of pages) {
    const facts = page._facts;
    if (!facts) continue;

    if (facts.attendees?.length) {
      const relevant = facts.attendees.filter((slug) => existing.has(slug)).map(normalizeSlug);
      if (relevant.length > 0) {
        queries.push({
          id: `attendees:${normalizeSlug(page.slug)}`,
          text: `Who attended ${page.title}?`,
          relevant,
          relationType: 'attends',
          anchorId: normalizeSlug(page.slug),
          family: 'attended'
        });
      }
    }

    if (facts.type === 'company') {
      const employees = [...new Set([...(facts.employees ?? []), ...(facts.founders ?? [])])]
        .filter((slug) => existing.has(slug))
        .map(normalizeSlug);
      if (employees.length > 0) {
        queries.push({
          id: `employees:${normalizeSlug(page.slug)}`,
          text: `Who works at ${page.title}?`,
          relevant: employees,
          relationType: 'member_of',
          anchorId: normalizeSlug(page.slug),
          family: 'works_at'
        });
      }

      const investors = (facts.investors ?? []).filter((slug) => existing.has(slug)).map(normalizeSlug);
      if (investors.length > 0) {
        queries.push({
          id: `investors:${normalizeSlug(page.slug)}`,
          text: `Who invested in ${page.title}?`,
          relevant: investors,
          relationType: 'invested_in',
          anchorId: normalizeSlug(page.slug),
          family: 'invested_in'
        });
      }

      const advisors = (facts.advisors ?? []).filter((slug) => existing.has(slug)).map(normalizeSlug);
      if (advisors.length > 0) {
        queries.push({
          id: `advisors:${normalizeSlug(page.slug)}`,
          text: `Who advises ${page.title}?`,
          relevant: advisors,
          relationType: 'advises',
          anchorId: normalizeSlug(page.slug),
          family: 'advises'
        });
      }
    }
  }

  return queries;
}

function buildCorpusLinkableQueries(pages: RichWorldPage[]): EvalQuery[] {
  const existing = new Set(pages.map((page) => page.slug));
  const queries = buildGithubBenchmarkQueries(pages);

  for (const page of pages) {
    const facts = page._facts;
    if (!facts) continue;

    const relatedCompanies = (facts.related_companies ?? []).filter((slug) => existing.has(slug)).map(normalizeSlug);
    if (relatedCompanies.length > 0) {
      queries.push({
        id: `related-companies:${normalizeSlug(page.slug)}`,
        text: `Which companies are related to ${page.title}?`,
        relevant: relatedCompanies,
        relationType: 'related_to_company',
        anchorId: normalizeSlug(page.slug),
        family: 'related_companies'
      });
    }

    const relatedPeople = (facts.related_people ?? []).filter((slug) => existing.has(slug)).map(normalizeSlug);
    if (relatedPeople.length > 0) {
      queries.push({
        id: `related-people:${normalizeSlug(page.slug)}`,
        text: `Which people are related to ${page.title}?`,
        relevant: relatedPeople,
        relationType: 'related_to_person',
        anchorId: normalizeSlug(page.slug),
        family: 'related_people'
      });
    }

    const secondaryAffiliations = (facts.secondary_affiliations ?? []).filter((slug) => existing.has(slug)).map(normalizeSlug);
    if (secondaryAffiliations.length > 0) {
      queries.push({
        id: `secondary-affiliations:${normalizeSlug(page.slug)}`,
        text: `What secondary affiliations does ${page.title} have?`,
        relevant: secondaryAffiliations,
        relationType: 'secondary_affiliation',
        anchorId: normalizeSlug(page.slug),
        family: 'secondary_affiliations'
      });
    }
  }

  return queries;
}

export function normalizeSlug(slug: string): string {
  return slug.replace(/\//g, '__');
}

function buildGbrainRelations(page: RichWorldPage, existing: Set<string>): EvalPage['relations'] {
  const facts = page._facts;
  if (!facts) return [];
  const relations: EvalPage['relations'] = [];
  if (facts.attendees?.length) {
    relations.push({ type: 'attends', targets: facts.attendees.filter((slug) => existing.has(slug)).map(normalizeSlug) });
  }
  if (facts.type === 'company') {
    const employees = [...new Set([...(facts.employees ?? []), ...(facts.founders ?? [])])]
      .filter((slug) => existing.has(slug))
      .map(normalizeSlug);
    if (employees.length) relations.push({ type: 'member_of', targets: employees });
    const investors = (facts.investors ?? []).filter((slug) => existing.has(slug)).map(normalizeSlug);
    if (investors.length) relations.push({ type: 'invested_in', targets: investors });
    const advisors = (facts.advisors ?? []).filter((slug) => existing.has(slug)).map(normalizeSlug);
    if (advisors.length) relations.push({ type: 'advises', targets: advisors });
  }
  const relatedCompanies = (facts.related_companies ?? []).filter((slug) => existing.has(slug)).map(normalizeSlug);
  if (relatedCompanies.length) relations.push({ type: 'related_to_company', targets: relatedCompanies });
  const relatedPeople = (facts.related_people ?? []).filter((slug) => existing.has(slug)).map(normalizeSlug);
  if (relatedPeople.length) relations.push({ type: 'related_to_person', targets: relatedPeople });
  const secondaryAffiliations = (facts.secondary_affiliations ?? []).filter((slug) => existing.has(slug)).map(normalizeSlug);
  if (secondaryAffiliations.length) relations.push({ type: 'secondary_affiliation', targets: secondaryAffiliations });
  return relations;
}

function pickCases<T extends { id: string }>(cases: T[], ids?: string[]): T[] {
  if (!ids?.length) return [];
  const wanted = new Set(ids);
  return cases.filter((entry) => wanted.has(entry.id));
}
