#!/usr/bin/env node
/**
 * P1-S owner-only Cloudflare billing/subscription metadata inspector.
 *
 * Offline by default. Explicit --inspect-live uses a DIFFERENT least-privilege
 * Billing Read token, makes ONLY allowlisted HTTPS GETs, and emits redacted,
 * deliberately inconclusive metadata. Subscription/history is NOT a Free plan,
 * invoice-settlement, future usage-charge, CPU, D1, or deployment proof.
 */
import {pathToFileURL} from 'node:url';
import {BASELINE} from './cloudflare-readonly-inspect.mjs';

const ACCOUNT=/^[a-f0-9]{32}$/i;
const ORIGIN='https://api.cloudflare.com';
const HISTORY_PAGE_SIZE=20;
const MAX_HISTORY_PAGES=5;
const MAX_BYTES=131_072;
const SCHEMA_VERSION=1;

function safeInt(n){return Number.isSafeInteger(n)&&n>=0;}
function failCode(error){return error instanceof Error && error.message==='invalid_api_response'?'INVALID_RESPONSE':'UNAVAILABLE';}

async function readResponse(response){
  if(!response?.ok||!response.body||typeof response.body.getReader!=='function')throw Error('api_failure');
  const reader=response.body.getReader();
  const decoder=new TextDecoder('utf-8',{fatal:true});
  let received=0,contents='';
  try{
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      if(!(value instanceof Uint8Array))throw Error('invalid_api_response');
      received+=value.byteLength;
      if(received>MAX_BYTES){
        await reader.cancel().catch(()=>{});
        throw Error('oversized_api_response');
      }
      contents+=decoder.decode(value,{stream:true});
    }
    contents+=decoder.decode();
  }finally{reader.releaseLock();}
  let data;
  try{data=JSON.parse(contents)}catch{throw Error('invalid_api_response')}
  if(data?.success!==true)throw Error('api_failure');
  return data;
}

function validateSubscriptions(data){
  if(!Array.isArray(data?.result)||data.result.length>250||
    data.result.some(s=>!s||typeof s!=='object'||Array.isArray(s)))throw Error('invalid_api_response');
  const total=data.result_info?.total_count;
  if(total!==undefined&&(!safeInt(total)||total!==data.result.length))throw Error('invalid_api_response');
  return data.result;
}
function subscriptionSignal(records){
  if(records.some(row=>row.state==='Paid'||(typeof row.price==='number'&&Number.isFinite(row.price)&&row.price>0))){
    return 'POTENTIAL_PAID_SUBSCRIPTION_PRESENT';
  }
  if(records.length===0)return 'NONE_RETURNED_NOT_FREE_PROOF';
  return 'NO_POSITIVE_PRICE_OR_PAID_STATE_SEEN_NOT_FREE_PROOF';
}
function validateHistoryPage(data,page,total){
  const info=data?.result_info;
  if(!Array.isArray(data?.result)||!info||typeof info!=='object'||
    !safeInt(info.total_count)||info.page!==page||info.per_page!==HISTORY_PAGE_SIZE||
    (info.count!==undefined&&info.count!==data.result.length)||
    data.result.length>HISTORY_PAGE_SIZE||
    (total!==null&&total!==info.total_count)||
    data.result.some(row=>!row||typeof row!=='object'||Array.isArray(row))){
    throw Error('invalid_api_response');
  }
  return {records:data.result,total:info.total_count};
}

export function billingOfflineStatus(){
  return {schema_version:SCHEMA_VERSION,inspection_mode:'OFFLINE_DEFAULT_NO_NETWORK',
    ...BASELINE,subscription_inventory:'NOT_INSPECTED',billing_history:'NOT_INSPECTED',
    paid_subscription_signal:'UNKNOWN',historical_positive_amount_seen:'UNKNOWN',
    billing_records_scanned:0,subscription_count:'UNKNOWN',
    billing_metadata_complete:false,
    current_free_tier_proven:false,future_zero_extra_cost_proven:false};
}

