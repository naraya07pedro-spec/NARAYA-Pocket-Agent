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
const migrations = ['0001_initial.sql', '0002_mobile_identity_sync.sql'];
const migrationSql = migrations.map(name => readFileSync(new URL('../worker/migrations/'+name, import.meta.url), 'utf8'));
async function applyStatements(DB, source) {
  // D1.exec splits on newlines; apply complete SQL statements through D1.prepare.
  const sql = source.split('\n').filter(line=>!line.trimStart().startsWith('--')).join('\n');
  const statements = sql.split(';').map(statement=>statement.trim()).filter(Boolean);
  assert.ok(statements.length >= 2);
  for (const statement of statements) await DB.prepare(statement).run();
}
async function applySchema(DB) {
  for (const sql of migrationSql) await applyStatements(DB,sql);
}
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
    await applySchema(DB);
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
    const DB=platform.env.DB; await applySchema(DB);
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


test('Cloudflare local D1: OIDC owner isolation and draft replay survives actual workerd restart', {timeout: 90000}, async()=>{
  const dir=mkdtempSync(join(tmpdir(),'naraya-d1-mobile-'));
  let platform;
  const originalFetch=globalThis.fetch;
  const issuer='https://login.example.invalid';
  const settings={OIDC_ISSUER:issuer,OIDC_AUDIENCE:'pocket-agent-mobile-test',OIDC_JWKS_URL:'https://keys.example.invalid/jwks'};
  const pair=await crypto.subtle.generateKey({
    name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
    publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256',
  },true,['sign','verify']);
  const jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'fixture-key',use:'sig',alg:'RS256'};
  const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
  const jwt=async subject=>{
    const now=Math.floor(Date.now()/1000);
    const input=encode({alg:'RS256',kid:'fixture-key',typ:'JWT'})+'.'+
      encode({iss:issuer,aud:settings.OIDC_AUDIENCE,sub:subject,iat:now-30,exp:now+1200});
    const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(input));
    return input+'.'+Buffer.from(signature).toString('base64url');
  };
  const id='bbbbb888-8888-4888-8888-888888888888';
  const request=(token,method='GET',url='/v1/sync/monitors',body)=>new Request(base+url,{
    method,headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined,
  });
  try {
    platform=await setupPlatform(dir);
    await applySchema(platform.env.DB);
    globalThis.fetch=async (url,options)=>{
      assert.equal(url,settings.OIDC_JWKS_URL);
      assert.equal(options.redirect,'error');
      return new Response(JSON.stringify({keys:[jwk]}),{status:200});
    };
    const a=await jwt('test-A'),b=await jwt('test-B');
    const body={clientDraftId:id,repository:'python/cpython',intervalMinutes:30};
    const env={DB:platform.env.DB,...settings};
    const first=await worker.fetch(request(a,'POST','/v1/sync/monitors',body),env);
    assert.equal(first.status,201);
    const monitor=(await first.json()).monitor;
    assert.equal(monitor.status,'PAUSED');
    assert.equal(monitor.scheduled,false);
    assert.equal((await(await worker.fetch(request(b),env)).json()).monitors.length,0);
    assert.equal((await worker.fetch(request(b,'GET','/v1/sync/observations?monitorId='+monitor.id),env)).status,404);
    const mapped=await env.DB.prepare('SELECT COUNT(*) AS n FROM user_identities').first();
    assert.equal(mapped.n,2);
    await platform.dispose(); platform=null;
    platform=await setupPlatform(dir);
    const restarted={DB:platform.env.DB,...settings};
    const retry=await worker.fetch(request(a,'POST','/v1/sync/monitors',body),restarted);
    assert.equal(retry.status,200);
    assert.equal((await retry.json()).monitor.id,monitor.id);
    assert.equal((await restarted.DB.prepare('SELECT COUNT(*) AS n FROM monitors').first()).n,1);
    assert.equal((await restarted.DB.prepare('SELECT COUNT(*) AS n FROM user_identities').first()).n,2);
  } finally {
    globalThis.fetch=originalFetch;
    if(platform)await platform.dispose();
    rmSync(dir,{recursive:true,force:true});
  }
});

test('Cloudflare local D1: upgrading 0001 -> 0002 preserves prior operator monitor and identity boundary', {timeout:90000}, async()=>{
  const dir=mkdtempSync(join(tmpdir(),'naraya-d1-upgrade-'));
  let platform;
  try {
    platform=await setupPlatform(dir);
    const DB=platform.env.DB;
    await applyStatements(DB,migrationSql[0]); // Historical database state.
    const env={DB,OWNER_ID:owner,OWNER_API_TOKEN:TOKEN};
    const result=await worker.fetch(new Request(base+'/v1/monitors',{
      method:'POST',headers:{...auth,'content-type':'application/json'},
      body:JSON.stringify({repository:'nodejs/node',intervalMinutes:30}),
    }),env);
    assert.equal(result.status,201);
    const {id}=await result.json();
    const before=await DB.prepare('SELECT * FROM monitors WHERE id=?').bind(id).first();
    assert.ok(before);
    assert.equal(before.status,'ACTIVE');
    await applyStatements(DB,migrationSql[1]); // Production-like additive migration.
    const after=await DB.prepare('SELECT * FROM monitors WHERE id=?').bind(id).first();
    for (const column of ['id','owner_id','repo_owner','repo_name','status','version','created_at','interval_minutes']) {
      assert.equal(after[column],before[column]);
    }
    assert.equal(after.client_draft_id,null);
    assert.equal(after.sync_request_digest,null);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM user_identities').first()).n,0);
    assert.equal((await(await worker.fetch(new Request(base+'/v1/monitors',{headers:auth}),env)).json()).monitors.length,1);
  } finally {
    if(platform)await platform.dispose();
    rmSync(dir,{recursive:true,force:true});
  }
});
