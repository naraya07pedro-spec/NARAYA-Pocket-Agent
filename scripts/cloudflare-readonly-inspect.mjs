#!/usr/bin/env node
/**
 * P1-R Cloudflare owner-run inventory inspection.
 * No network by default. Explicit live mode may perform bounded GET requests
 * against fixed Cloudflare API v4 endpoints only. No account secrets or IDs
 * are emitted; a successful inventory is never a release authorization.
 */
import {pathToFileURL} from 'node:url';

const ACCOUNT = /^[0-9a-f]{32}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCRIPT = 'naraya-pocket-agent';
const DB_NAME = 'naraya-pocket-agent';
const API_ORIGIN = 'https://api.cloudflare.com';
const D1_PAGE_SIZE = 100;
const MAX_D1_PAGES = 10;
const MAX_RESPONSE_BYTES = 262_144;

export const BASELINE = Object.freeze({
  remote_acceptance:'BLOCKED',
  safe_to_deploy:false,
  safe_to_activate_scheduler:false,
  account_plan:'NOT_VERIFIED',
  account_billing:'NOT_VERIFIED',
  free_tier_daily_usage:'NOT_VERIFIED',
  cron_cpu_ms:'NOT_MEASURED',
  physical_android_off:'NOT_VERIFIED',
  google_oauth_real_device:'NOT_VERIFIED',
});

function sanitizedFailure(error) {
  if (error instanceof Error && error.message==='invalid_api_response') return 'INVALID_RESPONSE';
  return 'UNAVAILABLE'; // never expose provider URLs, response bodies or auth details
}

function positiveInteger(n) {
  return Number.isSafeInteger(n) && n>=0;
}

function validateD1Page(body, expectedPage, previousTotal) {
  if(body?.success!==true || !Array.isArray(body.result) ||
     !body.result_info || typeof body.result_info!=='object' ||
     !positiveInteger(body.result_info.total_count) ||
     !Number.isSafeInteger(body.result_info.page) ||
     body.result_info.page!==expectedPage ||
     body.result_info.per_page!==D1_PAGE_SIZE ||
     body.result.length>D1_PAGE_SIZE ||
     (body.result_info.count!==undefined && body.result_info.count!==body.result.length) ||
     (previousTotal!==null && previousTotal!==body.result_info.total_count)) {
    throw new Error('invalid_api_response');
  }
  // An incorrect or truncated page must not certify that an unseen DB is absent.
  if(body.result.some(row=>!row || typeof row!=='object' || Array.isArray(row) ||
      (row.uuid!==undefined && (typeof row.uuid!=='string' || !UUID.test(row.uuid))))) {
    throw new Error('invalid_api_response');
  }
  return {rows:body.result,total:body.result_info.total_count};
}

function validateSinglePageWorkers(body) {
  if(body?.success!==true || !Array.isArray(body.result) ||
     body.result.some(row=>!row || typeof row!=='object' || Array.isArray(row))) {
    throw new Error('invalid_api_response');
  }
  // Workers Scripts List is documented as a SinglePage response, not D1-style
  // paginated data. If a future version adds pagination, refuse a false complete.
  const total=body.result_info?.total_count;
  if(total!==undefined && (!positiveInteger(total) || total!==body.result.length)) {
    return {rows:body.result,complete:false};
  }
  return {rows:body.result,complete:true};
}

async function readBoundedJson(response) {
  if(!response?.ok || !response.body || typeof response.body.getReader!=='function') {
    throw new Error('api_failure');
  }
  const reader=response.body.getReader();
  const decoder=new TextDecoder('utf-8',{fatal:true});
  let bytes=0,text='';
  try {
    for(;;) {
      const {done,value}=await reader.read();
      if(done) break;
      if(!(value instanceof Uint8Array)) throw new Error('invalid_api_response');
      bytes+=value.byteLength;
      if(bytes>MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(()=>{});
        throw new Error('oversized_api_response');
      }
      text+=decoder.decode(value,{stream:true});
    }
    text+=decoder.decode();
  } finally {
    reader.releaseLock();
  }
  let body;
  try { body=JSON.parse(text); } catch { throw new Error('invalid_api_response'); }
  if(body?.success!==true) throw new Error('api_failure');
  return body;
}

