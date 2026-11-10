import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assessOffDeviceEvidence} from '../scripts/offdevice-evidence-gate.mjs';

const cli=fileURLToPath(new URL('../scripts/offdevice-evidence-gate.mjs',import.meta.url));
const monitor='11111111-1111-4111-8111-111111111111';
const baselineId='22222222-2222-4222-8222-222222222221';
const changeId='22222222-2222-4222-8222-222222222222';
const SHA_A='a'.repeat(40),SHA_B='b'.repeat(40);
const START=1_800_000_000_000,END=START+40*60_000,CHANGED=START+20*60_000;

function fixture(){
  return {
    schemaVersion:1,
    evidenceClass:'OWNER_SUPPLIED_UNVERIFIED',
    monitorId:monitor,
    release:{
      sourceSha:'c'.repeat(40),migrationVersions:[1,2,3,4,5],
      approvalRef:'OWNER_OK_0001',accountReviewAt:START-3_600_000,
      oauthReviewAt:START-3_600_000,
    },
    device:{powerOffAt:START,powerOnAt:END,evidenceRef:'DEVICE_OFF_001'},
    cloudflare:{
      cronEvents:[{recordedAt:CHANGED+8000,event:'scheduled_tick',completed:1,observations:1}],
      observations:[
        {id:changeId,monitor_id:monitor,event_type:'CHANGE',previous_sha:SHA_A,
          head_sha:SHA_B,observed_at:CHANGED,event_sequence:2},
        {id:baselineId,monitor_id:monitor,event_type:'BASELINE',previous_sha:null,
          head_sha:SHA_A,observed_at:START-120_000,event_sequence:1},
      ],
    },
    postRestart:{signedReadAt:END+300_000,observedIds:[changeId,baselineId]},
    github:{repository:'python/cpython',
      shaChecks:[{sha:SHA_B,checkedAt:END+60_000}]},
  };
}
const clone=v=>structuredClone(v);
const failing=v=>assessOffDeviceEvidence(v).checks.filter(c=>c.status==='FAIL').map(c=>c.id);

test('an internally coherent synthetic package is NEVER an independently verified phone-off acceptance',()=>{
  const v=assessOffDeviceEvidence(fixture());
  assert.equal(v.structural_consistency,'PASS');
  assert.equal(v.remote_acceptance,'NOT_VERIFIED');
  assert.equal(v.independent_origin_verification,'NOT_PERFORMED');
  assert.equal(v.physical_device_verification,'NOT_PERFORMED');
  assert.equal(v.cloudflare_account_quota_and_billing,'NOT_VERIFIED');
  assert.equal(v.safe_to_activate_scheduler,false);
  assert.equal(v.checks.every(x=>x.status==='PASS'),true);
  assert.ok(v.limitations.includes('owner_supplied_data_not_independently_authenticated'));
  assert.ok(!JSON.stringify(v).includes(SHA_B));
  assert.ok(!JSON.stringify(v).includes(monitor));
});

test('red team: invalid owner-provided release, migrations, device and unknown credential fields fail closed',()=>{
  const setters=[
    v=>{v.evidenceClass='CLOUDFLARE_VERIFIED';},
    v=>{v.monitorId='not-a-uuid';},
    v=>{v.release.migrationVersions=[1,2,3,4];},
    v=>{v.release.sourceSha='unstable-head';},
    v=>{v.release.approvalRef='Bearer secret';},
    v=>{v.release.accountReviewAt=v.device.powerOffAt+1;},
    v=>{v.release.oauthReviewAt=v.device.powerOffAt+1;},
    v=>{v.device.powerOnAt=v.device.powerOffAt;},
    v=>{v.device.powerOnAt=v.device.powerOffAt+10*60_000;},
    v=>{v.device.evidenceRef='';},
    v=>{v.password='raw-password';},
    v=>{v.release.authorization='Bearer secret';},
    v=>{v.cloudflare.accessToken='secret';},
    v=>{v.postRestart.signedReadAt=v.device.powerOnAt-1;},
  ];
  for(const mutation of setters){
    const v=fixture();mutation(v);
    assert.equal(assessOffDeviceEvidence(v).structural_consistency,'FAIL');
  }
});

test('red team: observation identity, causal chain and type-coercion attacks are rejected',()=>{
  const setters=[
    v=>{v.cloudflare.observations[0].previous_sha=SHA_B;},
    v=>{v.cloudflare.observations[0].previous_sha='e'.repeat(40);},
    v=>{v.cloudflare.observations[0].event_sequence=1;},
    v=>{v.cloudflare.observations[0].event_sequence='2';},
    v=>{v.cloudflare.observations[0].event_sequence=2.5;},
    v=>{v.cloudflare.observations[0].event_sequence=Number.MAX_SAFE_INTEGER+1;},
    v=>{delete v.cloudflare.observations[0].event_sequence;},
    v=>{v.cloudflare.observations[0].id=baselineId;},
    v=>{v.cloudflare.observations[0].monitor_id='99999999-9999-4999-8999-999999999999';},
    v=>{v.cloudflare.observations[0].event_type='BASELINE';v.cloudflare.observations[0].previous_sha=null;},
    v=>{v.cloudflare.observations[1].event_type='CHANGE';v.cloudflare.observations[1].previous_sha=SHA_A;},
    v=>{v.cloudflare.observations[1].rawToken='Bearer secret';},
    v=>{v.cloudflare.observations=[v.cloudflare.observations[0]];},
  ];
  for(const mutation of setters){
    const v=fixture();mutation(v);
    assert.equal(assessOffDeviceEvidence(v).structural_consistency,'FAIL',JSON.stringify(failing(v)));
  }
});


