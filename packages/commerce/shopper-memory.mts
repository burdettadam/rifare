import type {CommerceKernel,Scope,Row} from './kernel.mts';
import {exact,id,integer} from './kernel.mts';
import {contentDigest,jsonValue} from './configuration-values.mts';
import {subjectHash} from './data-guards.mts';
import {growthCustomerProof} from './growth-shopping-core.mts';
import {SupportConversations} from './support-conversations.mts';
import {supportCase,ownershipRow,assertSupportOwner,saveDocument} from './support-core.mts';
import {MEMORY_KIND,MEMORY_PURPOSE,MEMORY_MAX_AGE,MEMORY_MAX_ROWS,memoryPreferences,memoryId,memoryRequestHash,
  memoryRecords,memoryHeld,retireMemory,redactedMemoryBody,memoryProvenance} from './shopper-memory-records.mts';
import type {MemoryRecord} from './shopper-memory-records.mts';

const CONTEXT_KEYS=['case_id','link_id','expected_generation','purpose'];
type MemoryBinding={s:Row;c:Row;current:ReturnType<typeof growthCustomerProof>;link:Row;owner:Row;identity:Row;ref:string;rows:MemoryRecord[];total:number};
function input(value:unknown,keys:string[]) {
  const p=exact(jsonValue(value,32768),keys);id(p.case_id);id(p.link_id);integer(p.expected_generation,1);
  if(p.purpose!==MEMORY_PURPOSE)throw new Error('SHOPPER_MEMORY_PURPOSE_UNSUPPORTED');return p;
}

/** Bounded explicit preferences; a context digest never authorizes an action. */
export class ShopperMemory {
  readonly k:CommerceKernel;
  constructor(k:CommerceKernel){this.k=k;}