export async function inspectReadOnly({
  accountId,token,fetchImpl=fetch,timeoutMs=7000,
}={}) {
  if(!ACCOUNT.test(accountId??'')) throw new Error('invalid_account_id');
  if(typeof token!=='string' || token.length<12 || /\s/.test(token)) throw new Error('invalid_token');
  if(typeof fetchImpl!=='function') throw new Error('invalid_fetch');
  if(!Number.isSafeInteger(timeoutMs) || timeoutMs<100 || timeoutMs>30000) throw new Error('invalid_timeout');
  const prefix='/client/v4/accounts/'+accountId;
  const d1List=page=>prefix+'/d1/database?per_page='+D1_PAGE_SIZE+'&page='+page;
  const paths={
    workers:prefix+'/workers/scripts',
    schedules:prefix+'/workers/scripts/'+SCRIPT+'/schedules',
  };
  const allowedD1Pages=new Set(Array.from({length:MAX_D1_PAGES},(_,i)=>d1List(i+1)));
  async function get(path) {
    // Never take an arbitrary URL or method, even from untrusted API metadata.
    const detailRoot=prefix+'/d1/database/';
    if(!allowedD1Pages.has(path) && !Object.values(paths).includes(path) &&
       !(path.startsWith(detailRoot) && UUID.test(path.slice(detailRoot.length)))) {
      throw new Error('unapproved_endpoint');
    }
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try {
      const response=await fetchImpl(API_ORIGIN+path,{
        method:'GET',
        headers:{Authorization:'Bearer '+token,Accept:'application/json'},
        redirect:'error',
        signal:controller.signal,
      });
      return await readBoundedJson(response);
    } finally {
      clearTimeout(timer);
    }
  }
  const result={
    schema_version:2,
    inspection_mode:'OWNER_AUTHENTICATED_API_GET_ONLY',
    ...BASELINE,
    d1_inventory:'UNAVAILABLE',
    worker_inventory:'UNAVAILABLE',
    target_d1_present:'UNKNOWN',
    target_worker_present:'UNKNOWN',
    target_cron_schedules:'UNKNOWN',
    target_d1_size_bytes:'UNKNOWN',
    d1_pages_inspected:0,
    inventory_complete:false,
  };
  let d1Complete=false,workerComplete=false;
  try {
    const rows=[];
    const ids=new Set();
    let total=null;
    for(let page=1;page<=MAX_D1_PAGES;page++) {
      const response=validateD1Page(await get(d1List(page)),page,total);
      result.d1_pages_inspected=page;
      total=response.total;
      for(const row of response.rows) {
        if(row.uuid && ids.has(row.uuid)) throw new Error('invalid_api_response');
        if(row.uuid) ids.add(row.uuid);
        rows.push(row);
      }
      if(rows.length>total) throw new Error('invalid_api_response');
      if(rows.length===total) { d1Complete=true; break; }
      // Guard against a truncated zero-row page or repeated, missing DB rows.
      if(response.rows.length===0) break;
    }
    result.d1_inventory=d1Complete ?
      (result.d1_pages_inspected===1?'COMPLETE_FIRST_PAGE':'COMPLETE_ALL_PAGES') :
      'PARTIAL_PAGES';
    const matches=rows.filter(row=>row.name===DB_NAME);
    result.target_d1_present=matches.length>1 ? 'AMBIGUOUS' :
      matches.length===1 ? true : d1Complete ? false : 'UNKNOWN';
    if(result.target_d1_present==='AMBIGUOUS') d1Complete=false;
    if(matches.length===1 && typeof matches[0].uuid==='string' && UUID.test(matches[0].uuid)) {
      try {
        const detail=await get(prefix+'/d1/database/'+matches[0].uuid);
        // Refuse to attribute size to the wrong database or a contradictory identity.
        if(detail.result?.uuid===matches[0].uuid && detail.result?.name===DB_NAME &&
           positiveInteger(detail.result?.file_size)) {
          result.target_d1_size_bytes=detail.result.file_size;
        }
      } catch { /* do not invent zero bytes on permission failures */ }
    }
  } catch(error) {
    result.d1_inventory=sanitizedFailure(error);
    result.target_d1_present='UNKNOWN';
    d1Complete=false;
  }
  try {
    const workers=validateSinglePageWorkers(await get(paths.workers));
    workerComplete=workers.complete;
    result.worker_inventory=workerComplete?'COMPLETE_SINGLE_PAGE':'PARTIAL_SINGLE_PAGE';
    const matches=workers.rows.filter(row=>row.id===SCRIPT);
    result.target_worker_present=matches.length>1?'AMBIGUOUS':matches.length===1?true:
      workerComplete?false:'UNKNOWN';
    if(result.target_worker_present==='AMBIGUOUS')workerComplete=false;
    if(result.target_worker_present===true) {
      try {
        const body=await get(paths.schedules);
        if(!Array.isArray(body.result?.schedules) ||
           body.result.schedules.some(s=>typeof s?.cron!=='string')) {
          throw new Error('invalid_api_response');
        }
        result.target_cron_schedules=body.result.schedules.length;
      } catch(error) {
        result.target_cron_schedules=sanitizedFailure(error);
      }
    } else if(result.target_worker_present===false) {
      result.target_cron_schedules='SCRIPT_NOT_PRESENT';
    }
  } catch(error) {
    result.worker_inventory=sanitizedFailure(error);
    result.target_worker_present='UNKNOWN';
    workerComplete=false;
  }
  result.inventory_complete=d1Complete && workerComplete &&
    (result.target_worker_present!==true || typeof result.target_cron_schedules==='number');
  return result;
}

export function offlineStatus() {
  return {schema_version:2,inspection_mode:'OFFLINE_DEFAULT_NO_NETWORK',...BASELINE,
    inventory_complete:false,account_inventory:'NOT_INSPECTED'};
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  if(process.argv.length!==2 && !(process.argv.length===3 && process.argv[2]==='--inspect-live')) {
    process.stderr.write('Usage: node scripts/cloudflare-readonly-inspect.mjs [--inspect-live]\n');
    process.exitCode=2;
  } else if(process.argv.length===2) {
    process.stdout.write(JSON.stringify(offlineStatus(),null,2)+'\n');
  } else {
    try {
      const report=await inspectReadOnly({
        accountId:process.env.CF_READONLY_ACCOUNT_ID,
        token:process.env.CF_READONLY_API_TOKEN,
      });
      process.stdout.write(JSON.stringify(report,null,2)+'\n');
      process.exitCode=report.inventory_complete?0:2;
    } catch {
      process.stderr.write('Read-only inspection BLOCKED: missing/invalid credentials or safe GET failure. No details logged.\n');
      process.exitCode=2;
    }
  }
}
