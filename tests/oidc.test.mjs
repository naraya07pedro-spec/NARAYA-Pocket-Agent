import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthRejected, AuthUnavailable, verifyOidcBearer } from '../worker/src/oidc.ts';
import worker from '../worker/src/index.ts';

const settings = {
  OIDC_ISSUER: 'https://accounts.example.invalid',
  OIDC_AUDIENCE: 'pocket-agent-test-client',
  OIDC_JWKS_URL: 'https://keys.example.invalid/jwks.json',
};
const fixedTime = 1_800_000_000_000;
const current = Math.floor(fixedTime / 1000);
const origin = 'https://pocket.example.invalid';
const b64 = bytes => Buffer.from(bytes).toString('base64url');
const pair = await crypto.subtle.generateKey({
  name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256',
}, true, ['sign', 'verify']);
const jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid:'fixture-key', use:'sig', alg:'RS256' };
const goodPayload = { iss:settings.OIDC_ISSUER, aud:settings.OIDC_AUDIENCE,
  sub:'opaque-test-subject', iat:current-60, exp:current+3600 };
const goodHeader = {alg:'RS256',typ:'JWT',kid:'fixture-key'};
async function sign(payload = goodPayload, header = goodHeader) {
  const input = b64(JSON.stringify(header)) + '.' + b64(JSON.stringify(payload));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(input));
  return input + '.' + b64(sig);
}
function request(token) {return new Request(origin+'/v1/me', {headers:token ? {authorization:'Bearer '+token} : {}})}
const keys = (set = {keys:[jwk]}) => async (url, options) => {
  assert.equal(url,settings.OIDC_JWKS_URL);
  assert.equal(options.method,'GET');
  assert.equal(options.redirect,'error');
  return new Response(JSON.stringify(set),{status:200,headers:{'content-type':'application/json'}});
};
async function rejected(token,payload = settings,fetcher = keys()) {
  await assert.rejects(verifyOidcBearer(request(token),payload,fetcher,fixedTime),AuthRejected);
}

test('valid cryptographic identity and separate read-only endpoint; no owner credentials or DB needed',async()=>{
  const token = await sign();
  const value = await verifyOidcBearer(request(token),settings,keys(),fixedTime);
  assert.deepEqual(value,{issuer:settings.OIDC_ISSUER,subject:goodPayload.sub});
  const livePayload = {...goodPayload,iat:Math.floor(Date.now()/1000)-20,exp:Math.floor(Date.now()/1000)+1800};
  const originalFetch = globalThis.fetch;
  let response;
  try {
    globalThis.fetch = keys(); // Worker uses global fetch; no request goes to real JWKS host.
    response = await worker.fetch(request(await sign(livePayload)),{...settings, OWNER_API_TOKEN:undefined, OWNER_ID:undefined, DB:undefined});
  } finally { globalThis.fetch = originalFetch; }
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{authenticated:true,capabilities:{monitorSync:false}});
  assert.equal(response.headers.get('Cache-Control'),'no-store');
});

test('missing/bad credentials rejected before JWKS fetch',async()=>{
  let calls=0;const fake=async()=>{calls++;throw new Error('unexpected fetch')};
  await assert.rejects(verifyOidcBearer(request(),settings,fake,fixedTime),AuthRejected);
  await assert.rejects(verifyOidcBearer(request('operator-bearer-token-not-a-jwt'),settings,fake,fixedTime),AuthRejected);
  await assert.rejects(verifyOidcBearer(request('x'.repeat(9000)),settings,fake,fixedTime),AuthRejected);
  assert.equal(calls,0);
  const env={...settings};
  assert.equal((await worker.fetch(request('operator-bearer-token-not-a-jwt'),env)).status,401);
});

test('tampered payload or signature cannot be accepted',async()=>{
  const token=await sign();
  const [h,p,s]=token.split('.');
  const tampered=b64(JSON.stringify({...goodPayload,sub:'attacker'}));
  await rejected(h+'.'+tampered+'.'+s);
  const changed=s.slice(0,-2)+(s.at(-2)==='A'?'B':'A')+s.at(-1);
  await rejected(h+'.'+p+'.'+changed);
});

