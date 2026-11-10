import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readSourceSnapshot,auditSource} from '../scripts/release-preflight.mjs';

const snapshot=()=>readSourceSnapshot();
const audit=s=>auditSource(s);
const clone=()=>structuredClone(snapshot());
const failures=result=>result.checks.filter(c=>c.status==='FAIL').map(c=>c.id);
const bin=fileURLToPath(new URL('../scripts/release-preflight.mjs',import.meta.url));

test('checked-in offline source is safe but REMOTE BLOCKED, with no attempted Cloudflare access',()=>{
  const result=audit(snapshot());
  assert.equal(result.source_safety,'PASS',failures(result).join(', '));
  assert.equal(result.remote_readiness,'BLOCKED');
  assert.equal(result.approved_live_deployment,false);
  assert.ok(result.remote_blockers.includes('worker_has_no_public_https_route'));
  assert.ok(result.remote_blockers.includes('remote_d1_id_not_configured'));
  assert.ok(result.remote_blockers.some(v=>v.includes('billing')));
  assert.equal(result.checks.length,13);
  assert.ok(result.checks.every(c=>c.status==='PASS'));
  assert.equal(result.side_effects.startsWith('NONE'),true);
});

test('preflight rejects Cron accidentally enabled by config or unguarded Worker entrypoint',()=>{
  for(const mode of ['true','1']){
    const s=clone();s.prod.vars={SCHEDULER_ENABLED:mode};
    assert.ok(failures(audit(s)).includes('global_cron_kill_switch'));
  }
  const s=clone();s.workerIndex=s.workerIndex.replace("env.SCHEDULER_ENABLED !== 'true'",'false');
  assert.ok(failures(audit(s)).includes('global_cron_kill_switch'));
  const m=clone();m.prod.vars={MOBILE_SCHEDULING_ENABLED:'true'};
  assert.ok(failures(audit(m)).includes('mobile_activation_default_off'));
});

test('preflight detects accidental public routes and schedule expansion',()=>{
  const a=clone();a.prod.workers_dev=true;
  assert.ok(failures(audit(a)).includes('no_implicit_public_route'));
  const b=clone();b.prod.routes=['example.com/*'];
  assert.ok(failures(audit(b)).includes('no_implicit_public_route'));
  const c=clone();c.prod.triggers.crons.push('*/1 * * * *');
  assert.ok(failures(audit(c)).includes('cron_cadence_fixed'));
});

test('preflight refuses missing/reordered migrations and forged local D1 fixture',()=>{
  const a=clone();a.migrations=a.migrations.filter(x=>!x.startsWith('0004_'));
  assert.ok(failures(audit(a)).includes('additive_schema_chain'));
  const b=clone();b.migration0004=b.migration0004.replace('ADD COLUMN budget_claims','ADD COLUMN not_budget');
  assert.ok(failures(audit(b)).includes('additive_schema_chain'));
  const c=clone();c.prod.d1_databases[0].migrations_dir='wrong_migrations';
  assert.ok(failures(audit(c)).includes('d1_binding_and_migration_root'));
  const d=clone();d.local.d1_databases[0].database_id='11111111-1111-1111-1111-111111111111';
  assert.ok(failures(audit(d)).includes('isolated_local_fake_database'));
});

test('preflight blocks secrets in public config, unattended deployment and Android auth defaults',()=>{
  const a=clone();a.prod.vars={OWNER_API_TOKEN:'unsafe-value-not-used'};
  assert.ok(failures(audit(a)).includes('no_literal_secret_vars'));
  const b=clone();b.workflows={'danger.yml':'steps:\n  - run: npx wrangler deploy\n'};
  assert.ok(failures(audit(b)).includes('no_automatic_cloudflare_mutation_workflow'));
  const c=clone();c.androidGradle=c.androidGradle.replace(
    'gradleProperty("narayaApiOrigin").orElse("")','gradleProperty("narayaApiOrigin").orElse("https://untrusted.invalid")');
  assert.ok(failures(audit(c)).includes('android_public_configuration_off_by_default'));
});

test('a future HTTPS route and real-looking D1 UUID still cannot certify account or physical acceptance',()=>{
  const s=clone();
  s.prod.workers_dev=true;
  s.prod.d1_databases[0].database_id='11111111-1111-4111-8111-111111111111';
  const result=audit(s);
  assert.equal(result.remote_readiness,'BLOCKED');
  assert.ok(result.remote_blockers.some(x=>x.includes('account_plan')));
  assert.ok(result.remote_blockers.some(x=>x.includes('physical_phone')));
});

