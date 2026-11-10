#!/usr/bin/env node
/**
 * P1-I OFFLINE release preflight. Performs ZERO network/API/deployment/secret
 * access. Source-safety checks are NOT a Cloudflare billing, OAuth, or
 * production-runtime certification. --require-remote intentionally refuses
 * to certify readiness without independent owner/provider evidence.
 */
import {readFileSync, readdirSync} from 'node:fs';
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_MIGRATIONS=[
  '0001_initial.sql',
  '0002_mobile_identity_sync.sql',
  '0003_scheduler_control.sql',
  '0004_global_scheduler_budget.sql',
  '0005_observation_event_sequence.sql',
];
const READ_ONLY_ORIGINS=['https://api.github.com'];

const text=(base,path)=>readFileSync(join(base,path),'utf8');
const json=(base,path)=>JSON.parse(text(base,path));

export function readSourceSnapshot(base=root){
  const dir=join(base,'.github','workflows');
  const workflows=Object.fromEntries(
    readdirSync(dir).filter(x=>/\.ya?ml$/i.test(x))
      .map(name=>[name,text(base,'.github/workflows/'+name)]),
  );
  const migrations=readdirSync(join(base,'worker','migrations'))
    .filter(name=>name.endsWith('.sql')).sort();
  return {
    prod:json(base,'worker/wrangler.jsonc'),
    local:json(base,'worker/wrangler.local.jsonc'),
    pilot:json(base,'worker/wrangler.pilot.example.jsonc'),
    migrations,
    migration0004:text(base,'worker/migrations/0004_global_scheduler_budget.sql'),
    migration0005:text(base,'worker/migrations/0005_observation_event_sequence.sql'),
    schedulerSource:text(base,'worker/src/scheduler.ts'),
    workerIndex:text(base,'worker/src/index.ts'),
    schedulerEligibility:text(base,'worker/src/scheduler-eligibility.ts'),
    mobileSync:text(base,'worker/src/mobile-sync.ts'),
    workerTypes:text(base,'worker/src/types.ts'),
    androidGradle:text(base,'android/app/build.gradle.kts'),
    androidCloudClient:text(base,'android/app/src/main/java/dev/naraya/pocketagent/CloudSyncClient.kt'),
    androidMainActivity:text(base,'android/app/src/main/java/dev/naraya/pocketagent/MainActivity.kt'),
    workflows,
  };
}

function hasPublicRoute(conf){
  return conf.workers_dev === true ||
    Boolean(conf.route) ||
    (Array.isArray(conf.routes) && conf.routes.length>0) ||
    (Array.isArray(conf.custom_domains) && conf.custom_domains.length>0);
}
function isFakeDbId(id){
  return typeof id==='string' && /^0{8}-0{4}-0{4}-0{4}-0{11}[0-9a-f]$/i.test(id);
}
function prodD1(s){
  const db=s.prod.d1_databases;
  return Array.isArray(db) && db.length===1 ? db[0] : null;
}
function migrationChainValid(s){
  return s.migrations.length===EXPECTED_MIGRATIONS.length &&
    s.migrations.every((name,i)=>name===EXPECTED_MIGRATIONS[i]) &&
    /\bADD COLUMN budget_window_start\b/.test(s.migration0004) &&
    /\bADD COLUMN budget_claims\b/.test(s.migration0004) &&
    /ADD COLUMN event_sequence INTEGER/.test(s.migration0005) &&
    /UPDATE observations SET event_sequence = rowid/.test(s.migration0005) &&
    /UNIQUE INDEX/.test(s.migration0005);
}
function stringRiskInVars(conf){
  const vars=conf.vars??{};
  if(vars===null||typeof vars!=='object'||Array.isArray(vars))return true;
  return Object.keys(vars).some(name=>/^(OWNER_API_TOKEN|CLOUDFLARE_API_TOKEN|GOOGLE_CLIENT_SECRET|OIDC_CLIENT_SECRET)$/i.test(name));
}
function noAutomaticDeployWorkflow(s){
  const dangerous=/\bwrangler(?:@\d+(?:\.\d+)*)?\s+(?:deploy|publish)\b|\bcloudflare\/wrangler-action\b|\bwrangler\s+d1\s+(?:create|delete|migrations\s+apply)\b/i;
  return Object.values(s.workflows).every(source=>!dangerous.test(source));
}
const check=(id,passed)=>({id,status:passed?'PASS':'FAIL'});

