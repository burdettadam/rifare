import type { DatabaseSync } from 'node:sqlite';
import { exact,id,integer } from '../commerce/kernel.mts';
import type { Row } from '../commerce/kernel.mts';
import { canonical,contentDigest,jsonValue } from '../commerce/configuration-values.mts';
import { minor } from '../commerce/resolution-ledger.mts';

export const DESTINATION_CAPABILITIES=Object.freeze(['item_routing','category_routing','region_routing','capacity_admission','handling_fee_estimate','native_label_destination']);
const nativeId=(value:unknown,kind:string)=>{if(typeof value!=='string'||!new RegExp('^gid://shopify/'+kind+'/[1-9][0-9]*$').test(value))throw new Error('INVALID_INPUT');return value;};
function ids(value:unknown,allowEmpty=false):string[]{
 if(!Array.isArray(value)||value.length>64||!allowEmpty&&!value.length||new Set(value).size!==value.length)throw new Error('INVALID_INPUT');
 return value.map(id).sort();
}
function checked(row:Row|undefined){if(!row)throw new Error('DESTINATION_BINDING_REQUIRED');const b=JSON.parse(row.body);if(contentDigest(b)!==row.digest)throw new Error('DESTINATION_SOURCE_INTEGRITY');return b;}

/** Native fixture authority, on the fulfillment source database so admission and label purchase commit together. */
export class ReturnDestinationFixtureSource {
 readonly db:DatabaseSync;readonly identity:string;readonly tenant:string;readonly store:string;readonly clock:()=>number;
 readonly qualification='synthetic_only';
 constructor(db:DatabaseSync,options:{identity:string;tenant:string;store:string;clock:()=>number}){
  this.db=db;this.identity=id(options.identity);this.tenant=id(options.tenant);this.store=id(options.store);this.clock=options.clock;
  const identity=db.prepare('SELECT * FROM fixture_identity').get() as Row;
  if(!identity||identity.id!==this.identity||identity.tenant!==this.tenant||identity.store!==this.store)throw new Error('FIXTURE_SOURCE_MISMATCH');
  db.exec(`
   CREATE TABLE IF NOT EXISTS fixture_destination_qualifications(account_id TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(account_id,revision)) STRICT;
   CREATE TABLE IF NOT EXISTS fixture_return_destinations(destination_id TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(destination_id,revision)) STRICT;
   CREATE TABLE IF NOT EXISTS fixture_destination_requests(request_id TEXT NOT NULL,revision INTEGER NOT NULL,resource_id TEXT NOT NULL,native_return_id TEXT NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(request_id,revision)) STRICT;
   CREATE TABLE IF NOT EXISTS fixture_destination_policies(account_id TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(account_id,revision)) STRICT;
   CREATE TABLE IF NOT EXISTS fixture_destination_routes(request_id TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(request_id,revision)) STRICT;
   CREATE TABLE IF NOT EXISTS fixture_destination_admissions(operation_id TEXT PRIMARY KEY,request_id TEXT NOT NULL,destination_id TEXT NOT NULL,generation INTEGER NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,UNIQUE(request_id,generation)) STRICT;
  `);
 }
 #tx<T>(fn:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const value=fn();this.db.exec('COMMIT');return value;}catch(error){this.db.exec('ROLLBACK');throw error;}}
 #latest(table:string,key:string,value:string){return this.db.prepare(`SELECT body,digest,revision FROM ${table} WHERE ${key}=? ORDER BY revision DESC LIMIT 1`).get(id(value)) as Row|undefined;}
 #append(table:string,key:string,p:Row){const old=this.#latest(table,key,p[key]);
  if(old?.revision===p.revision){if(old.digest!==contentDigest(p))throw new Error('DESTINATION_REVISION_CONFLICT');return checked(old);}
  if(p.revision!==(old?.revision??0)+1)throw new Error('DESTINATION_REVISION_CONFLICT');
  this.db.prepare(`INSERT INTO ${table} VALUES(?,?,?,?)`).run(p[key],p.revision,canonical(p),contentDigest(p));return p;
 }
 qualify(input:unknown){const p=exact(jsonValue(input),['account_id','revision','enabled','contract_version','capabilities','expires_at']);
  id(p.account_id);integer(p.revision,1);id(p.contract_version);integer(p.expires_at);p.capabilities=ids(p.capabilities,true);
  if(typeof p.enabled!=='boolean'||p.capabilities.some((v:string)=>!DESTINATION_CAPABILITIES.includes(v))||p.expires_at>this.clock()+3600000||p.enabled&&p.expires_at<=this.clock())throw new Error('INVALID_INPUT');
  return this.#tx(()=>this.#append('fixture_destination_qualifications','account_id',p));
 }
 #qualification(account:string){const q=checked(this.#latest('fixture_destination_qualifications','account_id',account));
  if(!q.enabled||q.expires_at<=this.clock())throw new Error('DESTINATION_QUALIFICATION_EXPIRED');
  if(DESTINATION_CAPABILITIES.some(v=>!q.capabilities.includes(v)))throw new Error('DESTINATION_CAPABILITY_UNQUALIFIED');return q;
 }
 recordDestination(input:unknown){const p=exact(jsonValue(input),['destination_id','revision','account_id','address_ref','enabled','ownership','agreement_id','accepted_item_ids','accepted_categories','accepted_regions','handling_capabilities','dispositions','capacity_units','occupied_units','handling_fee_estimate_minor','currency','expires_at']);
  id(p.destination_id);id(p.account_id);id(p.address_ref);integer(p.revision,1);integer(p.capacity_units);integer(p.occupied_units);integer(p.expires_at);minor(p.handling_fee_estimate_minor);
  if(typeof p.enabled!=='boolean'||!['merchant_owned','contracted','uncontracted'].includes(p.ownership)||p.currency!=='USD'||p.capacity_units>100000||p.occupied_units>100000)throw new Error('INVALID_INPUT');
  if(p.agreement_id!==null)id(p.agreement_id);
  for(const key of ['accepted_item_ids','accepted_categories','accepted_regions','handling_capabilities','dispositions'])p[key]=ids(p[key],true);
  return this.#tx(()=>{this.#qualification(p.account_id);return this.#append('fixture_return_destinations','destination_id',p);});
 }
 destination(ref:string){return checked(this.#latest('fixture_return_destinations','destination_id',ref));}
 recordRequest(input:unknown){const p=exact(jsonValue(input),['request_id','revision','resource_id','customer_id','native_return_id','native_order_id','account_id','region','disposition','items','source_record_id']);
  for(const key of ['request_id','resource_id','customer_id','account_id','region','disposition','source_record_id'])id(p[key]);integer(p.revision,1);nativeId(p.native_return_id,'Return');nativeId(p.native_order_id,'Order');
  if(!Array.isArray(p.items)||!p.items.length||p.items.length>100)throw new Error('INVALID_INPUT');
  for(const item of p.items){exact(item,['line_id','fulfillment_line_id','item_id','category','quantity','required_handling']);id(item.line_id);id(item.item_id);id(item.category);integer(item.quantity,1);nativeId(item.fulfillment_line_id,'FulfillmentLineItem');item.required_handling=ids(item.required_handling);if(item.quantity>1000)throw new Error('INVALID_INPUT');}
  p.items.sort((a:Row,b:Row)=>a.line_id.localeCompare(b.line_id));if(new Set(p.items.map((i:Row)=>i.line_id)).size!==p.items.length)throw new Error('INVALID_INPUT');
  return this.#tx(()=>{this.#qualification(p.account_id);const old=this.#latest('fixture_destination_requests','request_id',p.request_id);
   if(old){const b=checked(old),original=(value:Row)=>({request_id:value.request_id,resource_id:value.resource_id,customer_id:value.customer_id,native_return_id:value.native_return_id,native_order_id:value.native_order_id,account_id:value.account_id,
    items:value.items.map((i:Row)=>({line_id:i.line_id,fulfillment_line_id:i.fulfillment_line_id,item_id:i.item_id,quantity:i.quantity}))});
    if(canonical(original(b))!==canonical(original(p)))throw new Error('DESTINATION_ORIGINAL_ITEMS_IMMUTABLE');
    if(old.revision===p.revision){if(old.digest!==contentDigest(p))throw new Error('DESTINATION_REVISION_CONFLICT');return b;}
   }
   if(p.revision!==(old?.revision??0)+1)throw new Error('DESTINATION_REVISION_CONFLICT');
   const other=this.db.prepare('SELECT request_id FROM fixture_destination_requests WHERE native_return_id=? AND request_id!=?').get(p.native_return_id,p.request_id) as Row;if(other)throw new Error('DESTINATION_NATIVE_RETURN_ALREADY_BOUND');
   this.db.prepare('INSERT INTO fixture_destination_requests VALUES(?,?,?,?,?,?)').run(p.request_id,p.revision,p.resource_id,p.native_return_id,canonical(p),contentDigest(p));return p;
  });
 }
 request(ref:string){return checked(this.#latest('fixture_destination_requests','request_id',ref));}
 required(account:string,request:string,resource?:string,nativeReturn?:string){
  if(typeof account==='string'&&this.#latest('fixture_destination_qualifications','account_id',account))return true;
  if(typeof account==='string'&&this.#latest('fixture_destination_policies','account_id',account))return true;
  return !!this.db.prepare('SELECT 1 FROM fixture_destination_requests WHERE request_id=? OR resource_id=? OR native_return_id=?').get(request??'',resource??'',nativeReturn??'');
 }
 syncPolicy(input:unknown){const p=exact(jsonValue(input),['tenant_id','store_id','revision','enabled','source_identity','account_id','policy_version','allowed_destination_ids','expires_at']);
  for(const key of ['tenant_id','store_id','source_identity','account_id'])id(p[key]);integer(p.revision,1);integer(p.policy_version,1);integer(p.expires_at);p.allowed_destination_ids=ids(p.allowed_destination_ids);
  if(p.tenant_id!==this.tenant||p.store_id!==this.store||p.source_identity!==this.identity||typeof p.enabled!=='boolean')throw new Error('DESTINATION_SOURCE_MISMATCH');
  return this.#tx(()=>{if(p.enabled)this.#qualification(p.account_id);const old=this.latestPolicy();
   if(old?.revision===p.revision){if(canonical(old)!==canonical(p))throw new Error('DESTINATION_REVISION_CONFLICT');return old;}
   if(p.revision!==(old?.revision??0)+1)throw new Error('DESTINATION_REVISION_CONFLICT');
   this.db.prepare('INSERT INTO fixture_destination_policies VALUES(?,?,?,?)').run(p.account_id,p.revision,canonical(p),contentDigest(p));return p;
  });
 }
 latestPolicy(){const row=this.db.prepare('SELECT body,digest FROM fixture_destination_policies ORDER BY revision DESC LIMIT 1').get() as Row|undefined;return row?checked(row):null;}
 policy(account:string){const p=this.latestPolicy();if(!p||p.account_id!==id(account)||!p.enabled||p.expires_at<=this.clock())throw new Error('DESTINATION_POLICY_UNAVAILABLE');return p;}
 admissions(){return (this.db.prepare('SELECT body,digest FROM fixture_destination_admissions ORDER BY operation_id').all() as Row[]).map(checked);}
 capacity(destination:string){const d=this.destination(destination);let admitted=0;
  for(const a of this.admissions().filter(a=>a.destination_id===destination)){
   const label=checked(this.db.prepare('SELECT body,digest FROM fixture_labels WHERE id=?').get(a.label_id) as Row);
   if(!['confirmed','expired_unused'].includes(label.void_state))admitted+=a.quantity;
  }
  return {capacity_units:d.capacity_units,occupied_units:d.occupied_units,admitted_units:admitted,available_units:Math.max(0,d.capacity_units-d.occupied_units-admitted)};
 }
 #decision(request:Row,destination:Row,policy:Row){const reasons:string[]=[],d=destination,r=request,quantity=r.items.reduce((n:number,i:Row)=>n+i.quantity,0),capacity=this.capacity(d.destination_id);
  if(!d.enabled)reasons.push('DESTINATION_DISABLED');
  if(!['merchant_owned','contracted'].includes(d.ownership))reasons.push('OWNERSHIP_UNQUALIFIED');
  if(d.agreement_id===null)reasons.push('AGREEMENT_REQUIRED');
  if(d.account_id!==r.account_id)reasons.push('DESTINATION_ACCOUNT_MISMATCH');
  if(d.expires_at<=this.clock())reasons.push('DESTINATION_EXPIRED');
  if(!policy.allowed_destination_ids.includes(d.destination_id))reasons.push('POLICY_DESTINATION_RESTRICTED');
  if(!d.accepted_regions.includes(r.region))reasons.push('REGION_UNSUPPORTED');
  if(r.items.some((i:Row)=>!d.accepted_item_ids.includes(i.item_id)))reasons.push('ITEM_UNSUPPORTED');
  if(r.items.some((i:Row)=>!d.accepted_categories.includes(i.category)))reasons.push('CATEGORY_UNSUPPORTED');
  if(r.items.some((i:Row)=>i.required_handling.some((h:string)=>!d.handling_capabilities.includes(h))))reasons.push('HANDLING_UNSUPPORTED');
  if(!d.dispositions.includes(r.disposition))reasons.push('DISPOSITION_UNSUPPORTED');
  if(capacity.available_units<quantity)reasons.push('CAPACITY_EXCEEDED');
  return {destination_id:d.destination_id,destination_revision:d.revision,destination_digest:contentDigest(d),ownership:d.ownership,agreement_id:d.agreement_id,eligible:reasons.length===0,reasons,
   handling_fee_estimate_minor:d.handling_fee_estimate_minor,currency:d.currency,expected_disposition:r.disposition,required_handling:[...new Set(r.items.flatMap((i:Row)=>i.required_handling))].sort(),quantity,capacity,expires_at:d.expires_at};
 }
 evaluate(requestId:string){const r=this.request(requestId),q=this.#qualification(r.account_id),p=this.policy(r.account_id);
  const rows=this.db.prepare('SELECT d.body,d.digest FROM fixture_return_destinations d JOIN (SELECT destination_id,MAX(revision) revision FROM fixture_return_destinations GROUP BY destination_id) latest USING(destination_id,revision)').all() as Row[];
  const destinations=rows.map(checked).filter(d=>d.account_id===r.account_id).map(d=>this.#decision(r,d,p)).sort((a,b)=>Number(!a.eligible)-Number(!b.eligible)||(minor(a.handling_fee_estimate_minor)<minor(b.handling_fee_estimate_minor)?-1:minor(a.handling_fee_estimate_minor)>minor(b.handling_fee_estimate_minor)?1:a.destination_id.localeCompare(b.destination_id)));
  return {request:r,request_digest:contentDigest(r),policy:p,policy_digest:contentDigest(p),qualification:q,qualification_digest:contentDigest(q),destinations,
   state:destinations.some(d=>d.eligible)?'eligible_destinations':'needs_review',recommended_destination_id:destinations.find(d=>d.eligible)?.destination_id??null};
 }
 select(input:unknown){const p=exact(jsonValue(input),['request_id','destination_id','revision','policy_digest','parcel_digest','parcel_revision']);id(p.request_id);id(p.destination_id);integer(p.revision,1);integer(p.parcel_revision,1);
  for(const key of ['policy_digest','parcel_digest'])if(typeof p[key]!=='string'||!/^[a-f0-9]{64}$/.test(p[key]))throw new Error('INVALID_INPUT');
  return this.#tx(()=>{const current=this.evaluate(p.request_id),d=current.destinations.find(d=>d.destination_id===p.destination_id);if(!d?.eligible)throw new Error('DESTINATION_INELIGIBLE');
   if(p.policy_digest!==current.policy_digest)throw new Error('DESTINATION_POLICY_CHANGED');
   const admitted=this.admissions().filter(a=>a.request_id===p.request_id).sort((a,b)=>b.generation-a.generation)[0];
   if(admitted){const label=checked(this.db.prepare('SELECT body,digest FROM fixture_labels WHERE id=?').get(admitted.label_id) as Row);if(!['confirmed','expired_unused'].includes(label.void_state))throw new Error('DESTINATION_LABEL_ALREADY_PURCHASED');}
   const old=this.#latest('fixture_destination_routes','request_id',p.request_id);
   if(old?.revision===p.revision){const route=checked(old);if(route.destination_id!==p.destination_id||route.policy_digest!==p.policy_digest||route.parcel_digest!==p.parcel_digest||route.parcel_revision!==p.parcel_revision)throw new Error('DESTINATION_REVISION_CONFLICT');this.assertSelection(route,{...current.request,parcel_digest:p.parcel_digest,parcel_revision:p.parcel_revision});return route;}
   if(p.revision!==(old?.revision??0)+1)throw new Error('DESTINATION_REVISION_CONFLICT');
   const nativeDestination=this.destination(p.destination_id),r=current.request,route={schema_version:1,selection_revision:p.revision,source_identity:this.identity,tenant_id:this.tenant,store_id:this.store,
    account_id:r.account_id,request_id:r.request_id,resource_id:r.resource_id,native_return_id:r.native_return_id,source_record_id:r.source_record_id,request_revision:r.revision,request_digest:current.request_digest,
    policy_revision:current.policy.revision,policy_version:current.policy.policy_version,policy_digest:current.policy_digest,qualification_revision:current.qualification.revision,qualification_digest:current.qualification_digest,
    destination_id:d.destination_id,destination_revision:d.destination_revision,destination_digest:d.destination_digest,destination_address_digest:contentDigest(nativeDestination.address_ref),parcel_digest:p.parcel_digest,parcel_revision:p.parcel_revision,
    region:r.region,quantity:d.quantity,required_handling:d.required_handling,expected_disposition:r.disposition,handling_fee_estimate_minor:d.handling_fee_estimate_minor,currency:d.currency,
    decision_reasons:['QUALIFIED_MERCHANT_DESTINATION','ITEM_CATEGORY_REGION_ACCEPTED','HANDLING_DISPOSITION_ACCEPTED','CAPACITY_AVAILABLE'],selected_at:this.clock(),expires_at:Math.min(this.clock()+300000,current.policy.expires_at,current.qualification.expires_at,d.expires_at),qualification:'synthetic_only'};
   this.db.prepare('INSERT INTO fixture_destination_routes VALUES(?,?,?,?)').run(p.request_id,p.revision,canonical(route),contentDigest(route));return route;
  });
 }
 latestSelection(requestId:string){const row=this.#latest('fixture_destination_routes','request_id',requestId);return row?checked(row):null;}
 selection(requestId:string){const selected=this.latestSelection(requestId);if(!selected)throw new Error('DESTINATION_BINDING_REQUIRED');return selected;}
 assertSelection(route:Row,context:Row){
  if(!route||typeof route!=='object')throw new Error('DESTINATION_BINDING_REQUIRED');
  const r=this.request(context.request_id),q=this.#qualification(r.account_id),policy=this.policy(r.account_id),stored=this.selection(r.request_id);
  if(route.policy_digest!==contentDigest(policy))throw new Error('DESTINATION_POLICY_CHANGED');
  if(route.request_digest!==contentDigest(r))throw new Error('DESTINATION_BINDING_CHANGED');
  if(canonical(route)!==canonical(stored)||route.qualification_digest!==contentDigest(q)||route.source_identity!==this.identity||route.tenant_id!==this.tenant||route.store_id!==this.store||route.expires_at<=this.clock())throw new Error('DESTINATION_CHANGED');
  for(const key of ['request_id','resource_id','native_return_id','account_id'])if(context[key]!==r[key])throw new Error('DESTINATION_BINDING_CHANGED');
  if(context.parcel_digest!==route.parcel_digest||context.parcel_revision!==route.parcel_revision)throw new Error('DESTINATION_PARCEL_CHANGED');
  const d=this.destination(route.destination_id);if(contentDigest(d)!==route.destination_digest)throw new Error('DESTINATION_CHANGED');
  if(!this.#decision(r,d,policy).eligible)throw new Error('DESTINATION_INELIGIBLE');return route;
 }
 assertRate(input:Row){const required=this.required(input.account_id,input.request_id,input.resource_id,input.native_return_id);
  if(!required){if(input.return_destination!==undefined)throw new Error('DESTINATION_BINDING_REQUIRED');return null;}
  if(!input.return_destination)throw new Error('DESTINATION_BINDING_REQUIRED');return this.assertSelection(input.return_destination,input);
 }
 assertCommand(command:Row){
  const required=this.required(command.account_id,command.request_id,command.resource_id,command.native_return_id);
  if(!required){if(command.return_destination!==undefined||command.rate?.return_destination!==undefined)throw new Error('DESTINATION_BINDING_REQUIRED');return null;}
  if(!command.return_destination||!command.rate?.return_destination)throw new Error('DESTINATION_BINDING_REQUIRED');
  if(canonical(command.return_destination)!==canonical(command.rate.return_destination))throw new Error('DESTINATION_CHANGED');
  const route=this.assertSelection(command.return_destination,command),r=this.request(command.request_id);
  if(command.customer_id!==r.customer_id||command.native_original_order_id!==r.native_order_id||command.original_order_id!==r.resource_id||command.rate.request_id!==r.request_id||command.rate.resource_id!==r.resource_id||command.rate.native_return_id!==r.native_return_id||command.obligation!==r.request_id+'_label_'+command.generation)throw new Error('DESTINATION_BINDING_CHANGED');
  integer(command.generation,1);id(command.operation_id);
  const prior=this.admissions().filter(a=>a.request_id===r.request_id).sort((a,b)=>b.generation-a.generation)[0];
  if(prior?command.generation!==prior.generation+1||command.replaces!==prior.label_id:command.generation!==1||command.replaces!==null)throw new Error('DESTINATION_LABEL_GENERATION_CHANGED');return route;
 }
 admit(command:Row,labelId:string){const route=this.assertCommand(command);if(!route)return;id(labelId);const r=this.request(command.request_id);
  const admission={operation_id:command.operation_id,request_id:r.request_id,resource_id:r.resource_id,destination_id:route.destination_id,generation:command.generation,label_id:labelId,quantity:route.quantity,route_digest:contentDigest(route),command_digest:contentDigest(command),admitted_at:this.clock(),qualification:'synthetic_only'};
  this.db.prepare('INSERT INTO fixture_destination_admissions VALUES(?,?,?,?,?,?)').run(admission.operation_id,admission.request_id,admission.destination_id,admission.generation,canonical(admission),contentDigest(admission));
 }
}
