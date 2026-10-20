import {exact,id,integer,token} from './kernel.mts';
import type {CommerceKernel,Scope,Row} from './kernel.mts';
import {canonical,contentDigest} from './configuration-values.mts';
import {CaseConfigurations} from './case-configurations.mts';
import {permissionDecision} from './authorization.mts';
import {assertRecoveryEgress,subjectHash} from './data-guards.mts';
import {growthCustomerProof} from './growth-shopping-core.mts';
import {ownershipRow} from './support-core.mts';
import {SupportConversations} from './support-conversations.mts';
import {assertExecution,assertOperationExecution} from './execution-stops.mts';
import {queueOperation} from './operation-store.mts';
import {LoyaltyBalances} from './loyalty-balances.mts';
import {LoyaltyFixtureSource,assertSeparateLoyaltyDatabases} from '../adapters/loyalty-fixture-source.mts';
import {LoyaltyRedemptionFixtureSource} from '../adapters/loyalty-redemption-fixture-source.mts';
import {loyaltyBinding,loyaltyEnvelope,loyaltyFreshness} from './loyalty-values.mts';
import {LOYALTY_REDEEM_ACTION,LOYALTY_REDEMPTION_CONTRACT,LOYALTY_QUOTE_KIND,LOYALTY_OPERATION_KIND,LOYALTY_RESERVATION_TTL,REDEMPTION_BINDING_FIELDS,redemptionShape,redemptionHash,redemptionHuman,redemptionBinding,redemptionBound,redemptionAccount,redemptionCatalog,redemptionBenefit,redemptionPoints,redemptionHistoryDigest,redemptionTerms,redemptionCommand,redemptionResult,redemptionOperationId} from './loyalty-redemption-values.mts';
import {loyaltyRecords,loyaltyQuoteRecord,loyaltyOperationRecord,saveLoyaltyRecord,loyaltyView,authorizeLoyaltyRead,transitionLoyalty} from './loyalty-redemption-records.mts';

