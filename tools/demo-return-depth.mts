/** Disposable, headless milestone demonstration using the retained synthetic
 * journey fixtures. It accepts no provider credentials and changes no repository. */
import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {readFileSync} from 'node:fs';
import {usingLineage} from '../tests/development/exchange-lineage-helpers.mts';
import {usingInstant,authorizeMandate,releaseReplacement,oracle} from '../tests/development/instant-helpers.mts';
import {usingQualifiedDestinations} from '../tests/development/qualified-destinations-helpers.mts';
import {usingPrevention} from '../tests/development/prevention-helpers.mts';
import {usingPolicyPack,packOracle} from '../tests/development/return-policy-pack-helpers.mts';
import {usingReturns} from '../tests/development/return-intake-helpers.mts';
import {ReturnEvidence} from '../packages/commerce/return-evidence.mts';import {RiskAssistance} from '../packages/commerce/risk-assistance.mts';
import {ReturnEconomics} from '../packages/commerce/return-economics.mts';import {SupportMetrics} from '../packages/commerce/support-metrics.mts';
import {contentDigest} from '../packages/commerce/configuration-values.mts';import {digest} from '../packages/commerce/kernel.mts';
if(process.argv.length!==2)throw Error('This committed synthetic demonstration accepts no arguments.');
const git=(...args:string[])=>execFileSync('git',args,{encoding:'utf8'}).trim();
if(git('status','--porcelain'))throw Error('DEMO_REQUIRES_COMMITTED_CANDIDATE');
const values=JSON.parse(readFileSync('tests/fixtures/return-depth/milestone-values.v1.json','utf8'));
const secretKeys=new Set(['token','bearer','session_hash','owner_session_hash','token_hash','verification_hash','proof','secret','signature']);
function safe(v:any):any{
 if(Array.isArray(v))return v.map(safe);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([k])=>!secretKeys.has(k)).map(([k,x])=>[k,safe(x)]));
 if(typeof v==='string'&&/^[\[{]/.test(v)){try{return safe(JSON.parse(v));}catch{/* ordinary text */}}return v;
}
const coreTables=['commerce_native_return_operations','commerce_resolution_plans','commerce_resolution_allocations','commerce_resolution_operations','commerce_resolution_observations','commerce_inventory_reservations','commerce_fulfillment_operations','commerce_fulfillment_observations','commerce_return_labels','commerce_replacement_orders','commerce_exchange_lineage_nodes','commerce_exchange_lineage_imports','commerce_instant_operations','commerce_instant_obligations','commerce_instant_observations','commerce_support_costs','commerce_destination_policies','commerce_destination_bindings','commerce_destination_selections','commerce_risk_assessments','commerce_risk_reviews','commerce_prevention_configurations','commerce_prevention_experiments','commerce_prevention_members','commerce_prevention_exposures','commerce_prevention_previews','commerce_prevention_confirmations','commerce_prevention_outcomes'];
function ledger(db:any,names?:string[]){
 const existing=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r:any)=>r.name);
 return Object.fromEntries((names??existing.filter((n:string)=>!n.endsWith('_identity'))).filter(n=>existing.includes(n)).map(name=>[name,db.prepare('SELECT * FROM '+name).all().map((row:any)=>({entry_digest:contentDigest(row),record:safe(row)}))]));
}
const journeys:any[]=[];
await usingLineage(async f=>{
 const metrics=new SupportMetrics(f.kernel);metrics.freeze(f.a.scope,{id:'milestone_mixed',case_ids:['resolution_case'],starts_at:f.now(),ends_at:f.now()+60000});
 const refund=f.authorize(f.quote(f.plan.allocations.find(a=>a.outcome==='refund')!));await f.executor.dispatch(f.a.scope,refund.id);f.source.settle(refund.id);await f.executor.reconcile(f.a.scope,refund.id);
 const credit=f.authorize(f.credit.quote(f.a.scope,f.plan.allocations.find(a=>a.outcome==='store_credit')!.id));await f.executor.dispatch(f.a.scope,credit.id);
 const exchange=await f.makeExchange(f.allocation,'1400'),child=f.lineage.materialize(f.a.scope,{operation_id:exchange.op.id});
 for(const [category,amount_minor] of Object.entries(values.declared_costs))metrics.cost(f.a.scope,{id:'demo_'+category,case_id:'resolution_case',category,currency:'USD',amount_minor,source_ref:'synthetic_'+category,adjustment_of:null});
 const economics=new ReturnEconomics(f.kernel).report(f.a.scope,'milestone_mixed');assert.equal(economics.declared_contribution_minor,'2700');assert.equal(child.node.carried_minor,'1200');
 journeys.push({id:'mixed_outcomes',configuration:f.cases.resume(f.a.scope,'resolution_case').pins,refund:await f.source.lookup(refund.id),credit:await f.source.lookup(credit.id),child,economics,core:ledger(f.db,coreTables),native_resolution_and_lineage:ledger(f.sourceDb),native_fulfillment:ledger(f.fulfillmentDb)});
},{discount:true});
await usingLineage(f=>{
 const catalog=f.catalog({available:0}),q=f.exchanges.quote(f.a.scope,{allocation_id:f.allocation.id,catalog_id:catalog.id});assert.equal(q.quote.allowed,false);assert.deepEqual(q.quote.alternatives,['refund','store_credit']);assert.equal(f.fulfillmentSource.effects().length,0);
 journeys.push({id:'out_of_stock_fallback',quote:q,core:ledger(f.db,coreTables),native_resolution_and_lineage:ledger(f.sourceDb),native_fulfillment:ledger(f.fulfillmentDb)});
});
await usingInstant(async f=>{
 await authorizeMandate(f);await releaseReplacement(f);f.advance(oracle.mandate_lifetime_ms+1);f.refreshSessions();let blocked_reason='';try{f.instant.quoteCapture(f.a.scope,{obligation_id:f.obligationId});}catch(e){blocked_reason=(e as Error).message;}
 assert.equal(blocked_reason,'INSTANT_REAUTHORIZATION_REQUIRED');assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM fixture_instant_captures').get()!.n,0);
 journeys.push({id:'nonreturn_expired_authorization',blocked_reason,core:ledger(f.db,coreTables),native_instant:ledger(f.sourceDb)});
});
await usingInstant(async f=>{
 await authorizeMandate(f);await releaseReplacement(f);f.advance(oracle.trial_ms);const op=f.authorize(f.instant.quoteCapture(f.a.scope,{obligation_id:f.obligationId}));f.source.fault='after';const interrupted=await f.instant.dispatch(f.a.scope,op.id),resolved=await f.instant.reconcile(f.a.scope,op.id);
 assert.equal(interrupted.state,'unknown');assert.equal(resolved.source.captured_minor,'3000');assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM fixture_instant_captures').get()!.n,1);
 journeys.push({id:'nonreturn_unknown_capture',original_operation_id:op.id,interrupted,resolved,core:ledger(f.db,coreTables),native_instant:ledger(f.sourceDb)});
});
await usingQualifiedDestinations(async f=>{
 const evaluation=f.routing.evaluate(f.a.scope,{request_id:f.request.id}),selection=f.choose(),q=f.quote(),op=f.authorizeFulfillment(q),result=await f.execution.dispatch(f.a.scope,op.id);
 assert.equal(selection.route.handling_fee_estimate_minor,'150');assert.equal(result.state,'purchased');
 journeys.push({id:'qualified_fragile_destination',evaluation,selection,label_quote:q,operation:result,handling_fee_charged:false,core:ledger(f.db,coreTables),native_fulfillment:ledger(f.fulfillmentDb)});
});
await usingReturns(async f=>{
 const photo=JSON.parse(readFileSync('tests/fixtures/return-intake/photo.v1.json','utf8')).base64,evidence=new ReturnEvidence(f.kernel,{identity:'risk-demo-scan',scan:async bytes=>({verdict:'rejected',sha256:digest(bytes)})});
 const upload=evidence.upload(f.customer,{case_id:'case_one',mime:'image/png',base64:photo,note:''});await evidence.scan(f.reviewer.scope,upload.id);
 const q=f.quote({evidence_ids:[upload.id]}),risk=new RiskAssistance(f.kernel),assessment=risk.assess(f.a.scope,{case_id:'case_one',quote_id:q.id,model:{unsupported_accusation:'must_not_be_published',deny_all:true}});
 const review=risk.review(f.reviewer.scope,{assessment_id:assessment.assessment_id,assessment_digest:assessment.digest,action:'request_evidence',reason:'photo_unclear',expires_at:null});
 const appeal=risk.appeal(f.customer,{assessment_id:assessment.assessment_id,reason:'request_human',evidence_ids:[upload.id]});assert.equal(assessment.assessment.automatic_denial,false);assert.equal(appeal.status,'human_review_requested');
 journeys.push({id:'reviewable_risk_and_appeal',assessment,review,customer_response:appeal,core:ledger(f.db,coreTables)});
});
await usingPrevention(async f=>{
 const original=f.native.order(f.original.id),offer=f.analyze(),preview=f.preview({variant_id:'equal'}),confirmation=f.confirm(preview);assert.deepEqual(f.native.order(f.original.id),original);
 const receipt=f.authorize(preview);await f.edits.dispatch(f.a.scope,receipt.order_edit_id);await f.edits.release(f.a.scope,receipt.order_edit_id);
 f.advance(10000);for(const arm of ['baseline','control','treatment']){f.outcome(arm);f.service.refreshOutcome(f.a.scope,{experiment_id:'fit_trial',case_id:f.members.find(m=>m.arm===arm)!.case_id});}
 const report=f.service.report(f.a.scope,{experiment_id:'fit_trial'});
 journeys.push({id:'customer_confirmed_size_edit',offer,preview,confirmation,original_order:original,edited_order:f.native.order(f.original.id),experiment:report,core:ledger(f.db,[...coreTables,'commerce_order_edits','commerce_edit_steps','commerce_edit_events']),native_edits:ledger(f.sourceDb)});
});
for(const spec of packOracle.profiles)await usingPolicyPack(f=>{journeys.push({id:'merchant_policy_pack_'+spec.id,pack:f.installed,evaluation:f.evaluate()});},spec.id);
console.log(JSON.stringify(safe({schema_version:1,candidate:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),worktree_clean:true,oracle_digest:contentDigest(values),profile:'disposable_synthetic_fixture_demonstration',generated_at:new Date().toISOString(),journeys,
 external_calls:0,production_qualified:false,full_milestone_accepted:false,qualification:JSON.parse(readFileSync('work/qualification/M06.json','utf8'))}),null,2));
