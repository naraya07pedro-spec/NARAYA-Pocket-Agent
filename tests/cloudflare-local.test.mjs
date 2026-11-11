import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPlatformProxy } from 'wrangler';
import worker from '../worker/src/index.ts';
import { runScheduler } from '../worker/src/scheduler.ts';
import { advanceSyntheticTask } from '../worker/src/task-runtime.ts';

const configPath = fileURLToPath(new URL('../worker/wrangler.local.jsonc', import.meta.url));
const migrations = ['0001_initial.sql', '0002_mobile_identity_sync.sql', '0003_scheduler_control.sql', '0004_global_scheduler_budget.sql', '0005_observation_event_sequence.sql', '0006_synthetic_approval_intents.sql', '0007_synthetic_lead_intake.sql', '0008_durable_task_runtime.sql', '0009_task_bound_effect_intents.sql'];
const migrationSql = migrations.map(name => readFileSync(new URL('../worker/migrations/'+name, import.meta.url), 'utf8'));
async function applyStatements(DB, source) {
  // Prepare whole CREATE TRIGGER ... BEGIN ... END; blocks as one SQLite
  // statement; naive semicolon splitting breaks trigger bodies and atomics.
  // D1.exec is unsuitable here because multiline input differs by runtime.
  const lines=source.split('\n').filter(line=>!line.trimStart().startsWith('--'));
  const statements=[];
  let pending='',insideTrigger=false;
  for(const line of lines){
    const trimmed=line.trim();
    if(!pending.trim()&&/^CREATE TRIGGER\b/i.test(trimmed))insideTrigger=true;
    pending+=line+'\n';
    if(insideTrigger){
      if(trimmed==='END;'){
        statements.push(pending.trim());
        pending='';insideTrigger=false;
      }
    }else{
      const parts=pending.split(';');
      for(const sql of parts.slice(0,-1))if(sql.trim())statements.push(sql.trim());
      pending=parts.at(-1)??'';
    }
  }
  assert.equal(pending.trim(),'','migration contains incomplete statement');
  assert.equal(insideTrigger,false);
  assert.ok(statements.length >= 2);
  for(const statement of statements) await DB.prepare(statement).run();
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
  const issuer='https://accounts.google.com';
  const googleAndroidClient='1234567890-approvedandroid.apps.googleusercontent.com';
  const settings={OIDC_ISSUER:issuer,OIDC_AUDIENCE:'1234567890-backendweb.apps.googleusercontent.com',
    // Official Google keys origin is pinned; fetch is intercepted with a
    // synthetic RSA fixture (no real Google account/key access in this test).
    OIDC_JWKS_URL:'https://www.googleapis.com/oauth2/v3/certs',
    OIDC_AUTHORIZED_PRESENTERS:googleAndroidClient};
  const pair=await crypto.subtle.generateKey({
    name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
    publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256',
  },true,['sign','verify']);
  const jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'fixture-key',use:'sig',alg:'RS256'};
  const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
  const jwt=async(subject,claimedIssuer=issuer,azp=undefined)=>{
    const now=Math.floor(Date.now()/1000);
    const input=encode({alg:'RS256',kid:'fixture-key',typ:'JWT'})+'.'+
      encode({iss:claimedIssuer,aud:settings.OIDC_AUDIENCE,sub:subject,
        ...(azp?{azp}:{}),iat:now-30,exp:now+1200});
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
    // Google permits a legacy issuer spelling and different authorized Android
    // presenter. Both MUST map to the same canonical owner after a restart.
    const androidLegacy=await jwt('test-A','accounts.google.com',googleAndroidClient);
    const body={clientDraftId:id,repository:'python/cpython',intervalMinutes:30};
    const env={DB:platform.env.DB,...settings};
    // A valid self-signed token with Google iss must NOT be allowed to
    // register an identity via a wrong, attacker-owned JWKS endpoint.
    const invalidIssuerKeys={...env,OIDC_JWKS_URL:'https://attacker.invalid/jwks.json'};
    const denied=await worker.fetch(request(a,'POST','/v1/sync/monitors',body),invalidIssuerKeys);
    assert.equal(denied.status,503);
    assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM user_identities').first()).n,0);
    assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM monitors').first()).n,0);
    const first=await worker.fetch(request(a,'POST','/v1/sync/monitors',body),env);
    assert.equal(first.status,201);
    const monitor=(await first.json()).monitor;
    assert.equal(monitor.status,'PAUSED');
    assert.equal(monitor.scheduled,false);
    assert.equal((await(await worker.fetch(request(b),env)).json()).monitors.length,0);
    assert.equal((await worker.fetch(request(b,'GET','/v1/sync/observations?monitorId='+monitor.id),env)).status,404);
    const mapped=await env.DB.prepare('SELECT COUNT(*) AS n FROM user_identities').first();
    assert.equal(mapped.n,1,'signed foreign GET must not register an identity');
    await platform.dispose(); platform=null;
    platform=await setupPlatform(dir);
    const restarted={DB:platform.env.DB,...settings};
    const retry=await worker.fetch(request(androidLegacy,'POST','/v1/sync/monitors',body),restarted);
    assert.equal(retry.status,200);
    assert.equal((await retry.json()).monitor.id,monitor.id);
    const reread=await worker.fetch(request(androidLegacy),restarted);
    assert.equal(reread.status,200);
    assert.equal((await reread.json()).monitors[0].id,monitor.id,
      'legacy Google issuer and approved Android azp must reuse existing D1 identity');
    assert.equal((await restarted.DB.prepare('SELECT COUNT(*) AS n FROM monitors').first()).n,1);
    assert.equal((await restarted.DB.prepare('SELECT COUNT(*) AS n FROM user_identities').first()).n,1);
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
    let actualProviderReads=0;
    globalThis.fetch=async (url,options)=>{
      assert.equal(options.method,'GET');
      assert.equal(options.redirect,'error');
      if(url===jwks)return new Response(JSON.stringify({keys:[key]}));
      assert.equal(new URL(url).hostname,'api.github.com');
      assert.equal(new URL(url).pathname,'/repos/python/cpython/commits');
      actualProviderReads++;
      return new Response(JSON.stringify([{sha:headA}]),{status:200});
    };
    const env={
      DB,OWNER_ID:owner,OIDC_ISSUER:issuer,OIDC_AUDIENCE:audience,OIDC_JWKS_URL:jwks,
    };
    const a=await signed('android-A'),b=await signed('android-B');
    const req=(t,path,method='GET',body)=>new Request(base+path,{
      method,headers:{authorization:'Bearer '+t,...(body?{'content-type':'application/json'}:{})},
      body:body?JSON.stringify(body):undefined,
    });
    // First signed-user list is read-only and must NOT consume a D1 user slot.
    const unknown=await worker.fetch(req(b,'/v1/sync/monitors'),env);
    assert.equal(unknown.status,200);
    assert.deepEqual(await unknown.json(),{monitors:[]});
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM user_identities').first()).n,0);
    const invalid=await worker.fetch(req(b,
      '/v1/sync/observations?monitorId=not-a-valid-uuid'),env);
    assert.equal(invalid.status,400);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM user_identities').first()).n,0);
    const draft=crypto.randomUUID();
    // Real local workerd/D1 must roll back a first identity when a later
    // statement in the SAME batch fails, not only under the Node SQLite mock.
    const forcedFailure={...env,DB:{
      prepare(sql){return DB.prepare(sql);},
      batch(stmts){
        assert.equal(stmts.length,3);
        // This is a VALID SQL statement that MUST fail only after the
        // previous batch statement has inserted the same issuer/subject.
        // It therefore proves rollback after an executed first write.
        return DB.batch([stmts[0],DB.prepare(
          'INSERT INTO user_identities(id,issuer,subject,created_at) '+
          'SELECT id,issuer,subject,created_at FROM user_identities WHERE issuer=? AND subject=?'
        ).bind(issuer,'android-A')]);
      },
    }};
    const aborted=await worker.fetch(req(a,'/v1/sync/monitors','POST',{
      clientDraftId:draft,repository:'python/cpython',intervalMinutes:30,
    }),forcedFailure);
    assert.equal(aborted.status,500);
    assert.deepEqual(await aborted.json(),{error:'internal_error'});
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM user_identities').first()).n,0,
      'local D1 transaction must roll back registration when monitor operation errors');
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM monitors').first()).n,0);
    const create=await worker.fetch(req(a,'/v1/sync/monitors','POST',{
      clientDraftId:draft,repository:'python/cpython',intervalMinutes:30,
    }),env);
    assert.equal(create.status,201);
    const first=(await create.json()).monitor;
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM user_identities').first()).n,1);
    for(let repeat=0;repeat<5;repeat++){
      assert.equal((await worker.fetch(req(a,'/v1/sync/monitors'),env)).status,200);
    }
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM user_identities').first()).n,1);
    assert.equal(first.status,'PAUSED');
    assert.equal(first.clientDraftId,draft);
    const path='/v1/sync/monitors/'+first.id;
    const denied=await worker.fetch(req(a,path,'PATCH',{status:'ACTIVE',expectedVersion:1}),env);
    assert.equal(denied.status,409);
    assert.equal((await denied.json()).error,'scheduler_disabled');
    assert.equal((await worker.fetch(req(b,path,'PATCH',{status:'PAUSED',expectedVersion:1}),env)).status,404);
    assert.equal((await worker.fetch(req(b,'/v1/sync/observations?monitorId='+first.id),env)).status,404);
    env.MOBILE_SCHEDULING_ENABLED='true';
    const halfEnabled=await worker.fetch(req(a,path,'PATCH',{status:'ACTIVE',expectedVersion:1}),env);
    assert.equal(halfEnabled.status,409,'mobile flag alone cannot bypass global Cron kill-switch');
    assert.deepEqual(await halfEnabled.json(),{error:'scheduler_disabled'});
    assert.equal((await DB.prepare('SELECT status,version FROM monitors WHERE id=?').bind(first.id).first()).version,1);
    env.SCHEDULER_ENABLED='true';
    const accepted=await worker.fetch(req(a,path,'PATCH',{status:'ACTIVE',expectedVersion:1}),env);
    assert.equal(accepted.status,200);
    const ack=await accepted.json();
    assert.deepEqual(ack,{id:first.id,status:'ACTIVE',version:2,schedulerEligible:true});
    assert.equal((await worker.fetch(req(a,path,'PATCH',{status:'ACTIVE',expectedVersion:1}),env)).status,409);
    // Exercise the actual exported Worker scheduled entrypoint (not only the
    // test-injected runScheduler), with separately verified RSA user identity.
    const oldLog=console.log,lines=[];
    try {
      console.log=line=>lines.push(String(line));
      await worker.scheduled({scheduledTime:Date.now()},env);
    }finally{console.log=oldLog;}
    const report=JSON.parse(lines.at(-1));
    assert.equal(report.event,'scheduled_tick');
    assert.equal(report.claimed,1);
    assert.equal(report.completed,1);
    assert.equal(report.observations,1);
    assert.equal(actualProviderReads,1);
    assert.ok(Array.isArray(report.observationIds));
    assert.equal(report.observationIds.length,1);
    const read=await worker.fetch(req(a,'/v1/sync/observations?monitorId='+first.id),env);
    assert.equal(read.status,200);
    const events=(await read.json()).observations;
    assert.equal(events.length,1);
    assert.deepEqual(report.observationIds,[events[0].id],
      'real local D1 row ID must match the only logged Cron observation ID');
    assert.equal(Object.hasOwn(report,'lease_token'),false);
    assert.equal(Object.hasOwn(report,'owner_id'),false);
    assert.equal(Object.hasOwn(report,'monitor_id'),false);
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
    assert.equal((await DB.prepare('SELECT COUNT(DISTINCT id) AS n FROM user_identities').first()).n,0,'read-only signed JWT probes must not register identities');
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
    // P1-M must refuse provider I/O with schema only up to 0004.
    let fetches=0;
    await assert.rejects(runScheduler(env,now+1000,async()=>{
      fetches++;return fakeGithub(headA)();
    }),/no such column|event_sequence/i);
    assert.equal(fetches,0);
    await applyStatements(DB,migrationSql[4]);
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


