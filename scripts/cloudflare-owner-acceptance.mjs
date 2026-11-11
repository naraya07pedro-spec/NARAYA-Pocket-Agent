#!/usr/bin/env node
/**
 * P1-Y owner-only Cloudflare account evidence snapshot.
 * Offline by default; live mode ONLY calls the existing bounded GET-only
 * P1-R and P1-T inspectors with two separate read-only credentials.
 * A completed inspection is NEVER deployment, billing, OAuth or phone-OFF approval.
 */
import {pathToFileURL} from 'node:url';
import {inspectReadOnly} from './cloudflare-readonly-inspect.mjs';
import {inspectBillingReadOnly} from './cloudflare-billing-readonly.mjs';

const INVENTORY = ['COMPLETE_FIRST_PAGE','COMPLETE_ALL_PAGES','PARTIAL_PAGES','UNAVAILABLE','INVALID_RESPONSE'];
const WORKERS = ['COMPLETE_SINGLE_PAGE','PARTIAL_SINGLE_PAGE','UNAVAILABLE','INVALID_RESPONSE'];
const SUBSCRIPTIONS = ['COMPLETE_SINGLE_PAGE','UNAVAILABLE','INVALID_RESPONSE'];
const HISTORY = ['COMPLETE_PAGES','PARTIAL_PAGES','UNAVAILABLE','INVALID_RESPONSE'];
const PAID = ['POTENTIAL_PAID_SUBSCRIPTION_PRESENT','SUBSCRIPTION_FINANCIAL_STATUS_UNKNOWN',
  'NONE_RETURNED_NOT_FREE_PROOF','NO_POSITIVE_PRICE_OR_PAID_STATE_SEEN_NOT_FREE_PROOF'];
const HISTORICAL = ['YES_HISTORICAL_ONLY','NO_IN_HISTORY_NOT_FREE_PROOF',
  'UNKNOWN_IN_INCOMPLETE_HISTORY','UNKNOWN'];
const PRESENT = ['UNKNOWN','AMBIGUOUS'];
const CRON = ['UNKNOWN','SCRIPT_NOT_PRESENT','UNAVAILABLE','INVALID_RESPONSE'];
const valid = (value,options,fallback='UNKNOWN')=> options.includes(value)?value:fallback;
const count = value => Number.isSafeInteger(value) && value>=0 ? value : 'UNKNOWN';
const presence = value => typeof value==='boolean' ? value : valid(value,PRESENT);
const limitedCron = value => typeof value==='number' && Number.isSafeInteger(value) &&
  value>=0 && value<=100 ? value : valid(value,CRON);

const SAFETY=Object.freeze({
  remote_acceptance:'BLOCKED',
  safe_to_deploy:false,
  safe_to_activate_scheduler:false,
  current_free_tier_proven:false,
  future_zero_extra_cost_proven:false,
  workers_cpu_usage:'NOT_MEASURED',
  d1_billed_rows:'NOT_MEASURED',
  google_login_real_device:'NOT_VERIFIED',
  physical_android_off:'NOT_VERIFIED',
  next_gate:'OWNER_DASHBOARD_USAGE_BILLING_REVIEW_AND_SEPARATE_CLOUD_APPROVAL',
});

export function offlineOwnerStatus(){
  return {
    schema_version:1,
    inspection_mode:'OFFLINE_DEFAULT_NO_NETWORK',
    ...SAFETY,
    inventory:{complete:false,d1_inventory:'NOT_INSPECTED',
      worker_inventory:'NOT_INSPECTED',target_d1_present:'UNKNOWN',
      target_worker_present:'UNKNOWN',target_cron_schedules:'UNKNOWN',
      d1_pages_inspected:0,target_d1_size_bytes:'UNKNOWN'},
    billing:{complete:false,subscription_inventory:'NOT_INSPECTED',
      billing_history:'NOT_INSPECTED',paid_subscription_signal:'UNKNOWN',
      historical_positive_amount_seen:'UNKNOWN',billing_records_scanned:0,
      subscription_count:'UNKNOWN'},
    owner_dashboard_review:'NOT_VERIFIED',
  };
}

