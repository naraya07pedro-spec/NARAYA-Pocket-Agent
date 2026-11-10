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
const migrations = ['0001_initial.sql', '0002_mobile_identity_sync.sql', '0003_scheduler_control.sql', '0004_global_scheduler_budget.sql'];
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


test('Cloudflare workerd/D1: fair mobile dispatcher, persisted owner cursor and global budget', {timeout:90000}, async()=>{
  const dir=mkdtempSync(join(tmpdir(),'naraya-d1-fair-'));
  let platform;
  try {
    platform=await setupPlatform(dir);
    const DB=platform.env.DB;
    await applySchema(DB);
    const now=Date.now();
    const repositories=['python/cpython','nodejs/node','microsoft/vscode','cloudflare/workers-sdk'];
    for(let i=0;i<4;i++) {
      const id=crypto.randomUUID(),ownerId=crypto.randomUUID();
      await DB.prepare(`INSERT INTO user_identities(id,issuer,subject,created_at) VALUES(?,?,?,?)`)
        .bind(ownerId,'https://identity.test','user-'+i,now).run();
      await DB.prepare(`INSERT INTO monitors(id,owner_id,repo_owner,repo_name,status,interval_minutes,next_due_at,
        created_at,updated_at,client_draft_id,sync_request_digest)
        VALUES(?,?,?,?,'ACTIVE',30,?,?,?,?,?)`)
        .bind(id,ownerId,...repositories[i].split('/'),now,now,now,crypto.randomUUID(),'synthetic').run();
    }
    const config={DB,OWNER_ID:owner,MOBILE_SCHEDULING_ENABLED:'true'};
    let calls=[];
    const fake=async (url,options)=>{
      assert.equal(options.method,'GET');
      assert.equal(new URL(url).hostname,'api.github.com');
      calls.push(new URL(url).pathname);
      return new Response(JSON.stringify([{sha:headA}]),{status:200});
    };
    const disabled=await runScheduler({...config,MOBILE_SCHEDULING_ENABLED:undefined},now+2000,fake);
    assert.equal(disabled.claimed,0);
    const first=await runScheduler(config,now+2000,fake);
    assert.equal(first.claimed,3);
    assert.equal(first.observations,3);
    assert.equal(calls.length,3);
    const untouched=repositories.find(repo=>!calls.some(path=>path.includes('/'+repo+'/')));
    assert.ok(untouched);
    const cursorBefore=(await DB.prepare('SELECT last_owner_id FROM scheduler_control WHERE id=1').first()).last_owner_id;
    assert.ok(cursorBefore);
    await platform.dispose();platform=null;
    platform=await setupPlatform(dir);
    const restarted=platform.env.DB;
    assert.equal((await restarted.prepare('SELECT last_owner_id FROM scheduler_control WHERE id=1').first()).last_owner_id,cursorBefore);
    calls=[];
    const second=await runScheduler({...config,DB:restarted},now+30*60_000+3000,fake);
    assert.equal(second.claimed,3);
    assert.ok(calls[0].includes('/'+untouched+'/'));
    const served=await restarted.prepare(`SELECT COUNT(DISTINCT m.owner_id) AS n FROM observations o
      JOIN monitors m ON m.id=o.monitor_id`).first();
    assert.equal(served.n,4);
  } finally {
    if(platform)await platform.dispose();
    rmSync(dir,{recursive:true,force:true});
  }
});


