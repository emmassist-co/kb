import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function resolveKnowledgeBaseDashboardAssetsDir(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'client');
}
