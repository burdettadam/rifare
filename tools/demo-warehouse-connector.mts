import { editFixture } from '../tests/development/order-edit-helpers.mts';
import { WarehouseConnector, WAREHOUSE_CONNECTOR } from '../packages/commerce/warehouse-connector.mts';

const contract={goal_id:'M08-G06',connector:WAREHOUSE_CONNECTOR,qualification:'synthetic_only',
  live_qualified:false,formal_goal_accepted:false,connected_account:false,physical_qualification:false};
if(process.argv.length!==3||!['--describe','--run-local'].includes(process.argv[2])){
  process.stderr.write('Use --describe or --run-local.\n');process.exitCode=2;
} else if(process.argv[2]==='--describe') {
  process.stdout.write(JSON.stringify(contract)+'\n');
} else {
  const f=editFixture();
  try {
    const connector=new WarehouseConnector(f.kernel,f.native),binding={warehouse_id:'warehouse_one',expected_revision:0,
      connector_version:'1.0.0',api_version:'rifare-order-edit-fixture-v1',workflow_revision:'packing-v1',
      callbacks_connected:true,callback_observed_at:f.now(),callback_max_age_ms:30000,behavior:'qualified'};
    connector.configure(f.owner.scope,binding);
    const readiness=connector.qualify(f.owner.scope,{warehouses:['warehouse_one']});
    f.edits.configure(f.owner.scope,{...f.settings,expected_revision:1});f.edits.refresh(f.a.scope,'case_one');
    const edit=f.authorize().order_edit_id,updated=await f.edits.dispatch(f.a.scope,edit);
    const held=connector.inspect(f.a.scope,{resource_id:f.original.id,warehouse_id:'warehouse_one'});
    const released=await f.edits.release(f.a.scope,edit);
    connector.configure(f.owner.scope,{...binding,expected_revision:1,workflow_revision:'packing-v2'});
    let stale_configuration:string|null=null;
    try {f.edits.refresh(f.a.scope,'case_one');} catch(error) {stale_configuration=(error as Error).message;}
    process.stdout.write(JSON.stringify({...contract,readiness:readiness.qualified,held_state:updated.state,
      picking_blocked:!held.can_pick,consumed_version:held.warehouse.ack_version,
      final_variant_ids:held.warehouse.final_variant_ids,released_state:released.state,stale_configuration})+'\n');
  } finally {f.cleanup();}
}
