import { exact,id } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { allocationContext,checkedBody,financialFacts,resolutionSettings } from './resolution-ledger.mts';
import { ResolutionFixtureSource } from '../adapters/resolution-fixture-source.mts';
import { feeSnapshot,originalMoneyTerms } from '../adapters/exchange-money-fixture-source.mts';

export function assertMoneySource(k:CommerceKernel,source:ResolutionFixtureSource){
 if(!(source instanceof ResolutionFixtureSource)||source.db===k.db)throw new Error('SEPARATE_FIXTURE_SOURCE_REQUIRED');
 const path=(db:any)=>db.prepare('PRAGMA database_list').all().find((r:Row)=>r.name==='main')?.file;
 if(path(source.db)&&path(source.db)===path(k.db))throw new Error('SEPARATE_FIXTURE_SOURCE_REQUIRED');
}
export function currencyBinding(k:CommerceKernel,s:Row,allocationId:string){
 const row=k.db.prepare('SELECT * FROM commerce_exchange_currency_bindings WHERE tenant_id=? AND store_id=? AND allocation_id=? ORDER BY revision DESC LIMIT 1').get(s.tenant_id,s.store_id,id(allocationId)) as Row;
 if(!row)return null;const b=checkedBody(row,'CURRENCY_HISTORY_INTEGRITY');
 if(b.allocation_id!==row.allocation_id||b.resource_id!==row.resource_id||b.source_identity!==row.source_identity||b.tenant_id!==s.tenant_id||b.store_id!==s.store_id||contentDigest(b.qualification)!==b.qualification_digest)throw new Error('CURRENCY_HISTORY_INTEGRITY');
 return b;
}
export function canonicalFeeEvents(k:CommerceKernel,s:Row,allocationId:string){
 return (k.db.prepare('SELECT * FROM commerce_exchange_fee_observations WHERE tenant_id=? AND store_id=? AND allocation_id=? ORDER BY phase,revision').all(s.tenant_id,s.store_id,id(allocationId)) as Row[]).map(row=>{
  const e=checkedBody(row,'FEE_HISTORY_INTEGRITY');if(e.allocation_id!==row.allocation_id||e.resource_id!==row.resource_id||e.event_id!==row.event_id||e.revision!==row.revision||e.phase!==row.phase||e.source_identity!==row.source_identity)throw new Error('FEE_HISTORY_INTEGRITY');return e;
 });
}
/** Current qualified snapshots can be refreshed; the original allocation cannot change. */
export class ExchangeCurrency {
 readonly kernel:CommerceKernel;readonly source:ResolutionFixtureSource;
 constructor(k:CommerceKernel,source:ResolutionFixtureSource){assertMoneySource(k,source);this.kernel=k;this.source=source;}
 bind(scope:Scope,input:unknown){const p=exact(jsonValue(input),['allocation_id']),k=this.kernel;
  return k.transaction(()=>{
   const {s,a,b,c,plan}=allocationContext(k,scope,p.allocation_id),facts=financialFacts(k,c);k.authorize(scope,'action.propose',c.resource_id);
   if(s.tenant_id!==this.source.tenant||s.store_id!==this.source.store||resolutionSettings(k,s).source_identity!==this.source.identity)throw new Error('RESOLUTION_SOURCE_MISMATCH');
   const native=k.db.prepare("SELECT * FROM commerce_native_return_operations WHERE tenant_id=? AND store_id=? AND request_id=? AND state='created'").get(s.tenant_id,s.store_id,plan.request_id) as Row;
   if(!native||!native.native_id)throw new Error('NATIVE_RETURN_REQUIRED');
   const binding=this.source.money.bindAllocation({allocation_id:a.id,resource_id:c.resource_id,line_id:b.line_id,units:b.units,restocking_bps:b.restocking_bps,return_shipping_minor:b.return_shipping_minor,native_return_id:native.native_id});
   const market=k.db.prepare('SELECT market FROM commerce_stores WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row;
   if(binding.customer_id!==c.customer_id||binding.payment_id!==facts.payment_id||binding.shop_currency!==facts.currency||canonical(binding.components.shop)!==canonical(b.components)||binding.qualification.market!==market.market)throw new Error('CURRENCY_BINDING_MISMATCH');
   const previous=currencyBinding(k,s,a.id);if(previous&&(previous.profile_digest!==binding.profile_digest||previous.source_identity!==binding.source_identity))throw new Error('ORIGINAL_MONEY_IMMUTABLE');
   const digest=contentDigest(binding),old=k.db.prepare('SELECT revision FROM commerce_exchange_currency_bindings WHERE tenant_id=? AND store_id=? AND allocation_id=? AND digest=?').get(s.tenant_id,s.store_id,a.id,digest) as Row;
   if(!old){const current=k.db.prepare('SELECT MAX(revision) revision FROM commerce_exchange_currency_bindings WHERE tenant_id=? AND store_id=? AND allocation_id=?').get(s.tenant_id,s.store_id,a.id) as Row;
    k.db.prepare('INSERT INTO commerce_exchange_currency_bindings VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,a.id,c.id,c.resource_id,plan.request_id,(current.revision??0)+1,this.source.identity,canonical(binding),digest,k.clock());}
   return this.read(scope,{allocation_id:a.id});
  });
 }
 read(scope:Scope,input:unknown){const p=exact(jsonValue(input),['allocation_id']),{s,c}=allocationContext(this.kernel,scope,p.allocation_id,false);this.kernel.authorize(scope,'operation.read',c.resource_id);
  const b=currencyBinding(this.kernel,s,p.allocation_id);if(!b)throw new Error('CURRENCY_BINDING_REQUIRED');return {allocation_id:b.allocation_id,digest:contentDigest(b),binding:b,qualification:'synthetic_only',live_financial_authority:false};
 }
}
export function currencyQuote(k:CommerceKernel,s:Row,q:Row){const b=currencyBinding(k,s,q.allocation_id);if(!b){if(k.db.prepare('SELECT 1 FROM commerce_exchange_currency_bindings WHERE tenant_id=? AND store_id=? AND resource_id=?').get(s.tenant_id,s.store_id,q.resource_id))throw new Error('CURRENCY_BINDING_REQUIRED');return q;}
 if(b.qualification.expires_at<=k.clock())throw new Error('CURRENCY_QUALIFICATION_EXPIRED');
 const terms=originalMoneyTerms(b,feeSnapshot(canonicalFeeEvents(k,s,q.allocation_id)),q);
 return {...q,money_terms:terms,expires_at:Math.min(q.expires_at,terms.expires_at),tax_treatment:'source_paired_original_allocations'};
}
export function assertExchangeMoneySupported(k:CommerceKernel,s:Row,allocationId:string){const a=k.db.prepare('SELECT resource_id FROM commerce_resolution_allocations WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(allocationId)) as Row;
 if(a&&k.db.prepare('SELECT 1 FROM commerce_exchange_currency_bindings WHERE tenant_id=? AND store_id=? AND resource_id=?').get(s.tenant_id,s.store_id,a.resource_id))throw new Error('EXCHANGE_CURRENCY_UNQUALIFIED');}
