import type {CommerceKernel,Scope,Row} from './kernel.mts';
import {exact,id,integer} from './kernel.mts';
import {canonical,contentDigest} from './configuration-values.mts';
import {allocationContext,assertAllocationSource,checkedBody,financialFacts,minor,unitComponents} from './resolution-ledger.mts';
import {assertLineageIngest} from './exchange-lineage-guards.mts';
import type {ResolutionExecution} from './resolution-execution.mts';
import type {ExchangeLineage} from './exchange-lineage.mts';
import {LoyaltyAccrualScopeError} from '../adapters/loyalty-accrual-fixture-source.mts';

export class LoyaltyAccrualEvidenceError extends Error {
  readonly state:string;readonly evidence:Row|null;
  constructor(state:string,reason:string,evidence:Row|null=null){super(reason);this.state=state;this.evidence=evidence;}
}
const fail=(state:string,reason:string,evidence:Row|null=null):never=>{throw new LoyaltyAccrualEvidenceError(state,reason,evidence);};
const key=(resource:string,line:string,unit:number)=>canonical([resource,line,unit]);
const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
const stableLines=(lines:Row[])=>lines.map(({resolved_units,...line})=>line).sort((a,b)=>a.id.localeCompare(b.id));
const instrumentPin=(value:Row|undefined)=>value?{...value,instruments:value.instruments.map(({prior_refunded_minor,...instrument}:Row)=>instrument)}:null;
const COMMAND_FIELDS=['resource_id','customer_id','allocation_id','kind','currency','amount_minor','payment_id','native_return_id','source_identity','credit_instrument'];
const COMMAND_OPTIONAL=['exchange_quote_id','exchange_quote_digest','original_value_minor','replacement_variant','replacement_minor','quantity','routes','value_routes','payment_expires_at','credit_beneficiary_id','gift_source_digest','line_id','units','money_terms','woo_refund'];
function commandFromQuote(operation:string,s:Row,quote:Row){
  const command:Row={operation_id:operation,tenant_id:s.tenant_id,store_id:s.store_id};
  for(const field of COMMAND_FIELDS){integrity(Object.hasOwn(quote,field));command[field]=quote[field];}
  for(const field of COMMAND_OPTIONAL)if(Object.hasOwn(quote,field))command[field]=quote[field];return command;
}
function preserveAuthority(error:unknown){
  if(error instanceof LoyaltyAccrualScopeError||error instanceof Error&&/^(ACCESS_DENIED|WORK_SCOPE_DENIED|SUBJECT_ERASED|RESTORE_.*|RESTORED_.*|CUSTOMER_VERIFICATION_REQUIRED|CASE_CUSTOMER_CHANGED|.*SOURCE_MISMATCH)$/.test(error.message))throw error;
}
function scoped(b:Row,s:Row,customer:string,source?:string){
  for(const [field,value] of [['tenant_id',s.tenant_id],['store_id',s.store_id],['customer_id',customer],...(source?[['source_identity',source]]:[])])
    if(Object.hasOwn(b,field)&&b[field]!==value)throw new LoyaltyAccrualScopeError();
}
function integrity(condition:unknown){if(!condition)throw new Error('LOYALTY_ECONOMIC_EVIDENCE_MISMATCH');}
function bounded(rows:Row[],limit=1000){if(rows.length>limit)fail('unsupported','LOYALTY_EVIDENCE_LIMIT');return rows;}
function sumFunding(values:Row[]){integrity(Array.isArray(values)&&values.length<=8);return values.reduce((sum,value)=>sum+minor(value.amount_minor),0n);}

