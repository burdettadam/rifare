import type {CommerceKernel,Row} from './kernel.mts';
import {exact,id,integer} from './kernel.mts';
import {canonical,contentDigest,jsonValue} from './configuration-values.mts';

export const MEMORY_KIND='shopper_memory', MEMORY_PURPOSE='support_journey';
export const MEMORY_MAX_AGE=30*86400000, MEMORY_MAX_ROWS=10000;
const HASH=/^[a-f0-9]{64}$/;
const hash=(value:unknown)=>typeof value==='string'&&HASH.test(value);
const REASONS=['corrected','forgotten','expired','source_changed','subject_erased','restored','uninstalled'];
const BODY_KEYS=['schema_version','case_id','resource_id','subject_ref','purpose','request_hash','status','preferences','source','expires_at'];
const ROW_KEYS=['tenant_id','store_id','kind','id','version','body','digest','author','state','reviewer','review_digest','created_at','expires_at'];
export type MemoryRecord=Row&{body:Row};

export function memoryPreferences(value:unknown) {
  const p=jsonValue(value,32768);
  if(!p||Array.isArray(p)||typeof p!=='object')throw new Error('SHOPPER_MEMORY_INPUT_INVALID');
  const keys=Object.keys(p);
  if(!keys.length||keys.some(key=>!['fit_preference','response_style'].includes(key))||
    Object.hasOwn(p,'fit_preference')&&!['close','regular','relaxed'].includes(p.fit_preference)||
    Object.hasOwn(p,'response_style')&&!['concise','detailed'].includes(p.response_style))throw new Error('SHOPPER_MEMORY_INPUT_INVALID');
  return p;
}
export function memoryId(t:string,s:string,body:Row) {
  return 'smem_'+contentDigest(['rifare-shopper-memory-v1',t,s,body.case_id,body.resource_id,body.subject_ref,body.purpose]).slice(0,40);
}
export function memoryRequestHash(t:string,s:string,ref:string,request:string) {
  return contentDigest(['rifare-shopper-memory-request-v1',t,s,ref,id(request)]);
}

/** Pure retained-data validation. Historical identity survives source deletion,
 * case pseudonymization and import; it is not a current access credential. */
