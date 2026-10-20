import type {CommerceKernel,Row} from './kernel.mts';
import {canonical,contentDigest,jsonValue} from './configuration-values.mts';
import {exact,id} from './kernel.mts';
import {saveDocument} from './support-core.mts';
import {operationRow,transitionOperation} from './operation-store.mts';
import {FOLLOWUP_KIND,FOLLOWUP_MAX_ROWS,FOLLOWUP_STEP,checkedFollowupRecords,followupRecords,followupHeld,
  followupPin,followupDeliveryIntent,followupDeliveryId,redactedFollowupBody,redactFollowup,revokeFollowup} from './journey-followup-records.mts';
import type {FollowupRecord} from './journey-followup-records.mts';

function groups(rows:FollowupRecord[]) {
  const result=new Map<string,FollowupRecord[]>();
  for(const row of rows){const key=canonical([row.tenant_id,row.store_id,row.id]),group=result.get(key)??[];group.push(row);result.set(key,group);}
  return [...result.values()];
}

/** Identify the original native copies even after the retained subject loses
 * every current resource. Native delivery columns still bind its original ID. */
export function followupCopies(k:CommerceKernel,rows:FollowupRecord[]) {
  const latest=rows.at(-1)!;if(!latest)return [];const b=latest.body,s=latest;
  const deliveries=k.db.prepare('SELECT * FROM commerce_support_deliveries WHERE tenant_id=? AND store_id=? AND case_id=? AND resource_id=? LIMIT ?')
    .all(s.tenant_id,s.store_id,b.case_id,b.resource_id,FOLLOWUP_MAX_ROWS+1) as Row[];
  if(deliveries.length>FOLLOWUP_MAX_ROWS)throw new Error('JOURNEY_FOLLOWUP_ROW_LIMIT');
  const result:Row[]=[];
  for(const row of deliveries) {
    const payload=jsonValue(JSON.parse(row.body)),intent=followupDeliveryIntent(s.tenant_id,s.store_id,row.case_id,row.link_id,row.sender_id,b.job_id),
      expected=followupDeliveryId(s.tenant_id,s.store_id,intent),claimed=payload?.journey_followup?.job_id===b.job_id;
    if(row.operation_id!==expected&&!claimed)continue;
    if(row.operation_id!==expected||contentDigest(payload)!==row.digest)throw new Error('JOURNEY_FOLLOWUP_INTEGRITY');
    if(row.erased){if(payload.redacted!==true)throw new Error('JOURNEY_FOLLOWUP_INTEGRITY');result.push({row,payload,erased:true});continue;}
    const pin=exact(payload.journey_followup,['job_id','guard_id','guard_version','guard_digest']);
    const guard=followupPin({guard_id:pin.guard_id,guard_version:pin.guard_version,guard_digest:pin.guard_digest}),original=rows.find(r=>r.version===guard.guard_version);
    if(pin.job_id!==b.job_id||guard.guard_id!==latest.id||!original||payload.kind!=='email'||payload.template_id!==FOLLOWUP_STEP||
      payload.case_id!==b.case_id||payload.resource_id!==b.resource_id||payload.link_id!==row.link_id||row.kind!=='email'||row.purpose!=='transactional'||
      latest.state==='active'&&(latest.version!==original.version||original.digest!==guard.guard_digest))throw new Error('JOURNEY_FOLLOWUP_INTEGRITY');
    const op=operationRow(k,s,row.operation_id),command=JSON.parse(op.command);
    if(op.resource_id!==b.resource_id||op.source_kind!=='event'||op.source_id!==intent||command.action!=='customer.message'||
      command.resource_id!==b.resource_id||command.source_id!==intent||command.payload_digest!==row.digest)throw new Error('JOURNEY_FOLLOWUP_INTEGRITY');
    result.push({row,payload,op,erased:false});
  }
  return result;
}

