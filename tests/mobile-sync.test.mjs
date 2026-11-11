import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {makeTestDb} from './sqlite-d1.mjs';
import worker from '../worker/src/index.ts';
import {runScheduler} from '../worker/src/scheduler.ts';

const issuer = 'https://login.example.invalid';
const jwks = 'https://keys.example.invalid/jwks';
const audience = 'pocket-agent-mobile-test';
const settings = {OIDC_ISSUER:issuer,OIDC_AUDIENCE:audience,OIDC_JWKS_URL:jwks};
const base = 'https://local.example.invalid';
const encode = x => Buffer.from(typeof x==='string'?x:JSON.stringify(x)).toString('base64url');
const RSA = {name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'};
const pair = await crypto.subtle.generateKey(RSA,true,['sign','verify']);
const key = {...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'mobile-key',alg:'RS256',use:'sig'};
const fakeJwks = async (url, options) => {
  assert.equal(url,jwks);
  assert.equal(options.method,'GET');
  assert.equal(options.redirect,'error');
  return new Response(JSON.stringify({keys:[key]}));
};
let sequence=0;
const uuid=()=>`00000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`;
async function token(sub, overrides={}) {
  const now=Math.floor(Date.now()/1000);
  const payload={iss:issuer,aud:audience,sub,iat:now-30,exp:now+1200,...overrides};
  const head=encode({alg:'RS256',kid:'mobile-key',typ:'JWT'});
  const body=encode(payload);
  const message=head+'.'+body;
  const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(message));
  return message+'.'+Buffer.from(signature).toString('base64url');
}
function makeEnv() {return {...settings,DB:makeTestDb(),OWNER_API_TOKEN:'synthetic-operator-token-which-is-over-32-characters',OWNER_ID:'pilot-operator'};}
function req(path, t, method='GET', data) {
  return new Request(base+path,{method,headers:{authorization:'Bearer '+t,...(data ? {'content-type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
}
const request = (env,path,t,method='GET',data)=>worker.fetch(req(path,t,method,data),env);
const create = (env,t,clientDraftId,repository='python/cpython',intervalMinutes=30)=>
  request(env,'/v1/sync/monitors',t,'POST',{clientDraftId,repository,intervalMinutes});
const monitors = env=>env.DB.connection.prepare('SELECT * FROM monitors ORDER BY id').all();
const identities = env=>env.DB.connection.prepare('SELECT * FROM user_identities ORDER BY id').all();

test('A and B are isolated by SQL owner; tokens never grant operator API access',async()=>{
  const previous=globalThis.fetch;globalThis.fetch=fakeJwks;
  const env=makeEnv();
  try {
    const a=await token('user-A'), b=await token('user-B');
    const id=uuid();
    const result=await create(env,a,id);
    assert.equal(result.status,201);
    const item=(await result.json()).monitor;
    assert.equal(item.status,'PAUSED');
    assert.equal(item.scheduled,false);
    assert.equal(item.clientDraftId,id);
    assert.equal((await(await request(env,'/v1/sync/monitors',a)).json()).monitors.length,1);
    assert.equal((await(await request(env,'/v1/sync/monitors',b)).json()).monitors.length,0);
    assert.equal((await request(env,'/v1/sync/observations?monitorId='+item.id,b)).status,404);
    assert.equal((await request(env,'/v1/sync/observations?monitorId='+item.id,a)).status,200);
    assert.equal((await request(env,'/v1/monitors',a)).status,401);
    assert.equal(identities(env).length,1,'B did not register by reading an empty list or foreign monitor');
    const bRegistered=await create(env,b,uuid(),'nodejs/node');
    assert.equal(bRegistered.status,201);
    assert.equal(identities(env).length,2);
    assert.notEqual(identities(env)[0].id,identities(env)[1].id);
    assert.equal((await(await request(env,'/v1/sync/monitors',a)).json()).monitors.length,1);
    assert.equal((await(await request(env,'/v1/sync/monitors',b)).json()).monitors.length,1);
    assert.ok(!JSON.stringify(item).includes('owner_id'));
  } finally {globalThis.fetch=previous;env.DB.close();}
});

test('exact retry returns original server monitor ID and never creates second monitor',async()=>{
  const previous=globalThis.fetch;globalThis.fetch=fakeJwks;
  const env=makeEnv();
  try {
    const t=await token('same-user'), clientDraftId=uuid();
    const one=await create(env,t,clientDraftId,'PYTHON/CPYTHON',30);
    const two=await create(env,t,clientDraftId,'python/cpython',30);
    assert.equal(one.status,201);assert.equal(two.status,200);
    const a=await one.json(), b=await two.json();
    assert.equal(a.monitor.id,b.monitor.id);
    assert.equal(a.created,true);assert.equal(b.created,false);
    assert.equal(monitors(env).length,1);
    assert.equal(identities(env).length,1);
    assert.equal(monitors(env)[0].sync_request_digest.length,64);
  } finally {globalThis.fetch=previous;env.DB.close();}
});

test('client draft ID reused with different content fails without mutation',async()=>{
  const previous=globalThis.fetch;globalThis.fetch=fakeJwks;
  const env=makeEnv();
  try {
    const t=await token('same-user'), draft=uuid();
    assert.equal((await create(env,t,draft)).status,201);
    const before=monitors(env)[0];
    const r=await create(env,t,draft,'python/cpython',45);
    assert.equal(r.status,409);
    assert.deepEqual(await r.json(),{error:'draft_id_payload_conflict'});
    assert.deepEqual(monitors(env),[before]);
    assert.equal((await create(env,t,uuid(),'python/cpython')).status,409);
  } finally {globalThis.fetch=previous;env.DB.close();}
});

test('per-owner quota is atomic in SQL and different users have independent limits',async()=>{
  const previous=globalThis.fetch;globalThis.fetch=fakeJwks;
  const env=makeEnv();
  try {
    const a=await token('A'), b=await token('B');
    for(const repo of ['python/cpython','nodejs/node','microsoft/vscode']){
      assert.equal((await create(env,a,uuid(),repo)).status,201);
    }
    assert.equal((await create(env,a,uuid(),'cloudflare/workers-sdk')).status,409);
    assert.equal((await create(env,b,uuid(),'python/cpython')).status,201);
    assert.equal(monitors(env).length,4);
    assert.equal((await(await request(env,'/v1/sync/monitors',a)).json()).monitors.length,3);
    assert.equal((await(await request(env,'/v1/sync/monitors',b)).json()).monitors.length,1);
  } finally {globalThis.fetch=previous;env.DB.close();}
});

test('forged, expired, wrong audience and missing auth cannot make identity or monitor',async()=>{
  const previous=globalThis.fetch;globalThis.fetch=fakeJwks;
  const env=makeEnv();
  try {
    const valid=await token('C'), expired=await token('C',{exp:Math.floor(Date.now()/1000)-3});
    const badAudience=await token('C',{aud:'another-client'});
    for(const t of ['not-a-jwt',expired,badAudience,valid.slice(0,-2)+'00']){
      const r=await create(env,t,uuid());
      assert.equal(r.status,401);
    }
    const noHeader=await worker.fetch(new Request(base+'/v1/sync/monitors'),env);
    assert.equal(noHeader.status,401);
    assert.equal(identities(env).length,0);
    assert.equal(monitors(env).length,0);
  } finally {globalThis.fetch=previous;env.DB.close();}
});

test('reject unexpected client authority, malformed UUID, arbitrary URL and oversized body',async()=>{
  const previous=globalThis.fetch;globalThis.fetch=fakeJwks;
  const env=makeEnv();
  try {
    const t=await token('D');
    const cases=[
      {clientDraftId:uuid(),repository:'python/cpython',intervalMinutes:30,ownerId:'another'},
      {clientDraftId:'bad',repository:'python/cpython',intervalMinutes:30},
      {clientDraftId:uuid(),repository:'https://attacker.invalid/x',intervalMinutes:30},
      {clientDraftId:uuid(),repository:'python/cpython',intervalMinutes:1},
    ];
    for(const body of cases)assert.equal((await request(env,'/v1/sync/monitors',t,'POST',body)).status,400);
    const veryLarge=await worker.fetch(new Request(base+'/v1/sync/monitors',{
      method:'POST',headers:{Authorization:'Bearer '+t,'Content-Type':'application/json'},
      body:' '.repeat(4100),
    }),env);
    assert.equal(veryLarge.status,413);
    assert.equal(monitors(env).length,0);
  } finally {globalThis.fetch=previous;env.DB.close();}
});

test('operator legacy row does not get adopted, user row stays paused under scheduler',async()=>{
  const previous=globalThis.fetch;globalThis.fetch=fakeJwks;
  const env=makeEnv();
  try {
    const operator='synthetic-operator-token-which-is-over-32-characters';
    const old=await request(env,'/v1/monitors',operator,'POST',{repository:'nodejs/node',intervalMinutes:30});
    assert.equal(old.status,201);
    const legacy=(await old.json()).id;
    const t=await token('new-user');
    const fresh=await create(env,t,uuid(),'nodejs/node');
    assert.equal(fresh.status,201);
    const rows=monitors(env);
    assert.equal(rows.length,2);
    assert.equal(rows.find(r=>r.id===legacy).owner_id,'pilot-operator');
    assert.notEqual(rows.find(r=>r.id!==legacy).owner_id,'pilot-operator');
    const report=await runScheduler(env,Date.now()+60000,async()=>new Response('[]'));
    assert.equal(report.claimed,1); // Only legacy ACTIVE row; mobile row is PAUSED.
    assert.equal(rows.find(r=>r.id!==legacy).status,'PAUSED');
  } finally {globalThis.fetch=previous;env.DB.close();}
});

test('observation read is bound to monitor owner even if a row is inserted by test fixture',async()=>{
  const previous=globalThis.fetch;globalThis.fetch=fakeJwks;
  const env=makeEnv();
  try {
    const a=await token('ownerA'),b=await token('ownerB'), draft=uuid();
    const created=await(await create(env,a,draft)).json();
    const monitorId=created.monitor.id;
    env.DB.connection.prepare(`INSERT INTO observations(id,monitor_id,lease_token,event_type,head_sha,observed_at)
      VALUES(?,?,?,'BASELINE',?,?)`).run(uuid(),monitorId,uuid(),'a'.repeat(40),Date.now());
    const mine=await request(env,'/v1/sync/observations?monitorId='+monitorId,a);
    assert.equal(mine.status,200);
    assert.equal((await mine.json()).observations.length,1);
    const theirs=await request(env,'/v1/sync/observations?monitorId='+monitorId,b);
    assert.equal(theirs.status,404);
  } finally {globalThis.fetch=previous;env.DB.close();}
});

test('same draft concurrent retry stores one identity mapping and one monitor',async()=>{
  const previous=globalThis.fetch;globalThis.fetch=fakeJwks;
  const env=makeEnv();
  try {
    const t=await token('concurrent'), id=uuid();
    const result=await Promise.all(Array.from({length:6},()=>create(env,t,id)));
    assert.deepEqual(result.map(r=>r.status).sort(),[200,200,200,200,200,201]);
    assert.equal(identities(env).length,1);
    assert.equal(monitors(env).length,1);
  } finally {globalThis.fetch=previous;env.DB.close();}
});


test('mobile activation requires explicit scheduler flag, owner match and current version',async()=>{
  const previous=globalThis.fetch;globalThis.fetch=fakeJwks;
  const env=makeEnv();
  try {
    const a=await token('activation-A'),b=await token('activation-B');
    const first=await(await create(env,a,uuid())).json();
    const id=first.monitor.id;
    const patch=(t,status,expectedVersion)=>request(env,'/v1/sync/monitors/'+id,t,'PATCH',{status,expectedVersion});
    assert.equal((await patch(a,'ACTIVE',1)).status,409);
    assert.equal((await patch(b,'PAUSED',1)).status,404);
    env.MOBILE_SCHEDULING_ENABLED='true';
    // Mobile-only flag must NOT create pending ACTIVE jobs with global Cron OFF.
    assert.equal((await patch(a,'ACTIVE',1)).status,409);
    assert.equal(monitors(env)[0].status,'PAUSED');
    assert.equal(monitors(env)[0].version,1);
    const incomplete=(await(await request(env,'/v1/sync/monitors',a)).json()).monitors[0];
    assert.equal(incomplete.schedulerEligible,false);
    env.SCHEDULER_ENABLED='true';
    assert.equal((await patch(a,'ACTIVE',99)).status,409);
    const enabled=await patch(a,'ACTIVE',1);
    assert.equal(enabled.status,200);
    assert.equal((await enabled.json()).schedulerEligible,true);
    assert.equal((await patch(b,'ACTIVE',1)).status,404);
    assert.equal((await patch(a,'PAUSED',1)).status,409);
    assert.equal((await patch(a,'PAUSED',2)).status,200);
    assert.equal(monitors(env)[0].status,'PAUSED');
    env.MOBILE_SCHEDULING_ENABLED=undefined;
    assert.equal((await patch(a,'ACTIVE',3)).status,409);
    assert.equal((await patch(a,'PAUSED',3)).status,200);
  } finally {globalThis.fetch=previous;env.DB.close();}
});

test('scheduler preserves opt-in default-off and rotates due owners under global 3-call budget',async()=>{
  const previous=globalThis.fetch;globalThis.fetch=fakeJwks;
  const env=makeEnv();
  try {
    const repositories=['python/cpython','nodejs/node','microsoft/vscode','cloudflare/workers-sdk'];
    const owners=await Promise.all(['a','b','c','d'].map(s=>token('fair-'+s)));
    const ids=[];
    for(let i=0;i<4;i++) {
      const monitor=(await(await create(env,owners[i],uuid(),repositories[i])).json()).monitor;
      ids.push(monitor.id);
    }
    let calls=[];
    const fake=async(url,opts)=>{
      calls.push(new URL(url).pathname);
      assert.equal(opts.method,'GET');
      assert.equal(opts.redirect,'error');
      return new Response(JSON.stringify([{sha:'a'.repeat(40)}]),{status:200});
    };
    const when=Date.now()+10000;
    const disabled=await runScheduler(env,when,fake);
    assert.equal(disabled.claimed,0);
    assert.equal(calls.length,0);
    env.MOBILE_SCHEDULING_ENABLED='true';
    env.SCHEDULER_ENABLED='true';
    for(let i=0;i<4;i++){
      const r=await request(env,'/v1/sync/monitors/'+ids[i],owners[i],'PATCH',{status:'ACTIVE',expectedVersion:1});
      assert.equal(r.status,200);
    }
    const first=await runScheduler(env,when,fake);
    assert.equal(first.claimed,3);
    assert.equal(first.completed,3);
    assert.equal(first.observations,3);
    assert.equal(calls.length,3);
    assert.equal(new Set(calls).size,3);
    const unvisited=repositories.find(repo=>!calls.some(path=>path.includes('/'+repo+'/')));
    assert.ok(unvisited,'one owner must be unvisited under three-call budget');
    calls=[];
    const later=when+30*60_000+1000;
    const second=await runScheduler(env,later,fake);
    assert.equal(second.claimed,3);
    assert.equal(calls.length,3);
    assert.ok(calls[0].includes('/'+unvisited+'/'),'rotation cursor starts with previously unvisited owner');
    const counts=env.DB.connection.prepare('SELECT m.owner_id,COUNT(*) AS n FROM observations o JOIN monitors m ON m.id=o.monitor_id GROUP BY m.owner_id').all();
    assert.equal(counts.length,4,'four separate owners must eventually be served');
  } finally {globalThis.fetch=previous;env.DB.close();}
});

test('global mobile active cap of 9 prevents unbounded external reads and permits replacement',async()=>{
  const previous=globalThis.fetch;globalThis.fetch=fakeJwks;
  const env=makeEnv();env.MOBILE_SCHEDULING_ENABLED='true';env.SCHEDULER_ENABLED='true';
  try {
    const users=await Promise.all(['m0','m1','m2','m3'].map(s=>token(s)));
    const ids=[];
    for(let i=0;i<4;i++) {
      for(const repo of ['python/cpython','nodejs/node','microsoft/vscode']) {
        const monitor=(await(await create(env,users[i],uuid(),repo)).json()).monitor;
        ids.push({id:monitor.id,t:users[i]});
      }
    }
    for(let i=0;i<9;i++)
      assert.equal((await request(env,'/v1/sync/monitors/'+ids[i].id,ids[i].t,'PATCH',{status:'ACTIVE',expectedVersion:1})).status,200);
    assert.equal((await request(env,'/v1/sync/monitors/'+ids[9].id,ids[9].t,'PATCH',{status:'ACTIVE',expectedVersion:1})).status,409);
    assert.equal(env.DB.connection.prepare("SELECT COUNT(*) AS n FROM monitors WHERE status='ACTIVE'").get().n,9);
    assert.equal((await request(env,'/v1/sync/monitors/'+ids[0].id,ids[0].t,'PATCH',{status:'PAUSED',expectedVersion:2})).status,200);
    assert.equal((await request(env,'/v1/sync/monitors/'+ids[9].id,ids[9].t,'PATCH',{status:'ACTIVE',expectedVersion:1})).status,200);
  } finally {globalThis.fetch=previous;env.DB.close();}
});

test('bounded pilot identity creation rejects 21st identity, but existing account remains usable',async()=>{
  const previous=globalThis.fetch;globalThis.fetch=fakeJwks;
  const env=makeEnv();
  try {
    const first=await token('registered-0');
    for(let i=0;i<20;i++) {
      const t=i===0?first:await token('registered-'+i);
      assert.equal((await create(env,t,uuid())).status,201);
    }
    const beyond=await token('registered-20');
    const readOnly=await request(env,'/v1/sync/monitors',beyond);
    assert.equal(readOnly.status,200,'capacity must not prevent a harmless read-only empty list');
    assert.deepEqual(await readOnly.json(),{monitors:[]});
    const rejected=await create(env,beyond,uuid());
    assert.equal(rejected.status,429);
    assert.deepEqual(await rejected.json(),{error:'pilot_identity_limit'});
    assert.equal(identities(env).length,20);
    assert.equal((await request(env,'/v1/sync/monitors',first)).status,200);
  } finally {globalThis.fetch=previous;env.DB.close();}
});

test('pausing mobile task during upstream request rejects stale worker completion',async()=>{
  const previous=globalThis.fetch;globalThis.fetch=fakeJwks;
  const env=makeEnv();env.MOBILE_SCHEDULING_ENABLED='true';env.SCHEDULER_ENABLED='true';
  try {
    const a=await token('pause-worker');
    const created=(await(await create(env,a,uuid())).json()).monitor;
    assert.equal((await request(env,'/v1/sync/monitors/'+created.id,a,'PATCH',{status:'ACTIVE',expectedVersion:1})).status,200);
    let started,release;
    const entered=new Promise(r=>started=r);
    const gate=new Promise(r=>release=r);
    const when=Date.now()+5000;
    const running=runScheduler(env,when,async()=>{started();await gate;return new Response(JSON.stringify([{sha:'a'.repeat(40)}]),{status:200})});
    await entered;
    const row=env.DB.connection.prepare('SELECT version FROM monitors WHERE id=?').get(created.id);
    assert.equal((await request(env,'/v1/sync/monitors/'+created.id,a,'PATCH',{status:'PAUSED',expectedVersion:row.version})).status,200);
    release();
    const outcome=await running;
    assert.equal(outcome.skipped,1);
    assert.equal(env.DB.connection.prepare('SELECT COUNT(*) AS n FROM observations').get().n,0);
    assert.equal(monitors(env)[0].status,'PAUSED');
  } finally {globalThis.fetch=previous;env.DB.close();}
});


test('existing ACTIVE mobile row loses eligibility immediately when global Cron OFF, while owner can PAUSE',async()=>{
  const original=globalThis.fetch;globalThis.fetch=fakeJwks;
  const env=makeEnv();
  env.SCHEDULER_ENABLED='true';env.MOBILE_SCHEDULING_ENABLED='true';
  try{
    const signed=await token('dual-gate-owner');
    const fresh=(await(await create(env,signed,uuid(),'python/cpython')).json()).monitor;
    const url='/v1/sync/monitors/'+fresh.id;
    const active=await request(env,url,signed,'PATCH',{status:'ACTIVE',expectedVersion:1});
    assert.equal(active.status,200);
    assert.equal((await active.json()).schedulerEligible,true);
    const initial=(await(await request(env,'/v1/sync/monitors',signed)).json()).monitors[0];
    assert.equal(initial.status,'ACTIVE');
    assert.equal(initial.schedulerEligible,true);
    env.SCHEDULER_ENABLED=undefined; // Operational kill switch.
    const after=(await(await request(env,'/v1/sync/monitors',signed)).json()).monitors[0];
    assert.equal(after.status,'ACTIVE','global stop is not destructive to saved monitor status');
    assert.equal(after.schedulerEligible,false,'must not advertise execution eligibility');
    const identity=(await(await request(env,'/v1/me',signed)).json());
    assert.deepEqual(identity,{authenticated:true,capabilities:{
      monitorSync:true,mobileActivationConfigured:false,
    }});
    const retry=await request(env,url,signed,'PATCH',{status:'ACTIVE',expectedVersion:2});
    assert.equal(retry.status,409);
    assert.deepEqual(await retry.json(),{error:'scheduler_disabled'});
    const paused=await request(env,url,signed,'PATCH',{status:'PAUSED',expectedVersion:2});
    assert.equal(paused.status,200,'pause must stay permitted while operator kill switch is OFF');
    assert.deepEqual(await paused.json(),{id:fresh.id,status:'PAUSED',version:3,schedulerEligible:false});
    assert.equal(monitors(env)[0].status,'PAUSED');
    env.SCHEDULER_ENABLED='true';
    const withoutMobile=await request(env,url,signed,'PATCH',{status:'ACTIVE',expectedVersion:3});
    env.MOBILE_SCHEDULING_ENABLED=undefined;
    // Previous request may succeed with both flags (tested elsewhere); the
    // second below must refuse once the user-specific operator flag is OFF.
    assert.equal(withoutMobile.status,200);
    const noMobile=(await(await request(env,'/v1/sync/monitors',signed)).json()).monitors[0];
    assert.equal(noMobile.schedulerEligible,false);
  }finally{globalThis.fetch=original;env.DB.close();}
});

test('verified identity probe advertises implemented source capability without claiming live scheduler',async()=>{
  const original=globalThis.fetch;globalThis.fetch=fakeJwks;
  const env=makeEnv();
  try{
    const signed=await token('me-capabilities');
    let result=await request(env,'/v1/me',signed);
    assert.equal(result.status,200);
    assert.deepEqual(await result.json(),{authenticated:true,capabilities:{
      monitorSync:true,mobileActivationConfigured:false,
    }});
    env.MOBILE_SCHEDULING_ENABLED='true';
    result=await request(env,'/v1/me',signed);
    assert.equal((await result.json()).capabilities.mobileActivationConfigured,false);
    env.SCHEDULER_ENABLED='true';
    result=await request(env,'/v1/me',signed);
    assert.equal((await result.json()).capabilities.mobileActivationConfigured,true);
    env.OWNER_ID='';
    result=await request(env,'/v1/me',signed);
    assert.equal((await result.json()).capabilities.mobileActivationConfigured,false);
    assert.equal(identities(env).length,0,'read-only capability probe must not onboard identity');
  }finally{globalThis.fetch=original;env.DB.close();}
});


test('mobile ACTIVE fails closed when shared Cron budget row is absent, and PAUSE still works',async()=>{
  const previous=globalThis.fetch;globalThis.fetch=fakeJwks;
  const env=makeEnv();
  env.SCHEDULER_ENABLED='true';env.MOBILE_SCHEDULING_ENABLED='true';
  try{
    const t=await token('missing-budget-row');
    const monitor=(await(await create(env,t,uuid())).json()).monitor;
    env.DB.connection.exec('DELETE FROM scheduler_control');
    const denied=await request(env,'/v1/sync/monitors/'+monitor.id,t,'PATCH',{
      status:'ACTIVE',expectedVersion:1,
    });
    assert.equal(denied.status,503);
    assert.deepEqual(await denied.json(),{error:'scheduler_storage_unavailable'});
    assert.equal(monitors(env)[0].status,'PAUSED');
    assert.equal(monitors(env)[0].version,1);
    const paused=await request(env,'/v1/sync/monitors/'+monitor.id,t,'PATCH',{
      status:'PAUSED',expectedVersion:1,
    });
    assert.equal(paused.status,200);
    assert.equal(monitors(env)[0].version,2);
  }finally{globalThis.fetch=previous;env.DB.close();}
});

test('mobile ACTIVE fails closed without scheduler_control migration (no accidental 200)',async()=>{
  const previous=globalThis.fetch;globalThis.fetch=fakeJwks;
  const env=makeEnv();
  env.SCHEDULER_ENABLED='true';env.MOBILE_SCHEDULING_ENABLED='true';
  try{
    const t=await token('missing-budget-table');
    const monitor=(await(await create(env,t,uuid())).json()).monitor;
    env.DB.connection.exec('DROP TABLE scheduler_control');
    const denied=await request(env,'/v1/sync/monitors/'+monitor.id,t,'PATCH',{
      status:'ACTIVE',expectedVersion:1,
    });
    assert.equal(denied.status,503);
    assert.deepEqual(await denied.json(),{error:'scheduler_storage_unavailable'});
    assert.equal(monitors(env)[0].status,'PAUSED');
    assert.equal(monitors(env)[0].version,1);
  }finally{globalThis.fetch=previous;env.DB.close();}
});



test('same bounded observation JSON fixture used by Android matches actual owner-scoped Worker HTTP',async()=>{
  const fixture=JSON.parse(readFileSync(
    new URL('../android/app/src/test/resources/mobile-observations-v1.json',import.meta.url),'utf8'));
  assert.equal(fixture.contractVersion,2);
  assert.equal(fixture.observations.length,3);
  const previous=globalThis.fetch;globalThis.fetch=fakeJwks;
  const env=makeEnv();
  try {
    const owner=await token('contract-fixture-owner');
    const foreign=await token('contract-fixture-foreign');
    const created=(await(await create(env,owner,uuid())).json()).monitor;
    const dynamicRows=fixture.observations.map(event=>({...event,monitor_id:created.id}));
    // Seed oldest first, letting SQLite compute new event_sequence atomically.
    // Assert that real Worker output matches the shared Android contract JSON.
    for(const event of dynamicRows.toReversed()){
      env.DB.connection.prepare('INSERT INTO observations(id,monitor_id,lease_token,event_type,previous_sha,head_sha,observed_at,event_sequence) VALUES(?,?,?,?,?,?,?,(SELECT COALESCE(MAX(event_sequence),0)+1 FROM observations))')
        .run(event.id,event.monitor_id,uuid(),event.event_type,event.previous_sha,
             event.head_sha,event.observed_at);
    }
    const response=await request(env,'/v1/sync/observations?monitorId='+created.id,owner);
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{observations:dynamicRows},
      'Worker must serialize exactly the same JSON keys/types/order read by Android JVM');
    assert.equal((await request(env,
      '/v1/sync/observations?monitorId='+created.id,foreign)).status,404);
    assert.equal((await request(env,
      '/v1/sync/observations?monitorId='+fixture.monitorId,owner)).status,404);
    // The fixture is seeded test-only data, NOT proof of a real scheduled GET.
  } finally {globalThis.fetch=previous;env.DB.close();}
});

test('actual local scheduler emits a baseline and consecutive SHA-linked changes to signed owner',async()=>{
  const previous=globalThis.fetch;globalThis.fetch=fakeJwks;
  const env=makeEnv();
  env.SCHEDULER_ENABLED='true';env.MOBILE_SCHEDULING_ENABLED='true';
  try {
    const signed=await token('three-linked-changes');
    const created=(await(await create(env,signed,uuid())).json()).monitor;
    assert.equal((await request(env,'/v1/sync/monitors/'+created.id,signed,'PATCH',
      {status:'ACTIVE',expectedVersion:1})).status,200);
    const start=Date.now()+1_000;
    const heads=['a','b','c'].map(char=>char.repeat(40));
    for(let i=0;i<heads.length;i++){
      const when=start+i*31*60_000;
      const report=await runScheduler(env,when,async(url,options)=>{
        assert.equal(new URL(url).host,'api.github.com');
        assert.equal(options.method,'GET');
        return new Response(JSON.stringify([{sha:heads[i]}]),{status:200});
      });
      assert.equal(report.claimed,1);
      assert.equal(report.observations,1);
    }
    const response=await request(env,'/v1/sync/observations?monitorId='+created.id,signed);
    assert.equal(response.status,200);
    const {observations}=await response.json();
    assert.equal(observations.length,3);
    assert.deepEqual(observations.map(e=>e.event_type),['CHANGE','CHANGE','BASELINE']);
    assert.deepEqual(observations.map(e=>e.head_sha),heads.toReversed());
    assert.equal(observations[0].previous_sha,observations[1].head_sha);
    assert.equal(observations[1].previous_sha,observations[2].head_sha);
    assert.equal(observations[2].previous_sha,null);
    assert.deepEqual(observations.map(x=>x.event_sequence),[3,2,1]);
    assert.ok(observations[0].observed_at>observations[1].observed_at);
    assert.ok(observations[1].observed_at>observations[2].observed_at);
  } finally {globalThis.fetch=previous;env.DB.close();}
});


test('migration 0005 durably backfills preexisting observation insertion order without changing prior data',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=ON');
    for(const name of ['0001_initial.sql','0002_mobile_identity_sync.sql',
      '0003_scheduler_control.sql','0004_global_scheduler_budget.sql']) {
      db.exec(readFileSync(new URL('../worker/migrations/'+name,import.meta.url),'utf8'));
    }
    const id=uuid();
    db.prepare('INSERT INTO monitors(id,owner_id,repo_owner,repo_name,status,interval_minutes,next_due_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id,'historical-owner','python','cpython','ACTIVE',30,10,10,10);
    const oldIds=[uuid(),uuid()];
    const insert=db.prepare('INSERT INTO observations(id,monitor_id,lease_token,event_type,previous_sha,head_sha,observed_at) VALUES(?,?,?,?,?,?,?)');
    insert.run(oldIds[0],id,uuid(),'BASELINE',null,'a'.repeat(40),100);
    insert.run(oldIds[1],id,uuid(),'CHANGE','a'.repeat(40),'b'.repeat(40),100);
    const before=db.prepare('SELECT id,event_type,head_sha,observed_at FROM observations ORDER BY rowid').all();
    db.exec(readFileSync(new URL('../worker/migrations/0005_observation_event_sequence.sql',import.meta.url),'utf8'));
    let after=db.prepare('SELECT id,event_type,head_sha,observed_at,event_sequence FROM observations ORDER BY event_sequence').all();
    assert.deepEqual(after.map(x=>x.event_sequence),[1,2]);
    assert.deepEqual(after.map(({event_sequence,...rest})=>rest),before.map(row=>({...row})));
    // Explicitly copied sequence is stable across a local VACUUM.
    db.exec('VACUUM');
    after=db.prepare('SELECT id,event_sequence FROM observations ORDER BY event_sequence').all();
    assert.deepEqual(after.map(x=>x.event_sequence),[1,2]);
    db.prepare('INSERT INTO observations(id,monitor_id,lease_token,event_type,previous_sha,head_sha,observed_at,event_sequence) VALUES(?,?,?,?,?,?,?,(SELECT COALESCE(MAX(event_sequence),0)+1 FROM observations))')
      .run(uuid(),id,uuid(),'CHANGE','b'.repeat(40),'c'.repeat(40),99);
    const latest=db.prepare('SELECT head_sha,event_sequence,observed_at FROM observations WHERE monitor_id=? ORDER BY event_sequence DESC').all(id);
    assert.deepEqual(latest.map(x=>x.event_sequence),[3,2,1]);
    assert.deepEqual(latest.map(x=>x.head_sha),['c','b','a'].map(v=>v.repeat(40)));
    assert.equal(latest[0].observed_at,99);
    assert.equal(latest[1].observed_at,100);
  }finally{db.close();}
});


test('missing migration 0005 fails closed before mobile activation or operator provider GET',async()=>{
  const previous=globalThis.fetch;globalThis.fetch=fakeJwks;
  const env=makeEnv();
  env.MOBILE_SCHEDULING_ENABLED='true';env.SCHEDULER_ENABLED='true';
  try {
    // Recreate the old 0004-only observations schema without fake provider data.
    env.DB.connection.exec('DROP INDEX observations_event_sequence_unique; DROP INDEX observations_monitor_sequence; ALTER TABLE observations DROP COLUMN event_sequence;');
    const t=await token('needs-migration-five');
    const newRow=(await(await create(env,t,uuid())).json()).monitor;
    const target='/v1/sync/monitors/'+newRow.id;
    const denied=await request(env,target,t,'PATCH',{status:'ACTIVE',expectedVersion:1});
    assert.equal(denied.status,503);
    assert.deepEqual(await denied.json(),{error:'scheduler_storage_unavailable'});
    assert.equal(monitors(env)[0].status,'PAUSED');
    assert.equal(monitors(env)[0].version,1);
    const bearer=env.OWNER_API_TOKEN;
    const created=await request(env,'/v1/monitors',bearer,'POST',{repository:'nodejs/node',intervalMinutes:30});
    assert.equal(created.status,201);
    let providerCalls=0;
    await assert.rejects(runScheduler(env,Date.now()+1000,async()=>{
      providerCalls++;return new Response(JSON.stringify([{sha:'a'.repeat(40)}]));
    }),/no such column|event_sequence/i);
    assert.equal(providerCalls,0,'missing sequence migration must not consume a GitHub provider request');
    const paused=await request(env,target,t,'PATCH',{status:'PAUSED',expectedVersion:1});
    assert.equal(paused.status,200,'owner can still safely PAUSE during migration outage');
  }finally{globalThis.fetch=previous;env.DB.close();}
});


test('P1-O existing signed identity never attempts D1 INSERT on repeated GET/PATCH or monitor upload',async()=>{
  const previous=globalThis.fetch;globalThis.fetch=fakeJwks;
  const env=makeEnv();
  const originalDb=env.DB;
  let identityInserts=0;
  const wrap=(stmt,sql)=>({
    bind(...values){return wrap(stmt.bind(...values),sql);},
    async run(){
      if(/\bINSERT INTO user_identities\b/i.test(sql)) identityInserts++;
      return stmt.run();
    },
    first(){return stmt.first();},
    all(){return stmt.all();}
  });
  env.DB={
    connection: originalDb.connection,
    prepare(sql){return wrap(originalDb.prepare(sql),sql);},
    batch(stmts){return originalDb.batch(stmts);},
    close(){originalDb.close();}
  };
  try {
    const owner=await token('P1O-existing-owner');
    const first=await request(env,'/v1/sync/monitors',owner);
    assert.equal(first.status,200);
    assert.deepEqual(await first.json(),{monitors:[]});
    assert.equal(identityInserts,0,'a first read-only GET must not register or write an identity');
    assert.equal(identities(env).length,0);
    const created=await create(env,owner,uuid());
    assert.equal(created.status,201);
    assert.equal(identityInserts,1,'first explicit valid POST registers one identity');
    const originalOwnerId=identities(env)[0].id;
    const monitor=(await created.json()).monitor;
    for(let i=0;i<12;i++){
      const listing=await request(env,'/v1/sync/monitors',owner);
      assert.equal(listing.status,200);
      assert.equal((await listing.json()).monitors[0].id,monitor.id);
      const history=await request(env,'/v1/sync/observations?monitorId='+monitor.id,owner);
      assert.equal(history.status,200);
    }
    const pause=await request(env,'/v1/sync/monitors/'+monitor.id,owner,'PATCH',
      {status:'PAUSED',expectedVersion:1});
    assert.equal(pause.status,200);
    const replay=await create(env,owner,monitor.clientDraftId);
    assert.equal(replay.status,200);
    assert.equal(identityInserts,1,'registered users must not retry INSERT for any sync route');
    assert.equal(identities(env).length,1);
    assert.equal(identities(env)[0].id,originalOwnerId);
  }finally{globalThis.fetch=previous;env.DB.close();}
});

test('P1-O bad requests do not silently claim pilot identity slots even with valid OIDC',async()=>{
  const previous=globalThis.fetch;globalThis.fetch=fakeJwks;
  const env=makeEnv();
  try {
    const signed=await token('P1O-malformed-first-visit');
    const goodUuid=uuid();
    assert.equal((await request(env,'/v1/sync/observations?monitorId=bad',signed)).status,400);
    assert.equal((await request(env,'/v1/sync/monitors/'+goodUuid,signed)).status,404);
    assert.equal((await request(env,'/v1/sync/monitors/'+goodUuid,signed,'PATCH',
      {status:'ACTIVE',expectedVersion:'1'})).status,400);
    assert.equal((await request(env,'/v1/sync/monitors',signed,'POST',
      {clientDraftId:'not-uuid',repository:'python/cpython',intervalMinutes:30})).status,400);
    assert.equal((await request(env,'/v1/sync/monitors',signed,'PATCH',
      {status:'PAUSED',expectedVersion:1})).status,404);
    const dashed='00000000-0000-0000-0000-000000000000';
    assert.equal((await request(env,'/v1/sync/monitors/'+dashed,signed,'PATCH',
      {status:'PAUSED',expectedVersion:1})).status,404);
    assert.equal(identities(env).length,0,'invalid requests must not exhaust 20 user slots');
    const ok=await request(env,'/v1/sync/monitors',signed);
    assert.equal(ok.status,200);
    assert.equal(identities(env).length,0,'valid first list is strictly read-only');
    const again=await request(env,'/v1/sync/monitors',signed);
    assert.equal(again.status,200);
    assert.deepEqual(await again.json(),{monitors:[]});
    assert.equal(identities(env).length,0);
    const created=await create(env,signed,uuid());
    assert.equal(created.status,201,'only explicit first POST onboards the user');
    assert.equal(identities(env).length,1);
  }finally{globalThis.fetch=previous;env.DB.close();}
});

test('P1-O invalid JWT does not get to body parsing, D1 identity lookup or onboarding',async()=>{
  const previous=globalThis.fetch;globalThis.fetch=fakeJwks;
  const env=makeEnv();
  try{
    const invalid=await token('P1O-bad-sig',{aud:'not-the-owner-approved-audience'});
    const r=await request(env,'/v1/sync/monitors',invalid,'POST',
      {clientDraftId:'bad',repository:'wrong-repo',intervalMinutes:-1});
    assert.equal(r.status,401);
    assert.equal(identities(env).length,0);
  }finally{globalThis.fetch=previous;env.DB.close();}
});


test('P1-P D1 transaction rolls back an identity if first monitor SQL fails mid-batch',async()=>{
  const previous=globalThis.fetch;globalThis.fetch=fakeJwks;
  const env=makeEnv(),realDb=env.DB;
  try {
    const signed=await token('P1P-batch-failure');
    const draft=uuid();
    let intercepted=0;
    env.DB={...realDb,
      batch(stmts){
        intercepted++;
        assert.equal(stmts.length,3,'first identity+monitor+conditional cleanup must be one transaction');
        const injected=stmts.map((stmt,i)=>i===1?{
          async run(){throw new Error('synthetic_monitor_write_failure')}
        }:stmt);
        return realDb.batch(injected);
      },
    };
    const first=await create(env,signed,draft);
    assert.equal(first.status,500,'an interrupted transaction must never respond 201');
    assert.deepEqual(await first.json(),{error:'internal_error'});
    assert.equal(intercepted,1);
    assert.equal(identities(env).length,0,'rolled-back batch must not consume an identity slot');
    assert.equal(monitors(env).length,0,'failed first monitor must not exist');
    env.DB=realDb;
    const retry=await create(env,signed,draft);
    assert.equal(retry.status,201,'same valid draft can recover cleanly after rollback');
    assert.equal(identities(env).length,1);
    assert.equal(monitors(env).length,1);
    assert.equal((await create(env,signed,draft)).status,200,'subsequent retry stays idempotent');
  }finally{globalThis.fetch=previous;realDb.close();}
});

test('P1-P zero-change monitor insert in a valid first POST cannot leave an orphan identity',async()=>{
  const previous=globalThis.fetch;globalThis.fetch=fakeJwks;
  const env=makeEnv(),realDb=env.DB;
  try {
    const signed=await token('P1P-zero-changes');
    const draft=uuid();
    let calls=0;
    env.DB={...realDb,
      batch(stmts){
        calls++;
        assert.equal(stmts.length,3);
        // Simulates a D1 INSERT OR IGNORE outcome of zero rows after a
        // successful first identity registration. Cleanup must be in
        // the SAME transaction, not asynchronous compensation.
        const injected=stmts.map((stmt,i)=>i===1?{
          async run(){return {success:true,meta:{changes:0}}}
        }:stmt);
        return realDb.batch(injected);
      },
    };
    const invalid=await create(env,signed,draft);
    assert.equal(invalid.status,500,'no monitor row means onboarding is not successful');
    assert.equal(calls,1);
    assert.equal(identities(env).length,0,'candidate identity was removed transactionally');
    assert.equal(monitors(env).length,0);
    env.DB=realDb;
    const fresh=await create(env,signed,draft);
    assert.equal(fresh.status,201);
    assert.equal(identities(env).length,1);
    assert.equal(monitors(env).length,1);
  }finally{globalThis.fetch=previous;realDb.close();}
});


test('P1-P an already committed batch with missing metadata fails closed and replays idempotently',async()=>{
  const previous=globalThis.fetch;globalThis.fetch=fakeJwks;
  const env=makeEnv(),realDb=env.DB;
  try{
    const signed=await token('P1P-ambiguous-success');
    const draft=uuid();
    let executed=0;
    env.DB={...realDb,
      async batch(stmts){
        const results=await realDb.batch(stmts);
        executed++;
        // A real D1 transaction has committed, but its returned metadata
        // was lost/corrupted. Do NOT claim success without knowing changes.
        return results.map((entry,i)=>i===1?{...entry,meta:undefined}:entry);
      },
    };
    const uncertain=await create(env,signed,draft);
    assert.equal(uncertain.status,500);
    assert.deepEqual(await uncertain.json(),{error:'internal_error'});
    assert.equal(executed,1);
    assert.equal(identities(env).length,1,'the synthetic batch actually committed');
    assert.equal(monitors(env).length,1,'the synthetic batch actually committed one monitor');
    env.DB=realDb;
    const replay=await create(env,signed,draft);
    assert.equal(replay.status,200,'retry resolves an ambiguous commit using the same clientDraftId');
    assert.equal((await replay.json()).created,false);
    assert.equal(identities(env).length,1);
    assert.equal(monitors(env).length,1);
  }finally{globalThis.fetch=previous;realDb.close();}
});


const approvalPayload=(clientIntentId=uuid(),leadId=uuid(),serviceCode='EXHIBITION')=>({
  clientIntentId,provider:'SYNTHETIC_ONLY',operation:'CREATE_CRM_LEAD',
  target:'synthetic-crm',payload:{leadId,serviceCode},
});
const requestApproval=(env,t,payload)=>request(env,'/v1/approval-intents',t,'POST',payload);
const decisionBody=(item,decision='APPROVE',overrides={})=>({
  decision,expectedVersion:item.version,payloadDigest:item.payloadDigest,
  targetDigest:item.targetDigest,...overrides,
});

test('P2-A synthetic lead approval: OIDC scoped, durable, digest-bound, one decision, NO external effects',async()=>{
  const previous=globalThis.fetch;let jwksReads=0;
  globalThis.fetch=async(url,options)=>{jwksReads++;return fakeJwks(url,options)};
  const env=makeEnv();
  try{
    const a=await token('p2-approver-a'), b=await token('p2-approver-b');
    const body=approvalPayload();
    // Signed identity without an existing first monitor cannot register
    // or create any approvals via GET or POST.
    assert.equal((await requestApproval(env,a,body)).status,409);
    assert.equal((await request(env,'/v1/approval-intents',a)).status,409);
    assert.equal(identities(env).length,0);
    assert.equal((await create(env,a,uuid(),'python/cpython')).status,201);
    assert.equal((await create(env,b,uuid(),'nodejs/node')).status,201);
    const first=await requestApproval(env,a,body);
    assert.equal(first.status,201);
    const created=(await first.json()).intent;
    assert.equal(created.status,'PENDING');
    assert.equal(created.provider,'SYNTHETIC_ONLY');
    assert.equal(created.target,'synthetic-crm');
    assert.equal(created.externalWrite,'NOT_IMPLEMENTED');
    assert.equal(created.eligibleForDispatch,false);
    assert.match(created.payloadDigest,/^[0-9a-f]{64}$/);
    assert.match(created.targetDigest,/^[0-9a-f]{64}$/);
    const duplicate=await requestApproval(env,a,body);
    assert.equal(duplicate.status,200);
    assert.equal((await duplicate.json()).created,false);
    const forged=await request(env,'/v1/approval-intents/'+created.id+'/decision',b,
      'POST',decisionBody(created));
    assert.equal(forged.status,409);
    const tampered=await request(env,'/v1/approval-intents/'+created.id+'/decision',a,
      'POST',decisionBody(created,'APPROVE',{payloadDigest:'a'.repeat(64)}));
    assert.equal(tampered.status,409);
    const wrongTarget=await request(env,'/v1/approval-intents/'+created.id+'/decision',a,
      'POST',decisionBody(created,'APPROVE',{targetDigest:'b'.repeat(64)}));
    assert.equal(wrongTarget.status,409);
    assert.equal((await request(env,'/v1/approval-intents',b).then(r=>r.json())).intents.length,0);
    const approved=await request(env,'/v1/approval-intents/'+created.id+'/decision',a,
      'POST',decisionBody(created));
    assert.equal(approved.status,200);
    assert.equal((await approved.json()).status,'APPROVED_NO_DISPATCH');
    assert.equal((await request(env,'/v1/approval-intents/'+created.id+'/decision',a,
      'POST',decisionBody(created)).then(r=>r.status)),409);
    const listed=(await request(env,'/v1/approval-intents',a).then(r=>r.json())).intents;
    assert.equal(listed.length,1);
    assert.equal(listed[0].status,'APPROVED_NO_DISPATCH');
    assert.equal(listed[0].version,2);
    assert.equal(env.DB.connection.prepare('SELECT COUNT(*) AS n FROM synthetic_approval_intents').get().n,1);
    assert.equal(env.DB.connection.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n,0);
    assert.ok(jwksReads>0);
  }finally{globalThis.fetch=previous;env.DB.close();}
});

test('P2-A synthetic lead approval: expiry, denial, payload replay conflict and input strictness',async()=>{
  const previous=globalThis.fetch;globalThis.fetch=fakeJwks;
  const env=makeEnv();
  try{
    const a=await token('p2-approver-expiry');
    assert.equal((await create(env,a,uuid())).status,201);
    const body=approvalPayload();
    const first=(await requestApproval(env,a,body).then(r=>r.json())).intent;
    assert.equal((await requestApproval(env,a,{
      ...body,payload:{...body.payload,serviceCode:'INTERIOR'},
    })).status,409);
    const denied=await request(env,'/v1/approval-intents/'+first.id+'/decision',a,
      'POST',decisionBody(first,'DENY'));
    assert.equal(denied.status,200);
    assert.equal((await denied.json()).status,'DENIED');
    assert.equal((await request(env,'/v1/approval-intents/'+first.id+'/decision',a,
      'POST',decisionBody(first,'APPROVE')).then(r=>r.status)),409);

    const fresh=(await requestApproval(env,a,approvalPayload()).then(r=>r.json())).intent;
    env.DB.connection.prepare('UPDATE synthetic_approval_intents SET expires_at=? WHERE id=?')
      .run(Date.now()-10,fresh.id);
    const stale=await request(env,'/v1/approval-intents/'+fresh.id+'/decision',a,
      'POST',decisionBody(fresh));
    assert.equal(stale.status,409);
    assert.equal((await request(env,'/v1/approval-intents',a).then(r=>r.json())).intents[0].status,'EXPIRED');
    const badInputs=[
      {...approvalPayload(),provider:'REAL_CRM'},
      {...approvalPayload(),target:'https://attacker.invalid'},
      {...approvalPayload(),operation:'SEND_EMAIL'},
      {...approvalPayload(),payload:{leadId:uuid(),serviceCode:'EXHIBITION',email:'private@example.com'}},
      {...approvalPayload(),payload:{leadId:uuid(),serviceCode:'UNKNOWN'}},
      {...approvalPayload(),clientIntentId:'invalid'},
    ];
    for(const input of badInputs)assert.equal((await requestApproval(env,a,input)).status,400);
    assert.equal(env.DB.connection.prepare('SELECT COUNT(*) AS n FROM synthetic_approval_intents').get().n,2);
  }finally{globalThis.fetch=previous;env.DB.close();}
});

test('P2-A synthetic approval: pending cap, no provider dispatch and auth rejection',async()=>{
  const previous=globalThis.fetch;globalThis.fetch=fakeJwks;
  const env=makeEnv();
  try{
    const a=await token('p2-approver-cap');
    assert.equal((await create(env,a,uuid())).status,201);
    for(let i=0;i<5;i++)assert.equal((await requestApproval(env,a,approvalPayload())).status,201);
    assert.equal((await requestApproval(env,a,approvalPayload())).status,429);
    assert.equal(env.DB.connection.prepare('SELECT COUNT(*) AS n FROM synthetic_approval_intents').get().n,5);
    assert.equal((await request(env,'/v1/approval-intents','not-a-token')).status,401);
    const all=await request(env,'/v1/approval-intents',a);
    assert.equal((await all.json()).intents.length,5);
    const first=(await request(env,'/v1/approval-intents',a).then(r=>r.json())).intents[0];
    assert.equal((await request(env,'/v1/approval-intents/'+first.id+'/decision',a,
      'POST',decisionBody(first)).then(r=>r.status)),200);
    assert.equal((await requestApproval(env,a,approvalPayload())).status,201,
      'approved non-dispatch state frees pending cap but does not execute anything');
    assert.equal(env.DB.connection.prepare('SELECT COUNT(*) AS n FROM observations').get().n,0);
  }finally{globalThis.fetch=previous;env.DB.close();}
});
