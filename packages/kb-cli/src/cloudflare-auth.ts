import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';

export interface CachedWranglerAuth {
  expirationTime?: string;
  token: string;
}

export interface CloudflareR2TemporaryCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
}

export function loadCloudflareApiToken(
  env: Record<string, unknown>,
  options: { readCachedAuth?: () => CachedWranglerAuth } = {}
): string {
  const explicit = readNonEmptyString(env.CLOUDFLARE_API_TOKEN);
  if (explicit) return explicit;
  const cached = (options.readCachedAuth ?? readCachedWranglerAuth)();
  if (cached.expirationTime) {
    const expirationMs = Date.parse(cached.expirationTime);
    if (!Number.isNaN(expirationMs) && expirationMs <= Date.now()) {
      throw new Error(`Cached Wrangler OAuth token expired at ${cached.expirationTime}. Run 'npx wrangler login' again.`);
    }
  }
  return cached.token;
}

export function readCachedWranglerAuth(configPath = defaultWranglerConfigPath()): CachedWranglerAuth {
  return parseWranglerConfigAuth(readFileSync(configPath, 'utf8'));
}

export function parseWranglerConfigAuth(contents: string): CachedWranglerAuth {
  const tokenMatch = /^oauth_token\s*=\s*"([^"]+)"/m.exec(contents);
  if (!tokenMatch?.[1]) {
    throw new Error('Could not read oauth_token from Wrangler config.');
  }
  const expirationMatch = /^expiration_time\s*=\s*"([^"]+)"/m.exec(contents);
  return {
    token: tokenMatch[1],
    expirationTime: expirationMatch?.[1]
  };
}

export function resolveCloudflareAccountId(
  env: Record<string, unknown>,
  options: { whoamiJson?: () => string } = {}
): string {
  const explicit = readNonEmptyString(env.CLOUDFLARE_ACCOUNT_ID);
  if (explicit) return explicit;
  const output = (options.whoamiJson ?? runWranglerWhoamiJson)();
  return parseWranglerWhoamiAccountId(output);
}

export function parseWranglerWhoamiAccountId(contents: string): string {
  const parsed = JSON.parse(contents) as { accounts?: Array<{ id?: unknown }> };
  const accountId = parsed.accounts?.find((entry) => typeof entry.id === 'string' && entry.id.trim() !== '')?.id;
  if (!accountId || typeof accountId !== 'string') {
    throw new Error('Could not determine Cloudflare account id from `wrangler whoami --json`.');
  }
  return accountId;
}

export function parseCloudflareApiTokenId(contents: string): string {
  const parsed = JSON.parse(contents) as { success?: boolean; result?: { id?: unknown } };
  const tokenId = parsed.result?.id;
  if (parsed.success !== true || typeof tokenId !== 'string' || tokenId.trim() === '') {
    throw new Error('Could not determine Cloudflare API token id from token verification response.');
  }
  return tokenId;
}

export async function resolveCloudflareApiTokenId(
  env: Record<string, unknown>,
  options: { fetchImpl?: typeof fetch } = {}
): Promise<string> {
  const explicit = readNonEmptyString(env.CLOUDFLARE_API_TOKEN_ID);
  if (explicit) return explicit;
  const apiToken = loadCloudflareApiToken(env);
  const response = await (options.fetchImpl ?? fetch)('https://api.cloudflare.com/client/v4/user/tokens/verify', {
    headers: { Authorization: `Bearer ${apiToken}` }
  });
  if (!response.ok) {
    throw new Error(`Cloudflare token verification failed with ${response.status}.`);
  }
  return parseCloudflareApiTokenId(await response.text());
}

export async function mintCloudflareR2TemporaryCredentials(
  input: {
    accountId: string;
    bucket: string;
    prefix?: string;
    permission: 'object-read-only' | 'object-read-write' | 'admin-read-only' | 'admin-read-write';
    ttlSeconds?: number;
  },
  env: Record<string, unknown>,
  options: { fetchImpl?: typeof fetch } = {}
): Promise<CloudflareR2TemporaryCredentials> {
  const apiToken = loadCloudflareApiToken(env);
  const parentAccessKeyId = await resolveCloudflareApiTokenId(env, options);
  const response = await (options.fetchImpl ?? fetch)(
    `https://api.cloudflare.com/client/v4/accounts/${input.accountId}/r2/temp-access-credentials`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        bucket: input.bucket,
        parentAccessKeyId,
        permission: input.permission,
        ttlSeconds: input.ttlSeconds ?? 900,
        prefixes: input.prefix ? [input.prefix] : undefined
      })
    }
  );
  if (!response.ok) {
    throw new Error(`Cloudflare temporary credential mint failed with ${response.status}.`);
  }
  const parsed = JSON.parse(await response.text()) as {
    success?: boolean;
    result?: { accessKeyId?: unknown; secretAccessKey?: unknown; sessionToken?: unknown };
  };
  const accessKeyId = parsed.result?.accessKeyId;
  const secretAccessKey = parsed.result?.secretAccessKey;
  const sessionToken = parsed.result?.sessionToken;
  if (
    parsed.success !== true ||
    typeof accessKeyId !== 'string' ||
    typeof secretAccessKey !== 'string' ||
    typeof sessionToken !== 'string'
  ) {
    throw new Error('Cloudflare temporary credential response was missing required fields.');
  }
  return { accessKeyId, secretAccessKey, sessionToken };
}

function runWranglerWhoamiJson(): string {
  return execFileSync('npx', ['wrangler', 'whoami', '--json'], {
    encoding: 'utf8',
    env: process.env
  });
}

function defaultWranglerConfigPath(): string {
  return path.join(homedir(), 'Library', 'Preferences', '.wrangler', 'config', 'default.toml');
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}