export async function inspectBillingReadOnly({accountId,token,fetchImpl=fetch,timeoutMs=7000}={}){
  if(!ACCOUNT.test(accountId??''))throw Error('invalid_account_id');
  if(typeof token!=='string'||token.length<12||/\s/.test(token))throw Error('invalid_token');
  if(typeof fetchImpl!=='function')throw Error('invalid_fetch');
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>30_000)throw Error('invalid_timeout');
  const prefix='/client/v4/accounts/'+accountId;
  const subscriptions=prefix+'/subscriptions';
  const history=page=>prefix+'/billing/history?page='+page+'&per_page='+HISTORY_PAGE_SIZE;
  const allow=new Set([subscriptions,...Array.from({length:MAX_HISTORY_PAGES},(_,i)=>history(i+1))]);
  async function get(path){
    if(!allow.has(path))throw Error('unapproved_endpoint');
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try {
      return await readResponse(await fetchImpl(ORIGIN+path,{
        method:'GET',redirect:'error',signal:controller.signal,
        headers:{Authorization:'Bearer '+token,Accept:'application/json'},
      }));
    }finally{clearTimeout(timer)}
  }

  const result={
    ...billingOfflineStatus(),
    inspection_mode:'OWNER_AUTHENTICATED_BILLING_GET_ONLY',
    subscription_inventory:'UNAVAILABLE',
    billing_history:'UNAVAILABLE',
  };
  let subscriptionComplete=false,historyComplete=false;
  try{
    const subscriptionsData=validateSubscriptions(await get(subscriptions));
    result.subscription_inventory='COMPLETE_SINGLE_PAGE';
    result.subscription_count=subscriptionsData.length;
    result.paid_subscription_signal=subscriptionSignal(subscriptionsData);
    subscriptionComplete=true;
  }catch(error){result.subscription_inventory=failCode(error)}
  try{
    let total=null,n=0,positive=false;
    for(let page=1;page<=MAX_HISTORY_PAGES;page++){
      const data=validateHistoryPage(await get(history(page)),page,total);
      total=data.total;
      n+=data.records.length;
      if(n>total)throw Error('invalid_api_response');
      if(data.records.some(row=>
        (typeof row.amount==='number'&&Number.isFinite(row.amount)&&row.amount>0)||
        (typeof row.amount_to_pay==='number'&&Number.isFinite(row.amount_to_pay)&&row.amount_to_pay>0)
      ))positive=true;
      result.billing_records_scanned=n;
      if(n===total){historyComplete=true;break;}
      if(data.records.length===0)break;
    }
    result.billing_history=historyComplete?'COMPLETE_PAGES':'PARTIAL_PAGES';
    result.historical_positive_amount_seen=positive?'YES_HISTORICAL_ONLY':
      historyComplete?'NO_IN_HISTORY_NOT_FREE_PROOF':'UNKNOWN_IN_INCOMPLETE_HISTORY';
  }catch(error){
    result.billing_history=failCode(error);
    result.historical_positive_amount_seen='UNKNOWN';
    result.billing_records_scanned=0;
  }
  result.billing_metadata_complete=subscriptionComplete&&historyComplete;
  return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.length!==2&&!(process.argv.length===3&&process.argv[2]==='--inspect-live')){
    process.stderr.write('Usage: node scripts/cloudflare-billing-readonly.mjs [--inspect-live]\n');
    process.exitCode=2;
  }else if(process.argv.length===2){
    process.stdout.write(JSON.stringify(billingOfflineStatus(),null,2)+'\n');
  }else{
    try{
      const report=await inspectBillingReadOnly({
        accountId:process.env.CF_BILLING_ACCOUNT_ID,
        token:process.env.CF_BILLING_READ_TOKEN,
      });
      process.stdout.write(JSON.stringify(report,null,2)+'\n');
      process.exitCode=report.billing_metadata_complete?0:2;
    }catch{
      process.stderr.write('Billing read-only inspection BLOCKED; no secrets or API body logged.\n');
      process.exitCode=2;
    }
  }
}
