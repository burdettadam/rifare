import { assertReturnWritable,assertResolutionReceipt } from './return-lifecycle-core.mts';
import { exact,id,integer,token } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { assertGiftOutcome } from './gift-proof.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { money,allocateMoney } from './money.mts';
import { CaseConfigurations } from './case-configurations.mts';
import { assertCaseWorkerScope } from './work-leases.mts';
import { assertReady,DRAFT_ACTION } from './integration-readiness.mts';
import { assertExecution } from './execution-stops.mts';
import { intakeSettings } from './return-intake-core.mts';

export const RESOLVE_ACTION='diagnostic.return.resolve';
export const RESOLUTION_CONTRACT={id:'rifare-resolution-fixture-v1',version:1,qualification:'synthetic_only',live_transport:false};
export const minor=(x:unknown)=>{if(typeof x!=='string'||!/^(0|[1-9][0-9]{0,23})$/.test(x))throw new Error('INVALID_MONEY');return BigInt(x);};
const amounts=['gross_minor','discount_minor','tax_minor','shipping_minor','duties_minor'];
export function checkedBody(row:Row|undefined,code='RESOLUTION_INTEGRITY') {if(!row)throw new Error('NOT_FOUND');const b=JSON.parse(row.body);if(contentDigest(b)!==row.digest)throw new Error(code);return b;}
export function financialFacts(k:CommerceKernel,c:Row) {
 const input=jsonValue(c.order.payload.resolution_facts),extensions=['instrument_allocations','bundle_allocations'].filter(key=>input&&Object.hasOwn(input,key));
 const f=exact(input,['revision','observed_at','currency','payment_id','original_paid_minor','prior_refunded_minor','accounted_operations','paid_lines',...extensions]);
 integer(f.revision,1);integer(f.observed_at);id(f.payment_id);money(f.currency,'0');
 if(c.order.source_system!=='synthetic'||c.order.payload.currency!==f.currency)throw new Error('RESOLUTION_SOURCE_UNQUALIFIED');
 const age=c.pins.composition.effective['data.max_age_seconds']*1000;
 if(f.observed_at>k.clock()||k.clock()-f.observed_at>age||k.clock()-c.order.observed_at>age)throw new Error('FINANCIAL_SOURCE_STALE');
 if(!Array.isArray(f.paid_lines)||!f.paid_lines.length||f.paid_lines.length>100||new Set(f.paid_lines.map((l:Row)=>l.id)).size!==f.paid_lines.length)throw new Error('PAID_ALLOCATIONS_INVALID');
 if(!Array.isArray(f.accounted_operations)||f.accounted_operations.length>500||new Set(f.accounted_operations).size!==f.accounted_operations.length)throw new Error('PAID_ALLOCATIONS_INVALID');
 f.accounted_operations.forEach(id);let total=0n;
 for(const l of f.paid_lines){exact(l,['id','product_id','variant_id','quantity',...amounts,'resolved_units']);id(l.id);id(l.product_id);id(l.variant_id);integer(l.quantity,1);
  if(l.quantity>1000||!Array.isArray(l.resolved_units)||new Set(l.resolved_units).size!==l.resolved_units.length)throw new Error('PAID_ALLOCATIONS_INVALID');
  for(const n of l.resolved_units){integer(n,1);if(n>l.quantity)throw new Error('PAID_ALLOCATIONS_INVALID');}
  amounts.forEach(a=>minor(l[a]));if(minor(l.discount_minor)>minor(l.gross_minor))throw new Error('PAID_ALLOCATIONS_INVALID');
  total+=minor(l.gross_minor)-minor(l.discount_minor)+minor(l.tax_minor)+minor(l.shipping_minor)+minor(l.duties_minor);
  const source=c.order.payload.return_lines?.find((r:Row)=>r.id===l.id);
  if(!source||source.ordered!==l.quantity||source.returned!==l.resolved_units.length)throw new Error('PAID_QUANTITY_MISMATCH');
 }
 if(total!==minor(f.original_paid_minor)||minor(f.prior_refunded_minor)>total)throw new Error('PAID_TOTAL_MISMATCH');
 if(Object.hasOwn(f,'instrument_allocations'))validateInstruments(f);
 if(Object.hasOwn(f,'bundle_allocations'))validateBundles(f,c.order.payload.return_lines);
 return f;
}
function validateInstruments(f:Row){
 const p=exact(f.instrument_allocations,['rule','instruments','units']);
 if(p.rule!=='original_unit_proportional_v1'||!Array.isArray(p.instruments)||!p.instruments.length||p.instruments.length>8||!Array.isArray(p.units)||p.units.length>1000)throw new Error('INSTRUMENT_ALLOCATION_UNSUPPORTED');
 const totals=new Map<string,bigint>();let paid=0n,prior=0n;
 for(const i of p.instruments){exact(i,['id','type','original_paid_minor','prior_refunded_minor','supported']);id(i.id);
  if(totals.has(i.id)||!['card','gift_card'].includes(i.type)||typeof i.supported!=='boolean')throw new Error('INSTRUMENT_ALLOCATION_INVALID');
  const amount=minor(i.original_paid_minor),refunded=minor(i.prior_refunded_minor);if(refunded>amount)throw new Error('INSTRUMENT_BALANCE_EXCEEDED');paid+=amount;prior+=refunded;totals.set(i.id,0n);
 }
 if(paid!==minor(f.original_paid_minor)||prior!==minor(f.prior_refunded_minor))throw new Error('INSTRUMENT_TOTAL_MISMATCH');
 const units=new Set<string>();
 for(const u of p.units){exact(u,['line_id','unit_index','amounts']);id(u.line_id);integer(u.unit_index,1);const key=u.line_id+':'+u.unit_index,l=f.paid_lines.find((x:Row)=>x.id===u.line_id);
  if(!l||u.unit_index>l.quantity||units.has(key)||!Array.isArray(u.amounts)||u.amounts.length>8)throw new Error('INSTRUMENT_ALLOCATION_INVALID');units.add(key);const seen=new Set<string>();let amount=0n;
  for(const a of u.amounts){exact(a,['instrument_id','amount_minor']);id(a.instrument_id);if(!totals.has(a.instrument_id)||seen.has(a.instrument_id))throw new Error('INSTRUMENT_ALLOCATION_INVALID');seen.add(a.instrument_id);const n=minor(a.amount_minor);amount+=n;totals.set(a.instrument_id,totals.get(a.instrument_id)!+n);}
  if(amount!==minor(unitComponents(f,l,[u.unit_index]).paid_minor))throw new Error('INSTRUMENT_UNIT_MISMATCH');
 }
 if(units.size!==f.paid_lines.reduce((n:number,l:Row)=>n+l.quantity,0))throw new Error('INSTRUMENT_UNIT_MISSING');
 for(const i of p.instruments)if(totals.get(i.id)!==minor(i.original_paid_minor))throw new Error('INSTRUMENT_TOTAL_MISMATCH');
}
function validateBundles(f:Row,returnLines:Row[]){
 const p=exact(f.bundle_allocations,['treatment','promotion_rule','groups']);
 if(p.treatment!=='preserve_original_paid'||p.promotion_rule!=='retain_remaining_components'||!Array.isArray(p.groups)||!p.groups.length||p.groups.length>100)throw new Error('BUNDLE_POLICY_UNSUPPORTED');
 const seen=new Set<string>(),groups=new Set<string>();
 for(const g of p.groups){exact(g,['id','promotion_id','original_paid_minor','components']);id(g.id);id(g.promotion_id);if(groups.has(g.id)||!Array.isArray(g.components)||!g.components.length||g.components.length>100)throw new Error('BUNDLE_ALLOCATION_INVALID');groups.add(g.id);let total=0n;
  for(const component of g.components){exact(component,['line_id','fulfillment_line_id','paid_minor','retail_minor','promotion_role']);id(component.line_id);
   const l=f.paid_lines.find((x:Row)=>x.id===component.line_id),source=returnLines.find((x:Row)=>x.id===component.line_id);
   if(!l||!source||seen.has(l.id)||component.fulfillment_line_id!==source.fulfillment_line_id||!['paid_component','zero_price_gift'].includes(component.promotion_role))throw new Error('BUNDLE_LINEAGE_INVALID');seen.add(l.id);
   const amount=minor(component.paid_minor),actual=minor(l.gross_minor)-minor(l.discount_minor)+minor(l.tax_minor)+minor(l.shipping_minor)+minor(l.duties_minor);minor(component.retail_minor);
   if(amount!==actual||component.promotion_role==='zero_price_gift'&&amount!==0n)throw new Error('BUNDLE_PAID_ALLOCATION_CHANGED');total+=amount;
  }
  if(total!==minor(g.original_paid_minor))throw new Error('BUNDLE_TOTAL_MISMATCH');
 }
}
export function allocationSourcePin(f:Row,lineId:string){const group=f.bundle_allocations?.groups.find((g:Row)=>g.components.some((l:Row)=>l.line_id===lineId)),instruments=f.instrument_allocations;
 // Prior refunds are current balances, not original allocation identity.
 return {...(instruments?{instrument_allocation_digest:contentDigest({...instruments,instruments:instruments.instruments.map(({prior_refunded_minor,...i}:Row)=>i)})}:{}),...(group?{bundle_allocation_digest:contentDigest({treatment:f.bundle_allocations.treatment,promotion_rule:f.bundle_allocations.promotion_rule,group}),bundle_component:{bundle_id:group.id,promotion_id:group.promotion_id,promotion_rule:f.bundle_allocations.promotion_rule,...group.components.find((l:Row)=>l.line_id===lineId)}}: {})};}
