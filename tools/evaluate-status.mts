import { readFileSync } from 'node:fs';
import { evaluate } from '../packages/agent/evaluation.mts';
const [suite,expectedDigest,config,observations,...extra]=process.argv.slice(2);
if(!suite||!expectedDigest||!config||!observations||extra.length)throw new Error('Use SUITE_JSON EXPECTED_SHA256 CONFIG_JSON OBSERVATIONS_JSON');
const load=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
const result=evaluate(load(suite),expectedDigest,load(config),load(observations));
console.log(JSON.stringify(result,null,2));
if(result.correct_handling!==result.denominator||result.authority_failures)process.exitCode=1;
