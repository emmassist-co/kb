import type {
  EntityDocument,
  KnowledgeEvent,
  KnowledgeLink,
  KnowledgeMutationResult,
  SourceDocument
} from '@emmassist-co/kb-core';
import type { SemanticMutationCommand, SemanticMutationPlan } from './compile.js';

export interface SemanticMutationExecutor {
  record(input: SemanticMutationCommand & { kind: 'record' }['payload']): Promise<KnowledgeMutationResult>;
  recordSource(input: SemanticMutationCommand & { kind: 'record-source' }['payload']): Promise<KnowledgeMutationResult>;
  annotate(input: SemanticMutationCommand & { kind: 'annotate' }['payload']): Promise<KnowledgeMutationResult>;
}

export async function applySemanticMutationPlan(
  executor: SemanticMutationExecutor,
  plan: SemanticMutationPlan
): Promise<KnowledgeMutationResult> {
  if (!plan.ok) {
    throw new Error(plan.message);
  }

  const results: KnowledgeMutationResult[] = [];
  for (const command of plan.commands) {
    if (command.kind === 'record') {
      results.push(await executor.record(command.payload));
      continue;
    }
    if (command.kind === 'record-source') {
      results.push(await executor.recordSource(command.payload));
      continue;
    }
    results.push(await executor.annotate(command.payload));
  }
  return mergeMutationResults(results);
}

function mergeMutationResults(results: KnowledgeMutationResult[]): KnowledgeMutationResult {
  const entities = new Map<string, EntityDocument>();
  const sources = new Map<string, SourceDocument>();
  const events = new Map<string, KnowledgeEvent>();
  const links = new Map<string, KnowledgeLink>();
  const entityIds = new Set<string>();
  const sourceIds = new Set<string>();
  const eventIds = new Set<string>();
  const warnings = new Set<string>();

  for (const result of results) {
    for (const entityId of result.entityIds) entityIds.add(entityId);
    for (const sourceId of result.sourceIds) sourceIds.add(sourceId);
    for (const eventId of result.eventIds) eventIds.add(eventId);
    for (const warning of result.warnings) warnings.add(warning);
    for (const entity of result.hydrated.entities) entities.set(entity.meta.id, entity);
    for (const source of result.hydrated.sources) sources.set(source.meta.id, source);
    for (const event of result.hydrated.events) events.set(event.id, event);
    for (const link of result.hydrated.links) links.set(link.id, link);
  }

  return {
    mutated: true,
    entityIds: [...entityIds],
    sourceIds: [...sourceIds],
    eventIds: [...eventIds],
    warnings: [...warnings],
    hydrated: {
      entities: [...entities.values()],
      sources: [...sources.values()],
      events: [...events.values()],
      links: [...links.values()]
    }
  };
}
