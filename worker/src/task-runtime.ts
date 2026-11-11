import {boundedJson,InputError,json} from './domain.ts';
import {verifyOidcBearer} from './oidc.ts';
import {ownerFromVerifiedIdentity} from './mobile-sync.ts';
import type {Env} from './types.ts';

/**
 * P2-C: bounded D1 task control plane. All three steps are deterministic
 * synthetic validators; there is NO HTTP egress, AI call, CRM dispatch,
 * email, automatic Cron handler or human-approval bypass in this module.
 *
 * The public "advance" endpoint is manual, authenticated, one step per call.
 * Internal evaluator injection exists ONLY for deterministic race tests.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HOUR_MS=3_600_000;
const LEASE_MS=45_000;
const MAX_ATTEMPTS=3;
const MAX_STEPS_PER_HOUR=12;
const STEP_CODES=['VERIFY_LEAD','VERIFY_TRIAGE','VERIFY_DRAFT'] as const;
type StepCode=typeof STEP_CODES[number];
type TaskStatus='QUEUED'|'RUNNING'|'SUCCEEDED'|'FAILED'|'CANCELLED';
type StepStatus='READY'|'WAITING'|'RUNNING'|'SUCCEEDED'|'FAILED'|'CANCELLED';
interface TaskRow {
  id:string;owner_id:string;client_task_id:string;kind:string;
  client_lead_id:string;lead_input_digest:string;status:TaskStatus;
  current_step:number;version:number;created_at:number;updated_at:number;
  finished_at:number|null;
}
interface StepRow {
  id:string;task_id:string;step_index:number;step_code:StepCode;
  status:StepStatus;attempt_count:number;lease_token:string|null;
  lease_until:number|null;next_attempt_at:number;result_code:string|null;
  completed_at:number|null;updated_at:number;
}
export type StepEvaluator=(env:Env,owner:string,task:TaskRow,code:StepCode)=>Promise<string>;
const one=(row:{meta?:{changes?:number}}|undefined)=>row?.meta?.changes===1;

function typedObject(body:unknown,keys:readonly string[]):Record<string,unknown>{
  if(!body||typeof body!=='object'||Array.isArray(body))throw new InputError('invalid_task_request');
  const v=body as Record<string,unknown>;
  if(Object.keys(v).sort().join(',')!==[...keys].sort().join(','))
    throw new InputError('invalid_task_request');
  return v;
}
function createInput(body:unknown){
  const v=typedObject(body,['clientTaskId','kind','leadId']);
  if(typeof v.clientTaskId!=='string'||!UUID.test(v.clientTaskId)||
     v.kind!=='SYNTHETIC_LEAD_TRIAGE_V1'||
     typeof v.leadId!=='string'||!UUID.test(v.leadId))
    throw new InputError('invalid_task_request');
  return {clientTaskId:v.clientTaskId.toLowerCase(),leadId:v.leadId.toLowerCase()};
}
function versionInput(body:unknown){
  const v=typedObject(body,['expectedVersion']);
  if(!Number.isSafeInteger(v.expectedVersion)||Number(v.expectedVersion)<1)
    throw new InputError('invalid_task_request');
  return v.expectedVersion as number;
}
function checkedNow(now:number){
  if(!Number.isSafeInteger(now)||now<0)throw new Error('task_clock_invalid');
}
function taskView(t:TaskRow){
  return {id:t.id,clientTaskId:t.client_task_id,
    kind:'SYNTHETIC_LEAD_TRIAGE_V1',leadId:t.client_lead_id,
    leadInputDigest:t.lead_input_digest,status:t.status,
    currentStep:t.current_step,version:t.version,
    createdAt:t.created_at,updatedAt:t.updated_at,finishedAt:t.finished_at,
    externalWrite:'NOT_IMPLEMENTED',automaticDispatch:false};
}
function stepView(s:StepRow){
  return {id:s.id,index:s.step_index,code:s.step_code,status:s.status,
    attempts:s.attempt_count,nextAttemptAt:s.next_attempt_at,
    leaseUntil:s.status==='RUNNING'?s.lease_until:null,
    resultCode:s.result_code,completedAt:s.completed_at};
}
async function taskFor(env:Env,owner:string,id:string){
  return env.DB.prepare('SELECT * FROM task_runs WHERE id=? AND owner_id=?')
    .bind(id,owner).first<TaskRow>();
}
async function taskSteps(env:Env,id:string){
  return env.DB.prepare('SELECT * FROM task_steps WHERE task_id=? ORDER BY step_index')
    .bind(id).all<StepRow>();
}
async function detail(env:Env,owner:string,id:string){
  const t=await taskFor(env,owner,id);
  if(!t)return json({error:'task_not_found'},404);
  const steps=await taskSteps(env,id);
  if(steps.results.length!==3||steps.results.some((s,i)=>
     s.step_index!==i||s.step_code!==STEP_CODES[i]))
    throw new Error('task_plan_integrity_invalid');
  return json({task:taskView(t),steps:steps.results.map(stepView)});
}
async function list(env:Env,owner:string){
  const rows=await env.DB.prepare('SELECT * FROM task_runs WHERE owner_id=? ORDER BY created_at DESC,id DESC LIMIT 10')
    .bind(owner).all<TaskRow>();
  return json({tasks:rows.results.map(taskView)});
}
async function create(request:Request,env:Env,owner:string){
  const input=createInput(await boundedJson(request));
  const lead=await env.DB.prepare('SELECT input_digest FROM synthetic_leads WHERE owner_id=? AND client_lead_id=?')
    .bind(owner,input.leadId).first<{input_digest:string}>();
  if(!lead||typeof lead.input_digest!=='string'||!/^[0-9a-f]{64}$/.test(lead.input_digest))
    return json({error:'synthetic_lead_not_found'},409);
  const now=Date.now(), id=crypto.randomUUID();
  const db=env.DB;
  // A single D1 transaction creates task AND exactly three immutable steps.
  // A second client using the same idempotency key cannot generate extra steps:
  // its task UUID is different so its three SELECTs have no matching task.
  const statements=[
    db.prepare(`INSERT OR IGNORE INTO task_runs(
      id,owner_id,client_task_id,kind,client_lead_id,lead_input_digest,
      status,current_step,version,created_at,updated_at
    ) SELECT ?,?,?,'SYNTHETIC_LEAD_TRIAGE_V1',?,?,'QUEUED',0,1,?,?
      WHERE (SELECT COUNT(*) FROM task_runs WHERE owner_id=?)<50
      AND (SELECT COUNT(*) FROM task_runs WHERE owner_id=?
        AND status IN ('QUEUED','RUNNING'))<3
      AND EXISTS(SELECT 1 FROM synthetic_leads
        WHERE owner_id=? AND client_lead_id=? AND input_digest=?)`)
      .bind(id,owner,input.clientTaskId,input.leadId,lead.input_digest,
        now,now,owner,owner,owner,input.leadId,lead.input_digest),
    ...STEP_CODES.map((code,index)=>db.prepare(`INSERT OR IGNORE INTO task_steps(
      id,task_id,step_index,step_code,status,attempt_count,
      lease_token,lease_until,next_attempt_at,result_code,completed_at,updated_at
    ) SELECT ?,id,?,?,?,0,NULL,NULL,0,NULL,NULL,? FROM task_runs
      WHERE id=? AND owner_id=?`).bind(
      crypto.randomUUID(),index,code,index===0?'READY':'WAITING',now,id,owner)),
  ];
  const result=await db.batch(statements);
  const inserted=one(result[0]);
  if(result.length!==4||result.some((r,i)=>r.meta?.changes!==(inserted?1:0)))
    throw new Error('task_atomic_creation_metadata_invalid');
  const t=await env.DB.prepare('SELECT * FROM task_runs WHERE owner_id=? AND client_task_id=?')
    .bind(owner,input.clientTaskId).first<TaskRow>();
  if(!t)return json({error:'task_pilot_limit'},429);
  if(t.client_lead_id!==input.leadId||t.lead_input_digest!==lead.input_digest)
    return json({error:'task_idempotency_payload_conflict'},409);
  return json({task:taskView(t),created:inserted},inserted?201:200);
}
async function refundBudget(env:Env,owner:string,windowStart:number){
  // A failed or ambiguous refund only consumes capacity, never increases it.
  await env.DB.prepare('UPDATE task_step_budgets SET claims=claims-1 WHERE owner_id=? AND window_start=? AND claims>0')
    .bind(owner,windowStart).run();
}
async function reserveBudget(env:Env,owner:string,now:number){
  const start=Math.floor(now/HOUR_MS)*HOUR_MS;
  await env.DB.prepare('INSERT OR IGNORE INTO task_step_budgets(owner_id,window_start,claims) VALUES(?,?,0)')
    .bind(owner,start).run();
  const reserved=await env.DB.prepare(`UPDATE task_step_budgets
    SET claims=CASE WHEN window_start=? THEN claims+1 ELSE 1 END,
      window_start=?
    WHERE owner_id=? AND window_start<=?
    AND (window_start<? OR claims<?)`)
    .bind(start,start,owner,start,start,MAX_STEPS_PER_HOUR).run();
  return {start,ok:one(reserved)};
}
async function evaluateSyntheticStep(env:Env,owner:string,task:TaskRow,code:StepCode){
  const lead=await env.DB.prepare(`SELECT input_digest,priority,reply_draft FROM synthetic_leads
    WHERE owner_id=? AND client_lead_id=?`)
    .bind(owner,task.client_lead_id).first<{
      input_digest:string;priority:string;reply_draft:string;
    }>();
  if(!lead||lead.input_digest!==task.lead_input_digest)
    throw new Error('lead_immutable_digest_missing');
  if(code==='VERIFY_LEAD')return 'LEAD_VERIFIED';
  if(code==='VERIFY_TRIAGE'){
    if(!['TIME_SENSITIVE','NEEDS_BUDGET','STANDARD_REVIEW'].includes(lead.priority))
      throw new Error('triage_invalid');
    return 'TRIAGE_VERIFIED';
  }
  if(code==='VERIFY_DRAFT'){
    if(typeof lead.reply_draft!=='string'||lead.reply_draft.length<1||
       lead.reply_draft.length>400)throw new Error('draft_invalid');
    return 'DRAFT_VERIFIED_NO_SEND';
  }
  throw new Error('step_code_disallowed');
}
const EXPECTED_RESULTS=['LEAD_VERIFIED','TRIAGE_VERIFIED','DRAFT_VERIFIED_NO_SEND'];
async function markExhausted(env:Env,owner:string,t:TaskRow,s:StepRow,now:number){
  const db=env.DB;
  const results=await db.batch([
    db.prepare(`UPDATE task_steps SET status='FAILED',lease_token=NULL,
      lease_until=NULL,result_code='RETRY_EXHAUSTED',updated_at=?
      WHERE task_id=? AND step_index=? AND attempt_count>=3
      AND (status='READY' OR (status='RUNNING' AND lease_until<=?))
      AND EXISTS(SELECT 1 FROM task_runs WHERE id=? AND owner_id=?
        AND version=? AND current_step=? AND status IN ('QUEUED','RUNNING'))`)
      .bind(now,t.id,t.current_step,now,t.id,owner,t.version,t.current_step),
    db.prepare(`UPDATE task_runs SET status='FAILED',version=version+1,
      finished_at=?,updated_at=? WHERE id=? AND owner_id=? AND version=?
      AND status IN ('QUEUED','RUNNING') AND EXISTS(
        SELECT 1 FROM task_steps WHERE task_id=? AND step_index=?
        AND status='FAILED' AND result_code='RETRY_EXHAUSTED')`)
      .bind(now,now,t.id,owner,t.version,t.id,t.current_step),
  ]);
  return one(results[0])&&one(results[1]);
}
export async function advanceSyntheticTask(
  env:Env,owner:string,id:string,expectedVersion:number,
  now=Date.now(),evaluator:StepEvaluator=evaluateSyntheticStep,
):Promise<Response>{
  checkedNow(now);
  const task=await taskFor(env,owner,id);
  if(!task)return json({error:'task_not_found'},404);
  if(task.version!==expectedVersion||!['QUEUED','RUNNING'].includes(task.status)||
     task.current_step<0||task.current_step>2)return json({error:'task_stale_or_terminal'},409);
  const steps=await taskSteps(env,id);
  if(steps.results.length!==3||steps.results.some((s,i)=>s.step_index!==i||s.step_code!==STEP_CODES[i]))
    throw new Error('task_plan_integrity_invalid');
  const step=steps.results[task.current_step];
  if(step.status==='RUNNING'&&step.lease_until!==null&&step.lease_until>now)
    return json({error:'task_step_leased'},409);
  if(step.status==='READY'&&step.next_attempt_at>now)
    return json({error:'task_step_backoff'},409);
  if(step.attempt_count>=MAX_ATTEMPTS){
    if(await markExhausted(env,owner,task,step,now))return detail(env,owner,id);
    return json({error:'task_stale_or_terminal'},409);
  }
  if(step.status!=='READY'&&step.status!=='RUNNING')
    return json({error:'task_step_not_runnable'},409);
  const slot=await reserveBudget(env,owner,now);
  if(!slot.ok)return json({error:'task_step_hourly_budget_exhausted'},429);
  const lease=crypto.randomUUID();
  const db=env.DB;
  // Lease claim and task version transition are a single transaction.
  const claimed=await db.batch([
    db.prepare(`UPDATE task_steps SET status='RUNNING',
      attempt_count=attempt_count+1,lease_token=?,lease_until=?,updated_at=?
      WHERE task_id=? AND step_index=? AND attempt_count<3
      AND (status='READY' AND next_attempt_at<=?
        OR status='RUNNING' AND lease_until<=?)
      AND EXISTS(SELECT 1 FROM task_runs t WHERE t.id=task_steps.task_id
        AND t.owner_id=? AND t.version=? AND t.current_step=?
        AND t.status IN ('QUEUED','RUNNING'))`)
      .bind(lease,now+LEASE_MS,now,id,task.current_step,now,now,
        owner,expectedVersion,task.current_step),
    db.prepare(`UPDATE task_runs SET status='RUNNING',version=version+1,updated_at=?
      WHERE id=? AND owner_id=? AND version=? AND current_step=?
      AND status IN ('QUEUED','RUNNING')
      AND EXISTS(SELECT 1 FROM task_steps WHERE task_id=? AND step_index=?
        AND status='RUNNING' AND lease_token=?)`)
      .bind(now,id,owner,expectedVersion,task.current_step,
        id,task.current_step,lease),
  ]);
  if(!one(claimed[0])||!one(claimed[1])){
    // Only refund when both durable statements EXPLICITLY report zero changes.
    // Missing metadata/partial or ambiguous commits may have claimed a lease.
    // Refunding those would silently permit exceeding the hourly budget.
    if(claimed.length===2 && claimed.every(row=>row.meta?.changes===0))
      await refundBudget(env,owner,slot.start);
    return json({error:'task_step_claim_conflict'},409);
  }
  // No provider calls. Only previously persisted dummy/typed data is read.
  let success=false,resultCode='SYNTHETIC_VALIDATION_FAILED';
  try{
    const code=await evaluator(env,owner,task,step.step_code);
    if(code!==EXPECTED_RESULTS[task.current_step])throw new Error('unrecognized_result');
    success=true;resultCode=code;
  }catch{
    // Failure is retryable at a bounded delay; third failure is terminal.
    // This cannot conceal an external effect because no external effect exists.
  }
  const attempts=step.attempt_count+1;
  const terminal=!success&&attempts>=MAX_ATTEMPTS;
  const retryAt=now+Math.min(60,5*2**attempts)*1000;
  const finished=await db.batch([
    db.prepare(`UPDATE task_steps SET status=?,result_code=?,
      lease_token=NULL,lease_until=NULL,
      next_attempt_at=?,completed_at=?,updated_at=?
      WHERE task_id=? AND step_index=? AND status='RUNNING' AND lease_token=?
      AND attempt_count=? AND EXISTS(SELECT 1 FROM task_runs t
        WHERE t.id=task_steps.task_id AND t.owner_id=?
        AND t.status='RUNNING' AND t.version=? AND t.current_step=?)`)
      .bind(success?'SUCCEEDED':terminal?'FAILED':'READY',
        resultCode,success||terminal?0:retryAt,success||terminal?now:null,now,
        id,task.current_step,lease,attempts,owner,expectedVersion+1,task.current_step),
    db.prepare(`UPDATE task_runs SET current_step=?,status=?,
      version=version+1,updated_at=?,finished_at=?
      WHERE id=? AND owner_id=? AND version=? AND status='RUNNING'
      AND current_step=? AND EXISTS(SELECT 1 FROM task_steps
        WHERE task_id=? AND step_index=? AND status=?
        AND attempt_count=? AND result_code=? AND lease_token IS NULL)`)
      .bind(success?task.current_step+1:task.current_step,
        success&&task.current_step===2?'SUCCEEDED':terminal?'FAILED':'RUNNING',
        now,success&&task.current_step===2||terminal?now:null,
        id,owner,expectedVersion+1,task.current_step,
        id,task.current_step,
        success?'SUCCEEDED':terminal?'FAILED':'READY',attempts,resultCode),
    ...success&&task.current_step<2
      ? [db.prepare(`UPDATE task_steps SET status='READY',updated_at=?
          WHERE task_id=? AND step_index=? AND status='WAITING'
          AND EXISTS(SELECT 1 FROM task_runs WHERE id=? AND owner_id=?
            AND current_step=? AND status='RUNNING')`)
          .bind(now,id,task.current_step+1,id,owner,task.current_step+1)]
      : [],
  ]);
  if(finished.length!==(success&&task.current_step<2?3:2)||
     finished.some(r=>!one(r)))
    return json({error:'task_step_lease_lost_or_ambiguous'},409);
  return detail(env,owner,id);
}
async function cancel(env:Env,owner:string,id:string,expectedVersion:number){
  const now=Date.now(),db=env.DB;
  const results=await db.batch([
    db.prepare(`UPDATE task_runs SET status='CANCELLED',version=version+1,
      updated_at=?,finished_at=? WHERE id=? AND owner_id=? AND version=?
      AND status IN ('QUEUED','RUNNING')`)
      .bind(now,now,id,owner,expectedVersion),
    db.prepare(`UPDATE task_steps SET status='CANCELLED',lease_token=NULL,
      lease_until=NULL,updated_at=? WHERE task_id=? AND status IN
      ('READY','WAITING','RUNNING') AND EXISTS(SELECT 1 FROM task_runs
        WHERE id=? AND owner_id=? AND status='CANCELLED'
        AND version=?)`)
      .bind(now,id,id,owner,expectedVersion+1),
  ]);
  if(!one(results[0]))return json({error:'task_stale_or_terminal'},409);
  if(results[1]?.meta?.changes===undefined)
    throw new Error('task_cancel_step_metadata_missing');
  return detail(env,owner,id);
}
export async function taskRuntimeRoute(request:Request,env:Env,path:string):Promise<Response>{
  const {issuer,subject}=await verifyOidcBearer(request,env);
  const owner=await ownerFromVerifiedIdentity(issuer,subject,env);
  if(!owner)return json({error:'identity_not_registered'},409);
  if(path==='/v1/tasks'&&request.method==='GET')return list(env,owner);
  if(path==='/v1/tasks'&&request.method==='POST')return create(request,env,owner);
  const match=/^\/v1\/tasks\/([0-9a-f-]{36})(?:\/(advance|cancel))?$/i.exec(path);
  if(!match||!UUID.test(match[1]))return json({error:'not_found'},404);
  const id=match[1].toLowerCase();
  if(!match[2]&&request.method==='GET')return detail(env,owner,id);
  if(match[2]&&request.method==='POST'){
    const expectedVersion=versionInput(await boundedJson(request));
    if(match[2]==='cancel')return cancel(env,owner,id,expectedVersion);
    if(match[2]==='advance')return advanceSyntheticTask(env,owner,id,expectedVersion);
  }
  return json({error:'not_found'},404);
}
