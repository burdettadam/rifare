import { exact,id } from './kernel.mts';
import type { CommerceKernel,Row,Scope } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { assertNotErased } from './data-guards.mts';
import { LocationInventory } from './location-inventory.mts';
import { WarehouseReturnEvents } from './warehouse-return-events.mts';
import { PackingSessions } from './packing-sessions.mts';
import { ShippingBatchLabels,shippingBody } from './shipping-batch-labels.mts';
import { ShippingCarrierFixtureSource } from '../adapters/shipping-carrier-fixture-source.mts';

const FIELDS=['available','on_hand','reserved','in_transit'];
const MAX_RECORDS=10000;
const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
const stock=(value:Row)=>Object.fromEntries(FIELDS.map(field=>[field,value[field]]));
const key=(variant:string,location:string)=>canonical([variant,location]);
function checkedNative(value:Row,source:string,s:Row) {
  const {digest,...body}=value;
  if(contentDigest(body)!==digest||body.source_identity!==source||body.tenant_id!==s.tenant_id||body.store_id!==s.store_id||body.qualification!=='synthetic_only')
    throw new Error('INVENTORY_RECONCILIATION_INTEGRITY');
  return value;
}
function indexed(values:Row[],field:string) {
  if(!Array.isArray(values)||values.length>MAX_RECORDS)throw new Error('RECONCILIATION_LIMIT');
  const records=new Map<string,Row>();
  for(const value of values){id(value[field]);const old=records.get(value[field]);
    if(old&&!same(old,value))throw new Error('INVENTORY_RECONCILIATION_INTEGRITY');records.set(value[field],value);}
  return [...records.values()].sort((a,b)=>a[field].localeCompare(b[field]));
}

/** Source-linked local reconciliation. This class contains no warehouse,
 * carrier, financial or transfer effect dispatch path. Stock drift is an
 * observation; importing an existing movement is the only inventory repair. */
