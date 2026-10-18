import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,readFileSync,writeFileSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { usingEdits } from './order-edit-helpers.mts';
import { supportFixture } from './support-helpers.mts';
import { SupportDelivery } from '../../packages/commerce/support-delivery.mts';
import { CheckoutExperiments } from '../../packages/commerce/checkout-experiments.mts';
import { GrowthMeasurement } from '../../packages/commerce/growth-measurement.mts';
import { MarketingSegments } from '../../packages/commerce/marketing-segments.mts';
import { GrowthCampaigns } from '../../packages/commerce/growth-campaigns.mts';
import { CartRecovery } from '../../packages/commerce/cart-recovery.mts';
import { EmailActionLinks,emailActionHandler } from '../../packages/commerce/email-action-links.mts';
import { MarketingFixtureSource } from '../../packages/adapters/marketing-fixture-source.mts';
import type { Row } from '../../packages/commerce/kernel.mts';

export const marketingOracle=JSON.parse(readFileSync(new URL('../fixtures/growth-marketing/known-answer.v1.json',import.meta.url),'utf8'));
export function marketingFixture(){
  const f=supportFixture(),marketingDb=new DatabaseSync(join(f.directory,'marketing-source.sqlite'));
  try {
    const marketingSource=new MarketingFixtureSource(marketingDb,{tenant:f.a.tenant,store:f.a.store,account:f.source.account},f.now);
    marketingSource.configure({revision:1,brand:'Rifare synthetic merchant',headlines:{welcome:'A merchant offer',reminder:'Your cart is ready'},bodies:{plain:'Review the current terms in your account.'},offers:{'offer-five':{text:'Five dollars off an eligible purchase.',currency:'USD',discount_minor:'500',catalog_ref:'synthetic-approved-offer'}},expires_at:f.now()+120000});
    const experiments=new CheckoutExperiments(f.kernel,()=>marketingOracle.assignment_seed_hex),measurement=new GrowthMeasurement(f.kernel,experiments,marketingSource),segments=new MarketingSegments(f.kernel,marketingSource),campaigns=new GrowthCampaigns(f.kernel,segments,experiments),delivery=new SupportDelivery(f.kernel,f.tracking,[f.source],null,campaigns);
    const first={case_id:'case_one',resource_id:f.order().id,customer_id:f.order().customer_id,customer:f.customer,link:f.link};
    const members:Row[]=[first];
    function seedMember(m:Row,extras:Row={}){marketingSource.seedMember({tenant_id:f.a.tenant,store_id:f.a.store,case_id:m.case_id,resource_id:m.resource_id,customer_id:m.customer_id,country:'US_TEST',tags:['growth'],spend_minor:'10000',available_fields:['country','tags','spend_minor'],...extras});}
    seedMember(first);
    function shopper(n:number,extras:Row={}){
      const external='GROWTH-C-'+n,address='growth-'+n+'@example.invalid',original=f.order();
      f.kernel.ingest(f.a.scope,{kind:'customer',source_system:'synthetic',external_id:external,source_version:1,source_updated_at:f.now(),customer_id:null,payload:{email:address}});
      const order=f.kernel.ingest(f.a.scope,{kind:'order',source_system:'synthetic',external_id:'GROWTH-O-'+n,source_version:1,source_updated_at:f.now(),customer_id:external,payload:{...original.payload,marketing_eligibility:{eligible:true,bot:false},...extras}});
      let proof:Row|undefined;
      // Use the same actual proof boundary; a known fixture inbox is not a bearer shortcut.
      const {CustomerAccess}=customerAccessModule;
      const access=new CustomerAccess(f.kernel,(value:Row)=>{proof=value;});
      const challenge=access.request({store_id:f.a.store,order_number:order.external_id,email:address},'growth-fixture-'+n);
      const verified=access.complete({store_id:f.a.store,challenge_id:challenge.challenge_id,proof:proof!.proof}),customer=f.kernel.authenticate(verified.token),case_id='growth_case_'+n;
      f.cases.create(customer,{case_id,resource_id:order.id,profile_id:'default',policy_id:'returns'});
      const link=f.conversations.link(f.a.scope,customer,{case_id,channel:'email',account_id:f.source.account,external_id:'growth_thread_'+n,history:'partial',source_revision:1});
      f.consent.verifyContact(f.a.scope,customer,{link_id:link.id,address});
      const m={case_id,resource_id:order.id,customer_id:external,customer,link};members.push(m);seedMember(m);return m;
    }
    const original=f.order();f.kernel.ingest(f.a.scope,{kind:'order',source_system:'synthetic',external_id:original.external_id,source_version:original.source_version+1,source_updated_at:f.now(),customer_id:original.customer_id,payload:{...original.payload,marketing_eligibility:{eligible:true,bot:false}}});
    const experiment=(extras:Row={})=>({experiment_id:'checkout-one',version:1,starts_at:f.now(),ends_at:f.now()+1000,attribution_window_ms:1000,followup_through_at:f.now()+2000,currency:'USD',variants:[{id:'treatment',weight:5000},{id:'holdout',weight:5000}],members:members.map(m=>m.case_id),...extras});
    const enroll=()=>{if(members.length===1){shopper(2);shopper(3);shopper(5);}return experiments.configure(f.owner.scope,experiment());};
    const definition=(extras:Row={})=>({segment_id:'segment-one',expected_revision:0,definition:{country:'US_TEST',required_tag:'growth',minimum_spend_minor:'0',required_fields:['country','tags','spend_minor']},template:{headline_key:'welcome',body_key:'plain',offer_id:'offer-five'},...extras});
    function segment(){try{return segments.read(f.a.scope,'segment-one');}catch{const d=segments.define(f.a.scope,definition());segments.approve(f.reviewer.scope,{segment_id:d.id,expected_digest:d.digest,expires_at:f.now()+60000});return segments.read(f.a.scope,d.id);}}
    const draftInput=(extras:Row={})=>({campaign_id:'campaign-one',expected_revision:0,segment_id:'segment-one',headline_key:'welcome',body_key:'plain',offer_id:'offer-five',sender_id:'sender_one',starts_at:f.now(),ends_at:extras.experiment_id?experiments.inspect(f.a.scope,extras.experiment_id).ends_at:f.now()+60000,budget_minor:'12',unit_cost_minor:'3',experiment_id:null,recovery_after_ms:null,...extras});
    function draft(extras:Row={}){segment();return campaigns.draft(f.a.scope,draftInput(extras));}
    function ready(extras:Row={}){const d=draft(extras);campaigns.approve(f.reviewer.scope,{campaign_id:d.id,expected_digest:d.digest,expires_at:d.body.ends_at});campaigns.schedule(f.a.scope,d.id);return d;}
    function grant(m=first,state='granted',version=1){return f.consent.record(m.customer,{case_id:m.case_id,sender_id:'sender_one',channel:'email',purpose:'marketing',state,event_id:'growth_consent_'+m.case_id+'_'+version,source_version:version,effective_at:f.now(),source_ref:'verified_customer_click'});}
    const queue=(m=first,campaign_id='campaign-one')=>delivery.queueCampaign(f.a.scope,{campaign_id,case_id:m.case_id,link_id:m.link.id,expected_generation:f.ownership.inspect(f.a.scope,m.case_id)!.generation});
    const event=(m:Row,extras:Row)=>marketingSource.observe({event_id:'event_'+m.case_id,resource_id:m.resource_id,customer_id:m.customer_id,kind:'purchase',purchase_id:'purchase_'+m.case_id,channel:'web',at:f.now(),amount_minor:'10000',category:null,through_at:null,complete:false,cost_coverage:null,...extras});
    function golden(contaminate=false,missingCosts=false){
      enroll();const began=f.now();for(const m of members.slice(0,2))experiments.expose(f.a.scope,{experiment_id:'checkout-one',case_id:m.case_id,channel:'email',offer_shown:true,event_id:'offer_'+m.case_id});
      if(contaminate)experiments.expose(f.a.scope,{experiment_id:'checkout-one',case_id:members[2].case_id,channel:'other_connected_fixture',offer_shown:true,event_id:'leak'});
      f.advance(100);const observations=[event(first,{event_id:'purchase_t'}),event(members[2],{event_id:'purchase_h'}),event(first,{event_id:'purchase_t_email',channel:'email'})];
      f.advance(1400);observations.push(event(first,{event_id:'refund_t',kind:'refund',at:f.now(),amount_minor:'3000'}),event(first,{event_id:'cost_t',kind:'cost',amount_minor:'2000',category:'goods'}),event(members[2],{event_id:'cost_h',kind:'cost',amount_minor:'1000',category:'goods'}));
      f.advance(500);for(const m of members)observations.push(event(m,{event_id:'coverage_'+m.case_id,kind:'coverage',purchase_id:null,amount_minor:'0',through_at:began+2000,complete:true,cost_coverage:{goods:m===first?(missingCosts?null:'2000'):m===members[2]?'1000':'0',shipping:'0',payment:'0',marketing:'0'}}));
      for(const observation of observations)measurement.importEvent(f.a.scope,'checkout-one',observation.event_id);
      return measurement.report(f.a.scope,'checkout-one');
    }
    return {...f,marketingDb,marketingSource,experiments,measurement,segments,campaigns,delivery,first,members,shopper,seedMember,experiment,enroll,definition,segment,draftInput,draft,ready,grant,queue,event,golden,cleanup:()=>{marketingDb.close();f.cleanup();}};
  }catch(error){marketingDb.close();f.cleanup();throw error;}
}
import * as customerAccessModule from '../../packages/commerce/customer-access.mts';
export async function usingMarketing(fn:(f:ReturnType<typeof marketingFixture>)=>unknown){const f=marketingFixture();try{return await fn(f);}finally{f.cleanup();}}

