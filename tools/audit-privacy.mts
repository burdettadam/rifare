import { DatabaseSync } from 'node:sqlite';
import { readFileSync, lstatSync } from 'node:fs';
import { CommerceKernel } from '../packages/commerce/kernel.mts';
import { auditPrivacyCoverage } from '../packages/commerce/privacy-coverage.mts';

const args=process.argv.slice(2);
if(args.length===1&&args[0]==='--help'){
  process.stdout.write('Usage: node --experimental-strip-types tools/audit-privacy.mts [--surfaces FILE]\nChecks current runtime source and an empty ephemeral commerce schema. FILE is an optional JSON array of deployment-declared surface IDs, not an attestation. No deployment database or customer records are read.\n');
}else{
  let db:DatabaseSync|undefined;
  try{
    if(args.length&&!(args.length===2&&args[0]==='--surfaces'))throw new Error('PRIVACY_AUDIT_ARGUMENTS_INVALID');
    let input={};
    if(args.length){const stat=lstatSync(args[1]);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384)throw new Error('PRIVACY_AUDIT_INPUT_INVALID');input={observed_surfaces:JSON.parse(readFileSync(args[1],'utf8'))};}
    db=new DatabaseSync(':memory:');const k=new CommerceKernel(db);
    k.provisionStore('privacy_audit','ephemeral_schema');k.provisionMember('privacy_audit','ephemeral_schema','local_auditor','owner');
    const scope=k.authenticate(k.issueSession('privacy_audit','ephemeral_schema','local_auditor'));
    process.stdout.write(JSON.stringify({...auditPrivacyCoverage(k,scope,input),observation_environment:'empty_ephemeral_schema_and_current_checkout'},null,2)+'\n');
  }catch(e){const message=e instanceof Error&&/^(PRIVACY_|STORAGE_)[A-Z_]+$/.test(e.message)?e.message:'PRIVACY_AUDIT_FAILED';process.stderr.write(message+'\n');process.exitCode=1;}
  finally{db?.close();}
}