function cancelUnattempted(k:CommerceKernel,s:Row,copy:Row) {
  if(copy.erased)return;const {row,op}=copy;
  const work=k.db.prepare('SELECT * FROM commerce_operation_work WHERE tenant_id=? AND store_id=? AND operation_id=?')
    .get(s.tenant_id,s.store_id,op.id) as Row;
  if(!work)throw new Error('JOURNEY_FOLLOWUP_INTEGRITY');
  if(op.state!=='queued'||work.state!=='pending'||work.attempts!==0||work.lease_token!==null||work.lease_until!==null||work.owner!==null||
    row.observation!==null||row.observation_digest!==null||op.provider_ref!==null)return;
  const history=k.db.prepare('SELECT * FROM commerce_operation_receipts WHERE tenant_id=? AND store_id=? AND operation_id=? ORDER BY seq LIMIT ?')
    .all(s.tenant_id,s.store_id,op.id,FOLLOWUP_MAX_ROWS+1) as Row[];
  if(!history.length||history.length>FOLLOWUP_MAX_ROWS)throw new Error('JOURNEY_FOLLOWUP_INTEGRITY');
  let previous:null|string=null;
  for(const receipt of history) {
    const body=JSON.parse(receipt.body);
    if(contentDigest(body)!==receipt.digest||body.id!==receipt.id||body.operation_id!==op.id||body.tenant_id!==s.tenant_id||
      body.store_id!==s.store_id||body.resource_ref!==op.resource_id||body.previous_digest!==previous)throw new Error('JOURNEY_FOLLOWUP_INTEGRITY');
    if(!['queued','payload_attached','payload_erased'].includes(body.code)||body.state!=='queued')return;
    previous=receipt.digest;
  }
  // The enclosing lifecycle transaction rechecks all native predicates before
  // releasing this operation's stream position; no send or lease is created.
  const changed=k.db.prepare("UPDATE commerce_operation_work SET state='dead',last_code='FINAL_AUTHORIZATION_DENIED' WHERE tenant_id=? AND store_id=? AND operation_id=? AND state='pending' AND attempts=0 AND lease_token IS NULL AND lease_until IS NULL AND owner IS NULL")
    .run(s.tenant_id,s.store_id,op.id);
  if(changed.changes!==1)throw new Error('JOURNEY_FOLLOWUP_INTEGRITY');
  transitionOperation(k,{...s,actor_id:s.actor_id??'journey_followup_lifecycle'},op.id,'failed','provider_rejected');
}
function cancelJobs(k:CommerceKernel,rows:FollowupRecord[]) {
  const r=rows.at(-1)!;
  k.db.prepare("UPDATE commerce_support_rule_jobs SET state='cancelled' WHERE tenant_id=? AND store_id=? AND id=? AND state='waiting'")
    .run(r.tenant_id,r.store_id,r.body.job_id);
}

/** Normal invalidation appends one tombstone; copied contexts are scrubbed in
 * place by the restore owner, preserving its original native import identities. */