test('Cloudflare local D1: signed two-user mobile status and observation contract end-to-end', {timeout:90000}, async()=>{
  const dir=mkdtempSync(join(tmpdir(),'naraya-d1-mobile-status-'));
  const originalFetch=globalThis.fetch;
  let platform;
  try {
    platform=await setupPlatform(dir);
    const DB=platform.env.DB;
    await applySchema(DB);
    const issuer='https://login.example.invalid',jwks='https://keys.example.invalid/jwks';
    const audience='pocket-agent-status-contract';
    const pair=await crypto.subtle.generateKey({
      name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
      publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256',
    },true,['sign','verify']);
    const key={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'status-contract',alg:'RS256',use:'sig'};
    const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
    const signed=async sub=>{
      const current=Math.floor(Date.now()/1000);
      const input=encode({alg:'RS256',typ:'JWT',kid:'status-contract'})+'.'+
        encode({iss:issuer,aud:audience,sub,iat:current-20,exp:current+1000});
      const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(input));
      return input+'.'+Buffer.from(signature).toString('base64url');
    };
    globalThis.fetch=async (url,options)=>{
      assert.equal(url,jwks);
      assert.equal(options.method,'GET');
      assert.equal(options.redirect,'error');
      return new Response(JSON.stringify({keys:[key]}));
    };
    const env={
      DB,OWNER_ID:owner,OIDC_ISSUER:issuer,OIDC_AUDIENCE:audience,OIDC_JWKS_URL:jwks,
    };
    const a=await signed('android-A'),b=await signed('android-B');
    const req=(t,path,method='GET',body)=>new Request(base+path,{
      method,headers:{authorization:'Bearer '+t,...(body?{'content-type':'application/json'}:{})},
      body:body?JSON.stringify(body):undefined,
    });
    const draft=crypto.randomUUID();
    const create=await worker.fetch(req(a,'/v1/sync/monitors','POST',{
      clientDraftId:draft,repository:'python/cpython',intervalMinutes:30,
    }),env);
    assert.equal(create.status,201);
    const first=(await create.json()).monitor;
    assert.equal(first.status,'PAUSED');
    assert.equal(first.clientDraftId,draft);
    const path='/v1/sync/monitors/'+first.id;
    const denied=await worker.fetch(req(a,path,'PATCH',{status:'ACTIVE',expectedVersion:1}),env);
    assert.equal(denied.status,409);
    assert.equal((await denied.json()).error,'scheduler_disabled');
    assert.equal((await worker.fetch(req(b,path,'PATCH',{status:'PAUSED',expectedVersion:1}),env)).status,404);
    assert.equal((await worker.fetch(req(b,'/v1/sync/observations?monitorId='+first.id),env)).status,404);
    env.MOBILE_SCHEDULING_ENABLED='true';
    const accepted=await worker.fetch(req(a,path,'PATCH',{status:'ACTIVE',expectedVersion:1}),env);
    assert.equal(accepted.status,200);
    const ack=await accepted.json();
    assert.deepEqual(ack,{id:first.id,status:'ACTIVE',version:2,schedulerEligible:true});
    assert.equal((await worker.fetch(req(a,path,'PATCH',{status:'ACTIVE',expectedVersion:1}),env)).status,409);
    const report=await runScheduler(env,Date.now()+1000,fakeGithub(headA));
    assert.equal(report.claimed,1);
    assert.equal(report.completed,1);
    assert.equal(report.observations,1);
    const read=await worker.fetch(req(a,'/v1/sync/observations?monitorId='+first.id),env);
    assert.equal(read.status,200);
    const events=(await read.json()).observations;
    assert.equal(events.length,1);
    assert.equal(events[0].monitor_id,first.id);
    assert.equal(events[0].event_type,'BASELINE');
    assert.equal(events[0].previous_sha,null);
    assert.equal(events[0].head_sha,headA);
    assert.ok(events[0].observed_at>0);
    const list=await worker.fetch(req(a,'/v1/sync/monitors'),env);
    assert.equal(list.status,200);
    const latest=(await list.json()).monitors[0];
    assert.equal(latest.id,first.id);
    assert.equal(latest.status,'ACTIVE');
    assert.equal(latest.lastSha,headA);
    const paused=await worker.fetch(req(a,path,'PATCH',{status:'PAUSED',expectedVersion:latest.version}),env);
    assert.equal(paused.status,200);
    assert.deepEqual(await paused.json(),{
      id:first.id,status:'PAUSED',version:latest.version+1,schedulerEligible:false,
    });
    assert.equal((await runScheduler(env,Date.now()+40*60000,fakeGithub(headB))).claimed,0);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM observations').first()).n,1);
  } finally {
    globalThis.fetch=originalFetch;
    if(platform)await platform.dispose();
    rmSync(dir,{recursive:true,force:true});
  }
});