test('CLI default is offline-safe, --json machine readable and --require-remote fails closed',()=>{
  const normal=spawnSync(process.execPath,[bin],{encoding:'utf8',timeout:10000});
  assert.equal(normal.status,0,normal.stderr);
  assert.match(normal.stdout,/Remote deployment status: BLOCKED/);
  assert.doesNotMatch(normal.stdout,/SOURCE_AUDIT_FAILED/);
  const json=spawnSync(process.execPath,[bin,'--json'],{encoding:'utf8',timeout:10000});
  assert.equal(json.status,0,json.stderr);
  assert.equal(JSON.parse(json.stdout).remote_readiness,'BLOCKED');
  const remote=spawnSync(process.execPath,[bin,'--require-remote'],{encoding:'utf8',timeout:10000});
  assert.equal(remote.status,2,remote.stderr);
  assert.match(remote.stdout,/BLOCKED/);
  const bad=spawnSync(process.execPath,[bin,'--execute-deploy'],{encoding:'utf8',timeout:10000});
  assert.equal(bad.status,64);
});



test('pilot template is inert and no future change can silently activate Cron or contain real D1',()=>{
  for(const mutate of [
    p=>p.triggers.crons.push('*/1 * * * *'),
    p=>p.vars.SCHEDULER_ENABLED='true',
    p=>p.vars.MOBILE_SCHEDULING_ENABLED='true',
    p=>p.d1_databases[0].database_id='11111111-1111-4111-8111-111111111111',
    p=>p.name='real-worker-name',
  ]){
    const s=clone();
    mutate(s.pilot);
    assert.ok(failures(audit(s)).includes('inert_approval_only_pilot_template'));
  }
});


test('preflight rejects mobile activation if either global gate or budget migration guard is removed',()=>{
  const mutate=[
    s=>{s.schedulerEligibility=s.schedulerEligibility.replace(
      "env.SCHEDULER_ENABLED === 'true'","true");},
    s=>{s.schedulerEligibility=s.schedulerEligibility.replace(
      "env.MOBILE_SCHEDULING_ENABLED === 'true'","true");},
    s=>{s.mobileSync=s.mobileSync.replace(
      "status === 'ACTIVE' && !mobileSchedulerConfigured(env)",
      "status === 'ACTIVE' && false");},
    s=>{s.mobileSync=s.mobileSync.replace(
      "status === 'ACTIVE' && !await schedulerBudgetReady(env)",
      "status === 'ACTIVE' && false");},
    s=>{s.mobileSync=s.mobileSync.replace(
      "schedulerEligible: row.status === 'ACTIVE' && !!env && mobileSchedulerConfigured(env)",
      "schedulerEligible: row.status === 'ACTIVE'");},
  ];
  for (const update of mutate){
    const s=clone();update(s);
    assert.ok(failures(audit(s)).includes('mobile_activation_requires_both_flags_and_migrated_d1'));
  }
});


test('preflight rejects Android client and UI regressions that hide Cron eligibility or D1 failures',()=>{
  const mutators=[
    s=>{s.androidCloudClient=s.androidCloudClient.replace('obj.get("schedulerEligible")','false');},
    s=>{s.androidCloudClient=s.androidCloudClient.replace('obj.get("scheduled")','false');},
    s=>{s.androidCloudClient=s.androidCloudClient.replace(
      'fun CloudMonitor.executionSummary()','fun CloudMonitor.somethingElse()');},
    s=>{s.androidCloudClient=s.androidCloudClient.replace(
      'fun CloudMonitor.withConfirmedStatus(','fun CloudMonitor.uncheckedStatus(');},
    s=>{s.androidCloudClient=s.androidCloudClient.replace(
      '"scheduler_storage_unavailable"','"unavailable_without_actionable_code"');},
    s=>{s.androidMainActivity=s.androidMainActivity.replace(
      'remote.executionSummary()','remote.status');},
    s=>{s.androidMainActivity=s.androidMainActivity.replace(
      'previous.withConfirmedStatus(outcome)','previous');},
    s=>{s.androidMainActivity=s.androidMainActivity.replace(
      'SyncFailure.SCHEDULER_STORAGE_UNAVAILABLE','SyncFailure.UNAVAILABLE');},
  ];
  for(const mutate of mutators){
    const s=clone();mutate(s);
    assert.ok(failures(audit(s)).includes('android_cloud_execution_is_not_inferred_from_active'));
  }
});
