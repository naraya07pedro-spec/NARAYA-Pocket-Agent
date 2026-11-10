#!/usr/bin/env node
/**
 * P1-U: OFFLINE ONLY, no network, secret access, scheduling or cloud writes.
 * Checks internal consistency of an owner-supplied observation package.
 * It NEVER authenticates Cloudflare, Google, device power state or GitHub.
 * Structured, self-reported evidence CANNOT qualify as remote acceptance.
 */
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SHA = /^[a-f0-9]{40}$/;
const REF = /^[A-Za-z0-9_-]{8,80}$/;
const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const REMOTE_UNVERIFIED = 'NOT_VERIFIED';

const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) &&
  Object.getPrototypeOf(v) === Object.prototype;
const exact = (v,keys) => plain(v) &&
  Object.keys(v).length === keys.length &&
  keys.every(k=>Object.prototype.hasOwnProperty.call(v,k));
const positiveTime = v => Number.isSafeInteger(v) && v > 0;
const nonNegativeInt = v => Number.isSafeInteger(v) && v >= 0;
const result = checks => ({
  schema:'offdevice-evidence-v2',
  structural_consistency:checks.every(c=>c.status==='PASS')?'PASS':'FAIL',
  remote_acceptance:REMOTE_UNVERIFIED,
  independent_origin_verification:'NOT_PERFORMED',
  physical_device_verification:'NOT_PERFORMED',
  cloudflare_account_quota_and_billing:'NOT_VERIFIED',
  safe_to_activate_scheduler:false,
  checks,
  // Do not echo any source identifiers, timestamps, paths or user-provided text.
  limitations:['owner_supplied_data_not_independently_authenticated',
    'owner_supplied_cron_and_d1_id_correlation_is_not_authenticated',
    'no_cloudflare_oauth_or_physical_device_access'],
});