export async function withChangedModule(relative:string,marker:string,replacement:string,fn:(module:Row)=>Promise<void>|void){
  const url=new URL(relative,import.meta.url),source=readFileSync(url,'utf8');
  if(source.split(marker).length!==2)throw new Error('FAULT_MARKER_NOT_UNIQUE');
  const changed=source.replace(marker,replacement).replace(/from '(\.[^']+)'/g,(_m,path)=>"from '"+new URL(path,url).href+"'");
  const directory=mkdtempSync(join(tmpdir(),'rifare-growth-fault-'));
  try{const file=join(directory,'mutated.mts');writeFileSync(file,changed);await fn(await import(pathToFileURL(file).href));}
  finally{rmSync(directory,{recursive:true,force:true});}
}

export async function usingCancellation(fn:(f:Row)=>unknown){return usingEdits(async f=>{
  const q=f.quote({kind:'cancel',line_id:null,variant_id:null,address:null}),receipt=f.authorize(q),operation={id:receipt.order_edit_id},links=new EmailActionLinks(f.kernel,f.edits),issued=links.issue(f.a.scope,{edit_id:operation.id,expires_at:f.now()+60000}),handler=emailActionHandler(links);
  const request=(method:string,body:Row={},bearer=f.customerBearer)=>new Request('https://merchant.example.invalid/email-action?token='+issued.token,{method,headers:method==='POST'?{'content-type':'application/json',authorization:'Bearer '+bearer}:{},...(method==='POST'?{body:JSON.stringify(body)}:{})});
  const preview=links.preview(f.customer,issued.token);
  return fn({...f,operation,links,issued,handler,request,preview});
});}

