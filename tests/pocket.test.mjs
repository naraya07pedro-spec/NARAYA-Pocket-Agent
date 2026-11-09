import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestDb } from './sqlite-d1.mjs';
import worker from '../worker/src/index.ts';
import { runScheduler } from '../worker/src/scheduler.ts';
import { GithubReadError } from '../worker/src/github.ts';

const TOKEN = 'private-test-token-which-is-at-least-32-characters';
const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40);
const origin = 'https://example.invalid';
const post = (env, obj, token=TOKEN) => worker.fetch(new Request(origin+'/v1/monitors', {
  method: 'POST', headers:{Authorization:`Bearer ${token}`, 'Content-Type':'application/json'}, body: JSON.stringify(obj),
}), env);
const get = (env, path, token=TOKEN) => worker.fetch(new Request(origin+path, {headers:{Authorization:`Bearer ${token}`}}), env);
const patch = (env, id, obj) => worker.fetch(new Request(origin+`/v1/monitors/${id}`,{
  method:'PATCH',headers:{Authorization:`Bearer ${TOKEN}`, 'Content-Type':'application/json'},body:JSON.stringify(obj),
}),env);
const gh = (...shas) => {
  let i=0;
  return async (url, opts) => {
    assert.equal(opts.method, 'GET');
    assert.equal(opts.redirect, 'error');
    assert.equal(new URL(url).host, 'api.github.com');
    assert.equal(new URL(url).pathname, '/repos/python/cpython/commits');
    assert.equal(new URL(url).searchParams.get('per_page'),'1');
    return new Response(JSON.stringify([{sha:shas[Math.min(i++,shas.length-1)]}]),{status:200,headers:{'Content-Type':'application/json'}});
  };
};
const make = () => {const DB=makeTestDb();return {DB,OWNER_API_TOKEN:TOKEN,OWNER_ID:'test-owner'}};
const insert = (env, repo='python/cpython')=>post(env,{repository:repo,intervalMinutes:30});
const monitorRow = env => env.DB.connection.prepare('SELECT * FROM monitors ORDER BY created_at LIMIT 1').get();
const observations=env=>env.DB.connection.prepare('SELECT * FROM observations ORDER BY observed_at').all();

test('health is public but protected endpoints reject missing and incorrect credentials',async()=>{
  const env=make();
  try {
    assert.equal((await worker.fetch(new Request(origin+'/health'),env)).status,200);
    assert.equal((await worker.fetch(new Request(origin+'/v1/monitors'),env)).status,401);
    assert.equal((await get(env,'/v1/monitors','wrong-token')).status,401);
    assert.equal((await get({...env,OWNER_API_TOKEN:''},'/v1/monitors')).status,503);
    assert.equal((await get(env,'/v1/monitors')).headers.get('Cache-Control'),'no-store');
  }finally{env.DB.close()}
});

test('creates and lists validated monitors with duplicates and capacity rejected',async()=>{
  const env=make();
  try {
    const created=await insert(env);assert.equal(created.status,201);
    const data=await created.json();assert.match(data.id,/^[0-9a-f-]{36}$/);
    assert.equal((await insert(env,'PYTHON/CPYTHON')).status,409);
    assert.equal((await insert(env,'microsoft/vscode')).status,201);
    assert.equal((await insert(env,'nodejs/node')).status,201);
    assert.equal((await insert(env,'cloudflare/workers-sdk')).status,409);
    const listed=await(await get(env,'/v1/monitors')).json();
    assert.equal(listed.monitors.length,3);
    assert.equal('lease_token' in listed.monitors[0],false);
    assert.equal('owner_id' in listed.monitors[0],false);
  }finally{env.DB.close()}
});