export function checkedMemoryRecords(raw:Row[],now:number):MemoryRecord[] {
  if(raw.length>MEMORY_MAX_ROWS)throw new Error('SHOPPER_MEMORY_ROW_LIMIT');
  try {
    integer(now);
    const rows=raw.map(row=>{
      exact(row,ROW_KEYS);id(row.tenant_id);id(row.store_id);id(row.id);integer(row.version,1);integer(row.created_at);
      if(row.kind!==MEMORY_KIND||row.author!=='verified_customer'||row.reviewer!==null||row.review_digest!==null||
        !['active','revoked'].includes(row.state)||row.created_at>now||typeof row.body!=='string'||!hash(row.digest))throw new Error();
      const body=jsonValue(JSON.parse(row.body),32768);
      if(!body||!['current','redacted'].includes(body.status))throw new Error();
      exact(body,body.status==='redacted'?[...BODY_KEYS,'reason']:BODY_KEYS);
      id(body.case_id);id(body.resource_id);
      if(body.schema_version!==1||body.purpose!==MEMORY_PURPOSE||!hash(body.subject_ref)||!hash(body.request_hash)||
        canonical(body)!==row.body||contentDigest(body)!==row.digest||memoryId(row.tenant_id,row.store_id,body)!==row.id)throw new Error();
      if(body.status==='current') {
        memoryPreferences(body.preferences);
        const source=exact(body.source,['kind','link_id','link_revision','customer_resource_id','customer_source_version','customer_source_digest','order_source_version','order_source_digest','observed_at']);
        id(source.link_id);id(source.customer_resource_id);integer(source.link_revision,1);integer(source.customer_source_version,1);integer(source.order_source_version,1);integer(source.observed_at);
        integer(body.expires_at,1);
        if(source.kind!=='verified_customer_request'||!hash(source.customer_source_digest)||!hash(source.order_source_digest)||
          source.observed_at>row.created_at||body.expires_at<=source.observed_at||body.expires_at>source.observed_at+MEMORY_MAX_AGE||row.expires_at!==body.expires_at)throw new Error();
      } else if(row.state!=='revoked'||!REASONS.includes(body.reason)||canonical(body.preferences)!=='{}'||body.source!==null||body.expires_at!==null||row.expires_at!==null)throw new Error();
      return {...row,body};
    }).sort((a,b)=>a.tenant_id.localeCompare(b.tenant_id)||a.store_id.localeCompare(b.store_id)||a.id.localeCompare(b.id)||a.version-b.version);
    const groups=new Map<string,MemoryRecord[]>();
    for(const row of rows){const key=canonical([row.tenant_id,row.store_id,row.id]);const group=groups.get(key)??[];group.push(row);groups.set(key,group);}
    for(const group of groups.values()) {
      const requests=new Set<string>();
      for(const [index,row] of group.entries()) {
        if(row.version!==index+1||requests.has(row.body.request_hash)||index<group.length-1&&row.state!=='revoked'||
          index>0&&row.created_at<group[index-1].created_at)throw new Error();
        requests.add(row.body.request_hash);
      }
    }
    return rows;
  }catch{throw new Error('SHOPPER_MEMORY_INTEGRITY');}
}
export function memoryRecords(k:CommerceKernel,scope?:Row) {
  const raw=k.db.prepare(`SELECT * FROM commerce_support_documents WHERE kind=? ${scope?'AND tenant_id=? AND store_id=?':''} ORDER BY tenant_id,store_id,id,version LIMIT ?`)
    .all(MEMORY_KIND,...(scope?[id(scope.tenant_id),id(scope.store_id)]:[]),MEMORY_MAX_ROWS+1) as Row[];
  return checkedMemoryRecords(raw,k.clock());
}
export function memoryHeld(k:CommerceKernel,row:MemoryRecord) {
  return !!k.db.prepare('SELECT 1 FROM commerce_privacy_holds WHERE tenant_id=? AND store_id=? AND subject_hash=? AND released=0 AND expires_at>?')
    .get(row.tenant_id,row.store_id,row.body.subject_ref,k.clock());
}
export function redactedMemoryBody(body:Row,reason:string) {
  if(!REASONS.includes(reason))throw new Error('SHOPPER_MEMORY_INPUT_INVALID');
  return {schema_version:1,case_id:body.case_id,resource_id:body.resource_id,subject_ref:body.subject_ref,purpose:body.purpose,
    request_hash:body.request_hash,status:'redacted',reason,preferences:{},source:null,expires_at:null};
}
export function redactMemory(k:CommerceKernel,row:MemoryRecord,reason:string) {
  const body=redactedMemoryBody(row.body,reason),hash=contentDigest(body);
  k.db.prepare("UPDATE commerce_support_documents SET body=?,digest=?,state='revoked',expires_at=NULL WHERE tenant_id=? AND store_id=? AND kind=? AND id=? AND version=?")
    .run(canonical(body),hash,row.tenant_id,row.store_id,MEMORY_KIND,row.id,row.version);
  Object.assign(row,{body,digest:hash,state:'revoked',expires_at:null});
}
export function retireMemory(k:CommerceKernel,row:MemoryRecord,reason:string,held:boolean) {
  if(row.body.status==='redacted')return;
  if(!held){redactMemory(k,row,reason);return;}
  k.db.prepare("UPDATE commerce_support_documents SET state='revoked' WHERE tenant_id=? AND store_id=? AND kind=? AND id=? AND version=?")
    .run(row.tenant_id,row.store_id,MEMORY_KIND,row.id,row.version);
  row.state='revoked';
}
export function memoryProvenance(row:MemoryRecord) {
  const source=row.body.source;
  return source?{kind:'explicit',source:'verified_customer_request',reference:row.body.request_hash,link_id:source.link_id,
    source_revision:source.link_revision,observed_at:source.observed_at,source_digest:row.digest}:null;
}