/** Both journals are read. Neither a mutable local stage nor a source result alone proves settlement. */
function terminalEvidence(k:CommerceKernel,s:Row,op:Row,command:Row,sourceRow:Row|undefined,capture:Row|undefined) {
  if(!['authorized','unknown'].includes(op.state))id(op.native_id);
  const rows=bounded(k.db.prepare('SELECT * FROM commerce_resolution_observations WHERE tenant_id=? AND store_id=? AND operation_id=?').all(s.tenant_id,s.store_id,op.id) as Row[]);
  const proofs:Row[]=[],terminal:Row[]=[];
  const result=(value:Row)=>{
    scoped(value,s,command.customer_id,command.source_identity);
    exact(value,[...Object.keys(command),'id','state','instrument','qualification',...(op.kind==='additional_payment'?['payment']:[])]);
    for(const field of Object.keys(command))integrity(same(value[field],command[field]));
    id(value.id);integrity(value.qualification==='synthetic_only'&&(!op.native_id||value.id===op.native_id));
    const stages=op.kind==='refund'?['accepted','settled','rejected']:op.kind==='additional_payment'?['unpaid','partial','failed','expired','settled','rejected']:['issued','rejected'];
    integrity(stages.includes(value.state));
    if(op.kind==='additional_payment'){
      const p=exact(value.payment,['obligation_id','amount_minor','paid_minor','currency','customer_id','expires_at','state','settled']);
      scoped(p,s,command.customer_id);const paid=minor(p.paid_minor),amount=minor(command.amount_minor);
      integrity(p.obligation_id===op.id&&p.amount_minor===command.amount_minor&&p.currency===command.currency&&p.expires_at===command.payment_expires_at&&p.state===value.state&&p.settled===(value.state==='settled'));
      integrity(paid<=amount&&(value.state!=='settled'||paid===amount)&&(value.state!=='partial'||paid>0n&&paid<amount)&&(!['unpaid','rejected'].includes(value.state)||paid===0n));
    }
    if(op.kind==='store_credit'&&value.state==='issued'){
      const instrument=exact(value.instrument,['account_id','balance_minor','currency','customer_id','expires_at','type']);
      integrity(instrument.customer_id===(command.credit_beneficiary_id??command.customer_id)&&instrument.currency===command.currency&&instrument.type==='native_store_credit'&&instrument.expires_at===null);
      id(instrument.account_id);minor(instrument.balance_minor);
    }else integrity(value.instrument===null);
    return value;
  };
  for(const row of rows){
    integrity(row.resource_id===op.resource_id);const body=checkedBody(row);
    if(['authorized','unknown'].includes(row.stage))continue;
    result(body);integrity(body.state===row.stage);proofs.push(body);
    if(['settled','issued','rejected'].includes(row.stage))terminal.push(body);
  }
  // Identical repeated observations have one semantic identity, independent of sequence/time.
  const unique=[...new Set(proofs.map(contentDigest))].sort(),terminals=[...new Set(terminal.map(contentDigest))].sort();
  if(op.kind!=='store_credit')integrity(terminals.length<=1);
  if(terminal.length)integrity(terminal.every(body=>body.state===op.state));
  let source:Row|null=null;
  if(sourceRow){
    const sourceCommand=JSON.parse(sourceRow.command);scoped(sourceCommand,s,command.customer_id,command.source_identity);
    integrity(sourceRow.operation_id===op.id&&sourceRow.resource_id===op.resource_id&&sourceRow.digest===contentDigest(sourceCommand)&&same(sourceCommand,command));
    source=result(JSON.parse(sourceRow.body));
    if(terminal.length)integrity(terminal.every(body=>body.state===source!.state&&body.id===source!.id));
  }
  if(capture)integrity(op.kind==='additional_payment'&&capture.operation_id===op.id&&capture.resource_id===op.resource_id&&capture.allocation_id===op.allocation_id&&capture.amount_minor===command.amount_minor&&capture.currency===command.currency);
  const digest=contentDigest({command,observations:unique,source,capture:capture??null});
  if(op.kind==='store_credit')return {state:'unsupported',reason:'LOYALTY_STORE_CREDIT_UNSUPPORTED',digest};
  if(!source)return {state:'pending',reason:'LOYALTY_SOURCE_EFFECT_REQUIRED',digest};
  const matching=proofs.filter(body=>same(body,source));
  if(source.state==='settled'){
    if(op.state!=='settled'||!matching.length)return {state:'pending',reason:'LOYALTY_TERMINAL_OBSERVATION_REQUIRED',digest};
    if(op.kind==='additional_payment'&&!capture)return {state:'pending',reason:'LOYALTY_PAYMENT_CAPTURE_REQUIRED',digest};
    return {state:'qualified',reason:'LOYALTY_EXACT_SETTLEMENT',digest};
  }
  if(capture&&['failed','expired','rejected','unpaid'].includes(source.state))integrity(false);
  if(['failed','expired','rejected'].includes(source.state)&&matching.length&&op.state===source.state&&(!source.payment||source.payment.paid_minor==='0'))
    return {state:'excluded',reason:'LOYALTY_NATIVE_'+source.state.toUpperCase(),digest};
  return {state:'pending',reason:'LOYALTY_SETTLEMENT_PENDING',digest};
}

