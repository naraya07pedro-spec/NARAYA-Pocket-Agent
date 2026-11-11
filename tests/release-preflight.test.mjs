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
  assert.equal(result.checks.length,23);
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

test('P1-Z sign-out handles the actual AndroidX ClearCredentialException, not GetCredentialException',()=>{
  const s=clone();
  const check='android_google_logout_catches_clear_credential_exception';
  assert.ok(!failures(audit(s)).includes(check));
  s.androidGoogleIdentity=s.androidGoogleIdentity.replace(
    'catch (_: ClearCredentialException) {',
    'catch (_: GetCredentialException) {',
  );
  assert.ok(failures(audit(s)).includes(check));
  const missing=clone();
  missing.androidGoogleIdentity=missing.androidGoogleIdentity.replace(
    'import androidx.credentials.exceptions.ClearCredentialException','',
  );
  assert.ok(failures(audit(missing)).includes(check));
});

test('P1-AB: source preflight blocks bypass or removal of actual built APK verifier',()=>{
  const snapshot=clone();
  assert.ok(!failures(audit(snapshot)).includes(
    'android_ci_requires_real_apk_signature_and_package_verification'));
  const removed=clone();
  removed.workflows['android.yml']=removed.workflows['android.yml'].replace(
    'run: node scripts/android-owner-pilot.mjs --verify-apk',
    'run: echo bypassed',
  );
  assert.ok(failures(audit(removed)).includes(
    'android_ci_requires_real_apk_signature_and_package_verification'));
});

test('P2-C static gate refuses external fetch, disabled lease fencing and missing task quota',()=>{
  const check='p2c_runtime_durable_manual_fenced_no_provider_dispatch';
  const base=clone();
  assert.ok(!failures(audit(base)).includes(check));
  const mutations=[
    s=>{s.taskRuntimeSource=s.taskRuntimeSource.replace(
      'const MAX_STEPS_PER_HOUR=12','const MAX_STEPS_PER_HOUR=999999');},
    s=>{s.taskRuntimeSource=s.taskRuntimeSource.replaceAll(
      'AND t.version=?','AND 1=1');},
    s=>{s.taskRuntimeSource += ' fetch("https://untrusted.invalid");';},
    s=>{s.workerIndex=s.workerIndex.replace(
      'return await taskRuntimeRoute(request,env,pathname)',
      'return json({pretend:true})');},
    s=>{s.migration0008=s.migration0008.replace(
      'CREATE TABLE IF NOT EXISTS task_step_budgets',
      'CREATE TABLE IF NOT EXISTS fake_budgets');},
  ];
  for(const mutate of mutations){
    const s=clone();mutate(s);
    assert.ok(failures(audit(s)).includes(check));
  }
});

test('P2-D static gate blocks adding network provider dispatch or deleting immutable effect guards',()=>{
  const check='p2d_task_bound_effects_inert_immutable_and_approval_cas';
  assert.ok(!failures(audit(snapshot())).includes(check));
  const attacks=[
    s=>{s.taskApprovalSource+=' fetch("https://provider.invalid");';},
    s=>{s.taskApprovalSource=s.taskApprovalSource.replace(
      "task.status!=='SUCCEEDED'","false");},
    s=>{s.taskApprovalSource=s.taskApprovalSource.replaceAll(
      'eligibleForDispatch:false','eligibleForDispatch:true');},
    s=>{s.migration0009=s.migration0009.replace(
      'CREATE TRIGGER IF NOT EXISTS task_effect_no_retarget',
      'CREATE TRIGGER IF NOT EXISTS removed_immutability');},
    s=>{s.workerIndex=s.workerIndex.replace(
      'return await taskApprovalRoute(request,env,pathname)',
      'return json({pretend:true})');},
  ];
  for(const mutate of attacks){
    const s=clone();mutate(s);
    assert.ok(failures(audit(s)).includes(check));
  }
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
  const a=clone();a.migrations=a.migrations.filter(x=>!x.startsWith('0005_'));
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
    s=>{s.androidMainActivity=s.androidMainActivity.replace(
      'migrations 0001–0005','migrations 0001–0004');},
  ];
  for(const mutate of mutators){
    const s=clone();mutate(s);
    assert.ok(failures(audit(s)).includes('android_cloud_execution_is_not_inferred_from_active'));
  }
});


