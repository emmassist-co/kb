export interface KnowledgeBaseRemoteAuthConfig {
  token?: string;
}

export function resolveKnowledgeBaseRemoteAuth(
  env: Record<string, string | undefined>
): KnowledgeBaseRemoteAuthConfig {
  const token = readNonEmptyString(env.KB_API_TOKEN) ?? readNonEmptyString(env.KB_BEARER_TOKEN);
  return token ? { token } : {};
}

function readNonEmptyString(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}
