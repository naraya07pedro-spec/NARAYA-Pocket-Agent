import { boundedJson, InputError, json, parseMonitorInput } from './domain.ts';
import { verifyOidcBearer } from './oidc.ts';
import type { Env } from './types.ts';

interface Identity { id: string }
interface MobileMonitor {
  id: string;
  client_draft_id: string | null;
  repo_owner: string;
  repo_name: string;
  status: string;
  interval_minutes: number;
  last_sha: string | null;
  last_checked_at: number | null;
  version: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function syncView(row: MobileMonitor) {
  return {
    id: row.id,
    clientDraftId: row.client_draft_id,
    repository: `${row.repo_owner}/${row.repo_name}`,
    intervalMinutes: row.interval_minutes,
    status: row.status,
    version: row.version,
    lastSha: row.last_sha,
    lastCheckedAt: row.last_checked_at,
    scheduled: false, // P1-C deliberately does not activate a multi-user scheduler.
  };
}

async function ownerFromVerifiedIdentity(request: Request, env: Env): Promise<string> {
  const { issuer, subject } = await verifyOidcBearer(request, env);
  const candidate = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO user_identities(id,issuer,subject,created_at)
    VALUES(?,?,?,?) ON CONFLICT(issuer,subject) DO NOTHING`)
    .bind(candidate, issuer, subject, now).run();
  const found = await env.DB.prepare(`SELECT id FROM user_identities WHERE issuer=? AND subject=?`)
    .bind(issuer, subject).first<Identity>();
  if (!found || !UUID.test(found.id)) throw new Error('identity_mapping_missing');
  return found.id;
}

function parseSyncInput(body: unknown): { clientDraftId: string; owner: string; repo: string; intervalMinutes: number } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('invalid_body');
  const input = body as Record<string, unknown>;
  if (Object.keys(input).sort().join(',') !== 'clientDraftId,intervalMinutes,repository' ||
      typeof input.clientDraftId !== 'string' || !UUID.test(input.clientDraftId)) {
    throw new InputError('invalid_fields');
  }
  const normalized = parseMonitorInput({repository: input.repository, intervalMinutes: input.intervalMinutes});
  return {clientDraftId: input.clientDraftId.toLowerCase(), ...normalized};
}

async function fingerprint(owner: string, repo: string, intervalMinutes: number): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([owner, repo, intervalMinutes]));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2,'0')).join('');
}

async function createSyncMonitor(request: Request, env: Env, ownerId: string): Promise<Response> {
  const body = parseSyncInput(await boundedJson(request));
  const digest = await fingerprint(body.owner, body.repo, body.intervalMinutes);
  const now = Date.now(), id = crypto.randomUUID();
  // Single D1 SQL statement enforces the quota at insert time, avoiding a TOCTOU count-then-write.
  // Unique(owner_id,client_draft_id) guarantees retry cannot create a second monitor.
  try {
    const result = await env.DB.prepare(`INSERT OR IGNORE INTO monitors(
      id,owner_id,repo_owner,repo_name,status,interval_minutes,next_due_at,created_at,updated_at,
      client_draft_id,sync_request_digest
    ) SELECT ?,?,?,?,'PAUSED',?,?,?,?,?,?
      WHERE (SELECT COUNT(*) FROM monitors WHERE owner_id=?) < 3`)
      .bind(id,ownerId,body.owner,body.repo,body.intervalMinutes,now,now,now,body.clientDraftId,digest,ownerId).run();
    const existing = await env.DB.prepare(`SELECT id,client_draft_id,repo_owner,repo_name,status,
       interval_minutes,last_sha,last_checked_at,version,sync_request_digest
       FROM monitors WHERE owner_id=? AND client_draft_id=?`)
      .bind(ownerId,body.clientDraftId)
      .first<MobileMonitor & {sync_request_digest: string | null}>();
    if (existing) {
      if (existing.sync_request_digest !== digest) return json({error:'draft_id_payload_conflict'},409);
      return json({monitor: syncView(existing),created:result.meta.changes === 1},result.meta.changes === 1 ? 201 : 200);
    }
    // A repo may already exist under a different client draft; or the owner is at quota.
    const sameRepo = await env.DB.prepare(`SELECT id FROM monitors
      WHERE owner_id=? AND repo_owner=? AND repo_name=?`)
      .bind(ownerId,body.owner,body.repo).first();
    if (sameRepo) return json({error:'repository_already_monitored'},409);
    return json({error:'monitor_limit'},409);
  } catch (error) {
    // SQLite/D1 uniqueness conflicts remain possible under concurrent requests.
    // Do not expose DB diagnostics or map an unknown SQL error to apparent success.
    if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) {
      const existing = await env.DB.prepare(`SELECT id,client_draft_id,repo_owner,repo_name,status,
        interval_minutes,last_sha,last_checked_at,version,sync_request_digest
        FROM monitors WHERE owner_id=? AND client_draft_id=?`)
        .bind(ownerId,body.clientDraftId)
        .first<MobileMonitor & {sync_request_digest: string | null}>();
      if (existing && existing.sync_request_digest === digest) return json({monitor:syncView(existing),created:false});
      return json({error:'repository_or_draft_conflict'},409);
    }
    throw error;
  }
}

async function listSyncMonitors(env: Env, ownerId: string): Promise<Response> {
  const result = await env.DB.prepare(`SELECT id,client_draft_id,repo_owner,repo_name,status,
    interval_minutes,last_sha,last_checked_at,version FROM monitors
    WHERE owner_id=? AND client_draft_id IS NOT NULL
    ORDER BY created_at DESC,id DESC LIMIT 3`)
    .bind(ownerId).all<MobileMonitor>();
  return json({monitors:result.results.map(syncView)});
}

async function listSyncObservations(request: Request, env: Env, ownerId: string): Promise<Response> {
  const id = new URL(request.url).searchParams.get('monitorId');
  if (!id || !UUID.test(id)) return json({error:'invalid_monitor_id'},400);
  const monitor = await env.DB.prepare(`SELECT id FROM monitors
    WHERE owner_id=? AND id=? AND client_draft_id IS NOT NULL`)
    .bind(ownerId,id).first();
  if (!monitor) return json({error:'not_found'},404);
  const result = await env.DB.prepare(`SELECT o.id,o.monitor_id,o.event_type,o.previous_sha,o.head_sha,o.observed_at
    FROM observations o JOIN monitors m ON m.id=o.monitor_id
    WHERE m.owner_id=? AND m.client_draft_id IS NOT NULL AND o.monitor_id=?
    ORDER BY o.observed_at DESC,o.id DESC LIMIT 50`)
    .bind(ownerId,id).all();
  return json({observations:result.results});
}

export async function mobileSync(request: Request, env: Env, path: string): Promise<Response> {
  const ownerId = await ownerFromVerifiedIdentity(request, env);
  if (path === '/v1/sync/monitors' && request.method === 'GET') return listSyncMonitors(env,ownerId);
  if (path === '/v1/sync/monitors' && request.method === 'POST') return createSyncMonitor(request,env,ownerId);
  if (path === '/v1/sync/observations' && request.method === 'GET') return listSyncObservations(request,env,ownerId);
  return json({error:'not_found'},404);
}