test('P1-L preflight rejects removed observation SHA linkage or unsafe tie assumption',()=>{
  const sources=[
    s=>{s.androidCloudClient=s.androidCloudClient.replace(
      'if (!coherentObservationHistory(output))','if (false)');},
    s=>{s.androidCloudClient=s.androidCloudClient.replace(
      'newer.previousSha != older.headSha','false');},
    s=>{s.androidCloudClient=s.androidCloudClient.replace(
      'rows.count { it.type == "BASELINE" } > 1','false');},
    s=>{s.androidCloudClient=s.androidCloudClient.replace(
      'newer.eventSequence <= older.eventSequence','false');},
  ];
  for(const mutate of sources){
    const snapshot=clone();mutate(snapshot);
    assert.ok(failures(audit(snapshot)).includes('android_observation_timeline_chain_guard'));
  }
});


test('P1-M preflight rejects missing migration or faked durable event ordering',()=>{
  const mutators=[
    s=>{s.migration0005=s.migration0005.replace('UPDATE observations SET event_sequence = rowid','');},
    s=>{s.migration0005=s.migration0005.replace('CREATE UNIQUE INDEX','CREATE INDEX');},
    s=>{s.mobileSync=s.mobileSync.replace('ORDER BY o.event_sequence DESC','ORDER BY o.observed_at DESC');},
    s=>{s.schedulerSource=s.schedulerSource.replace('COALESCE((SELECT MAX(event_sequence) FROM observations),0)+1','NULL');},
    s=>{s.androidCloudClient=s.androidCloudClient.replace('item.get("event_sequence")','item.get("observed_at")');},
    s=>{s.androidCloudClient=s.androidCloudClient.replace('eventSequence >= output.last().eventSequence','false');},
  ];
  for(const mutation of mutators){
    const s=clone();mutation(s);
    assert.equal(audit(s).source_safety,'FAIL');
  }
});


test('P1-N source gate refuses an owner-supplied manifest being promoted to verified/cloud-enabled',()=>{
  const changes=[
    s=>{s.offdeviceEvidenceGate=s.offdeviceEvidenceGate.replace(
      "const REMOTE_UNVERIFIED = 'NOT_VERIFIED'","const REMOTE_UNVERIFIED = 'VERIFIED'");},
    s=>{s.offdeviceEvidenceGate=s.offdeviceEvidenceGate.replace(
      'safe_to_activate_scheduler:false','safe_to_activate_scheduler:true');},
    s=>{s.offdeviceEvidenceGate=s.offdeviceEvidenceGate.replace(
      'remote_acceptance:REMOTE_UNVERIFIED','remote_acceptance:"VERIFIED"');},
    s=>{s.offdeviceEvidenceGate=s.offdeviceEvidenceGate.replace(
      'requireRemote?2:0','requireRemote?0:0');},
    s=>{s.offdeviceEvidenceGate=s.offdeviceEvidenceGate.replace(
      'raw.byteLength>65_536','false');},
  ];
  for(const mutate of changes){
    const s=clone();mutate(s);
    assert.ok(failures(audit(s)).includes('owner_evidence_can_never_certify_remote_or_activate'));
  }
});


