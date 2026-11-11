import test from 'node:test';
import assert from 'node:assert/strict';
import {makeTestDb} from './sqlite-d1.mjs';
import worker from '../worker/src/index.ts';
import {advanceSyntheticTask} from '../worker/src/task-runtime.ts';

const issuer='https://login.example.invalid',audience='task-runtime-test';
const jwks='https://keys.example.invalid/jwks';
const rsa={name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
  publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'};
const pair=await crypto.subtle.generateKey(rsa,true,['sign','verify']);
const key={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'task-test',alg:'RS256',use:'sig'};
const originalFetch=globalThis.fetch;
const mockJwks=async (url,options)=>{
  assert.equal(url,jwks);assert.equal(options.method,'GET');
  assert.equal(options.redirect,'error');
  return new Response(JSON.stringify({keys:[key]}));
};
const base='https://local.example.invalid';
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const UUID=()=>crypto.randomUUID();
async function token(sub){
  const time=Math.floor(Date.now()/1000);
  const head=b64({alg:'RS256',kid:'task-test',typ:'JWT'});
  const body=b64({iss:issuer,sub,aud:audience,iat:time-30,exp:time+1200});
  const data=head+'.'+body;
  const bytes=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,
    new TextEncoder().encode(data));
  return data+'.'+Buffer.from(bytes).toString('base64url');
}
function env(){return {DB:makeTestDb(),OIDC_ISSUER:issuer,OIDC_AUDIENCE:audience,
  OIDC_JWKS_URL:jwks,OWNER_ID:'synthetic-operator',
  OWNER_API_TOKEN:'synthetic-operator-very-long-private-bearer-token'};}
const request=(e,t,path,method='GET',body)=>
  worker.fetch(new Request(base+path,{method,headers:{
    authorization:'Bearer '+t,...(body===undefined?{}:{'content-type':'application/json'}),
  },body:body===undefined?undefined:JSON.stringify(body)}),e);
async function onboard(e,t){
  const response=await request(e,t,'/v1/sync/monitors','POST',
    {clientDraftId:UUID(),repository:'python/cpython',intervalMinutes:30});
  assert.equal(response.status,201,JSON.stringify(await response.json()));
}
async function lead(e,t,fields={}){
  const clientLeadId=UUID();
  const res=await request(e,t,'/v1/synthetic-leads','POST',{
    clientLeadId,source:'SYNTHETIC_FORM',serviceCode:'SIGNAGE',
    budgetBand:'MID',daysToDeadline:45,...fields});
  assert.equal(res.status,201,JSON.stringify(await res.json()));
  return clientLeadId;
}
const createBody=(leadId,clientTaskId=UUID())=>({
  clientTaskId,kind:'SYNTHETIC_LEAD_TRIAGE_V1',leadId,
});
async function taskCreate(e,t,body){
  return request(e,t,'/v1/tasks','POST',body);
}
async function advance(e,t,item){
  return request(e,t,'/v1/tasks/'+item.id+'/advance','POST',
    {expectedVersion:item.version});
}
async function inspect(e,t,id){
  const res=await request(e,t,'/v1/tasks/'+id);
  assert.equal(res.status,200);
  return res.json();
}
const close=e=>e.DB.close();

test('P2-C: OIDC-only task creation, durable three-step plan, idempotent same key and owner isolation',async()=>{
  globalThis.fetch=mockJwks;
  const e=env();
  try{
    const a=await token('task-a'),b=await token('task-b');
    assert.equal((await taskCreate(e,a,createBody(UUID()))).status,409,
      'unknown signed user cannot allocate task or identity');
    assert.equal((await request(e,a,'/v1/tasks')).status,409);
    await onboard(e,a);await onboard(e,b);
    const l=await lead(e,a);
    const body=createBody(l);
    const made=await taskCreate(e,a,body);
    assert.equal(made.status,201);
    const task=(await made.json()).task;
    assert.equal(task.status,'QUEUED');assert.equal(task.currentStep,0);
    assert.equal(task.externalWrite,'NOT_IMPLEMENTED');
    assert.equal(task.automaticDispatch,false);
    const details=await inspect(e,a,task.id);
    assert.deepEqual(details.steps.map(x=>x.code),[
      'VERIFY_LEAD','VERIFY_TRIAGE','VERIFY_DRAFT']);
    assert.deepEqual(details.steps.map(x=>x.status),['READY','WAITING','WAITING']);
    assert.equal((await taskCreate(e,a,body)).status,200);
    assert.equal((await taskCreate(e,a,{...body,leadId:UUID()})).status,409);
    assert.equal((await request(e,b,'/v1/tasks/'+task.id)).status,404);
    assert.equal((await request(e,b,'/v1/tasks').then(r=>r.json())).tasks.length,0);
    assert.equal((await request(e,b,'/v1/tasks/'+task.id+'/advance','POST',
      {expectedVersion:1})).status,404);
    assert.equal(e.DB.connection.prepare('SELECT COUNT(*) AS n FROM task_steps').get().n,3);
    assert.equal(e.DB.connection.prepare('SELECT COUNT(*) AS n FROM task_runs').get().n,1);
  }finally{globalThis.fetch=originalFetch;close(e);}
});