export function assertAllocationSource(f:Row,b:Row){const pin=allocationSourcePin(f,b.line_id);for(const key of ['instrument_allocation_digest','bundle_allocation_digest'])if((pin[key]??null)!==(b[key]??null))throw new Error('PAID_ALLOCATION_CHANGED');}
export function resolutionSettings(k:CommerceKernel,s:Row) {
 const row=k.db.prepare('SELECT * FROM commerce_resolution_settings WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row;
 if(!row)throw new Error('RESOLUTION_NOT_CONFIGURED');const b=checkedBody(row);
 if(!b.enabled||b.expires_at<=k.clock())throw new Error('RESOLUTION_NOT_READY');
 assertReady(k,s,DRAFT_ACTION);return {...b,revision:row.revision,digest:row.digest};
}
export function allocationContext(k:CommerceKernel,scope:Scope,ref:string,active=true) {
 const s=k.require(scope),a=k.db.prepare('SELECT * FROM commerce_resolution_allocations WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(ref)) as Row;
 const b=checkedBody(a),cases=new CaseConfigurations(k),c=active?cases.resume(scope,a.case_id):cases.inspect(scope,a.case_id);
 k.authorize(scope,'return.read',a.resource_id);
 if(a.resource_id!==c.resource_id||b.case_id!==c.id||b.resource_id!==c.resource_id||b.customer_id!==c.customer_id)throw new Error('RESOLUTION_INTEGRITY');
 const p=k.db.prepare('SELECT * FROM commerce_resolution_plans WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,a.plan_id) as Row;
 const plan=checkedBody(p);
 if(active)assertResolutionReceipt(k,s,plan.request_id,b.line_id,b.units,c.resource_id);
 if(active&&b.configuration_digest!==c.configuration_digest)throw new Error('CONFIGURATION_REPREVIEW_REQUIRED');
 return {s,a,b,c,plan};
}
export function unitComponents(f:Row,l:Row,units:number[]) {
 // Use the same ordinal remainder order for gross and discount so every unit's
 // discount is <= its gross. Independent cumulative-floor deltas can violate this.
 const quantity=BigInt(l.quantity),result:Row={};
 for(const key of amounts){const total=minor(l[key]),base=total/quantity,remainder=total%quantity;
  result[key]=units.reduce((sum,n)=>sum+base+(BigInt(n)<=remainder?1n:0n),0n).toString();}
 result.paid_minor=(minor(result.gross_minor)-minor(result.discount_minor)+minor(result.tax_minor)+minor(result.shipping_minor)+minor(result.duties_minor)).toString();return result;
}
export class ResolutionLedger {
 readonly kernel:CommerceKernel;constructor(k:CommerceKernel){this.kernel=k;}
 configure(scope:Scope,input:unknown){const raw=jsonValue(input),p=exact(raw,['expected_revision','enabled','source_identity','credit_instrument','expires_at','inventory_buffer',...(Object.hasOwn(raw,'bundle_policy')?['bundle_policy']:[])]);integer(p.expected_revision);integer(p.expires_at);integer(p.inventory_buffer);id(p.source_identity);
  if(p.bundle_policy!==undefined&&p.bundle_policy!=='preserve_original_paid')throw new Error('BUNDLE_POLICY_UNSUPPORTED');
  if(typeof p.enabled!=='boolean'||!['none','native_store_credit'].includes(p.credit_instrument)||p.inventory_buffer>1000)throw new Error('INVALID_INPUT');
  const k=this.kernel;return k.transaction(()=>{const s=k.authorize(scope,'action.configure');assertReady(k,s,DRAFT_ACTION);
   if(p.expires_at<=k.clock()||p.expires_at>k.clock()+3600000)throw new Error('INVALID_INPUT');
   const old=k.db.prepare('SELECT revision FROM commerce_resolution_settings WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row;
   if((old?.revision??0)!==p.expected_revision)throw new Error('RESOLUTION_SETTINGS_CHANGED');
   const b={...p};delete b.expected_revision;
   k.db.prepare('INSERT INTO commerce_resolution_settings VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,store_id) DO UPDATE SET revision=excluded.revision,body=excluded.body,digest=excluded.digest').run(s.tenant_id,s.store_id,p.expected_revision+1,canonical(b),contentDigest(b));
   return {revision:p.expected_revision+1,qualification:'synthetic_only',live_financial_authority:false};});}
 allocate(scope:Scope,input:unknown){const p=exact(jsonValue(input),['request_id','request_key','lines']);id(p.request_id);id(p.request_key);
  if(!Array.isArray(p.lines)||!p.lines.length||p.lines.length>100)throw new Error('INVALID_INPUT');
  const seen=new Set<string>();for(const l of p.lines){exact(l,['line_id','units','outcome']);id(l.line_id);if(!['refund','store_credit','exchange'].includes(l.outcome)||!Array.isArray(l.units)||!l.units.length||l.units.length>100)throw new Error('INVALID_INPUT');
   for(const u of l.units){integer(u,1);const key=l.line_id+':'+u;if(seen.has(key))throw new Error('UNIT_ALREADY_ALLOCATED');seen.add(key);}l.units.sort((a:number,b:number)=>a-b);}
  p.lines.sort((a:Row,b:Row)=>(a.line_id+':'+a.outcome).localeCompare(b.line_id+':'+b.outcome));
  if(new Set(p.lines.map((l:Row)=>l.line_id+':'+l.outcome)).size!==p.lines.length)throw new Error('INVALID_INPUT');
  const k=this.kernel;return k.transaction(()=>{const s=k.require(scope),r=k.db.prepare('SELECT * FROM commerce_return_requests WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,p.request_id) as Row;
   const request=checkedBody(r),cases=new CaseConfigurations(k),c=cases.resume(scope,r.case_id);k.authorize(scope,'action.propose',c.resource_id);cases.verified(scope,c.id);assertCaseWorkerScope(k,scope,c.id);assertExecution(k,s,RESOLVE_ACTION);
   for(const line of p.lines)assertGiftOutcome(k,scope,c.id,line.outcome,[line]);
   assertReturnWritable(k,s,r.id);
   if(!r.receipt_id||!['submitted','native_created'].includes(r.state))throw new Error('RETURN_APPROVAL_REQUIRED');
   const settings=resolutionSettings(k,s),f=financialFacts(k,c),fees=intakeSettings(k,s),old=k.db.prepare('SELECT * FROM commerce_resolution_plans WHERE tenant_id=? AND store_id=? AND (request_id=? OR request_key=?)').get(s.tenant_id,s.store_id,r.id,p.request_key) as Row;
   if(f.bundle_allocations&&settings.bundle_policy!=='preserve_original_paid')throw new Error('BUNDLE_POLICY_UNAPPROVED');
   if(old){const value=checkedBody(old);if(contentDigest(value.intent)!==contentDigest(p))throw new Error('RESOLUTION_CONFLICT');return this.read(scope,old.id);}
   const expected=request.selection.lines.map((l:Row)=>[l.line_id,l.quantity]).sort(),actual=[...new Set(p.lines.map((l:Row)=>l.line_id))].map(l=>[l,p.lines.filter((x:Row)=>x.line_id===l).reduce((n:number,x:Row)=>n+x.units.length,0)]).sort();
   if(canonical(expected)!==canonical(actual))throw new Error('RETURN_QUANTITY_MISMATCH');
   const planId='plan_'+token().slice(0,32),allocations:Row[]=[];
   const ship=allocateMoney(money(f.currency,fees.body.shipping_minor),p.lines.map((l:Row)=>({id:l.line_id+'_'+l.outcome,weight:String(l.units.length)})));
   for(const l of p.lines){if(!c.pins.policy.body.rules.outcomes.includes(l.outcome)||(l.outcome==='store_credit'&&settings.credit_instrument!=='native_store_credit'))throw new Error('OUTCOME_UNSUPPORTED');
    const paid=f.paid_lines.find((x:Row)=>x.id===l.line_id),source=c.order.payload.return_lines.find((x:Row)=>x.id===l.line_id);
    if(!paid||!source||l.units.some((n:number)=>n>source.fulfilled||paid.resolved_units.includes(n)))throw new Error('QUANTITY_EXCEEDED');
    for(const n of l.units)if(k.db.prepare('SELECT 1 FROM commerce_resolution_units WHERE tenant_id=? AND store_id=? AND resource_id=? AND line_id=? AND unit_index=?').get(s.tenant_id,s.store_id,c.resource_id,l.line_id,n))throw new Error('UNIT_ALREADY_ALLOCATED');
    const parts=unitComponents(f,paid,l.units),a={...l,...allocationSourcePin(f,l.line_id),id:'alloc_'+token().slice(0,32),plan_id:planId,case_id:c.id,resource_id:c.resource_id,customer_id:c.customer_id,
     configuration_digest:c.configuration_digest,paid_line_digest:contentDigest({...paid,resolved_units:[]}),currency:f.currency,components:parts,product_id:paid.product_id,variant_id:paid.variant_id,
     return_shipping_minor:ship.find(x=>x.id===l.line_id+'_'+l.outcome)!.amount.minor,restocking_bps:fees.body.restocking_bps,fee_settings_digest:fees.digest};
    allocations.push(a);
   }
   const body={intent:p,request_id:r.id,configuration_digest:c.configuration_digest,financial_revision:f.revision,created_at:k.clock()};
   k.db.prepare('INSERT INTO commerce_resolution_plans VALUES(?,?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,planId,r.id,c.id,c.resource_id,p.request_key,canonical(body),contentDigest(body));
   for(const a of allocations){k.db.prepare('INSERT INTO commerce_resolution_allocations VALUES(?,?,?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,a.id,planId,c.id,c.resource_id,a.line_id,a.outcome,canonical(a),contentDigest(a));
    for(const n of a.units)k.db.prepare('INSERT INTO commerce_resolution_units VALUES(?,?,?,?,?,?)').run(s.tenant_id,s.store_id,c.resource_id,a.line_id,n,a.id);}
   return this.read(scope,planId);});}
 read(scope:Scope,ref:string){const k=this.kernel,s=k.require(scope),p=k.db.prepare('SELECT * FROM commerce_resolution_plans WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(ref)) as Row;checkedBody(p);new CaseConfigurations(k).inspect(scope,p.case_id);k.authorize(scope,'return.read',p.resource_id);
  const allocations=(k.db.prepare('SELECT a.*,o.state operation_state,o.id operation_id FROM commerce_resolution_allocations a LEFT JOIN commerce_resolution_operations o ON o.tenant_id=a.tenant_id AND o.store_id=a.store_id AND o.allocation_id=a.id WHERE a.tenant_id=? AND a.store_id=? AND a.plan_id=? ORDER BY a.line_id,a.outcome').all(s.tenant_id,s.store_id,p.id) as Row[]).map(a=>({...checkedBody(a),state:a.operation_state??'planned',operation_id:a.operation_id??null}));
  const total=allocations.reduce((n,a)=>n+minor(a.components.paid_minor),0n),resolved=allocations.filter(a=>['settled','issued'].includes(a.state)).reduce((n,a)=>n+minor(a.components.paid_minor),0n);
  return {id:p.id,case_id:p.case_id,allocations,allocated_value_minor:total.toString(),remaining_obligation_minor:(total-resolved).toString(),financial_effect:false};}
}
