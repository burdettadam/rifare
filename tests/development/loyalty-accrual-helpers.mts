import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {returnFixture} from './return-intake-helpers.mts';
import {configureFinance} from './exchange-finance-helpers.mts';
import {ResolutionLedger} from '../../packages/commerce/resolution-ledger.mts';
import {RefundQuotes} from '../../packages/commerce/refund-quotes.mts';
import {ResolutionExecution} from '../../packages/commerce/resolution-execution.mts';
import {VariantExchanges} from '../../packages/commerce/variant-exchanges.mts';
import {ExchangeFinance} from '../../packages/commerce/exchange-finance.mts';
import {ResolutionFixtureSource} from '../../packages/adapters/resolution-fixture-source.mts';
import {FulfillmentFixtureSource} from '../../packages/adapters/fulfillment-fixture-source.mts';
import {FulfillmentConfiguration} from '../../packages/commerce/return-fulfillment-core.mts';
import {ReplacementInventory} from '../../packages/commerce/replacement-inventory.mts';
import {ReplacementOrders} from '../../packages/commerce/replacement-orders.mts';
import {FulfillmentExecution} from '../../packages/commerce/fulfillment-execution.mts';
import {ExchangeLineageFixtureSource} from '../../packages/adapters/exchange-lineage-fixture-source.mts';
import {ExchangeLineage} from '../../packages/commerce/exchange-lineage.mts';
import {CustomerAccess} from '../../packages/commerce/customer-access.mts';
import {NativeReturns} from '../../packages/commerce/native-returns.mts';
import {ShopifyReturnFixtureAdapter} from '../../packages/adapters/shopify-return-fixture.mts';
import {SupportConversations} from '../../packages/commerce/support-conversations.mts';
import {SupportOwnership} from '../../packages/commerce/support-core.mts';
import {LoyaltyFixtureSource} from '../../packages/adapters/loyalty-fixture-source.mts';
import {LoyaltyAccrualFixtureSource} from '../../packages/adapters/loyalty-accrual-fixture-source.mts';
import {LoyaltyBalances} from '../../packages/commerce/loyalty-balances.mts';
import {LoyaltyAccrual} from '../../packages/commerce/loyalty-accrual.mts';
import {canonical,contentDigest} from '../../packages/commerce/configuration-values.mts';

export type Value=Record<string,any>;
export const oracle=JSON.parse(readFileSync(new URL('../fixtures/loyalty-accrual/independent-values.json',import.meta.url),'utf8'));
export const OUTPUT_FIELDS=['schema_version','case_id','resource_id','status','reason','context_digest','source_revision','rule_revision','rule_digest','units','events','proposals','totals','model_required','execution_authorized','enrollment_authorized','send_authorized','monetary_conversion_supported','production_qualified','projection_digest'].sort();
export const UNIT_FIELDS=['original_line_id','unit_index','original_paid_minor','additional_paid_minor','settled_refund_minor','earned_points','reversal_points','net_points'].sort();
export const EVENT_FIELDS=['operation_id','kind','amount_minor','original_line_id','unit_index','state','reason','evidence_digest'].sort();
export const PROPOSAL_FIELDS=['id','kind','original_line_id','unit_index','points','eligible','rule_revision','operation_ids'].sort();
export const ruleInput=(patch:Value={})=>({...oracle.rules,...patch});
export function balanceInput(f:any,patch:Value={}) {
  return {customer_id:'C-1001',source_revision:1,observed_at:f.now(),expires_at:f.now()+300000,complete:true,
    balances:{unit:'points',pending:900,earned:1000,reserved:150,redeemed:200,reversed:50,available:600},
    rules:{revision:1,unit:'points',minimum_redemption:100,maximum_redemption:800,redemption_step:50,expires_at:f.now()+600000},...patch};
}
type Options={provider?:'full'|'limited';pin?:boolean;rules?:Value;zero?:boolean;fees?:boolean;components?:boolean;prior?:boolean;multiAlpha?:boolean;multiGamma?:boolean};

