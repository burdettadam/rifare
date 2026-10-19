import { supportFixture } from './support-helpers.mts';
import { installSupportSkills } from './support-workflow-helpers.mts';
import { AgencyAccess } from '../../packages/commerce/agency-access.mts';
import { SharedTemplates } from '../../packages/commerce/shared-templates.mts';
import { AgencyReports } from '../../packages/commerce/agency-reports.mts';
import { SupportMetrics } from '../../packages/commerce/support-metrics.mts';
import { AGENCY_TABLES } from '../../packages/commerce/agency-privacy.mts';

export const AGENCY_TEST_ACTIONS=Object.freeze(['resource.read','attachment.read','knowledge.read','skill.read','profile.read','task.read','capability.read','policy.read','case.read','case.create','support.read','support.reply','support.send','support.note','support.takeover','support.analytics','profile.write','action.propose','action.execute','operation.read','operation.dispatch','operation.reconcile','secret.invoke','skill.install','skill.stage','skill.evaluate','skill.write']);
export function agencyFixture(){
 const f=supportFixture();try{
  const k=f.kernel,agency_id='agency-one',actor_id='agency-operator';
  const role=(store:any,name:string,role:'owner'|'reviewer')=>{k.provisionMember(store.tenant,store.store,name,role);const bearer=k.issueSession(store.tenant,store.store,name);return {scope:k.authenticate(bearer),bearer,actor:name};};
  const ownerB=role(f.b,'owner-b','owner'),reviewerB=role(f.b,'reviewer-b','reviewer');
  const bp=f.policies.create(f.b.scope,f.input());f.policies.test(f.b.scope,bp.policy_id,bp.version,bp.digest);f.policies.review(reviewerB.scope,bp.policy_id,bp.version,bp.digest);
  f.policies.publish(ownerB.scope,{policy_id:bp.policy_id,version:bp.version,digest:bp.digest,expected_published_version:0,effective_at:f.now()});
  f.reads.profiles.put(f.b.scope,f.profile(f.b));
  f.cases.create(f.b.scope,{case_id:'b_one',resource_id:f.order(f.b).id,profile_id:'default',policy_id:'returns'});
  const access=new AgencyAccess(k),templates=new SharedTemplates(k),reports=new AgencyReports(k),metrics=new SupportMetrics(k);
  function delegate(store:any,owner:any,overrides:any={}){
   const row=k.db.prepare('SELECT revision FROM commerce_agency_grants WHERE tenant_id=? AND store_id=? AND id=?').get(store.tenant,store.store,actor_id) as any;
   const grant=access.grant(owner.scope,{agency_id,actor_id,role:'operator',actions:[...AGENCY_TEST_ACTIONS],resource_ids:null,expected_revision:row?.revision??0,...overrides});
   const bearer=k.issueSession(store.tenant,store.store,actor_id);return {...grant,bearer,scope:k.authenticate(bearer)};
  }
  const agencyA=delegate(f.a,f.owner),agencyB=delegate(f.b,ownerB);
  const publish=(values={tone:'warm',locale:'en-GB'},expected_version=0)=>templates.publish(agencyA.scope,{template_id:'shared-presentation',expected_version,values});
  const offer=(scope:any,publication:any,offer_id:string)=>templates.offer(scope,{offer_id,publication:publication.publication,profile_id:'default',expected_profile_revision:f.reads.profiles.get(scope,'default').profile.revision});
  const accept=(owner:any,offer:any)=>templates.accept(owner.scope,{offer_id:offer.offer_id,expected_digest:offer.digest,expected_profile_revision:offer.body.before_profile.revision});
  return {...f,ownerB,reviewerB,agency_id,actor_id,access,templates,reports,metrics,agencyA,agencyB,delegate,publish,offer,accept};
 }catch(e){f.cleanup();throw e;}
}
export async function usingAgency(fn:(f:ReturnType<typeof agencyFixture>)=>unknown){const f=agencyFixture();try{return await fn(f);}finally{f.cleanup();}}

export function populateAgencyMetrics(f:ReturnType<typeof agencyFixture>){
 f.create('a_two',f.a.scope);
 for(const id of ['b_two','b_three'])f.cases.create(f.b.scope,{case_id:id,resource_id:f.order(f.b).id,profile_id:'default',policy_id:'returns'});
 f.metrics.freeze(f.a.scope,{id:'cohort_a',case_ids:['case_one','a_two'],starts_at:f.now(),ends_at:f.now()+60000});
 f.metrics.freeze(f.b.scope,{id:'cohort_b',case_ids:['b_one','b_two','b_three'],starts_at:f.now(),ends_at:f.now()+60000});
 const {workflows,digests}=installSupportSkills(f);f.advance(1);
 const answer=workflows.complete(f.a.scope,'case_one','support-reply',digests['support-reply'],'answer');
 f.metrics.confirm(f.customer,{case_id:'case_one',event_id:'confirmed-a',attempt_id:answer.id});
 f.metrics.close(f.a.scope,{case_id:'a_two',event_id:'closed-a'});
 f.metrics.close(f.b.scope,{case_id:'b_one',event_id:'closed-b1'});f.metrics.close(f.b.scope,{case_id:'b_two',event_id:'closed-b2'});
 return [{scope:f.agencyA.scope,cohort_id:'cohort_a'},{scope:f.agencyB.scope,cohort_id:'cohort_b'}];
}
export function populateAgencyPrivacy(f:ReturnType<typeof agencyFixture>){
 const publication=f.publish(),offer=f.offer(f.agencyA.scope,publication,'privacy-offer');f.accept(f.owner,offer);
 return {tenant_id:f.a.tenant,store_id:f.a.store,owner_scope:f.owner.scope,tables:[...AGENCY_TABLES],subject_tables:[],authority_tables:['commerce_agency_grants','commerce_template_offers','commerce_template_decisions'],agency_actor_id:f.actor_id,agency_scope:f.agencyA.scope,agency_session_bearer:f.agencyA.bearer,agency_id:f.agency_id,offer_id:offer.offer_id,publication,offer,immutable_template_state:'published',expected_authority_state:'revoked'};
}