test('Cloudflare local D1: sequence disambiguates three identical-ms Cron observations and survives restart',{timeout:90000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'naraya-d1-observation-sequence-'));
  let platform;
  try{
    platform=await setupPlatform(dir);
    const DB=platform.env.DB;
    await applySchema(DB);
    const env={DB,OWNER_ID:owner,OWNER_API_TOKEN:TOKEN};
    const response=await worker.fetch(new Request(base+'/v1/monitors',{
      method:'POST',headers:{...auth,'content-type':'application/json'},
      body:JSON.stringify({repository:'python/cpython',intervalMinutes:30}),
    }),env);
    assert.equal(response.status,201);
    const {id}=await response.json();
    const at=Date.now()+1000;
    for(const letter of ['a','b','c']){
      // Explicit test-only due reset allows three separate local invocations
      // with the SAME fake clock, exercising equal observed_at milliseconds.
      const due=await DB.prepare('UPDATE monitors SET next_due_at=? WHERE id=?')
        .bind(at-1,id).run();
      assert.equal(due.meta.changes,1);
      const report=await runScheduler(env,at,fakeGithub(letter.repeat(40)));
      assert.equal(report.claimed,1);
      assert.equal(report.observations,1);
    }
    let data=(await DB.prepare('SELECT event_sequence,event_type,previous_sha,head_sha,observed_at FROM observations WHERE monitor_id=? ORDER BY event_sequence DESC').bind(id).all()).results;
    assert.deepEqual(data.map(e=>e.event_sequence),[3,2,1]);
    assert.deepEqual(data.map(e=>e.event_type),['CHANGE','CHANGE','BASELINE']);
    assert.ok(data.every(e=>e.observed_at===at));
    assert.equal(data[0].previous_sha,data[1].head_sha);
    assert.equal(data[1].previous_sha,data[2].head_sha);
    await platform.dispose();
    platform=null;
    platform=await setupPlatform(dir);
    const again=(await platform.env.DB.prepare('SELECT event_sequence,event_type,previous_sha,head_sha,observed_at FROM observations WHERE monitor_id=? ORDER BY event_sequence DESC').bind(id).all()).results;
    assert.deepEqual(again,data,'D1 persisted causal order must survive Worker process recreation');
  }finally{
    if(platform)await platform.dispose();
    rmSync(dir,{recursive:true,force:true});
  }
});


