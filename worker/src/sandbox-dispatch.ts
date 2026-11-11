import {boundedJson,InputError,json} from './domain.ts';
import {verifyOidcBearer} from './oidc.ts';
import {ownerFromVerifiedIdentity} from './mobile-sync.ts';
import type {Env} from './types.ts';

/**
 * P2-E synthetic provider simulator. All "provider" effects are only
 * INSERTs into sandbox_provider_records in the same local D1 database.
 * Never an HTTP call, CRM write, WhatsApp, email, tool or Cron dispatch.
 *
 * One eligible effect -> one dispatch claim -> at most one insert attempt.
 * An uncertain outcome is NEVER automatically retried, even if readback
 * currently finds no record. Reconciliation is read-only on provider data.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const LEASE_MS=45_000;
const MAX_RECONCILES=10;
type DispatchState='PREPARED'|'IN_FLIGHT'|'UNKNOWN_OUTCOME'|
  'CONFIRMED_APPLIED'|'QUARANTINED';
interface EffectBinding {
  id:string;owner_id:string;task_id:string;approval_id:string;
  payload_digest:string;target_digest:string;task_version:number;
  task_input_digest:string;client_lead_id:string;service_code:string;
  effect_status:string;approval_status:string;approval_task_id:string|null;
  approval_task_version:number|null;approval_payload_digest:string;
  approval_target_digest:string;task_status:string;task_version_now:number;
  task_lead_digest:string;
}
interface Dispatch {
  id:string;owner_id:string;effect_id:string;task_id:string;approval_id:string;
  payload_digest:string;target_digest:string;idempotency_key:string;
  state:DispatchState;version:number;attempt_count:number;
  lease_token:string|null;lease_until:number|null;readback:string;
  reconcile_count:number;created_at:number;updated_at:number;
}
interface Receipt {
  id:string;owner_id:string;effect_id:string;task_id:string;
  idempotency_key:string;payload_digest:string;target_digest:string;
}
export type SandboxFault='NONE'|'BEFORE_PROVIDER_COMMIT_TIMEOUT'|
  'AFTER_PROVIDER_COMMIT_TIMEOUT';
const one=(r:{meta?:{changes?:number}})=>r.meta?.changes===1;
function checkedTime(now:number){
  if(!Number.isSafeInteger(now)||now<0)throw Error('sandbox_clock_invalid');
}
function input(body:unknown){
  if(!body||typeof body!=='object'||Array.isArray(body)||
    Object.keys(body as Record<string,unknown>).length!==0)
    throw new InputError('sandbox_dispatch_no_parameters_allowed');
}
function view(d:Dispatch|null){
  if(!d)return {state:'NOT_ATTEMPTED',attemptCount:0,reconcileCount:0,
    externalWrite:'NONE',simulatedProvider:'D1_ONLY',safeToRetry:false};
  return {id:d.id,effectId:d.effect_id,state:d.state,version:d.version,
    attemptCount:d.attempt_count,reconcileCount:d.reconcile_count,
    readback:d.readback,leaseUntil:d.state==='IN_FLIGHT'?d.lease_until:null,
    externalWrite:'NONE',simulatedProvider:'D1_ONLY',safeToRetry:false};
}
async function binding(env:Env,owner:string,effectId:string){
  return env.DB.prepare(`SELECT e.id,e.owner_id,e.task_id,e.approval_id,
    e.payload_digest,e.target_digest,e.task_version,e.task_input_digest,
    e.client_lead_id,e.service_code,e.status AS effect_status,
    a.status AS approval_status,a.task_id AS approval_task_id,
    a.task_version AS approval_task_version,
    a.payload_digest AS approval_payload_digest,
    a.target_digest AS approval_target_digest,
    t.status AS task_status,t.version AS task_version_now,
    t.lead_input_digest AS task_lead_digest
    FROM synthetic_effect_intents e
    JOIN synthetic_approval_intents a ON a.id=e.approval_id
      AND a.owner_id=e.owner_id
    JOIN task_runs t ON t.id=e.task_id AND t.owner_id=e.owner_id
    WHERE e.id=? AND e.owner_id=?`)
    .bind(effectId,owner).first<EffectBinding>();
}
function verified(b:EffectBinding|null):b is EffectBinding{
  return !!b&&b.effect_status==='APPROVED_NO_DISPATCH'&&
    b.approval_status==='APPROVED_NO_DISPATCH'&&
    b.task_status==='SUCCEEDED'&&b.approval_task_id===b.task_id&&
    b.approval_task_version===b.task_version&&
    b.task_version_now===b.task_version&&
    b.task_lead_digest===b.task_input_digest&&
    SHA.test(b.payload_digest)&&SHA.test(b.target_digest)&&
    b.approval_payload_digest===b.payload_digest&&
    b.approval_target_digest===b.target_digest;
}
async function dispatchRow(env:Env,owner:string,effectId:string){
  return env.DB.prepare('SELECT * FROM sandbox_dispatches WHERE owner_id=? AND effect_id=?')
    .bind(owner,effectId).first<Dispatch>();
}
async function receipt(env:Env,owner:string,effectId:string){
  return env.DB.prepare('SELECT * FROM sandbox_provider_records WHERE owner_id=? AND effect_id=?')
    .bind(owner,effectId).first<Receipt>();
}
function matching(d:Dispatch,p:Receipt){
  return p.owner_id===d.owner_id&&p.effect_id===d.effect_id&&
    p.task_id===d.task_id&&p.idempotency_key===d.idempotency_key&&
    p.payload_digest===d.payload_digest&&p.target_digest===d.target_digest;
}
async function prepared(env:Env,owner:string,b:EffectBinding,now:number){
  const id=crypto.randomUUID(),key='synthetic-v1:'+b.id;
  const created=await env.DB.prepare(`INSERT OR IGNORE INTO sandbox_dispatches(
    id,owner_id,effect_id,approval_id,task_id,payload_digest,target_digest,
    idempotency_key,state,version,attempt_count,readback,created_at,updated_at
  ) SELECT ?,e.owner_id,e.id,e.approval_id,e.task_id,
      e.payload_digest,e.target_digest,?,
      'PREPARED',1,0,'NOT_CHECKED',?,?
    FROM synthetic_effect_intents e
    JOIN synthetic_approval_intents a ON a.id=e.approval_id
    JOIN task_runs t ON t.id=e.task_id
    WHERE e.id=? AND e.owner_id=? AND e.status='APPROVED_NO_DISPATCH'
      AND a.owner_id=e.owner_id AND a.status='APPROVED_NO_DISPATCH'
      AND a.task_id=e.task_id AND a.task_version=e.task_version
      AND a.payload_digest=e.payload_digest AND a.target_digest=e.target_digest
      AND t.owner_id=e.owner_id AND t.status='SUCCEEDED'
      AND t.version=e.task_version AND t.lead_input_digest=e.task_input_digest
      AND e.task_id=? AND e.payload_digest=? AND e.target_digest=?`)
    .bind(id,key,now,now,b.id,owner,b.task_id,b.payload_digest,b.target_digest).run();
  // Do not take an action based on ambiguous insertion metadata. The
  // requested operation is synthetic but provenance remains fail-closed.
  if(created.meta?.changes!==0&&created.meta?.changes!==1)
    throw Error('sandbox_preparation_metadata_ambiguous');
  const row=await dispatchRow(env,owner,b.id);
  if(!row||row.approval_id!==b.approval_id||row.task_id!==b.task_id||
    row.payload_digest!==b.payload_digest||row.target_digest!==b.target_digest||
    row.idempotency_key!==key)
    throw Error('sandbox_dispatch_binding_invalid');
  return row;
}
async function markUnknown(
  env:Env,owner:string,d:Dispatch,lease:string,now:number,
){
  await env.DB.prepare(`UPDATE sandbox_dispatches
    SET state='UNKNOWN_OUTCOME',version=version+1,lease_token=NULL,
      lease_until=NULL,updated_at=?
    WHERE id=? AND owner_id=? AND state='IN_FLIGHT'
      AND version=? AND lease_token=?`)
    .bind(now,d.id,owner,d.version,lease).run();
  return dispatchRow(env,owner,d.effect_id);
}
/**
 * Internal fault parameter is for deterministic tests only; never mapped from
 * user JSON. A single authenticated attempt can only dispatch a synthetic
 * D1 receipt once, and its durable effect UUID is its idempotency key.
 */
