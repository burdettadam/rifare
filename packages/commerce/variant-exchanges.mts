import { exact,id,integer,token } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import {intakeSettings,evidenceReviewState} from './return-intake-core.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { allocationContext,resolutionSettings,checkedBody,financialFacts,minor } from './resolution-ledger.mts';

const catalogRequired=['variant_id','product_id','currency','unit_price_minor','tax_per_unit_minor','shipping_minor','duties_per_unit_minor','available','discount_eligible','promotion_expires_at','excluded'];
const catalogOptional=['category','active','fulfillment_qualified','cost_minor','exchange_incentive_eligible'];
function exchangeSettings(k:CommerceKernel,s:Row){
 const row=k.db.prepare('SELECT * FROM commerce_exchange_settings WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row;
 return row?{...checkedBody(row),revision:row.revision,digest:row.digest}:null;
}
function catalogValue(payload:unknown){
 const input=jsonValue(payload),v=exact(input,[...catalogRequired,...catalogOptional.filter(key=>Object.hasOwn(input,key))]);
 id(v.variant_id);id(v.product_id);integer(v.available);integer(v.promotion_expires_at);
 for(const key of ['unit_price_minor','tax_per_unit_minor','shipping_minor','duties_per_unit_minor'])minor(v[key]);
 for(const key of ['excluded','discount_eligible',...['active','fulfillment_qualified','exchange_incentive_eligible'].filter(key=>Object.hasOwn(v,key))])if(typeof v[key]!=='boolean')throw new Error('EXCHANGE_SOURCE_INVALID');
 if(Object.hasOwn(v,'category'))id(v.category);if(Object.hasOwn(v,'cost_minor'))minor(v.cost_minor);return v;
}
function exchangeValue(k:CommerceKernel,scope:Scope,allocationId:string,catalogId:string,quotedAt:number,authority='action.propose',boundQuote:Row|null=null){
 const ctx=allocationContext(k,scope,allocationId),{c,a,b,s}=ctx;const settings=resolutionSettings(k,s),facts=financialFacts(k,c);
 if(intakeSettings(k,s).digest!==b.fee_settings_digest)throw new Error('REFUND_FEES_CHANGED');
 if(evidenceReviewState(k,s,c.id)?.event==='evidence_requested')throw new Error('RETURN_REVIEW_REQUIRED');
 const paid=facts.paid_lines.find((l:Row)=>l.id===b.line_id);
 if(!paid||contentDigest({...paid,resolved_units:[]})!==b.paid_line_digest)throw new Error('PAID_ALLOCATION_CHANGED');
 if(b.units.some((n:number)=>paid.resolved_units.includes(n)))throw new Error('UNIT_ALREADY_RESOLVED');
 k.authorize(scope,authority,c.resource_id);
 if(a.outcome!=='exchange'||!c.pins.policy.body.rules.outcomes.includes('exchange'))throw new Error('OUTCOME_UNSUPPORTED');
 const catalog=k.get(scope,id(catalogId));if(catalog.kind!=='catalog'||catalog.source_system!=='synthetic')throw new Error('EXCHANGE_SOURCE_UNQUALIFIED');
 const v=catalogValue(catalog.payload),policy=exchangeSettings(k,s),catalogWide=!!policy?.enabled&&policy.catalog_wide&&policy.expires_at>k.clock();
 const reasons:string[]=[],maxAge=c.pins.composition.effective['data.max_age_seconds']*1000,discount=minor(b.components.discount_minor),qty=BigInt(b.units.length);
 if(catalog.observed_at>k.clock()||k.clock()-catalog.observed_at>maxAge)reasons.push('INVENTORY_STALE');
 if(v.product_id!==b.product_id&&!catalogWide)reasons.push('CATALOG_EXCHANGE_UNQUALIFIED');if(v.excluded)reasons.push('VARIANT_EXCLUDED');if(v.currency!==b.currency)reasons.push('CURRENCY_UNSUPPORTED');
 if(policy){
  if(!policy.enabled||policy.expires_at<=k.clock())reasons.push('CATALOG_CONFIGURATION_UNAVAILABLE');
  if(policy.allowed_product_ids.length&&!policy.allowed_product_ids.includes(v.product_id)||policy.excluded_product_ids.includes(v.product_id))reasons.push('PRODUCT_NOT_PERMITTED');
  if(policy.excluded_categories.includes(v.category))reasons.push('CATEGORY_EXCLUDED');
  if(v.active===false)reasons.push('VARIANT_INACTIVE');
  if(v.fulfillment_qualified===false||v.product_id!==b.product_id&&(v.fulfillment_qualified!==true||v.active!==true||!v.category))reasons.push('FULFILLMENT_UNQUALIFIED');
 }
 if(v.available-settings.inventory_buffer<b.units.length)reasons.push('INSUFFICIENT_STOCK');
 if(discount>0n&&(!v.discount_eligible||v.promotion_expires_at<=k.clock()))reasons.push('DISCOUNT_UNAVAILABLE');
 const merchandise=minor(v.unit_price_minor)*qty-discount;let incentive=0n;
 if(policy?.enabled&&policy.expires_at>k.clock()&&policy.incentive_bps>0&&v.exchange_incentive_eligible===true){
  if(v.promotion_expires_at<=k.clock())reasons.push('INCENTIVE_EXPIRED');
  else if(v.cost_minor===undefined)reasons.push('INCENTIVE_COST_UNAVAILABLE');
  else if(merchandise>=0n){
   const denominator=10000n-BigInt(policy.minimum_margin_bps),floor=(minor(v.cost_minor)*qty*10000n+denominator-1n)/denominator;
   const room=merchandise>floor?merchandise-floor:0n,calculated=merchandise*BigInt(policy.incentive_bps)/10000n;
   incentive=[room,calculated,minor(policy.incentive_cap_minor)].reduce((x,y)=>x<y?x:y);
  }
 }
 const replacement=merchandise-incentive+minor(v.tax_per_unit_minor)*qty+minor(v.shipping_minor)+minor(v.duties_per_unit_minor)*qty;
 const restock=(minor(b.components.gross_minor)-minor(b.components.discount_minor))*BigInt(b.restocking_bps)/10000n,entitlement=minor(b.components.paid_minor)-restock-minor(b.return_shipping_minor);
 if(replacement<0n||entitlement<0n||replacement!==entitlement&&!(policy?.enabled&&policy.price_differences&&policy.expires_at>k.clock()))reasons.push('PRICE_DIFFERENCE_UNSUPPORTED');
 const expires=Math.min(quotedAt+300000,catalog.observed_at+maxAge,settings.expires_at,policy?.expires_at??Number.MAX_SAFE_INTEGER,discount>0n||incentive>0n?v.promotion_expires_at:Number.MAX_SAFE_INTEGER);
 const op=k.db.prepare('SELECT * FROM commerce_resolution_operations WHERE tenant_id=? AND store_id=? AND allocation_id=?').get(s.tenant_id,s.store_id,a.id) as Row;
 if(op){const command=JSON.parse(op.command);if(contentDigest(command)!==op.digest||!boundQuote||command.exchange_quote_id!==boundQuote.id||command.exchange_quote_digest!==boundQuote.digest)throw new Error('ALLOCATION_ALREADY_AUTHORIZED');}
 return {allocation_id:a.id,case_id:c.id,configuration_digest:c.configuration_digest,allocation_digest:a.digest,source_order_digest:contentDigest(c.order),catalog_id:catalog.id,catalog_version:catalog.source_version,catalog_digest:contentDigest(catalog),
  source_stock:v.available,buffer:settings.inventory_buffer,quantity:b.units.length,original_variant:b.variant_id,replacement_variant:v.variant_id,currency:b.currency,original_paid_minor:b.components.paid_minor,
  retained_discount_minor:discount.toString(),replacement_minor:replacement.toString(),balance_minor:(replacement-entitlement).toString(),available_exchange_value_minor:entitlement.toString(),restocking_minor:restock.toString(),return_shipping_minor:b.return_shipping_minor,settings_digest:settings.digest,
  ...(policy?{catalog_configuration_digest:policy.digest,catalog_configuration_revision:policy.revision,exchange_incentive_minor:incentive.toString()}:{}),
  allowed:reasons.length===0,reasons,alternatives:reasons.length?c.pins.policy.body.rules.outcomes.filter((o:string)=>o!=='exchange'&&(o!=='store_credit'||settings.credit_instrument==='native_store_credit')):[],
  quoted_at:quotedAt,expires_at:expires,stock_reserved:false,requires_atomic_reservation:true,commit_authorized:false,qualification:'synthetic_only'};
}
export class VariantExchanges {
 readonly kernel:CommerceKernel;constructor(k:CommerceKernel){this.kernel=k;}
 configure(scope:Scope,input:unknown){
  const p=exact(jsonValue(input),['expected_revision','enabled','catalog_wide','price_differences','allowed_product_ids','excluded_product_ids','excluded_categories','incentive_bps','incentive_cap_minor','minimum_margin_bps','expires_at']);
  integer(p.expected_revision);integer(p.expires_at);integer(p.incentive_bps);integer(p.minimum_margin_bps);minor(p.incentive_cap_minor);
  if(p.incentive_bps>10000||p.minimum_margin_bps>=10000)throw new Error('INVALID_INPUT');
  for(const key of ['enabled','catalog_wide','price_differences'])if(typeof p[key]!=='boolean')throw new Error('INVALID_INPUT');
  for(const key of ['allowed_product_ids','excluded_product_ids','excluded_categories']){if(!Array.isArray(p[key])||p[key].length>100||new Set(p[key]).size!==p[key].length)throw new Error('INVALID_INPUT');p[key].forEach(id);p[key].sort();}
  const k=this.kernel;return k.transaction(()=>{const s=k.authorize(scope,'action.configure');resolutionSettings(k,s);
   if(p.expires_at<=k.clock()||p.expires_at>k.clock()+3600000)throw new Error('INVALID_INPUT');const old=exchangeSettings(k,s);
   if((old?.revision??0)!==p.expected_revision)throw new Error('CATALOG_CONFIGURATION_CHANGED');const b={...p};delete b.expected_revision;
   k.db.prepare('INSERT INTO commerce_exchange_settings VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,store_id) DO UPDATE SET revision=excluded.revision,body=excluded.body,digest=excluded.digest').run(s.tenant_id,s.store_id,p.expected_revision+1,canonical(b),contentDigest(b));
   return {revision:p.expected_revision+1,digest:contentDigest(b),qualification:'synthetic_only'};
  });
 }
 browse(scope:Scope,input:unknown){const p=exact(jsonValue(input),['allocation_id']),k=this.kernel;id(p.allocation_id);
  return k.transaction(()=>{const ctx=allocationContext(k,scope,p.allocation_id);k.authorize(scope,'action.propose',ctx.c.resource_id);
   const rows=k.db.prepare("SELECT id FROM commerce_resources WHERE tenant_id=? AND store_id=? AND kind='catalog' ORDER BY id LIMIT 201").all(ctx.s.tenant_id,ctx.s.store_id) as Row[];
   if(rows.length>200)throw new Error('CATALOG_PAGE_REQUIRED');const offers:Row[]=[];
   for(const r of rows){try{const q=exchangeValue(k,scope,p.allocation_id,r.id,k.clock());if(q.allowed)offers.push({catalog_id:r.id,variant_id:q.replacement_variant,currency:q.currency,replacement_minor:q.replacement_minor,balance_minor:q.balance_minor,expires_at:q.expires_at});}
    catch(e){if(!(e instanceof Error)||!['NOT_FOUND','EXCHANGE_SOURCE_INVALID','EXCHANGE_SOURCE_UNQUALIFIED','INVALID_INPUT','INVALID_MONEY'].includes(e.message))throw e;}}
   return {offers,stock_reserved:false,requires_current_quote:true,qualification:'synthetic_only'};
  });
 }
 quote(scope:Scope,input:unknown){const p=exact(jsonValue(input),['allocation_id','catalog_id']),k=this.kernel;id(p.allocation_id);id(p.catalog_id);
  return k.transaction(()=>{const b=exchangeValue(k,scope,p.allocation_id,p.catalog_id,k.clock()),ctx=allocationContext(k,scope,p.allocation_id),ref='exchange_'+token().slice(0,32),hash=contentDigest(b);
   k.db.prepare('INSERT INTO commerce_exchange_quotes VALUES(?,?,?,?,?,?,?,?)').run(ctx.s.tenant_id,ctx.s.store_id,ref,p.allocation_id,ctx.c.id,ctx.c.resource_id,canonical(b),hash);return {id:ref,digest:hash,quote:b};});}
 assertCurrent(scope:Scope,input:unknown){return this.#current(scope,input,'action.propose');}
 validateForReview(scope:Scope,input:unknown){return this.#current(scope,input,'return.read');}
 validateForFinance(scope:Scope,input:unknown,_excludeOperation:string|null=null){return this.#current(scope,input,'return.read');}
 #current(scope:Scope,input:unknown,authority:string){const p=exact(jsonValue(input),['quote_id','quote_digest']),k=this.kernel;const s=k.require(scope);
  const row=k.db.prepare('SELECT * FROM commerce_exchange_quotes WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(p.quote_id)) as Row;
  const b=checkedBody(row);allocationContext(k,scope,row.allocation_id);
  if(row.digest!==p.quote_digest||b.expires_at<=k.clock())throw new Error('EXCHANGE_QUOTE_CHANGED');
  const current=exchangeValue(k,scope,row.allocation_id,b.catalog_id,b.quoted_at,authority,{id:row.id,digest:row.digest});
  if(contentDigest(current)!==row.digest)throw new Error('EXCHANGE_QUOTE_CHANGED');
  if(!current.allowed)throw new Error('EXCHANGE_UNAVAILABLE');return {...current,quote_id:row.id,quote_digest:row.digest,commit_authorized:false};
 }
}
