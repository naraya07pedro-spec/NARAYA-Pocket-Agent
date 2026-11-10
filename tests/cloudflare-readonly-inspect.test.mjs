import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectReadOnly,offlineStatus} from '../scripts/cloudflare-readonly-inspect.mjs';

const accountId='a'.repeat(32);
const token='test-only-not-a-real-credential-abcdef';
const uuid='123e4567-e89b-42d3-a456-426614174000';
const otherUuid='123e4567-e89b-42d3-a456-426614174001';
const json=(result,extras={})=>new Response(JSON.stringify({success:true,result,...extras}),{status:200});
const d1Page=(rows,total,page=1,extras={})=>json(rows,{result_info:{
  count:rows.length,page,per_page:100,total_count:total,...extras
}});
const fixture=(path)=>{
  if(path.includes('/d1/database/'+uuid))return json({name:'naraya-pocket-agent',uuid,file_size:4096});
  if(path.includes('/d1/database?'))return d1Page([{name:'naraya-pocket-agent',uuid}],1);
  if(path.endsWith('/workers/scripts'))return json([{id:'naraya-pocket-agent'}]);
  if(path.endsWith('/schedules'))return json({schedules:[]});
  throw Error('unexpected endpoint');
};
const checkNoProof=report=>{
  assert.equal(report.remote_acceptance,'BLOCKED');
  assert.equal(report.safe_to_deploy,false);
  assert.equal(report.safe_to_activate_scheduler,false);
  assert.equal(report.account_plan,'NOT_VERIFIED');
  assert.equal(report.account_billing,'NOT_VERIFIED');
  assert.equal(report.free_tier_daily_usage,'NOT_VERIFIED');
  assert.equal(report.google_oauth_real_device,'NOT_VERIFIED');
};

test('offline default is zero-network and never claims account acceptance',()=>{
  const report=offlineStatus();
  assert.equal(report.inspection_mode,'OFFLINE_DEFAULT_NO_NETWORK');
  assert.equal(report.account_inventory,'NOT_INSPECTED');
  assert.equal(report.inventory_complete,false);
  checkNoProof(report);
});

test('official D1 result_info and Worker/Cron shapes yield only scoped inventory evidence',async()=>{
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
  assert.equal(report.d1_pages_inspected,1);
  assert.equal(report.d1_inventory,'COMPLETE_FIRST_PAGE');
  assert.equal(report.inventory_complete,true);
  assert.equal(report.target_d1_present,true);
  assert.equal(report.target_d1_size_bytes,4096);
  assert.equal(report.target_worker_present,true);
  assert.equal(report.target_cron_schedules,0);
  checkNoProof(report);
  const serialized=JSON.stringify(report);
  assert.equal(serialized.includes(accountId),false);
  assert.equal(serialized.includes(token),false);
  assert.equal(serialized.includes(uuid),false);
});

test('403 errors are sanitized with no response body leakage',async()=>{
  const report=await inspectReadOnly({accountId,token,fetchImpl:async()=>
    new Response('{"success":false,"errors":[{"message":"PRIVATE_SECRET"}]}',{status:403})
  });
  assert.equal(report.d1_inventory,'UNAVAILABLE');
  assert.equal(report.worker_inventory,'UNAVAILABLE');
  assert.equal(report.inventory_complete,false);
  assert.equal(JSON.stringify(report).includes('PRIVATE_SECRET'),false);
  checkNoProof(report);
});

test('invalid account, token and timeout input cannot trigger network',async()=>{
  let calls=0;
  const fetchImpl=async()=>{calls++;return json([]);};
  await assert.rejects(inspectReadOnly({accountId:'../../path',token,fetchImpl}),/invalid_account_id/);
  await assert.rejects(inspectReadOnly({accountId,token:'bad token',fetchImpl}),/invalid_token/);
  await assert.rejects(inspectReadOnly({accountId,token,timeoutMs:60000,fetchImpl}),/invalid_timeout/);
  assert.equal(calls,0);
});

test('bad JSON envelope does not become zero inventory',async()=>{
  const report=await inspectReadOnly({accountId,token,fetchImpl:async()=>
    new Response(JSON.stringify({success:true,result:{unexpected:1}}),{status:200})
  });
  assert.equal(report.d1_inventory,'INVALID_RESPONSE');
  assert.equal(report.worker_inventory,'INVALID_RESPONSE');
  assert.equal(report.target_d1_present,'UNKNOWN');
  assert.equal(report.inventory_complete,false);
});

