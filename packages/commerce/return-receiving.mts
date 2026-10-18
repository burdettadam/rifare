import { exact,id,integer } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { returnContext,lifecycleBody,receiptSummary,lifecycleObservation } from './return-lifecycle-core.mts';
import { permissionDecision } from './authorization.mts';
import { assertExecution } from './execution-stops.mts';

export class ReturnReceiving {
 readonly kernel:CommerceKernel;constructor(k:CommerceKernel){this.kernel=k;}
 open(scope:Scope,input:unknown){const p=exact(jsonValue(input),['request_id','location_id']);id(p.location_id);const k=this.kernel;
  return k.transaction(()=>{const ctx=returnContext(k,scope,p.request_id,'warehouse.receive'),{s,r,c}=ctx;assertExecution(k,s,'diagnostic.warehouse.receive');
   const old=k.db.prepare('SELECT * FROM commerce_receiving_sessions WHERE tenant_id=? AND store_id=? AND request_id=?').get(s.tenant_id,s.store_id,r.id) as Row;
   if(old){if(lifecycleBody(old).location_id!==p.location_id)throw new Error('RECEIVING_LOCATION_CHANGED');return this.read(scope,old.id);}
   const n=k.db.prepare("SELECT * FROM commerce_native_return_operations WHERE tenant_id=? AND store_id=? AND request_id=? AND state='created'").get(s.tenant_id,s.store_id,r.id) as Row;
   if(!n)throw new Error('NATIVE_RETURN_REQUIRED');const native=JSON.parse(n.native_body);if(contentDigest(native)!==n.native_digest)throw new Error('NATIVE_RETURN_INTEGRITY');
   const expected=ctx.request.selection.lines.map((l:Row)=>{const line=c.order.payload.return_lines?.find((x:Row)=>x.id===l.line_id),paid=c.order.payload.resolution_facts?.paid_lines?.find((x:Row)=>x.id===l.line_id),nl=native.lines.find((x:Row)=>x.fulfillment_line_id===line?.fulfillment_line_id);
    if(!line||!paid||!nl||nl.quantity!==l.quantity)throw new Error('RECEIVING_MAPPING_REQUIRED');id(paid.variant_id);return {line_id:l.line_id,variant_id:paid.variant_id,quantity:l.quantity,native_line_id:nl.id};});
   if(expected.reduce((n:number,l:Row)=>n+l.quantity,0)>5000)throw new Error('RECEIVING_LIMIT');
   const ref='receiving_'+contentDigest([s.tenant_id,s.store_id,r.id]).slice(0,36),b={request_id:r.id,case_id:r.case_id,resource_id:r.resource_id,location_id:p.location_id,native_return_id:n.native_id,native_digest:n.native_digest,expected,created_at:k.clock()};
   k.db.prepare("INSERT INTO commerce_receiving_sessions VALUES(?,?,?,?,?,?,0,'open',?,?)").run(s.tenant_id,s.store_id,ref,r.id,r.case_id,r.resource_id,canonical(b),contentDigest(b));return this.read(scope,ref);});
 }
 #session(scope:Scope,ref:string,action='return.read'){const k=this.kernel,s=k.require(scope),r=k.db.prepare('SELECT * FROM commerce_receiving_sessions WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(ref)) as Row,b=lifecycleBody(r),ctx=returnContext(k,scope,r.request_id,action);return {...ctx,session:r,config:b};}
 read(scope:Scope,ref:string){const {s,session,config}=this.#session(scope,ref);return {...receiptSummary(this.kernel,s,session.request_id),request_id:session.request_id,location_id:config.location_id,execution_authorized:false,qualified_warehouse:false};}
 scan(scope:Scope,input:unknown){const p=exact(jsonValue(input),['session_id','scan_id','expected_revision','items']);id(p.scan_id);integer(p.expected_revision);
  if(!Array.isArray(p.items)||p.items.length>100)throw new Error('INVALID_INPUT');let count=0;
  for(const item of p.items){exact(item,['line_id','observed_variant','quantity','grade','evidence_ids']);if(item.line_id!==null)id(item.line_id);id(item.observed_variant);integer(item.quantity,1);count+=item.quantity;
   if(!['sellable','damaged','unknown'].includes(item.grade)||!Array.isArray(item.evidence_ids)||item.evidence_ids.length>10||new Set(item.evidence_ids).size!==item.evidence_ids.length)throw new Error('INVALID_INPUT');item.evidence_ids.forEach(id);}
  if(count>500)throw new Error('RECEIVING_LIMIT');const k=this.kernel;
  return k.transaction(()=>{const {s,session,config}=this.#session(scope,p.session_id,'warehouse.receive');assertExecution(k,s,'diagnostic.warehouse.receive');
   const intent={session_id:p.session_id,scan_id:p.scan_id,items:p.items},old=k.db.prepare('SELECT * FROM commerce_receiving_scans WHERE tenant_id=? AND store_id=? AND scan_id=?').get(s.tenant_id,s.store_id,p.scan_id) as Row;
   if(old){if(contentDigest(lifecycleBody(old).intent)!==contentDigest(intent))throw new Error('RECEIPT_KEY_CONFLICT');return this.read(scope,session.id);}
   if(session.state!=='open'||session.revision!==p.expected_revision)throw new Error('RECEIVING_CHANGED');
   const total=k.db.prepare('SELECT count(*) AS n FROM commerce_received_units WHERE tenant_id=? AND store_id=? AND request_id=?').get(s.tenant_id,s.store_id,session.request_id) as Row;if(total.n+count>10000)throw new Error('RECEIVING_LIMIT');
   const discrepancies:string[]=[],created:string[]=[];if(!p.items.length)discrepancies.push('empty_parcel');
   for(const item of p.items){for(const ref of item.evidence_ids){const e=k.db.prepare('SELECT * FROM commerce_return_evidence WHERE tenant_id=? AND store_id=? AND id=? AND case_id=?').get(s.tenant_id,s.store_id,ref,session.case_id) as Row;if(!e||e.state!=='clean'||e.expires_at<=k.clock())throw new Error('RECEIVING_EVIDENCE_UNAVAILABLE');}
    const line=config.expected.find((l:Row)=>l.line_id===item.line_id),matched=line&&line.variant_id===item.observed_variant;
    for(let i=0;i<item.quantity;i++){let ordinal:number|null=null,lineId:string|null=null;
     const current=line?(k.db.prepare('SELECT count(*) AS n FROM commerce_received_units WHERE tenant_id=? AND store_id=? AND request_id=? AND line_id=?').get(s.tenant_id,s.store_id,session.request_id,line.line_id) as Row).n:0;
     if(matched&&current<line.quantity){lineId=line.line_id;ordinal=current+1;}else discrepancies.push(matched?'extra_unit':'wrong_item');
     if(item.grade!=='sellable')discrepancies.push(item.grade==='damaged'?'damaged_unit':'inspection_required');
     const unitId='unit_'+contentDigest([s.tenant_id,s.store_id,p.scan_id,created.length]).slice(0,40),b={id:unitId,request_id:session.request_id,session_id:session.id,scan_id:p.scan_id,line_id:lineId,ordinal,variant_id:item.observed_variant,grade:item.grade,location_id:config.location_id,evidence_ids:item.evidence_ids,native_return_id:config.native_return_id,received_at:k.clock()};
     k.db.prepare('INSERT INTO commerce_received_units VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,unitId,session.request_id,session.id,p.scan_id,lineId,ordinal,item.grade,canonical(b),contentDigest(b));created.push(unitId);
    }
   }
   const b={intent,units:created,discrepancies:[...new Set(discrepancies)],physical_receipt_only:true};
   k.db.prepare('INSERT INTO commerce_receiving_scans(tenant_id,store_id,scan_id,session_id,actor_id,body,digest,observed_at) VALUES(?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,p.scan_id,session.id,s.actor_id,canonical(b),contentDigest(b),k.clock());
   k.db.prepare('UPDATE commerce_receiving_sessions SET revision=revision+1 WHERE tenant_id=? AND store_id=? AND id=?').run(s.tenant_id,s.store_id,session.id);return this.read(scope,session.id);
  });
 }
 close(scope:Scope,input:unknown){const p=exact(jsonValue(input),['session_id','expected_revision']);integer(p.expected_revision);const k=this.kernel;
  return k.transaction(()=>{const {s,session}=this.#session(scope,p.session_id,'warehouse.receive');assertExecution(k,s,'diagnostic.warehouse.receive');if(session.revision!==p.expected_revision||session.state!=='open')throw new Error('RECEIVING_CHANGED');
   k.db.prepare("UPDATE commerce_receiving_sessions SET revision=revision+1,state='closed' WHERE tenant_id=? AND store_id=? AND id=?").run(s.tenant_id,s.store_id,session.id);return this.read(scope,session.id);});}
 review(scope:Scope,input:unknown){const p=exact(jsonValue(input),['session_id','revision','decision','reason']);integer(p.revision);if(!['accept','hold'].includes(p.decision)||!['observed_condition','wrong_contents','missing_contents'].includes(p.reason))throw new Error('INVALID_INPUT');const k=this.kernel;
  return k.transaction(()=>{const {s,session}=this.#session(scope,p.session_id,'return.review');if(session.revision!==p.revision||session.state!=='closed')throw new Error('RECEIVING_CHANGED');
   if(k.db.prepare('SELECT 1 FROM commerce_receiving_scans WHERE tenant_id=? AND store_id=? AND session_id=? AND actor_id=?').get(s.tenant_id,s.store_id,session.id,s.actor_id))throw new Error('SELF_REVIEW_DENIED');
   const summary=receiptSummary(k,s,session.request_id);if(p.decision==='accept'&&(summary.lines.some((l:Row)=>l.missing>0)||summary.units.some(u=>u.grade==='unknown'||u.line_id===null)
    ||summary.discrepancies.some((reason:string)=>reason.startsWith('warehouse_')||reason==='missing_source_event')))throw new Error('DISCREPANCY_REQUIRES_FOLLOWUP');
   const rev=permissionDecision(k.db,s,'return.review',session.resource_id).authority_revision;
   k.db.prepare('INSERT INTO commerce_receiving_reviews(tenant_id,store_id,session_id,revision,actor_id,authority_revision,decision,reason,observed_at) VALUES(?,?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,session.id,p.revision,s.actor_id,rev,p.decision,p.reason,k.clock());
   lifecycleObservation(k,s,session.request_id,session.id,'receiving_review',{revision:p.revision,decision:p.decision,reason:p.reason,actor_id:s.actor_id});return this.read(scope,session.id);});}
}
