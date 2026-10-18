import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { exact, id, integer } from './kernel.mts';
import type { CommerceKernel, Row, Scope } from './kernel.mts';
import { canonical, contentDigest, jsonValue } from './configuration-values.mts';
import { addMoney, money } from './money.mts';
import { assertRecoveryAction } from './data-guards.mts';
import { CarrierQuoteFixtureSource } from '../adapters/carrier-quote-fixture-source.mts';

const MAX_PACKAGES=32;
const RATE_FIELDS=['package_id','account_id','service','rate_id','revision','amount_minor','currency','expires_at','source_identity','tenant_id','store_id','carrier_id',
  'account_revision','account_digest','package_revision','address_revision','parcel_digest','observed_at','rate_digest'];
const SNAPSHOT_FIELDS=['version','batch_id','tenant_id','store_id','source_identity','policy_id','policy_revision','policy_digest','created_at','checked_at','packages','totals','combined_total',
  'all_eligible','currency_conversion_performed','execution_authorized','financial_effect','carrier_connected','label_purchase_supported','qualification','formal_goal_accepted','integrity'];
const packageFields=['package_id','resource_id','revision','address_revision','from_address_ref','to_address_ref','from_country','to_country','weight_g','length_mm','width_mm','height_mm'];
function frozen<T>(value:T):T {if(value&&typeof value==='object'){for(const child of Object.values(value))frozen(child);Object.freeze(value);}return value;}
function resourceDigest(resource:Row){return contentDigest({id:resource.id,kind:resource.kind,source_system:resource.source_system,external_id:resource.external_id,
  source_version:resource.source_version,source_updated_at:resource.source_updated_at,payload:resource.payload});}
function checkedPolicy(input:unknown,k:CommerceKernel,source:CarrierQuoteFixtureSource) {
  const p=exact(jsonValue(input),['id','revision','tenant_id','store_id','source_identity','expires_at','rules']);
  for(const name of ['id','tenant_id','store_id','source_identity'])id(p[name]);integer(p.revision,1);integer(p.expires_at);
  if(p.expires_at<=k.clock())throw new Error('POLICY_EXPIRED');
  if(p.tenant_id!==source.tenant_id||p.store_id!==source.store_id||p.source_identity!==source.identity)throw new Error('SOURCE_SCOPE_MISMATCH');
  if(!Array.isArray(p.rules)||!p.rules.length||p.rules.length>32)throw new Error('POLICY_INVALID');const seen=new Set();
  for(const r of p.rules){
    exact(r,['id','account_id','carrier_id','service','currency','max_amount_minor','from_countries','to_countries','max_weight_g','max_length_mm','max_width_mm','max_height_mm']);
    for(const name of ['id','account_id','carrier_id','service'])id(r[name]);if(seen.has(r.id))throw new Error('POLICY_INVALID');seen.add(r.id);money(r.currency,r.max_amount_minor);
    for(const name of ['max_weight_g','max_length_mm','max_width_mm','max_height_mm']){integer(r[name],1);if(r[name]>100000)throw new Error('POLICY_INVALID');}
    for(const name of ['from_countries','to_countries']){const values=r[name];
      if(!Array.isArray(values)||!values.length||values.length>32||new Set(values).size!==values.length||values.some(v=>typeof v!=='string'||!/^[A-Z]{2}$/.test(v)))throw new Error('POLICY_INVALID');
      r[name]=[...values].sort();
    }
  }
  return frozen(p);
}