test('bounded 50-event history may legitimately omit a historical baseline',()=>{
  const v=fixture();
  v.cloudflare.observations[1].event_type='CHANGE';
  v.cloudflare.observations[1].previous_sha=SHA_B;
  // SHA_B -> SHA_A (older) and SHA_A -> SHA_B (newer) is a
  // structurally continuous two-CHANGE page; the original BASELINE
  // may have been truncated and no one can infer missing history.
  const report=assessOffDeviceEvidence(v);
  assert.equal(report.structural_consistency,'PASS');
  assert.equal(report.remote_acceptance,'NOT_VERIFIED');
});

test('red team: Cron outside phone-off, D1 outside off, late/absent signed sync and unrelated GitHub SHA fail closed',()=>{
  const setters=[
    v=>{v.cloudflare.cronEvents[0].recordedAt=v.device.powerOnAt+1;},
    v=>{v.cloudflare.cronEvents[0].observations=0;},
    v=>{v.cloudflare.cronEvents[0].completed=5;},
    v=>{v.cloudflare.cronEvents[0].completed=0;},
    v=>{v.cloudflare.cronEvents[0].recordedAt=CHANGED+90_000;},
    v=>{v.cloudflare.observations[0].observed_at=v.device.powerOnAt+1;},
    v=>{v.cloudflare.observations[0].observed_at=v.device.powerOffAt;},
    v=>{v.postRestart.observedIds=[baselineId];},
    v=>{v.github.shaChecks[0].sha=SHA_A;},
    v=>{v.github.shaChecks[0].checkedAt=CHANGED-1;},
    v=>{v.github.shaChecks[0].checkedAt=v.postRestart.signedReadAt+1;},
    v=>{v.github.repository='https://api.github.com/malicious';},
  ];
  for(const mutation of setters){
    const v=fixture();mutation(v);
    assert.equal(assessOffDeviceEvidence(v).structural_consistency,'FAIL',JSON.stringify(failing(v)));
  }
});

test('the gate validates chronology using event_sequence, not the potentially regressed wall clock',()=>{
  const v=fixture();
  v.cloudflare.observations[1].observed_at=v.device.powerOnAt+1;
  // The baseline can be recorded with a wall-clock anomaly and still
  // preserve real D1 insertion order. Only the CHANGE must be inside OFF.
  const report=assessOffDeviceEvidence(v);
  assert.equal(report.structural_consistency,'PASS');
  assert.equal(report.remote_acceptance,'NOT_VERIFIED');
  v.cloudflare.observations[0].event_sequence=0;
  assert.ok(failing(v).includes('d1_observation_record_shapes'));
});

test('CLI is read-only, silent about secrets, bounded, and require-remote ALWAYS blocks',()=>{
  const dir=mkdtempSync(join(tmpdir(),'naraya-offdevice-private-'));
  const path=join(dir,'private-evidence.json');
  try{
    writeFileSync(path,JSON.stringify(fixture()));
    const yes=spawnSync(process.execPath,[cli,'--file',path,'--json'],{encoding:'utf8',timeout:10000});
    assert.equal(yes.status,0,yes.stderr);
    const good=JSON.parse(yes.stdout);
    assert.equal(good.structural_consistency,'PASS');
    assert.equal(good.remote_acceptance,'NOT_VERIFIED');
    assert.ok(!yes.stdout.includes(monitor));
    assert.ok(!yes.stdout.includes(SHA_B));
    assert.ok(!yes.stdout.includes(path));
    const no=spawnSync(process.execPath,
      [cli,'--file',path,'--json','--require-remote'],{encoding:'utf8',timeout:10000});
    assert.equal(no.status,2,no.stderr);
    assert.equal(JSON.parse(no.stdout).safe_to_activate_scheduler,false);
    const mock=fixture();mock.cloudflare.credentials='SECRET-CANNOT-LEAK';
    writeFileSync(path,JSON.stringify(mock));
    const invalid=spawnSync(process.execPath,[cli,'--file',path,'--json'],{
      encoding:'utf8',timeout:10000,
    });
    assert.equal(invalid.status,1);
    assert.equal(JSON.parse(invalid.stdout).structural_consistency,'FAIL');
    assert.ok(!invalid.stdout.includes('SECRET-CANNOT-LEAK'));
    writeFileSync(path,'{"big":"'+('x'.repeat(70_000))+'"}');
    const huge=spawnSync(process.execPath,[cli,'--file',path,'--json'],{
      encoding:'utf8',timeout:10000,
    });
    assert.equal(huge.status,1);
    assert.ok(!huge.stdout.includes('x'.repeat(300)));
    const missing=spawnSync(process.execPath,[cli,'--file',path+'-missing','--json'],{
      encoding:'utf8',timeout:10000,
    });
    assert.equal(missing.status,1);
    assert.ok(!missing.stdout.includes(path));
    const wrong=spawnSync(process.execPath,[cli,'--execute-deploy'],{encoding:'utf8',timeout:10000});
    assert.equal(wrong.status,64);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