function safeInventory(raw){
  return {
    complete:raw?.inventory_complete===true,
    d1_inventory:valid(raw?.d1_inventory,INVENTORY),
    worker_inventory:valid(raw?.worker_inventory,WORKERS),
    target_d1_present:presence(raw?.target_d1_present),
    target_worker_present:presence(raw?.target_worker_present),
    target_cron_schedules:limitedCron(raw?.target_cron_schedules),
    d1_pages_inspected:count(raw?.d1_pages_inspected),
    target_d1_size_bytes:count(raw?.target_d1_size_bytes),
  };
}
function safeBilling(raw){
  return {
    complete:raw?.billing_metadata_complete===true,
    subscription_inventory:valid(raw?.subscription_inventory,SUBSCRIPTIONS),
    billing_history:valid(raw?.billing_history,HISTORY),
    paid_subscription_signal:valid(raw?.paid_subscription_signal,PAID),
    historical_positive_amount_seen:valid(raw?.historical_positive_amount_seen,HISTORICAL),
    billing_records_scanned:count(raw?.billing_records_scanned),
    subscription_count:count(raw?.subscription_count),
  };
}

export async function inspectOwnerAccount({
  accountId, inventoryToken, billingToken, fetchImpl=fetch, timeoutMs=7000,
}={}){
  // Independent tokens are mandatory; their scopes still cannot be certified
  // by examining their raw bytes. Never expose any token in output or errors.
  if(!/^[a-f0-9]{32}$/i.test(accountId??'') ||
     typeof inventoryToken!=='string' || inventoryToken.length<12 ||
     typeof billingToken!=='string' || billingToken.length<12 ||
     /\s/.test(inventoryToken) || /\s/.test(billingToken) ||
     inventoryToken===billingToken ||
     typeof fetchImpl!=='function' ||
     !Number.isSafeInteger(timeoutMs) || timeoutMs<100 || timeoutMs>30_000) {
    throw new Error('owner_inspection_not_configured');
  }
  const [i,b]=await Promise.allSettled([
    inspectReadOnly({accountId,token:inventoryToken,fetchImpl,timeoutMs}),
    inspectBillingReadOnly({accountId,token:billingToken,fetchImpl,timeoutMs}),
  ]);
  const inventory=safeInventory(i.status==='fulfilled'?i.value:null);
  const billing=safeBilling(b.status==='fulfilled'?b.value:null);
  return {
    schema_version:1,
    inspection_mode:'OWNER_AUTHENTICATED_ALLOWLISTED_GET_ONLY',
    ...SAFETY,
    inventory,
    billing,
    metadata_reads_complete:inventory.complete && billing.complete,
    owner_dashboard_review:'NOT_VERIFIED',
  };
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.length===2){
    process.stdout.write(JSON.stringify(offlineOwnerStatus(),null,2)+'\n');
  }else if(process.argv.length===3 && process.argv[2]==='--inspect-live'){
    try{
      // Requiring both variables guards accidental cross-account billing reads.
      const id=process.env.CF_READONLY_ACCOUNT_ID;
      if(!id || id!==process.env.CF_BILLING_ACCOUNT_ID)throw new Error('different_accounts');
      const report=await inspectOwnerAccount({
        accountId:id,
        inventoryToken:process.env.CF_READONLY_API_TOKEN,
        billingToken:process.env.CF_BILLING_READ_TOKEN,
      });
      process.stdout.write(JSON.stringify(report,null,2)+'\n');
      process.exitCode=report.metadata_reads_complete?0:2;
    }catch{
      process.stderr.write('Owner GET-only inspection BLOCKED. Check private account ID and separate read-only credentials; do not publish secrets.\n');
      process.exitCode=2;
    }
  }else{
    process.stderr.write('Usage: node scripts/cloudflare-owner-acceptance.mjs [--inspect-live]\n');
    process.exitCode=2;
  }
}
