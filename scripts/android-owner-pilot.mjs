#!/usr/bin/env node
/**
 * P1-AA: owner-only, LOCAL Android debug signing continuity.
 * No Cloudflare/Google API calls, remote writes, account secrets, or keystore export.
 * A fingerprint is not a production-signing certificate or a signature verifier.
 */
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {homedir,platform} from 'node:os';
import {isIP} from 'node:net';
import {createHash,X509Certificate} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {verifyCompiledApk} from './android-apk-signature.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const HOME=homedir();
const keystore=join(HOME,'.android','debug.keystore');
const pinPath=join(HOME,'.naraya-pocket-agent','pilot-debug-signer-lock.json');
const apkPath=join(root,'android','app','build','outputs','apk','debug','app-debug.apk');
const PACKAGE='dev.naraya.pocketagent';
const WEB=/^[0-9]{5,}-[A-Za-z0-9_-]{12,}\.apps\.googleusercontent\.com$/;

export function validWorkerOrigin(value){
  if(typeof value!=='string'||value.length>255)return false;
  try{
    const u=new URL(value);
    return u.protocol==='https:' && u.origin===value && !u.username && !u.password &&
      !u.search && !u.hash && (u.pathname==='/'||u.pathname==='') &&
      !u.port && u.hostname.includes('.') && !isIP(u.hostname) &&
      !/(^localhost$|\.localhost$|\.local$|\.internal$|\.invalid$|\.test$)/i.test(u.hostname) &&
      /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(u.hostname);
  }catch{return false;}
}
export function validWebClientId(value){
  return typeof value==='string' && WEB.test(value);
}
export function parseOptions(argv){
  const opt={mode:'inspect',web:'',origin:'',ack:false};
  const modes=new Set(['--inspect','--bootstrap','--pin','--build','--verify-apk']);
  let chosen=false;
  for(const value of argv){
    if(modes.has(value)){
      if(chosen)throw Error('multiple_modes');
      chosen=true;opt.mode=value.slice(2);
    }else if(value.startsWith('--web-client-id=')){
      if(opt.web)throw Error('duplicate_web_client');
      opt.web=value.slice('--web-client-id='.length);
    }else if(value.startsWith('--worker-origin=')){
      if(opt.origin)throw Error('duplicate_worker_origin');
      opt.origin=value.slice('--worker-origin='.length);
    }else if(value==='--acknowledge-owned-origin'){
      if(opt.ack)throw Error('duplicate_ack');
      opt.ack=true;
    }else throw Error('unrecognized_argument');
  }
  if(opt.web||opt.origin||opt.ack){
    if(opt.mode!=='build' || !validWebClientId(opt.web) ||
       !validWorkerOrigin(opt.origin) || !opt.ack)throw Error('invalid_cloud_build_configuration');
  }
  return opt;
}
function keytool(){
  const executable=platform()==='win32'?'keytool.exe':'keytool';
  return process.env.JAVA_HOME ? join(process.env.JAVA_HOME,'bin',executable) : executable;
}
function localCertificate(){
  if(!existsSync(keystore))throw Error('no_local_debug_keystore_run_bootstrap_first');
  // Android's standard debug keystore password is public; this never exports
  // the PRIVATE key. The exported PEM contains the PUBLIC certificate only.
  const run=spawnSync(keytool(),[
    '-exportcert','-rfc','-keystore',keystore,
    '-alias','androiddebugkey','-storepass','android',
  ],{encoding:'utf8',timeout:12000,maxBuffer:128*1024,windowsHide:true});
  if(run.error||run.status!==0)throw Error('local_keytool_or_debug_keystore_unavailable');
  try{
    const cert=new X509Certificate(run.stdout);
    return {package:PACKAGE,sha1:cert.fingerprint,sha256:cert.fingerprint256};
  }catch{throw Error('local_debug_certificate_invalid');}
}
export function pinMatches(pinned,current){
  return pinned?.package===PACKAGE &&
    typeof pinned.sha1==='string' && typeof pinned.sha256==='string' &&
    pinned.sha1===current.sha1 && pinned.sha256===current.sha256;
}
function loadPin(){
  if(!existsSync(pinPath))return null;
  try {
    const raw=readFileSync(pinPath,'utf8');
    if(raw.length>2048)throw Error();
    const value=JSON.parse(raw);
    if(value.schema_version!==1)throw Error();
    return value;
  }catch{throw Error('signing_pin_invalid_or_tampered');}
}
function inspect(){
  const signer=localCertificate();
  const pin=loadPin();
  console.log(JSON.stringify({
    mode:'OWNER_LOCAL_DEBUG_SIGNING_ONLY',
    package:PACKAGE,sha1:signer.sha1,sha256:signer.sha256,
    pin_status:!pin?'NOT_PINNED':pinMatches(pin,signer)?'MATCH':'MISMATCH_BLOCK',
    cloud_oauth:'NOT_VERIFIED',apk_install:'NOT_VERIFIED',
  },null,2));
  return {signer,pin};
}
function runGradle(args=[]){
  // Gradle must already be installed (9.4.1), JDK 17, Android SDK 37.
  // cwd avoids Windows profile paths with spaces as command-line arguments.
  // Public client IDs/origins are validated above; no credentials are passed.
  const commands=['--no-daemon','--max-workers=2',':app:testDebugUnitTest',':app:assembleDebug',...args];
  const r=spawnSync('gradle',commands,{
    cwd:join(root,'android'),stdio:'inherit',timeout:25*60_000,
    shell:platform()==='win32',windowsHide:true,
  });
  if(r.error||r.status!==0)throw Error('gradle_build_failed_check_jdk17_gradle941_sdk37');
}
export function runOwnerCli(argv=process.argv.slice(2)){
  let o;
  try{o=parseOptions(argv);}catch{
    process.stderr.write('Invalid command. Use --inspect, --bootstrap, --pin, --verify-apk, or --build; cloud build requires BOTH public IDs and --acknowledge-owned-origin.\n');
    return 2;
  }
  try{
    if(o.mode==='bootstrap'){
      // Explicit owner action: local Gradle may download dependencies and
      // create an owner-local debug keystore. Never supply cloud identifiers.
      runGradle();
      const signer=localCertificate();
      const verification=verifyCompiledApk({apkPath,signer});
      inspect();
      console.log(JSON.stringify({apk_verification:verification},null,2));
      console.log('Next: verify your local SHA-1, then run --pin once. Do not upload the keystore.');
    }else if(o.mode==='verify-apk'){
      // CI can verify the APK cryptographically without assuming Gradle's
      // ephemeral debug keystore lives under ~/.android on every runner.
      // The owner-local --build path still requires a PINNED keystore match.
      const verification=verifyCompiledApk({apkPath});
      const digest=createHash('sha256').update(readFileSync(apkPath)).digest('hex');
      console.log(JSON.stringify({result:'APK_SIGNATURE_AND_PACKAGE_VERIFIED',
        ...verification,apk_file_sha256:digest,oauth_real_device:'NOT_VERIFIED'},null,2));
    }else if(o.mode==='pin'){
      const current=localCertificate();
      const previous=loadPin();
      if(previous){
        if(!pinMatches(previous,current))throw Error('existing_signer_pin_mismatch');
        console.log('Signer already pinned; identical public certificate.');
      }else{
        mkdirSync(dirname(pinPath),{recursive:true,mode:0o700});
        // Public fingerprints only, never the keystore or password.
        writeFileSync(pinPath,JSON.stringify({schema_version:1,...current},null,2)+'\n',
          {encoding:'utf8',flag:'wx',mode:0o600});
        console.log('Owner-local signer fingerprint PINNED. Back up the PRIVATE keystore securely; do not commit it.');
      }
      inspect();
    }else if(o.mode==='build'){
      const before=localCertificate(),pinned=loadPin();
      if(!pinned||!pinMatches(pinned,before))throw Error('owner_signer_not_pinned_or_changed');
      const args=[];
      if(o.web){
        args.push('-PnarayaGoogleWebClientId='+o.web,'-PnarayaApiOrigin='+o.origin);
        console.log('Cloud public identifiers accepted as OWNER-ASSERTED. Backend/account ownership still NOT_VERIFIED.');
      }
      runGradle(args);
      const after=localCertificate();
      if(!pinMatches(pinned,after))throw Error('owner_signer_changed_during_build');
      if(!existsSync(apkPath))throw Error('debug_apk_not_found_after_build');
      const verifiedApk=verifyCompiledApk({apkPath,signer:after});
      const digest=createHash('sha256').update(readFileSync(apkPath)).digest('hex');
      console.log(JSON.stringify({
        result:'OWNER_LOCAL_DEBUG_BUILD_SUCCEEDED',package:PACKAGE,
        signer_sha1:after.sha1,signer_sha256:after.sha256,
        apk_sha256:digest,apk_path:apkPath,apk_verified_signer:verifiedApk.apk_sha256,
        apk_signature_verified_for_min_sdk_26:true,
        google_backend_login:'NOT_VERIFIED',remote_phone_off:'NOT_VERIFIED',
      },null,2));
      console.log('Debug only, not production/release signing. Do not mix with CI APKs signed by different keys.');
    }else inspect();
    return 0;
  }catch(err){
    process.stderr.write('OWNER_LOCAL_SIGNING_BLOCKED: '+(
      err instanceof Error&&/^[a-z0-9_]+$/.test(err.message)?err.message:'safe_local_check_failed')+'\n');
    return 2;
  }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  process.exitCode=runOwnerCli();
}
