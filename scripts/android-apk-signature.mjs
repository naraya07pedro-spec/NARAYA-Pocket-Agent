#!/usr/bin/env node
/**
 * Verify the ACTUAL compiled APK with the official Android SDK apksigner and
 * aapt tools. Never trust only the keystore's public certificate fingerprint.
 * No network, signing/writes, keystore export, cloud credentials or installation.
 */
import {existsSync, statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {homedir,platform} from 'node:os';
import {spawnSync} from 'node:child_process';

const PACKAGE='dev.naraya.pocketagent';
const MAX_OUTPUT=256*1024;
const CERT_PATTERN=/^[A-F0-9]{2}(?::[A-F0-9]{2})+$/;

const normalize = value => value.toUpperCase().replaceAll(':','');
const oneMatch=(lines,regex)=>{
  const all=lines.map(line=>line.match(regex)).filter(Boolean);
  if(all.length!==1)throw Error('apk_signer_metadata_invalid');
  return all[0][1];
};
export function parseVerifiedApkSignature(output){
  if(typeof output!=='string'||output.length>MAX_OUTPUT)throw Error('apk_signer_metadata_invalid');
  const lines=output.split(/\r?\n/).map(x=>x.trim());
  if(oneMatch(lines,/^Number of signers:\s*(\d+)$/)!=='1')
    throw Error('apk_multiple_or_missing_signers');
  if(!lines.some(line=>/^Verified using v2 scheme\b.*:\s*true$/.test(line)))
    throw Error('apk_v2_signature_not_verified');
  const sha256=oneMatch(lines,/^Signer #1 certificate SHA-256 digest:\s*([0-9a-fA-F]{64})$/);
  const sha1=oneMatch(lines,/^Signer #1 certificate SHA-1 digest:\s*([0-9a-fA-F]{40})$/);
  // A second signer or duplicate digest lines are never silently accepted.
  if(lines.some(line=>/^Signer #(?:[2-9]|[1-9]\d+) certificate\b/.test(line)))
    throw Error('apk_multiple_or_missing_signers');
  return {sha1:sha1.toUpperCase().match(/../g).join(':'),
    sha256:sha256.toUpperCase().match(/../g).join(':')};
}

export function parseApkPackage(output){
  if(typeof output!=='string'||output.length>MAX_OUTPUT)throw Error('apk_package_invalid');
  const names=output.split(/\r?\n/).map(s=>s.match(/^package: name='([^']+)'(?:\s|$)/))
    .filter(Boolean).map(m=>m[1]);
  if(names.length!==1 || names[0]!==PACKAGE)throw Error('apk_unexpected_package');
  return names[0];
}

export function apkSignerMatches(signer,fromApk){
  return signer?.package===PACKAGE &&
    typeof signer.sha1==='string' && CERT_PATTERN.test(signer.sha1) &&
    typeof signer.sha256==='string' && CERT_PATTERN.test(signer.sha256) &&
    normalize(signer.sha1)===normalize(fromApk?.sha1??'') &&
    normalize(signer.sha256)===normalize(fromApk?.sha256??'');
}

function sdkPath(){
  const home=process.env.ANDROID_HOME, sdk=process.env.ANDROID_SDK_ROOT;
  if(home && sdk && resolve(home)!==resolve(sdk))throw Error('android_sdk_paths_conflict');
  return home||sdk||(platform()==='win32'
    ? join(process.env.LOCALAPPDATA||join(homedir(),'AppData','Local'),'Android','Sdk')
    : join(homedir(),'Android','Sdk'));
}

function javaPath(){
  return process.env.JAVA_HOME
    ? join(process.env.JAVA_HOME,'bin',platform()==='win32'?'java.exe':'java')
    : 'java';
}

/**
 * Authoritative SDK tool status is required before parsing its metadata.
 * Fake tool text is not sufficient proof; tests inject tools ONLY to verify
 * the fail-closed parsing/decision logic, while CI executes actual SDK tools.
 */
export function verifyCompiledApk({
  apkPath,signer,sdkRoot=sdkPath(),javaExecutable=javaPath(),run=spawnSync,
}){
  if(typeof apkPath!=='string'||!existsSync(apkPath)||!statSync(apkPath).isFile()||
     statSync(apkPath).size<1024 || statSync(apkPath).size>150*1024*1024)
    throw Error('apk_file_missing_or_invalid');
  const jar=join(sdkRoot,'build-tools','36.0.0','lib','apksigner.jar');
  const aapt=join(sdkRoot,'build-tools','36.0.0',platform()==='win32'?'aapt.exe':'aapt');
  if(!existsSync(jar)||!existsSync(aapt))throw Error('android_sdk_36_build_tools_missing');
  if(!signer?.package||!signer?.sha1||!signer?.sha256)
    throw Error('owner_signer_not_available');

  const options={encoding:'utf8',timeout:20_000,maxBuffer:MAX_OUTPUT,windowsHide:true,
    shell:false};
  const signature=run(javaExecutable,[
    '-jar',jar,'verify','--verbose','--print-certs','--min-sdk-version','26',apkPath,
  ],options);
  if(signature?.error||signature?.status!==0 ||typeof signature?.stdout!=='string')
    throw Error('android_apksigner_verification_failed');
  const actual=parseVerifiedApkSignature(signature.stdout);
  if(!apkSignerMatches(signer,actual))throw Error('apk_signer_does_not_match_owner_keystore');

  const manifest=run(aapt,['dump','badging',apkPath],options);
  if(manifest?.error||manifest?.status!==0||typeof manifest?.stdout!=='string')
    throw Error('android_aapt_package_inspection_failed');
  parseApkPackage(manifest.stdout);
  return {package:PACKAGE,apk_sha1:actual.sha1,apk_sha256:actual.sha256,
    signature_verified_for_min_sdk_26:true,certificate_matches_owner_keystore:true};
}
