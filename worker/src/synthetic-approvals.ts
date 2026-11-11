import {boundedJson, InputError, json} from './domain.ts';
import {verifyOidcBearer} from './oidc.ts';
import {ownerFromVerifiedIdentity} from './mobile-sync.ts';
import type {Env} from './types.ts';

/**
 * P2-A. Synthetic CRM lead preview/approval only; intentionally no provider
 * adapter, outbound HTTP, credential usage, task dispatcher or external write.
 * This module cannot turn an approved decision into a side effect.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const TTL_MS=15*60_000;
const ALLOWED=new Set(['EXHIBITION','INTERIOR','SIGNAGE']);
type IntentStatus='PENDING'|'APPROVED_NO_DISPATCH'|'DENIED';
interface IntentRow {
  id:string;client_intent_id:string;owner_id:string;provider:string;
  operation:string;target:string;lead_id:string;service_code:string;
  payload_digest:string;target_digest:string;status:IntentStatus;
  version:number;created_at:number;expires_at:number;decided_at:number|null;
}
function obj(value:unknown):value is Record<string,unknown>{
  return value!==null && typeof value==='object' && !Array.isArray(value);
}
function exact(value:Record<string,unknown>,keys:string[]){
  return Object.keys(value).sort().join(',')===keys.slice().sort().join(',');
}
function input(value:unknown){
  if(!obj(value)||!exact(value,['clientIntentId','operation','provider','target','payload'])||
     typeof value.clientIntentId!=='string'||!UUID.test(value.clientIntentId)||
     value.operation!=='CREATE_CRM_LEAD'||value.provider!=='SYNTHETIC_ONLY'||
     value.target!=='synthetic-crm'||!obj(value.payload)||
     !exact(value.payload,['leadId','serviceCode'])||
     typeof value.payload.leadId!=='string'||!UUID.test(value.payload.leadId)||
     typeof value.payload.serviceCode!=='string'||!ALLOWED.has(value.payload.serviceCode)){
    throw new InputError('invalid_synthetic_approval');
  }
  return {clientIntentId:value.clientIntentId.toLowerCase(),
    leadId:value.payload.leadId.toLowerCase(),serviceCode:value.payload.serviceCode};
}
function decision(value:unknown){
  if(!obj(value)||!exact(value,['decision','expectedVersion','payloadDigest','targetDigest'])||
      (value.decision!=='APPROVE'&&value.decision!=='DENY')||
      !Number.isSafeInteger(value.expectedVersion)||Number(value.expectedVersion)<1||
      typeof value.payloadDigest!=='string'||!SHA.test(value.payloadDigest)||
      typeof value.targetDigest!=='string'||!SHA.test(value.targetDigest)){
    throw new InputError('invalid_approval_decision');
  }
  return {choice:value.decision as 'APPROVE'|'DENY',
    version:value.expectedVersion as number,payloadDigest:value.payloadDigest,
    targetDigest:value.targetDigest};
}
async function digest(parts:readonly string[]):Promise<string>{
  const data=new TextEncoder().encode(JSON.stringify(parts));
  const hash=await crypto.subtle.digest('SHA-256',data);
  return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function view(row:IntentRow,now:number){
  return {id:row.id,clientIntentId:row.client_intent_id,
    provider:'SYNTHETIC_ONLY',operation:'CREATE_CRM_LEAD',
    target:'synthetic-crm',leadId:row.lead_id,
    serviceCode:row.service_code, // no email, phone or personal data accepted
    payloadDigest:row.payload_digest,targetDigest:row.target_digest,
    status:row.status==='PENDING'&&row.expires_at<=now?'EXPIRED':row.status,
    version:row.version,expiresAt:row.expires_at,
    externalWrite:'NOT_IMPLEMENTED',eligibleForDispatch:false};
}
async function registeredOwner(request:Request,env:Env){
  const {issuer,subject}=await verifyOidcBearer(request,env);
  const owner=await ownerFromVerifiedIdentity(issuer,subject,env);
  return owner;
}
async function create(request:Request,env:Env,owner:string){
  const body=input(await boundedJson(request));
  const now=Date.now();
  const payloadDigest=await digest(['p2a-v1',body.leadId,body.serviceCode]);
  const targetDigest=await digest(['p2a-v1','SYNTHETIC_ONLY','CREATE_CRM_LEAD','synthetic-crm']);
  const id=crypto.randomUUID();
  // One atomic D1 statement for both deduplication and the bounded pilot
  // quota. A repeated client-intent ID must preserve the original status.
  const created=await env.DB.prepare(`INSERT OR IGNORE INTO synthetic_approval_intents(
    id,owner_id,client_intent_id,provider,operation,target,
    payload_digest,target_digest,lead_id,service_code,status,version,
    expires_at,created_at
  ) SELECT ?,?,?,'SYNTHETIC_ONLY','CREATE_CRM_LEAD','synthetic-crm',
    ?,?,?,?,'PENDING',1,?,?
    WHERE (SELECT COUNT(*) FROM synthetic_approval_intents
      WHERE owner_id=?)<100
      AND (SELECT COUNT(*) FROM synthetic_approval_intents
        WHERE owner_id=? AND status='PENDING' AND expires_at>?)<5`)
    .bind(id,owner,body.clientIntentId,payloadDigest,targetDigest,body.leadId,
      body.serviceCode,now+TTL_MS,now,owner,owner,now).run();
  const changes=created.meta?.changes;
  if(changes!==0&&changes!==1)throw new Error('approval_insert_metadata_unavailable');
  const found=await env.DB.prepare(`SELECT * FROM synthetic_approval_intents
     WHERE owner_id=? AND client_intent_id=?`)
    .bind(owner,body.clientIntentId).first<IntentRow>();
  if(!found)return json({error:'approval_pilot_limit'},429);
  // Idempotency is tied to original target AND exact payload, not merely UUID.
  if(found.payload_digest!==payloadDigest||found.target_digest!==targetDigest||
     found.lead_id!==body.leadId||found.service_code!==body.serviceCode) {
    return json({error:'approval_intent_payload_conflict'},409);
  }
  return json({intent:view(found,now),created:changes===1},changes===1?201:200);
}
async function listing(env:Env,owner:string){
  const rows=await env.DB.prepare(`SELECT * FROM synthetic_approval_intents
     WHERE owner_id=? ORDER BY created_at DESC,id DESC LIMIT 10`)
    .bind(owner).all<IntentRow>();
  return json({intents:rows.results.map(row=>view(row,Date.now()))});
}
async function decide(request:Request,env:Env,owner:string,id:string){
  const body=decision(await boundedJson(request));
  const now=Date.now();
  const next=body.choice==='APPROVE'?'APPROVED_NO_DISPATCH':'DENIED';
  // An atomic versioned, owner-scoped CAS: stale, expired, wrong target,
  // wrong payload, forged user or duplicate decision cannot mutate anything.
  // APPROVED_NO_DISPATCH is deliberately NEVER an external provider effect.
  const result=await env.DB.prepare(`UPDATE synthetic_approval_intents
    SET status=?,version=version+1,decided_at=?
    WHERE id=? AND owner_id=? AND version=? AND status='PENDING'
      AND expires_at>? AND payload_digest=? AND target_digest=?`)
    .bind(next,now,id,owner,body.version,now,
      body.payloadDigest,body.targetDigest).run();
  if(result.meta?.changes!==1) return json({error:'approval_not_found_or_stale_expired'},409);
  return json({id,status:next,version:body.version+1,
    externalWrite:'NOT_IMPLEMENTED',eligibleForDispatch:false});
}

export async function syntheticApprovalRoute(
  request:Request,env:Env,path:string,
):Promise<Response>{
  // Sign-in is required for every read AND write, including unknown routes.
  const owner=await registeredOwner(request,env);
  if(!owner)return json({error:'identity_not_registered'},409);
  if(path==='/v1/approval-intents'&&request.method==='GET')
    return listing(env,owner);
  if(path==='/v1/approval-intents'&&request.method==='POST')
    return create(request,env,owner);
  const match=/^\/v1\/approval-intents\/([0-9a-f-]{36})\/decision$/i.exec(path);
  if(match&&request.method==='POST'&&UUID.test(match[1]))
    return decide(request,env,owner,match[1].toLowerCase());
  return json({error:'not_found'},404);
}
