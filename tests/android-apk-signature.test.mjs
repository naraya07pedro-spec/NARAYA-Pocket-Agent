import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir,platform} from 'node:os';
import {
  parseVerifiedApkSignature,parseApkPackage,apkSignerMatches,verifyCompiledApk,
} from '../scripts/android-apk-signature.mjs';

const rawSha1='0123456789abcdef0123456789abcdef01234567';
const rawSha256='0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const colon=s=>s.toUpperCase().match(/../g).join(':');
const signer={package:'dev.naraya.pocketagent',sha1:colon(rawSha1),sha256:colon(rawSha256)};
const good=[
  'Verifies',
  'Verified using v1 scheme (JAR signing): false',
  'Verified using v2 scheme (APK Signature Scheme v2): true',
  'Verified using v3 scheme (APK Signature Scheme v3): false',
  'Number of signers: 1',
  'Signer #1 certificate DN: CN=Android Debug',
  'Signer #1 certificate SHA-256 digest: '+rawSha256,
  'Signer #1 certificate SHA-1 digest: '+rawSha1,
  'Signer #1 certificate MD5 digest: '+'a'.repeat(32),
].join('\n');
const badging="package: name='dev.naraya.pocketagent' versionCode='3' versionName='0.3.0-alpha'\nsdkVersion:'26'\n";

test('P1-AB parse actual expected Android SDK v2 signing output and exactly one signer',()=>{
  assert.deepEqual(parseVerifiedApkSignature(good),{sha1:signer.sha1,sha256:signer.sha256});
  assert.equal(parseApkPackage(badging),'dev.naraya.pocketagent');
  assert.equal(apkSignerMatches(signer,parseVerifiedApkSignature(good)),true);
});

test('P1-AB reject unverified, duplicate, missing or ambiguous signer certificate metadata',()=>{
  const bad=[
    good.replace('v2): true','v2): false'),
    good.replace('Number of signers: 1','Number of signers: 2'),
    good.replace('Number of signers: 1','Number of signers: 0'),
    good.replace('Signer #1 certificate SHA-1 digest: '+rawSha1,''),
    good.replace('Signer #1 certificate SHA-256 digest: '+rawSha256,''),
    good+'\nSigner #1 certificate SHA-1 digest: '+rawSha1,
    good+'\nSigner #2 certificate SHA-256 digest: '+rawSha256,
    good.replace(rawSha1,'NOT_A_DIGEST'),
    good.replace(rawSha256,'NOT_A_DIGEST'),
    'Not signed\n'+good.replace('Verified using v2 scheme (APK Signature Scheme v2): true',''),
    'a'.repeat(260_000),
  ];
  for(const output of bad)assert.throws(()=>parseVerifiedApkSignature(output),undefined,output.slice(0,60));
});

test('P1-AB exact APK package required, never infer it from text anywhere',()=>{
  for(const output of [
    '', 'package: name=dev.naraya.pocketagent',
    "package: name='evil.example' versionCode='1'",
    "application-label:'dev.naraya.pocketagent'",
    badging+"package: name='dev.naraya.pocketagent' versionCode='4'\n",
    'x'.repeat(260_000),
  ])assert.throws(()=>parseApkPackage(output),undefined,output.slice(0,100));
});

test('P1-AB requires BOTH owner-keystore fingerprints and exact package',()=>{
  const apk=parseVerifiedApkSignature(good);
  assert.equal(apkSignerMatches({...signer,sha1:'AA:BB'},apk),false);
  assert.equal(apkSignerMatches({...signer,sha256:'DD:EE'},apk),false);
  assert.equal(apkSignerMatches({...signer,package:'evil.app'},apk),false);
  assert.equal(apkSignerMatches({...signer,sha1:'INVALID'},apk),false);
  assert.equal(apkSignerMatches(null,apk),false);
  assert.equal(apkSignerMatches(signer,null),false);
});

test('P1-AB invokes actual SDK verification workflow (injected runner) and refuses tool errors',()=>{
  const temp=mkdtempSync(join(tmpdir(),'naraya-apk-check-'));
  try{
    const tools=join(temp,'build-tools','36.0.0');
    mkdirSync(join(tools,'lib'),{recursive:true});
    writeFileSync(join(tools,'lib','apksigner.jar'),'fixture only, never executed');
    writeFileSync(join(tools,platform()==='win32'?'aapt.exe':'aapt'),'fixture only');
    const apk=join(temp,'app-debug.apk');
    writeFileSync(apk,Buffer.alloc(4096));
    const calls=[];
    const mock=(cmd,args,opts)=>{
      calls.push({cmd,args,opts});
      if(args[0]==='-jar')return {status:0,stdout:good};
      if(args[0]==='dump')return {status:0,stdout:badging};
      throw Error('unexpected tool');
    };
    const evidence=verifyCompiledApk({apkPath:apk,signer,sdkRoot:temp,
      javaExecutable:'synthetic-java',run:mock});
    assert.equal(evidence.signature_verified_for_min_sdk_26,true);
    assert.equal(evidence.certificate_matches_owner_keystore,true);
    assert.equal(evidence.package,'dev.naraya.pocketagent');
    assert.equal(calls.length,2);
    assert.equal(calls[0].cmd,'synthetic-java');
    assert.deepEqual(calls[0].args.slice(2,8),[
      'verify','--verbose','--print-certs','--min-sdk-version','26',apk,
    ]);
    assert.equal(calls[0].opts.shell,false);
    assert.equal(calls[1].args[0],'dump');
    assert.equal(calls[1].args[1],'badging');

    const badRuns=[
      (cmd,args)=>args[0]==='-jar'?{status:1,stdout:good}:{status:0,stdout:badging},
      (cmd,args)=>args[0]==='-jar'?{status:0,stdout:good.replace(rawSha256,'a'.repeat(64))}:{status:0,stdout:badging},
      (cmd,args)=>args[0]==='-jar'?{status:0,stdout:good}:{status:1,stdout:badging},
      (cmd,args)=>args[0]==='-jar'?{status:0,stdout:good}:{status:0,stdout:badging.replace('dev.naraya.pocketagent','other.package')},
    ];
    for(const run of badRuns)assert.throws(()=>verifyCompiledApk({
      apkPath:apk,signer,sdkRoot:temp,javaExecutable:'synthetic-java',run,
    }));
    assert.throws(()=>verifyCompiledApk({apkPath:join(temp,'missing.apk'),
      signer,sdkRoot:temp,run:mock}));
    assert.throws(()=>verifyCompiledApk({apkPath:apk,
      signer,sdkRoot:join(temp,'missing-sdk'),run:mock}));
  }finally{rmSync(temp,{recursive:true,force:true});}
});
