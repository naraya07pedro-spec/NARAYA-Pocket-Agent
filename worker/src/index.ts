import { boundedJson, InputError, json, ownerId, parseMonitorInput, parseStatusInput } from './domain.ts';
import { runScheduler } from './scheduler.ts';
import { mobileSchedulerConfigured } from './scheduler-eligibility.ts';
import { mobileSync, IdentityCapacityError } from './mobile-sync.ts';
import { AuthRejected, AuthUnavailable, verifyOidcBearer } from './oidc.ts';
import { syntheticApprovalRoute } from './synthetic-approvals.ts';
import { syntheticLeadRoute } from './synthetic-leads.ts';
import { taskRuntimeRoute } from './task-runtime.ts';
import type { Env, Monitor } from './types.ts';

async function authorized(request: Request, secret?: string): Promise<boolean> {
  if (!secret || secret.length < 32) return false;
  const header = request.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ') || header.length > 520) return false;
  const token = header.slice(7);
  // Compare fixed-length digests; do not use ordinary string equality for API tokens.
  const [expected, received] = await Promise.all([
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)),
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)),
  ]);
  const a = new Uint8Array(expected), b = new Uint8Array(received);
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}

function sanitized(monitor: Monitor) {
  const { lease_token: _leaseToken, lease_until: _leaseUntil, owner_id: _ownerId, ...publicFields } = monitor;
  return publicFields;
}

async function listMonitors(env: Env) {
  const result = await env.DB.prepare(`SELECT * FROM monitors WHERE owner_id=? ORDER BY created_at DESC LIMIT 10`)
    .bind(ownerId(env.OWNER_ID)).all<Monitor>();
  return json({ monitors: result.results.map(sanitized) });
}

async function createMonitor(request: Request, env: Env): Promise<Response> {
  const values = parseMonitorInput(await boundedJson(request));
  const now = Date.now(), id = crypto.randomUUID(), owner = ownerId(env.OWNER_ID);
  try {
    const result = await env.DB.prepare(`INSERT INTO monitors(id,owner_id,repo_owner,repo_name,interval_minutes,
      next_due_at,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?
      WHERE (SELECT COUNT(*) FROM monitors WHERE owner_id=?)<3`)
      .bind(id, owner, values.owner, values.repo, values.intervalMinutes, now, now, now, owner).run();
    if (result.meta.changes !== 1) return json({ error: 'monitor_limit' }, 409);
    return json({ id, status: 'ACTIVE', repository: `${values.owner}/${values.repo}`, intervalMinutes: values.intervalMinutes }, 201);
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) return json({ error: 'repository_already_monitored' }, 409);
    throw error;
  }
}

async function updateStatus(request: Request, env: Env, id: string): Promise<Response> {
  const values = parseStatusInput(await boundedJson(request));
  const now = Date.now();
  const update = await env.DB.prepare(`UPDATE monitors SET status=?,next_due_at=?,lease_token=NULL,lease_until=NULL,
    updated_at=?,version=version+1,fail_count=CASE WHEN ?='ACTIVE' THEN 0 ELSE fail_count END,
    last_error_code=CASE WHEN ?='ACTIVE' THEN NULL ELSE last_error_code END
    WHERE id=? AND owner_id=? AND version=?`)
    .bind(values.status, now, now, values.status, values.status, id, ownerId(env.OWNER_ID), values.expectedVersion).run();
  if (update.meta.changes !== 1) return json({ error: 'not_found_or_stale_version' }, 409);
  return json({ id, status: values.status, version: values.expectedVersion + 1 });
}

