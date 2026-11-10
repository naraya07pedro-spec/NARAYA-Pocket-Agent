/**
 * Signed OIDC identity boundary used by read-only probe and owner-scoped sync.
 * Configured JWKS URL is operator-controlled, never derived from a token or request.
 */
export class AuthRejected extends Error {}
export class AuthUnavailable extends Error {}

export interface OidcSettings {
  OIDC_ISSUER?: string;
  OIDC_AUDIENCE?: string;
  OIDC_JWKS_URL?: string;
}

type Fetcher = typeof fetch;
type JsonObject = Record<string, unknown>;
const UTF8 = new TextDecoder('utf-8', { fatal: true });
const RSA_SHA256 = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;

// Cache *public signing keys only*. Tokens, claims and subjects are never cached.
// Isolate each fetcher: synthetic tests cannot poison another fetcher's key set.
// Cloudflare Worker isolates may evict module state at any time, so caching is
// opportunistic and must never be required for successful verification.
const MAX_JWKS_CACHE_ENTRIES = 4;
const MAX_JWKS_CACHE_MS = 300_000;
interface JwksEntry {
  value?: JsonObject;
  expiresAt: number;
  pending?: Promise<JsonObject>;
}
const jwksByFetcher = new WeakMap<Fetcher, Map<string, JwksEntry>>();

function cacheTtlMs(headers: Headers): number {
  const directives = (headers.get('cache-control') ?? '')
    .split(',').map(part => part.trim().toLowerCase());
  if (!directives.includes('public') ||
      directives.some(value => value === 'private' || value === 'no-store' || value === 'no-cache')) return 0;
  const ages = directives.filter(value => /^max-age=\d+$/.test(value));
  if (ages.length !== 1) return 0;
  const seconds = Number(ages[0].slice(8));
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return 0;
  return Math.min(seconds * 1000, MAX_JWKS_CACHE_MS);
}


function object(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function decoded(segment: string, maximum: number): Uint8Array {
  if (!segment || segment.length > maximum || !/^[A-Za-z0-9_-]+$/.test(segment)) throw new AuthRejected();
  try {
    const padded = segment.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - segment.length % 4) % 4);
    return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
  } catch {
    throw new AuthRejected();
  }
}

function claims(segment: string, maximum: number): JsonObject {
  try {
    const value: unknown = JSON.parse(UTF8.decode(decoded(segment, maximum)));
    if (!object(value)) throw new AuthRejected();
    return value;
  } catch { throw new AuthRejected(); }
}

function config(settings: OidcSettings): { issuer: string; audience: string; jwks: string } {
  const issuer = settings.OIDC_ISSUER, audience = settings.OIDC_AUDIENCE, jwks = settings.OIDC_JWKS_URL;
  if (!issuer || !audience || !jwks || issuer.length > 200 || audience.length > 200) throw new AuthUnavailable();
  try {
    const issuerUrl = new URL(issuer), keysUrl = new URL(jwks);
    for (const url of [issuerUrl, keysUrl]) {
      if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash ||
          url.port || url.search) throw new AuthUnavailable();
    }
    if (issuerUrl.toString().replace(/\/$/, '') !== issuer.replace(/\/$/, '') || keysUrl.toString() !== jwks) throw new AuthUnavailable();
  } catch { throw new AuthUnavailable(); }
  return { issuer, audience, jwks };
}

async function boundedJwks(url: string, fetcher: Fetcher): Promise<{ keys: JsonObject; ttlMs: number }> {
  let response: Response;
  try {
    response = await fetcher(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(3000) });
  } catch { throw new AuthUnavailable(); }
  if (!response.ok || !response.body) throw new AuthUnavailable();
  const length = Number(response.headers.get('content-length') ?? 0);
  if (!Number.isFinite(length) || length < 0 || length > 65536) throw new AuthUnavailable();
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > 65536) { await reader.cancel(); throw new AuthUnavailable(); }
      parts.push(chunk.value);
    }
  } catch { throw new AuthUnavailable(); }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  try {
    const value: unknown = JSON.parse(UTF8.decode(bytes));
    if (!object(value) || !Array.isArray(value.keys) || value.keys.length > 32) throw new AuthUnavailable();
    return { keys: value, ttlMs: cacheTtlMs(response.headers) };
  } catch { throw new AuthUnavailable(); }
}

