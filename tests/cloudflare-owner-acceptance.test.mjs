import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectOwnerAccount,offlineOwnerStatus} from '../scripts/cloudflare-owner-acceptance.mjs';

const accountId='a'.repeat(32);
const inventoryToken='only-read-inventory-synthetic-token';
const billingToken='only-read-billing-synthetic-token';
const uuid='123e4567-e89b-42d3-a456-426614174000';
const ok=(result,other={})=>new Response(JSON.stringify({success:true,result,...other}),{status:200});
const getFixture=(url)=>{
  const u=new URL(url),p=u.pathname;
  if(p.includes('/d1/database?') || (p.endsWith('/d1/database')&&u.search))
    return ok([{name:'naraya-pocket-agent',uuid,private:'D1-SECRET'}],
      {result_info:{page:1,per_page:100,count:1,total_count:1}});
  if(p.endsWith('/d1/database/'+uuid))
    return ok({name:'naraya-pocket-agent',uuid,file_size:4096,secret:'NEVER_SHOW'});
  if(p.endsWith('/workers/scripts'))return ok([{id:'naraya-pocket-agent',secret:'NEVER_SHOW'}]);
  if(p.endsWith('/schedules'))return ok({schedules:[]});
  if(p.endsWith('/subscriptions'))return ok([]);
  if(p.endsWith('/billing/history'))return ok([],
    {result_info:{page:1,per_page:20,count:0,total_count:0}});
  throw Error('unexpected_endpoint');
};
const assertBlocked=(report)=>{
  assert.equal(report.remote_acceptance,'BLOCKED');
  assert.equal(report.safe_to_deploy,false);
  assert.equal(report.safe_to_activate_scheduler,false);
  assert.equal(report.current_free_tier_proven,false);
  assert.equal(report.future_zero_extra_cost_proven,false);
  assert.equal(report.workers_cpu_usage,'NOT_MEASURED');
  assert.equal(report.d1_billed_rows,'NOT_MEASURED');
  assert.equal(report.physical_android_off,'NOT_VERIFIED');
  assert.equal(report.google_login_real_device,'NOT_VERIFIED');
  assert.equal(report.owner_dashboard_review,'NOT_VERIFIED');
};

test('P1-Y offline status has no network, token, plan or release claims',()=>{
  const report=offlineOwnerStatus();
  assert.equal(report.inspection_mode,'OFFLINE_DEFAULT_NO_NETWORK');
  assert.equal(report.inventory.d1_inventory,'NOT_INSPECTED');
  assert.equal(report.billing.billing_history,'NOT_INSPECTED');
  assertBlocked(report);
});

test('P1-Y one pass uses exact existing GET inspectors and separate credentials, reports sanitized scoped metadata only',async()=>{
  const calls=[];
  const report=await inspectOwnerAccount({accountId,inventoryToken,billingToken,
    fetchImpl:async(url,opts)=>{calls.push([url,opts]);return getFixture(url);}});
  assert.equal(calls.length,6);
  for(const [url,opts] of calls){
    assert.equal(new URL(url).origin,'https://api.cloudflare.com');
    assert.equal(opts.method,'GET');
    assert.equal(opts.redirect,'error');
    const expected=url.includes('/subscriptions')||url.includes('/billing/history')?billingToken:inventoryToken;
    assert.equal(opts.headers.Authorization,'Bearer '+expected);
  }
  assert.equal(report.metadata_reads_complete,true);
  assert.equal(report.inventory.complete,true);
  assert.equal(report.inventory.target_d1_present,true);
  assert.equal(report.inventory.target_cron_schedules,0);
  assert.equal(report.billing.complete,true);
  assert.equal(report.billing.paid_subscription_signal,'NONE_RETURNED_NOT_FREE_PROOF');
  const serialized=JSON.stringify(report);
  for(const secret of [accountId,inventoryToken,billingToken,uuid,'NEVER_SHOW','D1-SECRET']){
    assert.ok(!serialized.includes(secret),secret);
  }
  assertBlocked(report);
});

test('P1-Y payment warning survives absent inventory and cannot become deployment approval',async()=>{
  const report=await inspectOwnerAccount({accountId,inventoryToken,billingToken,
    fetchImpl:async url=>{
      if(url.includes('/subscriptions'))return ok([{price:0,state:'AwaitingPayment',secret:'HIDDEN_BILLING'}]);
      if(url.includes('/billing/history'))return ok([{amount:18,secret:'INVOICE_ID'}],
        {result_info:{page:1,per_page:20,count:1,total_count:1}});
      return new Response('PRIVATE_PROVIDER_ERROR',{status:403});
    }});
  assert.equal(report.inventory.complete,false);
  assert.equal(report.metadata_reads_complete,false);
  assert.equal(report.billing.complete,true);
  assert.equal(report.billing.paid_subscription_signal,'POTENTIAL_PAID_SUBSCRIPTION_PRESENT');
  assert.equal(report.billing.historical_positive_amount_seen,'YES_HISTORICAL_ONLY');
  assert.ok(!JSON.stringify(report).includes('HIDDEN_BILLING'));
  assert.ok(!JSON.stringify(report).includes('INVOICE_ID'));
  assert.ok(!JSON.stringify(report).includes('PRIVATE_PROVIDER_ERROR'));
  assertBlocked(report);
});

test('P1-Y refuses reused, missing, malformed or ambiguous account credentials before all network access',async()=>{
  let requests=0;
  const fake=async()=>{requests++;return ok([]);};
  for(const c of [
    {accountId,inventoryToken,billingToken:inventoryToken},
    {accountId,inventoryToken,billingToken:''},
    {accountId:'../../oops',inventoryToken,billingToken},
    {accountId,inventoryToken:'contains space',billingToken},
    {accountId,inventoryToken,billingToken,timeoutMs:99},
  ]){
    await assert.rejects(inspectOwnerAccount({...c,fetchImpl:fake}),
      /owner_inspection_not_configured/);
  }
  assert.equal(requests,0);
});

test('P1-Y provider exception reports UNKNOWN and never echoes token, URL, account or provider text',async()=>{
  const report=await inspectOwnerAccount({accountId,inventoryToken,billingToken,
    fetchImpl:async()=>{throw Error('SECRET '+inventoryToken+accountId);}});
  assert.equal(report.inventory.complete,false);
  assert.equal(report.billing.complete,false);
  assert.equal(report.metadata_reads_complete,false);
  const serialized=JSON.stringify(report);
  assert.ok(!serialized.includes(inventoryToken));
  assert.ok(!serialized.includes(billingToken));
  assert.ok(!serialized.includes(accountId));
  assertBlocked(report);
});

test('P1-Y unrecognized provider metadata is not returned as arbitrary free-text in consolidated report',async()=>{
  const report=await inspectOwnerAccount({accountId,inventoryToken,billingToken,
    fetchImpl:async(url)=>{
      const response=getFixture(url);
      if(url.endsWith('/subscriptions'))return ok([]);
      return response;
    }});
  assert.equal(report.metadata_reads_complete,true);
  assert.deepEqual(Object.keys(report).sort(),[
    'schema_version','inspection_mode','remote_acceptance','safe_to_deploy',
    'safe_to_activate_scheduler','current_free_tier_proven',
    'future_zero_extra_cost_proven','workers_cpu_usage','d1_billed_rows',
    'google_login_real_device','physical_android_off','next_gate',
    'inventory','billing','metadata_reads_complete','owner_dashboard_review',
  ].sort());
  assertBlocked(report);
});
