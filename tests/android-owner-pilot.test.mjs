import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validWorkerOrigin,validWebClientId,parseOptions,pinMatches,runOwnerCli,
} from '../scripts/android-owner-pilot.mjs';

const web='123456-abcdefghijklmnop.apps.googleusercontent.com';
const origin='https://naraya-pocket-agent-pilot.workers.dev';
const signer={package:'dev.naraya.pocketagent',sha1:'AA:BB:CC',sha256:'DD:EE:FF'};

test('P1-AA local Android pilot accepts only plausible public Web OAuth ID and exact HTTPS Worker origin',()=>{
  assert.equal(validWebClientId(web),true);
  for(const bad of [
    '', 'not-a-google-client', '12345-abc.apps.googleusercontent.com',
    web+'/malicious', '123456-123456789012.apps.googleusercontent.com?x=1',
  ])assert.equal(validWebClientId(bad),false,bad);
  assert.equal(validWorkerOrigin(origin),true);
  assert.equal(validWorkerOrigin('https://evannaraya.com'),true);
  for(const bad of [
    '', 'http://example.com', 'https://127.0.0.1',
    'https://localhost', 'https://some.local', 'https://some.internal',
    'https://some.invalid', 'https://some.test',
    'https://example.com:444', 'https://example.com/',
    'https://example.com/path','https://example.com?x=1',
    'https://example.com/#fragment','https://user@example.com',
    'https://example.com@evil.com','https://example.com\\evil.com',
  ])assert.equal(validWorkerOrigin(bad),false,bad);
});

test('P1-AA permits offline inspect, explicit bootstrap and pin without any cloud arguments',()=>{
  assert.equal(parseOptions([]).mode,'inspect');
  assert.equal(parseOptions(['--inspect']).mode,'inspect');
  assert.equal(parseOptions(['--bootstrap']).mode,'bootstrap');
  assert.equal(parseOptions(['--pin']).mode,'pin');
  assert.equal(parseOptions(['--build']).mode,'build');
});

test('P1-AA cloud build accepts only complete, acknowledged public configuration',()=>{
  const o=parseOptions(['--build','--web-client-id='+web,'--worker-origin='+origin,
    '--acknowledge-owned-origin']);
  assert.equal(o.mode,'build');
  assert.equal(o.web,web);
  assert.equal(o.origin,origin);
  assert.equal(o.ack,true);
  for(const bad of [
    ['--build','--web-client-id='+web],
    ['--build','--worker-origin='+origin],
    ['--build','--web-client-id='+web,'--worker-origin='+origin],
    ['--pin','--web-client-id='+web,'--worker-origin='+origin,'--acknowledge-owned-origin'],
    ['--build','--web-client-id='+web,'--worker-origin=http://127.0.0.1','--acknowledge-owned-origin'],
    ['--build','--web-client-id='+web,'--worker-origin='+origin,'--acknowledge-owned-origin','--acknowledge-owned-origin'],
    ['--inspect','--pin'],
    ['--build','--build'],
    ['--pin','--unknown'],
  ])assert.throws(()=>parseOptions(bad),undefined,bad.join(' '));
});

test('P1-AA local key continuity checks both fingerprints and package, not only presence of pin',()=>{
  assert.equal(pinMatches({...signer},signer),true);
  assert.equal(pinMatches(null,signer),false);
  assert.equal(pinMatches({...signer,sha1:'another'},signer),false);
  assert.equal(pinMatches({...signer,sha256:'another'},signer),false);
  assert.equal(pinMatches({...signer,package:'other.app'},signer),false);
  assert.equal(pinMatches({},signer),false);
});

test('P1-AA unknown flags and incomplete cloud details fail before any keystore/Gradle action',()=>{
  for(const args of [
    ['--write-cloudflare-secret'],
    ['--build','--web-client-id='+web],
    ['--build','--worker-origin='+origin],
    ['--build','--web-client-id='+web,'--worker-origin='+origin],
  ])assert.equal(runOwnerCli(args),2,args.join(' '));
});
