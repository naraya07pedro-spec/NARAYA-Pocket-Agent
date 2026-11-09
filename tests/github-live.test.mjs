import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPlatformProxy } from 'wrangler';
import worker from '../worker/src/index.ts';
import { runScheduler } from '../worker/src/scheduler.ts';

const configPath = fileURLToPath(new URL('../worker/wrangler.local.jsonc', import.meta.url));
const inputSql = readFileSync(new URL('../worker/migrations/0001_initial.sql', import.meta.url), 'utf8');
const owner = 'live-provider-readonly-test';
const token = 'synthetic-local-owner-test-only-very-long';
const repo = 'naraya07pedro-spec/NARAYA-Pocket-Agent';

async function migration(db) {
  // D1 exec accepts single-line SQL, not the whole multiline migration verbatim.
  const clean = inputSql.split('\n').filter(x => !x.trimStart().startsWith('--')).join('\n');
  for (const sql of clean.split(';').map(x => x.trim()).filter(Boolean)) {
    await db.prepare(sql).run();
  }
}

test('real GitHub public API -> shipped scheduler -> local workerd/D1 -> independent ref readback', { timeout: 90000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'naraya-live-github-'));
  let platform;
  try {
    platform = await getPlatformProxy({ configPath, persist: {path: dir}, remoteBindings: false });
    const env = { DB: platform.env.DB, OWNER_ID: owner, OWNER_API_TOKEN: token };
    await migration(env.DB);
    const created = await worker.fetch(new Request('https://example.invalid/v1/monitors', {
      method: 'POST',
      headers: {authorization: 'Bearer ' + token, 'content-type': 'application/json'},
      body: JSON.stringify({repository: repo, intervalMinutes: 30}),
    }), env);
    assert.equal(created.status, 201, await created.text().catch(() => ''));
    // Only public GETs from the shipped adapter: no writes, no credentials.
    const {id} = await created.json();
    const candidate = await env.DB.prepare('SELECT next_due_at FROM monitors WHERE id=?').bind(id).first();
    const report = await runScheduler(env, candidate.next_due_at);
    assert.equal(report.completed, 1, 'live GitHub source must return a verified SHA');
    assert.equal(report.observations, 1);
    const observed = await env.DB.prepare('SELECT head_sha,event_type FROM observations WHERE monitor_id=?').bind(id).first();
    assert.equal(observed.event_type, 'BASELINE');
    assert.match(observed.head_sha, /^[a-f0-9]{40}$/);
    // A separate official GitHub ref endpoint corroborates the current default branch.
    const refResponse = await fetch('https://api.github.com/repos/naraya07pedro-spec/NARAYA-Pocket-Agent/git/ref/heads/main', {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(6000),
      headers: {'Accept':'application/vnd.github+json','User-Agent':'naraya-pocket-agent-ci-live-proof','X-GitHub-Api-Version':'2022-11-28'},
    });
    assert.equal(refResponse.status, 200, 'official GitHub ref endpoint must be reachable');
    const ref = await refResponse.json();
    assert.equal(observed.head_sha, ref.object?.sha?.toLowerCase(), 'observed commit must equal independent branch ref');
    const api = await worker.fetch(new Request('https://example.invalid/v1/observations?monitorId='+id,{
      headers:{authorization:'Bearer '+token}
    }), env);
    assert.equal(api.status, 200);
    assert.equal((await api.json()).observations.length, 1);
    console.log(JSON.stringify({result:'LIVE_GITHUB_READ_CONFIRMED',repository:repo,head_sha:observed.head_sha,environment:'github-actions-local-workerd-d1',remote_cloudflare:false}));
  } finally {
    if (platform) await platform.dispose();
    rmSync(dir,{recursive:true,force:true});
  }
});