function validateNode(k:CommerceKernel,scope:Scope,s:Row,c:Row,lineage:ExchangeLineage,parent:Row,row:Row,sourceRow:Row) {
  const source=lineage.source,n=checkedBody(row),native=checkedBody(sourceRow);scoped(n,s,c.customer_id,source.identity);scoped(native,s,c.customer_id,source.identity);
  integrity(row.id===n.id&&row.resource_id===n.resource_id&&row.parent_resource_id===n.parent_resource_id&&row.operation_id===n.operation_id&&row.native_order_id===n.native_order_id&&row.customer_id===n.customer_id);
  integrity(sourceRow.operation_id===n.operation_id&&sourceRow.resource_id===n.resource_id&&sourceRow.parent_resource_id===n.parent_resource_id&&same(n,native)&&row.digest===sourceRow.digest);
  integrity(n.parent_resource_id===parent.resource&&n.parent_digest===parent.digest&&n.generation===parent.generation+1&&n.currency===c.order.payload.currency&&n.fulfillment_source_identity===source.fulfillment.identity&&n.qualification==='synthetic_only');
  const read=lineage.read(scope,row.id);integrity(same(read.node,n));
  const child=k.get(scope,n.resource_id);if(child.customer_id!==c.customer_id)throw new LoyaltyAccrualScopeError();
  assertLineageIngest(k,s,child.id,child);
  integrity(Array.isArray(n.consumed_units)&&n.consumed_units.length>0&&n.consumed_units.length<=1000&&Array.isArray(n.units)&&n.units.length===n.quantity);
  integer(n.quantity,1);const consumed=new Set<string>(),selected:Row[]=[];
  for(const u of n.consumed_units){exact(u,['line_id','unit_index']);integer(u.unit_index,1);id(u.line_id);const ref=key(parent.resource,u.line_id,u.unit_index);
    integrity(!consumed.has(ref));consumed.add(ref);const original=parent.body.units.find((x:Row)=>x.line_id===u.line_id&&x.unit_index===u.unit_index);integrity(original&&!original.resolved);selected.push(original);}
  const paid=selected.reduce((sum,u)=>sum+minor(u.paid_minor),0n),fees=minor(n.fees_minor),additional=minor(n.additional_paid_minor),outflow=minor(n.terminal_outflow_minor),carried=minor(n.carried_minor);
  integrity(paid===minor(n.parent_paid_minor)&&fees<=paid&&paid-fees+additional>=outflow&&paid-fees+additional-outflow===carried&&sumFunding(n.funding)===carried);
  const fundingIds=new Set<string>();for(const f of n.funding){id(f.instrument_id);integrity(!fundingIds.has(f.instrument_id));fundingIds.add(f.instrument_id);
    if(f.source_identity!==source.identity)throw new LoyaltyAccrualScopeError();
    if(f.source_operation_id===n.financial_operation_id&&additional>0n)integrity(f.amount_minor===n.additional_paid_minor&&f.instrument_id==='payment_'+contentDigest(n.financial_operation_id).slice(0,24)&&f.type==='card');
    else {const inherited=selected.flatMap(u=>u.funding).filter((x:Row)=>x.instrument_id===f.instrument_id);integrity(inherited.length&&inherited.every((x:Row)=>same({...x,amount_minor:'0'},{...f,amount_minor:'0'}))&&minor(f.amount_minor)<=inherited.reduce((sum:bigint,x:Row)=>sum+minor(x.amount_minor),0n));}}
  const sums=new Map<string,bigint>();let unitPaid=0n;const unitIds=new Set<string>();
  for(const u of n.units){integer(u.unit_index,1);const unitKey=key(n.resource_id,u.line_id,u.unit_index);integrity(u.line_id===n.line_id&&u.unit_index<=n.quantity&&!unitIds.has(unitKey)&&u.resolved===false&&sumFunding(u.funding)===minor(u.paid_minor));unitIds.add(unitKey);unitPaid+=minor(u.paid_minor);
    for(const f of u.funding){const total=n.funding.find((x:Row)=>x.instrument_id===f.instrument_id);integrity(total&&same({...total,amount_minor:'0'},{...f,amount_minor:'0'}));sums.set(f.instrument_id,(sums.get(f.instrument_id)??0n)+minor(f.amount_minor));}}
  integrity(unitPaid===carried&&n.funding.every((f:Row)=>sums.get(f.instrument_id)===minor(f.amount_minor)));
  const fulfillment=k.db.prepare("SELECT * FROM commerce_fulfillment_operations WHERE tenant_id=? AND store_id=? AND id=? AND kind='replacement'").get(s.tenant_id,s.store_id,n.operation_id) as Row|undefined;
  if(!fulfillment)fail('pending','LOYALTY_REPLACEMENT_OPERATION_REQUIRED');
  const command=JSON.parse(fulfillment.command);scoped(command,s,c.customer_id,source.fulfillment.identity);
  integrity(contentDigest(command)===fulfillment.digest&&command.operation_id===n.operation_id&&fulfillment.resource_id===parent.resource&&fulfillment.state==='created');
  const replacement=source.fulfillment.replacement(n.operation_id),delivery=replacement&&source.fulfillment.delivery(replacement.id);
  if(!replacement||!delivery)fail('pending','LOYALTY_REPLACEMENT_DELIVERY_REQUIRED');
  const pin=replacement.exchange_lineage;
  integrity(pin&&pin.parent_resource_id===parent.resource&&pin.parent_digest===parent.digest&&pin.generation===n.generation&&pin.customer_id===c.customer_id&&pin.currency===n.currency&&pin.parent_paid_minor===n.parent_paid_minor&&pin.replacement_minor===n.carried_minor&&pin.replacement_retail_minor===n.replacement_retail_minor&&same(pin.units,n.consumed_units.map((u:Row)=>u.unit_index))&&n.consumed_units.every((u:Row)=>u.line_id===pin.line_id));
  integrity(replacement.id===n.replacement_id&&replacement.quantity===n.quantity&&replacement.state==='created'&&replacement.inventory_committed&&replacement.fulfillable&&replacement.fulfillment_state==='shipped'&&replacement.resource_id===parent.resource&&replacement.customer_id===c.customer_id);
  integrity(delivery.event_id===n.delivery_event_id&&delivery.native_order_id===n.native_order_id&&delivery.fulfillment_line_id===n.fulfillment_line_id&&delivery.delivered_at===n.delivered_at);
  const financial=replacement.exchange_finance;
  integrity((financial?.operation_id??null)===n.financial_operation_id&&(!financial?additional===0n&&outflow===0n:financial.kind==='additional_payment'?additional===minor(financial.amount_minor)&&outflow===0n:outflow===minor(financial.amount_minor)&&additional===0n&&n.terminal_outflow_kind===financial.kind));
  return {body:n,digest:row.digest,resource:n.resource_id,generation:n.generation,trusted:true};
}