test('Local workerd/D1: public JWKS cache reuses keys across two separately owned signed-user requests', {timeout:90000}, async()=>{
  const dir=mkdtempSync(join(tmpdir(),'naraya-d1-jwks-cache-'));
  let platform;
  const oldFetch=globalThis.fetch;
  const oldCaches=Object.getOwnPropertyDescriptor(globalThis,'caches');
  try {
    platform=await setupPlatform(dir);
    const DB=platform.env.DB;
    await applySchema(DB);
    const RSA={name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'};
    const pair=await crypto.subtle.generateKey(RSA,true,['sign','verify']);
    const key={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'cached-local-key',alg:'RS256',use:'sig'};
    const iss='https://google.example.invalid',aud='pocket-agent-test',jwks='https://keys.example.invalid/jwks';
    const enc=obj=>Buffer.from(JSON.stringify(obj)).toString('base64url');
    const signed=async sub=>{
      const now=Math.floor(Date.now()/1000);
      const text=enc({alg:'RS256',kid:'cached-local-key'})+'.'+enc({iss,aud,sub,iat:now-30,exp:now+1200});
      const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(text));
      return text+'.'+Buffer.from(sig).toString('base64url');
    };
    let jwksCalls=0,opens=0;
    globalThis.fetch=async (url,opts)=>{
      assert.equal(url,jwks);
      assert.equal(opts.method,'GET');
      assert.equal(opts.redirect,'error');
      jwksCalls++;
      return new Response(JSON.stringify({keys:[key]}),{
        headers:{'Cache-Control':'public, max-age=300'},
      });
    };
    const cacheStore=new Map();
    Object.defineProperty(globalThis,'caches',{
      configurable:true,
      value:{async open(namespace){
        opens++;
        assert.equal(namespace,'naraya-pocket-agent-public-jwks-v1');
        return {
          async match(request){return cacheStore.get(request.url)?.clone()},
          async put(request,response){cacheStore.set(request.url,response.clone())},
        };
      }},
    });
    const env={DB,OIDC_ISSUER:iss,OIDC_AUDIENCE:aud,OIDC_JWKS_URL:jwks};
    const tokenA=await signed('google-a'),tokenB=await signed('google-b');
    const get=token=>worker.fetch(new Request(base+'/v1/sync/monitors',{
      headers:{authorization:'Bearer '+token},
    }),env);
    const a=await get(tokenA),b=await get(tokenB);
    assert.equal(a.status,200);
    assert.equal(b.status,200);
    assert.deepEqual(await a.json(),{monitors:[]});
    assert.deepEqual(await b.json(),{monitors:[]});
    assert.equal((await DB.prepare('SELECT COUNT(DISTINCT id) AS n FROM user_identities').first()).n,2);
    assert.equal(jwksCalls,1,'same configured public key can serve both independently signed users');
    assert.equal(opens,2,'Cache API discovered on each request, no shared Promise');
    assert.equal(cacheStore.size,1);
    const raw=await cacheStore.get(jwks).clone().text();
    assert.ok(!raw.includes('google-a'));
    assert.ok(!raw.includes('google-b'));
    assert.ok(!raw.includes('Bearer'));
  } finally {
    globalThis.fetch=oldFetch;
    if(oldCaches)Object.defineProperty(globalThis,'caches',oldCaches);
    else delete globalThis.caches;
    if(platform)await platform.dispose();
    rmSync(dir,{recursive:true,force:true});
  }
});


test('Cloudflare local D1: 3 global fetch reservations survive overlapping calls and process restart', {timeout:90000}, async()=>{
  const dir=mkdtempSync(join(tmpdir(),'naraya-d1-global-budget-'));
  let platform;
  try {
    platform=await setupPlatform(dir);
    const DB=platform.env.DB;
    await applySchema(DB);
    const now=Date.now();
    const when=Math.ceil(now/900_000)*900_000+1000;
    const repositories=['python/cpython','nodejs/node','microsoft/vscode',
      'cloudflare/workers-sdk','denoland/deno','rust-lang/rust'];
    for(let i=0;i<repositories.length;i++){
      const id=crypto.randomUUID(),ownerId=crypto.randomUUID();
      await DB.prepare('INSERT INTO user_identities(id,issuer,subject,created_at) VALUES(?,?,?,?)')
        .bind(ownerId,'https://signed-user.test','budget-'+i,now).run();
      const [repoOwner,repoName]=repositories[i].split('/');
      await DB.prepare(
        "INSERT INTO monitors(id,owner_id,repo_owner,repo_name,status,interval_minutes,next_due_at,created_at,updated_at,client_draft_id,sync_request_digest) "+
        "VALUES(?,?,?,?,'ACTIVE',30,?,?,?,?,?)"
      ).bind(id,ownerId,repoOwner,repoName,now,now,now,crypto.randomUUID(),'fixture-digest').run();
    }
    const config={DB,OWNER_ID:owner,MOBILE_SCHEDULING_ENABLED:'true'};
    let calls=0,release,entered;
    const gateway=new Promise(resolve=>release=resolve);
    const inFlight=new Promise(resolve=>entered=resolve);
    const provider=async(url,options)=>{
      assert.equal(options.method,'GET');
      assert.equal(new URL(url).hostname,'api.github.com');
      calls++;
      if(calls===1){entered();await gateway;}
      return new Response(JSON.stringify([{sha:headA}]),{status:200});
    };
    const first=runScheduler(config,when,provider);
    try {
      await inFlight;
      const second=await runScheduler({...config},when,provider);
      assert.equal(second.claimed,2);
      assert.equal(calls,3);
      const budget=await DB.prepare(
        'SELECT budget_window_start,budget_claims,last_owner_id FROM scheduler_control WHERE id=1').first();
      assert.equal(budget.budget_claims,3);
      assert.equal(budget.budget_window_start,Math.floor(when/900_000)*900_000);
      assert.ok(budget.last_owner_id);
    } finally {release?.();}
    assert.equal((await first).claimed,1);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM observations').first()).n,3);
    await platform.dispose();platform=null;
    platform=await setupPlatform(dir);
    const restartedDB=platform.env.DB;
    assert.equal((await restartedDB.prepare(
      'SELECT budget_claims FROM scheduler_control WHERE id=1').first()).budget_claims,3);
    const again=await runScheduler({...config,DB:restartedDB},when,provider);
    assert.equal(again.claimed,0,'restarting same window cannot create more provider calls');
    assert.equal(calls,3);
    const later=await runScheduler({...config,DB:restartedDB},when+900_000,provider);
    assert.equal(later.claimed,3);
    assert.equal(calls,6);
    assert.equal((await restartedDB.prepare('SELECT COUNT(*) AS n FROM observations').first()).n,6);
    assert.equal((await restartedDB.prepare(
      'SELECT budget_claims FROM scheduler_control WHERE id=1').first()).budget_claims,3);
  } finally {
    if(platform)await platform.dispose();
    rmSync(dir,{recursive:true,force:true});
  }
});