test('rejects alg confusion, attacker-provided JWKS URLs, wrong kid and claims',async()=>{
  const badHeaders=[
    {alg:'none',kid:'fixture-key'},{alg:'HS256',kid:'fixture-key'},
    {alg:'RS256',kid:'wrong-key'}, {...goodHeader,jku:'https://evil.invalid/key'},
    {...goodHeader,jwk:{kty:'oct',k:'AAAA'}}, {...goodHeader,crit:['b64']},
  ];
  for(const header of badHeaders)await rejected(await sign(goodPayload,header));
  const invalid=[
    {...goodPayload,aud:'other-client'},
    {...goodPayload,iss:'https://wrong.example.invalid'},
    {...goodPayload,exp:current-1},
    {...goodPayload,iat:current+120},
    {...goodPayload,nbf:current+120},
    {...goodPayload,sub:''},
    {...goodPayload,exp:current+90000},
    {...goodPayload,aud:[settings.OIDC_AUDIENCE,'other-client']},
    {...goodPayload,azp:'another-client'},
  ];
  for(const payload of invalid)await rejected(await sign(payload));
});

test('rejects missing and invalid config without granting identity',async()=>{
  const token=await sign();
  for(const broken of [
    {},{...settings,OIDC_AUDIENCE:undefined},
    {...settings,OIDC_JWKS_URL:'http://127.0.0.1:9999/jwks'},
    {...settings,OIDC_JWKS_URL:'https://keys.example.invalid/jwks.json#fragment'},
  ])await assert.rejects(verifyOidcBearer(request(token),broken,keys(),fixedTime),AuthUnavailable);
  const result=await worker.fetch(request(token),{...settings,OIDC_ISSUER:undefined});
  assert.equal(result.status,503);
  assert.deepEqual(await result.json(),{error:'identity_provider_unavailable'});
});

test('JWKS failures, oversized bodies and ambiguous keys fail closed',async()=>{
  const token=await sign();
  for(const fake of [
    async()=>{throw new Error('DNS offline')},
    async()=>new Response('unavailable',{status:503}),
    async()=>new Response('x'.repeat(65537),{status:200}),
    async()=>new Response('not-json',{status:200}),
  ])await assert.rejects(verifyOidcBearer(request(token),settings,fake,fixedTime),AuthUnavailable);
  await assert.rejects(verifyOidcBearer(request(token),settings,keys({keys:[jwk,jwk]}),fixedTime),AuthRejected);
  await assert.rejects(verifyOidcBearer(request(token),settings,keys({keys:[]}),fixedTime),AuthRejected);
});

test('rejects stale untrusted key, unsupported key class, or invalid signature',async()=>{
  const token=await sign();
  await assert.rejects(verifyOidcBearer(request(token),settings,keys({keys:[{...jwk,kty:'oct'}]}),fixedTime),AuthRejected);
  const other=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const wrong={...await crypto.subtle.exportKey('jwk',other.publicKey),kid:jwk.kid};
  await assert.rejects(verifyOidcBearer(request(token),settings,keys({keys:[wrong]}),fixedTime),AuthRejected);
});


test('public JWKS max-age caches keys but re-verifies JWT signature for every request',async()=>{
  const valid=await sign();
  let requests=0;
  const fetcher=async(url,opts)=>{
    assert.equal(url,settings.OIDC_JWKS_URL);
    assert.equal(opts.redirect,'error');
    requests++;
    return new Response(JSON.stringify({keys:[jwk]}),{
      headers:{'Cache-Control':'public, max-age=120'},
    });
  };
  const first=await verifyOidcBearer(request(valid),settings,fetcher,fixedTime);
  const second=await verifyOidcBearer(request(valid),settings,fetcher,fixedTime+60_000);
  assert.deepEqual(first,second);
  assert.equal(requests,1,'public JWKS reused within provider TTL');
  const [head,body,signature]=valid.split('.');
  const forged=head+'.'+b64(JSON.stringify({...goodPayload,sub:'impostor'}))+'.'+signature;
  await assert.rejects(verifyOidcBearer(request(forged),settings,fetcher,fixedTime+60_000),AuthRejected);
  assert.equal(requests,1,'forged JWT rejected with cached public key');
  await verifyOidcBearer(request(valid),settings,fetcher,fixedTime+121_000);
  assert.equal(requests,2,'expired JWKS fetched anew');
});