export class InventoryReconciliation {
  readonly kernel:CommerceKernel;
  readonly inventory:LocationInventory;
  readonly returns:WarehouseReturnEvents;
  readonly packing:PackingSessions;
  readonly labels:ShippingBatchLabels;
  readonly carrier:ShippingCarrierFixtureSource;
  constructor(kernel:CommerceKernel,inventory:LocationInventory,returns:WarehouseReturnEvents,packing:PackingSessions,labels:ShippingBatchLabels,carrier:ShippingCarrierFixtureSource) {
    if(!(inventory instanceof LocationInventory)||!(returns instanceof WarehouseReturnEvents)||!(packing instanceof PackingSessions)||!(labels instanceof ShippingBatchLabels)||!(carrier instanceof ShippingCarrierFixtureSource))throw new Error('SYNTHETIC_SOURCE_REQUIRED');
    if(inventory.kernel!==kernel||returns.kernel!==kernel||inventory.source.identity!==returns.source.identity||inventory.source.db!==returns.source.db||carrier.db===kernel.db)
      throw new Error('RECONCILIATION_SOURCE_MISMATCH');
    this.kernel=kernel;this.inventory=inventory;this.returns=returns;this.packing=packing;this.labels=labels;this.carrier=carrier;
  }
  #context(scope:Scope,input:unknown,repair=false) {
    const p=exact(jsonValue(input),['resource_id']),k=this.kernel,s=k.authorize(scope,repair?'operation.reconcile':'operation.read',id(p.resource_id));
    const resource=k.get(scope,p.resource_id);assertNotErased(k,s,resource.id,resource.customer_id);
    if(resource.kind!=='order')throw new Error('RECONCILIATION_ORDER_REQUIRED');
    if(s.tenant_id!==this.inventory.source.tenant||s.store_id!==this.inventory.source.store||s.tenant_id!==this.carrier.tenant_id||s.store_id!==this.carrier.store_id)
      throw new Error('SOURCE_SCOPE_MISMATCH');
    if(this.labels.source_identity!==this.carrier.identity||this.inventory.source.identity!==this.returns.source.identity)throw new Error('RECONCILIATION_SOURCE_MISMATCH');
    if(repair){k.authorize(scope,'warehouse.receive',resource.id);k.authorize(scope,'event.process',resource.id);}
    return {s,resource};
  }
  #movements(s:Row,resourceId:string) {
    return indexed(this.inventory.source.movements(resourceId),'movement_id').map(m=>{
      checkedNative(m,this.inventory.source.identity,s);
      if(m.resource_id!==resourceId||FIELDS.some(field=>!Number.isSafeInteger(m.delta?.[field])))throw new Error('INVENTORY_RECONCILIATION_INTEGRITY');
      return m;
    });
  }
  inspect(scope:Scope,input:unknown):Row {
    const {s,resource}=this.#context(scope,input),k=this.kernel,source=this.inventory.source;
    const discrepancies:Row[]=[];
    const problem=(code:string,details:Row={})=>discrepancies.push({code,...details});
    const movements=this.#movements(s,resource.id),history=this.inventory.history(scope,{resource_id:resource.id});
    const imported=new Map(history.movements.map((m:Row)=>[m.movement_id,m]));
    for(const movement of movements){
      const saved=imported.get(movement.movement_id) as Row|undefined;
      if(!saved)problem('MOVEMENT_NOT_IMPORTED',{movement_id:movement.movement_id});
      else if(saved.original_movement_digest!==movement.digest)throw new Error('INVENTORY_RECONCILIATION_INTEGRITY');
    }
    const nativeIds=new Set(movements.map(m=>m.movement_id));
    for(const saved of history.movements)if(!nativeIds.has(saved.movement_id))problem('MOVEMENT_SOURCE_MISSING',{movement_id:saved.movement_id});
    for(const discrepancy of history.discrepancies)problem('INVENTORY_DISCREPANCY',{discrepancy});

    const nativeSnapshots=indexed(source.snapshots(resource.id),'observation_id').map(o=>checkedNative(o,source.identity,s));
    const positionKeys=new Map<string,Row>();
    for(const row of [...movements,...nativeSnapshots,...history.snapshots,...history.owners])
      if(row.variant_id&&row.location_id)positionKeys.set(key(row.variant_id,row.location_id),{variant_id:row.variant_id,location_id:row.location_id});
    const positions=[...positionKeys.values()].sort((a,b)=>key(a.variant_id,a.location_id).localeCompare(key(b.variant_id,b.location_id))).map(position=>{
      const balance=this.inventory.balance(scope,{resource_id:resource.id,...position}),expected=stock(balance),observed=stock(source.position(position));
      if(!balance.anchored)problem('INVENTORY_ANCHOR_MISSING',position);
      if(FIELDS.some(field=>!Number.isSafeInteger(expected[field])||!Number.isSafeInteger(observed[field])))throw new Error('INVENTORY_RECONCILIATION_INTEGRITY');
      if(!same(expected,observed))problem('UNEXPLAINED_STOCK_DIFFERENCE',{...position,expected,observed});
      return {...position,source_identity:source.identity,anchor_id:balance.anchor_id,expected,observed};
    });

    const carrierLedger=this.carrier.ledger();
    const nativeCarrierEvents=indexed(carrierLedger.events,'event_id');
    const sessions=k.db.prepare('SELECT id,package_id FROM commerce_packing_sessions WHERE tenant_id=? AND store_id=? AND resource_id=? ORDER BY package_id').all(s.tenant_id,s.store_id,resource.id) as Row[];
    if(sessions.length>MAX_RECORDS)throw new Error('RECONCILIATION_LIMIT');
    const acceptedRefs=new Set<string>(),shippedUnits:Row[]=[],packages:Row[]=[];
    for(const row of sessions){
      const packed=this.packing.qualifiedPackage(scope,row.package_id),detail=this.packing.read(scope,row.id);
      if(packed.cancelled)continue;
      const membership=k.db.prepare('SELECT * FROM commerce_shipping_manifest_packages WHERE tenant_id=? AND store_id=? AND package_id=?').get(s.tenant_id,s.store_id,row.package_id) as Row|undefined;
      const b=membership?shippingBody(membership):null;
      let carrierAccepted=false,acceptanceId:string|null=null;
      if(!b||!b.carrier_accepted){problem('CARRIER_ACCEPTANCE_MISSING',{package_id:row.package_id});}
      else {
        const label=this.labels.packageStatus(scope,row.package_id),native=nativeCarrierEvents.find(e=>e.event_id===b.acceptance_event_id);
        const eventRow=k.db.prepare('SELECT * FROM commerce_shipping_manifest_events WHERE tenant_id=? AND store_id=? AND event_id=?').get(s.tenant_id,s.store_id,b.acceptance_event_id) as Row|undefined;
        const canonicalEvent=eventRow?shippingBody(eventRow):null;
        const receipt=carrierLedger.purchases.find((p:Row)=>p.purchase_id===b.command.purchase_id);
        if(b.resource_id!==resource.id||b.package_id!==row.package_id||b.command.resource_id!==resource.id||b.command.package_id!==row.package_id||b.source_identity!==this.carrier.identity||
          !packed.qualified||!packed.shipped||packed.confirmation_id!==b.command.packing_confirmation_id||packed.allocation_digest!==b.command.packing_digest||packed.package_revision!==b.command.package_revision||
          packed.packing_session_id!==b.packing_session_id||packed.packed_count!==packed.expected_count||detail.source_identity!==label.quote_source_identity||detail.units.some((u:Row)=>u.state!=='shipped')||
          label.source_identity!==this.carrier.identity||label.purchase_id!==b.command.purchase_id||label.resource_id!==resource.id||label.receipt?.native_label_id!==b.command.native_label_id||
          !receipt||receipt.native_label_id!==b.command.native_label_id||receipt.resource_id!==resource.id||receipt.package_id!==row.package_id)
          throw new Error('RECONCILIATION_SHIPMENT_BINDING_MISMATCH');
        if(!native||!canonicalEvent){problem('CARRIER_EVENT_SOURCE_MISSING',{package_id:row.package_id,event_id:b.acceptance_event_id});}
        else {
          if(native.stage!=='carrier_acceptance'||native.manifest_id!==b.manifest_id||native.package_id!==b.package_id||native.native_label_id!==b.command.native_label_id||native.source_identity!==this.carrier.identity||
            native.tenant_id!==s.tenant_id||native.store_id!==s.store_id||!same(canonicalEvent,{...native,resource_id:resource.id}))throw new Error('RECONCILIATION_SHIPMENT_BINDING_MISMATCH');
          carrierAccepted=true;acceptanceId=native.event_id;acceptedRefs.add(native.event_id);
          const parcel=this.carrier.currentParcel(row.package_id);
          if(!parcel||parcel.resource_id!==resource.id||parcel.revision!==packed.package_revision||!label.parcel_current||!label.resource_current)throw new Error('RECONCILIATION_SHIPMENT_BINDING_MISMATCH');
          const counts=new Map<string,number>();for(const unit of detail.units)counts.set(unit.sku,(counts.get(unit.sku)??0)+1);
          const matched=movements.filter(m=>m.kind==='shipment'&&m.reference_id===native.event_id);
          for(const [variant_id,quantity] of counts){
            const found=matched.filter(m=>m.variant_id===variant_id&&m.location_id===parcel.from_address_ref);
            if(found.reduce((sum,m)=>sum+m.delta.available,0)!==-quantity||found.some(m=>m.delta.on_hand!==m.delta.available||m.delta.reserved!==0||m.delta.in_transit!==0))
              problem('SHIPMENT_QUANTITY_MISMATCH',{package_id:row.package_id,variant_id,location_id:parcel.from_address_ref,expected_delta:-quantity,movement_ids:found.map(m=>m.movement_id)});
          }
          for(const movement of matched)if(!counts.has(movement.variant_id)||movement.location_id!==parcel.from_address_ref)problem('ORPHAN_SHIPMENT_MOVEMENT',{movement_id:movement.movement_id});
          for(const unit of detail.units)shippedUnits.push({...unit,package_id:row.package_id});
        }
      }
      packages.push({package_id:row.package_id,packing_session_id:row.id,confirmation_id:packed.confirmation_id,carrier_accepted:carrierAccepted,acceptance_event_id:acceptanceId,
        units:detail.units.map((u:Row)=>({line_id:u.line_id,ordinal:u.ordinal,sku:u.sku,unit_key:u.unit_key,return_links:u.return_links,state:u.state}))});
    }
    if(!packages.length)problem('SHIPMENT_CYCLE_MISSING');
    for(const movement of movements)if(movement.kind==='shipment'&&!acceptedRefs.has(movement.reference_id))problem('ORPHAN_SHIPMENT_MOVEMENT',{movement_id:movement.movement_id});

    const requests=k.db.prepare('SELECT id FROM commerce_return_requests WHERE tenant_id=? AND store_id=? AND resource_id=? ORDER BY id').all(s.tenant_id,s.store_id,resource.id) as Row[];
    const nativeEvents=this.returns.source.returnEvents().filter((e:Row)=>e.resource_id===resource.id).map((e:Row)=>checkedNative(e,source.identity,s));
    const nativeEffects=this.returns.source.effects().filter((e:Row)=>e.resource_id===resource.id);
    const returnReports:Row[]=[];
    for(const request of requests){
      const value=this.returns.read(scope,request.id),receipt=value.receipt,events=value.events.map((r:Row)=>r.event),ids=new Set(events.map((e:Row)=>e.event_id));
      const observed=nativeEvents.filter((e:Row)=>e.request_id===request.id).sort((a:Row,b:Row)=>a.sequence-b.sequence);
      for(const e of observed)if(!ids.has(e.event_id))problem('RETURN_EVENT_NOT_IMPORTED',{request_id:request.id,event_id:e.event_id});
      for(const event of events){const native=observed.find((e:Row)=>e.event_id===event.event_id);if(!native||!same(native,event))throw new Error('RECONCILIATION_RETURN_BINDING_MISMATCH');}
      for(const discrepancy of value.discrepancies)problem('RETURN_EVENT_DISCREPANCY',{request_id:request.id,discrepancy});
      const latest=new Map<string,Row>();for(const event of observed)for(const unit of event.units)latest.set(canonical([unit.line_id,unit.ordinal]),{...unit,native_return_id:event.native_return_id,event_id:event.event_id});
      for(const unit of receipt.units){
        const native=latest.get(canonical([unit.line_id,unit.ordinal]));
        if(!native||!native.received||native.variant_id!==unit.variant_id||native.grade!==unit.grade){problem('RETURN_RECEIPT_SOURCE_MISMATCH',{request_id:request.id,unit_id:unit.id});continue;}
        const linked=shippedUnits.filter(u=>u.line_id===unit.line_id&&u.sku===unit.variant_id&&(u.return_links.includes(request.id)||u.return_links.includes(native.native_return_id))).sort((a,b)=>a.ordinal-b.ordinal);
        if(!linked[unit.ordinal-1])problem('RETURN_SHIPMENT_LINK_MISSING',{request_id:request.id,unit_id:unit.id});
        const local=nativeEffects.filter((effect:Row)=>effect.request_id===request.id&&effect.units.some((u:Row)=>u.id===unit.id));
        if(native.disposition&&local.length)problem('RETURN_DISPOSITION_DUPLICATED',{request_id:request.id,unit_id:unit.id});
        if(!native.disposition&&!local.length)problem('RETURN_DISPOSITION_PENDING',{request_id:request.id,unit_id:unit.id});
      }
      const pending=receipt.lines.reduce((sum:number,line:Row)=>sum+line.missing,0);
      if(observed.at(-1)?.completeness==='complete'&&pending>0)problem('RETURN_COMPLETENESS_CONFLICT',{request_id:request.id,pending_units:pending});
      returnReports.push({request_id:request.id,source_identity:value.source_identity,received_units:receipt.total_actual,pending_units:pending,
        inspection:receipt.inspection,completeness:observed.at(-1)?.completeness??'unobserved',event_ids:events.map((e:Row)=>e.event_id),receipt_digest:receipt.digest});
    }
    for(const movement of movements){
      if(movement.origin.kind==='return_event'){
        const event=nativeEvents.find((e:Row)=>e.event_id===(movement.origin.event_id??movement.origin.id));
        const adjustment=event?.adjustments.find((a:Row)=>a.unit_id===movement.origin.unit_id);
        if(!event||!requests.some(r=>r.id===event.request_id)||!adjustment||adjustment.variant_id!==movement.variant_id||adjustment.location_id!==movement.location_id||adjustment.available_delta!==movement.delta.available||movement.delta.on_hand!==movement.delta.available||movement.delta.reserved!==0||movement.delta.in_transit!==0)
          throw new Error('RECONCILIATION_RETURN_BINDING_MISMATCH');
      }
      if(movement.origin.kind==='return_disposition'){
        const effect=nativeEffects.find((e:Row)=>e.operation_id===movement.origin.id),adjustment=effect?.adjustments.find((a:Row)=>a.unit_id===movement.origin.unit_id);
        if(!effect||!adjustment||adjustment.variant_id!==movement.variant_id||adjustment.location_id!==movement.location_id||adjustment.available_delta!==movement.delta.available)
          throw new Error('RECONCILIATION_RETURN_BINDING_MISMATCH');
      }
    }
    discrepancies.sort((a,b)=>canonical(a).localeCompare(canonical(b)));
    const partial=returnReports.some(r=>r.pending_units>0),received=returnReports.some(r=>r.received_units>0);
    return jsonValue({version:1,resource_id:resource.id,warehouse_source_identity:source.identity,carrier_source_identity:this.carrier.identity,
      reconciled: discrepancies.length === 0,cycle_state:discrepancies.length?'discrepancies':received&&partial?'partial_return_reconciled':received?'return_cycle_reconciled':'shipment_reconciled',
      positions,packages,returns:returnReports,movement_ids:movements.map(m=>m.movement_id),discrepancies,
      repair_policy:'import_existing_source_observations_only',inventory_effect:false,financial_effect:false,qualification:'synthetic_only',physical_qualified:false,connected_warehouse_qualified:false,carrier_connected:false,formal_goal_accepted:false});
  }
  repair(scope:Scope,input:unknown):Row {
    const {s,resource}=this.#context(scope,input,true),source=this.inventory.source;
    // Inspect first so tampered native/canonical lineage cannot be copied into a
    // fresh report. Missing observations and unexplained quantities stay data.
    this.inspect(scope,input);
    const requests=new Set((this.kernel.db.prepare('SELECT id FROM commerce_return_requests WHERE tenant_id=? AND store_id=? AND resource_id=?').all(s.tenant_id,s.store_id,resource.id) as Row[]).map(r=>r.id));
    const events=this.returns.source.returnEvents().filter((e:Row)=>e.resource_id===resource.id).sort((a:Row,b:Row)=>a.request_id.localeCompare(b.request_id)||a.sequence-b.sequence);
    for(const event of events){checkedNative(event,source.identity,s);if(!requests.has(event.request_id))throw new Error('RECONCILIATION_RETURN_BINDING_MISMATCH');
      this.returns.importEvent(scope,{request_id:event.request_id,event_id:event.event_id});}
    this.inventory.sync(scope,{resource_id:resource.id});
    return {report:this.inspect(scope,input),source_effects_dispatched:0,qualification:'synthetic_only',formal_goal_accepted:false};
  }
}
