import {boundedJson,InputError,json} from './domain.ts';
import {verifyOidcBearer} from './oidc.ts';
import {ownerFromVerifiedIdentity} from './mobile-sync.ts';
import type {Env} from './types.ts';

/** P2-B: signed-in SYNTHETIC-only form. No PII fields, inference or external writes. */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SERVICES=new Set(['EXHIBITION','INTERIOR','SIGNAGE']);
const BUDGETS=new Set(['UNKNOWN','LOW','MID','HIGH']);
type Service='EXHIBITION'|'INTERIOR'|'SIGNAGE';
type Budget='UNKNOWN'|'LOW'|'MID'|'HIGH';
type Priority='TIME_SENSITIVE'|'NEEDS_BUDGET'|'STANDARD_REVIEW';
interface LeadRow{
  id:string;owner_id:string;client_lead_id:string;source:string;service_code:Service;
  budget_band:Budget;days_to_deadline:number;priority:Priority;reply_draft:string;
  input_digest:string;created_at:number;
}
const templates:Readonly<Record<Service,string>>={
  EXHIBITION:'Terima kasih. Untuk estimasi booth pameran, mohon siapkan ukuran area, lokasi acara, tanggal pemasangan, dan kebutuhan desain.',
  INTERIOR:'Terima kasih. Untuk estimasi proyek interior, mohon siapkan luas area, lokasi proyek, kebutuhan ruangan, dan target penyelesaian.',
  SIGNAGE:'Terima kasih. Untuk estimasi signage, mohon siapkan ukuran, bahan yang diinginkan, lokasi pemasangan, dan jadwal kebutuhan.',
};
function typed(value:unknown){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new InputError('invalid_synthetic_lead');
  const v=value as Record<string,unknown>;
  if(Object.keys(v).sort().join(',')!=='budgetBand,clientLeadId,daysToDeadline,serviceCode,source'||
     v.source!=='SYNTHETIC_FORM'||
     typeof v.clientLeadId!=='string'||!UUID.test(v.clientLeadId)||
     typeof v.serviceCode!=='string'||!SERVICES.has(v.serviceCode)||
     typeof v.budgetBand!=='string'||!BUDGETS.has(v.budgetBand)||
     !Number.isSafeInteger(v.daysToDeadline)||Number(v.daysToDeadline)<1||
     Number(v.daysToDeadline)>365) throw new InputError('invalid_synthetic_lead');
  return {clientLeadId:v.clientLeadId.toLowerCase(),
    serviceCode:v.serviceCode as Service,budgetBand:v.budgetBand as Budget,
    daysToDeadline:v.daysToDeadline as number};
}
function classify(budget:Budget,days:number):Priority{
  if(days<=14)return 'TIME_SENSITIVE';
  if(budget==='UNKNOWN')return 'NEEDS_BUDGET';
  return 'STANDARD_REVIEW';
}
async function fingerprint(fields:readonly (string|number)[]):Promise<string>{
  const hash=await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(JSON.stringify(fields)));
  return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
function view(row:LeadRow){
  return {id:row.id,clientLeadId:row.client_lead_id,source:'SYNTHETIC_FORM',
    serviceCode:row.service_code,budgetBand:row.budget_band,
    daysToDeadline:row.days_to_deadline,priority:row.priority,
    replyDraft:row.reply_draft,inputDigest:row.input_digest,
    classification:'DETERMINISTIC_RULES_NOT_AI',sendStatus:'DRAFT_ONLY',
    createdAt:row.created_at};
}
async function create(request:Request,env:Env,owner:string){
  const fields=typed(await boundedJson(request));
  const digest=await fingerprint(['p2b-v1','SYNTHETIC_FORM',fields.clientLeadId,
    fields.serviceCode,fields.budgetBand,fields.daysToDeadline]);
  const priority=classify(fields.budgetBand,fields.daysToDeadline);
  const draft=templates[fields.serviceCode];
  const created=await env.DB.prepare(`INSERT OR IGNORE INTO synthetic_leads(
    id,owner_id,client_lead_id,source,service_code,budget_band,days_to_deadline,
    priority,reply_draft,input_digest,created_at
  ) SELECT ?,?,?,'SYNTHETIC_FORM',?,?,?,?,?,?,?
    WHERE (SELECT COUNT(*) FROM synthetic_leads WHERE owner_id=?)<100`)
    .bind(crypto.randomUUID(),owner,fields.clientLeadId,
      fields.serviceCode,fields.budgetBand,fields.daysToDeadline,
      priority,draft,digest,Date.now(),owner).run();
  const changes=created.meta?.changes;
  if(changes!==0&&changes!==1)throw new Error('synthetic_lead_metadata_unavailable');
  const existing=await env.DB.prepare(`SELECT * FROM synthetic_leads
     WHERE owner_id=? AND client_lead_id=?`)
    .bind(owner,fields.clientLeadId).first<LeadRow>();
  if(!existing)return json({error:'synthetic_lead_pilot_limit'},429);
  if(existing.input_digest!==digest)return json({error:'synthetic_lead_payload_conflict'},409);
  return json({lead:view(existing),created:changes===1},changes===1?201:200);
}
async function listing(env:Env,owner:string){
  const result=await env.DB.prepare(`SELECT * FROM synthetic_leads
    WHERE owner_id=? ORDER BY created_at DESC,id DESC LIMIT 10`)
    .bind(owner).all<LeadRow>();
  return json({leads:result.results.map(view)});
}
export async function syntheticLeadRoute(request:Request,env:Env,path:string):Promise<Response>{
  const {issuer,subject}=await verifyOidcBearer(request,env);
  const owner=await ownerFromVerifiedIdentity(issuer,subject,env);
  if(!owner)return json({error:'identity_not_registered'},409);
  if(path==='/v1/synthetic-leads'&&request.method==='GET')return listing(env,owner);
  if(path==='/v1/synthetic-leads'&&request.method==='POST')return create(request,env,owner);
  return json({error:'not_found'},404);
}