export function retireFollowup(k:CommerceKernel,s:Row,rows:FollowupRecord[],reason:string) {
  return k.transaction(()=>{
    const latest=rows.at(-1)!;if(!latest)throw new Error('JOURNEY_FOLLOWUP_INTEGRITY');
    const copies=followupCopies(k,rows),held=rows.some(row=>followupHeld(k,row)),terminal=latest.body.status==='redacted';
    const selectedReason=terminal?latest.body.reason:reason;
    if(!terminal&&followupRecords(k,s).length>=FOLLOWUP_MAX_ROWS)throw new Error('JOURNEY_FOLLOWUP_ROW_LIMIT');
    for(const row of rows)if(row.body.status==='current'){if(held)revokeFollowup(k,row);else redactFollowup(k,row,selectedReason);}
    if(!terminal)saveDocument(k,{...s,actor_id:FOLLOWUP_KIND},FOLLOWUP_KIND,latest.id,latest.version,redactedFollowupBody(latest.body,selectedReason),'revoked');
    cancelJobs(k,rows);for(const copy of copies)cancelUnattempted(k,s,copy);
  });
}
export function preflightFollowups(k:CommerceKernel,scope?:Row,original?:Record<string,Row[]>) {
  followupRecords(k,scope);
  if(original)checkedFollowupRecords((original.commerce_support_documents??[]).filter(row=>row.kind===FOLLOWUP_KIND),k.clock());
}
export function hasFollowupSubject(k:CommerceKernel,t:string,s:string,subject:string) {
  return followupRecords(k,{tenant_id:t,store_id:s}).some(row=>row.body.subject_ref===subject);
}
export function exportFollowupSubject(k:CommerceKernel,t:string,s:string,subject:string) {
  return followupRecords(k,{tenant_id:t,store_id:s}).filter(row=>row.body.subject_ref===subject).map(row=>{
    const held=followupHeld(k,row);if(row.state==='revoked'&&row.body.status==='current'&&!held)redactFollowup(k,row,'unavailable');
    return {id:row.id,case_id:row.body.case_id,resource_id:row.body.resource_id,version:row.version,state:row.state,job_id:row.body.job_id,
      retained_under_hold:held&&row.body.status==='current',subject_projection:true};
  });
}
export function eraseFollowupSubject(k:CommerceKernel,t:string,s:string,subject:string,actor?:string) {
  for(const rows of groups(followupRecords(k,{tenant_id:t,store_id:s}).filter(row=>row.body.subject_ref===subject))) {
    const copies=followupCopies(k,rows),latest=rows.at(-1)!,scope={tenant_id:t,store_id:s,actor_id:actor??'journey_followup_lifecycle'};
    for(const copy of copies) {
      cancelUnattempted(k,scope,copy);if(copy.erased)continue;
      const body={redacted:true,original_digest:copy.row.digest};
      k.db.prepare("UPDATE commerce_support_deliveries SET body=?,digest=?,observation=NULL,observation_digest=NULL,erased=1,owner_session_hash='revoked' WHERE tenant_id=? AND store_id=? AND operation_id=?")
        .run(canonical(body),contentDigest(body),t,s,copy.row.operation_id);
    }
    k.db.prepare("UPDATE commerce_support_rule_jobs SET state='cancelled',event_body='{\"redacted\":true}',result=NULL WHERE tenant_id=? AND store_id=? AND id=?")
      .run(t,s,latest.body.job_id);
    for(const row of rows)redactFollowup(k,row,'subject_erased');
  }
}
export function revokeFollowupsForUninstall(k:CommerceKernel,t:string,s:string) {
  for(const rows of groups(followupRecords(k,{tenant_id:t,store_id:s}))) {
    const copies=followupCopies(k,rows);
    for(const row of rows)if(row.body.status==='current'){if(followupHeld(k,row))revokeFollowup(k,row);else redactFollowup(k,row,'uninstalled');}
    cancelJobs(k,rows);for(const copy of copies)cancelUnattempted(k,{tenant_id:t,store_id:s},copy);
  }
}
export function revokeFollowupsForRestore(k:CommerceKernel,t?:string,s?:string) {
  const rows=followupRecords(k,t===undefined?undefined:{tenant_id:t,store_id:s});
  const suppressed=(r:Row)=>!!k.db.prepare('SELECT 1 FROM commerce_privacy_subjects WHERE tenant_id=? AND store_id=? AND subject_hash=?')
    .get(r.tenant_id,r.store_id,r.body.subject_ref);
  for(const row of rows)if(row.body.status==='current'&&!suppressed(row)&&followupHeld(k,row))throw new Error('JOURNEY_FOLLOWUP_RESTORE_HELD');
  for(const group of groups(rows)) {
    const latest=group.at(-1)!,copies=followupCopies(k,group);
    for(const row of group)if(row.body.status==='current')redactFollowup(k,row,suppressed(row)?'subject_erased':'restored');
    cancelJobs(k,group);for(const copy of copies)cancelUnattempted(k,latest,copy);
  }
}
