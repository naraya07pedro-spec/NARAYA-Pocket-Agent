#!/usr/bin/env node
/**
 * P1-Q owner-run Cloudflare inventory inspection.
 *
 * Live mode is EXPLICIT, credentials are environment-only, and the only
 * network method is GET against four allowlisted Cloudflare API v4 endpoint patterns.
 * The output intentionally omits account IDs, D1 UUIDs, tokens and raw API
 * responses. Read-only metadata is NOT a quota, billing, CPU or phone-OFF proof.
 */
import {pathToFileURL} from 'node:url';

const ACCOUNT = /^[0-9a-f]{32}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCRIPT = 'naraya-pocket-agent';
const DB_NAME = 'naraya-pocket-agent';
const API_ORIGIN = 'https://api.cloudflare.com';

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

function inventoryList(body, pageSize=100) {
  if (body?.success !== true || !Array.isArray(body.result)) throw new Error('invalid_api_response');
  const count=body.result.length;
  const pages=body.result_info?.total_pages;
  return {rows:body.result,complete:(pages===undefined ? count<pageSize : pages===1)};
}

function sanitizedFailure(error) {
  if (error instanceof Error && error.message==='invalid_api_response') return 'INVALID_RESPONSE';
  if (error instanceof Error && error.message==='invalid_account_id') return 'INVALID_ACCOUNT_ID';
  return 'UNAVAILABLE'; // never disclose URL, token, API response, or stack
}

export async function inspectReadOnly({
  accountId, token, fetchImpl=fetch, timeoutMs=7000,
}={}) {
  if (!ACCOUNT.test(accountId??'')) throw new Error('invalid_account_id');
  if (typeof token!=='string' || token.length<12 || /\s/.test(token)) throw new Error('invalid_token');
  if (typeof fetchImpl!=='function') throw new Error('invalid_fetch');
  const prefix='/client/v4/accounts/'+accountId;
  const paths={
    d1:prefix+'/d1/database?per_page=100&page=1',
    workers:prefix+'/workers/scripts',
    schedules:prefix+'/workers/scripts/'+SCRIPT+'/schedules',
  };
  async function get(path) {
    // No user-derived URL, no redirects, no POST, no arbitrary path.
    if (!Object.values(paths).includes(path) &&
      !(path.startsWith(prefix+'/d1/database/') && UUID.test(path.slice((prefix+'/d1/database/').length)))) {
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
      if (!response?.ok) throw new Error('api_failure');
      const raw=await response.text();
      if (raw.length>262144) throw new Error('oversized_api_response');
      const body=JSON.parse(raw);
      if (body?.success!==true) throw new Error('api_failure');
      return body;
    } finally {
      clearTimeout(timer);
    }
  }
  const result={
    schema_version:1,
    inspection_mode:'OWNER_AUTHENTICATED_API_GET_ONLY',
    ...BASELINE,
    d1_inventory:'UNAVAILABLE',
    worker_inventory:'UNAVAILABLE',
    target_d1_present:'UNKNOWN',
    target_worker_present:'UNKNOWN',
    target_cron_schedules:'UNKNOWN',
    target_d1_size_bytes:'UNKNOWN',
    inventory_complete:false,
  };
  let d1Complete=false,workerComplete=false;
  try {
    const databases=inventoryList(await get(paths.d1));
    d1Complete=databases.complete;
    result.d1_inventory=databases.complete?'COMPLETE_FIRST_PAGE':'PARTIAL_FIRST_PAGE';
    result.target_d1_present=databases.rows.some(row=>row?.name===DB_NAME);
    const target=databases.rows.find(row=>row?.name===DB_NAME);
    if(target && typeof target.uuid==='string' && UUID.test(target.uuid)) {
      try {
        const db=await get(prefix+'/d1/database/'+target.uuid);
        const size=db.result?.file_size;
        if(Number.isSafeInteger(size) && size>=0) result.target_d1_size_bytes=size;
      } catch { /* An unavailable read must never become zero usage. */ }
    }
  } catch(error) {
    result.d1_inventory=sanitizedFailure(error);
  }
  try {
    const workers=inventoryList(await get(paths.workers),20);
    workerComplete=workers.complete;
    result.worker_inventory=workers.complete?'COMPLETE_FIRST_PAGE':'PARTIAL_FIRST_PAGE';
    result.target_worker_present=workers.rows.some(row=>row?.id===SCRIPT);
    if(result.target_worker_present) {
      try {
        const body=await get(paths.schedules);
        if(!Array.isArray(body.result?.schedules)) throw new Error('invalid_api_response');
        result.target_cron_schedules=body.result.schedules.length;
      } catch(error) {
        result.target_cron_schedules=sanitizedFailure(error);
      }
    } else if(workerComplete) {
      result.target_cron_schedules='SCRIPT_NOT_PRESENT';
    }
  } catch(error) {
    result.worker_inventory=sanitizedFailure(error);
  }
  result.inventory_complete=d1Complete && workerComplete &&
    (result.target_worker_present!==true || typeof result.target_cron_schedules==='number');
  return result;
}

export function offlineStatus() {
  return {schema_version:1,inspection_mode:'OFFLINE_DEFAULT_NO_NETWORK',...BASELINE,
    inventory_complete:false,account_inventory:'NOT_INSPECTED'};
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  if (process.argv.length!==2 && !(process.argv.length===3 && process.argv[2]==='--inspect-live')) {
    process.stderr.write('Usage: node scripts/cloudflare-readonly-inspect.mjs [--inspect-live]\n');
    process.exitCode=2;
  } else if (process.argv.length===2) {
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