export function assessOffDeviceEvidence(bundle) {
  const checks=[];
  const add=(id,ok)=>{checks.push({id,status:ok?'PASS':'FAIL'});};
  add('exact_top_level_schema',exact(bundle,[
    'schemaVersion','evidenceClass','monitorId','release','device',
    'cloudflare','postRestart','github',
  ]));
  if(!plain(bundle))return result(checks);
  add('declared_unverified_source',bundle.schemaVersion===2 &&
    bundle.evidenceClass==='OWNER_SUPPLIED_UNVERIFIED');
  add('monitor_uuid',typeof bundle.monitorId==='string' && UUID.test(bundle.monitorId));
  const release=bundle.release,device=bundle.device,cloud=bundle.cloudflare;
  const post=bundle.postRestart,github=bundle.github;
  add('release_metadata_shape',exact(release,[
    'sourceSha','migrationVersions','approvalRef','accountReviewAt','oauthReviewAt',
  ]) &&
    SHA.test(release.sourceSha) &&
    Array.isArray(release.migrationVersions) &&
    JSON.stringify(release.migrationVersions)==='[1,2,3,4,5]' &&
    REF.test(release.approvalRef) &&
    positiveTime(release.accountReviewAt) && positiveTime(release.oauthReviewAt));
  add('device_window_shape',exact(device,['powerOffAt','powerOnAt','evidenceRef']) &&
    positiveTime(device.powerOffAt) && positiveTime(device.powerOnAt) &&
    REF.test(device.evidenceRef) && device.powerOnAt-device.powerOffAt>=30*60_000 &&
    device.powerOnAt-device.powerOffAt<=24*60*60_000);
  add('cloudflare_samples_shape',exact(cloud,['cronEvents','observations']) &&
    Array.isArray(cloud.cronEvents) && cloud.cronEvents.length>=1 && cloud.cronEvents.length<=48 &&
    Array.isArray(cloud.observations) && cloud.observations.length>=2 &&
    cloud.observations.length<=50);
  add('postrestart_signed_read_shape',exact(post,['signedReadAt','observedIds']) &&
    positiveTime(post.signedReadAt) && Array.isArray(post.observedIds) &&
    post.observedIds.length>=1 && post.observedIds.length<=50 &&
    post.observedIds.every(x=>typeof x==='string' && UUID.test(x)) &&
    new Set(post.observedIds).size===post.observedIds.length);
  add('github_corroboration_shape',exact(github,['repository','shaChecks']) &&
    typeof github.repository==='string' && REPOSITORY.test(github.repository) &&
    !github.repository.includes('..') && !github.repository.endsWith('.') &&
    Array.isArray(github.shaChecks) && github.shaChecks.length>=1 && github.shaChecks.length<=10 &&
    github.shaChecks.every(x=>exact(x,['sha','checkedAt']) &&
      typeof x.sha==='string' && SHA.test(x.sha) && positiveTime(x.checkedAt)));
  // Never accept a manifest that silently smuggles credentials, bearer text
  // or arbitrary extra fields, even if its common checks look plausible.
  const cron=Array.isArray(cloud?.cronEvents)?cloud.cronEvents:[];
  const observations=Array.isArray(cloud?.observations)?cloud.observations:[];
  add('cron_log_record_shapes',cron.length>0 && cron.every(x=>
    exact(x,['recordedAt','event','completed','observations','observationIds']) &&
    positiveTime(x.recordedAt) && x.event==='scheduled_tick' &&
    nonNegativeInt(x.completed) && x.completed<=3 &&
    nonNegativeInt(x.observations) && x.observations<=x.completed &&
    // The Worker logs exactly the IDs of D1 rows confirmed inserted in
    // this tick. This is a correlation field, NOT an authentication proof.
    Array.isArray(x.observationIds) && x.observationIds.length===x.observations &&
    x.observationIds.every(id=>typeof id==='string' && UUID.test(id)) &&
    new Set(x.observationIds).size===x.observationIds.length));
  add('d1_observation_record_shapes',observations.length>=2 && observations.every(x=>
    exact(x,['id','monitor_id','event_type','previous_sha','head_sha','observed_at','event_sequence']) &&
    typeof x.id==='string' && UUID.test(x.id) &&
    x.monitor_id===bundle.monitorId && typeof x.head_sha==='string' && SHA.test(x.head_sha) &&
    positiveTime(x.observed_at) && Number.isSafeInteger(x.event_sequence) && x.event_sequence>0 &&
    (x.event_type==='BASELINE' ? x.previous_sha===null :
      x.event_type==='CHANGE' && typeof x.previous_sha==='string' && SHA.test(x.previous_sha) &&
      x.previous_sha!==x.head_sha)));
  const ids=observations.map(x=>x?.id);
  add('unique_observation_identity',new Set(ids).size===ids.length);
  let linked=true;
  for(let i=0;i<observations.length-1;i++){
    const newer=observations[i],older=observations[i+1];
    if(!newer || !older || !Number.isSafeInteger(newer.event_sequence) ||
      !Number.isSafeInteger(older.event_sequence) ||
      newer.event_sequence<=older.event_sequence ||
      newer.event_type!=='CHANGE' || newer.previous_sha!==older.head_sha)linked=false;
  }
  const baselinePositions=observations.map((x,i)=>x?.event_type==='BASELINE'?i:-1).filter(i=>i>=0);
  add('durable_sequence_sha_linkage',linked &&
    baselinePositions.length<=1 &&
    (baselinePositions.length===0||baselinePositions[0]===observations.length-1));

  const start=device?.powerOffAt,end=device?.powerOnAt,synced=post?.signedReadAt;
  const offWindow=positiveTime(start)&&positiveTime(end)&&end>start;
  const changesDuringOff=observations.filter(x=>x?.event_type==='CHANGE'&&offWindow &&
    positiveTime(x.observed_at)&&x.observed_at>start&&x.observed_at<end);
  add('change_persisted_inside_off_window',changesDuringOff.length>0);
  const offCron=cron.filter(x=>offWindow && positiveTime(x?.recordedAt) &&
    x.recordedAt>start && x.recordedAt<end && x.event==='scheduled_tick' &&
    x.completed>=1 && x.observations>=1);
  add('cron_log_during_off_window',offCron.length>0);
  add('cron_d1_exact_observation_id_correlation',changesDuringOff.length>0 &&
    changesDuringOff.every(obs=>offCron.some(t=>
      Array.isArray(t.observationIds) && t.observationIds.includes(obs.id))));
  add('cron_and_d1_timestamps_plausibly_align',changesDuringOff.some(obs=>
    offCron.some(t=>Array.isArray(t.observationIds) &&
      t.observationIds.includes(obs.id) &&
      Math.abs(obs.observed_at-t.recordedAt)<=60_000)));
  add('release_and_recovery_timing',positiveTime(synced)&&offWindow &&
    synced>end && positiveTime(release?.accountReviewAt) &&
    release.accountReviewAt<start && positiveTime(release?.oauthReviewAt) &&
    release.oauthReviewAt<start);
  const returning=new Set(Array.isArray(post?.observedIds)?post.observedIds:[]);
  add('postrestart_signed_read_includes_offline_change',
    changesDuringOff.some(x=>returning.has(x.id)));
  const gitChecks=Array.isArray(github?.shaChecks)?github.shaChecks:[];
  add('github_sha_observation_corroboration',changesDuringOff.some(x=>
    gitChecks.some(g=>g?.sha===x.head_sha && positiveTime(g.checkedAt) &&
      positiveTime(synced) && g.checkedAt>=x.observed_at && g.checkedAt<=synced)));
  return result(checks);
}

function cli(args) {
  const json=args.includes('--json');
  const requireRemote=args.includes('--require-remote');
  const fileArg=args.indexOf('--file');
  if(args.some(x=>!['--json','--require-remote','--file'].includes(x) &&
    (fileArg<0 || args[fileArg+1]!==x)) || fileArg<0 ||
    fileArg!==args.lastIndexOf('--file') || !args[fileArg+1] ||
    args.length!==2+Number(json)+Number(requireRemote)){
    process.stderr.write('Usage: node scripts/offdevice-evidence-gate.mjs --file PRIVATE_JSON [--json] [--require-remote]\n');
    process.exitCode=64;
    return;
  }
  let value;
  try{
    // No network, and do not echo paths/errors. Private manifests must stay
    // outside the repository and GitHub Actions artifacts.
    const raw=readFileSync(args[fileArg+1]);
    if(raw.byteLength>65_536)throw new Error('oversized_evidence');
    value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  }catch{
    process.stdout.write(json?JSON.stringify(result([{id:'evidence_unreadable_or_oversize',status:'FAIL'}]))+'\n':
      'Evidence could not be read or is invalid. No remote verification performed.\n');
    process.exitCode=1;return;
  }
  const assessment=assessOffDeviceEvidence(value);
  if(json)process.stdout.write(JSON.stringify(assessment)+'\n');
  else process.stdout.write('Evidence structural consistency: '+assessment.structural_consistency+
    '\nRemote acceptance: NOT_VERIFIED (independent owner/provider/device checks required)\n'+
    assessment.checks.filter(x=>x.status==='FAIL').map(x=>x.id).join('\n')+'\n');
  process.exitCode=assessment.structural_consistency==='PASS'?(requireRemote?2:0):1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)cli(process.argv.slice(2));
