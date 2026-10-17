import { assertPreventionConfirmation } from './return-prevention-guards.mts';
import { exact,id,integer,token } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { CaseConfigurations } from './case-configurations.mts';
import { assertCaseWorkerScope } from './work-leases.mts';
import { assertExecution } from './execution-stops.mts';
import { money } from './money.mts';

export const EDIT_ACTION='diagnostic.order.edit';
export const EDIT_CONTRACT=Object.freeze({id:'rifare-order-edit-fixture-v1',version:1,qualification:'synthetic_only',live_transport:false});
export const EDIT_KINDS=['address','item','cancel'] as const;
export function editBody(r:Row|undefined){if(!r)throw new Error('NOT_FOUND');const b=JSON.parse(r.body);if(contentDigest(b)!==r.digest)throw new Error('EDIT_INTEGRITY');return b;}
export function editMinor(x:unknown){if(typeof x!=='string'||!/^\d{1,24}$/.test(x)||String(BigInt(x))!==x)throw new Error('EDIT_MONEY_INVALID');return BigInt(x);}
export function editAddress(x:unknown){const a=exact(jsonValue(x),['name','line1','city','state','postal','country']);
 for(const v of Object.values(a))if(typeof v!=='string'||!v.trim()||v.length>120||/[\x00-\x1f\x7f]/.test(v))throw new Error('EDIT_ADDRESS_INVALID');
 if(a.country!=='US'||! /^[A-Z]{2}$/.test(a.state)||!/^\d{5}(-\d{4})?$/.test(a.postal))throw new Error('EDIT_ADDRESS_UNSUPPORTED');return a;}
export function lineValue(line:Row){integer(line.quantity,1);const gross=editMinor(line.unit_minor)*BigInt(line.quantity),discount=editMinor(line.discount_minor),tax=editMinor(line.tax_minor);if(discount>gross)throw new Error('EDIT_MONEY_INVALID');return gross-discount+tax;}
export function orderValue(order:Row){return order.lines.reduce((sum:bigint,l:Row)=>sum+(l.status==='cancelled'?0n:lineValue(l)),editMinor(order.shipping_minor));}
export function safeOrder(order:Row){const {address,...rest}=order;return {...rest,address_digest:contentDigest(address)};}
export function editIntent(input:unknown){const p=exact(jsonValue(input),['case_id','kind','line_id','variant_id','address']);id(p.case_id);
 if(!EDIT_KINDS.includes(p.kind))throw new Error('EDIT_UNSUPPORTED_ACTION');
 if(p.kind==='item'){id(p.line_id);id(p.variant_id);if(p.address!==null)throw new Error('INVALID_INPUT');}
 if(p.kind==='address'){editAddress(p.address);if(p.line_id!==null||p.variant_id!==null)throw new Error('INVALID_INPUT');}
 if(p.kind==='cancel'&&(p.line_id!==null||p.variant_id!==null||p.address!==null))throw new Error('INVALID_INPUT');return p;}
export function editEligibility(order:Row,rules:Row,kind:string,lineId:string|null,now:number){
 const reasons:string[]=[],lines=order.lines as Row[];integer(now);if(!EDIT_KINDS.includes(kind as any))throw new Error('EDIT_UNSUPPORTED_ACTION');
 if(!Number.isSafeInteger(order.created_at)||order.created_at>now||now>=order.created_at+rules.windows_ms[kind])reasons.push('WINDOW_CLOSED');
 if(order.cancelled)reasons.push('ORDER_CANCELLED');if(!['paid','partially_refunded'].includes(order.financial_state)||editMinor(order.balance_due_minor)>0n)reasons.push('FINANCIAL_STATE_UNSUPPORTED');
 const targets=kind==='item'?lines.filter(l=>l.id===lineId):lines.filter(l=>!['shipped','cancelled'].includes(l.status));
 if(!targets.length)reasons.push('NO_ELIGIBLE_LINES');
 if(targets.some(l=>l.subscription))reasons.push('SUBSCRIPTION_UNSUPPORTED');
 if(targets.some(l=>!['unfulfilled','held'].includes(l.status)))reasons.push('LINE_IRREVERSIBLE');
 if(kind==='address'&&lines.some(l=>l.status==='shipped'))reasons.push('SPLIT_ADDRESS_UNSUPPORTED');
 const warehouses=[...new Set(targets.map(l=>l.warehouse_id))].sort();
 return {eligible:reasons.length===0,reasons,action:kind,line_ids:targets.map(l=>l.id).sort(),warehouse_ids:warehouses,alternatives:reasons.length?['operator_review','post_delivery_return']:[],cutoff:order.created_at+rules.windows_ms[kind]};}