/** Root uses this on the integrated shopping source; no parallel cart owner. */
export function attachMarketingRecovery(f:Row,carts:Row){const recovery=new CartRecovery(f.kernel,carts,f.campaigns);f.campaigns.attachRecovery(recovery);return recovery;}

/** Populates every marketing table except email links; use usingCancellation for
 * those against its existing approved cancellation. No private live data. */
export async function populateMarketingPrivacy(f:ReturnType<typeof marketingFixture>){
  const {installShoppingCart}=await import('./growth-shopping-helpers.mts');
  const shop=await installShoppingCart(f);
  try{
    f.enroll();f.experiments.expose(f.a.scope,{experiment_id:'checkout-one',case_id:'case_one',channel:'checkout',offer_shown:true,event_id:'privacy-exposure'});
    const event=f.event(f.first,{event_id:'privacy-purchase'});f.measurement.importEvent(f.a.scope,'checkout-one',event.event_id);
    const segment=f.segment();f.marketingSource.fault='after';
    await f.segments.sync(f.a.scope,{operation_id:'privacy-template-original',segment_id:segment.id,headline_key:'welcome',body_key:'plain',offer_id:'offer-five'});
    f.grant();const campaign=f.ready({recovery_after_ms:100}),recovery=attachMarketingRecovery(f,shop.carts);f.advance(101);
    const proposal=recovery.propose(f.a.scope,{cart_id:shop.cart_id,campaign_id:campaign.id}),queued=f.queue();f.source.fault='after';await f.delivery.dispatch(f.a.scope,queued.operation_id);
    return {shop,recovery,recovery_id:proposal.id,operation_id:queued.operation_id,sync_operation_id:'privacy-template-original',experiment_id:'checkout-one',campaign_id:campaign.id,resource_id:f.first.resource_id,customer_id:f.first.customer_id,denominators:{treatment:2,holdout:2},cleanup:()=>shop.cleanup()};
  }catch(error){shop.cleanup();throw error;}
}

