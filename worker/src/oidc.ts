/**
 * Signed OIDC identity boundary for owner-scoped mobile synchronization.
 * Configured JWKS URL is operator-controlled, never derived from a token or request.
 */
export class AuthRejected extends Error {}
export class AuthUnavailable extends Error {}

export interface OidcSettings {
  OIDC_ISSUER?: string;
  OIDC_AUDIENCE?: string;
  OIDC_JWKS_URL?: string;
  // Optional comma-delimited allowlist of additional OAuth clients authorized
  // to present a token with the exact configured backend audience.
  OIDC_AUTHORIZED_PRESENTERS?: string;
}

type Fetcher = typeof fetch;
type JsonObject = Record<string, unknown>;
const UTF8 = new TextDecoder('utf-8', { fatal: true });
const RSA_SHA256 = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;
// Google OIDC issuer-key binding, verified against Google's Discovery metadata.
// A caller/operator must never turn a Google issuer into trust in another JWKS host.
const GOOGLE_ISSUER = 'https://accounts.google.com';
const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';

// A Cache API adapter is injected by tests or read from the Worker runtime per
// request. Never put a request's Promise, bearer token or identity in module scope.
export interface PublicJwksCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}
const MAX_JWKS_CACHE_MS = 300_000;
async function defaultJwksCache(): Promise<PublicJwksCache | undefined> {
  // A dedicated namespace avoids collisions with regular fetch/CDN caching.
  // Discover it per invocation; never share a request-bound promise globally.
  try {
    const runtime = globalThis as unknown as {
      caches?: { open?: (namespace: string) => Promise<PublicJwksCache> };
    };
    return await runtime.caches?.open?.('naraya-pocket-agent-public-jwks-v1');
  } catch { return undefined; }
}

function ttlMs(headers: Headers): number {
  const directives = (headers.get('cache-control') ?? '')
    .split(',').map(value => value.trim().toLowerCase());
  if (!directives.includes('public') ||
      directives.some(value => value === 'no-cache' || value === 'no-store' || value === 'private')) return 0;
  const ages = directives.filter(value => /^max-age=\d+$/.test(value));
  if (ages.length !== 1) return 0;
  const seconds = Number(ages[0].slice(8));
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return 0;
  return Math.min(MAX_JWKS_CACHE_MS, seconds * 1000);
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

function config(settings: OidcSettings): {
  issuer: string; audience: string; jwks: string; authorizedPresenters: ReadonlySet<string>
} {
  const issuer = settings.OIDC_ISSUER, audience = settings.OIDC_AUDIENCE, jwks = settings.OIDC_JWKS_URL;
  // Preserve generic OIDC audience support (some client IDs are URIs).
  // The new restricted syntax applies ONLY to additional authorized parties.
  if (!issuer || !audience || !jwks || issuer.length > 200 || audience.length > 200) throw new AuthUnavailable();
  const configured = settings.OIDC_AUTHORIZED_PRESENTERS;
  if (configured !== undefined &&
      (typeof configured !== 'string' || configured.length > 600)) throw new AuthUnavailable();
  const values = configured ? configured.split(',') : [];
  // Never accept wildcard, duplicate, whitespace, empty entry, or unbounded
  // presenters. Explicit operator-approved clients ONLY. An empty config keeps
  // the prior fail-closed azp == aud behavior by default.
  if (values.length > 3 ||
      values.some(value=>!value || value===audience ||
        !/^[A-Za-z0-9._:-]{1,200}$/.test(value)) ||
      new Set(values).size !== values.length) throw new AuthUnavailable();
  const authorizedPresenters: ReadonlySet<string> = new Set([audience,...values]);
  try {
    const issuerUrl = new URL(issuer), keysUrl = new URL(jwks);
    for (const url of [issuerUrl, keysUrl]) {
      if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash ||
          url.port || url.search) throw new AuthUnavailable();
    }
    if (issuerUrl.toString().replace(/\/$/, '') !== issuer.replace(/\/$/, '') || keysUrl.toString() !== jwks) throw new AuthUnavailable();
    // Trust the signer as well as the signature. A JWT can claim Google `iss`
    // while carrying a perfectly valid signature from an attacker's JWKS.
    // Only the Google-published JWKS endpoint can authenticate Google `sub`.
    if (issuer === GOOGLE_ISSUER && jwks !== GOOGLE_JWKS) throw new AuthUnavailable();
  } catch { throw new AuthUnavailable(); }
  return { issuer, audience, jwks, authorizedPresenters };
}