// This fixture builds two original paid lines before preparing any native return.
// It uses the existing native financial, fulfillment, approval and customer owners.
export async function accrualFixture(options:Options={}) {
  const f=returnFixture(),opened:DatabaseSync[]=[];
  const open=(name:string)=>{const db=new DatabaseSync(join(f.directory,name));opened.push(db);return db;};
  try {
    f.intake.configure(f.owner.scope,{expected_revision:1,settings:{...f.settings,restocking_bps:options.fees?1000:0,shipping_minor:'0'}});
    f.advance(1);f.publish({expected_version:1,rules:{window_days:30,require_evidence:false,excluded_tags:['final-sale'],outcomes:['refund','exchange','store_credit']}});
    const paidLines=structuredClone(oracle.paid_lines);
    if(options.components)Object.assign(paidLines[0],{gross_minor:'1800',discount_minor:'200',tax_minor:'200',shipping_minor:'100',duties_minor:'100'});
    if(options.zero)Object.assign(paidLines[1],{gross_minor:'1500',discount_minor:'1500'});
    if(options.multiGamma)Object.assign(paidLines[1],{quantity:2,gross_minor:'2400',discount_minor:'400'});
    if(options.prior)paidLines[0].resolved_units=[1];
    const facts:Value={revision:1,observed_at:f.now(),currency:'USD',payment_id:'payment-loyalty-original',
      original_paid_minor:options.zero?'2000':options.multiGamma?'4000':'3000',prior_refunded_minor:options.prior?'1000':'0',accounted_operations:[],paid_lines:paidLines};
    const lines=[{id:'alpha',fulfillment_line_id:'gid://shopify/FulfillmentLineItem/101',ordered:2,fulfilled:2,returned:options.prior?1:0,unit_minor:options.components?'800':'1000',tags:[]},
      {id:'gamma',fulfillment_line_id:'gid://shopify/FulfillmentLineItem/102',ordered:options.multiGamma?2:1,fulfilled:options.multiGamma?2:1,returned:0,unit_minor:options.zero?'0':'1000',tags:[]}];
    if(options.zero)facts.bundle_allocations={treatment:'preserve_original_paid',promotion_rule:'retain_remaining_components',groups:[{id:'loyalty_free_gift',promotion_id:'original_free_gift',original_paid_minor:'0',components:[{line_id:'gamma',fulfillment_line_id:lines[1].fulfillment_line_id,paid_minor:'0',retail_minor:'1500',promotion_role:'zero_price_gift'}]}]};
    const update=(changes:Value={})=>{const old=f.order();return f.kernel.ingest(f.a.scope,{kind:'order',source_system:'synthetic',external_id:old.external_id,source_version:old.source_version+1,source_updated_at:f.now(),customer_id:old.customer_id,payload:{...old.payload,...changes}});};
    update({return_lines:lines,total_minor:facts.original_paid_minor,resolution_facts:facts});
    f.cases.create(f.customer,{case_id:'loyalty_case',resource_id:f.order().id,profile_id:'default',policy_id:'returns'});
    let sequence=0;
    const nativeReturn=async(request:any,n:number)=>{
      const adapter=new ShopifyReturnFixtureAdapter({mode:'fixture',identity:'loyalty-native-return-'+n,tenant:f.a.tenant,store:f.a.store,transport:async({variables})=>{
        const returned={id:'gid://shopify/Return/'+(10000+n),status:'OPEN',order:{id:variables.returnInput.orderId},
          returnLineItems:{nodes:variables.returnInput.returnLineItems.map((line:any,index:number)=>({id:'gid://shopify/ReturnLineItem/'+(20000+n*10+index),quantity:line.quantity,returnReasonNote:line.returnReasonNote,fulfillmentLineItem:{id:line.fulfillmentLineItemId}})),pageInfo:{hasNextPage:false}},
          reverseFulfillmentOrders:{nodes:[{id:'gid://shopify/ReverseFulfillmentOrder/'+(30000+n)}],pageInfo:{hasNextPage:false}}};
        return {status:200,api_version:'2026-10',body:{data:{returnCreate:{userErrors:[],return:returned}}}};
      }});
      return new NativeReturns(f.kernel,adapter).create(f.a.scope,request.id);
    };
    const intake=f.intake.evaluate(f.customer,{case_id:'loyalty_case',lines:[{line_id:'alpha',quantity:options.multiAlpha?2:1},{line_id:'gamma',quantity:options.multiGamma?2:1}],outcome:'refund',reason:'size',note:'',evidence_ids:[]});
    const request=f.intake.prepare(f.customer,{quote_id:intake.id,quote_digest:intake.digest,request_key:'loyalty_original_return',override_id:null});
    f.submit(request);await nativeReturn(request,++sequence);
    const financeFilename=join(f.directory,'loyalty-finance.sqlite'),financeDb=open('loyalty-finance.sqlite'),financeSource=new ResolutionFixtureSource(financeDb,{mode:'fixture',identity:'loyalty-finance',tenant:f.a.tenant,store:f.a.store},f.now);
    financeSource.seed({resource_id:f.order().id,customer_id:f.order().customer_id,payment_id:facts.payment_id,currency:'USD',available_minor:options.prior?'2000':facts.original_paid_minor});
    const ledger=new ResolutionLedger(f.kernel),quotes=new RefundQuotes(f.kernel),financeOwner=new ResolutionExecution(f.kernel,financeSource),exchanges=new VariantExchanges(f.kernel),exchangeFinance=new ExchangeFinance(f.kernel);
    ledger.configure(f.owner.scope,{expected_revision:0,enabled:true,source_identity:financeSource.identity,credit_instrument:'native_store_credit',expires_at:f.now()+3600000,inventory_buffer:2,...(options.zero?{bundle_policy:'preserve_original_paid'}:{})});
    configureFinance({...f,exchanges});
    const fulfillmentFilename=join(f.directory,'loyalty-fulfillment.sqlite'),fulfillmentDb=open('loyalty-fulfillment.sqlite'),fulfillmentSource=new FulfillmentFixtureSource(fulfillmentDb,{mode:'fixture',tenant:f.a.tenant,store:f.a.store,identity:'loyalty-fulfillment',clock:f.now,finance_source:financeSource});
    new FulfillmentConfiguration(f.kernel).configure(f.owner.scope,{expected_revision:0,enabled:true,source_identity:fulfillmentSource.identity,account_id:'loyalty_warehouse',expires_at:f.now()+3600000,resolution_trigger:'manual'});
    const lineageSource=new ExchangeLineageFixtureSource(financeSource,fulfillmentSource);
    lineageSource.seedOriginal({resource_id:f.order().id,customer_id:f.order().customer_id,payment_id:facts.payment_id,currency:'USD',native_order_id:f.order().payload.native_order_id,
      original_paid_minor:facts.original_paid_minor,prior_refunded_minor:facts.prior_refunded_minor,paid_lines:paidLines,...(facts.bundle_allocations?{bundle_allocations:facts.bundle_allocations}:{})});
    const lineage=new ExchangeLineage(f.kernel,lineageSource),inventory=new ReplacementInventory(f.kernel,fulfillmentSource),orders=new ReplacementOrders(f.kernel),fulfillment=new FulfillmentExecution(f.kernel,fulfillmentSource);
    const plan=ledger.allocate(f.a.scope,{request_id:request.id,request_key:'loyalty_original_allocation',lines:[
      {line_id:'alpha',units:options.multiAlpha?[1,2]:[options.prior?2:1],outcome:'refund'},
      {line_id:'gamma',units:options.multiGamma?[1,2]:[1],outcome:'exchange'}]});
    const alpha=plan.allocations.find((a:any)=>a.line_id==='alpha')!,gamma=plan.allocations.find((a:any)=>a.line_id==='gamma')!;
    const authorize=(q:any)=>{const preview=f.gateway.prepare(f.a.scope,q.proposal),approval=f.gateway.approve(f.reviewer.scope,{preview_id:preview.id,preview_digest:preview.digest}),receipt=f.gateway.execute(f.a.scope,{preview_id:preview.id,preview_digest:preview.digest,approval_id:approval.id});return {preview,approval,receipt,id:receipt.resolution_operation_id};};
    const prepareExchange=(allocation:any,price:string)=>{const n=++sequence,catalog=f.kernel.ingest(f.a.scope,{kind:'catalog',source_system:'synthetic',external_id:'loyalty_catalog_'+n,source_version:1,source_updated_at:f.now(),customer_id:null,
      payload:{variant_id:'loyalty_variant_'+n,product_id:'shoe',currency:'USD',unit_price_minor:price,tax_per_unit_minor:'0',shipping_minor:'0',duties_per_unit_minor:'0',available:10,discount_eligible:true,promotion_expires_at:f.now()+60000,excluded:false}});
      fulfillmentSource.seedStock({catalog_id:catalog.id,variant_id:catalog.payload.variant_id,location_id:'warehouse_one',version:1,available:10});
      return {n,catalog,q:exchanges.quote(f.a.scope,{allocation_id:allocation.id,catalog_id:catalog.id})};};
    const exchangeOperation=(q:any,outcome?:string)=>authorize(exchangeFinance.quote(f.a.scope,{exchange_quote_id:q.id,exchange_quote_digest:q.digest,outcome:outcome??(BigInt(q.quote.balance_minor)>0n?'additional_payment':'refund')}));
    const makeExchange=async(allocation:any,price:string,opts:{deliver?:boolean;outcome?:string}={})=>{
      const p=prepareExchange(allocation,price);let financial:any=null;
      if(p.q.quote.balance_minor!=='0'){
        financial=exchangeOperation(p.q,opts.outcome);await financeOwner.dispatch(f.a.scope,financial.id);
        if(BigInt(p.q.quote.balance_minor)>0n)financeSource.settlePayment(financial.id);else if(opts.outcome!=='store_credit')financeSource.settle(financial.id);
        await financeOwner.reconcile(f.a.scope,financial.id);
      }
      const reservation=inventory.reserve(f.a.scope,{quote_id:p.q.id,quote_digest:p.q.digest,location_id:'warehouse_one',ttl_ms:50000}),fq=orders.quote(f.a.scope,{reservation_id:reservation.id}),preview=f.gateway.prepare(f.a.scope,fq.proposal),approval=f.gateway.approve(f.reviewer.scope,{preview_id:preview.id,preview_digest:preview.digest}),receipt=f.gateway.execute(f.a.scope,{preview_id:preview.id,preview_digest:preview.digest,approval_id:approval.id}),operation={id:receipt.fulfillment_operation_id};
      const result=await fulfillment.dispatch(f.a.scope,operation.id);
      if(result.state==='created'&&opts.deliver!==false){fulfillmentSource.fulfillReplacement(result.replacement.id,'loyalty_shipment_'+p.n);fulfillmentSource.deliverReplacement(result.replacement.id,{event_id:'loyalty_delivery_'+p.n,delivered_at:f.now()});await fulfillment.reconcile(f.a.scope,operation.id);}
      return {...p,financial,operation,result};
    };
    const openChild=async(node:any,outcome='exchange')=>{
      const n=++sequence,order=f.kernel.get(f.a.scope,node.resource_id),proofs:any[]=[],access=new CustomerAccess(f.kernel,p=>proofs.push(p)),challenge=access.request({store_id:f.a.store,order_number:node.external_id,email:'shopper-apparel@example.invalid'},'loyalty_child_'+n),session=access.complete({store_id:f.a.store,challenge_id:challenge.challenge_id,proof:proofs.at(-1).proof}),customer=f.kernel.authenticate(session.token),caseId='loyalty_child_case_'+n;
      f.cases.create(customer,{case_id:caseId,resource_id:order.id,profile_id:'default',policy_id:'returns'});
      const q=f.intake.evaluate(customer,{case_id:caseId,lines:[{line_id:node.line_id,quantity:1}],outcome,reason:'size',note:'',evidence_ids:[]}),childRequest=f.intake.prepare(customer,{quote_id:q.id,quote_digest:q.digest,request_key:'loyalty_child_request_'+n,override_id:null});
      f.submit(childRequest);await nativeReturn(childRequest,n);
      const childPlan=ledger.allocate(f.a.scope,{request_id:childRequest.id,request_key:'loyalty_child_allocation_'+n,lines:[{line_id:node.line_id,units:[1],outcome}]});
      return {customer,bearer:session.token,caseId,request:childRequest,order,allocation:childPlan.allocations[0]};
    };
    const refundAlpha=async(settle=true)=>{const q=quotes.quote(f.a.scope,{allocation_id:alpha.id}),op=authorize(q);await financeOwner.dispatch(f.a.scope,op.id);if(settle){financeSource.settle(op.id);await financeOwner.reconcile(f.a.scope,op.id);}return {...op,q};};
    const journey=async(opts:{alphaSettled?:boolean;alphaFirst?:boolean}={})=>{
      let refund:any=null;if(opts.alphaFirst)refund=await refundAlpha(opts.alphaSettled!==false);
      const first=await makeExchange(gamma,'1400'),one=lineage.materialize(f.a.scope,{operation_id:first.operation.id}),child=await openChild(one.node),second=await makeExchange(child.allocation,'900'),two=lineage.materialize(f.a.scope,{operation_id:second.operation.id});
      if(!refund)refund=await refundAlpha(opts.alphaSettled!==false);return {first,one,child,second,two,refund};
    };
    const loyaltyFilename=join(f.directory,'loyalty-accrual.sqlite'),loyaltyDb=open('loyalty-accrual.sqlite'),balanceConfig={tenant_id:f.a.tenant,store_id:f.a.store,account_id:'loyalty_account',provider:options.provider??'full'},balanceSource=new LoyaltyFixtureSource(loyaltyDb,balanceConfig,f.now);
    balanceSource.publish(balanceInput(f));const balances=new LoyaltyBalances(f.kernel,balanceSource),accrualSource=new LoyaltyAccrualFixtureSource(balanceSource);
    accrualSource.publishRules(ruleInput(options.rules));
    const pinInput={resource_id:f.order().id,customer_id:f.order().customer_id,financial_source_identity:financeSource.identity,original_digest:lineageSource.parent(f.order().id).digest,rules_revision:1};
    if(options.pin!==false)accrualSource.pinOriginal(pinInput);
    const conversations=new SupportConversations(f.kernel),ownership=new SupportOwnership(f.kernel),link=conversations.link(f.a.scope,f.customer,{case_id:'loyalty_case',channel:'webchat',account_id:'loyalty_widget',external_id:'loyalty_original_thread',history:'unavailable',source_revision:1});
    const owners={balances,finance:financeOwner,lineage,accrual:accrualSource},projectionOwner=new LoyaltyAccrual(f.kernel,owners);
    return {...f,facts,paidLines,lines,request,update,financeFilename,financeDb,financeSource,financeOwner,ledger,quotes,exchanges,exchangeFinance,fulfillmentFilename,fulfillmentDb,fulfillmentSource,fulfillment,lineageSource,lineage,inventory,orders,plan,alpha,gamma,authorize,prepareExchange,exchangeOperation,makeExchange,openChild,refundAlpha,journey,
      loyaltyFilename,loyaltyDb,balanceConfig,balanceSource,balances,accrualSource,pinInput,conversations,ownership,link,owners,projectionOwner,
      cleanup:()=>{for(const db of opened.reverse())db.close();f.cleanup();}};
  }catch(error){for(const db of opened.reverse())db.close();f.cleanup();throw error;}
}
export async function usingAccrual(fn:(f:Awaited<ReturnType<typeof accrualFixture>>)=>unknown,options:Options={}) {
  const f=await accrualFixture(options);try{return await fn(f);}finally{f.cleanup();}
}
export const projectInput=(f:any,patch:Value={})=>({case_id:'loyalty_case',link_id:f.link.id,expected_generation:1,...patch});
export const project=(f:any,patch:Value={},scope=f.a.scope,proof=f.customer)=>f.projectionOwner.project(scope,proof,projectInput(f,patch));
export function tableRows(db:DatabaseSync,table:string) {return db.prepare('SELECT * FROM "'+table.replaceAll('"','""')+'"').all() as Value[];}
export function databaseState(db:DatabaseSync,omitSessions=false) {
  const names=(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Value[]).map(r=>r.name).filter(n=>!omitSessions||n!=='commerce_sessions');
  return Object.fromEntries(names.map(name=>[name,tableRows(db,name).map(row=>canonical(row)).sort()]));
}
export function sourceEffect(f:any,id:string) {return f.financeDb.prepare('SELECT * FROM fixture_resolution_effects WHERE operation_id=?').get(id) as Value;}
export function alterEffect(f:any,row:Value,patch:(body:Value)=>void) {const body=JSON.parse(row.body);patch(body);f.financeDb.prepare('UPDATE fixture_resolution_effects SET body=? WHERE operation_id=?').run(canonical(body),row.operation_id);}
export function restoreEffect(f:any,row:Value) {f.financeDb.prepare('UPDATE fixture_resolution_effects SET body=? WHERE operation_id=?').run(row.body,row.operation_id);}
export function proposalsByUnit(view:Value) {return [...view.proposals].sort((a,b)=>(a.original_line_id+':'+a.unit_index+':'+a.kind).localeCompare(b.original_line_id+':'+b.unit_index+':'+b.kind));}
export function appendTerminal(f:any,op:string,patch:(body:Value)=>void) {
  const row=f.db.prepare("SELECT * FROM commerce_resolution_observations WHERE operation_id=? AND stage='settled' ORDER BY seq DESC LIMIT 1").get(op) as Value,body=JSON.parse(row.body);patch(body);
  f.db.prepare('INSERT INTO commerce_resolution_observations(tenant_id,store_id,operation_id,resource_id,stage,body,digest,observed_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(row.tenant_id,row.store_id,row.operation_id,row.resource_id,row.stage,canonical(body),contentDigest(body),f.now());
}