export async function attemptSandboxEffect(
  env:Env,owner:string,effectId:string,now=Date.now(),
  fault:SandboxFault='NONE',
):Promise<Response>{
  checkedTime(now);
  const b=await binding(env,owner,effectId);
  if(!b)return json({error:'sandbox_effect_not_found'},404);
  if(!verified(b))return json({error:'sandbox_effect_not_approved'},409);
  let d=await prepared(env,owner,b,now);
  if(d.state!=='PREPARED')
    return json({dispatch:view(d),replayed:true},
      d.state==='UNKNOWN_OUTCOME'||d.state==='IN_FLIGHT'?202:200);
  const lease=crypto.randomUUID();
  const claimed=await env.DB.prepare(`UPDATE sandbox_dispatches
    SET state='IN_FLIGHT',version=version+1,attempt_count=1,
      lease_token=?,lease_until=?,updated_at=?
    WHERE id=? AND owner_id=? AND state='PREPARED'
      AND version=? AND attempt_count=0
      AND EXISTS(SELECT 1 FROM synthetic_effect_intents e
        JOIN synthetic_approval_intents a ON a.id=e.approval_id
        WHERE e.id=sandbox_dispatches.effect_id AND e.owner_id=?
          AND e.status='APPROVED_NO_DISPATCH'
          AND a.owner_id=? AND a.status='APPROVED_NO_DISPATCH'
          AND a.task_id=e.task_id AND a.payload_digest=e.payload_digest
          AND a.target_digest=e.target_digest)`)
    .bind(lease,now+LEASE_MS,now,d.id,owner,d.version,owner,owner).run();
  if(!one(claimed)){
    d=await dispatchRow(env,owner,effectId)??d;
    return json({dispatch:view(d),claimUncertain:true},202);
  }
  d=await dispatchRow(env,owner,effectId)??d;
  if(d.lease_token!==lease||d.state!=='IN_FLIGHT'||d.attempt_count!==1)
    return json({error:'sandbox_claim_readback_mismatch'},409);
  // The provider mock has NO remote network call. Simulate timeouts
  // before/after its own durable commit without blindly retrying.
  if(fault==='BEFORE_PROVIDER_COMMIT_TIMEOUT'){
    const unknown=await markUnknown(env,owner,d,lease,now);
    return json({dispatch:view(unknown),providerOutcome:'UNKNOWN'},202);
  }
  try{
    await env.DB.prepare(`INSERT OR IGNORE INTO sandbox_provider_records(
      id,owner_id,effect_id,task_id,idempotency_key,
      payload_digest,target_digest,created_at
    ) SELECT ?,d.owner_id,d.effect_id,d.task_id,d.idempotency_key,
      d.payload_digest,d.target_digest,?
      FROM sandbox_dispatches d
      WHERE d.id=? AND d.owner_id=? AND d.state='IN_FLIGHT'
        AND d.version=? AND d.lease_token=? AND d.attempt_count=1`)
      .bind(crypto.randomUUID(),now,d.id,owner,d.version,lease).run();
    if(fault==='AFTER_PROVIDER_COMMIT_TIMEOUT')throw Error('synthetic_timeout_after_commit');
  }catch{
    // Provider may have committed. Do NOT try the write again.
    const unknown=await markUnknown(env,owner,d,lease,now);
    return json({dispatch:view(unknown),providerOutcome:'UNKNOWN'},202);
  }
  const record=await receipt(env,owner,effectId);
  if(!record||!matching(d,record)){
    const unknown=await markUnknown(env,owner,d,lease,now);
    return json({dispatch:view(unknown),providerOutcome:'UNKNOWN'},202);
  }
  const ok=await env.DB.prepare(`UPDATE sandbox_dispatches
    SET state='CONFIRMED_APPLIED',version=version+1,
      readback='FOUND_MATCH',last_reconciled_at=?,
      reconcile_count=reconcile_count+1,lease_token=NULL,lease_until=NULL,
      updated_at=?
    WHERE id=? AND owner_id=? AND state='IN_FLIGHT' AND version=?
      AND lease_token=? AND lease_until>=? AND reconcile_count<?`)
    .bind(now,now,d.id,owner,d.version,lease,now,MAX_RECONCILES).run();
  const current=await dispatchRow(env,owner,effectId);
  if(!one(ok)||current?.state!=='CONFIRMED_APPLIED')
    return json({dispatch:view(current),claimUncertain:true},202);
  return json({dispatch:view(current),providerOutcome:'CONFIRMED_BY_READBACK'},200);
}
export async function reconcileSandboxEffect(
  env:Env,owner:string,effectId:string,now=Date.now(),
):Promise<Response>{
  checkedTime(now);
  const b=await binding(env,owner,effectId);
  if(!b)return json({error:'sandbox_effect_not_found'},404);
  // Existing ledger is scoped to its originating approved task and owner.
  // Reconciliation is not permission to create or repeat a provider write.
  const d=await dispatchRow(env,owner,effectId);
  if(!d)return json({error:'sandbox_dispatch_not_created'},409);
  if(d.state==='CONFIRMED_APPLIED'||d.state==='QUARANTINED')
    return json({dispatch:view(d),replayed:true});
  if(d.state==='PREPARED')return json({error:'sandbox_not_attempted'},409);
  if(d.state==='IN_FLIGHT' && d.lease_until!==null && d.lease_until>now)
    return json({dispatch:view(d),reconciliation:'LEASE_STILL_ACTIVE'},202);
  if(d.reconcile_count>=MAX_RECONCILES)
    return json({error:'sandbox_reconcile_limit'},429);
  // READ-ONLY provider inspection: even absence is NOT authorization
  // to send a second write, as a delayed first attempt may still commit.
  const p=await receipt(env,owner,effectId);
  const found=!!p,good=!!p&&matching(d,p);
  const next=good?'CONFIRMED_APPLIED':found?'QUARANTINED':'UNKNOWN_OUTCOME';
  const evidence=good?'FOUND_MATCH':found?'FOUND_CONFLICT':'NOT_FOUND_UNCERTAIN';
  const changed=await env.DB.prepare(`UPDATE sandbox_dispatches
    SET state=?,readback=?,reconcile_count=reconcile_count+1,
      version=version+1,last_reconciled_at=?,
      lease_token=NULL,lease_until=NULL,updated_at=?
    WHERE id=? AND owner_id=? AND version=? AND reconcile_count<?
      AND (state='UNKNOWN_OUTCOME'
        OR state='IN_FLIGHT' AND lease_until<=?)`)
    .bind(next,evidence,now,now,d.id,owner,d.version,MAX_RECONCILES,now).run();
  const current=await dispatchRow(env,owner,effectId);
  if(!one(changed))
    return json({dispatch:view(current),reconciliation:'STALE_OR_UNCERTAIN'},409);
  return json({dispatch:view(current),
    reconciliation:good?'FOUND_MATCH':found?'QUARANTINED':'NOT_FOUND_UNCERTAIN',
    safeToRetry:false},good?200:202);
}
export async function sandboxDispatchRoute(
  request:Request,env:Env,path:string,
):Promise<Response>{
  const {issuer,subject}=await verifyOidcBearer(request,env);
  const owner=await ownerFromVerifiedIdentity(issuer,subject,env);
  if(!owner)return json({error:'identity_not_registered'},409);
  const match=/^\/v1\/sandbox-dispatches\/([0-9a-f-]{36})(?:\/(attempt|reconcile))?$/i.exec(path);
  if(!match||!UUID.test(match[1]))return json({error:'not_found'},404);
  const id=match[1].toLowerCase();
  if(!match[2]&&request.method==='GET'){
    const b=await binding(env,owner,id);
    if(!b)return json({error:'sandbox_effect_not_found'},404);
    const d=await dispatchRow(env,owner,id);
    return json({dispatch:view(d)});
  }
  if(match[2]&&request.method==='POST'){
    input(await boundedJson(request));
    if(match[2]==='attempt')return attemptSandboxEffect(env,owner,id);
    if(match[2]==='reconcile')return reconcileSandboxEffect(env,owner,id);
  }
  return json({error:'not_found'},404);
}
