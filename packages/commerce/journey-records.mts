import type {CommerceKernel,Row} from './kernel.mts';
import {exact,id,integer} from './kernel.mts';
import {canonical,contentDigest,jsonValue} from './configuration-values.mts';

export const JOURNEY_KIND='commerce_journey',JOURNEY_MAX_ROWS=10000;
export const JOURNEY_INTENTS=Object.freeze(['tracking','return','exchange','edit','shopping','followup','handoff']);
export const JOURNEY_REFERENCES=Object.freeze(['preview','approval','receipt','return_request','fulfillment','resolution','edit','cart','delivery']);
const REASONS=['superseded','forgotten','subject_erased','restored','uninstalled'];
const BODY_KEYS=['schema_version','case_id','resource_id','subject_ref','request_hash','status','link_id','link_revision','configuration_digest','ownership_generation','intents'];
const ROW_KEYS=['tenant_id','store_id','kind','id','version','body','digest','author','state','reviewer','review_digest','created_at','expires_at'];
export const journeyHash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export type JourneyRecord=Row&{body:Row};

export function journeyReference(value:unknown) {
  const r=exact(value,['kind','id','digest']);id(r.id);
  if(!JOURNEY_REFERENCES.includes(r.kind)||!journeyHash(r.digest))throw new Error('JOURNEY_REFERENCE_INVALID');
  return r;
}
export function journeyIntents(value:unknown):Row[] {
  if(!Array.isArray(value)||value.length>10)throw new Error('JOURNEY_INTENT_LIMIT');
  const ids=new Set<string>(),refs=new Set<string>();let count=0;
  for(const item of value) {
    const intent=exact(item,['id','kind','references']);id(intent.id);
    if(ids.has(intent.id)||!JOURNEY_INTENTS.includes(intent.kind)||!Array.isArray(intent.references)||
      !intent.references.length&&!['tracking','handoff'].includes(intent.kind))throw new Error('JOURNEY_INTENT_INVALID');
    ids.add(intent.id);
    for(const value of intent.references) {
      const r=journeyReference(value),key=canonical([r.kind,r.id]);
      if(refs.has(key)||++count>32)throw new Error('JOURNEY_REFERENCE_LIMIT');refs.add(key);
    }
  }
  return value;
}
export function journeyId(t:string,s:string,b:Row) {
  return 'journey_'+contentDigest(['rifare-commerce-journey-v1',t,s,b.case_id,b.resource_id,b.subject_ref]).slice(0,40);
}
export function journeyRequestHash(t:string,s:string,ref:string,request:string) {
  return contentDigest(['rifare-commerce-journey-request-v1',t,s,ref,id(request)]);
}

/** Retained identity validation deliberately does not dereference live resources.
 * A subject's old order may have been erased, reassigned or imported. */
