import {CommerceKernel,exact,id,integer,token} from './kernel.mts';
import type {Scope,Row} from './kernel.mts';
import {canonical,contentDigest} from './configuration-values.mts';
import {CaseConfigurations} from './case-configurations.mts';
import {permissionDecision} from './authorization.mts';
import {assertRecoveryEgress,subjectHash} from './data-guards.mts';
import {ownershipRow} from './support-core.mts';
import {fulfillmentContext} from './return-fulfillment-core.mts';
import {assertExecution,assertOperationExecution} from './execution-stops.mts';
import {queueOperation} from './operation-store.mts';
import {DropoffChoices} from './dropoff-choices.mts';
import {DropoffCredentialFixtureSource} from '../adapters/dropoff-credential-fixture-source.mts';
import {DROPOFF_ISSUE_ACTION,DROPOFF_REVOKE_ACTION,DROPOFF_CREDENTIAL_CONTRACT,DROPOFF_QUOTE_KIND,DROPOFF_OPERATION_KIND,DROPOFF_BINDING_FIELDS,DROPOFF_QUOTE_TTL,DROPOFF_CREDENTIAL_TTL,dropoffShape,dropoffHash,dropoffHuman,dropoffFamily,dropoffPick,dropoffTerms,dropoffCommand,dropoffResult,dropoffStatus,dropoffOperationId} from './dropoff-credential-values.mts';
import {dropoffRecords,dropoffQuoteRecord,dropoffOperationRecord,saveDropoffRecord,dropoffView,authorizeDropoffRead,transitionDropoff} from './dropoff-credential-records.mts';
import {bindDropoffPrivacySource} from './dropoff-credential-privacy.mts';

function currentCredential(owner:DropoffCredentials,value:Row) {
  if(value.record.body.state!=='issued'||value.command.action!==DROPOFF_ISSUE_ACTION)throw new Error('DROPOFF_ISSUE_REQUIRED');
  const startedAt=owner.k.clock(),raw=owner.source.credential(value.native.id);if(raw===null)throw new Error('DROPOFF_CREDENTIAL_UNCONFIRMED');return dropoffStatus(raw,value.command,value.record.body.observation,owner.k.clock(),startedAt);
}
/** Family membership is request-wide, including changed method/source choices.
 * Uncertainty is resolved only by explicit original-operation reconciliation. */