test('D1 missing result_info is never assumed complete even with one item',async()=>{
  const report=await inspectReadOnly({accountId,token,fetchImpl:async(url)=>{
    if(url.includes('/d1/database?'))return json([{name:'irrelevant',uuid}]);
    return json([]);
  }});
  assert.equal(report.d1_inventory,'INVALID_RESPONSE');
  assert.equal(report.target_d1_present,'UNKNOWN');
  assert.equal(report.inventory_complete,false);
});

test('P1-Q regression: total_count greater than short first page must fetch next page',async()=>{
  const visited=[];
  const report=await inspectReadOnly({accountId,token,fetchImpl:async(url)=>{
    visited.push(url);
    if(url.includes('/d1/database?')) {
      if(url.includes('page=1'))return d1Page([{name:'other-database',uuid:otherUuid}],2,1);
      if(url.includes('page=2'))return d1Page([{name:'naraya-pocket-agent',uuid}],2,2);
      throw Error('wrong page');
    }
    return fixture(new URL(url).pathname+new URL(url).search);
  }});
  assert.equal(report.inventory_complete,true);
  assert.equal(report.target_d1_present,true);
  assert.equal(report.d1_pages_inspected,2);
  assert.equal(report.d1_inventory,'COMPLETE_ALL_PAGES');
  assert.ok(visited.some(s=>s.includes('page=2')));
  assert.equal(report.target_d1_size_bytes,4096);
  checkNoProof(report);
});

test('ten-page bound refuses absent claim if metadata says unseen databases remain',async()=>{
  const seen=[];
  const report=await inspectReadOnly({accountId,token,fetchImpl:async(url)=>{
    seen.push(url);
    if(url.includes('/d1/database?')) {
      const page=Number(new URL(url).searchParams.get('page'));
      const rows=Array.from({length:100},(_,i)=>({
        uuid:'123e4567-e89b-42d3-a456-'+String((page-1)*100+i).padStart(12,'0'),
        name:'other-'+page+'-'+i,
      }));
      return d1Page(rows,1001,page);
    }
    return json([]);
  }});
  assert.equal(report.d1_pages_inspected,10);
  assert.equal(seen.filter(url=>url.includes('/d1/database?')).length,10);
  assert.equal(report.d1_inventory,'PARTIAL_PAGES');
  assert.equal(report.target_d1_present,'UNKNOWN');
  assert.equal(report.inventory_complete,false);
  checkNoProof(report);
});

test('provider contradictory per_page, page number or total_count fail closed',async()=>{
  for(const caseName of ['bad-page','bad-size','bad-total']) {
    const report=await inspectReadOnly({accountId,token,fetchImpl:async(url)=>{
      if(url.includes('/d1/database?')) {
        if(caseName==='bad-page')return d1Page([{name:'naraya-pocket-agent',uuid}],1,2);
        if(caseName==='bad-size')return d1Page([{name:'naraya-pocket-agent',uuid}],1,1,{per_page:20});
        if(url.includes('page=1'))return d1Page([{name:'other',uuid:otherUuid}],2,1);
        return d1Page([{name:'naraya-pocket-agent',uuid}],3,2);
      }
      return json([]);
    }});
    assert.equal(report.d1_inventory,'INVALID_RESPONSE',caseName);
    assert.equal(report.target_d1_present,'UNKNOWN',caseName);
    assert.equal(report.inventory_complete,false,caseName);
  }
});

test('repeated D1 UUID across pages refuses apparent completion',async()=>{
  const report=await inspectReadOnly({accountId,token,fetchImpl:async(url)=>{
    if(url.includes('/d1/database?')) {
      const page=url.includes('page=1')?1:2;
      return d1Page([{name:'other',uuid}],2,page);
    }
    return json([]);
  }});
  assert.equal(report.d1_inventory,'INVALID_RESPONSE');
  assert.equal(report.target_d1_present,'UNKNOWN');
  assert.equal(report.inventory_complete,false);
});