/** Scoped, ephemeral preparation. No durable quote registry, approval, purchase or dispatch. */
export class CarrierQuotes {
  #k:CommerceKernel;#source:CarrierQuoteFixtureSource;#policy:Row;#policyDigest:string;#key=randomBytes(32);
  constructor(k:CommerceKernel,source:CarrierQuoteFixtureSource,policy:unknown) {
    if(!(source instanceof CarrierQuoteFixtureSource))throw new Error('SYNTHETIC_SOURCE_REQUIRED');
    this.#k=k;this.#source=source;this.#policy=checkedPolicy(policy,k,source);this.#policyDigest=contentDigest(this.#policy);
  }
  #session(scope:Scope) {
    // A resource-limited operator is authorized separately for each package;
    // a global resource-null permission check would incorrectly reject it.
    const s=this.#k.require(scope);assertRecoveryAction(this.#k,'action.propose');
    if(s.tenant_id!==this.#source.tenant_id||s.store_id!==this.#source.store_id)throw new Error('SOURCE_SCOPE_MISMATCH');return s;
  }
  #request(input:unknown) {
    const p=exact(jsonValue(input),['batch_id','packages']);id(p.batch_id);
    if(!Array.isArray(p.packages)||!p.packages.length||p.packages.length>MAX_PACKAGES)throw new Error('INVALID_BATCH');const seen=new Set();
    for(const r of p.packages){exact(r,['package_id','resource_id','rule_id']);id(r.package_id);id(r.resource_id);id(r.rule_id);
      if(seen.has(r.package_id))throw new Error('DUPLICATE_PACKAGE');seen.add(r.package_id);}
    return p;
  }
  #facts(scope:Scope,request:Row) {
    let resource:Row;
    try{resource=this.#k.get(scope,request.resource_id);this.#k.authorize(scope,'action.propose',request.resource_id);}
    catch{throw new Error('RESOURCE_UNAVAILABLE');}
    if(resource.kind!=='order')throw new Error('RESOURCE_UNAVAILABLE');
    const parcel=this.#source.package(request.package_id);if(!parcel)throw new Error('PACKAGE_UNAVAILABLE');
    try{exact(parcel,packageFields);for(const name of ['package_id','resource_id','from_address_ref','to_address_ref'])id(parcel[name]);
      for(const name of ['revision','address_revision','weight_g','length_mm','width_mm','height_mm'])integer(parcel[name],1);
      if(parcel.package_id!==request.package_id||parcel.resource_id!==request.resource_id)throw new Error('INVALID_INPUT');
      for(const name of ['from_country','to_country'])if(typeof parcel[name]!=='string'||!/^[A-Z]{2}$/.test(parcel[name]))throw new Error('INVALID_INPUT');
    }catch{throw new Error('PACKAGE_RESOURCE_MISMATCH');}
    return {resource,parcel};
  }
  #prepare(scope:Scope,request:Row,now:number):Row {
    const blocked=(reason:string)=>({...request,status:'blocked',reasons:[reason],quote:null});
    try{
      const {resource,parcel}=this.#facts(scope,request),rule=this.#policy.rules.find((r:Row)=>r.id===request.rule_id);
      if(!rule)return blocked('SERVICE_NOT_PERMITTED');
      if(this.#policy.expires_at<=now)return blocked('POLICY_EXPIRED');
      if(['weight_g','length_mm','width_mm','height_mm'].some(name=>parcel[name]>rule['max_'+name]))return blocked('PACKAGE_UNSUPPORTED');
      if(!rule.from_countries.includes(parcel.from_country)||!rule.to_countries.includes(parcel.to_country))return blocked('DESTINATION_NOT_PERMITTED');
      const account=this.#source.account(rule.account_id);
      if(!account||!account.enabled)return blocked('ACCOUNT_UNAVAILABLE');
      if(account.carrier_id!==rule.carrier_id||!account.services.includes(rule.service))return blocked('SERVICE_NOT_PERMITTED');
      if(!account.currencies.includes(rule.currency))return blocked('RATE_CURRENCY_NOT_PERMITTED');
      const rate=this.#source.rate(request.package_id,rule.account_id,rule.service);if(!rate)return blocked('RATE_UNAVAILABLE');
      try{
        exact(rate,RATE_FIELDS);for(const name of ['rate_id','package_id','account_id','service','carrier_id','source_identity','tenant_id','store_id'])id(rate[name]);
        for(const name of ['revision','account_revision','package_revision','address_revision'])integer(rate[name],1);
        integer(rate.expires_at);integer(rate.observed_at);money(rate.currency,rate.amount_minor);
        const {rate_digest,...body}=rate;if(rate_digest!==contentDigest(body))throw new Error('INVALID_INPUT');
        if(rate.source_identity!==this.#source.identity||rate.tenant_id!==this.#source.tenant_id||rate.store_id!==this.#source.store_id||rate.package_id!==request.package_id
          ||rate.account_id!==rule.account_id||rate.carrier_id!==rule.carrier_id||rate.service!==rule.service||rate.observed_at>now)throw new Error('INVALID_INPUT');
      }catch{return blocked('RATE_SOURCE_MISMATCH');}
      if(rate.parcel_digest!==contentDigest(parcel)||rate.package_revision!==parcel.revision||rate.address_revision!==parcel.address_revision)return blocked('RATE_PACKAGE_CHANGED');
      if(rate.account_revision!==account.revision||rate.account_digest!==contentDigest(account))return blocked('RATE_ACCOUNT_CHANGED');
      if(rate.currency!==rule.currency)return blocked('RATE_CURRENCY_NOT_PERMITTED');
      if(BigInt(rate.amount_minor)>BigInt(rule.max_amount_minor))return blocked('RATE_EXCEEDS_POLICY');
      if(rate.expires_at<=now)return blocked('RATE_UNAVAILABLE');
      const quote={source_identity:this.#source.identity,tenant_id:this.#source.tenant_id,store_id:this.#source.store_id,
        resource_id:resource.id,resource_revision:resource.source_version,resource_digest:resourceDigest(resource),
        package_id:parcel.package_id,package_revision:parcel.revision,address_revision:parcel.address_revision,parcel_digest:contentDigest(parcel),
        from_address_ref:parcel.from_address_ref,to_address_ref:parcel.to_address_ref,from_country:parcel.from_country,to_country:parcel.to_country,
        parcel:{weight_g:parcel.weight_g,length_mm:parcel.length_mm,width_mm:parcel.width_mm,height_mm:parcel.height_mm},
        account_id:account.account_id,account_revision:account.revision,account_digest:contentDigest(account),carrier_id:rule.carrier_id,service:rule.service,
        rule_id:rule.id,rule_digest:contentDigest(rule),rate_id:rate.rate_id,rate_revision:rate.revision,rate_digest:rate.rate_digest,
        amount_minor:rate.amount_minor,currency:rate.currency,rate_expires_at:rate.expires_at,expires_at:Math.min(rate.expires_at,this.#policy.expires_at,now+300000)};
      return {...request,status:'eligible',reasons:[],quote};
    }catch(error){
      const reason=(error as Error).message;
      if(['RESOURCE_UNAVAILABLE','PACKAGE_UNAVAILABLE','PACKAGE_RESOURCE_MISMATCH'].includes(reason))return blocked(reason);
      throw error;
    }
  }
  #seal(batchId:string,createdAt:number,checkedAt:number,packages:Row[]):Row {
    const sums=new Map<string,{currency:string;amount_minor:string;package_ids:string[]}>();
    for(const p of packages.filter(p=>p.status==='eligible')){
      const q=p.quote,old=sums.get(q.currency),amount=addMoney(money(q.currency,old?.amount_minor??'0'),money(q.currency,q.amount_minor));
      sums.set(q.currency,{currency:q.currency,amount_minor:amount.minor,package_ids:[...(old?.package_ids??[]),p.package_id]});
    }
    const totals=[...sums.values()].sort((a,b)=>a.currency.localeCompare(b.currency));
    const body={version:1,batch_id:batchId,tenant_id:this.#source.tenant_id,store_id:this.#source.store_id,source_identity:this.#source.identity,
      policy_id:this.#policy.id,policy_revision:this.#policy.revision,policy_digest:this.#policyDigest,created_at:createdAt,checked_at:checkedAt,packages,totals,
      combined_total:totals.length===1?{currency:totals[0].currency,amount_minor:totals[0].amount_minor}:null,all_eligible:packages.every(p=>p.status==='eligible'),
      currency_conversion_performed:false,execution_authorized:false,financial_effect:false,carrier_connected:false,label_purchase_supported:false,
      qualification:'synthetic_only',formal_goal_accepted:false};
    return frozen({...jsonValue(body),integrity:createHmac('sha256',this.#key).update(canonical(body)).digest('hex')});
  }
  quote(scope:Scope,input:unknown):Row {
    this.#session(scope);const p=this.#request(input),now=integer(this.#k.clock());
    return this.#seal(p.batch_id,now,now,p.packages.map((request:Row)=>this.#prepare(scope,request,now)));
  }
  revalidate(scope:Scope,snapshot:unknown):Row {
    this.#session(scope);let p:Row;
    try{
      p=exact(jsonValue(snapshot),SNAPSHOT_FIELDS);const {integrity,...body}=p;
      if(typeof integrity!=='string'||!/^[a-f0-9]{64}$/.test(integrity))throw new Error('INVALID_INPUT');
      const expected=createHmac('sha256',this.#key).update(canonical(body)).digest();
      if(!timingSafeEqual(expected,Buffer.from(integrity,'hex'))||p.policy_digest!==this.#policyDigest||p.source_identity!==this.#source.identity)throw new Error('INVALID_INPUT');
    }catch{throw new Error('SNAPSHOT_INTEGRITY');}
    const now=integer(this.#k.clock());if(now<p.checked_at)throw new Error('CLOCK_REWIND');
    const packages=p.packages.map((old:Row)=>{
      // Revalidation never silently promotes a formerly blocked/stale package.
      if(old.status!=='eligible')return old;
      const stale=(reason:string)=>({...old,status:'stale',reasons:[reason]});
      try{
        const {resource,parcel}=this.#facts(scope,old);
        if(resourceDigest(resource)!==old.quote.resource_digest)return stale('RESOURCE_CHANGED');
        if(contentDigest(parcel)!==old.quote.parcel_digest)return stale('PACKAGE_CHANGED');
        if(old.quote.expires_at<=now)return stale('QUOTE_EXPIRED');
        const request={package_id:old.package_id,resource_id:old.resource_id,rule_id:old.rule_id},current=this.#prepare(scope,request,now);
        if(current.status!=='eligible')return stale(current.reasons[0]);
        if(current.quote.account_digest!==old.quote.account_digest)return stale('ACCOUNT_CHANGED');
        if(current.quote.rate_digest!==old.quote.rate_digest||current.quote.rule_digest!==old.quote.rule_digest)return stale('RATE_CHANGED');
        return old;
      }catch(error){const reason=(error as Error).message;
        if(['RESOURCE_UNAVAILABLE','PACKAGE_UNAVAILABLE','PACKAGE_RESOURCE_MISMATCH'].includes(reason))return stale(reason);throw error;}
    });
    return this.#seal(p.batch_id,p.created_at,now,packages);
  }
}