export function checkedJourneyRecords(raw:Row[],now:number):JourneyRecord[] {
  if(raw.length>JOURNEY_MAX_ROWS)throw new Error('JOURNEY_ROW_LIMIT');
  try {
    integer(now);
    const rows=raw.map(row=>{
      exact(row,ROW_KEYS);id(row.tenant_id);id(row.store_id);id(row.id);integer(row.version,1);integer(row.created_at);
      if(row.kind!==JOURNEY_KIND||row.author!=='journey_coordinator'||row.reviewer!==null||row.review_digest!==null||row.expires_at!==null||
        !['active','revoked'].includes(row.state)||row.created_at>now||typeof row.body!=='string'||!journeyHash(row.digest))throw new Error();
      const b=jsonValue(JSON.parse(row.body),32768);
      if(!b||!['current','redacted'].includes(b.status))throw new Error();
      exact(b,b.status==='redacted'?[...BODY_KEYS,'reason']:BODY_KEYS);id(b.case_id);id(b.resource_id);
      if(b.schema_version!==1||!journeyHash(b.subject_ref)||!journeyHash(b.request_hash)||canonical(b)!==row.body||
        contentDigest(b)!==row.digest||journeyId(row.tenant_id,row.store_id,b)!==row.id)throw new Error();
      journeyIntents(b.intents);
      if(b.status==='current') {
        id(b.link_id);integer(b.link_revision,1);integer(b.ownership_generation,1);
        if(!journeyHash(b.configuration_digest))throw new Error();
      }else if(row.state!=='revoked'||!REASONS.includes(b.reason)||b.intents.length||
        ['link_id','link_revision','configuration_digest','ownership_generation'].some(key=>b[key]!==null))throw new Error();
      return {...row,body:b};
    }).sort((a,b)=>a.tenant_id.localeCompare(b.tenant_id)||a.store_id.localeCompare(b.store_id)||a.id.localeCompare(b.id)||a.version-b.version);
    const groups=new Map<string,JourneyRecord[]>();
    for(const row of rows) {const key=canonical([row.tenant_id,row.store_id,row.id]),group=groups.get(key)??[];group.push(row);groups.set(key,group);}
    for(const group of groups.values()) {
      const requests=new Set<string>();
      for(const [index,row] of group.entries()) {
        if(row.version!==index+1||requests.has(row.body.request_hash)||index<group.length-1&&row.state!=='revoked'||
          index>0&&row.created_at<group[index-1].created_at)throw new Error();
        requests.add(row.body.request_hash);
      }
    }
    return rows;
  }catch{throw new Error('JOURNEY_INTEGRITY');}
}
export function journeyRecords(k:CommerceKernel,scope?:Row) {
  const raw=k.db.prepare(`SELECT * FROM commerce_support_documents WHERE kind=? ${scope?'AND tenant_id=? AND store_id=?':''} ORDER BY tenant_id,store_id,id,version LIMIT ?`)
    .all(JOURNEY_KIND,...(scope?[id(scope.tenant_id),id(scope.store_id)]:[]),JOURNEY_MAX_ROWS+1) as Row[];
  return checkedJourneyRecords(raw,k.clock());
}
export function journeyHeld(k:CommerceKernel,row:JourneyRecord) {
  return !!k.db.prepare('SELECT 1 FROM commerce_privacy_holds WHERE tenant_id=? AND store_id=? AND subject_hash=? AND released=0 AND expires_at>?')
    .get(row.tenant_id,row.store_id,row.body.subject_ref,k.clock());
}
export function redactedJourneyBody(body:Row,reason:string) {
  if(!REASONS.includes(reason))throw new Error('JOURNEY_INPUT_INVALID');
  return {schema_version:1,case_id:body.case_id,resource_id:body.resource_id,subject_ref:body.subject_ref,request_hash:body.request_hash,
    status:'redacted',reason,link_id:null,link_revision:null,configuration_digest:null,ownership_generation:null,intents:[]};
}
export function redactJourney(k:CommerceKernel,row:JourneyRecord,reason:string) {
  const body=redactedJourneyBody(row.body,reason),digest=contentDigest(body);
  k.db.prepare("UPDATE commerce_support_documents SET body=?,digest=?,state='revoked',expires_at=NULL WHERE tenant_id=? AND store_id=? AND kind=? AND id=? AND version=?")
    .run(canonical(body),digest,row.tenant_id,row.store_id,JOURNEY_KIND,row.id,row.version);
  Object.assign(row,{body,digest,state:'revoked',expires_at:null});
}
export function retireJourney(k:CommerceKernel,row:JourneyRecord,reason:string,held:boolean) {
  if(row.body.status==='redacted')return;
  if(!held){redactJourney(k,row,reason);return;}
  k.db.prepare("UPDATE commerce_support_documents SET state='revoked' WHERE tenant_id=? AND store_id=? AND kind=? AND id=? AND version=?")
    .run(row.tenant_id,row.store_id,JOURNEY_KIND,row.id,row.version);row.state='revoked';
}