test('partial pages do not turn an unseen target into a verified absence',async()=>{
  const report=await inspectReadOnly({accountId,token,fetchImpl:async(url)=>{
    if(url.includes('page=1'))return d1Page([{name:'other',uuid}],2);
    if(url.includes('page=2'))throw Error('NETWORK_SECRET');
    return json([]);
  }});
  assert.equal(report.target_d1_present,'UNKNOWN');
  assert.equal(report.inventory_complete,false);
  assert.equal(JSON.stringify(report).includes('NETWORK_SECRET'),false);
});

test('D1 detail response with wrong UUID must not yield a trusted size',async()=>{
  const report=await inspectReadOnly({accountId,token,fetchImpl:async(url)=>{
    if(url.includes('/d1/database/'+uuid))return json({name:'naraya-pocket-agent',uuid:otherUuid,file_size:100});
    return fixture(new URL(url).pathname+new URL(url).search);
  }});
  assert.equal(report.target_d1_present,true);
  assert.equal(report.target_d1_size_bytes,'UNKNOWN');
  assert.equal(report.inventory_complete,true); // inventory completeness != detail/cost proof
});

test('untrusted D1 UUID cannot create an arbitrary follow-up GET',async()=>{
  const seen=[];
  const report=await inspectReadOnly({accountId,token,fetchImpl:async(url)=>{
    seen.push(url);
    if(url.includes('/d1/database?'))return d1Page([{name:'naraya-pocket-agent',uuid:'../../bad'}],1);
    return json([]);
  }});
  assert.equal(seen.length,2); // D1 list and Worker list, no untrusted detail URL
  assert.equal(report.d1_inventory,'INVALID_RESPONSE');
  assert.equal(report.target_d1_present,'UNKNOWN');
  checkNoProof(report);
});

test('documented SinglePage Workers response does not assume a 20-script cap',async()=>{
  const report=await inspectReadOnly({accountId,token,fetchImpl:async(url)=>{
    if(url.endsWith('/workers/scripts'))return json(Array.from({length:100},(_,i)=>({id:'worker-'+i})));
    if(url.includes('/d1/database?'))return d1Page([],0);
    return json([]);
  }});
  assert.equal(report.worker_inventory,'COMPLETE_SINGLE_PAGE');
  assert.equal(report.target_worker_present,false);
  assert.equal(report.target_cron_schedules,'SCRIPT_NOT_PRESENT');
  assert.equal(report.inventory_complete,true);
});

test('future paginated Workers response cannot assert target absence',async()=>{
  const report=await inspectReadOnly({accountId,token,fetchImpl:async(url)=>{
    if(url.endsWith('/workers/scripts'))return json([{id:'other'}],{result_info:{total_count:2}});
    if(url.includes('/d1/database?'))return d1Page([],0);
    return json([]);
  }});
  assert.equal(report.worker_inventory,'PARTIAL_SINGLE_PAGE');
  assert.equal(report.target_worker_present,'UNKNOWN');
  assert.equal(report.inventory_complete,false);
});

test('Cron with invalid shape cannot be counted as zero',async()=>{
  const report=await inspectReadOnly({accountId,token,fetchImpl:async(url)=>{
    if(url.endsWith('/schedules'))return json({schedules:[{invalid:true}]});
    return fixture(new URL(url).pathname+new URL(url).search);
  }});
  assert.equal(report.target_cron_schedules,'INVALID_RESPONSE');
  assert.equal(report.inventory_complete,false);
});

test('streaming response enforces byte ceiling before buffering giant provider payload',async()=>{
  const huge='{"success":true,"result":"'+('A'.repeat(265000))+'"}';
  const report=await inspectReadOnly({accountId,token,fetchImpl:async()=>
    new Response(huge,{status:200})
  });
  assert.equal(report.d1_inventory,'UNAVAILABLE');
  assert.equal(report.worker_inventory,'UNAVAILABLE');
  assert.equal(report.inventory_complete,false);
  checkNoProof(report);
});

test('rejected redirect does not result in outputting provider redirect location',async()=>{
  const report=await inspectReadOnly({accountId,token,fetchImpl:async()=>
    new Response(null,{status:302,headers:{location:'https://secret.example.invalid/token'}})
  });
  assert.equal(report.inventory_complete,false);
  assert.equal(JSON.stringify(report).includes('secret.example'),false);
  checkNoProof(report);
});
