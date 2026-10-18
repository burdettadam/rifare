import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { id } from './kernel.mts';
import { canonical,contentDigest } from './configuration-values.mts';
import { CaseConfigurations } from './case-configurations.mts';
import { permissionDecision } from './authorization.mts';
import { growthCustomerProof } from './growth-shopping-core.mts';
import { assertNotErased,assertRecoveryEgress,subjectHash } from './data-guards.mts';
import { PartnerReadiness } from './partner-readiness.mts';
import type { PartnerPin } from './partner-readiness.mts';
import { DeliveryTrialFacts,isDeliveryTrial,trialSourceConfiguration } from '../adapters/delivery-trial-source-guards.mts';
import type { InstantExchangeFixtureSource } from '../adapters/instant-exchange-fixture-source.mts';

const sources=new WeakMap<CommerceKernel,{source:InstantExchangeFixtureSource;facts:DeliveryTrialFacts}>();
export function installTrialSource(k:CommerceKernel,source:InstantExchangeFixtureSource,facts:DeliveryTrialFacts){const old=sources.get(k);if(old&&old.source.identity!==source.identity)throw new Error('INSTANT_TRIAL_SOURCE_CHANGED');sources.set(k,{source,facts});}
export function trialSource(k:CommerceKernel){const source=sources.get(k);if(!source)throw new Error('INSTANT_TRIAL_SOURCE_UNAVAILABLE');return source;}
export function trialBody(row:Row|undefined){if(!row)throw new Error('NOT_FOUND');const value=JSON.parse(row.body);if(contentDigest(value)!==row.digest)throw new Error('INSTANT_TRIAL_INTEGRITY');return value;}
export const trialSubjectHash=subjectHash;
export function trialRow(k:CommerceKernel,scope:Scope,trialId:string){const s=k.require(scope),row=k.db.prepare('SELECT * FROM commerce_delivery_trials WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(trialId)) as Row,body=trialBody(row);
 const c=new CaseConfigurations(k).inspect(scope,row.case_id);k.authorize(scope,'resource.read',row.resource_id);
 if(c.resource_id!==row.resource_id||c.customer_id!==row.customer_id||body.binding?.trial_id!==row.id||body.binding.resource_id!==row.resource_id||body.binding.customer_id!==row.customer_id)throw new Error('INSTANT_TRIAL_BINDING_CHANGED');return {s,row,body,c};
}
export function trialObligationContext(k:CommerceKernel,scope:Scope,obligation:Row,body:Row){const ctx=trialRow(k,scope,body.binding.trial_id);
 if(body.source_identity!==trialSource(k).source.identity||canonical(body.binding)!==canonical(ctx.body.binding)||obligation.resource_id!==ctx.row.resource_id||obligation.case_id!==ctx.row.case_id||obligation.allocation_id!==body.binding.allocation_id)throw new Error('INSTANT_TRIAL_INTEGRITY');return {...ctx,obligation,body};
}
export function trialAuthorizationBinding(k:CommerceKernel,scope:Scope,intent:Row){const ctx=trialRow(k,scope,intent.trial_id);if(ctx.row.state!=='active'||ctx.body.erased)throw new Error('INSTANT_TRIAL_DISABLED');k.authorize(scope,'return.read',ctx.row.resource_id);return {...ctx,binding:ctx.body.binding};}

export function currentTrialTerms(k:CommerceKernel,s:Row,termsId:string,version?:number){
 const row=(version===undefined?k.db.prepare('SELECT * FROM commerce_trial_terms WHERE tenant_id=? AND store_id=? AND id=? ORDER BY version DESC LIMIT 1').get(s.tenant_id,s.store_id,id(termsId)):k.db.prepare('SELECT * FROM commerce_trial_terms WHERE tenant_id=? AND store_id=? AND id=? AND version=?').get(s.tenant_id,s.store_id,id(termsId),version)) as Row,body=trialBody(row);
 const latest=k.db.prepare('SELECT max(version) version FROM commerce_trial_terms WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,termsId) as Row;
 const approval=k.db.prepare('SELECT * FROM commerce_trial_term_approvals WHERE tenant_id=? AND store_id=? AND terms_id=? AND version=?').get(s.tenant_id,s.store_id,termsId,row.version) as Row;
 if(!approval||approval.revoked||approval.expires_at<=k.clock()||body.expires_at<=k.clock()||latest.version!==row.version)throw new Error('INSTANT_TRIAL_TERMS_UNAPPROVED');const approved=trialBody(approval);
 const author=k.db.prepare('SELECT * FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND active=1').get(s.tenant_id,s.store_id,row.author) as Row,reviewer=k.db.prepare('SELECT * FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND active=1').get(s.tenant_id,s.store_id,approval.approver) as Row;
 const authored=author&&permissionDecision(k.db,author,'action.configure'),reviewed=reviewer&&permissionDecision(k.db,reviewer,'action.approve');
 if(approval.approver===row.author||!authored?.allowed||authored.authority_revision!==row.authority_revision||!reviewed?.allowed||reviewed.authority_revision!==approval.authority_revision||approved.terms_digest!==row.digest)throw new Error('INSTANT_TRIAL_TERMS_AUTHORITY_CHANGED');
 return {row,body,approval,approved};
}
export function currentTrialConsent(k:CommerceKernel,s:Row,trial:Row,consentId:string){
 const row=k.db.prepare('SELECT * FROM commerce_trial_consents WHERE tenant_id=? AND store_id=? AND id=? AND trial_id=?').get(s.tenant_id,s.store_id,id(consentId),trial.id) as Row,body=trialBody(row);
 const session=k.db.prepare('SELECT * FROM commerce_sessions WHERE token_hash=?').get(body.session_hash) as Row;
 if(row.revoked||body.erased||!session||session.revoked||session.role!=='customer'||session.tenant_id!==s.tenant_id||session.store_id!==s.store_id||session.resource_id!==trial.resource_id||session.customer_id!==trial.customer_id||session.expires_at<=k.clock()||session.last_seen<=k.clock()-900000)throw new Error('INSTANT_TRIAL_CUSTOMER_VERIFICATION_REQUIRED');
 growthCustomerProof(k,session,trial.resource_id,trial.customer_id,'INSTANT_TRIAL_CUSTOMER_CHANGED');return {row,body,session};
}
export function trialPaymentAuthority(k:CommerceKernel,scope:Scope,kind:string,plan:Row,excludeOperation?:string,previous?:Row){
 if(!isDeliveryTrial(plan.binding))return null;
 const ctx=trialRow(k,scope,plan.binding.trial_id),{s,row,body}=ctx,{source}=trialSource(k);assertRecoveryEgress(k);assertNotErased(k,s,row.resource_id,row.customer_id);
 if(row.state!=='active'||body.erased||source.tenant!==s.tenant_id||source.store!==s.store_id||canonical(plan.binding)!==canonical(body.binding))throw new Error('INSTANT_TRIAL_DISABLED');
 const terms=currentTrialTerms(k,s,body.terms_id,body.terms_version);
 if(terms.row.digest!==body.terms_digest||terms.approved.source_terms_digest!==body.native_terms_digest)throw new Error('INSTANT_TRIAL_TERMS_CHANGED');
 const consentId=plan.consent_id??source.obligation(plan.obligation_id).consent_id,consent=currentTrialConsent(k,s,row,consentId);
 if(consent.body.terms_digest!==body.terms_digest||plan.terms_digest!==undefined&&plan.terms_digest!==body.native_terms_digest||plan.maximum_minor!==undefined&&plan.maximum_minor!==consent.body.maximum_minor)throw new Error('INSTANT_TRIAL_CONSENT_CHANGED');
 const pending=k.db.prepare("SELECT id FROM commerce_instant_operations WHERE tenant_id=? AND store_id=? AND obligation_id=? AND state IN ('authorized','unknown') AND id<>? LIMIT 1").get(s.tenant_id,s.store_id,plan.obligation_id,excludeOperation??'') as Row;
 if(pending)throw new Error('INSTANT_TRIAL_RECONCILIATION_REQUIRED');
 if(kind==='capture'){
  const requests=k.db.prepare('SELECT id FROM commerce_return_requests WHERE tenant_id=? AND store_id=? AND resource_id=?').all(s.tenant_id,s.store_id,row.resource_id) as Row[];
  for(const request of requests)if(!source.db.prepare('SELECT 1 FROM fixture_trial_return_links WHERE trial_id=? AND request_id=?').get(row.id,request.id))throw new Error('INSTANT_TRIAL_RECEIPTS_UNCERTAIN');
 }
 const config=trialSourceConfiguration(source,body.account_id),capability=kind==='authorize'?'authorization':kind==='reauthorize'?'reauthorization':kind;
 const partner=new PartnerReadiness(k).assertReady(scope,{service:'trial_payments',account_id:body.account_id,source_identity:source.identity,source_config_digest:config.digest,region:body.region,capability},previous?.partner_pin as PartnerPin|undefined);
 return {partner_pin:partner,terms_digest:terms.row.digest,terms_approval_id:terms.approval.id,terms_approval_digest:terms.approval.digest,consent_id:consent.row.id,consent_digest:consent.row.digest,source_consent_digest:consent.body.native_digest,expires_at:Math.min(partner.expires_at,terms.approval.expires_at,terms.body.expires_at,consent.session.expires_at)};
}
export function trialReconcileAuthority(k:CommerceKernel,scope:Scope,command:Row){if(!isDeliveryTrial(command.binding))return;
 const {s}=trialRow(k,scope,command.binding.trial_id),op=k.db.prepare('SELECT * FROM commerce_instant_operations WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,command.operation_id) as Row;
 if(!op||op.digest!==contentDigest(command)||command.source_identity!==trialSource(k).source.identity)throw new Error('INSTANT_TRIAL_ORIGINAL_OPERATION_REQUIRED');
 const q=k.db.prepare('SELECT * FROM commerce_instant_quotes WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,op.quote_id) as Row,pin=trialBody(q).trial_authority.partner_pin;
 new PartnerReadiness(k).assertReconcile(scope,{service:pin.service,account_id:pin.account_id,source_identity:pin.source_identity,source_config_digest:pin.source_config_digest,region:pin.region,capability:pin.capability});
}
