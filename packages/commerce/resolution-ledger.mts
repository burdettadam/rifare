import { assertReturnWritable,assertResolutionReceipt } from './return-lifecycle-core.mts';
import { exact,id,integer,token } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
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
 const f=exact(jsonValue(c.order.payload.resolution_facts),['revision','observed_at','currency','payment_id','original_paid_minor','prior_refunded_minor','accounted_operations','paid_lines']);
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
 return f;
}
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
 configure(scope:Scope,input:unknown){const p=exact(jsonValue(input),['expected_revision','enabled','source_identity','credit_instrument','expires_at','inventory_buffer']);integer(p.expected_revision);integer(p.expires_at);integer(p.inventory_buffer);id(p.source_identity);
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
   assertReturnWritable(k,s,r.id);
   if(!r.receipt_id||!['submitted','native_created'].includes(r.state))throw new Error('RETURN_APPROVAL_REQUIRED');
   const settings=resolutionSettings(k,s),f=financialFacts(k,c),fees=intakeSettings(k,s),old=k.db.prepare('SELECT * FROM commerce_resolution_plans WHERE tenant_id=? AND store_id=? AND (request_id=? OR request_key=?)').get(s.tenant_id,s.store_id,r.id,p.request_key) as Row;
   if(old){const value=checkedBody(old);if(contentDigest(value.intent)!==contentDigest(p))throw new Error('RESOLUTION_CONFLICT');return this.read(scope,old.id);}
   const expected=request.selection.lines.map((l:Row)=>[l.line_id,l.quantity]).sort(),actual=[...new Set(p.lines.map((l:Row)=>l.line_id))].map(l=>[l,p.lines.filter((x:Row)=>x.line_id===l).reduce((n:number,x:Row)=>n+x.units.length,0)]).sort();
   if(canonical(expected)!==canonical(actual))throw new Error('RETURN_QUANTITY_MISMATCH');
   const planId='plan_'+token().slice(0,32),allocations:Row[]=[];
   const ship=allocateMoney(money(f.currency,fees.body.shipping_minor),p.lines.map((l:Row)=>({id:l.line_id+'_'+l.outcome,weight:String(l.units.length)})));
   for(const l of p.lines){if(!c.pins.policy.body.rules.outcomes.includes(l.outcome)||(l.outcome==='store_credit'&&settings.credit_instrument!=='native_store_credit'))throw new Error('OUTCOME_UNSUPPORTED');
    const paid=f.paid_lines.find((x:Row)=>x.id===l.line_id),source=c.order.payload.return_lines.find((x:Row)=>x.id===l.line_id);
    if(!paid||!source||l.units.some((n:number)=>n>source.fulfilled||paid.resolved_units.includes(n)))throw new Error('QUANTITY_EXCEEDED');
    for(const n of l.units)if(k.db.prepare('SELECT 1 FROM commerce_resolution_units WHERE tenant_id=? AND store_id=? AND resource_id=? AND line_id=? AND unit_index=?').get(s.tenant_id,s.store_id,c.resource_id,l.line_id,n))throw new Error('UNIT_ALREADY_ALLOCATED');
    const parts=unitComponents(f,paid,l.units),a={...l,id:'alloc_'+token().slice(0,32),plan_id:planId,case_id:c.id,resource_id:c.resource_id,customer_id:c.customer_id,
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
