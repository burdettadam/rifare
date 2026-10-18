import { exact,id,integer } from './kernel.mts';
import type { Row } from './kernel.mts';
import { contentDigest,jsonValue,returnRules,stringSet } from './configuration-values.mts';
import { money,CURRENCIES } from './money.mts';
import {WOO_RETURN_CONTRACT_DIGEST} from '../adapters/woocommerce/return-contract.mts';

export const INTAKE_ACTION='diagnostic.return.submit';
export const RETURN_REASONS=Object.freeze(['size','damaged','not_as_described','other']);
export function returnSettings(input:unknown) {
 const p=exact(jsonValue(input),['currency','restocking_bps','shipping_minor','time_zone','brand','contact','override_days','retention_days']);
 money(p.currency,p.shipping_minor);if(BigInt(p.shipping_minor)<0n)throw new Error('INVALID_FEE');
 for(const [key,max] of [['restocking_bps',10000],['override_days',7],['retention_days',90]] as const){integer(p[key]);if(p[key]>max)throw new Error('INVALID_INPUT');}
 if(p.retention_days<1)throw new Error('INVALID_INPUT');
 if(typeof p.time_zone!=='string'||p.time_zone.length>64)throw new Error('INVALID_TIME_ZONE');
 try{new Intl.DateTimeFormat('en-US',{timeZone:p.time_zone}).format(0);}catch{throw new Error('INVALID_TIME_ZONE');}
 if(typeof p.brand!=='string'||!p.brand.trim()||p.brand.length>80||/[<>\x00-\x1f]/.test(p.brand))throw new Error('INVALID_INPUT');
 if(typeof p.contact!=='string'||p.contact.length>180||!/^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(p.contact))throw new Error('INVALID_INPUT');
 return p;
}
export function returnSelection(input:unknown) {
 const p=exact(jsonValue(input),['case_id','lines','outcome','reason','note','evidence_ids']);id(p.case_id);
 if(!['refund','exchange','store_credit'].includes(p.outcome)||!RETURN_REASONS.includes(p.reason))throw new Error('INVALID_INPUT');
 if(typeof p.note!=='string'||Buffer.byteLength(p.note)>2000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(p.note))throw new Error('INVALID_INPUT');
 if(!Array.isArray(p.lines)||p.lines.length<1||p.lines.length>50)throw new Error('INVALID_QUANTITY');
 const lines=p.lines.map((v:unknown)=>{const l=exact(v,['line_id','quantity']);id(l.line_id);integer(l.quantity,1);if(l.quantity>1000000)throw new Error('INVALID_QUANTITY');return l;}).sort((a:Row,b:Row)=>a.line_id.localeCompare(b.line_id));
 if(new Set(lines.map((l:Row)=>l.line_id)).size!==lines.length)throw new Error('DUPLICATE_LINE');
 if(!Array.isArray(p.evidence_ids)||p.evidence_ids.length>8||new Set(p.evidence_ids).size!==p.evidence_ids.length)throw new Error('INVALID_INPUT');p.evidence_ids.forEach(id);
 return {...p,lines,evidence_ids:[...p.evidence_ids].sort()};
}
export function sourceReturnLines(order:Row) {
 const b=order.payload??order;
 const woo=order.source_system==='woocommerce'&&b.woo_return_contract===WOO_RETURN_CONTRACT_DIGEST;
 if(!Array.isArray(b.return_lines)||!b.return_lines.length||b.return_lines.length>100)throw new Error('RETURN_SOURCE_MISSING');
 const rows=b.return_lines.map((l:Row)=>{
  exact(l,['id','fulfillment_line_id','ordered','fulfilled','returned','unit_minor','tags']);id(l.id);
  if(woo?l.fulfillment_line_id!==null||! /^[1-9][0-9]{0,14}$/.test(l.id):typeof l.fulfillment_line_id!=='string'||!/^gid:\/\/shopify\/FulfillmentLineItem\/[1-9][0-9]*$/.test(l.fulfillment_line_id))throw new Error('RETURN_SOURCE_MISSING');
  for(const n of [l.ordered,l.fulfilled,l.returned]){integer(n);if(n>1000000)throw new Error('RETURN_SOURCE_MISSING');}
  if(l.fulfilled>l.ordered||l.returned>l.fulfilled)throw new Error('RETURN_SOURCE_MISSING');
  money(b.currency,l.unit_minor);if(BigInt(l.unit_minor)<0n)throw new Error('RETURN_SOURCE_MISSING');
  return {...l,tags:stringSet(l.tags,'line.tags')};
 });
 if(new Set(rows.map((r:Row)=>r.id)).size!==rows.length||!woo&&new Set(rows.map((r:Row)=>r.fulfillment_line_id)).size!==rows.length)throw new Error('RETURN_SOURCE_MISSING');
 return rows;
}
// All cutoffs are elapsed UTC milliseconds from a trusted delivery instant. The IANA
// timezone is presentation metadata, not host-local calendar arithmetic.
export function evaluateReturn(input:{order:Row;rules:unknown;settings:unknown;selection:unknown;now:number;reserved?:Record<string,number>;evidenceClean?:boolean;windowOverride?:boolean}) {
 const {order}=input,b=order.payload??order,r=returnRules(input.rules),settings=returnSettings(input.settings),p=returnSelection(input.selection),now=integer(input.now);
 integer(b.delivered_at);if(b.delivered_at>now||b.currency!==settings.currency)throw new Error('RETURN_SOURCE_MISSING');
 const deadline=b.delivered_at+r.window_days*86400000;if(!Number.isSafeInteger(deadline))throw new Error('RETURN_SOURCE_MISSING');
 const rows=sourceReturnLines(order),orderTags=stringSet(b.tags,'order.tags');let gross=0n;
 const decisions=p.lines.map((requested:Row)=>{
  const l=rows.find((line:Row)=>line.id===requested.line_id);if(!l)throw new Error('UNKNOWN_RETURN_LINE');
  const reserved=input.reserved?.[l.id]??0;integer(reserved);const remaining=Math.max(0,l.fulfilled-l.returned-reserved),reasons:string[]=[];
  if(requested.quantity>remaining)reasons.push('QUANTITY_UNAVAILABLE');
  if(now>deadline&&!input.windowOverride)reasons.push('RETURN_WINDOW_EXPIRED');
  if([...l.tags,...orderTags].some(tag=>r.excluded_tags.includes(tag)))reasons.push('PRODUCT_EXCLUDED');
  if(!r.outcomes.includes(p.outcome))reasons.push('OUTCOME_NOT_ALLOWED');
  if(r.require_evidence&&!input.evidenceClean)reasons.push('EVIDENCE_REQUIRED');
  const amount=BigInt(l.unit_minor)*BigInt(requested.quantity);gross+=amount;
  return {line_id:l.id,fulfillment_line_id:l.fulfillment_line_id,quantity:requested.quantity,remaining,amount_minor:amount.toString(),reasons:reasons.length?reasons:['ELIGIBLE'],decision:!reasons.length?'allow':reasons.every(x=>['RETURN_WINDOW_EXPIRED','EVIDENCE_REQUIRED'].includes(x))?'review':'deny'};
 });
 const restocking=gross*BigInt(settings.restocking_bps)/10000n,shipping=BigInt(settings.shipping_minor),net=gross-restocking-shipping;
 const feeExceeded=net<0n;
 return {version:1,decision:feeExceeded||decisions.some((l:Row)=>l.decision==='deny')?'deny':decisions.some((l:Row)=>l.decision==='review')?'review':'allow',
  reasons:[...new Set([...decisions.flatMap((l:Row)=>l.reasons.filter((r:string)=>r!=='ELIGIBLE')),...(feeExceeded?['FEES_EXCEED_AMOUNT']:[])])],lines:decisions,outcome:p.outcome,
  deadline,deadline_utc:new Date(deadline).toISOString(),time_zone:settings.time_zone,cutoff_semantics:'inclusive_elapsed_utc',
  fees:{currency:b.currency,gross_minor:gross.toString(),restocking_minor:restocking.toString(),shipping_minor:shipping.toString(),net_minor:(net<0n?0n:net).toString(),rounding:'restocking_floor_minor',estimated_only:true},
  currency_exponent:CURRENCIES[b.currency as keyof typeof CURRENCIES],policy_digest:contentDigest(r),evidence_required:r.require_evidence,execution_authorized:false,financial_effect:false};
}
