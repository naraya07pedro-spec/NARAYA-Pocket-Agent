import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectBillingReadOnly,billingOfflineStatus} from '../scripts/cloudflare-billing-readonly.mjs';

const accountId='b'.repeat(32);
const token='synthetic-readonly-billing-token-never-real';
const json=(result,extra={})=>new Response(JSON.stringify({success:true,result,...extra}),{status:200});
const subscriptions=rows=>json(rows);
const history=(rows,total,page=1,extra={})=>json(rows,{result_info:{
  page,per_page:20,count:rows.length,total_count:total,...extra,
}});
const fixture=url=>{
  if(url.endsWith('/subscriptions'))return subscriptions([]);
  const u=new URL(url);
  if(u.pathname.endsWith('/billing/history'))return history([],0,Number(u.searchParams.get('page')));
  throw Error('unexpected_URL');
};
const limits=report=>{
  assert.equal(report.remote_acceptance,'BLOCKED');
  assert.equal(report.safe_to_deploy,false);
  assert.equal(report.safe_to_activate_scheduler,false);
  assert.equal(report.account_plan,'NOT_VERIFIED');
  assert.equal(report.account_billing,'NOT_VERIFIED');
  assert.equal(report.free_tier_daily_usage,'NOT_VERIFIED');
  assert.equal(report.current_free_tier_proven,false);
  assert.equal(report.future_zero_extra_cost_proven,false);
};

test('offline default is inert and cannot certify cost or live Cloudflare',()=>{
  const report=billingOfflineStatus();
  assert.equal(report.inspection_mode,'OFFLINE_DEFAULT_NO_NETWORK');
  assert.equal(report.subscription_inventory,'NOT_INSPECTED');
  assert.equal(report.billing_history,'NOT_INSPECTED');
  assert.equal(report.billing_metadata_complete,false);
  limits(report);
});

test('Billing Read uses only exact allowlisted GET Cloudflare endpoints with no raw billing output',async()=>{
  const seen=[];
  const report=await inspectBillingReadOnly({accountId,token,fetchImpl:async(url,opts)=>{
    seen.push({url,opts});
    return fixture(url);
  }});
  assert.equal(seen.length,2);
  assert.deepEqual(seen.map(x=>new URL(x.url).pathname),[
    '/client/v4/accounts/'+accountId+'/subscriptions',
    '/client/v4/accounts/'+accountId+'/billing/history',
  ]);
  for(const {url,opts} of seen){
    assert.equal(new URL(url).origin,'https://api.cloudflare.com');
    assert.equal(opts.method,'GET');
    assert.equal(opts.redirect,'error');
    assert.equal(opts.headers.Authorization,'Bearer '+token);
  }
  assert.equal(report.subscription_count,0);
  assert.equal(report.subscription_inventory,'COMPLETE_SINGLE_PAGE');
  assert.equal(report.billing_history,'COMPLETE_PAGES');
  assert.equal(report.paid_subscription_signal,'NONE_RETURNED_NOT_FREE_PROOF');
  assert.equal(report.historical_positive_amount_seen,'NO_IN_HISTORY_NOT_FREE_PROOF');
  assert.equal(report.billing_metadata_complete,true);
  const content=JSON.stringify(report);
  assert.equal(content.includes(accountId),false);
  assert.equal(content.includes(token),false);
  limits(report);
});

test('subscription with price or Paid state reports possible paid subscription but never invoice proof',async()=>{
  const subscription='private-subscription-internal-id';
  const invoice='private-invoice-rare';
  const report=await inspectBillingReadOnly({accountId,token,fetchImpl:async url=>
    url.endsWith('/subscriptions')?
      subscriptions([{id:subscription,price:10,currency:'USD',state:'Paid'}]):
      history([{invoice_id:invoice,amount:6.99,amount_to_pay:0,currency:'USD'}],1)
  });
  assert.equal(report.paid_subscription_signal,'POTENTIAL_PAID_SUBSCRIPTION_PRESENT');
  assert.equal(report.historical_positive_amount_seen,'YES_HISTORICAL_ONLY');
  assert.equal(report.billing_records_scanned,1);
  assert.equal(report.billing_metadata_complete,true);
  const output=JSON.stringify(report);
  assert.ok(!output.includes(subscription));
  assert.ok(!output.includes(invoice));
  assert.ok(!output.includes('USD'));
  limits(report);
});

test('not seeing a paid subscription does not assert future zero usage charges',async()=>{
  const report=await inspectBillingReadOnly({accountId,token,fetchImpl:async url=>
    url.endsWith('/subscriptions')?
      subscriptions([{state:'Trial',price:0},{state:'Provisioned'}]):
      history([],0)
  });
  assert.equal(report.paid_subscription_signal,'NO_POSITIVE_PRICE_OR_PAID_STATE_SEEN_NOT_FREE_PROOF');
  limits(report);
});

test('history pagination uses total_count and never infers no charges from first short page',async()=>{
  const seen=[];
  const report=await inspectBillingReadOnly({accountId,token,fetchImpl:async url=>{
    seen.push(url);
    if(url.endsWith('/subscriptions'))return subscriptions([]);
    const page=Number(new URL(url).searchParams.get('page'));
    if(page===1)return history([{amount:0,invoice_id:'hidden-a'}],2,1);
    return history([{amount_to_pay:100,invoice_id:'hidden-b'}],2,2);
  }});
  assert.ok(seen.some(url=>url.includes('page=2&per_page=20')));
  assert.equal(report.billing_history,'COMPLETE_PAGES');
  assert.equal(report.historical_positive_amount_seen,'YES_HISTORICAL_ONLY');
  assert.equal(report.billing_records_scanned,2);
  assert.equal(report.billing_metadata_complete,true);
  assert.ok(!JSON.stringify(report).includes('hidden-b'));
  limits(report);
});