test('P1-O source guard rejects regressed identity registration before path/body prevalidation',()=>{
  const bad=[
    s=>{s.mobileSync=s.mobileSync.replace(
      'const existing = await env.DB.prepare','const unused = await env.DB.prepare');},
    s=>{s.mobileSync=s.mobileSync.replace(
      'return existing?.id ?? null;','return null;');},
    s=>{s.mobileSync=s.mobileSync.replace(
      'const createInput = creating ? parseSyncInput(await boundedJson(request)) : null',
      'const createInput = null');},
    s=>{s.mobileSync=s.mobileSync.replace(
      'const statusInput = patching ? parseStatusInput(await boundedJson(request)) : null',
      'const statusInput = null');},
    s=>{s.mobileSync=s.mobileSync.replace(
      'const {issuer,subject} = await verifyOidcBearer(request, env)',
      'const {issuer,subject} = {issuer:"fake",subject:"fake"}');},
  ];
  for(const mutate of bad){
    const s=clone();mutate(s);
    assert.ok(failures(audit(s)).includes('signed_user_admission_is_prevalidated_and_existing_users_read_only'));
  }
});


test('P1-P static guard refuses splitting identity registration from its first monitor',()=>{
  const bad=[
    s=>{s.mobileSync=s.mobileSync.replace(
      'const [identityWrite,monitorWrite,rollbackUnused] = await env.DB.batch([',
      'const [identityWrite,monitorWrite,rollbackUnused] = await Promise.all([');},
    s=>{s.mobileSync=s.mobileSync.replace(
      'DELETE FROM user_identities','SELECT * FROM user_identities');},
    s=>{s.mobileSync=s.mobileSync.replace(
      'if (cleanupChanges===1) {','if (false) {');},
    s=>{s.mobileSync=s.mobileSync.replace(
      'if (creating) return createFirstSyncMonitor(createInput!,env,issuer,subject)',
      'if (creating) return json({error:"pretend_created"},201)');},
    s=>{s.mobileSync=s.mobileSync.replace(
      'AND NOT EXISTS (SELECT 1 FROM monitors WHERE owner_id=?)','AND 1=1');},
  ];
  for(const mutate of bad){
    const snap=clone();mutate(snap);
    assert.ok(failures(audit(snap)).includes('first_monitor_identity_and_monitor_are_one_d1_transaction'));
  }
});

test('P1-V preflight blocks removal of explicit Android presenter or Google canonical identity guards',()=>{
  const tamper=[
    x=>{x.oidcSource=x.oidcSource.replace('!authorizedPresenters.has(payload.azp)','false');},
    x=>{x.oidcSource=x.oidcSource.replace('payload.aud !== audience','false');},
    x=>{x.oidcSource=x.oidcSource.replace(
      "issuer === 'https://accounts.google.com' && payload.iss === 'accounts.google.com'","false");},
    x=>{x.oidcSource=x.oidcSource.replace(
      'const valid = await crypto.subtle.verify(','const valid = await Promise.resolve(');},
    x=>{x.workerTypes=x.workerTypes.replace('OIDC_AUTHORIZED_PRESENTERS?: string','OIDC_ANY_TOKEN?: string');},
  ];
  for(const mutate of tamper){
    const snap=clone();mutate(snap);
    assert.ok(failures(audit(snap)).includes('oidc_google_presenter_explicit_and_issuer_canonical'));
  }
});


test('P1-W offline preflight fails if Google issuer can use arbitrary HTTPS JWKS',()=>{
  for(const edit of [
    x=>{x.oidcSource=x.oidcSource.replace(
      "if (issuer === GOOGLE_ISSUER && jwks !== GOOGLE_JWKS) throw new AuthUnavailable();",
      "if (false) throw new AuthUnavailable();");},
    x=>{x.oidcSource=x.oidcSource.replace(
      "const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';",
      "const GOOGLE_JWKS = 'https://untrusted.invalid/keys';");},
    x=>{x.oidcSource=x.oidcSource.replace(
      'jwks !== GOOGLE_JWKS','false');},
  ]){
    const v=clone();edit(v);
    assert.ok(failures(audit(v)).includes('oidc_google_presenter_explicit_and_issuer_canonical'),
      'JWKS trust-boundary mutation must fail preflight');
  }
});
