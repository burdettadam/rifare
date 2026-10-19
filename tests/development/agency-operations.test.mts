import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {usingAgency,populateAgencyMetrics,AGENCY_TEST_ACTIONS} from './agency-operations-helpers.mts';
import {SecretVault} from '../../packages/commerce/secrets.mts';
import {Permissions} from '../../packages/commerce/authorization.mts';
import {CommerceKernel} from '../../packages/commerce/kernel.mts';
import {AgencyAccess} from '../../packages/commerce/agency-access.mts';
import {AgencyReports} from '../../packages/commerce/agency-reports.mts';
import {SharedTemplates} from '../../packages/commerce/shared-templates.mts';
const oracle=JSON.parse(readFileSync(new URL('../fixtures/agencies/known-answers.v1.json',import.meta.url),'utf8'));
const subset=(actual:any,expected:any)=>{for(const [key,value] of Object.entries(expected))assert.deepEqual(actual[key],value,key);};

test('CASE-M12-G01-01',()=>usingAgency(f=>{
 const b=f.delegate(f.b,f.ownerB,{role:'reviewer',actions:['resource.read','case.read','support.read','profile.read','skill.read']});
 f.kernel.authorize(f.agencyA.scope,'profile.write');f.kernel.authorize(b.scope,'profile.read');
 assert.throws(()=>f.kernel.authorize(b.scope,'profile.write'),/ACCESS_DENIED/);assert.throws(()=>f.access.grant(f.agencyA.scope,{agency_id:'any'}),/ACCESS_DENIED/);
 assert.equal(f.kernel.require(f.agencyA.scope).role,'operator');assert.equal(f.kernel.require(b.scope).role,'reviewer');
 const key=new CommerceKernel(f.db,f.now);const current=new AgencyAccess(key).current(key.authenticate(f.agencyA.bearer),f.agency_id,'profile.write');assert.equal(current.grant.permission_revision,1);
}));
test('CASE-M12-G01-02',()=>usingAgency(async f=>{
 let probes=0;const vault=new SecretVault(f.kernel,{activeId:'fixture-key',get:()=>Buffer.alloc(32,7)},{fixture:()=>{probes++;return true;}});
 const secret=vault.put(f.owner.scope,{provider:'fixture-provider',adapter:'fixture',value:'synthetic-fixture-only'});
 await assert.rejects(()=>vault.probe(f.agencyB.scope,secret.ref,'fixture'),/SECRET_UNAVAILABLE/);assert.equal(probes,0);
 assert.throws(()=>f.kernel.get(f.agencyA.scope,f.order(f.b).id),/NOT_FOUND/);
 for(const action of ['authority.manage','secret.manage','connection.manage','action.configure'])assert.throws(()=>f.access.grant(f.owner.scope,{agency_id:f.agency_id,actor_id:'dangerous',role:'operator',actions:[action],resource_ids:null,expected_revision:0}),/AGENCY_PERMISSION_DENIED/);
 assert.equal(f.db.prepare("SELECT count(*) n FROM commerce_members WHERE actor_id='dangerous'").get().n,0);
}));
test('CASE-M12-G01-03',()=>usingAgency(async f=>{
 const before=f.ownership.inspect(f.a.scope,'case_one')?.generation??0;
 f.ownership.takeover(f.agencyA.scope,{case_id:'case_one',expected_generation:before,reason:'operator_requested'});
 const p=f.gateway.prepare(f.agencyA.scope,f.proposal()),approval=f.approve(p),queued=f.delivery.queue(f.agencyA.scope,f.message());
 await assert.rejects(()=>f.delivery.dispatch(f.a.scope,queued.operation_id,{beforeFinal:async()=>{f.access.revoke(f.owner.scope,{agency_id:f.agency_id,actor_id:f.actor_id,expected_revision:1});}}),/ACCESS_DENIED/);
 assert.equal(f.source.calls,0);assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM support_source_effects').get().n,0);
 assert.equal(f.delivery.inspect(f.a.scope,queued.operation_id).state,'suppressed');assert.throws(()=>f.execute(p,approval,f.agencyA.scope),/ACCESS_DENIED/);
 f.kernel.authorize(f.agencyB.scope,'profile.write');
 const restored=f.delegate(f.a,f.owner);f.kernel.authorize(restored.scope,'profile.write');assert.throws(()=>f.kernel.authenticate(f.agencyA.bearer),/ACCESS_DENIED/);
}));
test('CASE-M12-G02-01',()=>usingAgency(f=>{
 const publication=f.publish(),a=f.offer(f.agencyA.scope,publication,'a-update'),b=f.offer(f.agencyB.scope,publication,'b-update');
 f.accept(f.owner,a);f.templates.reject(f.ownerB.scope,{offer_id:b.offer_id,expected_digest:b.digest});
 subset(f.reads.profiles.get(f.a.scope,'default').profile,oracle.presentation);subset(f.reads.profiles.get(f.b.scope,'default').profile,oracle.original_presentation);
 assert.equal(f.templates.get(f.a.scope,a.offer_id).state,'accepted');assert.equal(f.templates.get(f.b.scope,b.offer_id).state,'rejected');
 assert.throws(()=>f.templates.accept(f.ownerB.scope,{offer_id:b.offer_id,expected_digest:b.digest,expected_profile_revision:1}),/TEMPLATE_TRANSITION/);
}));
test('CASE-M12-G02-02',()=>usingAgency(f=>{
 for(const values of [{...oracle.presentation,secret:'customer@example.invalid'},{...oracle.presentation,'returns.window_days':365},{tone:{customer_id:'private'},locale:'en-US'},{tone:'customer@example.invalid',locale:'en-US'}])assert.throws(()=>f.publish(values));
 assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_shared_templates').get().n,0);
 const p=f.publish(),a=f.offer(f.agencyA.scope,p,'owner-choice');
 assert.throws(()=>f.templates.accept(f.agencyA.scope,{offer_id:a.offer_id,expected_digest:a.digest,expected_profile_revision:1}),/ACCESS_DENIED/);
 assert.throws(()=>f.templates.accept(f.owner.scope,{offer_id:a.offer_id,expected_digest:'0'.repeat(64),expected_profile_revision:1}),/TEMPLATE_CHANGED/);
 assert.equal(f.reads.profiles.get(f.a.scope,'default').profile.revision,1);
}));
test('CASE-M12-G02-03',()=>usingAgency(f=>{
 const old=f.cases.resume(f.a.scope,'case_one'),p=f.preview(),a=f.approve(p),publication=f.publish(),oa=f.offer(f.agencyA.scope,publication,'a-upgrade'),ob=f.offer(f.agencyB.scope,publication,'b-upgrade');
 f.accept(f.owner,oa);f.accept(f.ownerB,ob);
 f.templates.rollback(f.owner.scope,{offer_id:oa.offer_id,expected_digest:oa.digest,expected_profile_revision:2});
 assert.equal(f.reads.profiles.get(f.a.scope,'default').profile.revision,3);subset(f.reads.profiles.get(f.a.scope,'default').profile,oracle.original_presentation);subset(f.reads.profiles.get(f.b.scope,'default').profile,oracle.presentation);
 assert.deepEqual(f.cases.resume(f.a.scope,'case_one').pins,old.pins);assert.equal(f.execute(p,a).configuration_digest,old.configuration_digest);
 assert.throws(()=>f.templates.rollback(f.owner.scope,{offer_id:oa.offer_id,expected_digest:oa.digest,expected_profile_revision:3}),/TEMPLATE_TRANSITION/);
}));
test('CASE-M12-G03-01',()=>usingAgency(f=>{
 const selections=populateAgencyMetrics(f),r=f.reports.report(f.agency_id,selections);subset(r,oracle.combined);
 assert.equal(r.repeat_contact.immature,1);assert.equal(r.repeat_contact.rate,null);assert.equal(r.authority_revalidated,true);assert.equal(r.cached,false);
 assert.equal(f.reports.drilldown(f.agencyA.scope,f.agency_id,'cohort_a').denominator,2);
 const json=JSON.stringify(r);for(const key of oracle.forbidden_aggregate_fields)assert.equal(json.includes('"'+key+'"'),false,key);
 assert.equal(json.includes('shopper-apparel'),false);assert.equal(json.includes('C-1001'),false);
}));
test('CASE-M12-G03-02',()=>usingAgency(f=>{
 const selections=populateAgencyMetrics(f),r=f.reports.report(f.agency_id,[selections[0],{scope:f.b.scope,cohort_id:'cohort_b'},{scope:{tenant_id:f.b.tenant,role:'owner'},cohort_id:'cohort_b'}]);
 assert.equal(r.denominator,2);assert.equal(r.included_stores,1);assert.equal(r.excluded_stores,2);
 assert.throws(()=>f.reports.drilldown(f.b.scope,f.agency_id,'cohort_b'),/AGENCY_ACCESS_DENIED/);
 assert.throws(()=>f.reports.report(f.agency_id,[selections[0],selections[0]]),/AGENCY_DUPLICATE_STORE/);
 const limited=f.delegate(f.a,f.owner,{actions:['support.analytics','profile.read','skill.read'],resource_ids:[]});
 assert.throws(()=>f.reports.drilldown(limited.scope,f.agency_id,'cohort_a'),/ACCESS_DENIED/);
 const limitedAggregate=f.reports.report(f.agency_id,[{scope:limited.scope,cohort_id:'cohort_a'}]);assert.equal(limitedAggregate.denominator,2);assert.equal(limitedAggregate.unavailable_cases,2);assert.equal(limitedAggregate.pending_cases,2);
}));
test('CASE-M12-G03-03',t=>usingAgency(f=>{
 const selections=populateAgencyMetrics(f),first=f.reports.report(f.agency_id,selections);subset(first,oracle.combined);
 const stale=new AgencyReports(f.kernel),original=stale.report.bind(stale);let snapshot:any;
 stale.report=((...args:any[])=>snapshot??(snapshot=original(args[0],args[1]))) as any;
 stale.report(f.agency_id,selections);f.access.revoke(f.owner.scope,{agency_id:f.agency_id,actor_id:f.actor_id,expected_revision:1});
 subset(f.reports.report(f.agency_id,selections),oracle.after_a_revocation);
 assert.throws(()=>subset(stale.report(f.agency_id,selections),oracle.after_a_revocation),assert.AssertionError);
 t.diagnostic('M12_TARGET_FAULT agency_totals_ignore_current_authority: cached real scoped report fails the independently declared post-revocation denominator');
}));
test('PORT-032',t=>usingAgency(f=>{
 const original=f.templates.publish.bind(f.templates),beforeA=f.reads.profiles.get(f.a.scope,'default'),beforeB=f.reads.profiles.get(f.b.scope,'default');
 const verifyInert=()=>{assert.equal(f.reads.profiles.get(f.a.scope,'default').sha256,beforeA.sha256);assert.equal(f.reads.profiles.get(f.b.scope,'default').sha256,beforeB.sha256);};
 f.publish();verifyInert();
 f.templates.publish=((scope:any,input:any)=>{const value=original(scope,input);for(const target of [f.agencyA.scope,f.agencyB.scope]){const p=f.reads.profiles.get(target,'default').profile;f.reads.profiles.put(target,{...p,revision:p.revision+1,...input.values});}return value;}) as any;
 f.publish({tone:'formal',locale:'fr-CA'},1);assert.throws(verifyInert,assert.AssertionError);
 f.templates.publish=original;
 t.diagnostic('M12_TARGET_FAULT publication_activates_all_subscribers: mutated real publication changes actual store profiles and fails the independent no-overwrite oracle');
}));
test('M12-TEST-002-AGENCY-SCOPE',()=>usingAgency(f=>{
 const foreign=f.order(f.b),sameTenantOther=f.order(f.c);
 assert.throws(()=>f.kernel.get(f.agencyA.scope,foreign.id),/NOT_FOUND/);assert.throws(()=>f.kernel.get(f.agencyA.scope,sameTenantOther.id),/NOT_FOUND/);
 assert.equal(f.kernel.lookup(f.agencyA.scope,'order','synthetic','ORD-1001').id,f.order().id);
 const published=f.publish(),offer=f.offer(f.agencyB.scope,published,'b-only');
 assert.throws(()=>f.templates.get(f.agencyA.scope,offer.offer_id),/NOT_FOUND/);assert.throws(()=>f.templates.reject(f.owner.scope,{offer_id:offer.offer_id,expected_digest:offer.digest}),/NOT_FOUND/);
 assert.equal(f.kernel.auditRows(f.owner.scope).some((row:any)=>JSON.stringify(row).includes(foreign.id)),false);
}));
test('M12-AGENCY-AUTHORITY-INTEGRITY',()=>usingAgency(f=>{
 assert.throws(()=>f.access.grant(f.owner.scope,{agency_id:f.agency_id,actor_id:'operator',role:'operator',actions:['profile.read'],resource_ids:null,expected_revision:0}),/AGENCY_MEMBER_COLLISION/);
 assert.throws(()=>f.access.grant(f.owner.scope,{agency_id:f.agency_id,actor_id:f.actor_id,role:'operator',actions:[...AGENCY_TEST_ACTIONS],resource_ids:null,expected_revision:0}),/AGENCY_CHANGED/);
 const p=f.publish(),offer=f.offer(f.agencyA.scope,p,'stale-proposer');
 new Permissions(f.kernel).change(f.owner.scope,{actor_id:f.actor_id,role:'operator',actions:['profile.read'],resource_ids:null,expected_revision:1});
 assert.throws(()=>f.templates.accept(f.owner.scope,{offer_id:offer.offer_id,expected_digest:offer.digest,expected_profile_revision:1}),/AGENCY_ACCESS_DENIED/);
 assert.throws(()=>new SharedTemplates(f.kernel).publish(f.agencyA.scope,{template_id:'stale',expected_version:0,values:oracle.presentation}),/ACCESS_DENIED|AGENCY_ACCESS_DENIED/);
 assert.equal(f.reads.profiles.get(f.a.scope,'default').profile.revision,1);
}));
