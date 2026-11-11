import test from 'node:test';
import assert from 'node:assert/strict';
import {makeTestDb} from './sqlite-d1.mjs';
import worker from '../worker/src/index.ts';
import {attemptSandboxEffect,reconcileSandboxEffect} from '../worker/src/sandbox-dispatch.ts';

const issuer='https://login.example.invalid',audience='sandbox-reconcile-test';
const jwks='https://keys.example.invalid/sandbox';
const keyPair=await crypto.subtle.generateKey({
  name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
  publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256',
},true,['sign','verify']);
const key={...await crypto.subtle.exportKey('jwk',keyPair.publicKey),
  kid:'p2e',alg:'RS256',use:'sig'};
const savedFetch=globalThis.fetch;
const fakeJwks=async(url,opts)=>{
  assert.equal(url,jwks);
  assert.equal(opts.method,'GET');
  assert.equal(opts.redirect,'error');
  return new Response(JSON.stringify({keys:[key]}));
};
const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
const uuid=()=>crypto.randomUUID();
async function jwt(sub){
  const s=Math.floor(Date.now()/1000);
  const signed=enc({alg:'RS256',kid:'p2e',typ:'JWT'})+'.'+
    enc({iss:issuer,aud:audience,sub,iat:s-30,exp:s+1200});
  const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',
    keyPair.privateKey,new TextEncoder().encode(signed));
  return signed+'.'+Buffer.from(sig).toString('base64url');
}
const env=()=>({DB:makeTestDb(),OIDC_ISSUER:issuer,OIDC_AUDIENCE:audience,
  OIDC_JWKS_URL:jwks,OWNER_ID:'fake-operator',
  OWNER_API_TOKEN:'fake-operator-very-long-private-access-token'});
const call=(e,token,path,method='GET',body)=>worker.fetch(new Request(
  'https://local.invalid'+path,{
    method,headers:{authorization:'Bearer '+token,...(
      body===undefined?{}:{'content-type':'application/json'})},
    body:body===undefined?undefined:JSON.stringify(body),
  }),e);
async function setup(e,token){
  assert.equal((await call(e,token,'/v1/sync/monitors','POST',{
    clientDraftId:uuid(),repository:'python/cpython',intervalMinutes:30,
  })).status,201);
  const leadId=uuid();
  assert.equal((await call(e,token,'/v1/synthetic-leads','POST',{
    clientLeadId:leadId,source:'SYNTHETIC_FORM',serviceCode:'SIGNAGE',
    budgetBand:'MID',daysToDeadline:20,
  })).status,201);
  let task=(await (await call(e,token,'/v1/tasks','POST',{
    clientTaskId:uuid(),kind:'SYNTHETIC_LEAD_TRIAGE_V1',leadId,
  })).json()).task;
  for(let i=0;i<3;i++){
    const res=await call(e,token,'/v1/tasks/'+task.id+'/advance',
      'POST',{expectedVersion:task.version});
    assert.equal(res.status,200);
    task=(await res.json()).task;
  }
  assert.equal(task.status,'SUCCEEDED');
  const aRes=await call(e,token,'/v1/task-approvals','POST',{
    clientIntentId:uuid(),taskId:task.id,provider:'SYNTHETIC_ONLY',
    operation:'CREATE_CRM_LEAD',target:'synthetic-crm',
    payload:{leadId,serviceCode:'SIGNAGE'},
  });
  assert.equal(aRes.status,201);
  const {approval,effect}=(await aRes.json());
  const decided=await call(e,token,'/v1/approval-intents/'+approval.id+'/decision',
    'POST',{decision:'APPROVE',expectedVersion:approval.version,
      payloadDigest:approval.payloadDigest,targetDigest:approval.targetDigest});
  assert.equal(decided.status,200);
  const owner=e.DB.connection.prepare('SELECT owner_id FROM task_runs WHERE id=?')
    .get(task.id).owner_id;
  return {owner,task,approval,effect,leadId};
}
async function setupUnapproved(e,token){
  // Caller already onboarded this signed user. Do not create a redundant
  // monitor, since monitor quota is independent from approval semantics.
  const leadId=uuid();
  assert.equal((await call(e,token,'/v1/synthetic-leads','POST',{
    clientLeadId:leadId,source:'SYNTHETIC_FORM',serviceCode:'SIGNAGE',
    budgetBand:'MID',daysToDeadline:20,
  })).status,201);
  let task=(await (await call(e,token,'/v1/tasks','POST',{
    clientTaskId:uuid(),kind:'SYNTHETIC_LEAD_TRIAGE_V1',leadId,
  })).json()).task;
  for(let i=0;i<3;i++){
    const r=await call(e,token,'/v1/tasks/'+task.id+'/advance',
      'POST',{expectedVersion:task.version});
    assert.equal(r.status,200);task=(await r.json()).task;
  }
  const a=(await (await call(e,token,'/v1/task-approvals','POST',{
    clientIntentId:uuid(),taskId:task.id,provider:'SYNTHETIC_ONLY',
    operation:'CREATE_CRM_LEAD',target:'synthetic-crm',
    payload:{leadId,serviceCode:'SIGNAGE'},
  })).json());
  return a;
}
const row=(e,id)=>e.DB.connection.prepare(
  'SELECT * FROM sandbox_dispatches WHERE effect_id=?').get(id);
