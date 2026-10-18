#!/usr/bin/env -S node --experimental-strip-types
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {recoveryFixture,checkRestoredEffects} from './recovery-load-fixtures.mts';
import {createRecoverySnapshot,suppressionCheckpoint} from '../packages/commerce/safe-recovery.mts';
import {contentDigest} from '../packages/commerce/configuration-values.mts';
import {rehearseRecovery} from '../packages/operations/recovery-rehearsal.mts';

async function main(args:string[]){
 if(args.length===1&&args[0]==='--describe'){process.stdout.write(JSON.stringify({profile:'sqlite-synthetic-local-v1',queued_operations:['refund','label','message'],attachments:'embedded',credentials:'encrypted_and_revoked',live_activation_supported:false,independent_machine_qualified:false})+'\n');return;}
 if(!([1,3].includes(args.length)&&args[0]==='--run-local'&&(args.length===1||args[1]==='--output')))throw new Error('Usage: tools/rehearse-recovery.mts --describe | --run-local [--output NEW_FILE]');
 const f=await recoveryFixture();try{
  const snapshot=createRecoverySnapshot(f.kernel,join(f.directory,'snapshot')),cp=suppressionCheckpoint(f.kernel);
  const result=rehearseRecovery({snapshot:snapshot.directory,destination:join(f.directory,'restored'),manifest_sha256:snapshot.manifest_sha256,suppression:cp,suppression_sha256:contentDigest(cp),profile:{id:'sqlite-synthetic-local-v1',maximum_point_gap_ms:1000,maximum_restore_ms:10000,clock_basis:'synthetic_application_clock'}},f.now);
  const effects=await checkRestoredEffects(f,result.database,2);
  // The disposable fixture is removed after measurement. Do not advertise its
  // private database path as a durable backup or an installation.
  const {directory,database,...observation}=result;
  const report={...observation,effect_observation:effects,restarts:2,fixture_removed_after_run:true},text=JSON.stringify(report,null,2)+'\n';
  if(args[2])writeFileSync(args[2],text,{flag:'wx',mode:0o600});process.stdout.write(text);
 }finally{f.cleanup();}
}
main(process.argv.slice(2)).catch(error=>{process.stderr.write((error instanceof Error?error.message:'RECOVERY_REHEARSAL_FAILED')+'\n');process.exitCode=1;});