export function auditSource(s){
  const d=prodD1(s);
  const checks=[
    check('global_cron_kill_switch',s.workerTypes.includes('SCHEDULER_ENABLED?: string') &&
      /env\.SCHEDULER_ENABLED !== 'true'/.test(s.workerIndex) &&
      !/^(true|1)$/i.test(String(s.prod.vars?.SCHEDULER_ENABLED??''))),
    check('mobile_activation_default_off',
      !/^(true|1)$/i.test(String(s.prod.vars?.MOBILE_SCHEDULING_ENABLED??''))),
    check('no_implicit_public_route',s.prod.workers_dev===false && !hasPublicRoute(s.prod)),
    check('mobile_activation_requires_both_flags_and_migrated_d1',
      /env\.SCHEDULER_ENABLED === 'true'/.test(s.schedulerEligibility) &&
      /env\.MOBILE_SCHEDULING_ENABLED === 'true'/.test(s.schedulerEligibility) &&
      /typeof env\.OWNER_ID === 'string'/.test(s.schedulerEligibility) &&
      /schedulerEligible: row.status === 'ACTIVE' && !!env && mobileSchedulerConfigured\(env\)/.test(s.mobileSync) &&
      /status === 'ACTIVE' && !mobileSchedulerConfigured\(env\)/.test(s.mobileSync) &&
      /status === 'ACTIVE' && !await schedulerBudgetReady\(env\)/.test(s.mobileSync)),
    check('cron_cadence_fixed',Array.isArray(s.prod.triggers?.crons) &&
      s.prod.triggers.crons.length===1 && s.prod.triggers.crons[0]==='*/15 * * * *'),
    check('d1_binding_and_migration_root',Boolean(d && d.binding==='DB' &&
      d.migrations_dir==='migrations' && d.database_name==='naraya-pocket-agent')),
    check('additive_schema_chain',migrationChainValid(s)),
    check('isolated_local_fake_database',s.local.name!=='naraya-pocket-agent' &&
      s.local.workers_dev===false && isFakeDbId(s.local.d1_databases?.[0]?.database_id) &&
      s.local.d1_databases?.[0]?.database_name!==d?.database_name),
    check('no_literal_secret_vars',!stringRiskInVars(s.prod) && !stringRiskInVars(s.local) &&
      !stringRiskInVars(s.pilot)),
    check('inert_approval_only_pilot_template',
      s.pilot.workers_dev===true && Array.isArray(s.pilot.triggers?.crons) &&
      s.pilot.triggers.crons.length===0 &&
      s.pilot.vars?.SCHEDULER_ENABLED==='false' &&
      s.pilot.vars?.MOBILE_SCHEDULING_ENABLED==='false' &&
      s.pilot.d1_databases?.length===1 &&
      s.pilot.d1_databases[0].binding==='DB' &&
      s.pilot.d1_databases[0].migrations_dir==='migrations' &&
      s.pilot.d1_databases[0].database_id==='REPLACE_WITH_OWNER_APPROVED_D1_UUID' &&
      s.pilot.name.includes('REPLACE_ME')),
    check('no_automatic_cloudflare_mutation_workflow',noAutomaticDeployWorkflow(s)),
    check('android_cloud_execution_is_not_inferred_from_active',
      /obj.get\("schedulerEligible"\)/.test(s.androidCloudClient) &&
      /obj.get\("scheduled"\)/.test(s.androidCloudClient) &&
      /status == "PAUSED" && \(eligibility \|\| scheduling\)/.test(s.androidCloudClient) &&
      /fun CloudMonitor.executionSummary\(\)/.test(s.androidCloudClient) &&
      /fun CloudMonitor.withConfirmedStatus\(/.test(s.androidCloudClient) &&
      /"scheduler_storage_unavailable"/.test(s.androidCloudClient) &&
      // Both the cloud-monitor list and the local-draft mapping must convey
      // the last-known execution eligibility, not just one of them.
      s.androidMainActivity.split('remote.executionSummary()').length === 3 &&
      s.androidMainActivity.includes('previous.withConfirmedStatus(outcome)') &&
      s.androidMainActivity.includes('SyncFailure.SCHEDULER_STORAGE_UNAVAILABLE')),
    check('android_observation_timeline_chain_guard',
      s.androidCloudClient.includes('coherentObservationHistory(rows: List<CloudObservation>)') &&
      s.androidCloudClient.includes('newer.previousSha != older.headSha') &&
      s.androidCloudClient.includes('rows.count { it.type == "BASELINE" } > 1') &&
      s.androidCloudClient.includes('newer.eventSequence <= older.eventSequence') &&
      s.androidCloudClient.includes('if (!coherentObservationHistory(output))')),
    check('durable_observation_sequence_contract',
      s.mobileSync.includes('o.event_sequence') &&
      s.mobileSync.includes('ORDER BY o.event_sequence DESC') &&
      s.schedulerSource.includes('COALESCE((SELECT MAX(event_sequence) FROM observations),0)+1') &&
      s.androidCloudClient.includes('item.get("event_sequence")') &&
      s.androidCloudClient.includes('eventSequence >= output.last().eventSequence')),
    check('android_public_configuration_off_by_default',
      /gradleProperty\("narayaGoogleWebClientId"\)\.orElse\(""\)/.test(s.androidGradle) &&
      /gradleProperty\("narayaApiOrigin"\)\.orElse\(""\)/.test(s.androidGradle)),
  ];
  const sourceSafe=checks.every(c=>c.status==='PASS');
  const blockers=[
    ...(!hasPublicRoute(s.prod)?['worker_has_no_public_https_route']:[]),
    ...(!d?.database_id||isFakeDbId(d?.database_id)?['remote_d1_id_not_configured']:[]),
    'real_google_oauth_issuer_audience_and_signed_android_token_unverified',
    'cloudflare_account_plan_quota_cpu_and_billing_not_inspected',
    'owner_authorization_and_real_deployment_not_given',
    'physical_phone_off_and_remote_cron_not_measured',
  ];
  return {
    stage:'P1-M',
    evidence_class:'OFFLINE_SOURCE_AUDIT_ONLY',
    source_safety:sourceSafe?'PASS':'FAIL',
    checks,
    remote_readiness:'BLOCKED',
    remote_blockers:blockers,
    side_effects:'NONE: no network, cloud resource, external write, account or credential access',
    approved_live_deployment:false,
    external_github_api_hosts_approved:READ_ONLY_ORIGINS,
  };
}

export function runCli(argv=process.argv.slice(2)){
  const flags=new Set(argv);
  if([...flags].some(f=>!['--json','--require-remote'].includes(f))){
    process.stderr.write('Usage: node scripts/release-preflight.mjs [--json] [--require-remote]\n');
    return 64;
  }
  let result;
  try { result=auditSource(readSourceSnapshot()); }
  catch {
    process.stderr.write('SOURCE_AUDIT_FAILED: cannot parse/read required source or migration files\n');
    return 1;
  }
  if(flags.has('--json')) process.stdout.write(JSON.stringify(result,null,2)+'\n');
  else {
    process.stdout.write('P1-M offline source checks: '+result.source_safety+'\n');
    for(const c of result.checks) process.stdout.write('  '+c.status+' '+c.id+'\n');
    process.stdout.write('Remote deployment status: '+result.remote_readiness+
      ' (account/provider/device evidence absent; no deployment attempted)\n');
    for(const blocked of result.remote_blockers)process.stdout.write('  BLOCKED '+blocked+'\n');
  }
  if(result.source_safety!=='PASS')return 1;
  if(flags.has('--require-remote'))return 2;
  return 0;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  process.exitCode=runCli();
}
