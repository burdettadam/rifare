import { exact,id,integer } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { checkedBody } from './resolution-ledger.mts';
import { fulfillmentContext,fulfillmentSettings,parcelRow,FULFILLMENT_ACTIONS } from './return-fulfillment-core.mts';
import { assertFulfillmentSource } from './replacement-inventory.mts';
import { assertCaseWorkerScope } from './work-leases.mts';
import { assertExecution } from './execution-stops.mts';
import { FulfillmentFixtureSource } from '../adapters/fulfillment-fixture-source.mts';

const sources=new WeakMap<CommerceKernel,Map<string,FulfillmentFixtureSource>>();
export function attachQualifiedDestinationSource(k:CommerceKernel,source:FulfillmentFixtureSource){
 assertFulfillmentSource(k,source);let attached=sources.get(k);if(!attached){attached=new Map();sources.set(k,attached);}attached.set(source.identity,source);
}
function latest(k:CommerceKernel,table:string,s:Row,request?:string){return request===undefined
 ?k.db.prepare(`SELECT * FROM ${table} WHERE tenant_id=? AND store_id=? ORDER BY revision DESC LIMIT 1`).get(s.tenant_id,s.store_id) as Row|undefined
 :k.db.prepare(`SELECT * FROM ${table} WHERE tenant_id=? AND store_id=? AND request_id=? ORDER BY revision DESC LIMIT 1`).get(s.tenant_id,s.store_id,id(request)) as Row|undefined;
}
export function routingPolicy(k:CommerceKernel,scope:Scope){const s=k.require(scope),r=latest(k,'commerce_destination_policies',s);if(!r)return null;
 const b=checkedBody(r,'DESTINATION_HISTORY_INTEGRITY');if(b.tenant_id!==s.tenant_id||b.store_id!==s.store_id||b.revision!==r.revision)throw new Error('DESTINATION_HISTORY_INTEGRITY');return {...b,digest:r.digest};
}
function context(k:CommerceKernel,scope:Scope,requestId:string,active=true){const s=k.require(scope),r=k.db.prepare('SELECT case_id FROM commerce_return_requests WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(requestId)) as Row;
 if(!r)throw new Error('NOT_FOUND');return fulfillmentContext(k,scope,r.case_id,requestId,active);
}
function sourceFor(k:CommerceKernel,scope:Scope,ctx:Row){const p=routingPolicy(k,scope);if(!p)throw new Error('DESTINATION_POLICY_REQUIRED');
 if(!p.enabled||p.expires_at<=k.clock())throw new Error('DESTINATION_POLICY_UNAVAILABLE');
 const source=sources.get(k)?.get(p.source_identity);if(!source)throw new Error('DESTINATION_SOURCE_REQUIRED');assertFulfillmentSource(k,source,ctx.s);
 const settings=fulfillmentSettings(k,ctx.s);if(settings.source_identity!==source.identity||settings.account_id!==p.account_id)throw new Error('DESTINATION_SOURCE_MISMATCH');
 if(contentDigest(source.destinations.policy(p.account_id))!==p.digest)throw new Error('DESTINATION_POLICY_CHANGED');return {source,policy:p};
}
function bindingValue(ctx:Row,source:FulfillmentFixtureSource){const request=source.destinations.request(ctx.request.id),body=checkedBody(ctx.request),native=JSON.parse(ctx.native.native_body),payload=ctx.c.order.payload;
 if(request.resource_id!==ctx.c.resource_id||request.customer_id!==ctx.c.customer_id||request.native_return_id!==ctx.native.native_id||request.native_order_id!==payload.native_order_id||request.items.length!==body.selection.lines.length||request.items.length!==native.lines.length)throw new Error('DESTINATION_BINDING_MISMATCH');
 for(const item of request.items){const selected=body.selection.lines.find((l:Row)=>l.line_id===item.line_id),line=payload.return_lines?.find((l:Row)=>l.id===item.line_id),paid=payload.resolution_facts?.paid_lines?.find((l:Row)=>l.id===item.line_id),nativeLine=native.lines.find((l:Row)=>l.fulfillment_line_id===item.fulfillment_line_id);
  if(!selected||!line||!nativeLine||selected.quantity!==item.quantity||nativeLine.quantity!==item.quantity||line.fulfillment_line_id!==item.fulfillment_line_id)throw new Error('DESTINATION_BINDING_MISMATCH');
  const originalItem=paid?.product_id??line.product_id;if(!originalItem)throw new Error('DESTINATION_ITEM_FACTS_REQUIRED');if(originalItem!==item.item_id)throw new Error('DESTINATION_BINDING_MISMATCH');
 }
 return {request_id:ctx.request.id,case_id:ctx.c.id,resource_id:ctx.c.resource_id,customer_id:ctx.c.customer_id,source_identity:source.identity,
  request_digest:ctx.request.digest,native_return_digest:ctx.native.native_digest,source_order_digest:contentDigest(ctx.c.order),source_request:request,source_request_digest:contentDigest(request)};
}
function binding(k:CommerceKernel,scope:Scope,ctx:Row,source:FulfillmentFixtureSource){const row=latest(k,'commerce_destination_bindings',ctx.s,ctx.request.id);if(!row)throw new Error('DESTINATION_BINDING_REQUIRED');
 const b=checkedBody(row,'DESTINATION_HISTORY_INTEGRITY');if(b.request_id!==row.request_id||b.case_id!==row.case_id||b.resource_id!==row.resource_id||b.source_identity!==row.source_identity)throw new Error('DESTINATION_HISTORY_INTEGRITY');
 if(canonical(b)!==canonical(bindingValue(ctx,source)))throw new Error('DESTINATION_BINDING_CHANGED');return {row,body:b};
}
function selection(k:CommerceKernel,s:Row,requestId:string){const row=latest(k,'commerce_destination_selections',s,requestId);if(!row)return null;
 const body=checkedBody(row,'DESTINATION_HISTORY_INTEGRITY');if(body.request_id!==row.request_id||body.case_id!==row.case_id||body.resource_id!==row.resource_id||body.source_identity!==row.source_identity||body.route.selection_revision!==row.revision)throw new Error('DESTINATION_HISTORY_INTEGRITY');return {row,body};
}

/** Called by quote creation and the existing approval/final-dispatch quote recheck. */
export function qualifiedDestinationPin(k:CommerceKernel,scope:Scope,ctx:Row,parcel:Row,rate?:Row|null){const policy=routingPolicy(k,scope);
 if(!policy){const settings=fulfillmentSettings(k,ctx.s),source=sources.get(k)?.get(settings.source_identity);
  if(source?.destinations.required(settings.account_id,ctx.request.id,ctx.c.resource_id,ctx.native.native_id)||rate?.return_destination!==undefined)throw new Error('DESTINATION_POLICY_REQUIRED');return null;
 }
 const {source}=sourceFor(k,scope,ctx),b=binding(k,scope,ctx,source),selected=selection(k,ctx.s,ctx.request.id);if(!selected)throw new Error('DESTINATION_SELECTION_REQUIRED');
 if(selected.body.policy_digest!==policy.digest)throw new Error('DESTINATION_POLICY_CHANGED');
 if(selected.body.binding_digest!==b.row.digest)throw new Error('DESTINATION_BINDING_CHANGED');
 const route=selected.body.route;
 if(route.parcel_digest!==parcel.digest||route.parcel_revision!==parcel.revision||route.destination_address_digest!==contentDigest(parcel.parcel.to_address_ref))throw new Error('DESTINATION_PARCEL_CHANGED');
 source.destinations.assertSelection(route,{account_id:policy.account_id,request_id:ctx.request.id,resource_id:ctx.c.resource_id,native_return_id:ctx.native.native_id,parcel_digest:parcel.digest,parcel_revision:parcel.revision});
 if(rate&&(canonical(rate.return_destination??null)!==canonical(route)||rate.request_id!==ctx.request.id||rate.resource_id!==ctx.c.resource_id||rate.native_return_id!==ctx.native.native_id))throw new Error('DESTINATION_CHANGED');return route;
}

export class QualifiedReturnDestinations {
 readonly kernel:CommerceKernel;readonly source:FulfillmentFixtureSource;
 constructor(k:CommerceKernel,source:FulfillmentFixtureSource){attachQualifiedDestinationSource(k,source);this.kernel=k;this.source=source;}
 configure(scope:Scope,input:unknown){const p=exact(jsonValue(input),['expected_revision','enabled','source_identity','account_id','policy_version','allowed_destination_ids','expires_at']);
  integer(p.expected_revision);integer(p.policy_version,1);integer(p.expires_at);id(p.source_identity);id(p.account_id);
  if(typeof p.enabled!=='boolean'||!Array.isArray(p.allowed_destination_ids)||!p.allowed_destination_ids.length||p.allowed_destination_ids.length>64||new Set(p.allowed_destination_ids).size!==p.allowed_destination_ids.length)throw new Error('INVALID_INPUT');
  p.allowed_destination_ids=p.allowed_destination_ids.map(id).sort();const k=this.kernel;
  return k.transaction(()=>{const s=k.authorize(scope,'action.configure');assertFulfillmentSource(k,this.source,s);
   if(p.source_identity!==this.source.identity||p.expires_at<=k.clock()||p.expires_at>k.clock()+3600000)throw new Error('DESTINATION_SOURCE_MISMATCH');
   const settings=fulfillmentSettings(k,s);if(settings.source_identity!==this.source.identity||settings.account_id!==p.account_id)throw new Error('DESTINATION_SOURCE_MISMATCH');
   const old=latest(k,'commerce_destination_policies',s);if((old?.revision??0)!==p.expected_revision)throw new Error('DESTINATION_POLICY_CHANGED');
   const body={...p,tenant_id:s.tenant_id,store_id:s.store_id,revision:p.expected_revision+1};delete body.expected_revision;
   this.source.destinations.syncPolicy(body);k.db.prepare('INSERT INTO commerce_destination_policies VALUES(?,?,?,?,?)').run(s.tenant_id,s.store_id,body.revision,canonical(body),contentDigest(body));
   return {revision:body.revision,digest:contentDigest(body),policy:body,qualification:'synthetic_only',native_destination_qualified:false};
  });
 }
 policy(scope:Scope){this.kernel.authorize(scope,'operation.read');const policy=routingPolicy(this.kernel,scope);return {policy,qualification:'synthetic_only'};}
 bind(scope:Scope,input:unknown){const p=exact(jsonValue(input),['request_id']),k=this.kernel;id(p.request_id);
  return k.transaction(()=>{const ctx=context(k,scope,p.request_id);k.authorize(scope,'action.propose',ctx.c.resource_id);assertCaseWorkerScope(k,scope,ctx.c.id);
   const {source,policy}=sourceFor(k,scope,ctx),body=bindingValue(ctx,source);if(body.source_request.account_id!==policy.account_id)throw new Error('DESTINATION_SOURCE_MISMATCH');
   const old=latest(k,'commerce_destination_bindings',ctx.s,p.request_id);if(old?.digest===contentDigest(body))return this.read(scope,p);
   k.db.prepare('INSERT INTO commerce_destination_bindings VALUES(?,?,?,?,?,?,?,?,?,?)').run(ctx.s.tenant_id,ctx.s.store_id,p.request_id,ctx.c.id,ctx.c.resource_id,(old?.revision??0)+1,source.identity,canonical(body),contentDigest(body),k.clock());
   return this.read(scope,p);
  });
 }
 evaluate(scope:Scope,input:unknown){const p=exact(jsonValue(input),['request_id']),k=this.kernel,ctx=context(k,scope,p.request_id);k.authorize(scope,'action.propose',ctx.c.resource_id);
  const {source,policy}=sourceFor(k,scope,ctx),bound=binding(k,scope,ctx,source),value=source.destinations.evaluate(p.request_id);
  if(value.policy_digest!==policy.digest||value.request_digest!==bound.body.source_request_digest)throw new Error('DESTINATION_BINDING_CHANGED');
  return {request_id:p.request_id,binding_revision:bound.row.revision,binding_digest:bound.row.digest,policy_revision:policy.revision,policy_version:policy.policy_version,policy_digest:policy.digest,
   state:value.state,recommended_destination_id:value.recommended_destination_id,destinations:value.destinations,source_identity:source.identity,qualification:'synthetic_only',selection_authorizes_label_purchase:false};
 }
 select(scope:Scope,input:unknown){const p=exact(jsonValue(input),['request_id','destination_id','expected_revision']);id(p.request_id);id(p.destination_id);integer(p.expected_revision);const k=this.kernel;
  return k.transaction(()=>{const ctx=context(k,scope,p.request_id);k.authorize(scope,'action.configure',ctx.c.resource_id);assertCaseWorkerScope(k,scope,ctx.c.id);assertExecution(k,ctx.s,FULFILLMENT_ACTIONS.label);
   const {source,policy}=sourceFor(k,scope,ctx),bound=binding(k,scope,ctx,source),old=selection(k,ctx.s,p.request_id);if((old?.row.revision??0)!==p.expected_revision)throw new Error('DESTINATION_SELECTION_CHANGED');
   const evaluation=source.destinations.evaluate(p.request_id),choice=evaluation.destinations.find(d=>d.destination_id===p.destination_id);if(!choice?.eligible)throw new Error('DESTINATION_INELIGIBLE');
   const parcel=parcelRow(k,scope,p.request_id),destination=source.destinations.destination(p.destination_id),body={...parcel.parcel,to_address_ref:destination.address_ref,address_revision:parcel.parcel.address_revision+(parcel.parcel.to_address_ref===destination.address_ref?0:1)};
   const parcelDigest=contentDigest(body),parcelRevision=parcel.revision+1,route=source.destinations.select({request_id:p.request_id,destination_id:p.destination_id,revision:p.expected_revision+1,policy_digest:policy.digest,parcel_digest:parcelDigest,parcel_revision:parcelRevision});
   const selected={request_id:p.request_id,case_id:ctx.c.id,resource_id:ctx.c.resource_id,source_identity:source.identity,policy_digest:policy.digest,binding_digest:bound.row.digest,route};
   k.db.prepare('UPDATE commerce_return_parcels SET revision=?,body=?,digest=? WHERE tenant_id=? AND store_id=? AND request_id=?').run(parcelRevision,canonical(body),parcelDigest,ctx.s.tenant_id,ctx.s.store_id,p.request_id);
   k.db.prepare('INSERT INTO commerce_destination_selections VALUES(?,?,?,?,?,?,?,?,?,?)').run(ctx.s.tenant_id,ctx.s.store_id,p.request_id,ctx.c.id,ctx.c.resource_id,p.expected_revision+1,source.identity,canonical(selected),contentDigest(selected),k.clock());
   return {revision:p.expected_revision+1,route,parcel_revision:parcelRevision,requires_new_label_quote:true,execution_authorized:false,qualification:'synthetic_only'};
  });
 }
 read(scope:Scope,input:unknown){const p=exact(jsonValue(input),['request_id']),ctx=context(this.kernel,scope,p.request_id,false),k=this.kernel;k.authorize(scope,'operation.read',ctx.c.resource_id);
  const b=latest(k,'commerce_destination_bindings',ctx.s,p.request_id),selected=selection(k,ctx.s,p.request_id);
  return {request_id:p.request_id,binding:b?{revision:b.revision,digest:b.digest,body:checkedBody(b,'DESTINATION_HISTORY_INTEGRITY')}:null,selection:selected?{revision:selected.row.revision,digest:selected.row.digest,route:selected.body.route}:null,
   qualification:'synthetic_only',requires_current_revalidation:true,execution_authorized:false};
 }
}