function family(owner:DropoffCredentials,s:Row,familyRef:string,exclude:string|null=null) {
  const values=dropoffRecords(owner.k,s).filter(r=>r.kind===DROPOFF_OPERATION_KIND&&r.body.family_ref===familyRef&&r.id!==exclude).map(r=>dropoffOperationRecord(owner.k,s,r.id)!);
  // Core family fence: the assigned isolated fault removes this exact guard.
  if(values.some(v=>['authorized','unknown'].includes(v.record.body.state)))throw new Error('DROPOFF_FAMILY_UNRESOLVED');
  const issued=values.filter(v=>v.record.body.state==='issued').sort((a,b)=>a.command.generation-b.command.generation||a.native.id.localeCompare(b.native.id));
  if(new Set(issued.map(v=>v.command.generation)).size!==issued.length)throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');
  return {values,latest:issued.at(-1)??null};
}
function issueFamily(owner:DropoffCredentials,s:Row,q:Row,exclude:string|null=null) {
  const {latest}=family(owner,s,q.family_ref,exclude);
  if(!latest){if(q.replaces_operation_id!==null||q.generation!==1)throw new Error('DROPOFF_REPLACEMENT_CHANGED');return;}
  if(latest.native.id!==q.replaces_operation_id||q.generation!==latest.command.generation+1)throw new Error('DROPOFF_REPLACEMENT_REQUIRED');
  const status=currentCredential(owner,latest);if(!['expired','revoked'].includes(status.state)||status.replaced_by!==null)throw new Error('DROPOFF_REPLACEMENT_BLOCKED');
}
function currentTerms(owner:DropoffCredentials,scope:Scope,record:Row,operation:Row|null=null,sourceCheck=true,allowExpired=false) {
  const k=owner.k,s=dropoffHuman(k,scope),b=record.body;DropoffCredentials.assertOwner(k,owner);
  if(b.minimized||b.authority_revoked||!b.terms||b.consumed_by!==(operation?.record.body.id??null)||operation&&(operation.record.body.authority_revoked||operation.record.body.restored))throw new Error('DROPOFF_AUTHORITY_REVOKED');
  const q=dropoffTerms(b.terms),now=integer(k.clock());
  if(!allowExpired&&q.expires_at<=now)throw new Error('DROPOFF_TERMS_EXPIRED');
  if(q.tenant_id!==s.tenant_id||q.store_id!==s.store_id||q.source_identity!==owner.source.identity||q.source_account_id!==owner.source.account||q.directory_identity!==owner.source.directory.identity||owner.source.tenant!==s.tenant_id||owner.source.store!==s.store_id)throw new Error('DROPOFF_SOURCE_SCOPE');
  assertRecoveryEgress(k);const ctx=fulfillmentContext(k,scope,q.case_id,q.request_id),c=ctx.c;k.authorize(scope,'support.read',q.resource_id);
  const own=ownershipRow(k,s,c.id),member=k.db.prepare('SELECT * FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND active=1').get(s.tenant_id,s.store_id,q.owner) as Row;
  if(!own||own.mode!=='human'||own.owner!==q.owner||own.generation!==q.ownership_generation||!member||member.role!==q.owner_role||!['owner','operator','reviewer'].includes(member.role)||!permissionDecision(k.db,member,'action.propose',q.resource_id).allowed||!permissionDecision(k.db,member,'support.read',q.resource_id).allowed)throw new Error('SUPPORT_OWNERSHIP_CHANGED');
  if(s.actor_id!==q.owner)k.authorize(scope,'action.approve',q.resource_id);
  const proof=k.db.prepare('SELECT * FROM commerce_sessions WHERE token_hash=?').get(q.proof_hash) as Row,rawCase=k.db.prepare('SELECT verification_hash FROM commerce_cases WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,c.id) as Row;
  if(!proof||rawCase.verification_hash!==q.proof_hash||proof.role!=='customer'||proof.revoked||proof.expires_at!==q.proof_expires_at||proof.expires_at<=now||proof.last_seen<=now-900000||proof.last_seen>now||proof.tenant_id!==s.tenant_id||proof.store_id!==s.store_id||proof.resource_id!==q.resource_id||proof.customer_id!==q.customer_id)throw new Error('CUSTOMER_VERIFICATION_REQUIRED');
  new CaseConfigurations(k).verified(scope,c.id);
  const settings=k.db.prepare('SELECT * FROM commerce_execution_settings WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row;
  if(!settings?.enabled||settings.revision!==q.capability_revision||c.pins.profile.id!==settings.profile_id||c.pins.policy.policy_id!==settings.policy_id)throw new Error('CAPABILITY_UNAVAILABLE');
  if(c.id!==q.case_id||c.resource_id!==q.resource_id||c.customer_id!==q.customer_id||c.revision!==q.case_revision||c.configuration_digest!==q.configuration_digest||c.pins.policy.digest!==q.policy_digest||c.order.source_version!==q.resource_version||contentDigest(c.order)!==q.resource_digest||ctx.request.digest!==q.request_digest||ctx.native.native_digest!==q.native_return_digest)throw new Error('DROPOFF_CONTEXT_CHANGED');
  assertExecution(k,s,q.action,q.control_stamp);
  if(operation&&!allowExpired){
    assertOperationExecution(k,s,operation.native);const a=operation.approval,r=operation.preview,approver=a&&k.db.prepare('SELECT * FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND active=1').get(s.tenant_id,s.store_id,a.approver) as Row,authority=approver&&permissionDecision(k.db,approver,'action.approve',q.resource_id);
    if(s.actor_id!==q.owner||!a||!r||a.revoked||a.uses!==1||a.max_uses!==1||a.expires_at<=now||!approver||!['owner','operator','reviewer'].includes(approver.role)||!authority?.allowed||authority.authority_revision!==a.authority_revision||a.approver===r.proposer||r.proposer!==q.owner)throw new Error('APPROVAL_AUTHORITY_CHANGED');
  }
  if(sourceCheck){
    if(q.action===DROPOFF_ISSUE_ACTION){
      const view=s.actor_id===q.owner?owner.choices.quote(scope,{request_id:q.request_id}):owner.choices.review(scope,{quote_id:q.quote_id}),method=view.choices.find((m:Row)=>m.choice_id===q.method.choice_id);
      if(view.source_digest!==q.source_digest||!method||contentDigest(method)!==q.method_digest||contentDigest(view.items)!==q.items_digest)throw new Error('DROPOFF_CHOICE_CHANGED');issueFamily(owner,s,q,operation?.native.id??null);
    }else {
      const {latest}=family(owner,s,q.family_ref,operation?.native.id??null),issued=dropoffOperationRecord(k,s,q.issue_operation_id);
      if(!issued||latest?.native.id!==issued.native.id||issued.record.body.authority_revoked||issued.record.body.restored||issued.record.body.minimized)throw new Error('DROPOFF_REVOKE_UNAVAILABLE');
      for(const key of ['source_identity','source_account_id','family_ref','subject_ref','resource_id','items_digest','method_digest','fees_digest','generation','credential_expires_at'])if(q[key]!==issued.command[key])throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');
      const status=currentCredential(owner,issued);if(status.state!=='active'||status.replaced_by!==null)throw new Error('DROPOFF_REVOKE_UNAVAILABLE');
    }
  }return {s,q,c};
}

export class DropoffCredentials {
  readonly k:CommerceKernel;readonly choices:DropoffChoices;readonly source:DropoffCredentialFixtureSource;#core:unknown;
  constructor(k:CommerceKernel,owners:{choices:DropoffChoices;source:DropoffCredentialFixtureSource}) {
    exact(owners,['choices','source']);if(!(k instanceof CommerceKernel)||!(owners.source instanceof DropoffCredentialFixtureSource))throw new Error('DROPOFF_OWNER_MISMATCH');
    this.k=k;this.choices=owners.choices;this.source=owners.source;this.#core=k.db;this.#owners();bindDropoffPrivacySource(k,this.source);Object.freeze(this);
  }
  static assertOwner(k:CommerceKernel,value:unknown):DropoffCredentials {
    if(!(value instanceof DropoffCredentials)||!(#core in value)||value.k!==k)throw new Error('DROPOFF_OWNER_MISMATCH');value.#owners();return value;
  }
  #owners(){if(this.k.db!==this.#core||DropoffChoices.assertOwner(this.k,this.choices).source!==this.source.directory)throw new Error('DROPOFF_OWNER_MISMATCH');DropoffCredentialFixtureSource.prototype.assertAttached.call(this.source,this.k.db);}
  #quote(scope:Scope,ctx:Row,selected:Row,action:string,generation:number,replaces:string|null,issue:string|null,expires:number) {
    const k=this.k,s=dropoffHuman(k,scope),c=ctx.c;this.#owners();assertRecoveryEgress(k);k.authorize(scope,'action.propose',c.resource_id);k.authorize(scope,'support.read',c.resource_id);
    if(s.tenant_id!==this.source.tenant||s.store_id!==this.source.store)throw new Error('DROPOFF_SOURCE_SCOPE');
    const own=ownershipRow(k,s,c.id),settings=k.db.prepare('SELECT * FROM commerce_execution_settings WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row;
    if(!own||own.mode!=='human'||own.owner!==s.actor_id)throw new Error('SUPPORT_OWNERSHIP_CHANGED');
    if(!settings?.enabled||c.pins.profile.id!==settings.profile_id||c.pins.policy.policy_id!==settings.policy_id)throw new Error('CAPABILITY_UNAVAILABLE');
    new CaseConfigurations(k).verified(scope,c.id);const proof=k.db.prepare('SELECT ss.* FROM commerce_sessions ss JOIN commerce_cases c ON c.verification_hash=ss.token_hash WHERE c.tenant_id=? AND c.store_id=? AND c.id=?').get(s.tenant_id,s.store_id,c.id) as Row;
    if(!proof||proof.role!=='customer')throw new Error('CUSTOMER_VERIFICATION_REQUIRED');
    const now=integer(k.clock()),quoteId='dq_'+token().slice(0,32),method=selected.method,control=assertExecution(k,s,action);
    const q=dropoffTerms({schema_version:1,quote_id:quoteId,tenant_id:s.tenant_id,store_id:s.store_id,resource_id:c.resource_id,source_identity:this.source.identity,source_account_id:this.source.account,directory_identity:this.source.directory.identity,family_ref:dropoffFamily(s.tenant_id,s.store_id,ctx.request.id),subject_ref:subjectHash(s.tenant_id,s.store_id,c.customer_id),action,items_digest:contentDigest(selected.items),method_digest:contentDigest(method),fees_digest:contentDigest(method.fees),site_id:method.site_id,destination_id:method.destination_id,method_id:method.method_id,credential_kind:method.credential_kind,generation,replaces_operation_id:replaces,issue_operation_id:issue,expires_at:Math.min(now+DROPOFF_QUOTE_TTL,proof.expires_at,proof.last_seen+900000,expires),credential_expires_at:action===DROPOFF_ISSUE_ACTION?now+DROPOFF_CREDENTIAL_TTL:selected.credential_expires_at,case_id:c.id,request_id:ctx.request.id,customer_id:c.customer_id,items:selected.items,method,source_digest:selected.source_digest,request_digest:ctx.request.digest,native_return_digest:ctx.native.native_digest,configuration_digest:c.configuration_digest,policy_digest:c.pins.policy.digest,case_revision:c.revision,resource_version:c.order.source_version,resource_digest:contentDigest(c.order),owner:own.owner,owner_role:s.role,ownership_generation:own.generation,proof_hash:proof.token_hash,proof_expires_at:proof.expires_at,capability_revision:settings.revision,control_stamp:control.stamp,created_at:now,financial_effect:false});
    const body={schema_version:1,kind:DROPOFF_QUOTE_KIND,id:quoteId,...dropoffPick(q,DROPOFF_BINDING_FIELDS),created_at:now,authority_revoked:false,minimized:false,source_cleanup:'not_requested',terms_digest:contentDigest(q),consumed_by:null,terms:q};
    currentTerms(this,scope,{body});saveDropoffRecord(k,body);return {id:quoteId,digest:body.terms_digest,quote:q,approval_required:true,execution_authorized:false};
  }
  quote(scope:Scope,input:unknown) {
    const p=dropoffShape(input,['request_id','choice_id','expected_source_digest','replaces_operation_id']);id(p.request_id);dropoffHash(p.choice_id);dropoffHash(p.expected_source_digest);if(p.replaces_operation_id!==null)id(p.replaces_operation_id);
    return this.k.transaction(()=>{
      const s=dropoffHuman(this.k,scope);this.#owners();const view=this.choices.quote(scope,{request_id:p.request_id}),method=view.choices.find((m:Row)=>m.choice_id===p.choice_id);
      if(view.source_digest!==p.expected_source_digest||!method)throw new Error('DROPOFF_CHOICE_CHANGED');
      const ctx=fulfillmentContext(this.k,scope,view.case_id,p.request_id),latest=family(this,s,dropoffFamily(s.tenant_id,s.store_id,p.request_id)).latest;
      return this.#quote(scope,ctx,{items:view.items,method,source_digest:view.source_digest},DROPOFF_ISSUE_ACTION,(latest?.command.generation??0)+1,p.replaces_operation_id,null,view.expires_at);
    });
  }
  quoteRevoke(scope:Scope,input:unknown) {
    const p=dropoffShape(input,['issue_operation_id']);id(p.issue_operation_id);
    return this.k.transaction(()=>{
      const {value}=this.#operation(scope,p.issue_operation_id),b=value.record.body;if(b.state!=='issued'||b.authority_revoked||b.minimized||b.restored)throw new Error('DROPOFF_REVOKE_UNAVAILABLE');
      const q=value.quote.body.terms,ctx=fulfillmentContext(this.k,scope,q.case_id,q.request_id);
      return this.#quote(scope,ctx,q,DROPOFF_REVOKE_ACTION,b.generation,b.replaces_operation_id,b.id,Number.MAX_SAFE_INTEGER);
    });
  }
  #operation(scope:Scope,operationId:string) {
    const s=dropoffHuman(this.k,scope);this.#owners();const value=dropoffOperationRecord(this.k,s,id(operationId));if(!value)throw new Error('NOT_FOUND');
    if(value.command.source_identity!==this.source.identity||value.command.source_account_id!==this.source.account||s.tenant_id!==this.source.tenant||s.store_id!==this.source.store)throw new Error('DROPOFF_SOURCE_SCOPE');return {s,value};
  }
  read(scope:Scope,operationId:string){return this.k.transaction(()=>{const {value}=this.#operation(scope,operationId);authorizeDropoffRead(this.k,scope,value);return dropoffView(value);});}
  dispatch(scope:Scope,operationId:string) {
    const k=this.k,first=k.transaction(()=>{
      const {s,value}=this.#operation(scope,operationId),b=value.record.body;k.authorize(scope,'operation.dispatch',b.resource_id);k.authorize(scope,'action.execute',b.resource_id);
      if(b.authority_revoked||b.minimized||b.restored)throw new Error('DROPOFF_AUTHORITY_REVOKED');
      if(b.state!=='authorized')return {finished:true,view:dropoffView(value)};
      currentTerms(this,scope,value.quote,value);transitionDropoff(k,s,value,'unknown','DROPOFF_OUTCOME_UNKNOWN',null,1);return {finished:false,view:null};
    });
    if(first.finished)return first.view;
    try{return k.transaction(()=>{
      const {s,value}=this.#operation(scope,operationId),b=value.record.body;k.authorize(scope,'operation.dispatch',b.resource_id);k.authorize(scope,'action.execute',b.resource_id);currentTerms(this,scope,value.quote,value);
      const raw=b.action===DROPOFF_ISSUE_ACTION?this.source.issue(value.command):this.source.revoke(value.command),result=dropoffResult(raw,value.command);
      if(result.observed_at>k.clock())throw new Error('DROPOFF_RESULT_INVALID');currentTerms(this,scope,value.quote,value,false);
      transitionDropoff(k,s,value,result.state,result.reason,result);return dropoffView(dropoffOperationRecord(k,s,b.id)!);
    });}catch(error){if(error instanceof Error&&['DROPOFF_TIMEOUT_BEFORE_EFFECT','DROPOFF_TIMEOUT_AFTER_EFFECT'].includes(error.message))return this.read(scope,operationId);throw error;}
  }
  reconcile(scope:Scope,operationId:string) {
    return this.k.transaction(()=>{
      const {value}=this.#operation(scope,operationId),s=authorizeDropoffRead(this.k,scope,value,true),b=value.record.body;
      if(b.state!=='unknown')return {disposition:'unchanged',operation:dropoffView(value),command_repeated:false};
      const raw=this.source.lookup(b.id);if(raw===null)return {disposition:'unconfirmed',operation:dropoffView(value),command_repeated:false};
      const result=dropoffResult(raw,value.command);if(result.observed_at>this.k.clock())throw new Error('DROPOFF_RESULT_INVALID');authorizeDropoffRead(this.k,scope,value,true);
      transitionDropoff(this.k,s,value,result.state,result.reason,result);return {disposition:'reconciled',operation:dropoffView(dropoffOperationRecord(this.k,s,b.id)!),command_repeated:false};
    });
  }
  cancel(scope:Scope,input:unknown) {
    const p=dropoffShape(input,['operation_id']);id(p.operation_id);return this.k.transaction(()=>{
      const {s,value}=this.#operation(scope,p.operation_id),b=value.record.body;k.authorize(scope,'operation.dispatch',b.resource_id);
      if(b.state!=='authorized'||b.attempt_count!==0||b.authority_revoked||b.minimized||b.restored||value.history.length!==1||value.history[0].code!=='queued')throw new Error('DROPOFF_CANCEL_UNCERTAIN');
      const {q}=currentTerms(this,scope,value.quote,value,false,true);if(q.owner!==s.actor_id)throw new Error('ACCESS_DENIED');
      if(this.source.lookup(b.id)!==null)throw new Error('DROPOFF_CANCEL_UNCERTAIN');transitionDropoff(this.k,s,value,'cancelled','DROPOFF_CANCELLED');return dropoffView(dropoffOperationRecord(this.k,s,b.id)!);
    });
  }
  deliver(scope:Scope,operationId:string) {
    return this.k.transaction(()=>{
      const {s,value}=this.#operation(scope,operationId),b=value.record.body;k.authorize(scope,'operation.read',b.resource_id);k.authorize(scope,'support.read',b.resource_id);
      if(b.state!=='issued'||b.authority_revoked||b.minimized||b.restored)throw new Error('DROPOFF_DELIVERY_UNAVAILABLE');
      const {q}=currentTerms(this,scope,value.quote,value,false,true);if(q.owner!==s.actor_id)throw new Error('ACCESS_DENIED');family(this,s,b.family_ref,b.id);
      const status=currentCredential(this,value);if(status.state!=='active'||status.replaced_by!==null||!status.delivery_available)throw new Error('DROPOFF_DELIVERY_UNAVAILABLE');
      const delivered=dropoffShape(this.source.deliver(b.id),['operation_id','credential_id','kind','payload','expires_at','generation']);
      if(delivered.operation_id!==b.id||delivered.credential_id!==status.credential_id||delivered.kind!==status.kind||delivered.expires_at!==status.expires_at||delivered.generation!==b.generation||typeof delivered.payload!=='string'||delivered.payload.length<32||delivered.payload.length>128)throw new Error('DROPOFF_CREDENTIAL_INVALID');
      currentTerms(this,scope,value.quote,value,false,true);family(this,s,b.family_ref,b.id);const after=currentCredential(this,value),{digest:_a,observed_at:_at,...beforeValue}=status,{digest:_b,observed_at:_bt,...afterValue}=after;if(contentDigest(afterValue)!==contentDigest(beforeValue))throw new Error('DROPOFF_CREDENTIAL_CHANGED');
      return {...delivered,qualification:'synthetic_only',financial_effect:false};
    });
  }
}
export function assertDropoffCredentialOwner(k:CommerceKernel,value:unknown){return DropoffCredentials.assertOwner(k,value);}
export function dropoffGatewayQuote(owner:DropoffCredentials,scope:Scope,proposal:Row,quotedAt:number) {
  const k=owner.k,s=dropoffHuman(k,scope),a=dropoffShape(proposal.arguments,['quote_id','quote_digest']),record=dropoffQuoteRecord(k,s,id(a.quote_id));dropoffHash(a.quote_digest);
  if(record.body.terms_digest!==a.quote_digest)throw new Error('DROPOFF_QUOTE_CHANGED');const {q}=currentTerms(owner,scope,record);
  if(q.case_id!==proposal.case_id||q.action!==proposal.action)throw new Error('DROPOFF_QUOTE_CHANGED');integer(quotedAt);
  return {schema_version:1,tenant_id:s.tenant_id,store_id:s.store_id,case_id:q.case_id,case_revision:q.case_revision,configuration_digest:q.configuration_digest,resource_id:q.resource_id,resource_version:q.resource_version,source_digest:q.source_digest,customer_id:q.customer_id,action:q.action,arguments:a,readiness_digest:contentDigest({qualification:'synthetic_only',source_identity:q.source_identity,contract:DROPOFF_CREDENTIAL_CONTRACT}),control_stamp:q.control_stamp,capability_revision:q.capability_revision,adapter_contract_digest:contentDigest({contract:DROPOFF_CREDENTIAL_CONTRACT,action:q.action}),policy_digest:q.policy_digest,quoted_at:quotedAt,expires_at:q.expires_at,max_uses:1,financial_effect:false};
}
export function commitDropoffCredential(owner:DropoffCredentials,scope:Scope,preview:Row,previewRow:Row,approval:Row,receiptId:string) {
  const k=owner.k,s=dropoffHuman(k,scope),record=dropoffQuoteRecord(k,s,preview.arguments.quote_id),{q}=currentTerms(owner,scope,record);
  if(record.body.terms_digest!==preview.arguments.quote_digest||q.owner!==s.actor_id||previewRow.proposer!==q.owner||approval.approver===q.owner||preview.action!==q.action)throw new Error('DROPOFF_QUOTE_CHANGED');
  const operationId=dropoffOperationId(s.tenant_id,s.store_id,receiptId),receipt={id:receiptId,case_id:q.case_id,preview_id:previewRow.id,preview_digest:previewRow.digest,approval_id:approval.id,configuration_digest:q.configuration_digest,case_revision:q.case_revision,resource_version:q.resource_version,actor_id:s.actor_id,authority_revision:permissionDecision(k.db,s,'action.execute',q.resource_id).authority_revision,action:q.action,effect:'synthetic_dropoff_authorized',dropoff_operation_id:operationId,state:'authorized',financial_effect:false,approval_consumed:true,completed_at:k.clock()};
  const command=dropoffCommand({schema_version:1,...dropoffPick(q,DROPOFF_BINDING_FIELDS),operation_id:operationId,source_id:receiptId,source_digest:contentDigest(receipt),source_contract:DROPOFF_CREDENTIAL_CONTRACT,quote_id:q.quote_id,quote_digest:record.body.terms_digest,financial_effect:false});
  k.db.prepare('INSERT INTO commerce_action_receipts VALUES(?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,receipt.id,q.case_id,previewRow.id,canonical(receipt),contentDigest(receipt));
  const op=queueOperation(k,s,q.resource_id,'case',receiptId,command,{configuration_digest:q.configuration_digest,policy_digest:q.policy_digest,approval_ref:approval.id});if(op.id!==operationId)throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');
  k.db.prepare('INSERT INTO commerce_operation_targets VALUES(?,?,?,?,?,?)').run(s.tenant_id,s.store_id,op.id,q.source_account_id,q.source_identity,DROPOFF_CREDENTIAL_CONTRACT);saveDropoffRecord(k,{...record.body,consumed_by:op.id},true);
  saveDropoffRecord(k,{schema_version:1,kind:DROPOFF_OPERATION_KIND,id:op.id,...dropoffPick(q,DROPOFF_BINDING_FIELDS),created_at:op.created_at,authority_revoked:false,minimized:false,source_cleanup:'not_requested',quote_id:q.quote_id,quote_digest:record.body.terms_digest,command_digest:contentDigest(command),state:'authorized',reason:'DROPOFF_AUTHORIZED',attempt_count:0,native_revision:op.revision,restored:false,personal:{case_id:q.case_id,receipt_id:receiptId,preview_id:previewRow.id,preview_digest:previewRow.digest,approval_id:approval.id,executor:s.actor_id,approver:approval.approver},observation:null});dropoffOperationRecord(k,s,op.id);return receipt;
}
