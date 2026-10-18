import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CommerceKernel,Scope,Row } from '../../packages/commerce/kernel.mts';
import { contentDigest } from '../../packages/commerce/configuration-values.mts';
import { commerceFixture } from './commerce-helpers.mts';
import { installReviewedForecast } from './demand-planning-helpers.mts';
import { InventoryForecasts } from '../../packages/commerce/inventory-forecasts.mts';
import { WarehouseFixtureSource } from '../../packages/adapters/warehouse-fixture-source.mts';
import { WarehouseInventoryFixtureSource } from '../../packages/adapters/warehouse-inventory-fixture-source.mts';
import { ProcurementFixtureSource } from '../../packages/adapters/procurement-fixture-source.mts';
import { LocationInventory } from '../../packages/commerce/location-inventory.mts';
import { SupplierPurchaseOrders } from '../../packages/commerce/supplier-purchase-orders.mts';
import { ProcurementApprovals } from '../../packages/commerce/procurement-approvals.mts';
import { ReplenishmentPlanning } from '../../packages/commerce/replenishment-planning.mts';
import { PurchaseReceiving } from '../../packages/commerce/purchase-receiving.mts';
import { PROCUREMENT_TABLES } from '../../packages/commerce/procurement-core.mts';

export const oracle=JSON.parse(readFileSync(new URL('../fixtures/procurement/known-answer.v1.json',import.meta.url),'utf8'));
function supplierTerms(supplierId:string,now:number,options:{variant_id?:string;unit_cost_minor?:string;order_unit?:'each'|'case';units_per_purchase?:number}={}){
 return {supplier_id:supplierId,version:1,currency_code:'USD',effective_at:now-1000,expires_at:now+600000,lines:[{variant_id:options.variant_id??'sku-a',order_unit:options.order_unit??'each',base_unit:'each',conversion:{numerator:options.units_per_purchase??1,denominator:1},minimum_quantity:1,lead_time_days:2,unit_cost_minor:options.unit_cost_minor??'250'}]};
}
export type ProcurementInstallContext={kernel:CommerceKernel;inventory:LocationInventory;owner:Scope;reviewer:Scope;operator:Scope;resource_id:string;now:()=>number};
/** Creates real local reviewed/sent/acknowledged records on an existing kernel.
 * Separate source DB and native stages remain explicit in the returned fixture. */
export async function installProcurementPO(context:ProcurementInstallContext,options:{po_id?:string;quantity?:number;variant_id?:string;location_id?:string;unit_cost_minor?:string;order_unit?:'each'|'case';units_per_purchase?:number;budget_minor?:string}={}){
 const k=context.kernel,s=k.require(context.operator),poId=options.po_id??'stock-po',sourceDb=new DatabaseSync(':memory:'),supplierId='supplier_'+contentDigest([context.resource_id,poId]).slice(0,32);
 const supplierSource=new ProcurementFixtureSource(sourceDb,{mode:'fixture',tenant:s.tenant_id,store:s.store_id,identity:'supplier_source_'+contentDigest([context.resource_id,poId]).slice(0,28),clock:context.now});
 try{const terms=supplierSource.recordSupplierTerms(supplierTerms(supplierId,context.now(),options)),orders=new SupplierPurchaseOrders(k,supplierSource,context.inventory),approvals=new ProcurementApprovals(k,orders,{deadline_ms:25});
  orders.importSupplier(context.operator,{supplier_id:supplierId,resource_id:context.resource_id});
  const budgetId='budget_'+contentDigest([context.resource_id,poId]).slice(0,32);approvals.configureBudget(context.owner,{budget_id:budgetId,resource_id:context.resource_id,expected_revision:0,currency_code:'USD',limit_minor:options.budget_minor??'1000000',approval_limit_minor:options.budget_minor??'1000000',expires_at:context.now()+600000});
  const draft=orders.draft(context.operator,{po_id:poId,resource_id:context.resource_id,supplier_id:supplierId,expected_terms_digest:terms.digest,replenishment_id:null,lines:[{line_id:'line-a',variant_id:options.variant_id??'sku-a',location_id:options.location_id??'location-a',quantity:options.quantity??5,order_unit:options.order_unit??'each'}]});
  const poRef={po_id:draft.id,version:draft.version,expected_digest:draft.digest};approvals.approve(context.reviewer,{...poRef,budget_id:budgetId,expires_at:context.now()+60000});
  const operationId='send_'+contentDigest([context.resource_id,poId]).slice(0,32);await approvals.send(context.operator,{...poRef,operation_id:operationId});supplierSource.acknowledge(operationId,{event_id:'ack_'+contentDigest([context.resource_id,poId]).slice(0,32)});
  const po=await approvals.reconcile(context.operator,poRef);return {orders,approvals,po,po_ref:poRef,supplierSource,sourceDb,close:()=>sourceDb.close()};
 }catch(error){sourceDb.close();throw error;}
}

