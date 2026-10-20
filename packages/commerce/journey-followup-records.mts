import type {CommerceKernel,Row} from './kernel.mts';
import {exact,id,integer} from './kernel.mts';
import {canonical,contentDigest,jsonValue} from './configuration-values.mts';
import {journeyHash,journeyId,journeyReference} from './journey-records.mts';
import {memoryId,MEMORY_PURPOSE} from './shopper-memory-records.mts';

export const FOLLOWUP_KIND='journey_followup',FOLLOWUP_MAX_ROWS=10000,FOLLOWUP_MAX_AGE=7*86400000;
export const FOLLOWUP_STEP='tracking_status_v1';
export const FOLLOWUP_REASONS=Object.freeze(['cart_purchased','refund_settled','credit_issued','edit_released','edit_cancelled','edit_abandoned',
  'native_unknown','native_owner_unavailable','journey_changed','memory_changed','source_changed','ownership_changed','rule_changed',
  'consent_changed','expired','unavailable','subject_erased','restored','uninstalled']);
const BODY_KEYS=['schema_version','case_id','resource_id','subject_ref','logical_key','request_hash','status','job_id','job_digest',
  'journey','memory','source','link_id','link_revision','rule','sender_id','generation','due_at','expires_at'];
const PRIVATE_KEYS=['job_digest','journey','memory','source','link_id','link_revision','rule','sender_id','generation','due_at','expires_at'];
const ROW_KEYS=['tenant_id','store_id','kind','id','version','body','digest','author','state','reviewer','review_digest','created_at','expires_at'];
const IDENTITY_KEYS=['case_id','resource_id','subject_ref','logical_key','request_hash','job_id'];
export type FollowupRecord=Row&{body:Row};
export const followupLogicalKey=(t:string,s:string,journey:string,intent:string)=>contentDigest(['rifare-journey-followup-v1',t,s,journey,intent,FOLLOWUP_STEP]);
export const followupId=(logical:string)=>'jfg_'+logical.slice(0,40);
export const followupJobId=(t:string,s:string,rule:string,event:string)=>'sjf_'+contentDigest([t,s,rule,event]).slice(0,40);
export const followupDeliveryIntent=(t:string,s:string,c:string,link:string,sender:string,job:string)=>'notify_'+contentDigest([t,s,c,link,sender,FOLLOWUP_STEP,job]).slice(0,40);
export const followupDeliveryId=(t:string,s:string,intent:string)=>'op_'+contentDigest([t,s,'event',intent]).slice(0,40);
export const immutableFollowupJob=(row:Row)=>Object.fromEntries(Object.entries(row).filter(([key])=>!['state','result'].includes(key)));
export function followupPin(value:unknown) {
  try{const p=exact(value,['guard_id','guard_version','guard_digest']);id(p.guard_id);integer(p.guard_version,1);
    if(!/^jfg_[a-f0-9]{40}$/.test(p.guard_id)||!journeyHash(p.guard_digest))throw new Error();return p;
  }catch{throw new Error('JOURNEY_FOLLOWUP_INTEGRITY');}
}

/** This preflight is deliberately structural. A copied historical subject may
 * have no current resource or customer credential in the destination. */