const providerCount=(e,id)=>e.DB.connection.prepare(
  'SELECT COUNT(*) AS n FROM sandbox_provider_records WHERE effect_id=?').get(id).n;
const close=e=>e.DB.close();

test('P2-E: real signed-user API, approved task only, one persisted simulated write, replay has no second effect',async()=>{
  globalThis.fetch=fakeJwks;const e=env();
  try{
    const a=await jwt('sandbox-owner'),b=await jwt('sandbox-foreign');
    const {effect}=await setup(e,a);
    assert.equal((await call(e,b,'/v1/sandbox-dispatches/'+effect.id)).status,409);
    assert.equal((await call(e,a,'/v1/sandbox-dispatches/'+effect.id+'/attempt','POST',
      {fault:'AFTER_PROVIDER_COMMIT_TIMEOUT'})).status,400);
    assert.equal((await call(e,a,'/v1/sandbox-dispatches/'+effect.id+'/attempt','POST',
      {})).status,200);
    const persisted=row(e,effect.id);
    assert.equal(persisted.state,'CONFIRMED_APPLIED');
    assert.equal(persisted.attempt_count,1);
    assert.equal(persisted.readback,'FOUND_MATCH');
    assert.equal(providerCount(e,effect.id),1);
    assert.equal((await call(e,a,'/v1/sandbox-dispatches/'+effect.id+'/attempt','POST',
      {})).status,200);
    assert.equal(providerCount(e,effect.id),1);
    const status=await call(e,a,'/v1/sandbox-dispatches/'+effect.id);
    assert.equal(status.status,200);
    const report=(await status.json()).dispatch;
    assert.equal(report.simulatedProvider,'D1_ONLY');
    assert.equal(report.externalWrite,'NONE');
    assert.equal(report.safeToRetry,false);
    assert.equal((await call(e,a,'/v1/sandbox-dispatches/'+effect.id+'/reconcile','POST',
      {})).status,200);
    assert.equal(providerCount(e,effect.id),1);
    assert.equal(e.DB.connection.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n,0);
  }finally{globalThis.fetch=savedFetch;close(e);}
});

test('P2-E: timeout after provider commit is UNKNOWN, readback finds exact receipt, no replay',async()=>{
  globalThis.fetch=fakeJwks;const e=env();
  try{
    const a=await jwt('sandbox-after-commit');
    const {owner,effect}=await setup(e,a);
    const start=Date.now();
    const first=await attemptSandboxEffect(e,owner,effect.id,start,
      'AFTER_PROVIDER_COMMIT_TIMEOUT');
    assert.equal(first.status,202);
    const firstState=(await first.json()).dispatch;
    assert.equal(firstState.state,'UNKNOWN_OUTCOME');
    assert.equal(providerCount(e,effect.id),1);
    assert.equal((await attemptSandboxEffect(e,owner,effect.id,start+1)).status,202);
    assert.equal(providerCount(e,effect.id),1);
    const reconciled=await reconcileSandboxEffect(e,owner,effect.id,start+2);
    assert.equal(reconciled.status,200);
    const body=await reconciled.json();
    assert.equal(body.dispatch.state,'CONFIRMED_APPLIED');
    assert.equal(body.dispatch.readback,'FOUND_MATCH');
    assert.equal(body.safeToRetry,false);
    assert.equal(providerCount(e,effect.id),1);
    assert.equal((await reconcileSandboxEffect(e,owner,effect.id,start+3)).status,200);
  }finally{globalThis.fetch=savedFetch;close(e);}
});

test('P2-E: timeout before provider commit stays UNKNOWN even after negative readback; never blindly re-drive',async()=>{
  globalThis.fetch=fakeJwks;const e=env();
  try{
    const a=await jwt('sandbox-before-commit');
    const {owner,effect}=await setup(e,a);
    const now=Date.now();
    const first=await attemptSandboxEffect(e,owner,effect.id,now,
      'BEFORE_PROVIDER_COMMIT_TIMEOUT');
    assert.equal(first.status,202);
    assert.equal(providerCount(e,effect.id),0);
    const rec=await reconcileSandboxEffect(e,owner,effect.id,now+1);
    assert.equal(rec.status,202);
    assert.equal((await rec.json()).reconciliation,'NOT_FOUND_UNCERTAIN');
    assert.equal(row(e,effect.id).state,'UNKNOWN_OUTCOME');
    assert.equal(row(e,effect.id).readback,'NOT_FOUND_UNCERTAIN');
    assert.equal((await attemptSandboxEffect(e,owner,effect.id,now+2)).status,202);
    assert.equal(providerCount(e,effect.id),0);
    for(let i=2;i<=10;i++){
      assert.equal((await reconcileSandboxEffect(e,owner,effect.id,now+i)).status,202);
    }
    assert.equal((await reconcileSandboxEffect(e,owner,effect.id,now+20)).status,429);
    assert.equal(row(e,effect.id).attempt_count,1);
    assert.equal(providerCount(e,effect.id),0);
  }finally{globalThis.fetch=savedFetch;close(e);}
});