/** Original-unit attribution is transient. No personal projection is persisted in core. */
export function loyaltyAccrualEvidence(k:CommerceKernel,scope:Scope,c:Row,finance:ResolutionExecution,lineage:ExchangeLineage,historical:Row) {
  const s=k.require(scope),source=lineage.source,db=source.db;
  k.authorize(scope,'operation.read',c.resource_id);
  if(!c.order.payload.resolution_facts)fail('pending','LOYALTY_PAID_ALLOCATIONS_REQUIRED');
  let facts:Row;try{facts=financialFacts(k,c);}catch(error){preserveAuthority(error);fail(error instanceof Error&&error.message==='FINANCIAL_SOURCE_STALE'?'pending':'discrepant','LOYALTY_PAID_ALLOCATIONS_INVALID');}
  const originalRow=db.prepare('SELECT * FROM fixture_exchange_lineage_originals WHERE resource_id=?').get(c.resource_id) as Row|undefined;
  if(!originalRow)fail('pending','LOYALTY_ORIGINAL_EVIDENCE_REQUIRED');
  let original:Row;try{original=checkedBody(originalRow);}catch{fail('discrepant','LOYALTY_ORIGINAL_EVIDENCE_CHANGED');}
  scoped(original,s,c.customer_id);if(original.resource_id!==c.resource_id||historical.pin.resource_id!==c.resource_id||historical.pin.customer_id!==c.customer_id||historical.pin.financial_source_identity!==source.identity)throw new LoyaltyAccrualScopeError();
  if(historical.pin.original_digest!==originalRow.digest||facts.currency!==historical.rules.rules.currency||facts.currency!==original.currency||facts.payment_id!==original.payment_id||facts.original_paid_minor!==original.original_paid_minor||c.order.payload.native_order_id!==original.native_order_id||!same(stableLines(facts.paid_lines),stableLines(original.paid_lines))||!same(instrumentPin(facts.instrument_allocations),instrumentPin(original.instrument_allocations))||!same(facts.bundle_allocations??null,original.bundle_allocations??null))fail('discrepant','LOYALTY_ORIGINAL_PAID_ALLOCATION_CHANGED');
  const units:Row[]=[],mapping=new Map<string,number>(),issues:Row[]=[],proofs:unknown[]=[historical.pin.digest,historical.rules.digest,originalRow.digest,contentDigest(facts)],parents=new Map<string,Row>();
  const issue=(state:string,reason:string,evidence:unknown)=>{issues.push({state,reason,digest:contentDigest(evidence)});};
  try{
    for(const line of [...facts.paid_lines].sort((a,b)=>a.id.localeCompare(b.id)))for(let n=1;n<=line.quantity;n++){
      if(units.length>=1000)fail('unsupported','LOYALTY_EVIDENCE_LIMIT');const paid=unitComponents(facts,line,[n]).paid_minor,matching=original.units.filter((u:Row)=>u.line_id===line.id&&u.unit_index===n);
      integrity(matching.length===1);const u=matching[0];integrity(u.paid_minor===paid&&sumFunding(u.funding)===minor(paid)&&u.resolved===original.paid_lines.find((l:Row)=>l.id===line.id).resolved_units.includes(n));
      for(const fund of u.funding){if(fund.source_identity!==source.identity)throw new LoyaltyAccrualScopeError();integrity(fund.payment_id===original.payment_id&&fund.source_operation_id===null&&['card','gift_card'].includes(fund.type));}
      mapping.set(key(c.resource_id,line.id,n),units.length);units.push({original_line_id:line.id,unit_index:n,original_paid_minor:paid,additional:0n,refunds:0n,accrual_operations:[],reversal_operations:[]});
    }
    integrity(original.units.length===units.length);
  }catch(error){preserveAuthority(error);if(error instanceof LoyaltyAccrualEvidenceError)throw error;fail('discrepant','LOYALTY_ORIGINAL_UNITS_INVALID');}
  if(minor(original.prior_refunded_minor)>0n||original.units.some((u:Row)=>u.resolved))fail('pending','LOYALTY_HISTORICAL_EVENT_ATTRIBUTION_REQUIRED');
  const root={resource:c.resource_id,body:original,digest:originalRow.digest,generation:0,trusted:true};parents.set(c.resource_id,root);
  const queue=[root],nodes:Row[]=[],consumed=new Set<string>(),resources=new Set<string>([c.resource_id]);
  for(let cursor=0;cursor<queue.length;cursor++){
    const parent=queue[cursor];k.authorize(scope,'resource.read',parent.resource);k.authorize(scope,'operation.read',parent.resource);
    const coreRows=bounded(k.db.prepare('SELECT * FROM commerce_exchange_lineage_nodes WHERE tenant_id=? AND store_id=? AND parent_resource_id=? ORDER BY operation_id LIMIT 101').all(s.tenant_id,s.store_id,parent.resource) as Row[],100);
    const sourceRows=bounded(db.prepare('SELECT * FROM fixture_exchange_lineage_nodes WHERE parent_resource_id=? ORDER BY operation_id LIMIT 101').all(parent.resource) as Row[],100);
    const imports=bounded(k.db.prepare('SELECT * FROM commerce_exchange_lineage_imports WHERE tenant_id=? AND store_id=? AND resource_id=? ORDER BY operation_id LIMIT 101').all(s.tenant_id,s.store_id,parent.resource) as Row[],100);
    for(const imported of imports)if(imported.state!=='imported'||!coreRows.some(row=>row.operation_id===imported.operation_id&&row.id===imported.node_id))issue('pending','LOYALTY_LINEAGE_IMPORT_PENDING',imported);
    for(const operation of [...new Set([...coreRows,...sourceRows].map(row=>row.operation_id))].sort()){
      const core=coreRows.find(row=>row.operation_id===operation),native=sourceRows.find(row=>row.operation_id===operation),resource=(core??native)!.resource_id;
      k.authorize(scope,'resource.read',resource);k.authorize(scope,'operation.read',resource);
      if(core)k.get(scope,resource);if(resources.has(resource)){issue('discrepant','LOYALTY_LINEAGE_CYCLE_OR_DUPLICATE',[core,native]);continue;}
      if(resources.size>=101)fail('unsupported','LOYALTY_EVIDENCE_LIMIT');resources.add(resource);
      let next:Row={resource,body:null,digest:null,generation:parent.generation+1,trusted:false};
      try{
        for(const row of [core,native].filter(Boolean) as Row[]){const b=checkedBody(row);scoped(b,s,c.customer_id,source.identity);integrity(b.resource_id===resource&&b.operation_id===operation&&b.parent_resource_id===parent.resource);}
        if(!core||!native)fail('pending','LOYALTY_LINEAGE_BOTH_JOURNALS_REQUIRED');
        if(!parent.trusted)fail('pending','LOYALTY_PARENT_ATTRIBUTION_REQUIRED');
        next=validateNode(k,scope,s,c,lineage,parent,core,native);const n=next.body;
        integrity(imports.some(row=>row.operation_id===operation&&row.state==='imported'&&row.node_id===n.id));
        for(const u of n.consumed_units){const ref=key(parent.resource,u.line_id,u.unit_index);integrity(!consumed.has(ref));consumed.add(ref);
          const debit=db.prepare('SELECT * FROM fixture_exchange_lineage_units WHERE resource_id=? AND line_id=? AND unit_index=?').get(parent.resource,u.line_id,u.unit_index) as Row|undefined;
          if(!debit)fail('pending','LOYALTY_PARENT_CONSUMPTION_REQUIRED');integrity(debit.operation_id===n.operation_id);}
        if(n.consumed_units.length!==1||n.quantity!==1){issue('unsupported','LOYALTY_MULTIUNIT_LINEAGE_UNSUPPORTED',n);next.trusted=false;}
        else{const u=n.consumed_units[0],index=mapping.get(key(parent.resource,u.line_id,u.unit_index));if(index===undefined)fail('pending','LOYALTY_PARENT_ATTRIBUTION_REQUIRED');mapping.set(key(resource,n.line_id,1),index);}
        nodes.push(n);proofs.push(core.digest);
      }catch(error){preserveAuthority(error);next.trusted=false;issue(error instanceof LoyaltyAccrualEvidenceError?error.state:'discrepant',error instanceof LoyaltyAccrualEvidenceError?error.message:'LOYALTY_LINEAGE_EVIDENCE_CHANGED',[core??null,native??null]);}
      parents.set(resource,next);queue.push(next);
    }
    const consumedRows=bounded(db.prepare('SELECT * FROM fixture_exchange_lineage_units WHERE resource_id=? LIMIT 1001').all(parent.resource) as Row[]);
    for(const row of consumedRows)if(!sourceRows.some(node=>node.operation_id===row.operation_id))issue('pending','LOYALTY_ORPHAN_PARENT_CONSUMPTION',row);
  }
  const events:Row[]=[],operations=new Map<string,Row>();let operationCount=0,sourceCount=0,captureCount=0;
  for(const resource of [...resources].sort()){
    const rows=bounded(k.db.prepare('SELECT * FROM commerce_resolution_operations WHERE tenant_id=? AND store_id=? AND resource_id=? ORDER BY id LIMIT 1001').all(s.tenant_id,s.store_id,resource) as Row[]);
    const effects=bounded(db.prepare('SELECT * FROM fixture_resolution_effects WHERE resource_id=? ORDER BY operation_id LIMIT 1001').all(resource) as Row[]),captures=bounded(db.prepare('SELECT * FROM fixture_payment_captures WHERE resource_id=? ORDER BY operation_id LIMIT 1001').all(resource) as Row[]);
    operationCount+=rows.length;sourceCount+=effects.length;captureCount+=captures.length;if(Math.max(operationCount,sourceCount,captureCount)>1000)fail('unsupported','LOYALTY_EVIDENCE_LIMIT');
    for(const op of rows){
      k.authorize(scope,'operation.read',resource);k.authorize(scope,'return.read',resource);k.get(scope,resource);
      let index:number|undefined,command:Row|undefined,ctx:Row|undefined,evidence:Row={state:'discrepant',reason:'LOYALTY_FINANCIAL_EVIDENCE_CHANGED',digest:contentDigest(op)};
      try{
        if(op.source_identity!==source.identity)throw new LoyaltyAccrualScopeError();finance.read(scope,op.id);
        ctx=allocationContext(k,scope,op.allocation_id,false);const a=ctx.b,f=financialFacts(k,ctx.c),line=f.paid_lines.find((l:Row)=>l.id===a.line_id);
        if(ctx.c.customer_id!==c.customer_id||ctx.c.resource_id!==resource)throw new LoyaltyAccrualScopeError();
        command=JSON.parse(op.command);scoped(command,s,c.customer_id,source.identity);
        const quoteRow=k.db.prepare('SELECT * FROM commerce_resolution_quotes WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,op.quote_id) as Row|undefined,quote=checkedBody(quoteRow);
        const expectedCommand=commandFromQuote(op.id,s,quote);exact(command,Object.keys(expectedCommand));integrity(same(command,expectedCommand));
        integrity(line&&quoteRow!.allocation_id===a.id&&quoteRow!.resource_id===resource&&quoteRow!.case_id===ctx.c.id&&quote.allocation_id===a.id&&quote.resource_id===resource&&quote.customer_id===c.customer_id&&quote.kind===op.kind&&quote.amount_minor===op.amount_minor&&quote.currency===op.currency);
        for(const field of Object.keys(command))if(field!=='operation_id'&&field!=='tenant_id'&&field!=='store_id')integrity(same(command[field],quote[field]));
        integrity(op.case_id===ctx.c.id&&op.resource_id===a.resource_id&&a.id===op.allocation_id&&a.plan_id===ctx.a.plan_id&&a.line_id===ctx.a.line_id&&a.outcome===ctx.a.outcome&&a.paid_line_digest===contentDigest({...line,resolved_units:[]})&&same(a.components,unitComponents(f,line,a.units))&&a.currency===f.currency&&f.currency===facts.currency&&command.payment_id===f.payment_id);
        assertAllocationSource(f,a);
        integrity(ctx.plan.intent.lines.some((l:Row)=>l.line_id===a.line_id&&l.outcome===a.outcome&&same(l.units,a.units)));
        for(const unit of a.units){const nativeUnit=k.db.prepare('SELECT allocation_id FROM commerce_resolution_units WHERE tenant_id=? AND store_id=? AND resource_id=? AND line_id=? AND unit_index=?').get(s.tenant_id,s.store_id,resource,a.line_id,unit) as Row|undefined;integrity(nativeUnit?.allocation_id===a.id);}
        const nativeReturn=k.db.prepare('SELECT * FROM commerce_native_return_operations WHERE tenant_id=? AND store_id=? AND request_id=?').get(s.tenant_id,s.store_id,ctx.plan.request_id) as Row|undefined;
        integrity(nativeReturn?.native_id===command.native_return_id&&nativeReturn.native_body&&contentDigest(JSON.parse(nativeReturn.native_body))===nativeReturn.native_digest&&typeof quote.native_return_digest==='string'&&/^[a-f0-9]{64}$/.test(quote.native_return_digest));
        const nativeBody=JSON.parse(nativeReturn!.native_body);integrity(nativeBody.id===command.native_return_id&&nativeBody.order_id===ctx.c.order.payload.native_order_id);
        if(a.units.length===1)index=mapping.get(key(resource,a.line_id,a.units[0]));
        const terminal=terminalEvidence(k,s,op,command,effects.find(row=>row.operation_id===op.id),captures.find(row=>row.operation_id===op.id));
        evidence={...terminal,digest:contentDigest({terminal:terminal.digest,allocation:ctx.a.digest,quote:quoteRow!.digest})};
        if(a.units.length!==1)evidence={...evidence,state:'unsupported',reason:'LOYALTY_MULTIUNIT_EVENT_UNSUPPORTED'};
        else if(index===undefined)evidence={...evidence,state:parents.get(resource)?.trusted?'pending':'unsupported',reason:'LOYALTY_ORIGINAL_UNIT_ATTRIBUTION_REQUIRED'};
      }catch(error){preserveAuthority(error);evidence={state:error instanceof LoyaltyAccrualEvidenceError?error.state:'discrepant',reason:error instanceof LoyaltyAccrualEvidenceError?error.message:'LOYALTY_FINANCIAL_EVIDENCE_CHANGED',digest:contentDigest({operation:op,effect:effects.find(row=>row.operation_id===op.id)??null,capture:captures.find(row=>row.operation_id===op.id)??null})};}
      const unit=index===undefined?null:units[index];
      if(unit&&evidence.state==='qualified'){
        if(op.kind==='additional_payment'){unit.additional+=minor(op.amount_minor);unit.accrual_operations.push(op.id);}
        if(op.kind==='refund'){unit.refunds+=minor(op.amount_minor);unit.reversal_operations.push(op.id);}
      }
      const event={operation_id:op.id,kind:op.kind,amount_minor:op.amount_minor,original_line_id:unit?.original_line_id??null,unit_index:unit?.unit_index??null,state:evidence.state,reason:evidence.reason,evidence_digest:evidence.digest};
      events.push(event);operations.set(op.id,{op,command,allocation:ctx?.b??null,event});
      if(!['qualified','excluded'].includes(event.state))issue(event.state,event.reason,event);
    }
    for(const effect of effects)if(!operations.has(effect.operation_id)){
      let body:Row;try{body=JSON.parse(effect.body);scoped(body,s,c.customer_id,source.identity);}catch(error){preserveAuthority(error);body={};}
      issue('pending','LOYALTY_SOURCE_OPERATION_NOT_IMPORTED',effect);proofs.push(contentDigest(effect));
    }
    for(const capture of captures)if(!operations.has(capture.operation_id)){issue('pending','LOYALTY_SOURCE_CAPTURE_NOT_IMPORTED',capture);proofs.push(contentDigest(capture));}
  }
  for(const n of nodes)if(n.financial_operation_id){const op=operations.get(n.financial_operation_id);if(!op)issue('pending','LOYALTY_LINEAGE_FINANCIAL_OPERATION_REQUIRED',n);
    else if(op.op.resource_id!==n.parent_resource_id||!op.allocation||!same(n.consumed_units,op.allocation.units.map((unit_index:number)=>({line_id:op.allocation.line_id,unit_index})))||op.op.currency!==n.currency||(n.additional_paid_minor!=='0'?op.op.kind!=='additional_payment'||op.op.amount_minor!==n.additional_paid_minor:op.op.kind!==n.terminal_outflow_kind||op.op.amount_minor!==n.terminal_outflow_minor))issue('discrepant','LOYALTY_LINEAGE_FINANCIAL_BINDING_CHANGED',n);}
  for(const resource of [...resources].sort()){
    const parent=parents.get(resource)!;if(!parent.trusted)continue;const order=k.get(scope,resource),f=order.payload.resolution_facts;
    if(!f){issue('pending','LOYALTY_PAID_ALLOCATIONS_REQUIRED',{resource});continue;}
    const own=[...operations.values()].filter(record=>record.op.resource_id===resource),qualified=own.filter(record=>record.event.state==='qualified');
    const refunded=qualified.filter(record=>record.op.kind==='refund').reduce((sum,record)=>sum+minor(record.op.amount_minor),0n);
    const attributed=(line:string,unit:number)=>qualified.some(record=>record.op.kind==='refund'&&record.allocation.line_id===line&&record.allocation.units.includes(unit))||nodes.some(n=>n.parent_resource_id===resource&&n.consumed_units.some((u:Row)=>u.line_id===line&&u.unit_index===unit));
    const unaccounted=minor(f.prior_refunded_minor)>0n&&minor(f.prior_refunded_minor)!==refunded||f.accounted_operations.some((operation:string)=>!qualified.some(record=>record.op.id===operation))||f.paid_lines.some((line:Row)=>line.resolved_units.some((unit:number)=>!attributed(line.id,unit)));
    if(unaccounted){if(resource===c.resource_id){const higher=['discrepant','unsupported'].find(state=>issues.some(issue=>issue.state===state));events.sort((a,b)=>a.operation_id.localeCompare(b.operation_id));fail(higher??'pending',higher?issues.find(issue=>issue.state===higher)!.reason:'LOYALTY_CURRENT_EVENT_ATTRIBUTION_REQUIRED',{events,evidence_digest:contentDigest({facts:f,issues,events,proofs})});}issue('pending','LOYALTY_CURRENT_EVENT_ATTRIBUTION_REQUIRED',f);}
    const editRows=bounded(k.db.prepare('SELECT * FROM commerce_order_edits WHERE tenant_id=? AND store_id=? AND resource_id=? LIMIT 1001').all(s.tenant_id,s.store_id,resource) as Row[]);
    if(order.payload.order_edit_observation||editRows.length)issue('pending','LOYALTY_ORDER_EDIT_REQUALIFICATION_REQUIRED',{observation:order.payload.order_edit_observation??null,edits:editRows});
    for(const table of ['commerce_dispute_packets','commerce_claim_submissions']){
      const rows=bounded(k.db.prepare(`SELECT * FROM ${table} WHERE tenant_id=? AND store_id=? AND resource_id=?${table==='commerce_claim_submissions'?" AND kind='dispute'":''} LIMIT 1001`).all(s.tenant_id,s.store_id,resource) as Row[]);
      for(const row of rows){if(row.customer_id!==c.customer_id)throw new LoyaltyAccrualScopeError();try{checkedBody(row);issue('pending','LOYALTY_DISPUTE_REQUALIFICATION_REQUIRED',row);}catch{issue('discrepant','LOYALTY_DISPUTE_EVIDENCE_CHANGED',row);}}
    }
    const snapshots=bounded(k.db.prepare('SELECT * FROM commerce_native_change_snapshots WHERE tenant_id=? AND store_id=? AND resource_id=? LIMIT 1001').all(s.tenant_id,s.store_id,resource) as Row[]),settingsRow=k.db.prepare('SELECT * FROM commerce_native_change_settings WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row|undefined;
    try{
      const settings=settingsRow?checkedBody(settingsRow):null;if(settingsRow)proofs.push({revision:settingsRow.revision,digest:settingsRow.digest});
      if(settings?.enabled&&(!snapshots.length||settings.expires_at<=k.clock()))issue('pending','LOYALTY_EXTERNAL_REFRESH_REQUIRED',{resource,settings});
      for(const row of snapshots){const b=checkedBody(row);integrity(b.resource_id===resource&&b.source_version===row.source_version&&b.observed_at===row.observed_at&&b.currency===facts.currency&&b.payment_id===f.payment_id);
        const stale=!settings?.enabled||settings.source_identity!==row.source_identity||b.observed_at>k.clock()||k.clock()-b.observed_at>=settings.max_age_ms;
        const unknownRefund=minor(b.base_refunded_minor)>0n||b.refunds.some((r:Row)=>!qualified.some(record=>record.op.id===r.operation_id&&record.op.native_id===r.id&&record.op.kind==='refund'&&record.op.currency===r.currency&&record.op.amount_minor===r.amount_minor&&r.state==='settled'));
        const unknownReplacement=b.replacements.some((r:Row)=>!nodes.some(n=>n.parent_resource_id===resource&&n.replacement_id===r.id&&n.consumed_units.every((u:Row)=>u.line_id===r.line_id&&r.units.includes(u.unit_index))));
        if(stale||!b.exists||b.conflicts.length||unknownRefund||unknownReplacement||b.completed_units.some((u:Row)=>!attributed(u.line_id,u.unit_index)))issue('pending','LOYALTY_EXTERNAL_EVENT_ATTRIBUTION_REQUIRED',row);proofs.push(row.digest);
      }
      const completed=bounded(k.db.prepare('SELECT * FROM commerce_native_completed_units WHERE tenant_id=? AND store_id=? AND resource_id=? LIMIT 1001').all(s.tenant_id,s.store_id,resource) as Row[]);
      for(const row of completed)if(!snapshots.some(snapshot=>snapshot.request_id===row.request_id)||!attributed(row.line_id,row.unit_index))issue('pending','LOYALTY_EXTERNAL_UNIT_ATTRIBUTION_REQUIRED',row);
    }catch(error){preserveAuthority(error);issue('discrepant','LOYALTY_EXTERNAL_EVIDENCE_CHANGED',{resource,snapshots,settings:settingsRow??null});}
  }
  events.sort((a,b)=>a.operation_id.localeCompare(b.operation_id));issues.sort((a,b)=>(a.state+':'+a.reason+':'+a.digest).localeCompare(b.state+':'+b.reason+':'+b.digest));
  return {units,events,issues,evidence_digest:contentDigest({proofs,issues,events})};
}
