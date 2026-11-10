import { boundedJson, InputError, json, parseMonitorInput, parseStatusInput } from './domain.ts';
import { verifyOidcBearer } from './oidc.ts';
import { mobileSchedulerConfigured } from './scheduler-eligibility.ts';
import type { Env } from './types.ts';

export class IdentityCapacityError extends Error {}

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

function syncView(row: MobileMonitor, env?: Env) {
  return {
    id: row.id,
    clientDraftId: row.client_draft_id,
    repository: `${row.repo_owner}/${row.repo_name}`,
    intervalMinutes: row.interval_minutes,
    status: row.status,
    version: row.version,
    lastSha: row.last_sha,
    lastCheckedAt: row.last_checked_at,
    scheduled: false, // No real remote Cloudflare execution is verified.
    schedulerEligible: row.status === 'ACTIVE' && !!env && mobileSchedulerConfigured(env),
  };
}

async function ownerFromVerifiedIdentity(issuer: string, subject: string, env: Env): Promise<string> {
  // Existing signed-in users are read-only: do not attempt INSERT/COUNT on
  // every GET/PATCH/POST. First-time registration still uses ONE atomic,
  // bounded D1 INSERT, retaining the issuer+subject uniqueness guarantee.
  const existing = await env.DB.prepare(`SELECT id FROM user_identities WHERE issuer=? AND subject=?`)
    .bind(issuer, subject).first<Identity>();
  if (existing) {
    if (!UUID.test(existing.id)) throw new Error('identity_mapping_invalid');
    return existing.id;
  }
  const candidate = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO user_identities(id,issuer,subject,created_at)
    SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM user_identities) < 20
    ON CONFLICT(issuer,subject) DO NOTHING`)
    .bind(candidate, issuer, subject, now).run();
  // Under concurrent first requests the winning identity mapping is stable.
  const found = await env.DB.prepare(`SELECT id FROM user_identities WHERE issuer=? AND subject=?`)
    .bind(issuer, subject).first<Identity>();
  if (!found) throw new IdentityCapacityError();
  if (!UUID.test(found.id)) throw new Error('identity_mapping_invalid');
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

async function createSyncMonitor(
  body: ReturnType<typeof parseSyncInput>, env: Env, ownerId: string,
): Promise<Response> {
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
      return json({monitor: syncView(existing,env),created:result.meta.changes === 1},result.meta.changes === 1 ? 201 : 200);
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
      if (existing && existing.sync_request_digest === digest) return json({monitor:syncView(existing,env),created:false});
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
  return json({monitors:result.results.map(row => syncView(row,env))});
}

async function listSyncObservations(env: Env, ownerId: string, id: string): Promise<Response> {
  const monitor = await env.DB.prepare(`SELECT id FROM monitors
    WHERE owner_id=? AND id=? AND client_draft_id IS NOT NULL`)
    .bind(ownerId,id).first();
  if (!monitor) return json({error:'not_found'},404);
  const result = await env.DB.prepare(`SELECT o.id,o.monitor_id,o.event_type,o.previous_sha,o.head_sha,o.observed_at,o.event_sequence
    FROM observations o JOIN monitors m ON m.id=o.monitor_id
    WHERE m.owner_id=? AND m.client_draft_id IS NOT NULL AND o.monitor_id=?
    ORDER BY o.event_sequence DESC LIMIT 50`)
    .bind(ownerId,id).all();
  return json({observations:result.results});
}

/**
 * An enabled flag is not sufficient if a remote deployment skipped additive
 * migration 0004. Refuse to mark ACTIVE when the shared reservation authority
 * does not exist. This does not certify a configured Cloudflare Cron trigger,
 * published HTTPS route, Google OAuth, or actual remote runtime performance.
 */
async function schedulerBudgetReady(env: Env): Promise<boolean> {
  try {
    const control = await env.DB.prepare(`SELECT budget_window_start,budget_claims
      FROM scheduler_control WHERE id=1`)
      .first<{budget_window_start:number;budget_claims:number}>();
    // Migration 0005 is mandatory before any new mobile ACTIVE ACK.
    // A successful SELECT on an empty observations table still validates
    // existence of the durable sequence column. Never call the provider here.
    await env.DB.prepare('SELECT event_sequence FROM observations LIMIT 1').all();
    return !!control &&
      Number.isSafeInteger(control.budget_window_start) && control.budget_window_start >= 0 &&
      Number.isSafeInteger(control.budget_claims) &&
      control.budget_claims >= 0 && control.budget_claims <= 3;
  } catch {
    return false; // Missing migration, control row, or unavailable D1: no activation.
  }
}

async function updateSyncStatus(
  env: Env, ownerId: string, id: string, input: ReturnType<typeof parseStatusInput>,
): Promise<Response> {
  const {status,expectedVersion} = input;
  if (status === 'ACTIVE' && !mobileSchedulerConfigured(env))
    return json({error:'scheduler_disabled'},409);
  if (status === 'ACTIVE' && !await schedulerBudgetReady(env))
    return json({error:'scheduler_storage_unavailable'},503);

  const now = Date.now();
  const result = await env.DB.prepare(`UPDATE monitors SET status=?,next_due_at=?,
    lease_token=NULL,lease_until=NULL,updated_at=?,version=version+1,
    fail_count=CASE WHEN ?='ACTIVE' THEN 0 ELSE fail_count END,
    last_error_code=CASE WHEN ?='ACTIVE' THEN NULL ELSE last_error_code END
    WHERE id=? AND owner_id=? AND client_draft_id IS NOT NULL AND version=?
      AND (?='PAUSED' OR status='ACTIVE' OR (
         SELECT COUNT(*) FROM monitors WHERE client_draft_id IS NOT NULL AND status='ACTIVE'
      ) < 9)`)
    .bind(status,now,now,status,status,id,ownerId,expectedVersion,status).run();
  if (result.meta.changes !== 1) {
    const existing=await env.DB.prepare(`SELECT version,status FROM monitors WHERE id=?
      AND owner_id=? AND client_draft_id IS NOT NULL`).bind(id,ownerId).first<{version:number;status:string}>();
    if (!existing) return json({error:'not_found'},404);
    if (existing.version!==expectedVersion) return json({error:'stale_version'},409);
    return json({error:'active_monitor_limit'},409);
  }
  return json({id,status,version:expectedVersion+1,schedulerEligible:status==='ACTIVE'});
}

export async function mobileSync(request: Request, env: Env, path: string): Promise<Response> {
  // Authentication is always first. But unknown routes, invalid IDs and bad
  // bodies do NOT consume one of the 20 pilot identity registrations.
  const {issuer,subject} = await verifyOidcBearer(request, env);
  const listing = path === '/v1/sync/monitors' && request.method === 'GET';
  const creating = path === '/v1/sync/monitors' && request.method === 'POST';
  const reading = path === '/v1/sync/observations' && request.method === 'GET';
  const monitorPrefix = '/v1/sync/monitors/';
  const changed = path.startsWith(monitorPrefix) &&
    path.length === monitorPrefix.length + 36 ? path.slice(monitorPrefix.length) : null;
  const patching = changed !== null && request.method === 'PATCH';
  if (!listing && !creating && !reading && !patching)
    return json({error:'not_found'},404);

  const id = reading ? new URL(request.url).searchParams.get('monitorId') : null;
  if (reading && (!id || !UUID.test(id))) return json({error:'invalid_monitor_id'},400);
  if (patching && !UUID.test(changed!)) return json({error:'not_found'},404);
  const createInput = creating ? parseSyncInput(await boundedJson(request)) : null;
  const statusInput = patching ? parseStatusInput(await boundedJson(request)) : null;

  const ownerId = await ownerFromVerifiedIdentity(issuer, subject, env);
  if (listing) return listSyncMonitors(env,ownerId);
  if (creating) return createSyncMonitor(createInput!,env,ownerId);
  if (reading) return listSyncObservations(env,ownerId,id!);
  return updateSyncStatus(env,ownerId,changed!,statusInput!);
}