export function editSettings(k:CommerceKernel,s:Row){const r=k.db.prepare('SELECT * FROM commerce_edit_settings WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row,b=editBody(r);
 if(!b.enabled||b.expires_at<=k.clock()||b.readiness?.qualified!==true||b.readiness?.qualification!=='synthetic_only')throw new Error('EDIT_INTEGRATION_NOT_READY');return {...b,revision:r.revision,digest:r.digest};}
export function editSnapshot(k:CommerceKernel,s:Row,resource:string,settings:Row){const r=k.db.prepare('SELECT * FROM commerce_edit_snapshots WHERE tenant_id=? AND store_id=? AND resource_id=?').get(s.tenant_id,s.store_id,resource) as Row,b=editBody(r);
 if(r.source_identity!==settings.source_identity||r.observed_at>k.clock()||r.observed_at+settings.max_age_ms<=k.clock()||b.source_revision!==settings.source_revision)throw new Error('EDIT_SOURCE_STALE');return {snapshot:b,digest:r.digest,observed_at:r.observed_at};}
export function editContext(k:CommerceKernel,scope:Scope,caseId:string,write=false){const cases=new CaseConfigurations(k),c=write?cases.resume(scope,id(caseId)):cases.inspect(scope,id(caseId)),s=k.authorize(scope,'case.read',c.resource_id);
 if(write){cases.verified(scope,c.id);assertCaseWorkerScope(k,scope,c.id);assertExecution(k,s,EDIT_ACTION);}return {s,c,cases};}
export function editValue(k:CommerceKernel,scope:Scope,intent:Row,quotedAt:number){const {s,c}=editContext(k,scope,intent.case_id,true),settings=editSettings(k,s),snap=editSnapshot(k,s,c.resource_id,settings),o=snap.snapshot.order;
 if(o.tenant_id!==s.tenant_id||o.store_id!==s.store_id||o.customer_id!==c.customer_id||o.resource_id!==c.resource_id)throw new Error('EDIT_SOURCE_MISMATCH');
 const eligibility=editEligibility(o,settings.rules,intent.kind,intent.line_id,k.clock());if(!eligibility.eligible)throw new Error('EDIT_INELIGIBLE:'+eligibility.reasons.join(','));
 const currentTotal=orderValue(o);if(currentTotal.toString()!==o.total_minor)throw new Error('EDIT_TOTAL_MISMATCH');let next=structuredClone(o),details:Row={};
 if(intent.kind==='address'){const a=editAddress(intent.address);if(a.state!==o.address.state||a.country!==o.address.country||a.postal.slice(0,3)!==o.address.postal.slice(0,3))throw new Error('EDIT_TAX_SHIPPING_UNQUALIFIED');next.address=a;details={address_digest:contentDigest(a),tax_delta_minor:'0',shipping_delta_minor:'0'};}
 if(intent.kind==='item'){const l=next.lines.find((x:Row)=>x.id===intent.line_id),v=snap.snapshot.catalog.find((x:Row)=>x.id===intent.variant_id);
  if(!v||!v.available||v.excluded||v.subscription||v.product_id!==l.product_id||v.currency!==o.currency||v.tax_bps!==l.tax_bps)throw new Error('EDIT_VARIANT_UNSUPPORTED');
  if(l.variant_id===v.id)throw new Error('EDIT_NO_CHANGE');integer(v.stock);if(v.stock-settings.rules.inventory_buffer<l.quantity)throw new Error('EDIT_STOCK_UNAVAILABLE');
  const gross=editMinor(v.unit_minor)*BigInt(l.quantity),discount=editMinor(l.discount_minor);if(discount>gross)throw new Error('EDIT_DISCOUNT_UNSUPPORTED');
  l.variant_id=v.id;l.unit_minor=v.unit_minor;l.tax_minor=((gross-discount)*BigInt(v.tax_bps)/10000n).toString();
  if(((gross-discount)*BigInt(v.tax_bps))%10000n!==0n)throw new Error('EDIT_TAX_ROUNDING_UNQUALIFIED');details={original_variant:o.lines.find((x:Row)=>x.id===l.id).variant_id,replacement_variant:v.id,quantity:l.quantity,stock_buffer:settings.rules.inventory_buffer};
 }
 if(intent.kind==='cancel')for(const l of next.lines)if(eligibility.line_ids.includes(l.id))l.status='cancelled';
 const total=orderValue(next),delta=total-currentTotal;
 return {schema_version:1,tenant_id:s.tenant_id,store_id:s.store_id,case_id:c.id,resource_id:c.resource_id,customer_id:c.customer_id,case_revision:c.revision,configuration_digest:c.configuration_digest,policy_digest:c.pins.policy.digest,
  settings_digest:settings.digest,settings_revision:settings.revision,source_identity:settings.source_identity,source_revision:settings.source_revision,source_order_version:o.version,source_order_digest:contentDigest(safeOrder(o)),snapshot_digest:snap.digest,
  action:intent.kind,line_ids:eligibility.line_ids,warehouse_ids:eligibility.warehouse_ids,details,currency:o.currency,old_total_minor:currentTotal.toString(),new_total_minor:total.toString(),delta_minor:delta.toString(),amount_minor:(delta<0n?-delta:delta).toString(),
  financial_obligation:delta>0n?'invoice':delta<0n?'refund':'none',next_order_digest:contentDigest(safeOrder({...next,version:o.version+1,total_minor:total.toString()})),intent_digest:contentDigest(intent),cutoff:eligibility.cutoff,
  control_stamp:assertExecution(k,s,EDIT_ACTION).stamp,quoted_at:quotedAt,expires_at:Math.min(quotedAt+300000,eligibility.cutoff,settings.expires_at),qualification:'synthetic_only'};
}
export function editGatewayQuote(k:CommerceKernel,scope:Scope,p:Row,quotedAt:number){const a=exact(p.arguments,['quote_id','quote_digest']),s=k.require(scope),r=k.db.prepare('SELECT * FROM commerce_edit_quotes WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(a.quote_id)) as Row,q=editBody(r);
 if(r.digest!==a.quote_digest||q.case_id!==p.case_id||q.expires_at<=k.clock())throw new Error('EDIT_QUOTE_CHANGED');
 const ir=k.db.prepare('SELECT * FROM commerce_edit_inputs WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,r.id) as Row,intent=editBody(ir),current=editValue(k,scope,intent,q.quoted_at);
 if(contentDigest(current)!==r.digest)throw new Error('EDIT_QUOTE_CHANGED');
 assertPreventionConfirmation(k,s,r.id,q);
 return {schema_version:1,tenant_id:s.tenant_id,store_id:s.store_id,case_id:q.case_id,case_revision:q.case_revision,configuration_digest:q.configuration_digest,resource_id:q.resource_id,resource_version:q.source_order_version,source_digest:q.source_order_digest,customer_id:q.customer_id,
  action:EDIT_ACTION,arguments:a,amount:money(q.currency,q.amount_minor),amount_ceiling:money(q.currency,q.amount_minor),readiness_digest:q.settings_digest,control_stamp:q.control_stamp,capability_revision:q.settings_revision,adapter_contract_digest:contentDigest(EDIT_CONTRACT),policy_digest:q.policy_digest,
  decision:{eligible:true,reasons:['SEPARATE_APPROVAL_AND_DOWNSTREAM_HOLD_REQUIRED']},effect_version:0,quoted_at:quotedAt,expires_at:Math.min(quotedAt+300000,q.expires_at),max_uses:1,financial_effect:false};}
export function commitOrderEdit(k:CommerceKernel,s:Row,p:Row,receiptId:string){const r=k.db.prepare('SELECT * FROM commerce_edit_quotes WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,p.arguments.quote_id) as Row,q=editBody(r);
 assertPreventionConfirmation(k,s,r.id,q);
 if(k.db.prepare("SELECT 1 FROM commerce_order_edits WHERE tenant_id=? AND store_id=? AND resource_id=? AND state NOT IN ('released','cancelled','abandoned')").get(s.tenant_id,s.store_id,q.resource_id))throw new Error('EDIT_ALREADY_ACTIVE');
 const ref='edit_'+contentDigest([s.tenant_id,s.store_id,q.resource_id,q.source_order_version,r.digest]).slice(0,40),b={id:ref,case_id:q.case_id,resource_id:q.resource_id,quote_id:r.id,quote_digest:r.digest,receipt_id:receiptId,actor_id:s.actor_id,created_at:k.clock()};
 k.db.prepare("INSERT INTO commerce_order_edits VALUES(?,?,?,?,?,?,?,'authorized',1,?,?,?)").run(s.tenant_id,s.store_id,ref,q.case_id,q.resource_id,r.id,receiptId,q.source_identity,canonical(b),contentDigest(b));editEvent(k,s,ref,'authorized',{receipt_id:receiptId,quote_digest:r.digest});return ref;}
export function editEvent(k:CommerceKernel,s:Row,ref:string,event:string,body:Row){k.db.prepare('INSERT INTO commerce_edit_events(tenant_id,store_id,edit_id,event,observed_at,body,digest) VALUES(?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,ref,event,k.clock(),canonical(body),contentDigest(body));}