export function procurementFixture(withForecast=false){
 const f=commerceFixture(),k=f.kernel;
 for(const role of ['owner','reviewer','agent'] as const)k.provisionMember(f.a.tenant,f.a.store,'procurement-'+role,role);
 const owner=k.authenticate(k.issueSession(f.a.tenant,f.a.store,'procurement-owner')),reviewer=k.authenticate(k.issueSession(f.a.tenant,f.a.store,'procurement-reviewer')),agent=k.authenticate(k.issueSession(f.a.tenant,f.a.store,'procurement-agent'));
 const resource=k.ingest(f.a.scope,{kind:'catalog',source_system:'synthetic',external_id:'procurement-catalog',source_version:1,source_updated_at:f.now(),customer_id:null,payload:{variants:[{id:'sku-a',unit:'each'}]}});
 const warehouseDb=new DatabaseSync(join(f.directory,'procurement-warehouse.sqlite')),warehouse=new WarehouseFixtureSource(warehouseDb,{mode:'fixture',identity:'procurement-warehouse',tenant:f.a.tenant,store:f.a.store});warehouse.seed('sku-a','location-a',oracle.initial_available);
 const stockSource=new WarehouseInventoryFixtureSource(warehouse,{clock:f.now}),inventory=new LocationInventory(k,stockSource);
 inventory.claim(owner,{resource_id:resource.id,variant_id:'sku-a',location_id:'location-a',source_identity:stockSource.identity,fields:['available','on_hand','reserved','in_transit']});
 stockSource.snapshot({observation_id:'procurement-opening',resource_id:resource.id,variant_id:'sku-a',location_id:'location-a'});inventory.importSnapshot(f.a.scope,'procurement-opening');
 const supplierFilename=join(f.directory,'procurement-supplier.sqlite'),supplierDb=new DatabaseSync(supplierFilename),supplierOptions={mode:'fixture' as const,identity:'procurement-supplier',tenant:f.a.tenant,store:f.a.store,clock:f.now},supplierSource=new ProcurementFixtureSource(supplierDb,supplierOptions),termsInput=supplierTerms('supplier-a',f.now()),terms=supplierSource.recordSupplierTerms(termsInput);
 const orders=new SupplierPurchaseOrders(k,supplierSource,inventory),approvals=new ProcurementApprovals(k,orders,{deadline_ms:25});orders.importSupplier(f.a.scope,{supplier_id:'supplier-a',resource_id:resource.id});
 approvals.configureBudget(owner,{budget_id:'procurement-budget',resource_id:resource.id,expected_revision:0,currency_code:'USD',limit_minor:'10000',approval_limit_minor:'10000',expires_at:f.now()+600000});
 const forecasts=new InventoryForecasts(k),receipts=new PurchaseReceiving(k,inventory,stockSource,{orders}),planning=new ReplenishmentPlanning(k,forecasts,inventory,orders,receipts);
 let installed:ReturnType<typeof installReviewedForecast>|undefined;
 const ensureForecast=()=>{if(!installed)installed=installReviewedForecast(k,f.a.scope,reviewer,{resource_id:resource.id,variant_id:'sku-a',location_id:'location-a',forecast_id:'procurement-forecast',daily_units:4,horizon_days:5});return installed.forecast;};
 if(withForecast)ensureForecast();
 const draftInput=(po_id='po-a',quantity=5)=>({po_id,resource_id:resource.id,supplier_id:'supplier-a',expected_terms_digest:terms.digest,lines:[{line_id:'line-a',variant_id:'sku-a',location_id:'location-a',quantity,order_unit:'each'}],replenishment_id:null});
 const draft=(po_id='po-a',quantity=5)=>orders.draft(f.a.scope,draftInput(po_id,quantity));
 const approve=(po:Row,budget_id='procurement-budget')=>approvals.approve(reviewer,{po_id:po.id,version:po.version,expected_digest:po.digest,budget_id,expires_at:f.now()+60000});
 const openPO=async(po_id='open-po',quantity=6)=>{const po=draft(po_id,quantity);approve(po);const ref={po_id:po.id,version:po.version,expected_digest:po.digest},operation_id=po_id+'-send';await approvals.send(f.a.scope,{...ref,operation_id});supplierSource.acknowledge(operation_id,{event_id:po_id+'-ack'});return approvals.reconcile(f.a.scope,ref);};
 const planInput=(replenishment_id:string)=>{const forecast=ensureForecast();return {replenishment_id,resource_id:resource.id,variant_id:'sku-a',location_id:'location-a',forecast_id:forecast.id,expected_forecast_digest:forecast.digest,supplier_id:'supplier-a',expected_terms_digest:terms.digest,order_unit:'each'};};
 const receive=async(po:Row,quantity:number,receiptId:string)=>{receipts.facts.recordReceipt({receipt_id:receiptId,po_id:po.id,version:po.version,po_digest:po.digest,lines:[{line_id:'line-a',quantity,unit:'each'}],observed_at:f.now(),evidence_ref:receiptId+'-evidence'});
  const op=receipts.propose(f.a.scope,{operation_id:receiptId+'-operation',po_id:po.id,version:po.version,expected_digest:po.digest,receipt_id:receiptId});receipts.approve(reviewer,op.operation_id,{expected_digest:op.command_digest,expires_at:f.now()+60000});return receipts.dispatch(f.a.scope,op.operation_id);};
 return {...f,owner,reviewer,agent,resource,warehouseDb,warehouse,stockSource,inventory,supplierDb,supplierFilename,supplierOptions,supplierSource,sourceDb:supplierDb,termsInput,terms,orders,approvals,forecasts,receipts,planning,draftInput,draft,approve,openPO,receive,planInput,plan:(ref:string)=>planning.propose(f.a.scope,planInput(ref)),get forecast(){return ensureForecast();},
  balance:()=>inventory.balance(f.a.scope,{resource_id:resource.id,variant_id:'sku-a',location_id:'location-a'}),cleanup(){installed?.close();supplierDb.close();warehouseDb.close();f.cleanup();}};
}
export async function usingProcurement(run:(f:ReturnType<typeof procurementFixture>)=>unknown,withForecast=false){const f=procurementFixture(withForecast);try{return await run(f);}finally{f.cleanup();}}
export function nativeSendCount(f:ReturnType<typeof procurementFixture>){return (f.supplierDb.prepare('SELECT count(*) n FROM fixture_procurement_orders').get() as Row).n;}
export async function populateProcurementPrivacy(f:ReturnType<typeof procurementFixture>){
 const draft=f.plan('privacy-replenishment'),po=f.draft('privacy-purchase-order',5);const approval=f.approve(po);f.supplierSource.fault='after';
 const unknown=await f.approvals.send(f.a.scope,{po_id:po.id,version:po.version,expected_digest:po.digest,operation_id:'privacy-procurement-unknown'});
 return {tables:[...PROCUREMENT_TABLES],subject_tables:[],resource_id:f.resource.id,customer_id:null,owner_scope:f.owner,reviewer_scope:f.reviewer,replenishment_id:draft.id,po_id:po.id,po_version:po.version,po_digest:po.digest,approval_id:approval.id,budget_id:'procurement-budget',reservation_id:approval.reservation_id,
  unknown_operations:[{table:'commerce_procurement_sends',id:unknown.operation_id,operation_id:unknown.operation_id,source_identity:f.supplierSource.identity}],kernel:f.kernel,source_db:f.supplierDb,stock_source_db:f.warehouseDb};
}