test('P2-C: one manual step per call; all steps are D1-only validators with terminal success',async()=>{
  globalThis.fetch=mockJwks;const e=env();
  try{
    const t=await token('task-sequence');await onboard(e,t);
    const l=await lead(e,t),body=createBody(l);
    let task=(await (await taskCreate(e,t,body)).json()).task;
    for(let i=0;i<3;i++){
      const r=await advance(e,t,task);
      assert.equal(r.status,200,JSON.stringify(await r.json()));
      const report=await r.json();
      task=report.task;
      assert.equal(task.currentStep,i+1);
      assert.equal(task.status,i===2?'SUCCEEDED':'RUNNING');
      assert.equal(report.steps[i].status,'SUCCEEDED');
      assert.equal(report.steps[i].attempts,1);
    }
    assert.equal((await advance(e,t,task)).status,409);
    assert.equal((await request(e,t,'/v1/tasks/'+task.id+'/cancel','POST',
      {expectedVersion:task.version})).status,409);
    assert.equal(e.DB.connection.prepare('SELECT SUM(claims) AS n FROM task_step_budgets').get().n,3);
    assert.equal(e.DB.connection.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n,0);
    assert.equal(e.DB.connection.prepare('SELECT COUNT(*) AS n FROM observations').get().n,0);
  }finally{globalThis.fetch=originalFetch;close(e);}
});

test('P2-C: cancellation during in-flight step permanently fences stale completion',async()=>{
  globalThis.fetch=mockJwks;const e=env();
  try{
    const tokenA=await token('task-cancel');await onboard(e,tokenA);
    const l=await lead(e,tokenA),t=(await (await taskCreate(e,tokenA,createBody(l))).json()).task;
    const owner=e.DB.connection.prepare('SELECT owner_id FROM task_runs WHERE id=?').get(t.id).owner_id;
    let begin,release;
    const entered=new Promise(resolve=>{begin=resolve});
    const gate=new Promise(resolve=>{release=resolve});
    const pending=advanceSyntheticTask(e,owner,t.id,t.version,Date.now(),async()=>{
      begin();await gate;return 'LEAD_VERIFIED';
    });
    await entered;
    const leased=(await inspect(e,tokenA,t.id)).task;
    assert.equal(leased.status,'RUNNING');
    const cancelled=await request(e,tokenA,'/v1/tasks/'+t.id+'/cancel','POST',
      {expectedVersion:leased.version});
    assert.equal(cancelled.status,200);
    release();
    const stale=await pending;
    assert.equal(stale.status,409);
    const result=await inspect(e,tokenA,t.id);
    assert.equal(result.task.status,'CANCELLED');
    assert.deepEqual(result.steps.map(s=>s.status),['CANCELLED','CANCELLED','CANCELLED']);
    assert.equal((await advance(e,tokenA,result.task)).status,409);
    assert.equal((await request(e,tokenA,'/v1/tasks/'+t.id+'/cancel','POST',
      {expectedVersion:result.task.version})).status,409);
  }finally{globalThis.fetch=originalFetch;close(e);}
});

test('P2-C: expired lease can be re-claimed but stale lease cannot finish later',async()=>{
  globalThis.fetch=mockJwks;const e=env();
  try{
    const t=await token('task-lease');await onboard(e,t);
    const l=await lead(e,t),task=(await (await taskCreate(e,t,createBody(l))).json()).task;
    const owner=e.DB.connection.prepare('SELECT owner_id FROM task_runs WHERE id=?').get(task.id).owner_id;
    let enter,release;
    const entered=new Promise(resolve=>{enter=resolve});
    const gate=new Promise(resolve=>{release=resolve});
    const now=Date.now();
    const old=advanceSyntheticTask(e,owner,task.id,task.version,now,async()=>{
      enter();await gate;return 'LEAD_VERIFIED';
    });
    await entered;
    let current=(await inspect(e,t,task.id)).task;
    const blocked=await advanceSyntheticTask(e,owner,task.id,current.version,now+1000);
    assert.equal(blocked.status,409);
    const reclaimed=await advanceSyntheticTask(e,owner,task.id,current.version,now+46_000);
    assert.equal(reclaimed.status,200,JSON.stringify(await reclaimed.json()));
    current=(await reclaimed.json()).task;
    assert.equal(current.currentStep,1);
    release();const stale=await old;
    assert.equal(stale.status,409);
    const report=await inspect(e,t,task.id);
    assert.equal(report.steps[0].status,'SUCCEEDED');
    assert.equal(report.steps[0].attempts,2);
    assert.equal(report.steps[1].status,'READY');
    assert.equal(e.DB.connection.prepare('SELECT claims FROM task_step_budgets').get().claims,2);
  }finally{globalThis.fetch=originalFetch;close(e);}
});

