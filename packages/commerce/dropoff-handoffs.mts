import {id,integer} from './kernel.mts';
import type {CommerceKernel,Scope,Row} from './kernel.mts';
import {canonical,contentDigest} from './configuration-values.mts';
import {permissionDecision} from './authorization.mts';
import {subjectHash} from './data-guards.mts';
import {assertExecution} from './execution-stops.mts';
import {returnContext,assertReturnWritable} from './return-lifecycle-core.mts';
import {dropoffHuman,dropoffShape} from './dropoff-credential-values.mts';
import {authorizeDropoffRead} from './dropoff-credential-records.mts';
import {DROPOFF_HANDOFF_ACTION,handoffId,handoffManifest,handoffBinding,handoffHistory,handoffProjection} from './dropoff-handoff-values.mts';
import {handoffIssued,handoffNativeAnchor,dropoffHandoffRecords,saveHandoffRow} from './dropoff-handoff-records.mts';
import {DropoffHandoffFixtureSource} from '../adapters/dropoff-handoff-fixture-source.mts';
import type {PartnerFixtureSource} from '../adapters/partner-fixture-source.mts';

function authorized(k:CommerceKernel,scope:Scope,issueId:string,reconcile=false){
  const s=dropoffHuman(k,scope),issued=handoffIssued(k,s,issueId);authorizeDropoffRead(k,scope,issued,reconcile);return {s,issued};
}
function current(k:CommerceKernel,scope:Scope,issueId:string){
  const {s,issued}=authorized(k,scope,issueId,true),b=issued.record.body,q=issued.quote.body.terms;
  if(b.authority_revoked||b.minimized||b.restored||issued.quote.body.authority_revoked||!q)throw new Error('DROPOFF_HANDOFF_AUTHORITY_REVOKED');
  const ctx=returnContext(k,scope,q.request_id,'operation.read'),anchor=handoffNativeAnchor(k,s,issued,q.request_id),order=k.get(scope,b.resource_id);
  if(ctx.c.id!==q.case_id||ctx.c.resource_id!==b.resource_id||ctx.c.customer_id!==q.customer_id||order.customer_id!==q.customer_id||subjectHash(s.tenant_id,s.store_id,order.customer_id)!==b.subject_ref||ctx.r.digest!==q.request_digest)throw new Error('DROPOFF_HANDOFF_MAPPING_CHANGED');
  assertReturnWritable(k,s,q.request_id);const control=assertExecution(k,s,DROPOFF_HANDOFF_ACTION),expected=handoffManifest(q.items,b.family_ref,b.items_digest).map(u=>u.unit_ref);
  const stamp=contentDigest({actor:s.actor_id,role:s.role,authority:permissionDecision(k.db,s,'operation.reconcile',b.resource_id).authority_revision,read_authority:permissionDecision(k.db,s,'operation.read',b.resource_id).authority_revision,control:control.stamp,command:issued.command,request:ctx.r,case:ctx.c,resource:order,native:anchor.native,record:issued.record,quote:issued.quote});
  return {s,issued,q,anchor,expected,stamp};
}
function sourceBound(k:CommerceKernel,partner:PartnerFixtureSource,source:DropoffHandoffFixtureSource|undefined,issued:Row){
  if(!(source instanceof DropoffHandoffFixtureSource))throw new Error('DROPOFF_HANDOFF_OWNER_MISMATCH');
  DropoffHandoffFixtureSource.prototype.assertAttached.call(source,k.db);const c=issued.command,credentials=source.credentials;
  if(credentials.directory.partner!==partner||partner.db!==source.db||credentials.identity!==c.source_identity||credentials.account!==c.source_account_id||credentials.directory.identity!==c.directory_identity||source.tenant!==c.tenant_id||source.store!==c.store_id)throw new Error('DROPOFF_HANDOFF_OWNER_MISMATCH');return source;
}
function selectedEvent(source:DropoffHandoffFixtureSource,id:string,issued:Row){
  const raw=source.event(id);if(!raw)throw new Error('DROPOFF_HANDOFF_NOT_FOUND');const event=handoffBinding(raw,issued.command,issued.record.body.observation);
  if(event.event_id!==id)throw new Error('DROPOFF_HANDOFF_SOURCE_CHANGED');
  const original=DropoffHandoffFixtureSource.prototype.journal.call(source).find(e=>e.event_id===id);
  if(!original||canonical(original)!==canonical(event))throw new Error('DROPOFF_HANDOFF_SOURCE_CHANGED');return event;
}
function projection(k:CommerceKernel,scope:Scope,issueId:string){
  const {s,issued}=authorized(k,scope,issueId),b=issued.record.body,records=dropoffHandoffRecords(k,s).filter(r=>r.body.event.family_ref===b.family_ref),first=records[0]?.body,q=issued.quote.body.terms;
  if(!first&&!q)throw new Error('DROPOFF_HANDOFF_NOT_FOUND');
  if(!b.authority_revoked&&!b.restored&&!b.minimized){const order=k.get(scope,b.resource_id);if(!q||order.customer_id!==q.customer_id||subjectHash(s.tenant_id,s.store_id,order.customer_id)!==b.subject_ref)throw new Error('DROPOFF_HANDOFF_MAPPING_CHANGED');}
  const minimized=b.minimized,expected=first?.expected_units??handoffManifest(q.items,b.family_ref,b.items_digest).map(u=>u.unit_ref),items=minimized?null:(first?.personal.items??q.items);
  return handoffProjection(issued.command,expected,items,records.map(r=>r.body.event),b.authority_revoked||b.restored,minimized);
}
export function readDropoffHandoff(k:CommerceKernel,scope:Scope,issueId:string){id(issueId);return k.transaction(()=>projection(k,scope,issueId));}
export function importDropoffHandoff(k:CommerceKernel,partner:PartnerFixtureSource,source:DropoffHandoffFixtureSource|undefined,scope:Scope,input:unknown){
  const p=dropoffShape(input,['issue_operation_id','event_id']);id(p.issue_operation_id);id(p.event_id);
  return k.transaction(()=>{
    const before=current(k,scope,p.issue_operation_id),provider=sourceBound(k,partner,source,before.issued),event=selectedEvent(provider,p.event_id,before.issued),records=dropoffHandoffRecords(k,before.s),old=records.find(r=>r.id===handoffId(event)),family=records.filter(r=>r.body.event.family_ref===event.family_ref);
    if(event.observed_at>k.clock())throw new Error('DROPOFF_HANDOFF_SOURCE_CHANGED');
    if(old){if(canonical(old.body.event)!==canonical(event))throw new Error('DROPOFF_HANDOFF_EVENT_CONFLICT');}
    else handoffHistory([...family.map(r=>r.body.event),event],before.expected);
    // Public lookup is the final transport read. Recheck authority and mapping
    // after it: even a genuine returned envelope may accompany a state change.
    const final=selectedEvent(provider,p.event_id,before.issued);sourceBound(k,partner,provider,before.issued);
    const after=current(k,scope,p.issue_operation_id);
    if(canonical(final)!==canonical(event)||after.stamp!==before.stamp)throw new Error('DROPOFF_HANDOFF_FINAL_RECHECK_CHANGED');
    if(old)return projection(k,scope,p.issue_operation_id);
    // Assigned isolated fault seam: validation precedes local materialization.
    const storedEvent=event;
    const body={schema_version:1,kind:'dropoff_event',tenant_id:before.s.tenant_id,store_id:before.s.store_id,id:handoffId(event),resource_id:event.resource_id,subject_ref:event.subject_ref,issue_operation_id:event.issue_operation_id,quote_id:before.q.quote_id,quote_digest:before.issued.command.quote_digest,command_digest:event.command_digest,expected_units:before.expected,event:storedEvent,personal:{request_id:before.q.request_id,case_id:before.q.case_id,native_return_id:before.anchor.native.native_id,items:before.q.items},imported_by:before.s.actor_id,imported_at:integer(k.clock()),authority_revoked:false,minimized:false};
    saveHandoffRow(k,body);return projection(k,scope,p.issue_operation_id);
  });
}
