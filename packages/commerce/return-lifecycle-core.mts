import { id,integer } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest } from './configuration-values.mts';
import { CaseConfigurations } from './case-configurations.mts';
import { permissionDecision } from './authorization.mts';

export const LIFECYCLE_ACTIONS=Object.freeze({disposition:'diagnostic.warehouse.disposition',cancel:'diagnostic.return.cancel'});
export function lifecycleBody(r:Row|undefined){if(!r)throw new Error('NOT_FOUND');const b=JSON.parse(r.body);if(contentDigest(b)!==r.digest)throw new Error('LIFECYCLE_INTEGRITY');return b;}
export function returnContext(k:CommerceKernel,scope:Scope,requestId:string,action='return.read',active=false){
 const s=k.require(scope),r=k.db.prepare('SELECT * FROM commerce_return_requests WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(requestId)) as Row;
 const request=lifecycleBody(r),cases=new CaseConfigurations(k),c=active?cases.resume(scope,r.case_id):cases.inspect(scope,r.case_id);k.authorize(scope,action,r.resource_id);
 if(c.resource_id!==r.resource_id||request.selection.case_id!==r.case_id)throw new Error('LIFECYCLE_INTEGRITY');
 return {s,r,request,c};
}

// The event log is additive. Original scans and received-unit bodies stay intact;
// only their effective projection changes after an explicitly linked observation.
export function warehouseReceiptEvents(k:CommerceKernel,s:Row,requestId:string){
 return (k.db.prepare('SELECT * FROM commerce_warehouse_return_events WHERE tenant_id=? AND store_id=? AND request_id=? ORDER BY sequence,event_id').all(s.tenant_id,s.store_id,requestId) as Row[]).map(row=>{
  const body=lifecycleBody(row),e=body.event,{digest,...native}=e;
  if(contentDigest(native)!==digest||e.event_id!==row.event_id||e.request_id!==requestId||e.resource_id!==row.resource_id||e.source_identity!==row.source_identity
   ||e.sequence!==row.sequence||e.tenant_id!==s.tenant_id||e.store_id!==s.store_id)throw new Error('LIFECYCLE_INTEGRITY');
  return {event:e,imported_by:body.imported_by,observed_at:row.observed_at};
 });
}
export function warehouseReceiptProjection(k:CommerceKernel,s:Row,requestId:string,config:Row,rawUnits:Row[]){
 const history=warehouseReceiptEvents(k,s,requestId),discrepancies:string[]=[],applied:Row[]=[],latest=new Map<string,Row>(),fences=new Set<string>();
 let next=1;const source=history[0]?.event.source_identity;
 for(const record of history){const e=record.event;
  for(const u of e.units)if(u.disposition!==null)fences.add(u.line_id+':'+u.ordinal);
  if(e.source_identity!==source){discrepancies.push('warehouse_source_ownership_conflict');continue;}
  if(e.sequence!==next){discrepancies.push('missing_source_event');continue;}next++;
  if(e.native_return_id!==config.native_return_id){discrepancies.push('warehouse_return_mapping_conflict');continue;}
  if(e.kind==='delivery'){applied.push(record);continue;}
  if(e.parent_event_id!==null&&!applied.some(r=>r.event.event_id===e.parent_event_id)){discrepancies.push('warehouse_correction_parent_missing');continue;}
  for(const u of e.units){const key=u.line_id+':'+u.ordinal,old=latest.get(key);
   if(e.parent_event_id!==null&&old?.event.event_id!==e.parent_event_id){discrepancies.push('warehouse_correction_parent_changed');continue;}
   latest.set(key,{unit:u,event:e});if(u.disposition!==null)fences.add(key);
  }
  applied.push(record);
 }
 if(history.some(r=>r.event.kind==='delivery')&&!latest.size)discrepancies.push('delivery_without_receipt');
 const units:Row[]=[];
 for(const raw of rawUnits){const key=raw.line_id+':'+raw.ordinal,observed=latest.get(key);if(!observed){units.push(fences.has(key)?{...raw,warehouse_disposition_fenced:true}:raw);continue;}
  const {unit:u,event:e}=observed;
  if(e.location_id!==config.location_id||u.variant_id!==raw.variant_id){discrepancies.push('warehouse_receipt_conflict');continue;}
  if(!u.received)continue;
  if(e.kind==='receipt'&&u.grade!==raw.grade){discrepancies.push('warehouse_receipt_conflict');continue;}
  units.push({...raw,grade:u.grade,location_id:e.location_id,warehouse_event_id:e.event_id,warehouse_event_digest:e.digest,
   warehouse_source_identity:e.source_identity,warehouse_evidence_ids:e.evidence_ids,warehouse_operator_id:e.operator_id,
   warehouse_disposition:u.disposition,warehouse_disposition_fenced:fences.has(key)});
 }
 for(const {unit:u,event:e} of latest.values()){
  const line=config.expected.find((l:Row)=>l.line_id===u.line_id);
  if(e.location_id!==config.location_id)discrepancies.push('warehouse_location_conflict');
  if(!line||u.variant_id!==line.variant_id||u.ordinal>line.quantity)discrepancies.push('warehouse_item_mapping_conflict');
 }
 if(history.at(-1)?.event.completeness==='complete'&&config.expected.some((line:Row)=>units.filter(u=>u.line_id===line.line_id).length<line.quantity))discrepancies.push('declared_complete_but_units_missing');
 return {history,applied,units,discrepancies:[...new Set(discrepancies)],latest,fences};
}
export function receiptSummary(k:CommerceKernel,s:Row,requestId:string){
 const session=k.db.prepare('SELECT * FROM commerce_receiving_sessions WHERE tenant_id=? AND store_id=? AND request_id=?').get(s.tenant_id,s.store_id,requestId) as Row;
 if(!session)return {session_id:null,revision:0,state:'not_started',lines:[],total_actual:0,expected_received:0,inspection:'pending',requires_review:false,reviewed:false,units:[],discrepancies:[],digest:contentDigest(null)};
 const config=lifecycleBody(session),rawUnits=(k.db.prepare('SELECT * FROM commerce_received_units WHERE tenant_id=? AND store_id=? AND session_id=? ORDER BY id').all(s.tenant_id,s.store_id,session.id) as Row[]).map(lifecycleBody);
 const projection=warehouseReceiptProjection(k,s,requestId,config,rawUnits),units=projection.units;
 const scans=(k.db.prepare('SELECT * FROM commerce_receiving_scans WHERE tenant_id=? AND store_id=? AND session_id=? ORDER BY seq').all(s.tenant_id,s.store_id,session.id) as Row[]).map(lifecycleBody);
 const lines=config.expected.map((l:Row)=>({line_id:l.line_id,variant_id:l.variant_id,expected:l.quantity,received:units.filter(u=>u.line_id===l.line_id).length,missing:Math.max(0,l.quantity-units.filter(u=>u.line_id===l.line_id).length)}));
 const scanDiscrepancies=scans.flatMap(b=>b.discrepancies),discrepancies=projection.history.length?[...new Set([...scanDiscrepancies,...projection.discrepancies])]:scanDiscrepancies,complete=lines.every((l:Row)=>l.missing===0),inspected=units.every(u=>u.grade!=='unknown');
 const review=k.db.prepare('SELECT * FROM commerce_receiving_reviews WHERE tenant_id=? AND store_id=? AND session_id=? AND revision=?').get(s.tenant_id,s.store_id,session.id,session.revision) as Row;
 const member=review&&k.db.prepare('SELECT * FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND active=1').get(s.tenant_id,s.store_id,review.actor_id) as Row;
 const authority=member&&permissionDecision(k.db,member,'return.review',session.resource_id);
 const reviewed=!!review&&review.decision==='accept'&&authority?.allowed&&authority.authority_revision===review.authority_revision;
 const exceptional=discrepancies.length>0||units.some(u=>u.grade!=='sellable');
 const summary={session_id:session.id,revision:session.revision,state:session.state,lines,total_actual:units.length,expected_received:units.filter(u=>u.line_id!==null).length,
  inspection:inspected&&complete&&session.state==='closed'&&!projection.discrepancies.length?'complete':'pending',requires_review:!complete||!inspected||session.state!=='closed'||projection.discrepancies.length>0||(exceptional&&!reviewed),reviewed,units,discrepancies,
  ...(projection.history.length?{warehouse_events:projection.history.map(r=>({event_id:r.event.event_id,digest:r.event.digest,sequence:r.event.sequence,completeness:r.event.completeness,applied:projection.applied.some(a=>a.event.event_id===r.event.event_id)}))}:{})};
 return {...summary,digest:contentDigest(summary)};
}
export function closureState(k:CommerceKernel,s:Row,requestId:string){const r=k.db.prepare('SELECT * FROM commerce_return_closures WHERE tenant_id=? AND store_id=? AND request_id=?').get(s.tenant_id,s.store_id,requestId) as Row;return r?{...lifecycleBody(r),state:r.state,receipt_id:r.receipt_id,revision:r.revision}:null;}
export function assertReturnWritable(k:CommerceKernel,s:Row,requestId:string,cleanup=false){
 if(!cleanup&&closureState(k,s,requestId))throw new Error('RETURN_CLOSED');
 const setting=k.db.prepare('SELECT * FROM commerce_native_change_settings WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row;
 if(setting){const cfg=lifecycleBody(setting);if(cfg.enabled&&!cleanup){const snap=k.db.prepare('SELECT * FROM commerce_native_change_snapshots WHERE tenant_id=? AND store_id=? AND request_id=?').get(s.tenant_id,s.store_id,requestId) as Row;
  if(!snap||cfg.expires_at<=k.clock()||snap.observed_at+cfg.max_age_ms<=k.clock()||snap.source_identity!==cfg.source_identity)throw new Error('NATIVE_REFRESH_REQUIRED');
  const b=lifecycleBody(snap);if(!b.exists||!['OPEN','CLOSED'].includes(b.return_status)||b.conflicts?.length)throw new Error('NATIVE_CHANGE_REVIEW_REQUIRED');}}
}
export function assertResolutionReceipt(k:CommerceKernel,s:Row,requestId:string,lineId:string,units:number[],resourceId:string){
 assertReturnWritable(k,s,requestId);
 for(const index of units){integer(index,1);if(k.db.prepare('SELECT 1 FROM commerce_native_completed_units WHERE tenant_id=? AND store_id=? AND resource_id=? AND line_id=? AND unit_index=?').get(s.tenant_id,s.store_id,resourceId,lineId,index))throw new Error('UNIT_EXTERNALLY_RESOLVED');}
 const summary=receiptSummary(k,s,requestId);if(summary.session_id&&(summary.requires_review||summary.lines.find((l:Row)=>l.line_id===lineId)?.received<units.length))throw new Error('RECEIVING_REVIEW_REQUIRED');
}
export function lifecycleObservation(k:CommerceKernel,s:Row,requestId:string,operation:string,stage:string,body:Row){
 k.db.prepare('INSERT INTO commerce_lifecycle_observations(tenant_id,store_id,request_id,operation_id,stage,body,digest,observed_at) VALUES(?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,requestId,operation,stage,canonical(body),contentDigest(body),k.clock());
}
