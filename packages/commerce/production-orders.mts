import type { CommerceKernel,Scope } from './kernel.mts';
import type { LocationInventory } from './location-inventory.mts';
import type { WarehouseInventoryFixtureSource } from '../adapters/warehouse-inventory-fixture-source.mts';
import { ProcurementInventoryOperations } from './procurement-inventory-core.mts';

/** Independent job and exact-step approval; all stock effects belong to the warehouse source. */
export class ProductionOrders {
 readonly operations:ProcurementInventoryOperations;readonly facts:ProcurementInventoryOperations['facts'];
 constructor(k:CommerceKernel,inventory:LocationInventory,source:WarehouseInventoryFixtureSource,options:{deadline_ms?:number}={}){this.operations=new ProcurementInventoryOperations(k,inventory,source,options);this.facts=this.operations.facts;}
 create(scope:Scope,input:unknown){return this.operations.createProduction(scope,input);}
 approveJob(scope:Scope,productionId:string,input:unknown){return this.operations.approveProduction(scope,productionId,input);}
 propose(scope:Scope,input:unknown){return this.operations.proposeProduction(scope,input);}
 approve(scope:Scope,operationId:string,input:unknown){return this.operations.approve(scope,operationId,input);}
 dispatch(scope:Scope,operationId:string){return this.operations.dispatch(scope,operationId);}
 reconcile(scope:Scope,operationId:string){return this.operations.reconcile(scope,operationId);}
 read(scope:Scope,productionId:string){return this.operations.production(scope,productionId);}
 operation(scope:Scope,operationId:string){return this.operations.status(scope,operationId);}
}
