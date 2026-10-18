import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {policyPackFixture} from './return-policy-pack-helpers.mts';
import {WooReturnFixtureSource,WooReturnSources} from '../../packages/adapters/woocommerce/return-source.mts';
import {CustomerAccess} from '../../packages/commerce/customer-access.mts';
import {ReturnIntake} from '../../packages/commerce/return-intake.mts';

export function wooSourceFixtureInput(now:number){const date=(at:number)=>new Date(at).toISOString().slice(0,19);
 const paid={id:'71',product_id:'woo_product_170',variant_id:'woo_variant_171',quantity:2,gross_minor:'2000',discount_minor:'0',tax_minor:'0',shipping_minor:'0',duties_minor:'0',resolved_units:[]};
 return {revision:1,observed_at:now,order:{id:17,number:'W-17',status:'completed',currency:'USD',version:'rifare-fixture-1',date_modified_gmt:date(now),date_paid_gmt:date(now-4*86400000),customer_id:7,total:'20.00',payment_method:'rifare_fixture_gateway',transaction_id:'woo_txn_17',
  line_items:[{id:71,name:'Fixture shirt',product_id:170,variation_id:171,quantity:2,subtotal:'20.00',total:'20.00',total_tax:'0.00'}],refunds:[]},refunds:[],
  fulfillment:{contract:'rifare-woo-fulfillment-fixture-v1',complete:true,delivered_at:now-3*86400000,tags:[],lines:[{line_id:'71',fulfilled:2,returned:0,tags:[]}]},
  resolution_facts:{revision:1,observed_at:now,currency:'USD',payment_id:'woo_payment_17',original_paid_minor:'2000',prior_refunded_minor:'0',accounted_operations:[],paid_lines:[paid],
   instrument_allocations:{rule:'original_unit_proportional_v1',instruments:[{id:'woo_card_17',type:'card',original_paid_minor:'2000',prior_refunded_minor:'0',supported:true}],units:[1,2].map(unit_index=>({line_id:'71',unit_index,amounts:[{instrument_id:'woo_card_17',amount_minor:'1000'}]}))}},
  financial_contract:{gateway_id:'rifare_fixture_gateway',gateway_account_id:'woo_gateway_account',payment_id:'woo_payment_17',transaction_id:'woo_txn_17',currency:'USD',original_paid_minor:'2000',prior_refunded_minor:'0',instrument_id:'woo_card_17',history_complete:true}};
}
export function wooReturnFixture(){
 const f=policyPackFixture(),sourceDb=new DatabaseSync(join(f.directory,'woo-native.sqlite'));
 const source=new WooReturnFixtureSource(sourceDb,{mode:'fixture',identity:'woo_return_fixture',tenant:f.a.tenant,store:f.a.store,account_id:'woo_store_account',origin:'https://woo.example.invalid'},f.now);
 const initial=wooSourceFixtureInput(f.now());source.seed(initial);const woo=new WooReturnSources(f.kernel,source),binding=woo.bind(f.a.scope,{native_order_id:'17',expected_revision:0});
 f.kernel.ingest(f.a.scope,{kind:'customer',source_system:'woocommerce',external_id:'woo_customer_7',source_version:1,source_updated_at:f.now(),customer_id:null,payload:{email:'woo-shopper@example.invalid'}});
 const deliveries:any[]=[],customers=new CustomerAccess(f.kernel,p=>deliveries.push(p)),challenge=customers.request({store_id:f.a.store,order_number:'17',email:'woo-shopper@example.invalid'},'127.0.0.7');
 const verified=customers.complete({store_id:f.a.store,challenge_id:challenge.challenge_id,proof:deliveries.at(-1).proof}),customer=f.kernel.authenticate(verified.token);
 const caseId='woo_case',intake=new ReturnIntake(f.kernel);f.cases.create(customer,{case_id:caseId,resource_id:binding.resource_id,profile_id:'pack_profile',policy_id:'pack_policy'});
 const selection=(extra:any={})=>({case_id:caseId,lines:[{line_id:'71',quantity:1}],outcome:'refund',reason:'size',note:'',evidence_ids:[],...extra});
 const quote=(extra:any={},scope=customer)=>intake.evaluate(scope,selection(extra));
 const prepare=(q=quote(),requestKey='woo-request',scope=customer)=>intake.prepare(scope,{quote_id:q.id,quote_digest:q.digest,request_key:requestKey,override_id:null});
 const submit=(p=prepare())=>{const approval=f.gateway.approve(f.reviewer.scope,{preview_id:p.preview_id,preview_digest:p.preview_digest});return f.gateway.execute(f.a.scope,{preview_id:p.preview_id,preview_digest:p.preview_digest,approval_id:approval.id});};
 const order=()=>f.kernel.get(f.a.scope,binding.resource_id);
 const publish=(change:(input:any)=>void=()=>{})=>{const current=structuredClone(source.snapshot('17').input);current.revision++;current.observed_at=f.now();current.resolution_facts.revision=current.revision;current.resolution_facts.observed_at=f.now();current.order.date_modified_gmt=new Date(f.now()).toISOString().slice(0,19);change(current);source.seed(current);return current;};
 return {...f,source,sourceDb,woo,binding,initial,intake,customers,customer,customerBearer:verified.token,caseId,selection,quote,prepare,submit,order,publish,
  cleanup:()=>{sourceDb.close();f.cleanup();}};
}
export async function usingWooReturns(fn:(f:ReturnType<typeof wooReturnFixture>)=>unknown){const f=wooReturnFixture();try{return await fn(f);}finally{f.cleanup();}}
