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


function fakeCache(){
  const data=new Map();
  return {
    data,
    async match(request){return data.get(request.url)?.clone()},
    async put(request,response){data.set(request.url,response.clone())},
  };
}

test('Cloudflare Cache API reuses only bounded public JWKS while verifying each signature',async()=>{
  const cache=fakeCache(),valid=await sign();
  let calls=0;
  const provider=async()=> {
    calls++;
    return new Response(JSON.stringify({keys:[jwk]}),{
      headers:{'Cache-Control':'public, max-age=120'},
    });
  };
  const first=await verifyOidcBearer(request(valid),settings,provider,fixedTime,cache);
  const second=await verifyOidcBearer(request(valid),settings,provider,fixedTime+60_000,cache);
  assert.deepEqual(first,second);
  assert.equal(calls,1);
  assert.equal(cache.data.size,1);
  const raw=await cache.match(new Request(settings.OIDC_JWKS_URL));
  assert.equal(raw.headers.get('Cache-Control'),'public, max-age=120');
  const cachedBody=await raw.text();
  assert.ok(cachedBody.includes(jwk.kid));
  assert.ok(!cachedBody.includes(goodPayload.sub),'no user identity in cache');
  const [header,body,signature]=valid.split('.');
  const forged=header+'.'+b64(JSON.stringify({...goodPayload,sub:'forged-subject'}))+'.'+signature;
  await assert.rejects(verifyOidcBearer(request(forged),settings,provider,fixedTime+60_000,cache),AuthRejected);
  assert.equal(calls,1,'forged token rejected even with cached public key');
  await verifyOidcBearer(request(valid),settings,provider,fixedTime+121_000,cache);
  assert.equal(calls,2,'expiry forces refresh');
});

test('missing, no-store, private, ambiguous and zero TTL never populate JWKS cache',async()=>{
  const valid=await sign();
  for (const header of [undefined,'private, max-age=200','public, no-store, max-age=200',
    'public, max-age=0','public, max-age=1, max-age=200',
    'public, max-age=oops','max-age=200']) {
    const cache=fakeCache();
    let calls=0;
    const provider=async()=>{
      calls++;
      return new Response(JSON.stringify({keys:[jwk]}),{
        headers:header?{'Cache-Control':header}:{},
      });
    };
    await verifyOidcBearer(request(valid),settings,provider,fixedTime,cache);
    await verifyOidcBearer(request(valid),settings,provider,fixedTime+1000,cache);
    assert.equal(calls,2,'unexpected cache on '+String(header));
    assert.equal(cache.data.size,0);
  }
});

test('expired JWKS is never used when provider fetch fails',async()=>{
  const cache=fakeCache(),valid=await sign();
  let online=true,calls=0;
  const provider=async()=>{
    calls++;
    if(!online)throw Error('provider unavailable');
    return new Response(JSON.stringify({keys:[jwk]}),{
      headers:{'Cache-Control':'public, max-age=1'},
    });
  };
  await verifyOidcBearer(request(valid),settings,provider,fixedTime,cache);
  online=false;
  await verifyOidcBearer(request(valid),settings,provider,fixedTime+900,cache);
  assert.equal(calls,1);
  await assert.rejects(verifyOidcBearer(request(valid),settings,provider,fixedTime+1001,cache),AuthUnavailable);
  assert.equal(calls,2);
});

