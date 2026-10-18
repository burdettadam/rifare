import { exact,id } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { returnContext,lifecycleBody,receiptSummary,warehouseReceiptEvents,warehouseReceiptProjection,assertReturnWritable,lifecycleObservation } from './return-lifecycle-core.mts';
import { warehouseSettings } from './return-disposition.mts';
import { ReturnReceiving } from './return-receiving.mts';
import { assertExecution } from './execution-stops.mts';
import { assertCaseWorkerScope } from './work-leases.mts';
import { WarehouseFixtureSource } from '../adapters/warehouse-fixture-source.mts';

export class WarehouseReturnEvents {
 readonly kernel:CommerceKernel;readonly source:WarehouseFixtureSource;
 constructor(k:CommerceKernel,source:WarehouseFixtureSource){
  if(!(source instanceof WarehouseFixtureSource)||source.db===k.db)throw new Error('SEPARATE_FIXTURE_SOURCE_REQUIRED');
  const path=(db:any)=>db.prepare('PRAGMA database_list').all().find((r:Row)=>r.name==='main')?.file;
  if(path(source.db)&&path(source.db)===path(k.db))throw new Error('SEPARATE_FIXTURE_SOURCE_REQUIRED');this.kernel=k;this.source=source;
 }
 importEvent(scope:Scope,input:unknown){const p=exact(jsonValue(input),['request_id','event_id']);id(p.request_id);id(p.event_id);const k=this.kernel;
  return k.transaction(()=>{
   const ctx=returnContext(k,scope,p.request_id,'warehouse.receive'),{s,r}=ctx,settings=warehouseSettings(k,s);
   assertReturnWritable(k,s,r.id);assertCaseWorkerScope(k,scope,ctx.c.id);assertExecution(k,s,'diagnostic.warehouse.receive');
   if(this.source.identity!==settings.source_identity||this.source.tenant!==s.tenant_id||this.source.store!==s.store_id)throw new Error('WAREHOUSE_SOURCE_MISMATCH');
   const event=this.source.returnEvent(p.event_id);if(!event)throw new Error('WAREHOUSE_EVENT_NOT_FOUND');
   const n=k.db.prepare("SELECT * FROM commerce_native_return_operations WHERE tenant_id=? AND store_id=? AND request_id=? AND state='created'").get(s.tenant_id,s.store_id,r.id) as Row;
   if(!n?.native_id||event.request_id!==r.id||event.resource_id!==r.resource_id||event.native_return_id!==n.native_id)throw new Error('WAREHOUSE_RETURN_MISMATCH');
   if(contentDigest(JSON.parse(n.native_body))!==n.native_digest)throw new Error('NATIVE_RETURN_INTEGRITY');
   const previous=warehouseReceiptEvents(k,s,r.id);if(previous.some(e=>e.event.source_identity!==event.source_identity))throw new Error('WAREHOUSE_EVENT_SOURCE_CHANGED');
   const old=previous.find(e=>e.event.event_id===p.event_id);if(old){if(contentDigest(old.event)!==contentDigest(event))throw new Error('WAREHOUSE_EVENT_CONFLICT');return this.read(scope,r.id);}
   if(previous.some(e=>e.event.sequence===event.sequence))throw new Error('WAREHOUSE_EVENT_SEQUENCE_CONFLICT');
   const receiving=new ReturnReceiving(k),sessionRow=k.db.prepare('SELECT * FROM commerce_receiving_sessions WHERE tenant_id=? AND store_id=? AND request_id=?').get(s.tenant_id,s.store_id,r.id) as Row;
   const session=sessionRow?receiving.read(scope,sessionRow.id):receiving.open(scope,{request_id:r.id,location_id:settings.locations.includes(event.location_id)?event.location_id:settings.locations[0]});
   const body={event,imported_by:s.actor_id};k.db.prepare('INSERT INTO commerce_warehouse_return_events VALUES(?,?,?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,event.event_id,r.id,r.resource_id,event.source_identity,event.sequence,canonical(body),contentDigest(body),k.clock());
   const row=k.db.prepare('SELECT * FROM commerce_receiving_sessions WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,session.session_id) as Row,config=lifecycleBody(row);
   const raw=(k.db.prepare('SELECT * FROM commerce_received_units WHERE tenant_id=? AND store_id=? AND session_id=? ORDER BY id').all(s.tenant_id,s.store_id,row.id) as Row[]).map(lifecycleBody);
   const projection=warehouseReceiptProjection(k,s,r.id,config,raw);
   // Materialize a unit's first mapped receipt once, including the original grade.
   // Corrections are read from the additive event projection; scans stay immutable.
   for(const observed of projection.applied){const e=observed.event,scanId='whscan_'+contentDigest([e.source_identity,e.event_id]).slice(0,40),created:string[]=[];
    for(const u of e.units){const expected=config.expected.find((l:Row)=>l.line_id===u.line_id);
     if(!u.received||!expected||u.variant_id!==expected.variant_id||u.ordinal>expected.quantity||e.location_id!==config.location_id)continue;
     if(k.db.prepare('SELECT 1 FROM commerce_received_units WHERE tenant_id=? AND store_id=? AND request_id=? AND line_id=? AND ordinal=?').get(s.tenant_id,s.store_id,r.id,u.line_id,u.ordinal))continue;
     const unitId='whunit_'+contentDigest([e.native_return_id,u.line_id,u.ordinal]).slice(0,40),b={id:unitId,request_id:r.id,session_id:row.id,scan_id:scanId,line_id:u.line_id,ordinal:u.ordinal,variant_id:u.variant_id,grade:u.grade,location_id:e.location_id,evidence_ids:[],native_return_id:e.native_return_id,received_at:observed.observed_at,warehouse_initial_event_id:e.event_id};
     k.db.prepare('INSERT INTO commerce_received_units VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,unitId,r.id,row.id,scanId,u.line_id,u.ordinal,u.grade,canonical(b),contentDigest(b));created.push(unitId);
    }
    if(!k.db.prepare('SELECT 1 FROM commerce_receiving_scans WHERE tenant_id=? AND store_id=? AND scan_id=?').get(s.tenant_id,s.store_id,scanId)){
     const b={intent:{session_id:row.id,scan_id:scanId,items:[],source_event_id:e.event_id,source_digest:e.digest},units:created,discrepancies:[],physical_receipt_only:true,external_observation:true};
     k.db.prepare('INSERT INTO commerce_receiving_scans(tenant_id,store_id,scan_id,session_id,actor_id,body,digest,observed_at) VALUES(?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,scanId,row.id,observed.imported_by,canonical(b),contentDigest(b),observed.observed_at);
    }
   }
   k.db.prepare('UPDATE commerce_receiving_sessions SET revision=revision+1 WHERE tenant_id=? AND store_id=? AND id=?').run(s.tenant_id,s.store_id,row.id);
   lifecycleObservation(k,s,r.id,event.event_id,'warehouse_event_imported',{event_id:event.event_id,source_identity:event.source_identity,sequence:event.sequence,event_digest:event.digest,kind:event.kind,physical_effect_replayed:false});
   return this.read(scope,r.id);
  });
 }
 read(scope:Scope,requestId:string){const {s,r}=returnContext(this.kernel,scope,requestId),events=warehouseReceiptEvents(this.kernel,s,r.id),receipt=receiptSummary(this.kernel,s,r.id);
  return {request_id:r.id,resource_id:r.resource_id,events,receipt,discrepancies:receipt.discrepancies,source_identity:events[0]?.event.source_identity??null,
   physical_effects_replayed:0,execution_authorized:false,qualification:'synthetic_only',connected_warehouse_qualified:false};
 }
}