export function checkedFollowupRecords(raw:Row[],now:number):FollowupRecord[] {
  if(raw.length>FOLLOWUP_MAX_ROWS)throw new Error('JOURNEY_FOLLOWUP_ROW_LIMIT');
  try {
    integer(now);
    const rows=raw.map(row=>{
      exact(row,ROW_KEYS);id(row.tenant_id);id(row.store_id);id(row.id);integer(row.version,1);integer(row.created_at);
      if(row.kind!==FOLLOWUP_KIND||row.author!==FOLLOWUP_KIND||row.reviewer!==null||row.review_digest!==null||
        !['active','revoked'].includes(row.state)||row.created_at>now||typeof row.body!=='string'||!journeyHash(row.digest))throw new Error();
      const b=jsonValue(JSON.parse(row.body),32768);
      if(!b||!['current','redacted'].includes(b.status))throw new Error();
      exact(b,b.status==='redacted'?[...BODY_KEYS,'reason']:BODY_KEYS);id(b.case_id);id(b.resource_id);
      if(b.schema_version!==1||!journeyHash(b.subject_ref)||!journeyHash(b.logical_key)||!journeyHash(b.request_hash)||
        !/^sjf_[a-f0-9]{40}$/.test(b.job_id)||row.id!==followupId(b.logical_key)||canonical(b)!==row.body||contentDigest(b)!==row.digest)throw new Error();
      if(b.status==='current') {
        if(!journeyHash(b.job_digest))throw new Error();id(b.link_id);id(b.sender_id);integer(b.link_revision,1);integer(b.generation,1);integer(b.due_at);integer(b.expires_at,1);
        const journey=exact(b.journey,['id','version','digest','intent_id','reference']);id(journey.id);id(journey.intent_id);integer(journey.version,1);
        if(!journeyHash(journey.digest)||journeyId(row.tenant_id,row.store_id,b)!==journey.id||
          followupLogicalKey(row.tenant_id,row.store_id,journey.id,journey.intent_id)!==b.logical_key)throw new Error();
        if(journey.reference!==null){const r=journeyReference(journey.reference);if(!['cart','resolution','edit'].includes(r.kind))throw new Error();}
        const memory=exact(b.memory,['id','version']);integer(memory.version);id(memory.id);
        if(memory.id!==memoryId(row.tenant_id,row.store_id,{...b,purpose:MEMORY_PURPOSE}))throw new Error();
        const rule=exact(b.rule,['id','version','digest']);id(rule.id);integer(rule.version,1);if(!journeyHash(rule.digest))throw new Error();
        const source=exact(b.source,['customer_resource_id','customer_source_version','customer_source_digest','order_source_version','order_source_digest','observed_at']);
        id(source.customer_resource_id);integer(source.customer_source_version,1);integer(source.order_source_version,1);integer(source.observed_at);
        if(!journeyHash(source.customer_source_digest)||!journeyHash(source.order_source_digest)||source.observed_at>row.created_at||
          b.expires_at<=row.created_at||b.expires_at<=b.due_at||b.expires_at>source.observed_at+FOLLOWUP_MAX_AGE||row.expires_at!==b.expires_at)throw new Error();
      }else if(row.state!=='revoked'||row.expires_at!==null||!FOLLOWUP_REASONS.includes(b.reason)||PRIVATE_KEYS.some(key=>b[key]!==null))throw new Error();
      return {...row,body:b};
    }).sort((a,b)=>a.tenant_id.localeCompare(b.tenant_id)||a.store_id.localeCompare(b.store_id)||a.id.localeCompare(b.id)||a.version-b.version);
    const groups=new Map<string,FollowupRecord[]>();
    for(const row of rows){const key=canonical([row.tenant_id,row.store_id,row.id]),group=groups.get(key)??[];group.push(row);groups.set(key,group);}
    for(const group of groups.values()) {
      let redacted=false;const identity=canonical(IDENTITY_KEYS.map(key=>group[0].body[key]));
      for(const [index,row] of group.entries()) {
        if(row.version!==index+1||index<group.length-1&&row.state!=='revoked'||index>0&&row.created_at<group[index-1].created_at||
          canonical(IDENTITY_KEYS.map(key=>row.body[key]))!==identity||redacted&&row.body.status==='current')throw new Error();
        redacted ||= row.body.status==='redacted';
      }
    }
    return rows;
  }catch{throw new Error('JOURNEY_FOLLOWUP_INTEGRITY');}
}
export function followupRecords(k:CommerceKernel,scope?:Row) {
  const rows=k.db.prepare(`SELECT * FROM commerce_support_documents WHERE kind=? ${scope?'AND tenant_id=? AND store_id=?':''} ORDER BY tenant_id,store_id,id,version LIMIT ?`)
    .all(FOLLOWUP_KIND,...(scope?[id(scope.tenant_id),id(scope.store_id)]:[]),FOLLOWUP_MAX_ROWS+1) as Row[];
  return checkedFollowupRecords(rows,k.clock());
}
export function followupHeld(k:CommerceKernel,row:FollowupRecord) {
  return !!k.db.prepare('SELECT 1 FROM commerce_privacy_holds WHERE tenant_id=? AND store_id=? AND subject_hash=? AND released=0 AND expires_at>?')
    .get(row.tenant_id,row.store_id,row.body.subject_ref,k.clock());
}
export function redactedFollowupBody(body:Row,reason:string) {
  if(!FOLLOWUP_REASONS.includes(reason))throw new Error('JOURNEY_FOLLOWUP_INTEGRITY');
  return {schema_version:1,...Object.fromEntries(IDENTITY_KEYS.map(key=>[key,body[key]])),status:'redacted',
    ...Object.fromEntries(PRIVATE_KEYS.map(key=>[key,null])),reason};
}
export function redactFollowup(k:CommerceKernel,row:FollowupRecord,reason:string) {
  const body=redactedFollowupBody(row.body,reason),digest=contentDigest(body);
  k.db.prepare("UPDATE commerce_support_documents SET body=?,digest=?,state='revoked',expires_at=NULL WHERE tenant_id=? AND store_id=? AND kind=? AND id=? AND version=?")
    .run(canonical(body),digest,row.tenant_id,row.store_id,FOLLOWUP_KIND,row.id,row.version);
  Object.assign(row,{body,digest,state:'revoked',expires_at:null});
}
export function revokeFollowup(k:CommerceKernel,row:FollowupRecord) {
  k.db.prepare("UPDATE commerce_support_documents SET state='revoked' WHERE tenant_id=? AND store_id=? AND kind=? AND id=? AND version=?")
    .run(row.tenant_id,row.store_id,FOLLOWUP_KIND,row.id,row.version);row.state='revoked';
}