async function cachedJwks(url: string, fetcher: Fetcher, nowMs: number): Promise<JsonObject> {
  let entries = jwksByFetcher.get(fetcher);
  if (!entries) {
    entries = new Map<string, JwksEntry>();
    jwksByFetcher.set(fetcher, entries);
  }
  const existing = entries.get(url);
  if (existing?.pending) return existing.pending; // At most one concurrent upstream key fetch per isolate.
  if (existing?.value && nowMs < existing.expiresAt) return existing.value;

  entries.delete(url); // Expired sets are never accepted on provider failure.
  if (entries.size >= MAX_JWKS_CACHE_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest !== undefined) entries.delete(oldest);
  }
  const entry: JwksEntry = { expiresAt: 0 };
  entries.set(url, entry);
  entry.pending = boundedJwks(url, fetcher).then(({ keys, ttlMs }) => {
    if (entries?.get(url) === entry) {
      if (ttlMs > 0) {
        entry.value = keys;
        entry.expiresAt = nowMs + ttlMs;
        entry.pending = undefined;
      } else entries.delete(url);
    }
    return keys;
  }).catch((error: unknown) => {
    if (entries?.get(url) === entry) entries.delete(url);
    throw error; // Fail closed; never return stale/unvalidated keys.
  });
  return entry.pending;
}

export async function verifyOidcBearer(
  request: Request,
  settings: OidcSettings,
  fetcher: Fetcher = fetch,
  nowMs = Date.now(),
): Promise<{ issuer: string; subject: string }> {
  // Invalid/missing bearer is rejected before JWKS network activity.
  const authorization = request.headers.get('authorization') ?? '';
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(authorization);
  if (!match || authorization.length > 8192) throw new AuthRejected();
  const pieces = match[1].split('.');
  const header = claims(pieces[0], 2048);
  const payload = claims(pieces[1], 4096);
  const signature = decoded(pieces[2], 1024);
  if (header.alg !== 'RS256' || (header.typ !== undefined && header.typ !== 'JWT') ||
      typeof header.kid !== 'string' || !header.kid || header.kid.length > 128 ||
      header.jku !== undefined || header.jwk !== undefined || header.x5u !== undefined ||
      header.crit !== undefined) throw new AuthRejected();

  const { issuer, audience, jwks } = config(settings);
  const now = Math.floor(nowMs / 1000);
  if (payload.iss !== issuer || payload.aud !== audience ||
      typeof payload.sub !== 'string' || !payload.sub.trim() || payload.sub.length > 255 ||
      typeof payload.exp !== 'number' || !Number.isSafeInteger(payload.exp) || payload.exp <= now ||
      typeof payload.iat !== 'number' || !Number.isSafeInteger(payload.iat) || payload.iat > now + 60 ||
      payload.exp <= payload.iat || payload.exp - payload.iat > 86400 ||
      (payload.nbf !== undefined && (typeof payload.nbf !== 'number' || !Number.isSafeInteger(payload.nbf) || payload.nbf > now + 60)) ||
      (payload.azp !== undefined && payload.azp !== audience)) throw new AuthRejected();

  const jwkSet = await cachedJwks(jwks, fetcher, nowMs);
  const candidates = (jwkSet.keys as unknown[]).filter((key): key is JsonObject =>
    object(key) && key.kid === header.kid && key.kty === 'RSA' &&
    (key.use === undefined || key.use === 'sig') &&
    (key.alg === undefined || key.alg === 'RS256') &&
    (key.key_ops === undefined || (Array.isArray(key.key_ops) && key.key_ops.includes('verify'))) &&
    typeof key.n === 'string' && /^[A-Za-z0-9_-]{300,1024}$/.test(key.n) &&
    typeof key.e === 'string' && /^[A-Za-z0-9_-]{2,12}$/.test(key.e));
  if (candidates.length !== 1) throw new AuthRejected();
  let publicKey: CryptoKey;
  try {
    publicKey = await crypto.subtle.importKey('jwk', candidates[0] as JsonWebKey, RSA_SHA256, false, ['verify']);
  } catch { throw new AuthRejected(); }
  const valid = await crypto.subtle.verify(RSA_SHA256, publicKey, signature, new TextEncoder().encode(pieces[0] + '.' + pieces[1]));
  if (!valid) throw new AuthRejected();
  return { issuer, subject: payload.sub as string };
}