test('bound billing history at five pages and classify unknown remaining future records',async()=>{
  const seen=[];
  const report=await inspectBillingReadOnly({accountId,token,fetchImpl:async url=>{
    seen.push(url);
    if(url.endsWith('/subscriptions'))return subscriptions([]);
    const page=Number(new URL(url).searchParams.get('page'));
    const rows=Array.from({length:20},(_,i)=>({invoice_id:'hidden-'+page+'-'+i,amount:0}));
    return history(rows,101,page);
  }});
  assert.equal(seen.length,6);
  assert.equal(report.billing_history,'PARTIAL_PAGES');
  assert.equal(report.historical_positive_amount_seen,'UNKNOWN_IN_INCOMPLETE_HISTORY');
  assert.equal(report.billing_records_scanned,100);
  assert.equal(report.billing_metadata_complete,false);
  limits(report);
});

test('contradictory history page metadata fails closed',async()=>{
  for(const mode of ['page','size','count','total','zero-page']){
    const report=await inspectBillingReadOnly({accountId,token,fetchImpl:async url=>{
      if(url.endsWith('/subscriptions'))return subscriptions([]);
      const page=Number(new URL(url).searchParams.get('page'));
      if(mode==='page')return history([],0,2);
      if(mode==='size')return history([],0,1,{per_page:11});
      if(mode==='count')return history([{amount:1}],1,1,{count:0});
      if(mode==='zero-page')return page===1?history([{amount:0}],2,1):history([],2,2);
      return page===1?history([{amount:0}],2,1):history([{amount:0}],3,2);
    }});
    if(mode==='zero-page') {
      assert.equal(report.billing_history,'PARTIAL_PAGES');
    } else {
      assert.equal(report.billing_history,'INVALID_RESPONSE');
    }
    assert.equal(report.billing_metadata_complete,false);
    limits(report);
  }
});

test('missing billing history metadata cannot be certified complete',async()=>{
  const report=await inspectBillingReadOnly({accountId,token,fetchImpl:async url=>
    url.endsWith('/subscriptions')?subscriptions([]):json([])
  });
  assert.equal(report.billing_history,'INVALID_RESPONSE');
  assert.equal(report.historical_positive_amount_seen,'UNKNOWN');
  assert.equal(report.billing_metadata_complete,false);
  limits(report);
});

test('subscription contradictory total count is not a real subscription conclusion',async()=>{
  const report=await inspectBillingReadOnly({accountId,token,fetchImpl:async url=>
    url.endsWith('/subscriptions')?
      json([{state:'Trial'}],{result_info:{total_count:9}}):history([],0)
  });
  assert.equal(report.subscription_inventory,'INVALID_RESPONSE');
  assert.equal(report.paid_subscription_signal,'UNKNOWN');
  assert.equal(report.billing_metadata_complete,false);
});

test('403 billing token scope failures are sanitized and do not leak provider API data',async()=>{
  const report=await inspectBillingReadOnly({accountId,token,fetchImpl:async()=>
    new Response('{"success":false,"message":"raw-secret-provider-data"}',{status:403})
  });
  assert.equal(report.subscription_inventory,'UNAVAILABLE');
  assert.equal(report.billing_history,'UNAVAILABLE');
  assert.equal(report.billing_metadata_complete,false);
  assert.ok(!JSON.stringify(report).includes('raw-secret-provider-data'));
  limits(report);
});

test('invalid account/token/timeout cannot trigger API',async()=>{
  let attempts=0;
  const fake=async()=>{attempts++;return json([])};
  await assert.rejects(inspectBillingReadOnly({accountId:'../../danger',token,fetchImpl:fake}),/invalid_account_id/);
  await assert.rejects(inspectBillingReadOnly({accountId,token:'x y',fetchImpl:fake}),/invalid_token/);
  await assert.rejects(inspectBillingReadOnly({accountId,token,timeoutMs:99999,fetchImpl:fake}),/invalid_timeout/);
  assert.equal(attempts,0);
});

test('unbounded billing HTTP body is cancelled before full text is buffered',async()=>{
  const large='{"success":true,"result":"'+('a'.repeat(140000))+'"}';
  const report=await inspectBillingReadOnly({accountId,token,fetchImpl:async()=>new Response(large)});
  assert.equal(report.subscription_inventory,'UNAVAILABLE');
  assert.equal(report.billing_history,'UNAVAILABLE');
  assert.equal(report.billing_metadata_complete,false);
  limits(report);
});

test('redirect response cannot exfiltrate bearer token into redirect destination or logs',async()=>{
  const report=await inspectBillingReadOnly({accountId,token,fetchImpl:async(url,opts)=>{
    assert.equal(opts.redirect,'error');
    return new Response(null,{status:302,headers:{Location:'https://attacker.invalid/secret'}});
  }});
  assert.equal(report.billing_metadata_complete,false);
  assert.ok(!JSON.stringify(report).includes('attacker.invalid'));
  limits(report);
});

test('positive amount on an incomplete history is historical evidence, not free-tier clearance',async()=>{
  const report=await inspectBillingReadOnly({accountId,token,fetchImpl:async url=>{
    if(url.endsWith('/subscriptions'))return subscriptions([]);
    const page=Number(new URL(url).searchParams.get('page'));
    return history([{amount:100}],page===1?2:3,page);
  }});
  assert.equal(report.billing_history,'INVALID_RESPONSE');
  assert.equal(report.historical_positive_amount_seen,'UNKNOWN'); // page metadata inconsistency
  assert.equal(report.billing_metadata_complete,false);
  limits(report);
});
