import {test} from 'node:test';
import assert from 'node:assert/strict';
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
    assert.equal(identities(env).length,2);
    assert.notEqual(identities(env)[0].id,identities(env)[1].id);
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
  const env=makeEnv();env.MOBILE_SCHEDULING_ENABLED='true';
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
      assert.equal((await request(env,'/v1/sync/monitors',t)).status,200);
    }
    const beyond=await token('registered-20');
    const rejected=await request(env,'/v1/sync/monitors',beyond);
    assert.equal(rejected.status,429);
    assert.deepEqual(await rejected.json(),{error:'pilot_identity_limit'});
    assert.equal(identities(env).length,20);
    assert.equal((await request(env,'/v1/sync/monitors',first)).status,200);
  } finally {globalThis.fetch=previous;env.DB.close();}
});

test('pausing mobile task during upstream request rejects stale worker completion',async()=>{
  const previous=globalThis.fetch;globalThis.fetch=fakeJwks;
  const env=makeEnv();env.MOBILE_SCHEDULING_ENABLED='true';
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
