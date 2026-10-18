import { execFileSync } from 'node:child_process';
import { inventoryCycleFixture } from '../tests/development/inventory-reconciliation-helpers.mts';

if(process.argv.length!==2)throw new Error('SYNTHETIC_DEMO_ACCEPTS_NO_OPTIONS');
if(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim())throw new Error('CLEAN_CANDIDATE_REQUIRED');
const f=await inventoryCycleFixture();
try{
  const report=await f.complete({sync:false}),before=f.effects(),repaired=f.reconciliation.repair(f.a.scope,{resource_id:f.resource_id});
  process.stdout.write(JSON.stringify({candidate:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),qualification:'synthetic_only',before:report,repair:repaired,
    source_effects_before:before,source_effects_after:f.effects(),connected_warehouse_qualified:false,physical_qualified:false,formal_goal_accepted:false},null,2)+'\n');
}finally{f.cleanup();}
