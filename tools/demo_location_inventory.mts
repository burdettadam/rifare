import assert from 'node:assert/strict';
import { usingLocationInventory } from '../tests/development/location-inventory-helpers.mts';

export async function runLocationInventoryDemo(){return usingLocationInventory(async f=>{
  f.plan();const timeline=[{stage:'planned',origin:f.balance(),destination:f.balance('location-b')}];
  for(const [kind,quantity] of [['reserve',5],['dispatch',5],['receive',3],['lose',2],['correct_loss',1]] as [string,number][]){const operation=await f.step(kind,quantity);assert.equal(operation.state,'applied');timeline.push({stage:kind,origin:f.balance(),destination:f.balance('location-b')});}
  const transfer=f.transfers.read(f.a.scope,'transfer-a');assert.deepEqual([transfer.received,transfer.in_transit,transfer.lost],[4,0,1]);assert.equal(f.balance().available,5);assert.equal(f.balance('location-b').available,4);
  const before=f.source.calls.apply;await f.transfers.reconcile(f.a.scope,'receive-operation');assert.equal(f.source.calls.apply,before);
  return {qualification:'synthetic_only',formal_goal_accepted:false,physical_qualified:false,source_identity:f.source.identity,timeline,transfer,source_apply_calls:f.source.calls.apply,source_lookup_calls:f.source.calls.lookup,original_operation_reused:true};
});}
if(import.meta.url===new URL(process.argv[1]??'', 'file:').href)console.log(JSON.stringify(await runLocationInventoryDemo(),null,2));
