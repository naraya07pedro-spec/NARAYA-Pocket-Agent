import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectReadOnly,offlineStatus} from '../scripts/cloudflare-readonly-inspect.mjs';

const accountId='a'.repeat(32);
const token='test-only-not-a-real-credential-abcdef';
const uuid='123e4567-e89b-42d3-a456-426614174000';
const json=(result,extras={})=>new Response(JSON.stringify({success:true,result,...extras}),{status:200});
const fixture=(path)=>{
  if(path.includes('/d1/database/'+uuid))return json({file_size:4096});
  if(path.includes('/d1/database?'))return json([{name:'naraya-pocket-agent',uuid}]);
  if(path.endsWith('/workers/scripts'))return json([{id:'naraya-pocket-agent'}]);
  if(path.endsWith('/schedules'))return json({schedules:[]});
  throw Error('unexpected endpoint');
};

test('offline default refuses to imply account, deployment or phone-OFF proof',()=>{
  const report=offlineStatus();
  assert.equal(report.inspection_mode,'OFFLINE_DEFAULT_NO_NETWORK');
  assert.equal(report.account_inventory,'NOT_INSPECTED');
  assert.equal(report.remote_acceptance,'BLOCKED');
  assert.equal(report.safe_to_deploy,false);
  assert.equal(report.safe_to_activate_scheduler,false);
});

test('read-only inspection visits only allowlisted GET Cloudflare v4 paths and redacts identities',async()=>{
  const seen=[];
  const report=await inspectReadOnly({accountId,token,fetchImpl:async(url,opts)=>{
    seen.push({url,opts});
    return fixture(new URL(url).pathname+new URL(url).search);
  }});
  assert.equal(seen.length,4);
  for(const request of seen){
    assert.equal(request.opts.method,'GET');
    assert.equal(request.opts.redirect,'error');
    assert.equal(request.opts.headers.Authorization,'Bearer '+token);
    assert.equal(new URL(request.url).host,'api.cloudflare.com');
  }
  assert.equal(report.inventory_complete,true);
  assert.equal(report.target_d1_present,true);
  assert.equal(report.target_d1_size_bytes,4096);
  assert.equal(report.target_worker_present,true);
  assert.equal(report.target_cron_schedules,0);
  assert.equal(report.account_plan,'NOT_VERIFIED');
  assert.equal(report.account_billing,'NOT_VERIFIED');
  assert.equal(report.free_tier_daily_usage,'NOT_VERIFIED');
  assert.equal(report.remote_acceptance,'BLOCKED');
  assert.equal(report.safe_to_deploy,false);
  const serialized=JSON.stringify(report);
  assert.equal(serialized.includes(accountId),false);
  assert.equal(serialized.includes(token),false);
  assert.equal(serialized.includes(uuid),false);
});

test('permission failures are neutralized and fail closed, with no response-body leakage',async()=>{
  const report=await inspectReadOnly({accountId,token,fetchImpl:async()=>
    new Response('{"success":false,"errors":[{"message":"SECRET"}]}',{status:403})
  });
  assert.equal(report.d1_inventory,'UNAVAILABLE');
  assert.equal(report.worker_inventory,'UNAVAILABLE');
  assert.equal(report.inventory_complete,false);
  assert.equal(report.remote_acceptance,'BLOCKED');
  assert.equal(JSON.stringify(report).includes('SECRET'),false);
});

test('invalid account identifier and token cannot initiate network access',async()=>{
  let calls=0;
  const fetchImpl=async()=>{calls++;return json([]);};
  await assert.rejects(inspectReadOnly({accountId:'../../path',token,fetchImpl}),/invalid_account_id/);
  await assert.rejects(inspectReadOnly({accountId,token:'bad token',fetchImpl}),/invalid_token/);
  assert.equal(calls,0);
});

test('bad Cloudflare JSON envelope is never certified as zero resources',async()=>{
  const report=await inspectReadOnly({accountId,token,fetchImpl:async()=>
    new Response(JSON.stringify({success:true,result:{unexpected:1}}),{status:200})
  });
  assert.equal(report.d1_inventory,'INVALID_RESPONSE');
  assert.equal(report.worker_inventory,'INVALID_RESPONSE');
  assert.equal(report.target_d1_present,'UNKNOWN');
  assert.equal(report.inventory_complete,false);
});

test('full first page without pagination metadata remains incomplete',async()=>{
  const report=await inspectReadOnly({accountId,token,fetchImpl:async(url)=>{
    const path=new URL(url).pathname;
    if(path.endsWith('/workers/scripts')) return json(Array.from({length:100},(_,i)=>({id:'worker-'+i})));
    return json([]);
  }});
  assert.equal(report.worker_inventory,'PARTIAL_FIRST_PAGE');
  assert.equal(report.target_worker_present,false);
  assert.equal(report.target_cron_schedules,'UNKNOWN');
  assert.equal(report.inventory_complete,false);
});

test('provider list with target database and invalid UUID cannot be used for arbitrary follow-up GET',async()=>{
  const seen=[];
  const report=await inspectReadOnly({accountId,token,fetchImpl:async(url)=>{
    seen.push(url);
    if(url.includes('/d1/database?'))return json([{name:'naraya-pocket-agent',uuid:'../../a-secret'}]);
    return json([]);
  }});
  assert.equal(seen.length,2);
  assert.equal(report.target_d1_present,true);
  assert.equal(report.target_d1_size_bytes,'UNKNOWN');
  assert.equal(report.remote_acceptance,'BLOCKED');
});