test('key rotation and TTL cap re-fetch keys instead of extending stale trust',async()=>{
  const cache=fakeCache(),valid=await sign();
  const other=await crypto.subtle.generateKey({
    name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
    publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256',
  },true,['sign','verify']);
  const wrong={...await crypto.subtle.exportKey('jwk',other.publicKey),kid:jwk.kid,use:'sig',alg:'RS256'};
  let signingKey=wrong,calls=0;
  const provider=async()=>{
    calls++;
    return new Response(JSON.stringify({keys:[signingKey]}),{
      headers:{'Cache-Control':'public, max-age=2'},
    });
  };
  await assert.rejects(verifyOidcBearer(request(valid),settings,provider,fixedTime,cache),AuthRejected);
  signingKey=jwk;
  await assert.rejects(verifyOidcBearer(request(valid),settings,provider,fixedTime+1000,cache),AuthRejected);
  assert.equal(calls,1);
  await verifyOidcBearer(request(valid),settings,provider,fixedTime+2001,cache);
  assert.equal(calls,2);
  const largeCache=fakeCache();
  let largeCalls=0;
  const longHeader=async()=>{
    largeCalls++;
    return new Response(JSON.stringify({keys:[jwk]}),{headers:{'Cache-Control':'public, max-age=31536000'}});
  };
  await verifyOidcBearer(request(valid),settings,longHeader,fixedTime,largeCache);
  await verifyOidcBearer(request(valid),settings,longHeader,fixedTime+299_000,largeCache);
  assert.equal(largeCalls,1);
  const entry=await largeCache.match(new Request(settings.OIDC_JWKS_URL));
  assert.equal(entry.headers.get('Cache-Control'),'public, max-age=300');
  await verifyOidcBearer(request(valid),settings,longHeader,fixedTime+301_000,largeCache);
  assert.equal(largeCalls,2,'TTL cap of 5m enforced irrespective of provider max-age');
});

test('malformed or unavailable Cache API falls back to fresh verification, never stale authorization',async()=>{
  const valid=await sign();
  let calls=0;
  const provider=async()=>{
    calls++;
    return new Response(JSON.stringify({keys:[jwk]}),{
      headers:{'Cache-Control':'public, max-age=120'},
    });
  };
  const broken={
    async match(){throw new Error('cache not available')},
    async put(){throw new Error('write disabled')},
  };
  await verifyOidcBearer(request(valid),settings,provider,fixedTime,broken);
  await verifyOidcBearer(request(valid),settings,provider,fixedTime+1000,broken);
  assert.equal(calls,2);
  const corrupt=fakeCache();
  await corrupt.put(new Request(settings.OIDC_JWKS_URL),
    new Response('malformed-json',{
      headers:{
        'x-naraya-key-valid-until':String(fixedTime+120000),
        'Cache-Control':'public, max-age=120',
      },
    }));
  await verifyOidcBearer(request(valid),settings,provider,fixedTime+2000,corrupt);
  assert.equal(calls,3,'corrupt cached data never becomes proof of identity');
  const closed={
    async match(){return new Response(JSON.stringify({keys:[jwk]}),{
      headers:{'x-naraya-key-valid-until':'bad','Cache-Control':'public, max-age=120'},
    })},
    async put(){},
  };
  await verifyOidcBearer(request(valid),settings,provider,fixedTime+3000,closed);
  assert.equal(calls,4,'untrusted expiry header cannot extend cache authority');
});

test('concurrent callers never cache bearer headers, subjects or request-bound promises',async()=>{
  const valid=await sign(),cache=fakeCache();
  let calls=0;
  const provider=async()=>{
    calls++;
    await new Promise(resolve=>setTimeout(resolve,5));
    return new Response(JSON.stringify({keys:[jwk]}),{
      headers:{'Cache-Control':'public, max-age=60'},
    });
  };
  const [h,p,s]=valid.split('.');
  const fake=h+'.'+b64(JSON.stringify({...goodPayload,sub:'attacker'}))+'.'+s;
  const results=await Promise.all([
    ...Array.from({length:8},()=>verifyOidcBearer(request(valid),settings,provider,fixedTime,cache)),
    verifyOidcBearer(request(fake),settings,provider,fixedTime,cache).then(
      ()=>false,error=>error instanceof AuthRejected),
  ]);
  assert.equal(results.at(-1),true);
  assert.equal(new Set(results.slice(0,8).map(result=>result.subject)).size,1);
  assert.ok(calls>=1,'no guarantee of request single-flight, only public response caching');
  const stored=await cache.match(new Request(settings.OIDC_JWKS_URL));
  const bytes=await stored.text();
  assert.ok(!bytes.includes('Bearer'));
  assert.ok(!bytes.includes(goodPayload.sub));
});
