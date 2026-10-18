import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {wooRefundFixture} from './woocommerce-refund-helpers.mts';
import {ReadContext} from '../../packages/commerce/read-context.mts';
import {SupportService} from '../../packages/commerce/support-service.mts';
import {SupportFixtureSource} from '../../packages/adapters/support-fixture-source.mts';
import {RefundMessageFacts} from '../../packages/commerce/refund-message-facts.mts';
import {startCommerceServer} from '../../apps/commerce-api/server.mts';
import {contentDigest} from '../../packages/commerce/configuration-values.mts';

// The diagnostic qualification gate uses observed, read-only fixture facts.
// This configuration does not claim any model/provider assessment or grant money I/O.
export function configurePortabilityAgent(f:any,action:string,extra:any={}){
 const fixture=JSON.parse(readFileSync(new URL('../fixtures/woocommerce/agent-mode.v1.json',import.meta.url),'utf8')),c=f.cases.resume(f.a.scope,f.caseId),read=f.woo.cached(f.a.scope,c.resource_id),cap=f.woo.capabilities(f.a.scope,c.resource_id),binding=f.woo.binding(f.a.scope,c.resource_id);
 const values={platform:c.order.source_system,skill:c.pins.skill.id,api:read.source.api_version,order:read.source.native_id,currency:c.order.payload.currency,paid:binding.financial_contract.original_paid_minor,gateway:binding.financial_contract.gateway_id,read_scopes:cap.scopes,native_returns:f.returnSource.records().native_return_create_effects,production:read.production_qualified};
 const pins={skill_digest:c.pins.skill.digest,profile_digest:c.pins.profile.sha256,policy_digest:c.pins.policy.digest,adapter_digest:c.pins.adapter.sha256,model_id:'no_model_fixture',runtime_id:'local_http_agent_fixture',prompt_digest:contentDigest(fixture),configuration_digest:c.configuration_digest,action};
 const suite=Object.entries(fixture.expected_values).map(([id,value])=>({id,action,expected_facts:{value},expected_handling:'draft',critical:true})),q=f.support.qualification,ref=action.replaceAll('.','_');
 const frozen=q.freeze(f.owner.scope,{id:ref+'_suite',expected_version:0,pins,suite,expires_at:f.now()+60000});f.advance(1);
 const proof=q.register(f.owner.scope,{id:ref+'_proof',expected_version:0,suite_id:frozen.id,suite_version:frozen.version,suite_digest:frozen.digest,results:Object.entries(values).map(([id,value])=>({id,facts:{value},handling:'draft',unauthorized_action:false,configuration_digest:pins.configuration_digest})),evidence_kind:'synthetic_fixture'});
 q.review(f.reviewer.scope,proof.id,proof.version,proof.digest);
 const old=f.db.prepare("SELECT max(version) version FROM commerce_support_documents WHERE tenant_id=? AND store_id=? AND kind='support_modes' AND id=?").get(f.a.tenant,f.a.store,f.caseId);
 const mode=q.configureMode(f.owner.scope,{case_id:f.caseId,expected_version:old.version??0,mode:'approval_required',pins,qualification_id:proof.id,qualification_version:proof.version,maximum_minor:'2000',currency:'USD',require_inspection:false,expires_at:f.now()+60000,...extra});
 return {proof,mode,pins};
}

export function returnPortabilityFixture(options:any={}){
 const f=wooRefundFixture(options),reads=new ReadContext(f.kernel,f.caps,{readers:{woocommerce:f.woo}}),mailDb=new DatabaseSync(join(f.directory,'woo-notifications.sqlite'));
 const mailSource=new SupportFixtureSource(mailDb,f.a.tenant,f.a.store,'woo_customer_mail',f.now),refunds=new RefundMessageFacts(f.kernel,[f.executor]),support=new SupportService(f.kernel,reads,{sources:[mailSource],refunds});
 const link=support.conversations.link(f.a.scope,f.customer,{case_id:f.caseId,channel:'email',account_id:mailSource.account,external_id:'woo_customer_thread',history:'partial',source_revision:1});
 const senderInput={id:'woo_sender',expected_revision:0,channel:'email',address:'support@example.invalid',account_id:mailSource.account,source_identity:mailSource.identity,source_contract:mailSource.contract,expires_at:f.now()+3600000,jurisdiction:'US_TEST',transactional_basis:'order_service'};
 support.consent.configureSender(f.owner.scope,senderInput);support.consent.verifyContact(f.a.scope,f.customer,{link_id:link.id,address:'woo-shopper@example.invalid'});
 const message=(operationId:string,extra:any={})=>({case_id:f.caseId,link_id:link.id,sender_id:'woo_sender',template_id:'return_refund_completed_v1',event_id:operationId,expected_generation:support.ownership.inspect(f.a.scope,f.caseId)!.generation,...extra});
 return {...f,reads,mailDb,mailSource,refunds,support,link,senderInput,message,cleanup:()=>{mailDb.close();f.cleanup();}};
}
export async function usingReturnPortability(fn:(f:ReturnType<typeof returnPortabilityFixture>)=>unknown,options:any={}){const f=returnPortabilityFixture(options);try{return await fn(f);}finally{f.cleanup();}}
export async function withPortabilityServer(f:any,fn:(post:any,app:any)=>unknown){
 const logs:any[]=[],app=await startCommerceServer({kernel:f.kernel,caps:f.caps,customers:f.customers,simulator:f.simulator,reads:f.reads,resolutionExecution:f.executor,support:f.support,log:r=>logs.push(r)});
 try{return await fn(async(path:string,input:any,bearer:string|null=f.a.bearer)=>{const response=await fetch(app.url+path,{method:'POST',headers:{'content-type':'application/json',...(bearer?{authorization:'Bearer '+bearer}:{})},body:JSON.stringify(input)});return {status:response.status,body:await response.json()};},{...app,logs});}
 finally{await app.close();}
}