test('P2-C real local workerd D1: bounded task steps, durable restart and owner quota',{timeout:90000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'naraya-d1-task-runtime-'));
  let platform;
  try{
    platform=await setupPlatform(dir);
    const db=platform.env.DB;
    await applySchema(db);
    const user=crypto.randomUUID(),leadId=crypto.randomUUID(),taskId=crypto.randomUUID();
    const stamp=Date.now(),hash='b'.repeat(64);
    await db.prepare('INSERT INTO user_identities(id,issuer,subject,created_at) VALUES(?,?,?,?)')
      .bind(user,'https://synthetic.example.invalid','workerd-test',stamp).run();
    await db.prepare(`INSERT INTO synthetic_leads(
      id,owner_id,client_lead_id,source,service_code,budget_band,days_to_deadline,
      priority,reply_draft,input_digest,created_at
    ) VALUES(?,?,?,'SYNTHETIC_FORM','SIGNAGE','MID',45,
      'STANDARD_REVIEW','Synthetic response draft only',?,?)`)
      .bind(crypto.randomUUID(),user,leadId,hash,stamp).run();
    await db.prepare(`INSERT INTO task_runs(id,owner_id,client_task_id,kind,
      client_lead_id,lead_input_digest,status,current_step,version,created_at,updated_at)
      VALUES(?,?,?,'SYNTHETIC_LEAD_TRIAGE_V1',?,?,'QUEUED',0,1,?,?)`)
      .bind(taskId,user,crypto.randomUUID(),leadId,hash,stamp,stamp).run();
    for(const [index,code] of ['VERIFY_LEAD','VERIFY_TRIAGE','VERIFY_DRAFT'].entries()){
      await db.prepare(`INSERT INTO task_steps(id,task_id,step_index,step_code,status,updated_at)
        VALUES(?,?,?,?,?,?)`)
        .bind(crypto.randomUUID(),taskId,index,code,index===0?'READY':'WAITING',stamp).run();
    }
    let result=await advanceSyntheticTask({DB:db},user,taskId,1,stamp+100);
    assert.equal(result.status,200);
    let task=(await result.json()).task;
    assert.equal(task.status,'RUNNING');assert.equal(task.currentStep,1);
    assert.equal((await db.prepare('SELECT claims FROM task_step_budgets WHERE owner_id=?')
      .bind(user).first()).claims,1);
    await platform.dispose();platform=null;
    platform=await setupPlatform(dir);
    const persisted=platform.env.DB;
    const saved=await persisted.prepare('SELECT version,current_step FROM task_runs WHERE id=?')
      .bind(taskId).first();
    assert.equal(saved.current_step,1);
    result=await advanceSyntheticTask({DB:persisted},user,taskId,saved.version,stamp+200);
    assert.equal(result.status,200);
    task=(await result.json()).task;
    assert.equal(task.currentStep,2);
    result=await advanceSyntheticTask({DB:persisted},user,taskId,task.version,stamp+300);
    assert.equal(result.status,200);
    const final=await result.json();
    assert.equal(final.task.status,'SUCCEEDED');
    assert.equal(final.task.currentStep,3);
    assert.deepEqual(final.steps.map(s=>s.status),
      ['SUCCEEDED','SUCCEEDED','SUCCEEDED']);
    assert.equal((await persisted.prepare('SELECT claims FROM task_step_budgets WHERE owner_id=?')
      .bind(user).first()).claims,3);
    assert.equal((await persisted.prepare('SELECT COUNT(*) AS n FROM audit_events').first()).n,0);
    assert.equal((await persisted.prepare('SELECT COUNT(*) AS n FROM observations').first()).n,0);
  }finally{
    if(platform)await platform.dispose();
    rmSync(dir,{recursive:true,force:true});
  }
});


