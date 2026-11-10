import { ownerId } from './domain.ts';
import { readDefaultBranchHead, GithubReadError, type FetchLike } from './github.ts';
import type { Env, Monitor } from './types.ts';

const MAX_CHECKS_PER_TICK = 3;
const LEASE_MS = 45_000;
const STOP_AFTER_FAILURES = 5;

export interface TickReport { claimed: number; completed: number; observations: number; deferred: number; skipped: number }

function changes(value: { meta?: { changes?: number } }): number { return value.meta?.changes ?? 0; }

async function saveSuccess(env: Env, monitor: Monitor, lease: string, headSha: string, now: number): Promise<number> {
  const db = env.DB;
  const rows = await db.batch([
    db.prepare(`INSERT INTO observations(id, monitor_id, lease_token, event_type, previous_sha, head_sha, observed_at)
      SELECT ?, id, ?, CASE WHEN last_sha IS NULL THEN 'BASELINE' ELSE 'CHANGE' END, last_sha, ?, ?
      FROM monitors WHERE id=? AND owner_id=? AND lease_token=? AND status='ACTIVE'
      AND (last_sha IS NULL OR last_sha<>?)`)
      .bind(crypto.randomUUID(), lease, headSha, now, monitor.id, monitor.owner_id, lease, headSha),
    db.prepare(`INSERT INTO audit_events(id,monitor_id,event_type,code,recorded_at)
      SELECT ?,id,'CHECK_COMPLETED','PROVIDER_HEAD_READ',? FROM monitors
      WHERE id=? AND owner_id=? AND lease_token=? AND status='ACTIVE'`)
      .bind(crypto.randomUUID(), now, monitor.id, monitor.owner_id, lease),
    db.prepare(`UPDATE monitors SET last_sha=?,last_checked_at=?,next_due_at=?,fail_count=0,last_error_code=NULL,
      lease_token=NULL,lease_until=NULL,updated_at=?,version=version+1
      WHERE id=? AND owner_id=? AND lease_token=? AND status='ACTIVE'`)
      .bind(headSha, now, now + monitor.interval_minutes * 60_000, now, monitor.id, monitor.owner_id, lease),
  ]);
  return changes(rows[2]) ? changes(rows[0]) : -1;
}

async function saveFailure(env: Env, monitor: Monitor, lease: string, code: string, now: number): Promise<boolean> {
  const nextFailCount = monitor.fail_count + 1;
  const backoffMs = (code === 'RATE_LIMITED' ? 60 : Math.min(60, 5 * 2 ** (nextFailCount - 1))) * 60_000;
  const db = env.DB;
  const rows = await db.batch([
    db.prepare(`INSERT INTO audit_events(id,monitor_id,event_type,code,recorded_at)
      SELECT ?,id,'CHECK_DEFERRED',?,? FROM monitors
      WHERE id=? AND owner_id=? AND lease_token=? AND status='ACTIVE'`)
      .bind(crypto.randomUUID(), code, now, monitor.id, monitor.owner_id, lease),
    db.prepare(`UPDATE monitors SET fail_count=fail_count+1,last_error_code=?,
      next_due_at=?,status=CASE WHEN fail_count+1 >= ? THEN 'PAUSED' ELSE status END,
      lease_token=NULL,lease_until=NULL,updated_at=?,version=version+1
      WHERE id=? AND owner_id=? AND lease_token=? AND status='ACTIVE'`)
      .bind(code, now + backoffMs, STOP_AFTER_FAILURES, now, monitor.id, monitor.owner_id, lease),
  ]);
  return changes(rows[1]) === 1;
}

export async function runScheduler(env: Env, now = Date.now(), fetcher: FetchLike = fetch): Promise<TickReport> {
  const report: TickReport = { claimed: 0, completed: 0, observations: 0, deferred: 0, skipped: 0 };
  const owner = ownerId(env.OWNER_ID); // Fail closed if operator context is misconfigured.
  const mobileEnabled = env.MOBILE_SCHEDULING_ENABLED === 'true';
  let results: Monitor[];
  if (mobileEnabled) {
    // Durable cursor rotates owners across invocations. At most one due task per
    // owner per tick and three external calls total, INCLUDING operator tasks.
    const control = await env.DB.prepare(`SELECT last_owner_id FROM scheduler_control WHERE id=1`)
      .first<{last_owner_id:string}>();
    if (!control) throw new Error('scheduler_control_missing');
    const selected = await env.DB.prepare(`SELECT * FROM (
      SELECT m.*, ROW_NUMBER() OVER (
        PARTITION BY m.owner_id ORDER BY m.next_due_at,m.id
      ) AS owner_rank FROM monitors m
      WHERE m.status='ACTIVE' AND m.next_due_at<=?
        AND (m.lease_until IS NULL OR m.lease_until<=?)
        AND (m.owner_id=? OR (
          m.client_draft_id IS NOT NULL
          AND EXISTS(SELECT 1 FROM user_identities u WHERE u.id=m.owner_id)
        ))
    ) WHERE owner_rank=1
      ORDER BY CASE WHEN owner_id>? THEN 0 ELSE 1 END,owner_id
      LIMIT ?`).bind(now,now,owner,control.last_owner_id,MAX_CHECKS_PER_TICK).all<Monitor>();
    results = selected.results;
  } else {
    const selected = await env.DB.prepare(`SELECT * FROM monitors
      WHERE owner_id=? AND status='ACTIVE' AND next_due_at<=? AND (lease_until IS NULL OR lease_until<=?)
      ORDER BY next_due_at,id LIMIT ?`).bind(owner,now,now,MAX_CHECKS_PER_TICK).all<Monitor>();
    results=selected.results;
  }
  for (const candidate of results) {
    const lease = crypto.randomUUID();
    const claim = await env.DB.prepare(`UPDATE monitors SET lease_token=?,lease_until=?,version=version+1
      WHERE id=? AND owner_id=? AND status='ACTIVE' AND next_due_at<=?
      AND (lease_until IS NULL OR lease_until<=?)`)
      .bind(lease, now + LEASE_MS, candidate.id, candidate.owner_id, now, now).run();
    if (changes(claim) !== 1) { report.skipped++; continue; }
    report.claimed++;
    if (mobileEnabled) {
      // Record rotation before external I/O. A crash can delay fairness but
      // cannot bypass the per-monitor lease fencing or duplicate observations.
      await env.DB.prepare(`UPDATE scheduler_control SET last_owner_id=? WHERE id=1`)
        .bind(candidate.owner_id).run();
    }
    try {
      const sha = await readDefaultBranchHead(candidate.repo_owner, candidate.repo_name, fetcher);
      const observation = await saveSuccess(env, candidate, lease, sha, now);
      if (observation >= 0) { report.completed++; report.observations += observation; }
      else report.skipped++; // Paused/reclaimed while the HTTP call was in flight.
    } catch (error) {
      const code = error instanceof GithubReadError ? error.code : 'INTERNAL_ERROR';
      const written = await saveFailure(env, candidate, lease, code, now);
      if (written) report.deferred++; else report.skipped++;
    }
  }
  return report;
}
