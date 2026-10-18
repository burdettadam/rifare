#!/usr/bin/env -S node --experimental-strip-types
import {writeFileSync} from 'node:fs';
import {OPERATOR_DRILL_IDS,runOperatorDrill} from './operator-drill-fixtures.mts';

async function main(args:string[]) {
 if(args.length===1&&args[0]==='--list'){process.stdout.write(JSON.stringify({drills:OPERATOR_DRILL_IDS,qualification:'local_fixture_drill',live_effects:false},null,2)+'\n');return;}
 if(!([2,4].includes(args.length)&&args[0]==='--run'&&OPERATOR_DRILL_IDS.includes(args[1])&&(args.length===2||args[2]==='--output')))
  throw new Error('Usage: node --experimental-strip-types tools/operator-drill.mts --list | --run DRILL [--output NEW_FILE]');
 const result=await runOperatorDrill(args[1]),text=JSON.stringify(result,null,2)+'\n';
 if(args[3])writeFileSync(args[3],text,{flag:'wx',mode:0o600});
 process.stdout.write(text);
}
main(process.argv.slice(2)).catch(error=>{process.stderr.write((error instanceof Error?error.message:'DRILL_FAILED')+'\n');process.exitCode=1;});