test('concurrent JWKS miss coalesces upstream fetch without sharing authorization',async()=>{
  let requests=0;
  const fetcher=async()=>{
    requests++;
    await new Promise(resolve=>setTimeout(resolve,5));
    return new Response(JSON.stringify({keys:[jwk]}),{
      headers:{'Cache-Control':'public, max-age=300'},
    });
  };
  const good=await sign();
  const [h,p,s]=good.split('.');
  const bad=h+'.'+b64(JSON.stringify({...goodPayload,sub:'wrong-subject'}))+'.'+s;
  const outcomes=await Promise.all([
    ...Array.from({length:12},()=>verifyOidcBearer(request(good),settings,fetcher,fixedTime)),
    verifyOidcBearer(request(bad),settings,fetcher,fixedTime)
      .then(()=> 'accepted',error=>error instanceof AuthRejected?'rejected':'unexpected'),
  ]);
  assert.equal(requests,1);
  assert.deepEqual(outcomes.slice(0,12).map(result=>result.subject),Array(12).fill(goodPayload.sub));
  assert.equal(outcomes[12],'rejected');
});

test('no-store, private, zero max-age, malformed and missing headers never cache',async()=>{
  const valid=await sign();
  for(const header of [
    undefined,'private, max-age=600','no-store, public, max-age=600',
    'public, max-age=0','public, max-age=999, max-age=1',
    'public, max-age=not-a-number','max-age=30',
  ]){
    let requests=0;
    const fetcher=async()=>{
      requests++;
      return new Response(JSON.stringify({keys:[jwk]}),{
        headers:header?{'Cache-Control':header}:{},
      });
    };
    await verifyOidcBearer(request(valid),settings,fetcher,fixedTime);
    await verifyOidcBearer(request(valid),settings,fetcher,fixedTime+1000);
    assert.equal(requests,2,'cache disabled for '+String(header));
  }
});

test('provider failure after JWKS expiry never falls back to stale cached keys',async()=>{
  const valid=await sign();
  let requests=0,online=true;
  const fetcher=async()=>{
    requests++;
    if(!online)throw new Error('offline-provider');
    return new Response(JSON.stringify({keys:[jwk]}),{
      headers:{'Cache-Control':'public, max-age=1'},
    });
  };
  await verifyOidcBearer(request(valid),settings,fetcher,fixedTime);
  online=false;
  await verifyOidcBearer(request(valid),settings,fetcher,fixedTime+900);
  assert.equal(requests,1);
  await assert.rejects(verifyOidcBearer(request(valid),settings,fetcher,fixedTime+1000),AuthUnavailable);
  assert.equal(requests,2);
  await assert.rejects(verifyOidcBearer(request(valid),settings,fetcher,fixedTime+1100),AuthUnavailable);
  assert.equal(requests,3,'failure is not a permanent cached authorization');
});

test('rotated provider keys become usable only after bounded cache expiry',async()=>{
  const valid=await sign();
  const other=await crypto.subtle.generateKey({
    name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
    publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256',
  },true,['sign','verify']);
  const stale={...await crypto.subtle.exportKey('jwk',other.publicKey),kid:jwk.kid,use:'sig',alg:'RS256'};
  let currentKey=stale,requests=0;
  const fetcher=async()=>{
    requests++;
    return new Response(JSON.stringify({keys:[currentKey]}),{
      headers:{'Cache-Control':'public, max-age=2'},
    });
  };
  await assert.rejects(verifyOidcBearer(request(valid),settings,fetcher,fixedTime),AuthRejected);
  currentKey=jwk;
  await assert.rejects(verifyOidcBearer(request(valid),settings,fetcher,fixedTime+1000),AuthRejected);
  assert.equal(requests,1);
  await verifyOidcBearer(request(valid),settings,fetcher,fixedTime+2001);
  assert.equal(requests,2);
});

test('JWKS TTL is capped at five minutes and different fetchers have isolated keys',async()=>{
  const valid=await sign();
  let callsA=0,callsB=0;
  const fetchA=async()=>{callsA++;return new Response(JSON.stringify({keys:[jwk]}),{
    headers:{'Cache-Control':'public, max-age=31536000'},
  });};
  const fetchB=async()=>{callsB++;return new Response(JSON.stringify({keys:[]}),{
    headers:{'Cache-Control':'public, max-age=31536000'},
  });};
  await verifyOidcBearer(request(valid),settings,fetchA,fixedTime);
  await verifyOidcBearer(request(valid),settings,fetchA,fixedTime+299_000);
  assert.equal(callsA,1);
  await assert.rejects(verifyOidcBearer(request(valid),settings,fetchB,fixedTime+299_000),AuthRejected);
  assert.equal(callsB,1,'different fetcher cannot inherit cached trust');
  await verifyOidcBearer(request(valid),settings,fetchA,fixedTime+301_000);
  assert.equal(callsA,2,'cache cannot exceed five minutes');
});
