import {saveDocument,checkedDocument,documentRow} from './support-core.mts';
import type {CommerceKernel,Scope,Row} from './kernel.mts';
import {id,integer,exact} from './kernel.mts';
import {canonical,contentDigest,jsonValue} from './configuration-values.mts';
function units(x:unknown){if(typeof x!=='string'||!/^(0|[1-9][0-9]{0,23})$/.test(x))throw new Error('BUDGET_INPUT_INVALID');return BigInt(x);}
export class ModelBudgets {
 readonly k:CommerceKernel;constructor(k:CommerceKernel){this.k=k;}
 enabled(scope:Scope){const s=this.k.require(scope);return !!this.k.db.prepare('SELECT 1 FROM commerce_model_budgets WHERE tenant_id=? AND store_id=? LIMIT 1').get(s.tenant_id,s.store_id);}
 configure(scope:Scope,input:unknown){const p=exact(jsonValue(input),['provider_id','period_id','starts_at','ends_at','limit_micro','input_micro','output_micro','max_input_bytes','max_output_tokens','expected_revision']);
  id(p.provider_id);id(p.period_id);integer(p.starts_at);integer(p.ends_at);integer(p.expected_revision);integer(p.max_input_bytes,1);integer(p.max_output_tokens,1);[p.limit_micro,p.input_micro,p.output_micro].forEach(units);
  if(p.starts_at>=p.ends_at||p.ends_at-p.starts_at>31*86400000||p.ends_at<=this.k.clock()||p.max_input_bytes>1048576||p.max_output_tokens>32768)throw new Error('BUDGET_INPUT_INVALID');
  return this.k.transaction(()=>{const s=this.k.authorize(scope,'support.configure'),old=this.k.db.prepare('SELECT * FROM commerce_model_budgets WHERE tenant_id=? AND store_id=? AND provider_id=? AND period_id=?').get(s.tenant_id,s.store_id,p.provider_id,p.period_id) as Row;
   if((old?.revision??0)!==p.expected_revision)throw new Error('BUDGET_CONFIGURATION_CHANGED');
   const overlap=this.k.db.prepare('SELECT 1 FROM commerce_model_budgets WHERE tenant_id=? AND store_id=? AND provider_id=? AND period_id<>? AND starts_at<? AND ends_at>?').get(s.tenant_id,s.store_id,p.provider_id,p.period_id,p.ends_at,p.starts_at);if(overlap)throw new Error('BUDGET_PERIOD_OVERLAP');
   const rows=this.k.db.prepare('SELECT maximum_micro,state,charged_micro FROM commerce_model_reservations WHERE tenant_id=? AND store_id=? AND provider_id=? AND period_id=?').all(s.tenant_id,s.store_id,p.provider_id,p.period_id) as Row[];
   const committed=rows.reduce((n,r)=>n+units(r.state==='settled'?r.charged_micro:r.maximum_micro),0n);if(committed>units(p.limit_micro)||old&&rows.length&&(old.starts_at!==p.starts_at||old.ends_at!==p.ends_at))throw new Error('BUDGET_BELOW_COMMITTED');
   this.k.db.prepare('INSERT INTO commerce_model_budgets VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,store_id,provider_id,period_id) DO UPDATE SET starts_at=excluded.starts_at,ends_at=excluded.ends_at,limit_micro=excluded.limit_micro,input_micro=excluded.input_micro,output_micro=excluded.output_micro,max_input_bytes=excluded.max_input_bytes,max_output_tokens=excluded.max_output_tokens,revision=excluded.revision')
    .run(s.tenant_id,s.store_id,p.provider_id,p.period_id,p.starts_at,p.ends_at,p.limit_micro,p.input_micro,p.output_micro,p.max_input_bytes,p.max_output_tokens,p.expected_revision+1);
   return {provider_id:p.provider_id,period_id:p.period_id,revision:p.expected_revision+1,unit:'USD_micro',live_price_qualified:false};});
 }
 configureMerchant(scope:Scope,input:unknown){const p=exact(jsonValue(input),['period_id','starts_at','ends_at','limit_micro','expected_revision']);id(p.period_id);integer(p.starts_at);integer(p.ends_at);integer(p.expected_revision);units(p.limit_micro);if(p.starts_at>=p.ends_at||p.ends_at-p.starts_at>31*86400000||p.ends_at<=this.k.clock())throw new Error('BUDGET_INPUT_INVALID');return this.k.transaction(()=>{const s=this.k.authorize(scope,'support.configure'),rows=this.k.db.prepare("SELECT body,id FROM commerce_support_documents WHERE tenant_id=? AND store_id=? AND kind='merchant_budget' AND state='active'").all(s.tenant_id,s.store_id) as Row[];for(const row of rows){const old=JSON.parse(row.body);if(row.id!==p.period_id&&old.starts_at<p.ends_at&&old.ends_at>p.starts_at)throw new Error('BUDGET_PERIOD_OVERLAP');if(row.id===p.period_id&&(old.starts_at!==p.starts_at||old.ends_at!==p.ends_at))throw new Error('BUDGET_CONFIGURATION_CHANGED');}const held=this.#merchantCommitted(s,p.starts_at,p.ends_at);if(held>units(p.limit_micro))throw new Error('BUDGET_BELOW_COMMITTED');return saveDocument(this.k,s,'merchant_budget',p.period_id,p.expected_revision,p,'active',p.ends_at);});}
 #merchantCommitted(s:Row,start:number,end:number){const rows=this.k.db.prepare('SELECT state,charged_micro,maximum_micro FROM commerce_model_reservations WHERE tenant_id=? AND store_id=? AND created_at>=? AND created_at<?').all(s.tenant_id,s.store_id,start,end) as Row[];return rows.reduce((total,r)=>total+units(r.state==='settled'?r.charged_micro:r.maximum_micro),0n);}
 reserve(scope:Scope,provider:string,requestId:string,request:unknown){id(provider);id(requestId);const normalized=jsonValue(request,1048576) as Row,hash=contentDigest(normalized);integer(normalized.max_output_tokens,1);
  return this.k.transaction(()=>{const s=this.k.authorize(scope,'model.run'),old=this.k.db.prepare('SELECT * FROM commerce_model_reservations WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,requestId) as Row;
   if(old){if(old.provider_id!==provider||old.request_digest!==hash||old.owner_actor!==s.actor_id||old.owner_session_hash!==s.token_hash)throw new Error('BUDGET_IDEMPOTENCY_CONFLICT');return {id:old.id,state:old.state,maximum_micro:old.maximum_micro,duplicate:true};}
   const b=this.k.db.prepare('SELECT * FROM commerce_model_budgets WHERE tenant_id=? AND store_id=? AND provider_id=? AND starts_at<=? AND ends_at>?').get(s.tenant_id,s.store_id,provider,this.k.clock(),this.k.clock()) as Row;
   if(!b)throw new Error('MODEL_BUDGET_UNCONFIGURED');
   // UTF-8 byte bound plus protocol allowance. Provider/tokenizer calibration remains separate.
   const inputBound=Buffer.byteLength(canonical(normalized))+512;
   if(inputBound>b.max_input_bytes||normalized.max_output_tokens>b.max_output_tokens)throw new Error('MODEL_REQUEST_LIMIT');
   const maximum=BigInt(inputBound)*units(b.input_micro)+BigInt(normalized.max_output_tokens)*units(b.output_micro);
   const rows=this.k.db.prepare('SELECT state,charged_micro,maximum_micro FROM commerce_model_reservations WHERE tenant_id=? AND store_id=? AND provider_id=? AND period_id=?').all(s.tenant_id,s.store_id,provider,b.period_id) as Row[];
   const committed=rows.reduce((n,r)=>n+units(r.state==='settled'?r.charged_micro:r.maximum_micro),0n);
   if(committed+maximum>units(b.limit_micro))throw new Error('MODEL_BUDGET_EXHAUSTED');
   const caps=this.k.db.prepare("SELECT id,max(version) version FROM commerce_support_documents WHERE tenant_id=? AND store_id=? AND kind='merchant_budget' GROUP BY id").all(s.tenant_id,s.store_id) as Row[];
   if(caps.length){let matched=false;for(const cap of caps){const candidate=documentRow(this.k,s,'merchant_budget',cap.id,cap.version),v=candidate.body;if(v.starts_at<=this.k.clock()&&v.ends_at>this.k.clock()){checkedDocument(this.k,s,'merchant_budget',cap.id,cap.version);matched=true;if(this.#merchantCommitted(s,v.starts_at,v.ends_at)+maximum>units(v.limit_micro))throw new Error('MODEL_BUDGET_EXHAUSTED');}}if(!matched)throw new Error('MODEL_BUDGET_UNCONFIGURED');}

   this.k.db.prepare("INSERT INTO commerce_model_reservations VALUES(?,?,?,?,?,?,?,'reserved',NULL,?,?,NULL,?,?,?)").run(s.tenant_id,s.store_id,requestId,provider,b.period_id,hash,maximum.toString(),b.input_micro,b.output_micro,s.actor_id,s.token_hash,this.k.clock());
   return {id:requestId,state:'reserved',maximum_micro:maximum.toString(),duplicate:false};
  });
 }
 settle(scope:Scope,requestId:string,usage:unknown){id(requestId);let p:Row|null=null;if(usage!==null){p=exact(jsonValue(usage),['input_tokens','output_tokens']);integer(p.input_tokens);integer(p.output_tokens);}
  return this.k.transaction(()=>{const s=this.k.require(scope),r=this.k.db.prepare('SELECT * FROM commerce_model_reservations WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,requestId) as Row;if(!r||r.owner_actor!==s.actor_id||r.owner_session_hash!==s.token_hash)throw new Error('NOT_FOUND');
   // Accounting must survive a model stop; it cannot create a call or release an unknown reservation.
   const hash=contentDigest(p);if(r.state==='settled'){if(r.usage_digest!==hash)throw new Error('BUDGET_SETTLEMENT_CONFLICT');return {id:requestId,state:'settled',charged_micro:r.charged_micro,duplicate:true};}
   if(p===null){this.k.db.prepare("UPDATE commerce_model_reservations SET state='unknown' WHERE tenant_id=? AND store_id=? AND id=?").run(s.tenant_id,s.store_id,requestId);return {id:requestId,state:'unknown',held_micro:r.maximum_micro};}
   const actual=BigInt(p.input_tokens)*units(r.input_micro)+BigInt(p.output_tokens)*units(r.output_micro);
   this.k.db.prepare("UPDATE commerce_model_reservations SET state='settled',charged_micro=?,usage_digest=? WHERE tenant_id=? AND store_id=? AND id=?").run(actual.toString(),hash,s.tenant_id,s.store_id,requestId);
   return {id:requestId,state:'settled',charged_micro:actual.toString(),exceeded_reserved_bound:actual>units(r.maximum_micro),duplicate:false};
  });
 }
 inspect(scope:Scope,provider:string,period:string){const s=this.k.authorize(scope,'support.analytics');id(provider);id(period);const b=this.k.db.prepare('SELECT * FROM commerce_model_budgets WHERE tenant_id=? AND store_id=? AND provider_id=? AND period_id=?').get(s.tenant_id,s.store_id,provider,period) as Row;if(!b)throw new Error('NOT_FOUND');const rows=this.k.db.prepare('SELECT * FROM commerce_model_reservations WHERE tenant_id=? AND store_id=? AND provider_id=? AND period_id=?').all(s.tenant_id,s.store_id,provider,period) as Row[];
  let charged=0n,held=0n;for(const r of rows)if(r.state==='settled')charged+=units(r.charged_micro);else held+=units(r.maximum_micro);
  return {provider_id:provider,period_id:period,limit_micro:b.limit_micro,charged_micro:charged.toString(),held_micro:held.toString(),remaining_micro:(units(b.limit_micro)-charged-held).toString(),unknown_usage_count:rows.filter(r=>r.state==='unknown').length,reservation_count:rows.length};
 }
}
