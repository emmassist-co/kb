export type Tier =
  | 'easy'
  | 'medium'
  | 'hard'
  | 'adversarial'
  | 'fuzzy'
  | 'externally-authored';

export type ExpectedOutputType =
  | 'answer-string'
  | 'canonical-entity-id'
  | 'cited-source-pages'
  | 'time-qualified-answer'
  | 'abstention'
  | 'contradiction-explanation'
  | 'poison-flag'
  | 'confidence-score';

export interface Page {
  slug: string;
  type:
    | 'person'
    | 'company'
    | 'meeting'
    | 'concept'
    | 'deal'
    | 'project'
    | 'source'
    | 'media'
    | 'email'
    | 'slack'
    | 'calendar-event'
    | 'note';
  title: string;
  compiled_truth: string;
  timeline: string;
}

export type PublicPage = Pick<Page, 'slug' | 'type' | 'title' | 'compiled_truth' | 'timeline'>;

export interface Gold {
  relevant?: string[];
  grades?: Record<string, number>;
  expected_answer?: string;
  expected_entity_id?: string;
  expected_citations?: string[];
  expected_abstention?: boolean;
  expected_as_of?: string;
  [key: string]: unknown;
}

export interface Query {
  id: string;
  tier: Tier;
  text: string;
  expected_output_type: ExpectedOutputType;
  gold: Gold;
  as_of_date?: string | 'corpus-end' | 'per-source';
  acceptable_variants?: string[];
  known_failure_modes?: string[];
  author?: string;
  tags?: string[];
}

export type PublicQuery = Omit<Query, 'gold'>;

export interface RankedDoc {
  page_id: string;
  score: number;
  rank: number;
  snippet?: string;
}

export interface AdapterConfig {
  name: string;
  k?: number;
  [key: string]: unknown;
}

export type BrainState = unknown;

export interface Adapter {
  readonly name: string;
  init(rawPages: PublicPage[], config: AdapterConfig): Promise<BrainState>;
  query(q: PublicQuery, state: BrainState): Promise<RankedDoc[]>;
  snapshot?(state: BrainState): Promise<string>;
  teardown?(state: BrainState): Promise<void>;
}

export function sanitizePage(p: Page): PublicPage {
  return {
    slug: p.slug,
    type: p.type,
    title: p.title,
    compiled_truth: p.compiled_truth,
    timeline: p.timeline
  };
}

export function sanitizeQuery(q: Query): PublicQuery {
  const out: PublicQuery = {
    id: q.id,
    tier: q.tier,
    text: q.text,
    expected_output_type: q.expected_output_type
  };
  if (q.as_of_date !== undefined) out.as_of_date = q.as_of_date;
  if (q.acceptable_variants !== undefined) out.acceptable_variants = q.acceptable_variants;
  if (q.known_failure_modes !== undefined) out.known_failure_modes = q.known_failure_modes;
  if (q.author !== undefined) out.author = q.author;
  if (q.tags !== undefined) out.tags = q.tags;
  return out;
}