test('P2-C: three deterministic evaluator failures lead to backoff and terminal FAILED',async()=>{
  globalThis.fetch=mockJwks;const e=env();
  try{
    const t=await token('task-fail');await onboard(e,t);
    const l=await lead(e,t),task=(await (await taskCreate(e,t,createBody(l))).json()).task;
    const owner=e.DB.connection.prepare('SELECT owner_id FROM task_runs WHERE id=?').get(task.id).owner_id;
    const alwaysFail=async()=>{throw new Error('synthetic failure only')};
    let current=task, now=Date.now();
    for(let attempt=1;attempt<=3;attempt++){
      const r=await advanceSyntheticTask(e,owner,task.id,current.version,now,alwaysFail);
      assert.equal(r.status,200,JSON.stringify(await r.json()));
      const item=await r.json();
      current=item.task;
      assert.equal(item.steps[0].attempts,attempt);
      assert.equal(current.status,attempt===3?'FAILED':'RUNNING');
      if(attempt<3){
        const early=await advanceSyntheticTask(e,owner,task.id,current.version,now+1,alwaysFail);
        assert.equal(early.status,409);
        now=item.steps[0].nextAttemptAt+1;
      }
    }
    assert.equal(current.currentStep,0);
    assert.equal((await advanceSyntheticTask(e,owner,task.id,current.version,now+1000)).status,409);
    assert.equal(e.DB.connection.prepare('SELECT COUNT(*) AS n FROM observations').get().n,0);
  }finally{globalThis.fetch=originalFetch;close(e);}
});

test('P2-C: persisted hourly quota, backward-time protection and no implicit Cron',async()=>{
  globalThis.fetch=mockJwks;const e=env();
  try{
    const t=await token('task-quota');await onboard(e,t);
    const l=await lead(e,t),task=(await (await taskCreate(e,t,createBody(l))).json()).task;
    const owner=e.DB.connection.prepare('SELECT owner_id FROM task_runs WHERE id=?').get(task.id).owner_id;
    const windowStart=Math.floor(Date.now()/3_600_000)*3_600_000;
    e.DB.connection.prepare('INSERT INTO task_step_budgets(owner_id,window_start,claims) VALUES(?,?,?)')
      .run(owner,windowStart,11);
    const one=await advanceSyntheticTask(e,owner,task.id,task.version,windowStart+10_000);
    assert.equal(one.status,200);
    const next=(await one.json()).task;
    assert.equal(e.DB.connection.prepare('SELECT claims FROM task_step_budgets').get().claims,12);
    assert.equal((await advanceSyntheticTask(e,owner,task.id,next.version,windowStart+20_000)).status,429);
    const rewound=await advanceSyntheticTask(e,owner,task.id,next.version,windowStart-3600_000);
    assert.equal(rewound.status,429,'clock rollback cannot reset a newer quota window');
    const later=await advanceSyntheticTask(e,owner,task.id,next.version,windowStart+3600_1000);
    assert.equal(later.status,200,'new hour replenishes budget');
    assert.equal(e.DB.connection.prepare('SELECT claims FROM task_step_budgets').get().claims,1);
    assert.equal(e.DB.connection.prepare('SELECT COUNT(*) AS n FROM task_runs').get().n,1);
  }finally{globalThis.fetch=originalFetch;close(e);}
});

test('P2-C: strict typed actions, quota on task creation, and never a provider dispatch',async()=>{
  globalThis.fetch=mockJwks;const e=env();
  try{
    const t=await token('task-validation');await onboard(e,t);
    const l=await lead(e,t);
    for(const bad of [
      {...createBody(l),provider:'REAL_CRM'},
      {...createBody(l),kind:'SHELL_EXEC'},
      {...createBody(l),code:'fetch("https://evil.invalid")'},
      {...createBody(l),leadId:'bad'},
      {...createBody(l),clientTaskId:'bad'},
    ])assert.equal((await taskCreate(e,t,bad)).status,400);
    assert.equal((await request(e,'not-a-jwt','/v1/tasks')).status,401);
    const created=(await (await taskCreate(e,t,createBody(l))).json()).task;
    assert.equal((await request(e,t,'/v1/tasks/'+created.id+'/advance','POST',
      {expectedVersion:1,force:true})).status,400);
    assert.equal((await request(e,t,'/v1/tasks/'+created.id+'/cancel','POST',
      {expectedVersion:0})).status,400);
    assert.equal((await request(e,t,'/v1/tasks/'+created.id+'/inject','POST',
      {expectedVersion:1})).status,404);
    for(let i=0;i<2;i++)assert.equal((await taskCreate(e,t,createBody(l))).status,201);
    assert.equal((await taskCreate(e,t,createBody(l))).status,429,
      'three concurrent uncompleted tasks are the pilot limit');
    assert.equal(e.DB.connection.prepare('SELECT COUNT(*) AS n FROM task_runs').get().n,3);
    assert.equal(e.DB.connection.prepare('SELECT COUNT(*) AS n FROM task_steps').get().n,9);
  }finally{globalThis.fetch=originalFetch;close(e);}
});
