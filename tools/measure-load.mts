#!/usr/bin/env -S node --experimental-strip-types
import {readFileSync,writeFileSync} from 'node:fs';
import {loadFixture} from './recovery-load-fixtures.mts';
import {LOAD_WORKLOAD,measureLoadEnvelope,compareLoadBaseline} from '../packages/operations/load-envelope.mts';
import {contentDigest} from '../packages/commerce/configuration-values.mts';

async function main(args:string[]){
 if(args.length===1&&args[0]==='--describe'){process.stdout.write(JSON.stringify({workload:LOAD_WORKLOAD,workload_sha256:contentDigest(LOAD_WORKLOAD),production_qualified:false})+'\n');return;}
 if(args[0]!=='--run-local')throw new Error('Usage: tools/measure-load.mts --describe | --run-local [--output NEW_FILE] [--baseline FILE --baseline-sha256 CANONICAL_SHA256]');
 const options:Record<string,string>={};for(let i=1;i<args.length;i+=2){if(!['--output','--baseline','--baseline-sha256'].includes(args[i])||!args[i+1]||options[args[i]])throw new Error('LOAD_ARGUMENTS_INVALID');options[args[i]]=args[i+1];}
 if(Boolean(options['--baseline'])!==Boolean(options['--baseline-sha256']))throw new Error('LOAD_BASELINE_PIN_REQUIRED');
 let baseline:unknown;if(options['--baseline']){const bytes=readFileSync(options['--baseline']);if(bytes.length>1024*1024)throw new Error('LOAD_BASELINE_TOO_LARGE');baseline=JSON.parse(bytes.toString());}
 const f=loadFixture();try{
  const report=await measureLoadEnvelope(f.input),comparison=baseline?compareLoadBaseline(report,baseline,options['--baseline-sha256']):null;
  const text=JSON.stringify(report,null,2)+'\n';if(options['--output'])writeFileSync(options['--output'],text,{flag:'wx',mode:0o600});process.stdout.write(text);
  process.stderr.write(JSON.stringify({report_sha256:contentDigest(report),hash_format:'canonical_json_sha256'})+'\n');
  if(comparison)process.stderr.write(JSON.stringify(comparison)+'\n');if(!report.within_envelope||comparison&&!comparison.within_baseline)process.exitCode=2;
 }finally{f.cleanup();}
}
main(process.argv.slice(2)).catch(error=>{process.stderr.write((error instanceof Error?error.message:'LOAD_MEASUREMENT_FAILED')+'\n');process.exitCode=1;});