test('rejects malformed repos, unexpected fields, intervals, malformed body and oversize stream',async()=>{
  const env=make();
  try {
    for(const body of [
      {repository:'https://github.com/foo/bar',intervalMinutes:30},
      {repository:'evil/../repo',intervalMinutes:30},
      {repository:'foo/bar',intervalMinutes:1},
      {repository:'foo/bar',intervalMinutes:30,admin:true},
      {repository:'foo/bar',intervalMinutes:30.5},
    ]) assert.equal((await post(env,body)).status,400);
    const wrong=await worker.fetch(new Request(origin+'/v1/monitors',{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`},body:'{}'}),env);
    assert.equal(wrong.status,400);
    const oversized=await worker.fetch(new Request(origin+'/v1/monitors',{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:' '.repeat(5000)}),env);
    assert.equal(oversized.status,413);
  }finally{env.DB.close()}
});

test('cloud tick creates a baseline once, persists it and detects true changes',async()=>{
  const env=make();
  try{
    await insert(env);
    const start=monitorRow(env).next_due_at;
    assert.deepEqual(await runScheduler(env,start,gh(A)),{claimed:1,completed:1,observations:1,deferred:0,skipped:0});
    assert.equal(observations(env)[0].event_type,'BASELINE');
    assert.equal(observations(env)[0].head_sha,A);
    assert.equal((await runScheduler(env,start+10,gh(B))).claimed,0);
    const later=start+30*60_000;
    assert.equal((await runScheduler(env,later,gh(A))).observations,0);
    assert.equal((await runScheduler(env,later+30*60_000,gh(B))).observations,1);
    assert.equal(observations(env).length,2);
    assert.equal(observations(env)[1].event_type,'CHANGE');
    assert.equal(observations(env)[1].previous_sha,A);
    const id=monitorRow(env).id;
    const response=await get(env,`/v1/observations?monitorId=${id}`);
    assert.equal((await response.json()).observations.length,2);
  }finally{env.DB.close()}
});

test('rate-limit defers without inventing a successful provider observation',async()=>{
  const env=make();
  try{
    await insert(env);const now=monitorRow(env).next_due_at;
    const fake=async()=>new Response('rate limit',{status:429});
    const result=await runScheduler(env,now,fake);
    assert.equal(result.deferred,1);assert.equal(observations(env).length,0);
    assert.equal(monitorRow(env).last_error_code,'RATE_LIMITED');
    assert.equal(monitorRow(env).next_due_at,now+60*60_000);
  }finally{env.DB.close()}
});

test('invalid upstream response and repeated failures eventually pause to protect quota',async()=>{
  const env=make();
  try{
    await insert(env);
    let now=monitorRow(env).next_due_at;
    for(let i=0;i<5;i++){
      const result=await runScheduler(env,now,async()=>new Response('[{"sha":"not-a-sha"}]'));
      assert.equal(result.deferred,1);
      now=monitorRow(env).next_due_at;
    }
    assert.equal(monitorRow(env).status,'PAUSED');
    assert.equal(monitorRow(env).fail_count,5);
    assert.equal((await runScheduler(env,now,gh(A))).claimed,0);
    assert.equal(observations(env).length,0);
  }finally{env.DB.close()}
});

test('pause invalidates in-flight lease and stale worker never records a false success',async()=>{
  const env=make();
  try{
    await insert(env);
    const base=monitorRow(env).next_due_at;
    let resume;const gate=new Promise(r=>resume=r);
    let started;const entered=new Promise(r=>started=r);
    const pending=runScheduler(env,base,async()=>{started();await gate;return new Response(JSON.stringify([{sha:A}]));});
    await entered;
    const current=monitorRow(env);
    const changed=await patch(env,current.id,{status:'PAUSED',expectedVersion:current.version});
    assert.equal(changed.status,200);
    resume();
    const result=await pending;
    assert.equal(result.skipped,1);assert.equal(observations(env).length,0);
    assert.equal(monitorRow(env).status,'PAUSED');
  }finally{env.DB.close()}
});

test('expired lease may be reclaimed but old worker cannot overwrite newer observation',async()=>{
  const env=make();
  try{
    await insert(env);const now=monitorRow(env).next_due_at;
    let release;const gate=new Promise(r=>release=r);
    let notify;const ready=new Promise(r=>notify=r);
    const stale=runScheduler(env,now,async()=>{notify();await gate;return new Response(JSON.stringify([{sha:A}]));});
    await ready;
    const fresh=await runScheduler(env,now+46_000,gh(B));
    assert.equal(fresh.observations,1);
    release();const old=await stale;
    assert.equal(old.skipped,1);
    assert.equal(monitorRow(env).last_sha,B);
    assert.equal(observations(env).length,1);
  }finally{env.DB.close()}
});

test('optimistic status update blocks stale client and cross-owner observations',async()=>{
  const env=make();
  try{
    const created=await(await insert(env)).json();
    assert.equal((await patch(env,created.id,{status:'PAUSED',expectedVersion:1})).status,200);
    assert.equal((await patch(env,created.id,{status:'ACTIVE',expectedVersion:1})).status,409);
    assert.equal((await patch(env,created.id,{status:'ACTIVE',expectedVersion:2})).status,200);
    assert.equal((await runScheduler(env,monitorRow(env).next_due_at,gh(A))).observations,1);
    const another={...env,OWNER_ID:'other-tenant'};
    assert.equal((await(await get(another,`/v1/observations?monitorId=${created.id}`)).json()).observations.length,0);
    assert.equal((await(await get(another,'/v1/monitors')).json()).monitors.length,0);
  }finally{env.DB.close()}
});

test('GitHub reads are redirect-disabled fixed GET and network rejection is conservatively deferred',async()=>{
  const env=make();
  try{
    await insert(env);const now=monitorRow(env).next_due_at;
    let url,options;
    const fake=async(u,o)=>{url=u;options=o;throw new Error('connection lost');};
    assert.equal((await runScheduler(env,now,fake)).deferred,1);
    assert.equal(new URL(url).host,'api.github.com');
    assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
    assert.equal(monitorRow(env).last_error_code,'NETWORK_ERROR');
    assert.equal(observations(env).length,0);
  }finally{env.DB.close()}
});


test('missing, invalid or empty owner configuration denies all access and scheduled work', async()=>{
  const env=make();
  try {
    for(const OWNER_ID of [undefined,'', 'owner with spaces', 'x'.repeat(65)]) {
      const invalid={...env,OWNER_ID};
      assert.equal((await get(invalid,'/v1/monitors')).status,503);
      await assert.rejects(runScheduler(invalid,Date.now(),gh(A)),/owner_not_configured/);
    }
    assert.equal((await get(env,'/v1/monitors')).status,200);
  } finally { env.DB.close(); }
});

test('upstream response is bounded while streaming and malformed UTF-8 cannot create observations', async()=>{
  const env=make();
  try {
    await insert(env);
    let when=monitorRow(env).next_due_at;
    const large=async()=>new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(32768).fill(32));
        controller.enqueue(new Uint8Array([123]));
        controller.close();
      },
    }),{status:200});
    assert.equal((await runScheduler(env,when,large)).deferred,1);
    assert.equal(monitorRow(env).last_error_code,'INVALID_PROVIDER_DATA');
    assert.equal(observations(env).length,0);
    when=monitorRow(env).next_due_at;
    const invalidUtf8=async()=>new Response(new Uint8Array([0xff,0xfe]),{status:200});
    assert.equal((await runScheduler(env,when,invalidUtf8)).deferred,1);
    assert.equal(monitorRow(env).last_error_code,'INVALID_PROVIDER_DATA');
    assert.equal(observations(env).length,0);
  } finally {env.DB.close();}
});
