import test from 'node:test';import assert from 'node:assert/strict';
import {usingReturns} from './return-intake-helpers.mts';import {usingPrevention} from './prevention-helpers.mts';import {usingQualifiedDestinations} from './qualified-destinations-helpers.mts';
import {PrivacyLifecycle,storageInventory} from '../../packages/commerce/privacy-lifecycle.mts';import {RiskAssistance} from '../../packages/commerce/risk-assistance.mts';
import {contentDigest,canonical} from '../../packages/commerce/configuration-values.mts';
test('M06-FINAL-PRIVACY-INVENTORY-REQUIRES-ALL-167-TABLES',()=>usingReturns(f=>{const inventory=storageInventory(f.kernel);assert.equal(inventory.tables.length,167);assert.equal(inventory.schema_digest,'5b86a35a754ee03b71f28d6b60cb14f531b896072e37dde06950f39610d0e9f2');f.db.exec('ALTER TABLE commerce_risk_assessments ADD COLUMN covert_note TEXT');assert.throws(()=>storageInventory(f.kernel),/STORAGE_INVENTORY_CHANGED/);}));
test('M06-G11-PRIVACY-EXPORT-AND-ERASURE-COVER-INDICATORS-AND-APPEALS',()=>usingReturns(f=>{
 const risk=new RiskAssistance(f.kernel),q=f.quote(),r=risk.assess(f.a.scope,{case_id:'case_one',quote_id:q.id,model:null});risk.appeal(f.customer,{assessment_id:r.assessment_id,reason:'request_human',evidence_ids:[]});const p=new PrivacyLifecycle(f.kernel),customer=f.order().customer_id,e=p.export(f.owner.scope,customer);
 assert.equal(e.return_assistance_records.commerce_risk_assessments.length,1);assert.equal(e.return_assistance_records.commerce_risk_reviews.length,1);p.erase(f.owner.scope,customer);
 for(const table of ['commerce_risk_assessments','commerce_risk_reviews'])for(const row of f.db.prepare('SELECT * FROM '+table).all()){assert.equal(JSON.parse(String(row.body)).redacted,true);assert.equal(JSON.stringify(row).includes(customer),false);}
 assert.throws(()=>risk.read(f.a.scope,{case_id:'case_one',assessment_id:null}),/SUBJECT_ERASED|CUSTOMER_VERIFICATION_REQUIRED/);
}));
test('M06-G13-PRIVACY-REVOKES-CONSENT-AND-KEEPS-FROZEN-DENOMINATOR',()=>usingPrevention(f=>{
 f.analyze();const q=f.preview();f.confirm(q);const p=new PrivacyLifecycle(f.kernel),e=p.export(f.owner.scope,f.original.customer_id),stored=f.db.prepare('SELECT session_hash FROM commerce_prevention_confirmations').get()!;
 assert.equal(e.return_assistance_records.commerce_prevention_confirmations.length,1);assert.equal(JSON.stringify(e).includes(String(stored.session_hash)),false);assert.equal(JSON.stringify(e.return_assistance_records).includes('session_hash'),false);
 const frozen=f.db.prepare('SELECT body,digest FROM commerce_prevention_experiments').get();p.erase(f.owner.scope,f.original.customer_id);assert.deepEqual(f.db.prepare('SELECT body,digest FROM commerce_prevention_experiments').get(),frozen);
 const row=f.db.prepare('SELECT * FROM commerce_prevention_confirmations').get()!;assert.equal(row.revoked,1);assert.equal(row.session_hash,'revoked');assert.equal(JSON.parse(String(row.body)).redacted,true);
 const report=f.service.report(f.a.scope,{experiment_id:'fit_trial'});assert.equal(report.denominator,3);assert.equal(report.cases.every((c:any)=>c.state==='unavailable_still_in_denominator'),true);assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM edit_source_effects').get()!.n,0);
}));
test('M06-G12-PRIVACY-ERASES-ROUTING-SUBJECT-BODIES-KEEPS-POLICY',()=>usingQualifiedDestinations(f=>{
 f.choose();const p=new PrivacyLifecycle(f.kernel),e=p.export(f.owner.scope,f.order().customer_id);assert.equal(e.return_assistance_records.commerce_destination_bindings.length,1);assert.equal(e.return_assistance_records.commerce_destination_selections.length,1);const policy=f.db.prepare('SELECT * FROM commerce_destination_policies').all();
 p.erase(f.owner.scope,f.order().customer_id);for(const table of ['commerce_destination_bindings','commerce_destination_selections'])assert.equal(JSON.parse(String(f.db.prepare('SELECT body FROM '+table).get()!.body)).redacted,true);assert.deepEqual(f.db.prepare('SELECT * FROM commerce_destination_policies').all(),policy);assert.equal(f.fulfillmentDb.prepare('SELECT count(*) n FROM fixture_effects').get()!.n,0);
}));
test('M06-G13-PRIVACY-REMOVES-UNBOUND-GUIDANCE-COPIES-ACROSS-VERSIONS-AND-CUSTOMERS',()=>usingPrevention(f=>{
 const privateText='SYNTHETIC_UNBOUND_GUIDE_PRIVATE_SENTINEL';
 const guide=f.knowledge.put(f.a.scope,f.source({id:'private_guide',kind:'support',title:'Fixture guide',content:privateText,expires_at:f.now()+600000}));
 const config=f.service.configure(f.owner.scope,f.configuration({expected_version:1,guidance:{id:guide.id,revision:guide.revision,sha256:guide.source.sha256}}));
 assert.equal(config.configuration.guidance.content,privateText);const originalDigest=config.digest;
 // Preserve another subject's cached offer while exercising the existing store-wide
 // unbound-text cleanup. This is a storage fixture, not an accepted experiment event.
 const body={case_id:'other_subject_case',offer:{text:privateText,source:{id:guide.id,revision:guide.revision,sha256:guide.source.sha256,uri:privateText}},paid_goods_changed:false};
 f.db.prepare('INSERT INTO commerce_prevention_exposures VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(f.a.tenant,f.a.store,'other_private_copy','fit_trial','other_subject_case','other_subject_resource','other_customer','other_event',canonical(body),contentDigest(body),f.now());
 const frozen=f.db.prepare('SELECT body,digest FROM commerce_prevention_experiments').get();new PrivacyLifecycle(f.kernel).erase(f.owner.scope,f.original.customer_id);
 assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_knowledge WHERE id=?').get(guide.id)!.n,0);
 for(const table of ['commerce_prevention_configurations','commerce_prevention_exposures'])assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM '+table).all()).includes(privateText),false);
 const after=f.service.configuration(f.a.scope,{id:'fit',version:2});assert.equal(after.configuration.guidance.content,null);assert.equal(after.configuration.enabled,false);assert.equal(after.configuration.original_digest,originalDigest);
 const other=JSON.parse(String(f.db.prepare("SELECT body FROM commerce_prevention_exposures WHERE id='other_private_copy'").get()!.body));assert.equal(other.offer.text,null);assert.equal(other.guidance_unavailable,true);assert.equal(other.paid_goods_changed,false);assert.deepEqual(f.db.prepare('SELECT body,digest FROM commerce_prevention_experiments').get(),frozen);
}));