test('P2-E: lease expiry without ack reconciles uncertain result but never restarts synthetic provider',async()=>{
  globalThis.fetch=fakeJwks;const e=env();
  try{
    const a=await jwt('sandbox-expired');
    const {owner,effect}=await setup(e,a);
    const now=Date.now();
    // Simulate process dying immediately after taking an atomic dispatch
    // claim. This is the exact state a crash leaves in durable D1.
    const started=await e.DB.prepare(`INSERT INTO sandbox_dispatches(
      id,owner_id,effect_id,approval_id,task_id,payload_digest,target_digest,
      idempotency_key,state,version,attempt_count,readback,created_at,updated_at)
      SELECT ?,owner_id,id,approval_id,task_id,payload_digest,target_digest,
        ?,'PREPARED',1,0,'NOT_CHECKED',?,?
      FROM synthetic_effect_intents WHERE id=? AND owner_id=?`)
      .bind(uuid(),'synthetic-v1:'+effect.id,now,now,effect.id,owner).run();
    assert.equal(started.meta.changes,1);
    const claim=await e.DB.prepare(`UPDATE sandbox_dispatches
      SET state='IN_FLIGHT',version=version+1,attempt_count=1,
        lease_token=?,lease_until=?,updated_at=?
      WHERE effect_id=? AND owner_id=? AND state='PREPARED'`)
      .bind(uuid(),now-1,now,effect.id,owner).run();
    assert.equal(claim.meta.changes,1);
    assert.equal((await reconcileSandboxEffect(e,owner,effect.id,now)).status,202);
    assert.equal(row(e,effect.id).state,'UNKNOWN_OUTCOME');
    assert.equal(providerCount(e,effect.id),0);
    assert.equal((await attemptSandboxEffect(e,owner,effect.id,now+1)).status,202);
    assert.equal(providerCount(e,effect.id),0);
  }finally{globalThis.fetch=savedFetch;close(e);}
});

test('P2-E: deny/pending cannot dispatch; DB requires valid approved claim, immutable receipts and exact readback',async()=>{
  globalThis.fetch=fakeJwks;const e=env();
  try{
    const a=await jwt('sandbox-security');
    const {effect,owner}=await setup(e,a);
    const noApproval=await setupUnapproved(e,a);
    assert.equal((await call(e,a,'/v1/sandbox-dispatches/'+noApproval.effect.id+'/attempt',
      'POST',{})).status,409);
    const badId=uuid();
    assert.equal((await call(e,a,'/v1/sandbox-dispatches/'+badId+'/attempt',
      'POST',{})).status,404);
    assert.throws(()=>e.DB.connection.prepare(`INSERT INTO sandbox_provider_records(
      id,owner_id,effect_id,task_id,idempotency_key,payload_digest,target_digest,
      created_at) VALUES(?,?,?,?,?,?,?,?)`).run(
      uuid(),owner,effect.id,effect.taskId,'synthetic-v1:'+effect.id,
      effect.payloadDigest,effect.targetDigest,Date.now()),
      /sandbox_provider_record_without_claim/);
    const response=await call(e,a,'/v1/sandbox-dispatches/'+effect.id+'/attempt','POST',{});
    assert.equal(response.status,200);
    assert.throws(()=>e.DB.connection.prepare(
      'DELETE FROM sandbox_provider_records WHERE effect_id=?')
      .run(effect.id),/sandbox_provider_receipt_no_delete/);
    assert.throws(()=>e.DB.connection.prepare(
      "UPDATE sandbox_provider_records SET payload_digest=? WHERE effect_id=?")
      .run('a'.repeat(64),effect.id),/sandbox_provider_receipt_immutable/);
    assert.throws(()=>e.DB.connection.prepare(
      "UPDATE sandbox_dispatches SET state='PREPARED' WHERE effect_id=?")
      .run(effect.id),/sandbox_dispatch_invalid_transition/);
    assert.equal(providerCount(e,effect.id),1);
  }finally{globalThis.fetch=savedFetch;close(e);}
});

test('P2-E: duplicate concurrent manual attempts converge on one provider record',async()=>{
  globalThis.fetch=fakeJwks;const e=env();
  try{
    const a=await jwt('sandbox-concurrency');
    const {owner,effect}=await setup(e,a);
    const [x,y]=await Promise.all([
      attemptSandboxEffect(e,owner,effect.id),
      attemptSandboxEffect(e,owner,effect.id),
    ]);
    assert.ok([200,202].includes(x.status));
    assert.ok([200,202].includes(y.status));
    assert.equal(providerCount(e,effect.id),1);
    assert.equal(row(e,effect.id).attempt_count,1);
    assert.equal(row(e,effect.id).state,'CONFIRMED_APPLIED');
  }finally{globalThis.fetch=savedFetch;close(e);}
});