  #binding(scope:Scope,proof:Scope,p:Row,write=false):MemoryBinding {
    const k=this.k,{s,c}=supportCase(k,scope,p.case_id,write?'support.customer_message':'support.read'),v=k.require(proof);
    if(write&&s.role!=='customer'||v.role!=='customer'||v.tenant_id!==s.tenant_id||v.store_id!==s.store_id||v.resource_id!==c.resource_id||v.customer_id!==c.customer_id)
      throw new Error('CUSTOMER_VERIFICATION_REQUIRED');
    // Inspect with the actual customer too: staff visibility cannot widen the
    // proof's resource scope or turn a gift-recipient case into purchaser memory.
    supportCase(k,proof,c.id);
    const current=growthCustomerProof(k,v,c.resource_id,c.customer_id),link=new SupportConversations(k).linkRecord(scope,p.link_id);
    if(link.case_id!==c.id||link.resource_id!==c.resource_id||link.customer_id!==c.customer_id)throw new Error('SHOPPER_MEMORY_LINK_MISMATCH');
    const owner=ownershipRow(k,s,c.id);
    if(!owner||owner.generation!==p.expected_generation)throw new Error('SUPPORT_OWNERSHIP_CHANGED');
    if(s.role!=='customer')assertSupportOwner(k,scope,c.id,p.expected_generation);
    const identity={case_id:c.id,resource_id:c.resource_id,subject_ref:subjectHash(s.tenant_id,s.store_id,c.customer_id),purpose:MEMORY_PURPOSE};
    const ref=memoryId(s.tenant_id,s.store_id,identity),all=memoryRecords(k,s),rows=all.filter(row=>row.id===ref);
    for(const row of rows)if(row.body.source&&row.body.source.customer_resource_id!==current.customer.id)throw new Error('SHOPPER_MEMORY_INTEGRITY');
    return {s,c,current,link,owner,identity,ref,rows,total:all.length};
  }
  #sourceCurrent(binding:MemoryBinding,row:MemoryRecord) {
    const {s,c,current}=binding,source=row.body.source;
    const link=this.k.db.prepare('SELECT * FROM commerce_support_links WHERE tenant_id=? AND store_id=? AND id=? AND erased=0')
      .get(s.tenant_id,s.store_id,source.link_id) as Row|undefined;
    return source.customer_source_version===current.customer.source_version&&source.customer_source_digest===contentDigest(JSON.parse(current.customer.payload))&&
      source.order_source_version===current.order.source_version&&source.order_source_digest===contentDigest(JSON.parse(current.order.payload))&&
      !!link&&link.case_id===c.id&&link.resource_id===c.resource_id&&link.customer_id===c.customer_id&&link.source_revision===source.link_revision;
  }
  #context(binding:MemoryBinding) {
    const {s,c,link,owner,rows}=binding,k=this.k,latest=rows.at(-1),held=latest?memoryHeld(k,latest):false;
    let status='missing';
    if(latest?.body.status==='current') {
      const reason=latest.body.expires_at<=k.clock()?'expired':!this.#sourceCurrent(binding,latest)?'source_changed':latest.state!=='active'?'uninstalled':null;
      if(reason){status=reason==='uninstalled'?'unavailable':reason;retireMemory(k,latest,reason,held);}else status='available';
    }else if(latest){status=['expired','source_changed','forgotten','restored'].includes(latest.body.reason)?latest.body.reason:'unavailable';}
    for(const row of rows)if(row!==latest&&row.state==='revoked')retireMemory(k,row,'corrected',held);
    const result={schema_version:1,case_id:c.id,resource_id:c.resource_id,purpose:MEMORY_PURPOSE,version:latest?.version??0,status,
      preferences:status==='available'?latest!.body.preferences:{},provenance:status==='available'?memoryProvenance(latest!):null,
      history:{status:link.history,source_revision:link.source_revision,missing_history_is_explicit:true},ownership_generation:owner.generation,
      retained_under_hold:held&&rows.some(row=>row.body.status==='current'),model_thread_required:false,execution_authorized:false,production_qualified:false};
    return {...result,context_digest:contentDigest({tenant_id:s.tenant_id,store_id:s.store_id,memory_id:binding.ref,
      memory:latest?{version:latest.version,digest:status==='available'||latest.body.status==='redacted'?latest.digest:null,state:latest.state}:null,link_id:link.id,context:result})};
  }
  record(scope:Scope,value:unknown) {
    const p=input(value,[...CONTEXT_KEYS,'expected_version','request_id','preferences','expires_at']);
    integer(p.expected_version);id(p.request_id);integer(p.expires_at,1);const preferences=memoryPreferences(p.preferences);
    return this.k.transaction(()=>{
      const b=this.#binding(scope,scope,p,true),now=this.k.clock();
      if(p.expires_at<=now||p.expires_at>now+MEMORY_MAX_AGE)throw new Error('SHOPPER_MEMORY_EXPIRY_INVALID');
      const request_hash=this.#newRequest(b,p),held=b.rows.length?memoryHeld(this.k,b.rows[0]):false;
      for(const row of b.rows)retireMemory(this.k,row,'corrected',held);
      const body={schema_version:1,...b.identity,request_hash,status:'current',preferences,source:{kind:'verified_customer_request',link_id:b.link.id,
        link_revision:b.link.source_revision,customer_resource_id:b.current.customer.id,customer_source_version:b.current.customer.source_version,
        customer_source_digest:contentDigest(JSON.parse(b.current.customer.payload)),order_source_version:b.current.order.source_version,
        order_source_digest:contentDigest(JSON.parse(b.current.order.payload)),observed_at:now},expires_at:p.expires_at};
      saveDocument(this.k,{...b.s,actor_id:'verified_customer'},MEMORY_KIND,b.ref,p.expected_version,body,'active',p.expires_at);
      return this.#context(this.#binding(scope,scope,p,true));
    });
  }
  #newRequest(binding:MemoryBinding,p:Row) {
    if((binding.rows.at(-1)?.version??0)!==p.expected_version)throw new Error('SHOPPER_MEMORY_VERSION_CHANGED');
    if(binding.total>=MEMORY_MAX_ROWS)throw new Error('SHOPPER_MEMORY_ROW_LIMIT');
    const hash=memoryRequestHash(binding.s.tenant_id,binding.s.store_id,binding.ref,p.request_id);
    if(binding.rows.some(row=>row.body.request_hash===hash))throw new Error('SHOPPER_MEMORY_REQUEST_REPLAY');return hash;
  }
  forget(scope:Scope,value:unknown) {
    const p=input(value,[...CONTEXT_KEYS,'expected_version','request_id']);integer(p.expected_version);id(p.request_id);
    return this.k.transaction(()=>{
      const b=this.#binding(scope,scope,p,true),request_hash=this.#newRequest(b,p),held=b.rows.length?memoryHeld(this.k,b.rows[0]):false;
      for(const row of b.rows)retireMemory(this.k,row,'forgotten',held);
      saveDocument(this.k,{...b.s,actor_id:'verified_customer'},MEMORY_KIND,b.ref,p.expected_version,
        redactedMemoryBody({...b.identity,request_hash},'forgotten'),'revoked');
      return this.#context(this.#binding(scope,scope,p,true));
    });
  }
  context(scope:Scope,customerProof:Scope,value:unknown) {
    const p=input(value,CONTEXT_KEYS);return this.k.transaction(()=>this.#context(this.#binding(scope,customerProof,p)));
  }
}
