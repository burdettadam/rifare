import type {CommerceKernel,Scope,Row} from './kernel.mts';
import {exact,id,integer} from './kernel.mts';
import {canonical,contentDigest,jsonValue} from './configuration-values.mts';
import {subjectHash} from './data-guards.mts';
import {growthCustomerProof} from './growth-shopping-core.mts';
import {ReadContext} from './read-context.mts';
import {CaseConfigurations} from './case-configurations.mts';
import {ActionGateway} from './action-gateway.mts';
import {FulfillmentExecution} from './fulfillment-execution.mts';
import {ResolutionExecution} from './resolution-execution.mts';
import {OrderEdits} from './order-edit-execution.mts';
import {ShoppingCart} from './shopping-cart.mts';
import {SupportDelivery} from './support-delivery.mts';
import {SupportTracking} from './support-tracking.mts';
import {SupportConversations} from './support-conversations.mts';
import {supportCase,ownershipRow,assertSupportOwner,saveDocument} from './support-core.mts';
import {JOURNEY_KIND,JOURNEY_MAX_ROWS,JOURNEY_INTENTS,journeyIntents,journeyReference,journeyHash,journeyId,journeyRequestHash,
  journeyRecords,journeyHeld,retireJourney,redactedJourneyBody} from './journey-records.mts';
import type {JourneyRecord} from './journey-records.mts';
import {JourneyReferences,journeyAction,unresolvedJourneyEffects} from './journey-references.mts';
import type {JourneyArtifact} from './journey-references.mts';

export type JourneyOwners={fulfillment?:FulfillmentExecution;resolution?:ResolutionExecution;edits?:OrderEdits;cart?:ShoppingCart;delivery?:SupportDelivery};
type Binding={s:Row;c:Row;link:Row;owner:Row;identity:Row;ref:string;rows:JourneyRecord[];total:number;references:JourneyReferences};
const COMMON=['case_id','link_id','expected_generation'];
function input(value:unknown,keys:string[]) {
  const p=exact(jsonValue(value,32768),[...COMMON,...keys]);id(p.case_id);id(p.link_id);integer(p.expected_generation,1);
  if(keys.includes('expected_version'))integer(p.expected_version);
  if(keys.includes('request_id'))id(p.request_id);
  if(keys.includes('intent_id'))id(p.intent_id);
  return p;
}