test('P2-D real workerd D1: approval change atomically transitions only bound immutable effect',{timeout:90000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'naraya-d1-task-effect-'));
  let platform;
  try{
    platform=await setupPlatform(dir);
    const DB=platform.env.DB;
    await applySchema(DB);
    const id=crypto.randomUUID,owner=id(),lead=id(),task=id(),
      approval=id(),effect=id(),now=Date.now();
    const leadDigest='a'.repeat(64),payloadDigest='b'.repeat(64),targetDigest='c'.repeat(64);
    await DB.prepare('INSERT INTO user_identities(id,issuer,subject,created_at) VALUES(?,?,?,?)')
      .bind(owner,'https://synthetic.example.invalid','p2d-workerd',now).run();
    await DB.prepare(`INSERT INTO synthetic_leads(
      id,owner_id,client_lead_id,source,service_code,budget_band,days_to_deadline,
      priority,reply_draft,input_digest,created_at)
      VALUES(?,?,?,'SYNTHETIC_FORM','SIGNAGE','MID',45,
      'STANDARD_REVIEW','draft never sent',?,?)`)
      .bind(id(),owner,lead,leadDigest,now).run();
    await DB.prepare(`INSERT INTO task_runs(
      id,owner_id,client_task_id,kind,client_lead_id,lead_input_digest,
      status,current_step,version,created_at,updated_at,finished_at)
      VALUES(?,?,?,'SYNTHETIC_LEAD_TRIAGE_V1',?,?,'SUCCEEDED',3,7,?,?,?)`)
      .bind(task,owner,id(),lead,leadDigest,now,now,now).run();
    for(const [i,code] of ['VERIFY_LEAD','VERIFY_TRIAGE','VERIFY_DRAFT'].entries()){
      await DB.prepare(`INSERT INTO task_steps(
        id,task_id,step_index,step_code,status,attempt_count,updated_at)
        VALUES(?,?,?,?,'SUCCEEDED',1,?)`)
        .bind(id(),task,i,code,now).run();
    }
    await DB.prepare(`INSERT INTO synthetic_approval_intents(
      id,owner_id,client_intent_id,provider,operation,target,
      payload_digest,target_digest,lead_id,service_code,status,version,
      expires_at,created_at,task_id,task_input_digest,task_version)
      VALUES(?,?,?,'SYNTHETIC_ONLY','CREATE_CRM_LEAD','synthetic-crm',
        ?,?,?,'SIGNAGE','PENDING',1,?,?,?,?,7)`)
      .bind(approval,owner,id(),payloadDigest,targetDigest,
        lead,now+600000,now,task,leadDigest).run();
    await DB.prepare(`INSERT INTO synthetic_effect_intents(
      id,owner_id,task_id,approval_id,provider,operation,target,
      client_lead_id,service_code,task_input_digest,task_version,
      payload_digest,target_digest,status,created_at)
      VALUES(?,?,?,?,'SYNTHETIC_ONLY','CREATE_CRM_LEAD','synthetic-crm',
        ?,'SIGNAGE',?,7,?,?,'AWAITING_APPROVAL',?)`)
      .bind(effect,owner,task,approval,lead,leadDigest,payloadDigest,targetDigest,now).run();
    await assert.rejects(DB.prepare(
      "UPDATE synthetic_effect_intents SET target='evil' WHERE id=?")
      .bind(effect).run(),/task_effect_immutable_payload/i);
    await assert.rejects(DB.prepare(
      "UPDATE synthetic_effect_intents SET status='APPROVED_NO_DISPATCH' WHERE id=?")
      .bind(effect).run(),/task_effect_no_independent_transition/i);
    const update=await DB.prepare(`UPDATE synthetic_approval_intents
      SET status='APPROVED_NO_DISPATCH',version=version+1,decided_at=?
      WHERE id=? AND owner_id=? AND status='PENDING'
      AND payload_digest=? AND target_digest=?`)
      .bind(now+10,approval,owner,payloadDigest,targetDigest).run();
    assert.equal(update.meta.changes,1);
    assert.equal((await DB.prepare('SELECT status FROM synthetic_effect_intents WHERE id=?')
      .bind(effect).first()).status,'APPROVED_NO_DISPATCH');
    await platform.dispose();platform=null;
    platform=await setupPlatform(dir);
    const after=await platform.env.DB.prepare(
      'SELECT status,task_input_digest FROM synthetic_effect_intents WHERE id=?')
      .bind(effect).first();
    assert.equal(after.status,'APPROVED_NO_DISPATCH');
    assert.equal(after.task_input_digest,leadDigest);
    assert.equal((await platform.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM synthetic_effect_intents').first()).n,1);
  }finally{
    if(platform)await platform.dispose();
    rmSync(dir,{recursive:true,force:true});
  }
});
