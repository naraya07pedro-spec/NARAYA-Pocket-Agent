import {boundedJson,InputError,json} from './domain.ts';
import {verifyOidcBearer} from './oidc.ts';
import {ownerFromVerifiedIdentity} from './mobile-sync.ts';
import type {Env} from './types.ts';

/**
 * P2-D: signed OIDC approval for a FINISHED, immutable synthetic task.
 * Creates exactly one task-bound inert effect intent and a P2-A approval
 * together in a D1 transaction. No dispatch endpoint, AI, PII or provider I/O.
 * Existing unbound P2-A approvals remain legacy/non-effect-capable.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const SERVICES=new Set(['EXHIBITION','INTERIOR','SIGNAGE']);
const TTL_MS=15*60_000;
interface Task {
  id:string;client_lead_id:string;lead_input_digest:string;
  version:number;status:string;current_step:number;service_code:string;
  input_digest:string;step_count:number;
}
interface Approval {
  id:string;owner_id:string;client_intent_id:string;
  task_id:string|null;task_input_digest:string|null;task_version:number|null;
  lead_id:string;service_code:string;payload_digest:string;
  target_digest:string;status:string;version:number;
  expires_at:number;created_at:number;decided_at:number|null;
}
interface Effect {
  id:string;owner_id:string;task_id:string;approval_id:string;
  provider:string;operation:string;target:string;
  client_lead_id:string;service_code:string;task_input_digest:string;
  task_version:number;payload_digest:string;target_digest:string;
  status:string;created_at:number;decided_at:number|null;
}
function input(body:unknown){
  if(!body||typeof body!=='object'||Array.isArray(body))
    throw new InputError('invalid_task_approval_request');
  const b=body as Record<string,unknown>;
  if(Object.keys(b).sort().join(',')!=='clientIntentId,operation,payload,provider,target,taskId' ||
    typeof b.clientIntentId!=='string'||!UUID.test(b.clientIntentId) ||
    typeof b.taskId!=='string'||!UUID.test(b.taskId) ||
    b.provider!=='SYNTHETIC_ONLY'||b.operation!=='CREATE_CRM_LEAD'||
    b.target!=='synthetic-crm'||!b.payload||typeof b.payload!=='object'||
    Array.isArray(b.payload))
      throw new InputError('invalid_task_approval_request');
  const p=b.payload as Record<string,unknown>;
  if(Object.keys(p).sort().join(',')!=='leadId,serviceCode' ||
    typeof p.leadId!=='string'||!UUID.test(p.leadId) ||
    typeof p.serviceCode!=='string'||!SERVICES.has(p.serviceCode))
    throw new InputError('invalid_task_approval_request');
  return {clientIntentId:b.clientIntentId.toLowerCase(),
    taskId:b.taskId.toLowerCase(),leadId:p.leadId.toLowerCase(),
    serviceCode:p.serviceCode as string};
}
async function digest(parts:readonly (string|number)[]){
  const h=await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(JSON.stringify(parts)));
  return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function approvalView(row:Approval,now:number){
  return {id:row.id,clientIntentId:row.client_intent_id,taskId:row.task_id,
    leadId:row.lead_id,serviceCode:row.service_code,
    payloadDigest:row.payload_digest,targetDigest:row.target_digest,
    taskInputDigest:row.task_input_digest,taskVersion:row.task_version,
    status:row.status==='PENDING'&&row.expires_at<=now?'EXPIRED':row.status,
    version:row.version,expiresAt:row.expires_at,
    eligibleForDispatch:false,externalWrite:'NOT_IMPLEMENTED'};
}
function effectView(row:Effect){
  return {id:row.id,taskId:row.task_id,approvalId:row.approval_id,
    provider:'SYNTHETIC_ONLY',operation:'CREATE_CRM_LEAD',target:'synthetic-crm',
    leadId:row.client_lead_id,serviceCode:row.service_code,
    taskInputDigest:row.task_input_digest,taskVersion:row.task_version,
    payloadDigest:row.payload_digest,targetDigest:row.target_digest,
    status:row.status,createdAt:row.created_at,decidedAt:row.decided_at,
    eligibleForDispatch:false,externalWrite:'NOT_IMPLEMENTED'};
}
async function currentTask(env:Env,owner:string,taskId:string){
  return env.DB.prepare(`SELECT t.id,t.client_lead_id,t.lead_input_digest,
    t.version,t.status,t.current_step,l.service_code,l.input_digest,
    (SELECT COUNT(*) FROM task_steps s WHERE s.task_id=t.id
      AND s.status='SUCCEEDED') AS step_count
    FROM task_runs t
    JOIN synthetic_leads l ON l.owner_id=t.owner_id
      AND l.client_lead_id=t.client_lead_id
    WHERE t.id=? AND t.owner_id=?`)
    .bind(taskId,owner).first<Task>();
}
async function create(request:Request,env:Env,owner:string){
  const b=input(await boundedJson(request));
  const task=await currentTask(env,owner,b.taskId);
  if(!task||task.client_lead_id!==b.leadId||task.service_code!==b.serviceCode||
    task.status!=='SUCCEEDED'||task.current_step!==3||task.step_count!==3||
    !SHA.test(task.lead_input_digest)||task.input_digest!==task.lead_input_digest)
      return json({error:'task_not_completed_or_payload_mismatch'},409);

  const payloadDigest=await digest(['p2d-v1','SYNTHETIC_ONLY','CREATE_CRM_LEAD',
    'synthetic-crm',b.taskId,b.leadId,b.serviceCode,
    task.lead_input_digest,task.version]);
  const targetDigest=await digest(['p2d-target-v1','SYNTHETIC_ONLY',
    'CREATE_CRM_LEAD','synthetic-crm',b.taskId]);
  const now=Date.now(),approvalId=crypto.randomUUID(),effectId=crypto.randomUUID();
  const db=env.DB;
  // Both rows are created atomically. The second can only be created
  // from the freshly inserted approval UUID. A conflicting unique client
  // key or another approval for the same task cannot mint an effect.
  const result=await db.batch([
    db.prepare(`INSERT OR IGNORE INTO synthetic_approval_intents(
      id,owner_id,client_intent_id,provider,operation,target,payload_digest,
      target_digest,lead_id,service_code,status,version,expires_at,created_at,
      task_id,task_input_digest,task_version
    ) SELECT ?,t.owner_id,?,'SYNTHETIC_ONLY','CREATE_CRM_LEAD',
      'synthetic-crm',?,?,?,?,'PENDING',1,?,?,t.id,t.lead_input_digest,t.version
      FROM task_runs t JOIN synthetic_leads l
        ON l.owner_id=t.owner_id AND l.client_lead_id=t.client_lead_id
      WHERE t.id=? AND t.owner_id=? AND t.status='SUCCEEDED'
        AND t.current_step=3 AND t.version=? AND t.lead_input_digest=?
        AND t.client_lead_id=? AND l.input_digest=t.lead_input_digest
        AND l.service_code=?
        AND (SELECT COUNT(*) FROM task_steps WHERE task_id=t.id AND
          status='SUCCEEDED')=3
        AND (SELECT COUNT(*) FROM synthetic_approval_intents
          WHERE owner_id=t.owner_id)<100
        AND (SELECT COUNT(*) FROM synthetic_approval_intents
          WHERE owner_id=t.owner_id AND status='PENDING'
          AND expires_at>?)<5`)
      .bind(approvalId,b.clientIntentId,payloadDigest,targetDigest,
        b.leadId,b.serviceCode,now+TTL_MS,now,b.taskId,owner,
        task.version,task.lead_input_digest,b.leadId,b.serviceCode,now),
    db.prepare(`INSERT OR IGNORE INTO synthetic_effect_intents(
      id,owner_id,task_id,approval_id,provider,operation,target,
      client_lead_id,service_code,task_input_digest,task_version,
      payload_digest,target_digest,status,created_at
    ) SELECT ?,a.owner_id,a.task_id,a.id,'SYNTHETIC_ONLY',
      'CREATE_CRM_LEAD','synthetic-crm',a.lead_id,a.service_code,
      a.task_input_digest,a.task_version,a.payload_digest,a.target_digest,
      'AWAITING_APPROVAL',?
    FROM synthetic_approval_intents a
    WHERE a.id=? AND a.owner_id=? AND a.task_id=? AND a.status='PENDING'
      AND a.payload_digest=? AND a.target_digest=?`)
      .bind(effectId,now,approvalId,owner,b.taskId,payloadDigest,targetDigest),
  ]);
  const first=result[0]?.meta?.changes,second=result[1]?.meta?.changes;
  if(result.length!==2 || first===undefined || second===undefined ||
    (first!==0&&first!==1)||(second!==0&&second!==1) || first!==second)
    throw new Error('task_effect_atomic_commit_ambiguous');
  const approval=await db.prepare(`SELECT * FROM synthetic_approval_intents
    WHERE owner_id=? AND client_intent_id=?`)
    .bind(owner,b.clientIntentId).first<Approval>();
  if(!approval){
    const taken=await db.prepare(`SELECT id FROM synthetic_effect_intents
      WHERE owner_id=? AND task_id=?`).bind(owner,b.taskId).first();
    return json({error:taken?'task_effect_already_reserved':'task_approval_pilot_limit'},
      taken?409:429);
  }
  if(approval.task_id!==b.taskId||approval.lead_id!==b.leadId||
    approval.service_code!==b.serviceCode||
    approval.task_input_digest!==task.lead_input_digest||
    approval.task_version!==task.version||
    approval.payload_digest!==payloadDigest||approval.target_digest!==targetDigest)
    return json({error:'task_approval_idempotency_conflict'},409);
  const effect=await db.prepare(`SELECT * FROM synthetic_effect_intents
    WHERE owner_id=? AND approval_id=? AND task_id=?`)
    .bind(owner,approval.id,b.taskId).first<Effect>();
  if(!effect || effect.payload_digest!==payloadDigest||
    effect.target_digest!==targetDigest||
    effect.task_input_digest!==task.lead_input_digest)
    throw new Error('task_effect_missing_or_mismatched');
  return json({approval:approvalView(approval,now),effect:effectView(effect),
    created:first===1},first===1?201:200);
}
async function listEffects(env:Env,owner:string){
  const rows=await env.DB.prepare(`SELECT * FROM synthetic_effect_intents
    WHERE owner_id=? ORDER BY created_at DESC,id DESC LIMIT 10`)
    .bind(owner).all<Effect>();
  return json({effects:rows.results.map(effectView)});
}
async function getEffect(env:Env,owner:string,id:string){
  const effect=await env.DB.prepare(`SELECT * FROM synthetic_effect_intents
    WHERE id=? AND owner_id=?`).bind(id,owner).first<Effect>();
  return effect?json({effect:effectView(effect)}):
    json({error:'task_effect_not_found'},404);
}
export async function taskApprovalRoute(
  request:Request,env:Env,path:string,
):Promise<Response>{
  const {issuer,subject}=await verifyOidcBearer(request,env);
  const owner=await ownerFromVerifiedIdentity(issuer,subject,env);
  if(!owner)return json({error:'identity_not_registered'},409);
  if(path==='/v1/task-approvals'&&request.method==='POST')
    return create(request,env,owner);
  if(path==='/v1/task-effects'&&request.method==='GET')
    return listEffects(env,owner);
  const match=/^\/v1\/task-effects\/([0-9a-f-]{36})$/i.exec(path);
  if(match&&UUID.test(match[1])&&request.method==='GET')
    return getEffect(env,owner,match[1].toLowerCase());
  return json({error:'not_found'},404);
}