/** A durable index of original artifacts, not a second approval or effect owner. */
export class CommerceJourneys {
  readonly k:CommerceKernel;readonly reads:ReadContext;readonly owners:JourneyOwners;
  constructor(k:CommerceKernel,reads:ReadContext,owners:JourneyOwners={}) {
    if(!(reads instanceof ReadContext)||!owners||typeof owners!=='object'||Array.isArray(owners))throw new Error('JOURNEY_OWNER_MISMATCH');
    const descriptors=Object.getOwnPropertyDescriptors(owners),classes:Row={fulfillment:FulfillmentExecution,resolution:ResolutionExecution,edits:OrderEdits,cart:ShoppingCart,delivery:SupportDelivery};
    for(const [key,descriptor] of Object.entries(descriptors)) {
      if(!Object.hasOwn(classes,key)||!Object.hasOwn(descriptor,'value'))throw new Error('JOURNEY_OWNER_MISMATCH');
      const owner=descriptor.value;if(owner===undefined)continue;
      if(!(owner instanceof classes[key])||(key==='delivery'?owner.k!==k||owner.tracking.reads!==reads:owner.kernel!==k))throw new Error('JOURNEY_OWNER_MISMATCH');
    }
    this.k=k;this.reads=reads;this.owners=Object.freeze({...owners});
  }
  #binding(scope:Scope,proof:Scope,p:Row,write=false):Binding {
    const k=this.k,{s,c}=supportCase(k,scope,p.case_id),v=k.require(proof);
    if(v.role!=='customer'||v.tenant_id!==s.tenant_id||v.store_id!==s.store_id||v.resource_id!==c.resource_id||v.customer_id!==c.customer_id)throw new Error('CUSTOMER_VERIFICATION_REQUIRED');
    supportCase(k,proof,c.id);growthCustomerProof(k,v,c.resource_id,c.customer_id);
    if(write)k.authorize(scope,s.role==='customer'?'support.customer_message':'support.reply',c.resource_id);
    const link=new SupportConversations(k).linkRecord(scope,p.link_id),owner=ownershipRow(k,s,c.id);
    if(link.case_id!==c.id||link.resource_id!==c.resource_id||link.customer_id!==c.customer_id)throw new Error('JOURNEY_LINK_MISMATCH');
    if(!owner||owner.generation!==p.expected_generation)throw new Error('SUPPORT_OWNERSHIP_CHANGED');
    if(s.role!=='customer')assertSupportOwner(k,scope,c.id,p.expected_generation);
    const identity={case_id:c.id,resource_id:c.resource_id,subject_ref:subjectHash(s.tenant_id,s.store_id,c.customer_id)},ref=journeyId(s.tenant_id,s.store_id,identity),all=journeyRecords(k,s),rows=all.filter(r=>r.id===ref);
    const references=new JourneyReferences(k,s,c),seen=new Set<string>();
    // Validate retained personal histories before cleaning revoked records; a hold
    // or unavailable owner cannot conceal corrupted canonical provenance.
    for(const row of rows)for(const intent of row.body.intents)for(const r of intent.references) {
      const key=canonical([intent.kind,r]);if(!seen.has(key)){references.resolve(r,intent.kind);seen.add(key);}
    }
    return {s,c,link,owner,identity,ref,rows,total:all.length,references};
  }
  #private(scope:Scope,b:Binding,required=false) {
    if(b.s.role==='customer'){if(required)throw new Error('ACCESS_DENIED');return false;}
    try{this.k.authorize(scope,'operation.read',b.c.resource_id);return true;}catch(error){if(required)throw error;return false;}
  }
  #observation(scope:Scope,artifact:JourneyArtifact):Row|null {
    const {reference:r,body:b}=artifact,owners=this.owners;let value:Row;
    if(r.kind==='fulfillment'){if(!owners.fulfillment)return null;value=owners.fulfillment.read(scope,r.id);}
    else if(r.kind==='resolution'){if(!owners.resolution)return null;value=owners.resolution.read(scope,r.id);}
    else if(r.kind==='edit'){if(!owners.edits)return null;value=owners.edits.status(scope,r.id);}
    else if(r.kind==='cart'){if(!owners.cart)return null;value=owners.cart.readCart(scope,r.id);}
    else if(r.kind==='delivery'){if(!owners.delivery)return null;value=owners.delivery.inspect(scope,r.id);}
    else return {reference:r,state:r.kind==='preview'?'awaiting_approval':r.kind==='return_request'?artifact.row.state:'recorded',native_id:null,qualification:'canonical_provenance_only'};
    return {reference:r,state:r.kind==='cart'&&value.status==='purchased'?'purchased':value.state,
      native_id:value.native_id??value.native_reference??null,qualification:value.qualification??'unqualified'};
  }
  #context(scope:Scope,b:Binding) {
    const k=this.k,latest=b.rows.at(-1),held=b.rows.some(row=>journeyHeld(k,row));let status='missing';
    if(latest?.body.status==='current') {
      status=latest.state==='active'?'active':'unavailable';
      if(latest.state!=='active')retireJourney(k,latest,'uninstalled',held);
    }else if(latest)status=['forgotten','restored'].includes(latest.body.reason)?latest.body.reason:'unavailable';
    for(const row of b.rows)if(row!==latest&&row.state==='revoked')retireJourney(k,row,'superseded',held);
    const privateView=this.#private(scope,b),unresolved=unresolvedJourneyEffects(k,b.s,b.c.resource_id);
    const cases=new CaseConfigurations(k);let configuration_current=true,case_verification_current=true;
    try{cases.resume(scope,b.c.id);}catch{configuration_current=false;}
    try{cases.verified(scope,b.c.id);}catch{case_verification_current=false;}
    let handoff=unresolved.length>0||!configuration_current||!case_verification_current||b.link.history==='unavailable'||status!=='active';
    const intents=status==='active'?latest!.body.intents.map((intent:Row)=>{
      const restricted=!privateView&&intent.references.length>0;let state='recorded';const observations:Row[]=[];
      if(intent.kind==='handoff')state='handoff';
      else if(intent.kind==='tracking') {
        try{state=new SupportTracking(k,this.reads).read(scope,b.c.id).status==='available'?'available':'handoff';}catch{state='handoff';}
      }else {
        let missing=false;
        for(const r of intent.references) {
          const artifact=b.references.resolve(r,intent.kind);
          if(privateView) {
            try{const observation=this.#observation(scope,artifact);if(observation)observations.push(observation);else missing=true;}catch{missing=true;}
          }
        }
        if(observations.some(o=>['unknown','sending'].includes(o.state)))state='unknown';
        else if(missing)state='handoff';
        else if(observations.some(o=>!['awaiting_approval','recorded','submitted','native_unknown','native_created'].includes(o.state)))state='observed';
        else if(intent.references.every((r:Row)=>r.kind==='preview'))state='awaiting_approval';
        if(restricted)state='restricted';
      }
      if(['handoff','unknown','restricted'].includes(state))handoff=true;
      return {id:intent.id,kind:intent.kind,references:restricted?[]:intent.references,state,restricted,observations:restricted?[]:observations};
    }):[];
    const result={schema_version:1,id:b.ref,version:latest?.version??0,status,case_id:b.c.id,resource_id:b.c.resource_id,
      configuration_digest:b.c.configuration_digest,configuration_current,case_verification_current,ownership_generation:b.owner.generation,
      history:{status:b.link.history,source_revision:b.link.source_revision,missing_history_is_explicit:true},intents,unresolved:privateView?unresolved:[],
      handoff_required:handoff,retained_under_hold:held&&b.rows.some(row=>row.body.status==='current'),model_thread_required:false,execution_authorized:false,production_qualified:false};
    return {...result,context_digest:contentDigest({tenant_id:b.s.tenant_id,store_id:b.s.store_id,link_id:b.link.id,context:result})};
  }
  #version(b:Binding,p:Row) {
    if((b.rows.at(-1)?.version??0)!==p.expected_version)throw new Error('JOURNEY_VERSION_CHANGED');
  }
  #newRequest(b:Binding,p:Row) {
    this.#version(b,p);if(b.total>=JOURNEY_MAX_ROWS)throw new Error('JOURNEY_ROW_LIMIT');
    const hash=journeyRequestHash(b.s.tenant_id,b.s.store_id,b.ref,p.request_id);
    if(b.rows.some(row=>row.body.request_hash===hash))throw new Error('JOURNEY_REQUEST_REPLAY');return hash;
  }
  #active(b:Binding) {
    const latest=b.rows.at(-1);if(!latest||latest.state!=='active'||latest.body.status!=='current')throw new Error('JOURNEY_UNAVAILABLE');return latest;
  }
  #append(intents:Row[],intentId:string,kind:string,refs:Row[],deduplicate=false) {
    if(!JOURNEY_INTENTS.includes(kind))throw new Error('JOURNEY_INTENT_INVALID');
    const next=jsonValue(intents,32768),old=next.find((i:Row)=>i.id===intentId);
    if(old&&old.kind!==kind)throw new Error('JOURNEY_INTENT_CHANGED');
    const intent=old??{id:intentId,kind,references:[]};if(!old)next.push(intent);
    for(const ref of refs) {
      journeyReference(ref);const existing=intent.references.find((r:Row)=>r.kind===ref.kind&&r.id===ref.id);
      if(deduplicate&&existing&&canonical(existing)===canonical(ref))continue;
      intent.references.push(ref);
    }
    return journeyIntents(next);
  }
  #save(b:Binding,p:Row,hash:string,intents:Row[]) {
    for(const intent of journeyIntents(intents))for(const ref of intent.references)b.references.resolve(ref,intent.kind);
    const value={schema_version:1,...b.identity,request_hash:hash,status:'current',link_id:b.link.id,link_revision:b.link.source_revision,
      configuration_digest:b.c.configuration_digest,ownership_generation:b.owner.generation,intents};jsonValue(value,32768);
    const held=b.rows.some(row=>journeyHeld(this.k,row));for(const row of b.rows)retireJourney(this.k,row,'superseded',held);
    saveDocument(this.k,{...b.s,actor_id:'journey_coordinator'},JOURNEY_KIND,b.ref,p.expected_version,value);
  }
  context(scope:Scope,customerProof:Scope,value:unknown) {
    const p=input(value,[]);return this.k.transaction(()=>this.#context(scope,this.#binding(scope,customerProof,p)));
  }
  open(scope:Scope,customerProof:Scope,value:unknown) {
    const p=input(value,['expected_version','request_id']);return this.k.transaction(()=>{
      const b=this.#binding(scope,customerProof,p,true),hash=this.#newRequest(b,p);
      if(p.expected_version!==0||b.rows.length)throw new Error('JOURNEY_ALREADY_EXISTS');
      this.#save(b,p,hash,[]);return this.#context(scope,this.#binding(scope,customerProof,p));
    });
  }
  attach(scope:Scope,customerProof:Scope,value:unknown) {
    const p=input(value,['expected_version','request_id','intent_id','kind','references']);return this.k.transaction(()=>{
      const b=this.#binding(scope,customerProof,p,true),hash=this.#newRequest(b,p),latest=this.#active(b);
      if(!Array.isArray(p.references))throw new Error('JOURNEY_REFERENCE_INVALID');
      const intents=this.#append(latest.body.intents,p.intent_id,p.kind,p.references);
      this.#save(b,p,hash,intents);return this.#context(scope,this.#binding(scope,customerProof,p));
    });
  }
  #clear(b:Binding) {
    if(unresolvedJourneyEffects(this.k,b.s,b.c.resource_id).length)throw new Error('JOURNEY_RECONCILIATION_REQUIRED');
  }
  prepare(scope:Scope,customerProof:Scope,value:unknown) {
    const p=input(value,['expected_version','request_id','intent_id','kind','proposal']);return this.k.transaction(()=>{
      const b=this.#binding(scope,customerProof,p,true);this.#private(scope,b,true);
      const hash=this.#newRequest(b,p),latest=this.#active(b),proposal=exact(p.proposal,['case_id','action','arguments']);
      journeyAction(proposal.action,p.kind,true);if(proposal.case_id!==b.c.id)throw new Error('JOURNEY_REFERENCE_MISMATCH');this.#clear(b);
      const native=new ActionGateway(this.k).prepare(scope,proposal),ref=b.references.reference('preview',native.id);
      this.#save(b,p,hash,this.#append(latest.body.intents,p.intent_id,p.kind,[ref]));
      return {journey:this.#context(scope,this.#binding(scope,customerProof,p)),native};
    });
  }
  execute(scope:Scope,customerProof:Scope,value:unknown) {
    const p=input(value,['expected_version','request_id','intent_id','preview_id','preview_digest','approval_id']);id(p.preview_id);id(p.approval_id);
    if(!journeyHash(p.preview_digest))throw new Error('JOURNEY_REFERENCE_INVALID');
    return this.k.transaction(()=>{
      const b=this.#binding(scope,customerProof,p,true);this.#private(scope,b,true);
      const hash=this.#newRequest(b,p),latest=this.#active(b),intent=latest.body.intents.find((i:Row)=>i.id===p.intent_id);
      if(!intent||!intent.references.some((r:Row)=>r.kind==='preview'&&r.id===p.preview_id&&r.digest===p.preview_digest))throw new Error('JOURNEY_REFERENCE_NOT_ATTACHED');
      const preview=b.references.resolve({kind:'preview',id:p.preview_id,digest:p.preview_digest},intent.kind);journeyAction(preview.action!,intent.kind);this.#clear(b);
      const native=new ActionGateway(this.k).execute(scope,{preview_id:p.preview_id,preview_digest:p.preview_digest,approval_id:p.approval_id});
      const refs=[b.references.reference('approval',native.approval_id),b.references.reference('receipt',native.id)];
      for(const [field,kind] of [['return_request_id','return_request'],['resolution_operation_id','resolution'],['fulfillment_operation_id','fulfillment'],['order_edit_id','edit']])if(native[field])refs.push(b.references.reference(kind,native[field]));
      this.#save(b,p,hash,this.#append(latest.body.intents,intent.id,intent.kind,refs,true));
      return {journey:this.#context(scope,this.#binding(scope,customerProof,p)),native};
    });
  }
  async reconcile(scope:Scope,customerProof:Scope,value:unknown) {
    const p=input(value,['expected_version','intent_id','reference']);journeyReference(p.reference);
    const bound=()=>{
      const b=this.#binding(scope,customerProof,p);this.#private(scope,b,true);this.k.authorize(scope,'operation.reconcile',b.c.resource_id);this.#version(b,p);
      const intent=this.#active(b).body.intents.find((i:Row)=>i.id===p.intent_id);
      if(!intent||!intent.references.some((r:Row)=>canonical(r)===canonical(p.reference)))throw new Error('JOURNEY_REFERENCE_NOT_ATTACHED');
      return {b,artifact:b.references.resolve(p.reference,intent.kind)};
    };
    const {artifact}=bound(),r=artifact.reference;let native:unknown;
    if(r.kind==='fulfillment'&&this.owners.fulfillment)native=await this.owners.fulfillment.reconcile(scope,r.id);
    else if(r.kind==='resolution'&&this.owners.resolution)native=await this.owners.resolution.reconcile(scope,r.id);
    else if(r.kind==='edit'&&this.owners.edits)native=await this.owners.edits.reconcile(scope,r.id);
    else if(r.kind==='delivery'&&this.owners.delivery)native=await this.owners.delivery.reconcile(scope,r.id);
    else if(r.kind==='cart'&&this.owners.cart) {
      if(!['unknown','committed'].includes(artifact.row.state))throw new Error('JOURNEY_OPERATION_NOT_ATTEMPTED');
      native=await this.owners.cart.confirm(customerProof,{cart_id:r.id,preview_digest:r.digest});
    }else throw new Error('JOURNEY_NATIVE_HANDOFF_REQUIRED');
    // No new version or ID. The native late observation can remain truthful while
    // a caller that lost the case during the await receives no private result.
    return this.k.transaction(()=>({journey:this.#context(scope,bound().b),native}));
  }
  forget(scope:Scope,value:unknown) {
    const p=input(value,['expected_version','request_id']);return this.k.transaction(()=>{
      if(this.k.require(scope).role!=='customer')throw new Error('ACCESS_DENIED');
      const b=this.#binding(scope,scope,p,true),hash=this.#newRequest(b,p),held=b.rows.some(row=>journeyHeld(this.k,row));
      for(const row of b.rows)retireJourney(this.k,row,'forgotten',held);
      saveDocument(this.k,{...b.s,actor_id:'journey_coordinator'},JOURNEY_KIND,b.ref,p.expected_version,redactedJourneyBody({...b.identity,request_hash:hash},'forgotten'),'revoked');
      return this.#context(scope,this.#binding(scope,scope,p));
    });
  }
}