const CONTEXT=['case_id','link_id','expected_generation'];
function contextInput(value:unknown,quote=false) {
  const p=redemptionShape(value,quote?[...CONTEXT,'points','unit','snapshot_digest','benefit_id']:CONTEXT);
  id(p.case_id);id(p.link_id);integer(p.expected_generation,1);
  if(quote){integer(p.points,1);id(p.benefit_id);redemptionHash(p.snapshot_digest);if(p.unit!=='points')throw new Error('LOYALTY_UNIT_UNSUPPORTED');}return p;
}
function sourceBinding(owner:LoyaltyRedemptions) {
  const source=owner.source.balanceSource;
  return redemptionBinding(loyaltyBinding({tenant_id:source.tenant,store_id:source.store,account_id:source.account,provider:source.provider}));
}
function observation(owner:LoyaltyRedemptions,s:Row,account:string,subject:string,current=true) {
  const source=owner.source;assertSeparateLoyaltyDatabases(owner.k.db,source.db);
  if(source.tenant!==s.tenant_id||source.store!==s.store_id)throw new Error('LOYALTY_SOURCE_SCOPE_MISMATCH');
  const value=redemptionShape(source.observeAccount(account),['schema_version',...REDEMPTION_BINDING_FIELDS,'account_key','subject_ref','anchor','current','benefits','journal','digest'],8*1024*1024),{digest:hash,...body}=value;
  redemptionBound(value,sourceBinding(owner));redemptionHash(hash);
  if(value.schema_version!==1||value.account_key!==account||value.subject_ref!==subject||redemptionHistoryDigest(body)!==hash)throw new Error('LOYALTY_HISTORY_INVALID');
  const parent=source.balanceSource,snapshot=loyaltyEnvelope(value.current,loyaltyBinding({tenant_id:parent.tenant,store_id:parent.store,account_id:parent.account,provider:parent.provider}),value.anchor.customer_id);
  if(value.anchor.subject_ref!==subject||value.anchor.account_key!==account||subjectHash(s.tenant_id,s.store_id,snapshot.customer_id)!==subject||!snapshot.complete)throw new Error('LOYALTY_HISTORY_INVALID');
  redemptionCatalog(value.benefits,sourceBinding(owner));
  if(current){const stale=loyaltyFreshness(snapshot,owner.k.clock());if(stale)throw new Error(stale);if(value.benefits.expires_at<=owner.k.clock())throw new Error('LOYALTY_TERMS_EXPIRED');
    if(!snapshot.capabilities.reserve||!snapshot.capabilities.redeem||!snapshot.capabilities.lookup)throw new Error('LOYALTY_REDEMPTION_UNSUPPORTED');}
  return value;
}
function capacity(owner:LoyaltyRedemptions,s:Row,view:Row,exclude:string|null=null) {
  const records=loyaltyRecords(owner.k,s),entries=new Map(view.journal.map((e:Row)=>[e.operation_id,e]));let held=0n,accounted=0n;
  for(const record of records.filter(r=>r.kind===LOYALTY_OPERATION_KIND&&r.body.account_key===view.account_key)){
    const b=record.body,value=loyaltyOperationRecord(owner.k,s,b.id)!,entry=entries.get(b.id) as Row|undefined;
    if(b.source_identity!==view.source_identity||b.subject_ref!==view.subject_ref||entry&&entry.command_digest!==b.command_digest)throw new Error('LOYALTY_HISTORY_INVALID');
    if(entry){redemptionResult(entry.result,value.command);if(contentDigest(entry.command)!==b.command_digest)throw new Error('LOYALTY_HISTORY_INVALID');}
    if(b.state==='redeemed'&&(!entry||entry.result.state!=='redeemed'||entry.result.digest!==b.observation.digest)||b.state==='rejected'&&(!entry||entry.result.state!=='rejected'||entry.result.digest!==b.observation.digest)||['reserved','released'].includes(b.state)&&entry)throw new Error('LOYALTY_HISTORY_INVALID');
    if(b.id!==exclude&&['reserved','unknown'].includes(b.state)){
      held+=BigInt(b.points);
      if(b.state==='unknown'&&entry?.result.state==='redeemed')accounted+=BigInt(b.points);
    }
  }
  const provider=BigInt(view.current.balances.available),effective=provider-(held-accounted);
  return {provider_available_points:redemptionPoints(provider),held_points:redemptionPoints(held),accounted_held_points:redemptionPoints(accounted),effective_available_points:redemptionPoints(effective)};
}
function currentTerms(owner:LoyaltyRedemptions,scope:Scope,record:Row,operation:Row|null=null,sourceCheck=true) {
  const k=owner.k,s=redemptionHuman(k,scope),b=record.body;
  if(b.minimized||b.authority_revoked||!b.terms||b.consumed_by!==(operation?.record.body.id??null))throw new Error('LOYALTY_QUOTE_UNAVAILABLE');
  const q=redemptionTerms(b.terms),now=k.clock();if(q.expires_at<=now)throw new Error('LOYALTY_TERMS_EXPIRED');
  if(q.tenant_id!==s.tenant_id||q.store_id!==s.store_id||q.source_identity!==owner.source.identity||q.source_account_id!==owner.source.account||q.balance_source_identity!==owner.source.balanceSource.identity)throw new Error('LOYALTY_SOURCE_SCOPE_MISMATCH');
  assertRecoveryEgress(k);const cases=new CaseConfigurations(k),c=cases.resume(scope,q.case_id);k.authorize(scope,'support.read',q.resource_id);
  const own=ownershipRow(k,s,c.id),member=k.db.prepare('SELECT * FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND active=1').get(s.tenant_id,s.store_id,q.owner) as Row;
  if(!own||own.owner!==q.owner||own.mode!=='human'||own.generation!==q.ownership_generation||!member||!['owner','operator','reviewer'].includes(member.role)||!permissionDecision(k.db,member,'action.propose',q.resource_id).allowed)throw new Error('SUPPORT_OWNERSHIP_CHANGED');
  const proof=k.db.prepare('SELECT * FROM commerce_sessions WHERE token_hash=?').get(q.proof_hash) as Row,rawCase=k.db.prepare('SELECT verification_hash FROM commerce_cases WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,c.id) as Row;
  if(!proof||rawCase.verification_hash!==q.proof_hash||proof.role!=='customer'||proof.revoked||proof.expires_at!==q.proof_expires_at||proof.expires_at<=now||proof.last_seen<=now-900000||proof.tenant_id!==s.tenant_id||proof.store_id!==s.store_id||proof.resource_id!==q.resource_id||proof.customer_id!==q.customer_id)throw new Error('CUSTOMER_VERIFICATION_REQUIRED');
  growthCustomerProof(k,proof,q.resource_id,q.customer_id);
  const link=new SupportConversations(k).linkRecord(scope,q.link_id),settings=k.db.prepare('SELECT * FROM commerce_execution_settings WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row;
  if(!settings?.enabled||settings.revision!==q.capability_revision||c.pins.profile.id!==settings.profile_id||c.pins.policy.policy_id!==settings.policy_id)throw new Error('CAPABILITY_UNAVAILABLE');
  if(c.id!==q.case_id||c.resource_id!==q.resource_id||c.customer_id!==q.customer_id||c.revision!==q.case_revision||c.configuration_digest!==q.configuration_digest||c.pins.policy.digest!==q.policy_digest||c.order.source_version!==q.resource_version||contentDigest(c.order)!==q.resource_digest||contentDigest(link)!==q.link_digest||link.customer_id!==q.customer_id||link.case_id!==q.case_id||link.resource_id!==q.resource_id)throw new Error('LOYALTY_CONTEXT_CHANGED');
  assertExecution(k,s,LOYALTY_REDEEM_ACTION,q.control_stamp);
  if(operation){
    assertOperationExecution(k,s,operation.native);const a=operation.approval,r=operation.preview;
    const approver=a&&k.db.prepare('SELECT * FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND active=1').get(s.tenant_id,s.store_id,a.approver) as Row;
    const authority=approver&&permissionDecision(k.db,approver,'action.approve',q.resource_id);
    if(!a||!r||a.revoked||a.uses!==1||a.max_uses!==1||a.expires_at<=now||!approver||!['owner','operator','reviewer'].includes(approver.role)||!authority?.allowed||authority.authority_revision!==a.authority_revision||a.approver===r.proposer||r.proposer!==q.owner)throw new Error('APPROVAL_AUTHORITY_CHANGED');
  }
  let view:Row|null=null;
  if(sourceCheck){
    view=observation(owner,s,q.account_key,q.subject_ref);const snapshot=view.current,catalog=view.benefits,benefit=catalog.benefits.find((b:Row)=>b.id===q.benefit.id);
    if(snapshot.digest!==q.snapshot_digest||snapshot.source_revision!==q.source_revision)throw new Error('LOYALTY_SNAPSHOT_CHANGED');
    if(snapshot.rules.revision!==q.rules_revision||contentDigest(snapshot.rules)!==q.rules_digest)throw new Error('LOYALTY_RULES_CHANGED');
    if(catalog.revision!==q.benefits_revision||catalog.digest!==q.benefits_digest||!benefit||contentDigest(benefit)!==q.benefit_digest||benefit.points!==q.points)throw new Error('LOYALTY_BENEFIT_CHANGED');
    if(capacity(owner,s,view,operation?.record.body.id??null).effective_available_points<q.points)throw new Error('LOYALTY_INSUFFICIENT_POINTS');
  }
  return {s,q,c,view};
}

export function assertLoyaltyRedemptionOwner(k:CommerceKernel,value:unknown):LoyaltyRedemptions {
  if(!(value instanceof LoyaltyRedemptions)||value.k!==k)throw new Error('LOYALTY_SOURCE_OWNER_MISMATCH');return value;
}

export class LoyaltyRedemptions {
  readonly k:CommerceKernel;readonly balances:LoyaltyBalances;readonly source:LoyaltyRedemptionFixtureSource;
  constructor(k:CommerceKernel,owners:{balances:LoyaltyBalances;source:LoyaltyRedemptionFixtureSource}) {
    exact(owners,['balances','source']);
    if(!(owners.balances instanceof LoyaltyBalances)||owners.balances.k!==k||!(owners.balances.source instanceof LoyaltyFixtureSource)||!(owners.source instanceof LoyaltyRedemptionFixtureSource)||owners.source.balanceSource!==owners.balances.source)throw new Error('LOYALTY_SOURCE_OWNER_MISMATCH');
    assertSeparateLoyaltyDatabases(k.db,owners.source.db);this.k=k;this.balances=owners.balances;this.source=owners.source;Object.freeze(this);
  }
  #context(scope:Scope,proof:Scope,p:Row) {
    const k=this.k,s=redemptionHuman(k,scope),base=this.balances.context(scope,proof,{case_id:p.case_id,link_id:p.link_id,expected_generation:p.expected_generation});
    if(base.status!=='available'||!base.snapshot)throw new Error(base.reason);
    const subject=subjectHash(s.tenant_id,s.store_id,base.snapshot.customer_id),account=redemptionAccount(sourceBinding(this),subject),view=observation(this,s,account,subject);
    if(view.current.digest!==base.snapshot_digest)throw new Error('LOYALTY_SNAPSHOT_CHANGED');
    return {schema_version:1,case_id:base.case_id,resource_id:base.resource_id,account_key:account,source_identity:this.source.identity,snapshot_digest:view.current.digest,status:'available',reason:'LOYALTY_CURRENT_ENTITLEMENT',...capacity(this,s,view),benefits:view.benefits.benefits,execution_authorized:false,production_qualified:false};
  }
  context(scope:Scope,proof:Scope,value:unknown) {const p=contextInput(value);return this.k.transaction(()=>this.#context(scope,proof,p));}
  quote(scope:Scope,proof:Scope,value:unknown) {
    const p=contextInput(value,true),k=this.k;return k.transaction(()=>{
      const s=redemptionHuman(k,scope),view=this.#context(scope,proof,p);k.authorize(scope,'action.propose',view.resource_id);
      if(p.snapshot_digest!==view.snapshot_digest)throw new Error('LOYALTY_SNAPSHOT_CHANGED');if(p.points>view.effective_available_points)throw new Error('LOYALTY_INSUFFICIENT_POINTS');
      const provider=observation(this,s,view.account_key,subjectHash(s.tenant_id,s.store_id,new CaseConfigurations(k).inspect(scope,p.case_id).customer_id)),snapshot=provider.current,benefit=provider.benefits.benefits.find((b:Row)=>b.id===p.benefit_id),rules=snapshot.rules;
      if(!benefit||benefit.points!==p.points)throw new Error('LOYALTY_BENEFIT_CHANGED');
      if(p.points<rules.minimum_redemption||p.points>rules.maximum_redemption||BigInt(p.points)%BigInt(rules.redemption_step)!==0n)throw new Error('LOYALTY_REDEMPTION_RULES');
      const c=new CaseConfigurations(k).resume(scope,p.case_id),v=k.require(proof),own=ownershipRow(k,s,c.id),link=new SupportConversations(k).linkRecord(scope,p.link_id),settings=k.db.prepare('SELECT * FROM commerce_execution_settings WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row;
      if(!settings?.enabled||c.pins.profile.id!==settings.profile_id||c.pins.policy.policy_id!==settings.policy_id)throw new Error('CAPABILITY_UNAVAILABLE');
      if(!own||own.mode!=='human'||own.owner!==s.actor_id||own.generation!==p.expected_generation)throw new Error('SUPPORT_OWNERSHIP_CHANGED');
      const now=k.clock(),quoteId='lq_'+token().slice(0,32),expires=Math.min(now+LOYALTY_RESERVATION_TTL,v.expires_at,snapshot.expires_at,rules.expires_at,provider.benefits.expires_at),control=assertExecution(k,s,LOYALTY_REDEEM_ACTION);
      const q=redemptionTerms({schema_version:1,quote_id:quoteId,tenant_id:s.tenant_id,store_id:s.store_id,case_id:c.id,resource_id:c.resource_id,customer_id:c.customer_id,subject_ref:provider.subject_ref,account_key:view.account_key,source_identity:this.source.identity,source_account_id:this.source.account,balance_source_identity:this.source.balanceSource.identity,points:p.points,unit:'points',benefit,benefit_digest:contentDigest(benefit),benefits_revision:provider.benefits.revision,benefits_digest:provider.benefits.digest,source_revision:snapshot.source_revision,snapshot_digest:snapshot.digest,rules_revision:rules.revision,rules_digest:contentDigest(rules),configuration_digest:c.configuration_digest,policy_digest:c.pins.policy.digest,case_revision:c.revision,resource_version:c.order.source_version,resource_digest:contentDigest(c.order),owner:own.owner,ownership_generation:own.generation,proof_hash:v.token_hash,proof_expires_at:v.expires_at,link_id:link.id,link_digest:contentDigest(link),capability_revision:settings.revision,control_stamp:control.stamp,created_at:now,expires_at:expires,financial_effect:false});
      const body={schema_version:1,kind:LOYALTY_QUOTE_KIND,id:quoteId,tenant_id:s.tenant_id,store_id:s.store_id,subject_ref:q.subject_ref,account_key:q.account_key,source_identity:q.source_identity,source_account_id:q.source_account_id,resource_id:q.resource_id,points:q.points,unit:'points',benefit_id:q.benefit.id,benefit_digest:q.benefit_digest,created_at:now,expires_at:expires,authority_revoked:false,minimized:false,terms_digest:contentDigest(q),consumed_by:null,terms:q};
      currentTerms(this,scope,{body});saveLoyaltyRecord(k,body);return {id:quoteId,digest:body.terms_digest,quote:q,approval_required:true,execution_authorized:false};
    });
  }
  #operation(scope:Scope,operationId:string) {
    const s=redemptionHuman(this.k,scope),value=loyaltyOperationRecord(this.k,s,id(operationId));
    if(!value)throw new Error('NOT_FOUND');
    if(value.command.source_identity!==this.source.identity||value.command.source_account_id!==this.source.account||this.source.tenant!==s.tenant_id||this.source.store!==s.store_id)throw new Error('LOYALTY_SOURCE_SCOPE_MISMATCH');
    assertSeparateLoyaltyDatabases(this.k.db,this.source.db);return {s,value};
  }
  read(scope:Scope,operationId:string) {
    return this.k.transaction(()=>{const {value}=this.#operation(scope,operationId);authorizeLoyaltyRead(this.k,scope,value);return loyaltyView(value);});
  }
  dispatch(scope:Scope,operationId:string) {
    const k=this.k;
    const first=k.transaction(()=>{
      const {s,value}=this.#operation(scope,operationId),b=value.record.body;
      k.authorize(scope,'operation.dispatch',b.resource_id);k.authorize(scope,'action.execute',b.resource_id);
      if(b.minimized||b.restored||b.authority_revoked)throw new Error('LOYALTY_ISSUE_AUTHORITY_REVOKED');
      if(b.state!=='reserved')return {finished:true,view:loyaltyView(value)};
      currentTerms(this,scope,value.quote,value);
      transitionLoyalty(k,s,value,'unknown','LOYALTY_OUTCOME_UNKNOWN',null,1);return {finished:false,view:null};
    });
    if(first.finished)return first.view;
    try {
      // A distinct durable transaction above records uncertainty first. This
      // lock now spans final authorization, synchronous source call and local
      // completion. A source commit can survive a rollback here.
      return k.transaction(()=>{
        const {s,value}=this.#operation(scope,operationId),b=value.record.body;
        k.authorize(scope,'operation.dispatch',b.resource_id);k.authorize(scope,'action.execute',b.resource_id);
        currentTerms(this,scope,value.quote,value);
        const outcome=redemptionResult(this.source.redeem(value.command),value.command);
        if(outcome.observed_at>k.clock())throw new Error('LOYALTY_RESULT_INVALID');
        currentTerms(this,scope,value.quote,value,false);
        transitionLoyalty(k,s,value,outcome.state,outcome.reason,outcome);return loyaltyView(loyaltyOperationRecord(k,s,b.id)!);
      });
    }catch(error){
      // No return value or timeout can prove absence of an effect. The first
      // committed unknown survives both source and completion failures.
      if(error instanceof Error&&['LOYALTY_TIMEOUT_BEFORE_EFFECT','LOYALTY_TIMEOUT_AFTER_EFFECT'].includes(error.message))return this.read(scope,operationId);
      throw error;
    }
  }
  reconcile(scope:Scope,operationId:string) {
    const k=this.k;return k.transaction(()=>{
      const {value}=this.#operation(scope,operationId),s=authorizeLoyaltyRead(k,scope,value,true),b=value.record.body;
      if(b.state!=='unknown')return {disposition:'unchanged',operation:loyaltyView(value),command_repeated:false};
      const raw=this.source.lookup(b.id);
      if(raw===null)return {disposition:'unconfirmed',operation:loyaltyView(value),command_repeated:false};
      const outcome=redemptionResult(raw,value.command);if(outcome.observed_at>k.clock())throw new Error('LOYALTY_RESULT_INVALID');
      authorizeLoyaltyRead(k,scope,value,true);transitionLoyalty(k,s,value,outcome.state,outcome.reason,outcome);
      return {disposition:'reconciled',operation:loyaltyView(loyaltyOperationRecord(k,s,b.id)!),command_repeated:false};
    });
  }
  expire(scope:Scope,operationId:string) {
    const k=this.k;return k.transaction(()=>{
      const {s,value}=this.#operation(scope,operationId),b=value.record.body;k.authorize(scope,'operation.dispatch',b.resource_id);
      if(b.minimized||b.restored||b.authority_revoked)throw new Error('LOYALTY_ISSUE_AUTHORITY_REVOKED');
      if(b.state!=='reserved'||b.expires_at>k.clock())return loyaltyView(value);
      if(b.attempt_count!==0||value.history.some((r:Row)=>!['queued','payload_attached','payload_erased'].includes(r.code)))throw new Error('LOYALTY_RESERVATION_UNCERTAIN');
      observation(this,s,b.account_key,b.subject_ref,false);
      if(this.source.lookup(b.id)!==null)throw new Error('LOYALTY_RESERVATION_UNCERTAIN');
      transitionLoyalty(k,s,value,'released','LOYALTY_RESERVATION_EXPIRED');return loyaltyView(loyaltyOperationRecord(k,s,b.id)!);
    });
  }
}

/** Trusted gateway integration: immutable previews contain typed points and a
 * synthetic benefit. Current availability is checked but never hashed into it. */
export function loyaltyGatewayQuote(owner:LoyaltyRedemptions,scope:Scope,proposal:Row,quotedAt:number) {
  const k=owner.k,s=redemptionHuman(k,scope),a=redemptionShape(proposal.arguments,['quote_id','quote_digest']),record=loyaltyQuoteRecord(k,s,id(a.quote_id));redemptionHash(a.quote_digest);
  if(record.body.terms_digest!==a.quote_digest)throw new Error('LOYALTY_QUOTE_CHANGED');
  const {q}=currentTerms(owner,scope,record);if(q.case_id!==proposal.case_id)throw new Error('LOYALTY_QUOTE_CHANGED');integer(quotedAt);
  return {schema_version:1,tenant_id:s.tenant_id,store_id:s.store_id,case_id:q.case_id,case_revision:q.case_revision,configuration_digest:q.configuration_digest,resource_id:q.resource_id,resource_version:q.resource_version,source_digest:q.snapshot_digest,customer_id:q.customer_id,action:LOYALTY_REDEEM_ACTION,arguments:a,points:{unit:'points',quantity:q.points},benefit:q.benefit,readiness_digest:contentDigest({qualification:'synthetic_loyalty_only',source_identity:q.source_identity,contract:LOYALTY_REDEMPTION_CONTRACT}),control_stamp:q.control_stamp,capability_revision:q.capability_revision,adapter_contract_digest:contentDigest({contract:LOYALTY_REDEMPTION_CONTRACT,action:LOYALTY_REDEEM_ACTION}),policy_digest:q.policy_digest,quoted_at:quotedAt,expires_at:q.expires_at,max_uses:1,financial_effect:false};
}
export function commitLoyaltyRedemption(owner:LoyaltyRedemptions,scope:Scope,preview:Row,previewRow:Row,approval:Row,receiptId:string) {
  const k=owner.k,s=redemptionHuman(k,scope),record=loyaltyQuoteRecord(k,s,preview.arguments.quote_id),{q}=currentTerms(owner,scope,record);
  if(record.body.terms_digest!==preview.arguments.quote_digest||q.owner!==s.actor_id||previewRow.proposer!==q.owner||approval.approver===q.owner)throw new Error('LOYALTY_QUOTE_CHANGED');
  const operationId=redemptionOperationId(s.tenant_id,s.store_id,receiptId),receipt={id:receiptId,case_id:q.case_id,preview_id:previewRow.id,preview_digest:previewRow.digest,approval_id:approval.id,configuration_digest:q.configuration_digest,case_revision:q.case_revision,resource_version:q.resource_version,actor_id:s.actor_id,authority_revision:permissionDecision(k.db,s,'action.execute',q.resource_id).authority_revision,effect:'synthetic_loyalty_authorized',loyalty_operation_id:operationId,points:{unit:'points',quantity:q.points},benefit:q.benefit,state:'reserved',financial_effect:false,approval_consumed:true,completed_at:k.clock()};
  const command=redemptionCommand({schema_version:1,action:LOYALTY_REDEEM_ACTION,operation_id:operationId,tenant_id:s.tenant_id,store_id:s.store_id,resource_id:q.resource_id,source_id:receiptId,source_digest:contentDigest(receipt),source_identity:q.source_identity,source_account_id:q.source_account_id,account_key:q.account_key,subject_ref:q.subject_ref,quote_id:q.quote_id,quote_digest:record.body.terms_digest,points:q.points,unit:'points',benefit_id:q.benefit.id,benefit_digest:q.benefit_digest,benefits_revision:q.benefits_revision,benefits_digest:q.benefits_digest,source_revision:q.source_revision,snapshot_digest:q.snapshot_digest,rules_revision:q.rules_revision,rules_digest:q.rules_digest,expires_at:q.expires_at,financial_effect:false});
  k.db.prepare('INSERT INTO commerce_action_receipts VALUES(?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,receipt.id,q.case_id,previewRow.id,canonical(receipt),contentDigest(receipt));
  const op=queueOperation(k,s,q.resource_id,'case',receiptId,command,{configuration_digest:q.configuration_digest,policy_digest:q.policy_digest,approval_ref:approval.id});
  if(op.id!==operationId)throw new Error('LOYALTY_REDEMPTION_INTEGRITY');
  k.db.prepare('INSERT INTO commerce_operation_targets VALUES(?,?,?,?,?,?)').run(s.tenant_id,s.store_id,op.id,q.source_account_id,q.source_identity,LOYALTY_REDEMPTION_CONTRACT);
  saveLoyaltyRecord(k,{...record.body,consumed_by:op.id},true);
  const body={schema_version:1,kind:LOYALTY_OPERATION_KIND,id:op.id,tenant_id:s.tenant_id,store_id:s.store_id,subject_ref:q.subject_ref,account_key:q.account_key,source_identity:q.source_identity,source_account_id:q.source_account_id,resource_id:q.resource_id,points:q.points,unit:'points',benefit_id:q.benefit.id,benefit_digest:q.benefit_digest,created_at:op.created_at,expires_at:q.expires_at,authority_revoked:false,minimized:false,quote_id:q.quote_id,quote_digest:record.body.terms_digest,command_digest:contentDigest(command),state:'reserved',reason:'LOYALTY_RESERVED',attempt_count:0,native_revision:op.revision,restored:false,personal:{case_id:q.case_id,receipt_id:receiptId,preview_id:previewRow.id,preview_digest:previewRow.digest,approval_id:approval.id,executor:s.actor_id,approver:approval.approver},observation:null};
  saveLoyaltyRecord(k,body);loyaltyOperationRecord(k,s,op.id);return receipt;
}
