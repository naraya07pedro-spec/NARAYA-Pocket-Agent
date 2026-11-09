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
const schema = readFileSync(new URL('../worker/migrations/0001_initial.sql', import.meta.url), 'utf8');
const TOKEN = 'synthetic-owner-auth-just-for-test-use-987654321';
const owner = 'local-cloudflare-test';
const headA = 'a'.repeat(40), headB = 'b'.repeat(40);
const fakeGithub = (sha) => async (url, options) => {
  assert.equal(new URL(url).host, 'api.github.com');
  assert.equal(options.method, 'GET');
  return new Response(JSON.stringify([{sha}]),{status:200});
};
const auth = { authorization: 'Bearer '+TOKEN };
const base = 'https://local.example.invalid';

async function setupPlatform(path) {
  const platform = await getPlatformProxy({
    configPath,
    persist: {path},
    remoteBindings: false,
  });
  assert.ok(platform.env.DB, 'real local D1 binding must be present');
  return platform;
}

test('Cloudflare local D1: durable migrations, API, cron logic and restart recovery', {timeout: 90000}, async()=>{
  const dir = mkdtempSync(join(tmpdir(), 'naraya-d1-workerd-'));
  let platform;
  try {
    platform = await setupPlatform(dir);
    const DB=platform.env.DB;
    await DB.exec(schema);
    const env={DB, OWNER_ID:owner, OWNER_API_TOKEN:TOKEN};
    const response=await worker.fetch(new Request(base+'/v1/monitors', {
      method:'POST', headers:{...auth,'content-type':'application/json'},
      body:JSON.stringify({repository:'python/cpython',intervalMinutes:30}),
    }),env);
    assert.equal(response.status,201);
    const {id}=await response.json();
    let row=await DB.prepare('SELECT * FROM monitors WHERE id=?').bind(id).first();
    assert.ok(row);
    const first=await runScheduler(env,row.next_due_at,fakeGithub(headA));
    assert.equal(first.completed,1);
    assert.equal(first.observations,1);
    const count=await DB.prepare('SELECT COUNT(*) AS n FROM observations WHERE monitor_id=?').bind(id).first();
    assert.equal(count.n,1);
    await platform.dispose();
    platform=null;
    platform=await setupPlatform(dir);
    const envRestarted={DB:platform.env.DB, OWNER_ID:owner, OWNER_API_TOKEN:TOKEN};
    row=await platform.env.DB.prepare('SELECT * FROM monitors WHERE id=?').bind(id).first();
    assert.equal(row.last_sha,headA);
    assert.equal((await runScheduler(envRestarted,row.next_due_at,fakeGithub(headA))).observations,0);
    row=await platform.env.DB.prepare('SELECT * FROM monitors WHERE id=?').bind(id).first();
    assert.equal((await runScheduler(envRestarted,row.next_due_at,fakeGithub(headB))).observations,1);
    const events=await platform.env.DB.prepare('SELECT event_type,head_sha FROM observations WHERE monitor_id=? ORDER BY observed_at').bind(id).all();
    assert.equal(events.results.length,2);
    assert.deepEqual(events.results.map(e=>e.event_type),['BASELINE','CHANGE']);
    assert.equal(events.results[1].head_sha,headB);
    const api=await worker.fetch(new Request(base+'/v1/observations?monitorId='+id,{headers:auth}),envRestarted);
    assert.equal(api.status,200);
    assert.equal((await api.json()).observations.length,2);
  } finally {
    if(platform)await platform.dispose();
    rmSync(dir,{recursive:true,force:true});
  }
});

test('Cloudflare local D1: rejected stale claim and no duplicate observation', {timeout: 90000}, async()=>{
  const dir=mkdtempSync(join(tmpdir(),'naraya-d1-fence-'));
  let platform;
  try {
    platform=await setupPlatform(dir);
    const DB=platform.env.DB; await DB.exec(schema);
    const env={DB,OWNER_ID:owner,OWNER_API_TOKEN:TOKEN};
    const result=await worker.fetch(new Request(base+'/v1/monitors',{
      method:'POST',headers:{...auth,'content-type':'application/json'},
      body:JSON.stringify({repository:'nodejs/node',intervalMinutes:30}),
    }),env);
    assert.equal(result.status,201);
    const {id}=await result.json();
    const row=await DB.prepare('SELECT * FROM monitors WHERE id=?').bind(id).first();
    let release,started;
    const gate=new Promise(r=>release=r);
    const entered=new Promise(r=>started=r);
    const pending=runScheduler(env,row.next_due_at,async()=>{started();await gate;return new Response(JSON.stringify([{sha:headA}]))});
    await entered;
    const changed=await worker.fetch(new Request(base+'/v1/monitors/'+id,{
      method:'PATCH',headers:{...auth,'content-type':'application/json'},
      body:JSON.stringify({status:'PAUSED',expectedVersion:row.version+1}),
    }),env);
    assert.equal(changed.status,200);
    release();
    const report=await pending;
    assert.equal(report.skipped,1);
    const events=await DB.prepare('SELECT id FROM observations').all();
    assert.equal(events.results.length,0);
  } finally {
    if(platform)await platform.dispose();
    rmSync(dir,{recursive:true,force:true});
  }
});
