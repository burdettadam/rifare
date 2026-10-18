import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { commerceFixture } from './commerce-helpers.mts';
import { CommerceKernel } from '../../packages/commerce/kernel.mts';
import { WarehouseFixtureSource } from '../../packages/adapters/warehouse-fixture-source.mts';
import { WarehouseInventoryFixtureSource } from '../../packages/adapters/warehouse-inventory-fixture-source.mts';
import { LocationInventory } from '../../packages/commerce/location-inventory.mts';
import { InventoryTransfers } from '../../packages/commerce/inventory-transfers.mts';

export function locationInventoryFixture(anchor=true) {
  const f=commerceFixture(),k=f.kernel,order=f.seed(f.a.scope);
  for(const role of ['owner','reviewer'] as const)k.provisionMember(f.a.tenant,f.a.store,role,role);
  const owner=k.authenticate(k.issueSession(f.a.tenant,f.a.store,'owner'));
  const reviewer=k.authenticate(k.issueSession(f.a.tenant,f.a.store,'reviewer'));
  const warehouseFile=join(f.directory,'warehouse.sqlite'),warehouseDb=new DatabaseSync(warehouseFile);
  const warehouseOptions={mode:'fixture' as const,identity:'inventory-fixture',tenant:f.a.tenant,store:f.a.store};
  const warehouse=new WarehouseFixtureSource(warehouseDb,warehouseOptions);
  warehouse.seed('sku-a','location-a',10);warehouse.seed('sku-a','location-b',0);
  const source=new WarehouseInventoryFixtureSource(warehouse,{clock:f.now});
  const inventory=new LocationInventory(k,source),transfers=new InventoryTransfers(k,inventory,source,{deadline_ms:10});
  const fields=['available','on_hand','reserved','in_transit'];
  for(const location_id of ['location-a','location-b']) {
    inventory.claim(owner,{resource_id:order.id,variant_id:'sku-a',location_id,source_identity:source.identity,fields});
    if(anchor){const snapshot=source.snapshot({observation_id:'initial-'+location_id,resource_id:order.id,variant_id:'sku-a',location_id});inventory.importSnapshot(f.a.scope,snapshot.observation_id);}
  }
  const balance=(location_id='location-a')=>inventory.balance(f.a.scope,{resource_id:order.id,variant_id:'sku-a',location_id});
  const movement=(movement_id:string,quantity_delta:number,location_id='location-a',kind='adjustment')=>source.recordMovement({movement_id,resource_id:order.id,variant_id:'sku-a',location_id,kind,quantity_delta,reference_id:'operator-evidence',linked_movement_id:null});
  const plan=(transfer_id='transfer-a',quantity=5)=>transfers.plan(f.a.scope,{transfer_id,resource_id:order.id,variant_id:'sku-a',from_location:'location-a',to_location:'location-b',quantity});
  const proposed=(kind:string,quantity:number,operation_id=kind+'-operation',transfer_id='transfer-a')=>transfers.propose(f.a.scope,transfer_id,{operation_id,kind,quantity,expected_revision:transfers.read(f.a.scope,transfer_id).revision});
  const approved=(kind:string,quantity:number,operation_id=kind+'-operation',transfer_id='transfer-a')=>{const op=proposed(kind,quantity,operation_id,transfer_id);transfers.approve(reviewer,operation_id,{expected_digest:op.command_digest,expires_at:f.now()+60000});return op;};
  const step=async(kind:string,quantity:number,operation_id=kind+'-operation',transfer_id='transfer-a')=>{approved(kind,quantity,operation_id,transfer_id);return transfers.dispatch(f.a.scope,operation_id);};
  const restart=()=>{const db=new DatabaseSync(f.filename),kernel=new CommerceKernel(db,f.now),sourceDb=new DatabaseSync(warehouseFile),native=new WarehouseFixtureSource(sourceDb,warehouseOptions),wrapped=new WarehouseInventoryFixtureSource(native,{clock:f.now}),ledger=new LocationInventory(kernel,wrapped);return {db,sourceDb,kernel,source:wrapped,inventory:ledger,transfers:new InventoryTransfers(kernel,ledger,wrapped,{deadline_ms:10}),scope:kernel.authenticate(f.a.bearer),cleanup(){db.close();sourceDb.close();}};};
  return {...f,order,owner,reviewer,warehouseFile,warehouseDb,warehouseOptions,warehouse,source,inventory,transfers,fields,balance,movement,plan,proposed,approved,step,restart,cleanup(){warehouseDb.close();f.cleanup();}};
}
export async function usingLocationInventory(run:(f:ReturnType<typeof locationInventoryFixture>)=>unknown,anchor=true){const f=locationInventoryFixture(anchor);try{return await run(f);}finally{f.cleanup();}}