async function boundedJwks(url: string, fetcher: Fetcher): Promise<{ keys: JsonObject; bytes: Uint8Array; maxAgeMs: number }> {
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
    return { keys: value, bytes, maxAgeMs: ttlMs(response.headers) };
  } catch { throw new AuthUnavailable(); }
}

async function getPublicJwks(
  url: string, fetcher: Fetcher, nowMs: number, cache?: PublicJwksCache,
): Promise<JsonObject> {
  const key = new Request(url); // Canonical, operator-configured HTTPS JWKS URL.
  if (cache) {
    let cached: Response | undefined;
    try { cached = await cache.match(key); } catch { cached = undefined; }
    if (cached) {
      const until = Number(cached.headers.get('x-naraya-key-valid-until'));
      if (Number.isSafeInteger(until) && until > nowMs && until - nowMs <= MAX_JWKS_CACHE_MS) {
        try {
          // Cached bytes remain untrusted input: bounds, UTF-8 and key-set
          // shape are validated on every read. Signature is checked below.
          return (await parseCachedJwks(cached)).keys;
        } catch {
          // Corrupt/invalid cache is never authoritative. Fetch a fresh
          // validated provider response instead, without stale fallback.
        }
      }
    }
  }
  const fresh = await boundedJwks(url,fetcher);
  if (cache && fresh.maxAgeMs > 0) {
    const expiry = nowMs + fresh.maxAgeMs;
    const response = new Response(fresh.bytes, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=' + Math.floor(fresh.maxAgeMs / 1000),
        'X-Naraya-Key-Valid-Until': String(expiry),
      },
    });
    try { await cache.put(key, response); } catch {
      // Cache API availability is optional. Fresh verified provider keys
      // can still be used; no authorization decision is cached.
    }
  }
  return fresh.keys;
}

async function parseCachedJwks(response: Response): Promise<{ keys: JsonObject }> {
  if (!response.body) throw new AuthUnavailable();
  const length = Number(response.headers.get('content-length') ?? 0);
  if (!Number.isFinite(length) || length < 0 || length > 65536) throw new AuthUnavailable();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > 65536) { await reader.cancel(); throw new AuthUnavailable(); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let position = 0;
  for (const part of chunks) { bytes.set(part,position); position += part.length; }
  try {
    const keys: unknown = JSON.parse(UTF8.decode(bytes));
    if (!object(keys) || !Array.isArray(keys.keys) || keys.keys.length > 32)
      throw new AuthUnavailable();
    return { keys };
  } catch { throw new AuthUnavailable(); }
}

export async function verifyOidcBearer(
  request: Request,
  settings: OidcSettings,
  fetcher: Fetcher = fetch,
  nowMs = Date.now(),
  cache?: PublicJwksCache,
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

  const { issuer, audience, jwks, authorizedPresenters } = config(settings);
  const now = Math.floor(nowMs / 1000);
  // Google documents exactly these two issuer spellings. For a configured
  // canonical Google issuer only, normalize the legacy spelling to the SAME
  // D1 issuer+sub identity. Never alias arbitrary third-party OIDC issuers.
  const issuerMatches = payload.iss === issuer ||
    (issuer === 'https://accounts.google.com' && payload.iss === 'accounts.google.com');
  if (!issuerMatches || payload.aud !== audience ||
      typeof payload.sub !== 'string' || !payload.sub.trim() || payload.sub.length > 255 ||
      typeof payload.exp !== 'number' || !Number.isSafeInteger(payload.exp) || payload.exp <= now ||
      typeof payload.iat !== 'number' || !Number.isSafeInteger(payload.iat) || payload.iat > now + 60 ||
      payload.exp <= payload.iat || payload.exp - payload.iat > 86400 ||
      (payload.nbf !== undefined && (typeof payload.nbf !== 'number' || !Number.isSafeInteger(payload.nbf) || payload.nbf > now + 60)) ||
      (payload.azp !== undefined &&
        (typeof payload.azp !== 'string' || !authorizedPresenters.has(payload.azp)))) throw new AuthRejected();

  const jwkSet = await getPublicJwks(jwks, fetcher, nowMs, cache ?? await defaultJwksCache());
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
