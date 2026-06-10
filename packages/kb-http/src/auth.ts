import type {
  KnowledgeBaseAccessScope,
  KnowledgeBaseHttpAuthConfig,
  KnowledgeBaseHttpAuthResult,
  KnowledgeBaseHttpHeaders
} from './types.js';

export function authorizeKnowledgeBaseRequest(input: {
  auth?: KnowledgeBaseHttpAuthConfig;
  headers?: KnowledgeBaseHttpHeaders;
  requiredScopes: KnowledgeBaseAccessScope[];
}): KnowledgeBaseHttpAuthResult {
  const auth = input.auth;
  if (!auth || (auth.required !== true && auth.tokens.length === 0)) {
    return {
      ok: true,
      principal: null,
      scopes: []
    };
  }

  const header = readHeader(input.headers, 'authorization');
  if (!header) {
    return unauthorized(auth);
  }

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match?.[1]) {
    return unauthorized(auth);
  }

  const providedToken = match[1].trim();
  const principal = auth.tokens.find((entry) => entry.token === providedToken);
  if (!principal) {
    return unauthorized(auth);
  }

  const missingScopes = input.requiredScopes.filter((scope) => !principal.scopes.includes(scope));
  if (missingScopes.length > 0) {
    return {
      ok: false,
      status: 403,
      error: {
        code: 'forbidden',
        message: `Missing required scopes: ${missingScopes.join(', ')}`
      }
    };
  }

  return {
    ok: true,
    principal: principal.subject ?? null,
    scopes: principal.scopes
  };
}

function unauthorized(auth: KnowledgeBaseHttpAuthConfig): KnowledgeBaseHttpAuthResult {
  const realm = auth.challengeRealm?.trim() || 'kb';
  return {
    ok: false,
    status: 401,
    headers: {
      'WWW-Authenticate': `Bearer realm="${realm}"`
    },
    error: {
      code: 'unauthorized',
      message: 'Missing or invalid bearer token.'
    }
  };
}

function readHeader(headers: KnowledgeBaseHttpHeaders | undefined, key: string): string | undefined {
  if (!headers) return undefined;
  const direct = headers[key];
  if (typeof direct === 'string' && direct.trim() !== '') return direct;
  const lowerKey = key.toLowerCase();
  for (const [entryKey, entryValue] of Object.entries(headers)) {
    if (entryKey.toLowerCase() === lowerKey && typeof entryValue === 'string' && entryValue.trim() !== '') {
      return entryValue;
    }
  }
  return undefined;
}
