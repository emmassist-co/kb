import { getCloudflareContext } from '@flue/sdk/cloudflare';

export function hasCloudflareKnowledgeContext(): boolean {
  try {
    getCloudflareContext();
    return true;
  } catch {
    return false;
  }
}
