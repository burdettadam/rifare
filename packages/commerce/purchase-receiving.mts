import type { CommerceKernel,Scope } from './kernel.mts';
import type { LocationInventory } from './location-inventory.mts';
import type { WarehouseInventoryFixtureSource } from '../adapters/warehouse-inventory-fixture-source.mts';
import { ProcurementInventoryOperations } from './procurement-inventory-core.mts';
import type { ProcurementStockOptions } from './procurement-inventory-core.mts';

/** Receiving is an approved native observation, independently reconciled from PO/invoice/payment. */
export class PurchaseReceiving {
 readonly k:CommerceKernel;readonly inventory:LocationInventory;readonly source:WarehouseInventoryFixtureSource;readonly operations:ProcurementInventoryOperations;readonly facts:ProcurementInventoryOperations['facts'];readonly orders:ProcurementInventoryOperations['orders'];
 constructor(k:CommerceKernel,inventory:LocationInventory,source:WarehouseInventoryFixtureSource,options:ProcurementStockOptions={}){this.k=k;this.inventory=inventory;this.source=source;this.operations=new ProcurementInventoryOperations(k,inventory,source,options);this.facts=this.operations.facts;this.orders=this.operations.orders;}
 propose(scope:Scope,input:unknown){return this.operations.proposeReceipt(scope,input);}
 approve(scope:Scope,operationId:string,input:unknown){return this.operations.approve(scope,operationId,input);}
 dispatch(scope:Scope,operationId:string){return this.operations.dispatch(scope,operationId);}
 reconcile(scope:Scope,operationId:string){return this.operations.reconcile(scope,operationId);}
 read(scope:Scope,operationId:string){return this.operations.status(scope,operationId);}
 receipts(scope:Scope,input:unknown){return this.operations.receipts(scope,input);}
 summary(scope:Scope,input:unknown){return this.operations.summary(scope,input);}
}
