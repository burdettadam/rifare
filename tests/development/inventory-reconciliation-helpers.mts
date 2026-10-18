import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { completionFixture } from './completion-helpers.mts';
import { CarrierQuoteFixtureSource } from '../../packages/adapters/carrier-quote-fixture-source.mts';
import { ShippingCarrierFixtureSource } from '../../packages/adapters/shipping-carrier-fixture-source.mts';
import { WarehouseInventoryFixtureSource } from '../../packages/adapters/warehouse-inventory-fixture-source.mts';
import { CarrierQuotes } from '../../packages/commerce/carrier-quotes.mts';
import { ShippingBatchLabels } from '../../packages/commerce/shipping-batch-labels.mts';
import { ShippingManifests } from '../../packages/commerce/shipping-manifests.mts';
import { PackingSessions } from '../../packages/commerce/packing-sessions.mts';
import { WarehouseReturnEvents } from '../../packages/commerce/warehouse-return-events.mts';
import { LocationInventory } from '../../packages/commerce/location-inventory.mts';
import { InventoryReconciliation } from '../../packages/commerce/inventory-reconciliation.mts';
import type { Row } from '../../packages/commerce/kernel.mts';

/** One canonical order and separate warehouse/carrier databases, with a known
 * beta/gamma shipment and beta-only partial return. All source effects are
 * recorded outside the reconciliation service. */