test('Cloudflare local D1: additive 0004 migration retains legacy cursor and operator monitor', {timeout:90000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'naraya-d1-budget-migration-'));
  let platform;
  try {
    platform=await setupPlatform(dir);
    const DB=platform.env.DB;
    for(const schema of migrationSql.slice(0,3))await applyStatements(DB,schema);
    const now=Date.now(),id=crypto.randomUUID();
    await DB.prepare("UPDATE scheduler_control SET last_owner_id=? WHERE id=1")
      .bind('legacy-owner-cursor').run();
    await DB.prepare(
      "INSERT INTO monitors(id,owner_id,repo_owner,repo_name,interval_minutes,next_due_at,created_at,updated_at) "+
      "VALUES(?,?,?, ?,30,?,?,?)"
    ).bind(id,owner,'python','cpython',now,now,now).run();
    await applyStatements(DB,migrationSql[3]);
    const control=await DB.prepare('SELECT * FROM scheduler_control WHERE id=1').first();
    assert.equal(control.last_owner_id,'legacy-owner-cursor');
    assert.equal(control.budget_window_start,0);
    assert.equal(control.budget_claims,0);
    const monitor=await DB.prepare('SELECT * FROM monitors WHERE id=?').bind(id).first();
    assert.equal(monitor.owner_id,owner);
    assert.equal(monitor.status,'ACTIVE');
    assert.equal(monitor.version,1);
    const env={DB,OWNER_ID:owner};
    const report=await runScheduler(env,now+1000,fakeGithub(headA));
    assert.equal(report.claimed,1);
    assert.equal((await DB.prepare('SELECT budget_claims FROM scheduler_control WHERE id=1').first()).budget_claims,1);
  } finally {
    if(platform)await platform.dispose();
    rmSync(dir,{recursive:true,force:true});
  }
});



test('Cloudflare local D1: default-off Cron handler does not claim, reserve, or call GitHub', {timeout:90000}, async()=>{
  const dir=mkdtempSync(join(tmpdir(),'naraya-d1-cron-off-'));
  let platform, providerCalls=0, logged=[];
  const originalFetch=globalThis.fetch, originalLog=console.log;
  try {
    platform=await setupPlatform(dir);
    const DB=platform.env.DB;
    await applySchema(DB);
    const now=Date.now(),id=crypto.randomUUID();
    await DB.prepare(
      "INSERT INTO monitors(id,owner_id,repo_owner,repo_name,interval_minutes,next_due_at,created_at,updated_at) "+
      "VALUES(?,?,?,?,30,?,?,?)"
    ).bind(id,owner,'python','cpython',now-1000,now,now).run();
    globalThis.fetch=async()=>{providerCalls++;throw new Error('unexpected-provider-call')};
    console.log=(line)=>logged.push(String(line));
    for(const schedulerFlag of [undefined,'false','TRUE','true ','1']){
      await worker.scheduled({scheduledTime:now},{
        DB,OWNER_ID:owner,SCHEDULER_ENABLED:schedulerFlag,MOBILE_SCHEDULING_ENABLED:'true',
      });
    }
    assert.equal(providerCalls,0);
    assert.equal(logged.length,5);
    for(const line of logged)assert.deepEqual(JSON.parse(line),{event:'scheduled_disabled'});
    const monitor=await DB.prepare('SELECT status,lease_token,version,last_sha FROM monitors WHERE id=?')
      .bind(id).first();
    assert.equal(monitor.status,'ACTIVE');
    assert.equal(monitor.lease_token,null);
    assert.equal(monitor.last_sha,null);
    assert.equal(monitor.version,1);
    const budget=await DB.prepare('SELECT budget_claims FROM scheduler_control WHERE id=1').first();
    assert.equal(budget.budget_claims,0);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM observations').first()).n,0);
  } finally {
    globalThis.fetch=originalFetch;
    console.log=originalLog;
    if(platform)await platform.dispose();
    rmSync(dir,{recursive:true,force:true});
  }
});
