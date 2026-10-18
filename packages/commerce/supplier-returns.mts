import type { CommerceKernel,Scope } from './kernel.mts';
import type { LocationInventory } from './location-inventory.mts';
import type { WarehouseInventoryFixtureSource } from '../adapters/warehouse-inventory-fixture-source.mts';
import { ProcurementInventoryOperations } from './procurement-inventory-core.mts';
import type { ProcurementStockOptions } from './procurement-inventory-core.mts';

/** Source-observed returns, receipt corrections and credits keep original receipt history. */
export class SupplierReturns {
 readonly operations:ProcurementInventoryOperations;readonly facts:ProcurementInventoryOperations['facts'];
 constructor(k:CommerceKernel,inventory:LocationInventory,source:WarehouseInventoryFixtureSource,options:ProcurementStockOptions={}){this.operations=new ProcurementInventoryOperations(k,inventory,source,options);this.facts=this.operations.facts;}
 propose(scope:Scope,input:unknown){return this.operations.proposeSupplier(scope,input);}
 approve(scope:Scope,operationId:string,input:unknown){return this.operations.approve(scope,operationId,input);}
 dispatch(scope:Scope,operationId:string){return this.operations.dispatch(scope,operationId);}
 reconcile(scope:Scope,operationId:string){return this.operations.reconcile(scope,operationId);}
 read(scope:Scope,operationId:string){return this.operations.status(scope,operationId);}
 receipt(scope:Scope,receiptId:string){return this.operations.receipt(scope,receiptId);}
}
