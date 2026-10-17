import { exact,id,integer,token } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import {intakeSettings,evidenceReviewState} from './return-intake-core.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { allocationContext,resolutionSettings,checkedBody,financialFacts,minor } from './resolution-ledger.mts';

function exchangeValue(k:CommerceKernel,scope:Scope,allocationId:string,catalogId:string,quotedAt:number){
 const ctx=allocationContext(k,scope,allocationId),{c,a,b,s}=ctx;const settings=resolutionSettings(k,s),facts=financialFacts(k,c);
 if(intakeSettings(k,s).digest!==b.fee_settings_digest)throw new Error('REFUND_FEES_CHANGED');
 if(evidenceReviewState(k,s,c.id)?.event==='evidence_requested')throw new Error('RETURN_REVIEW_REQUIRED');
 const paid=facts.paid_lines.find((l:Row)=>l.id===b.line_id);
 if(!paid||contentDigest({...paid,resolved_units:[]})!==b.paid_line_digest)throw new Error('PAID_ALLOCATION_CHANGED');
 if(b.units.some((n:number)=>paid.resolved_units.includes(n)))throw new Error('UNIT_ALREADY_RESOLVED');
 k.authorize(scope,'action.propose',c.resource_id);
 if(a.outcome!=='exchange'||!c.pins.policy.body.rules.outcomes.includes('exchange'))throw new Error('OUTCOME_UNSUPPORTED');
 const catalog=k.get(scope,id(catalogId));if(catalog.kind!=='catalog'||catalog.source_system!=='synthetic')throw new Error('EXCHANGE_SOURCE_UNQUALIFIED');
 const v=exact(jsonValue(catalog.payload),['variant_id','product_id','currency','unit_price_minor','tax_per_unit_minor','shipping_minor','duties_per_unit_minor','available','discount_eligible','promotion_expires_at','excluded']);
 id(v.variant_id);id(v.product_id);integer(v.available);integer(v.promotion_expires_at);
 for(const key of ['unit_price_minor','tax_per_unit_minor','shipping_minor','duties_per_unit_minor'])minor(v[key]);
 if(typeof v.excluded!=='boolean'||typeof v.discount_eligible!=='boolean')throw new Error('EXCHANGE_SOURCE_INVALID');
 const reasons:string[]=[],maxAge=c.pins.composition.effective['data.max_age_seconds']*1000,discount=minor(b.components.discount_minor),qty=BigInt(b.units.length);
 if(catalog.observed_at>k.clock()||k.clock()-catalog.observed_at>maxAge)reasons.push('INVENTORY_STALE');
 if(v.product_id!==b.product_id)reasons.push('CATALOG_EXCHANGE_UNQUALIFIED');if(v.excluded)reasons.push('VARIANT_EXCLUDED');if(v.currency!==b.currency)reasons.push('CURRENCY_UNSUPPORTED');
 if(v.available-settings.inventory_buffer<b.units.length)reasons.push('INSUFFICIENT_STOCK');
 if(discount>0n&&(!v.discount_eligible||v.promotion_expires_at<=k.clock()))reasons.push('DISCOUNT_UNAVAILABLE');
 const replacement=minor(v.unit_price_minor)*qty-discount+minor(v.tax_per_unit_minor)*qty+minor(v.shipping_minor)+minor(v.duties_per_unit_minor)*qty;
 const restock=(minor(b.components.gross_minor)-minor(b.components.discount_minor))*BigInt(b.restocking_bps)/10000n,entitlement=minor(b.components.paid_minor)-restock-minor(b.return_shipping_minor);
 if(replacement<0n||entitlement<0n||replacement!==entitlement)reasons.push('PRICE_DIFFERENCE_UNSUPPORTED');
 const expires=Math.min(quotedAt+300000,catalog.observed_at+maxAge,settings.expires_at,discount>0n?v.promotion_expires_at:Number.MAX_SAFE_INTEGER);
 const op=k.db.prepare('SELECT id FROM commerce_resolution_operations WHERE tenant_id=? AND store_id=? AND allocation_id=?').get(s.tenant_id,s.store_id,a.id);if(op)throw new Error('ALLOCATION_ALREADY_AUTHORIZED');
 return {allocation_id:a.id,case_id:c.id,configuration_digest:c.configuration_digest,allocation_digest:a.digest,source_order_digest:contentDigest(c.order),catalog_id:catalog.id,catalog_version:catalog.source_version,catalog_digest:contentDigest(catalog),
  source_stock:v.available,buffer:settings.inventory_buffer,quantity:b.units.length,original_variant:b.variant_id,replacement_variant:v.variant_id,currency:b.currency,original_paid_minor:b.components.paid_minor,
  retained_discount_minor:discount.toString(),replacement_minor:replacement.toString(),balance_minor:(replacement-entitlement).toString(),available_exchange_value_minor:entitlement.toString(),restocking_minor:restock.toString(),return_shipping_minor:b.return_shipping_minor,settings_digest:settings.digest,
  allowed:reasons.length===0,reasons,alternatives:reasons.length?c.pins.policy.body.rules.outcomes.filter((o:string)=>o!=='exchange'&&(o!=='store_credit'||settings.credit_instrument==='native_store_credit')):[],
  quoted_at:quotedAt,expires_at:expires,stock_reserved:false,requires_atomic_reservation:true,commit_authorized:false,qualification:'synthetic_only'};
}
export class VariantExchanges {
 readonly kernel:CommerceKernel;constructor(k:CommerceKernel){this.kernel=k;}
 quote(scope:Scope,input:unknown){const p=exact(jsonValue(input),['allocation_id','catalog_id']),k=this.kernel;id(p.allocation_id);id(p.catalog_id);
  return k.transaction(()=>{const b=exchangeValue(k,scope,p.allocation_id,p.catalog_id,k.clock()),ctx=allocationContext(k,scope,p.allocation_id),ref='exchange_'+token().slice(0,32),hash=contentDigest(b);
   k.db.prepare('INSERT INTO commerce_exchange_quotes VALUES(?,?,?,?,?,?,?,?)').run(ctx.s.tenant_id,ctx.s.store_id,ref,p.allocation_id,ctx.c.id,ctx.c.resource_id,canonical(b),hash);return {id:ref,digest:hash,quote:b};});}
 assertCurrent(scope:Scope,input:unknown){const p=exact(jsonValue(input),['quote_id','quote_digest']),k=this.kernel;const s=k.require(scope);
  const row=k.db.prepare('SELECT * FROM commerce_exchange_quotes WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(p.quote_id)) as Row;
  const b=checkedBody(row);allocationContext(k,scope,row.allocation_id);
  if(row.digest!==p.quote_digest||b.expires_at<=k.clock())throw new Error('EXCHANGE_QUOTE_CHANGED');
  const current=exchangeValue(k,scope,row.allocation_id,b.catalog_id,b.quoted_at);
  if(contentDigest(current)!==row.digest)throw new Error('EXCHANGE_QUOTE_CHANGED');
  if(!current.allowed)throw new Error('EXCHANGE_UNAVAILABLE');return {...current,commit_authorized:false};
 }
}