export async function inventoryCycleFixture() {
  const f=await completionFixture(),resource_id=f.order().id,package_id='cycle-package',manifest_id='cycle-manifest';
  f.update({packing:{cancelled:false,lines:[
    {line_id:'beta',sku:'hat-small',quantity:2,cancelled_ordinals:[],backordered_ordinals:[],shipped_ordinals:[],return_links:[{ordinal:1,return_id:f.request.id}]},
    {line_id:'gamma',sku:'shoe-small',quantity:1,cancelled_ordinals:[],backordered_ordinals:[],shipped_ordinals:[],return_links:[{ordinal:1,return_id:f.request.id}]}
  ]}});
  const inventorySource=new WarehouseInventoryFixtureSource(f.warehouse,{clock:f.now});
  const locationInventory=new LocationInventory(f.kernel,inventorySource),returns=new WarehouseReturnEvents(f.kernel,f.warehouse);
  for(const variant_id of ['hat-small','shoe-small']){
    f.warehouse.seed(variant_id,'warehouse-one',10);
    locationInventory.claim(f.owner.scope,{resource_id,variant_id,location_id:'warehouse-one',source_identity:f.warehouse.identity,fields:['available','on_hand','reserved','in_transit']});
    const observation=inventorySource.snapshot({observation_id:'opening-'+variant_id,resource_id,variant_id,location_id:'warehouse-one'});
    locationInventory.importSnapshot(f.a.scope,observation.observation_id);
  }
  const quoteSource=new CarrierQuoteFixtureSource({tenant_id:f.a.tenant,store_id:f.a.store},f.now);
  quoteSource.setAccount({account_id:'cycle-account',carrier_id:'cycle-carrier',revision:1,enabled:true,currencies:['USD'],services:['ground']});
  quoteSource.setPackage({package_id,resource_id,revision:1,address_revision:1,from_address_ref:'warehouse-one',to_address_ref:'cycle-destination',from_country:'US',to_country:'US',weight_g:400,length_mm:200,width_mm:100,height_mm:50});
  quoteSource.setRate({package_id,account_id:'cycle-account',service:'ground',rate_id:'cycle-rate',revision:1,amount_minor:'500',currency:'USD',expires_at:f.now()+120000});
  const quotes=new CarrierQuotes(f.kernel,quoteSource,{id:'cycle-policy',revision:1,tenant_id:f.a.tenant,store_id:f.a.store,source_identity:quoteSource.identity,expires_at:f.now()+600000,rules:[{
    id:'ground',account_id:'cycle-account',carrier_id:'cycle-carrier',service:'ground',currency:'USD',max_amount_minor:'500',from_countries:['US'],to_countries:['US'],max_weight_g:1000,max_length_mm:1000,max_width_mm:1000,max_height_mm:1000
  }]});
  const carrierDb=new DatabaseSync(join(f.directory,'cycle-carrier.sqlite'));
  const carrier=new ShippingCarrierFixtureSource(carrierDb,{mode:'fixture',identity:'cycle-carrier-fixture',tenant_id:f.a.tenant,store_id:f.a.store,quote_source:quoteSource,clock:f.now});
  const shippingLabels=new ShippingBatchLabels(f.kernel,quotes,carrier,{deadline_ms:15}),packing=new PackingSessions(f.kernel,quoteSource);
  const manifests=new ShippingManifests(f.kernel,packing,shippingLabels,carrier,{deadline_ms:15});
  const reconciliation=new InventoryReconciliation(f.kernel,locationInventory,returns,packing,shippingLabels,carrier);
  const pack=()=>{
    packing.open(f.a.scope,{session_id:'cycle-pack',package_id,resource_id,units:[{line_id:'beta',ordinal:1},{line_id:'gamma',ordinal:1}]});
    for(const [line_id,sku] of [['beta','hat-small'],['gamma','shoe-small']])packing.scan(f.a.scope,{session_id:'cycle-pack',scanner_id:'cycle-scanner',scan_id:'cycle-scan-'+line_id,line_id,ordinal:1,sku});
    return packing.confirm(f.a.scope,{session_id:'cycle-pack',expected_revision:packing.read(f.a.scope,'cycle-pack').revision});
  };
  const manifest=async()=>{
    pack();const q=quotes.quote(f.a.scope,{batch_id:'cycle-batch',packages:[{package_id,resource_id,rule_id:'ground'}]});
    const proposal=shippingLabels.prepare(f.a.scope,q).packages[0];
    shippingLabels.approve(f.reviewer.scope,package_id,{expected_digest:proposal.command_digest,expires_at:f.now()+60000});
    await shippingLabels.purchase(f.a.scope,q);return manifests.create(f.a.scope,{manifest_id,package_ids:[package_id]});
  };
  const accept=async()=>{
    carrier.recordEvent({manifest_id,package_id,event_id:'cycle-accepted',sequence:1,stage:'carrier_acceptance',at:f.now()});
    return manifests.observe(f.a.scope,manifest_id);
  };
  const ship=(reference_id='cycle-accepted')=>['hat-small','shoe-small'].map(variant_id=>inventorySource.recordMovement({movement_id:'ship-'+variant_id,resource_id,variant_id,location_id:'warehouse-one',kind:'shipment',quantity_delta:-1,reference_id,linked_movement_id:null}));
  const event=(patch:Row={})=>({event_id:'cycle-received',request_id:f.request.id,resource_id,native_return_id:'gid://shopify/Return/900',sequence:1,kind:'receipt',location_id:'warehouse-one',operator_id:'native-receiver',evidence_ids:['warehouse-evidence-one'],completeness:'partial',parent_event_id:null,
    units:[{line_id:'beta',ordinal:1,variant_id:'hat-small',grade:'sellable',received:true,disposition:null}],...patch});
  const receive=(importEvents=true)=>{
    const receipt=f.warehouse.recordReturnEvent(event());
    const disposition=f.warehouse.recordReturnEvent(event({event_id:'cycle-restocked',sequence:2,kind:'disposition',parent_event_id:'cycle-received',units:[{line_id:'beta',ordinal:1,variant_id:'hat-small',grade:'sellable',received:true,disposition:'restock'}]}));
    if(importEvents){returns.importEvent(f.a.scope,{request_id:f.request.id,event_id:receipt.event_id});returns.importEvent(f.a.scope,{request_id:f.request.id,event_id:disposition.event_id});}
    return [receipt,disposition];
  };
  const complete=async(options:{sync?:boolean,importEvents?:boolean}={})=>{
    await manifest();await accept();ship();receive(options.importEvents!==false);
    if(options.sync!==false)locationInventory.sync(f.a.scope,{resource_id});
    return reconciliation.inspect(f.a.scope,{resource_id});
  };
  const effects=()=>({movements:inventorySource.movements(resource_id).length,warehouse_effects:f.warehouse.effects().length,warehouse_events:f.warehouse.returnEvents().length,
    carrier_purchases:carrier.ledger().purchases.length,carrier_manifests:carrier.ledger().manifests.length,carrier_events:carrier.ledger().events.length,
    available:['hat-small','shoe-small'].map(variant_id=>f.warehouse.stock(variant_id,'warehouse-one'))});
  return {...f,resource_id,package_id,manifest_id,inventorySource,locationInventory,returns,quoteSource,quotes,carrier,carrierDb,shippingLabels,packing,manifests,reconciliation,pack,manifest,accept,ship,event,receive,complete,effects,
    cleanup(){carrierDb.close();f.cleanup();}};
}
export async function usingInventoryCycle(run:(f:Awaited<ReturnType<typeof inventoryCycleFixture>>)=>unknown){const f=await inventoryCycleFixture();try{return await run(f);}finally{f.cleanup();}}
