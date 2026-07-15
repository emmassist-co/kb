export interface DashboardConfig {
  apiBase: string;
  basePath: string;
  readOnly: boolean;
  token: string | null;
}

export interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  capabilities?: Record<string, unknown>;
  error?: { message?: string; code?: string };
}

export interface RecordSummary {
  id: string;
  title: string;
  kind: string;
}

export interface InspectData {
  tenantId?: string;
  backend?: string;
  canonical?: boolean;
  workspaceRole?: string;
  rootDir?: string;
  summary?: {
    mode: string;
    entities: RecordSummary[];
    sources: RecordSummary[];
    links: Array<{ type: string; count: number }>;
  };
}

export interface DocumentSnapshot {
  kind: 'entity' | 'source';
  id: string;
  markdown: string;
  parsed: { meta?: Record<string, unknown>; [key: string]: unknown };
  revision: string;
  validationIssues: string[];
}

export interface KnowledgeEvent {
  id?: string;
  summary?: string;
  createdAt?: string;
  entityIds?: string[];
  sourceIds?: string[];
}

export interface KnowledgeRelation {
  id?: string;
  type: string;
  fromId: string;
  toId: string;
  sourceIds?: string[];
  originKind?: string;
  originId?: string;
  confidence?: number;
  evidenceKind?: string;
  evidenceStrength?: string;
}

export async function loadConfig(): Promise<DashboardConfig> {
  const response = await fetch('/dashboard/config.json');
  if (!response.ok) throw new Error(`Dashboard config failed: ${response.status}`);
  return response.json() as Promise<DashboardConfig>;
}

export class KbApi {
  constructor(private readonly config: DashboardConfig) {}

  get readOnly(): boolean { return this.config.readOnly; }

  async inspect(): Promise<InspectData> {
    return this.get<InspectData>('/inspect');
  }

  async doctor(): Promise<unknown> {
    return this.get<unknown>('/doctor');
  }

  async events(): Promise<KnowledgeEvent[]> {
    return this.get<KnowledgeEvent[]>('/events');
  }

  async drafts(): Promise<unknown[]> {
    return this.get<unknown[]>('/drafts');
  }

  async relations(): Promise<KnowledgeRelation[]> {
    return this.get<KnowledgeRelation[]>('/relations');
  }

  async entityRelations(id: string): Promise<KnowledgeRelation[]> {
    return this.get<KnowledgeRelation[]>(`/entities/${encodeURIComponent(id)}/relations`);
  }

  async entityLinks(id: string): Promise<KnowledgeRelation[]> {
    return this.get<KnowledgeRelation[]>(`/entities/${encodeURIComponent(id)}/links`);
  }

  async entityRelated(id: string): Promise<unknown[]> {
    return this.get<unknown[]>(`/entities/${encodeURIComponent(id)}/related`);
  }

  async document(kind: 'entity' | 'source', id: string): Promise<DocumentSnapshot> {
    return this.get<DocumentSnapshot>(`/documents/${kind}/${encodeURIComponent(id)}`);
  }

  async saveDocument(kind: 'entity' | 'source', id: string, markdown: string, revision: string): Promise<DocumentSnapshot> {
    return this.put<DocumentSnapshot>(`/documents/${kind}/${encodeURIComponent(id)}`, { markdown, revision });
  }

  async relate(input: { type: string; fromId: string; toId: string; sourceIds?: string[]; confidence?: number }): Promise<unknown> {
    return this.post<unknown>('/relate', input);
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  private async put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: JSON.stringify(body) });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (init.body) headers['content-type'] = 'application/json';
    if (this.config.token) headers['x-kb-dashboard-token'] = this.config.token;
    const response = await fetch(`${this.config.apiBase}${path}`, { ...init, headers });
    const envelope = await response.json() as ApiEnvelope<T>;
    if (!response.ok || envelope.ok === false) {
      throw new Error(envelope.error?.message ?? `KB request failed: ${response.status}`);
    }
    if ('data' in envelope) return envelope.data as T;
    if ('capabilities' in envelope) return envelope.capabilities as T;
    return envelope as T;
  }
}