async function listObservations(request: Request, env: Env): Promise<Response> {
  const monitorId = new URL(request.url).searchParams.get('monitorId');
  if (!monitorId || !/^[0-9a-f-]{36}$/i.test(monitorId)) return json({ error: 'invalid_monitor_id' }, 400);
  const result = await env.DB.prepare(`SELECT o.id,o.monitor_id,o.event_type,o.previous_sha,o.head_sha,o.observed_at
      FROM observations o JOIN monitors m ON m.id=o.monitor_id
      WHERE m.owner_id=? AND o.monitor_id=? ORDER BY o.observed_at DESC,o.id DESC LIMIT 50`)
    .bind(ownerId(env.OWNER_ID), monitorId).all();
  return json({ observations: result.results });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const { pathname } = new URL(request.url);
      if (pathname === '/health' && request.method === 'GET') return json({ service: 'naraya-pocket-agent', status: 'pilot' });
      if (pathname === '/v1/me' && request.method === 'GET') {
        await verifyOidcBearer(request, env);
        return json({ authenticated: true, capabilities: {
          monitorSync: true,
          mobileActivationConfigured: mobileSchedulerConfigured(env),
        } });
      }
      if (pathname === '/v1/sync/monitors' || pathname === '/v1/sync/observations' || /^\/v1\/sync\/monitors\/[0-9a-f-]{36}$/i.test(pathname)) {
        return await mobileSync(request,env,pathname);
      }
      if (pathname === '/v1/tasks' || pathname.startsWith('/v1/tasks/')) {
        return await taskRuntimeRoute(request,env,pathname);
      }
      if (pathname === '/v1/synthetic-leads') {
        return await syntheticLeadRoute(request,env,pathname);
      }
      if (pathname === '/v1/approval-intents' || pathname.startsWith('/v1/approval-intents/')) {
        return await syntheticApprovalRoute(request,env,pathname);
      }
      if (!env.OWNER_API_TOKEN || env.OWNER_API_TOKEN.length < 32 ||
          !env.OWNER_ID || !/^[A-Za-z0-9_-]{1,64}$/.test(env.OWNER_ID)) {
        return json({ error: 'owner_auth_not_configured' }, 503);
      }
      if (!await authorized(request, env.OWNER_API_TOKEN)) return json({ error: 'unauthorized' }, 401);
      if (pathname === '/v1/monitors' && request.method === 'GET') return await listMonitors(env);
      if (pathname === '/v1/monitors' && request.method === 'POST') return await createMonitor(request, env);
      const match = /^\/v1\/monitors\/([0-9a-f-]{36})$/.exec(pathname);
      if (match && request.method === 'PATCH') return await updateStatus(request, env, match[1]);
      if (pathname === '/v1/observations' && request.method === 'GET') return await listObservations(request, env);
      return json({ error: 'not_found' }, 404);
    } catch (error) {
      if (error instanceof IdentityCapacityError) return json({error:'pilot_identity_limit'},429);
      if (error instanceof AuthRejected) return json({ error: 'unauthorized' }, 401);
      if (error instanceof AuthUnavailable) return json({ error: 'identity_provider_unavailable' }, 503);
      if (error instanceof InputError) return json({ error: error.message }, error.message === 'payload_too_large' ? 413 : 400);
      return json({ error: 'internal_error' }, 500);
    }
  },
  async scheduled(_event: unknown, env: Env): Promise<void> {
    // Global, opt-in kill switch: deployed Cron triggers alone MUST NOT issue
    // provider requests or touch D1. Mobile permission is a separate gate.
    if (env.SCHEDULER_ENABLED !== 'true') {
      console.log(JSON.stringify({event:'scheduled_disabled'}));
      return;
    }
    // Correlate this particular Cron invocation to committed D1 observation
    // UUIDs. No monitor IDs, owner IDs, GitHub SHAs, leases or credentials
    // are logged. A log by itself does NOT prove authentic remote execution.
    const evidence: { observationIds: string[] } = { observationIds: [] };
    const report = await runScheduler(env, Date.now(), fetch, evidence);
    console.log(JSON.stringify({ event: 'scheduled_tick', ...report,
      observationIds: evidence.observationIds }));
  },
};
