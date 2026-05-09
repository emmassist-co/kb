import { runKnowledgeBaseCli } from './index.js';

export async function runKnowledgeBaseCliMain(argv: string[], options: Parameters<typeof runKnowledgeBaseCli>[1] = {}) {
  return runKnowledgeBaseCli(argv, options);
}
