import { warehouseReturnFixture } from '../tests/development/warehouse-return-events-helpers.mts';

const contract={goal_id:'M08-G07',qualification:'synthetic_only',formal_goal_accepted:false,connected_warehouse_qualified:false,physical_qualification:false};
if(process.argv.length!==3||!['--describe','--run-local'].includes(process.argv[2])){
 process.stderr.write('Use --describe or --run-local.\n');process.exitCode=2;
}else if(process.argv[2]==='--describe')process.stdout.write(JSON.stringify(contract)+'\n');
else{
 const f=await warehouseReturnFixture();
 try{
  const delivery=f.event({kind:'delivery',units:[]}),delivered=f.observe(delivery);
  const receipt=f.event(),received=f.observe(receipt);
  const disposition=f.event({kind:'disposition',parent_event_id:receipt.event_id,units:[f.unit({disposition:'restock'})]});f.observe(disposition);
  const restocked=f.warehouse.stock('shirt-small','warehouse-one');
  const correction=f.event({kind:'correction',parent_event_id:disposition.event_id,units:[f.unit({grade:'damaged',disposition:'quarantine'})]}),corrected=f.observe(correction);f.observe(correction);
  process.stdout.write(JSON.stringify({...contract,delivery_received:delivered.receipt.total_actual,partial_received:received.receipt.total_actual,
   restocked_available:restocked,corrected_grade:corrected.receipt.units[0].grade,corrected_available:f.warehouse.stock('shirt-small','warehouse-one'),
   original_events:f.warehouse.returnEvents().map(e=>e.event_id),canonical_import_replayed_effects:corrected.physical_effects_replayed})+'\n');
 }finally{f.cleanup();}
}
