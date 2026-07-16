import type { DocumentSnapshot, InspectData, KnowledgeEvent, KnowledgeRelation, RecordSummary } from './api';

export type DashboardTab = 'overview' | 'records' | 'graph' | 'recents';

export interface SelectedRecord extends RecordSummary {
  recordKind: 'entity' | 'source';
}

export interface DashboardState {
  tab: DashboardTab;
  inspect: InspectData | null;
  doctor: unknown | null;
  events: KnowledgeEvent[];
  relations: KnowledgeRelation[];
  selected: SelectedRecord | null;
  document: DocumentSnapshot | null;
  selectedRelations: KnowledgeRelation[];
  selectedLinks: KnowledgeRelation[];
  selectedRelated: unknown[];
  graphPreviewDocument: DocumentSnapshot | null;
  graphPreviewRelations: KnowledgeRelation[];
  draftMarkdown: string;
  recordSearch: string;
  recordVisibleCount: number;
  status: string;
  error: string | null;
}

export function initialState(): DashboardState {
  return {
    tab: 'overview',
    inspect: null,
    doctor: null,
    events: [],
    relations: [],
    selected: null,
    document: null,
    selectedRelations: [],
    selectedLinks: [],
    selectedRelated: [],
    graphPreviewDocument: null,
    graphPreviewRelations: [],
    draftMarkdown: '',
    recordSearch: '',
    recordVisibleCount: 50,
    status: 'Loading KB…',
    error: null
  };
}
