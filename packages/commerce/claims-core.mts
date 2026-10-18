import { exact,id,integer,token } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { CaseConfigurations } from './case-configurations.mts';
import { evidenceRows } from './return-evidence.mts';
import { growthCustomerProof } from './growth-shopping-core.mts';
import { subjectHash,assertNotErased,assertRecoveryEgress } from './data-guards.mts';
import { permissionDecision } from './authorization.mts';
import { assertExecution } from './execution-stops.mts';
import { ClaimsFixtureSource,CLAIMS_SOURCE_CONTRACT,claimsSourceResult } from '../adapters/claims-fixture-source.mts';
import { PartnerReadiness } from './partner-readiness.mts';
import type { PartnerContext,PartnerPin } from './partner-readiness.mts';

export const CLAIMS_TABLES=Object.freeze(['commerce_warranty_terms','commerce_warranty_registrations','commerce_warranty_claims','commerce_warranty_entitlements','commerce_shipping_claims','commerce_dispute_packets','commerce_claim_approvals','commerce_claim_submissions','commerce_claim_observations']);
export const CLAIMS_SUBJECT_TABLES=Object.freeze(CLAIMS_TABLES.filter(table=>table!=='commerce_warranty_terms'));
export const CLAIMS_QUALIFICATION='synthetic_local_preparation_only';
export const CLAIM_ACTIONS=Object.freeze({warranty:'diagnostic.warranty.claim',shipping:'diagnostic.shipping.claim',dispute:'diagnostic.dispute.submit'});
export function claimsBody(row:Row|undefined){if(!row)throw new Error('NOT_FOUND');const body=jsonValue(JSON.parse(row.body));if(contentDigest(body)!==row.digest)throw new Error('CLAIM_RECORD_INTEGRITY');if(body.erased)throw new Error('SUBJECT_ERASED');return body;}
export function claimsRow(k:CommerceKernel,scope:Scope,table:string,ref:string,action='resource.read'){
  if(!CLAIMS_SUBJECT_TABLES.includes(table))throw new Error('CLAIM_TABLE_DENIED');const s=k.require(scope),row=k.db.prepare('SELECT * FROM '+table+' WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(ref)) as Row|undefined;
  if(!row)throw new Error('NOT_FOUND');k.authorize(scope,action,row.resource_id);if(s.role==='customer')growthCustomerProof(k,s,row.resource_id,row.customer_id);const order=k.get(scope,row.resource_id);if(order.kind!=='order'||order.customer_id!==row.customer_id)throw new Error('CLAIM_CUSTOMER_CHANGED');assertNotErased(k,s,row.resource_id,row.customer_id);return {...row,body:claimsBody(row)};
}
export function claimsSourceScope(k:CommerceKernel,s:Row,source:ClaimsFixtureSource){
  if(!(source instanceof ClaimsFixtureSource)||source.db===k.db||source.tenant!==s.tenant_id||source.store!==s.store_id)throw new Error('CLAIM_SOURCE_SCOPE');
  const file=(db:any)=>db.prepare('PRAGMA database_list').all().find((row:Row)=>row.name==='main')?.file;
  if(file(source.db)&&file(source.db)===file(k.db))throw new Error('SEPARATE_FIXTURE_SOURCE_REQUIRED');
}
export function claimsCase(k:CommerceKernel,scope:Scope,caseId:string,action='action.propose'){
  const c=new CaseConfigurations(k).inspect(scope,id(caseId)),s=k.authorize(scope,action,c.resource_id);return {c,s,hash:subjectHash(s.tenant_id,s.store_id,c.customer_id)};
}
export function claimsCustomer(k:CommerceKernel,scope:Scope,resource:string,customer:string){const s=k.authorize(scope,'resource.read',resource);growthCustomerProof(k,s,resource,customer);return s;}
export function claimsCurrentCustomer(k:CommerceKernel,s:Row,sessionHash:string,resource:string,customer:string){
  const current=k.db.prepare('SELECT * FROM commerce_sessions WHERE token_hash=? AND tenant_id=? AND store_id=? AND role=? AND revoked=0 AND expires_at>? AND last_seen>?').get(sessionHash,s.tenant_id,s.store_id,'customer',k.clock(),k.clock()-900000) as Row|undefined;
  if(!current)throw new Error('CUSTOMER_VERIFICATION_REQUIRED');growthCustomerProof(k,current,resource,customer);return current;
}
export function claimsAttachments(k:CommerceKernel,s:Row,caseId:string,values:unknown){
  if(!Array.isArray(values)||values.length>8||new Set(values).size!==values.length)throw new Error('INVALID_INPUT');values.forEach(id);
  const records=evidenceRows(k,s,caseId,values as string[]);if(records.some(row=>row.state!=='clean'||!row.scanner))throw new Error('EVIDENCE_UNAVAILABLE');
  return records.map(row=>({id:row.id,sha256:row.sha256,scanner:row.scanner,expires_at:row.expires_at,source_ref:'commerce_return_evidence:'+row.id}));
}
export function claimsResourcePin(order:Row){return {resource_id:order.id,kind:order.kind,source_system:order.source_system,external_id:order.external_id,source_version:order.source_version,digest:contentDigest({customer_id:order.customer_id,payload:order.payload})};}
export function claimsAssertResourcePin(k:CommerceKernel,scope:Scope,pin:Row){const current=k.get(scope,pin.resource_id);if(contentDigest(claimsResourcePin(current))!==contentDigest(pin))throw new Error('EVIDENCE_SOURCE_CHANGED');return current;}
export function claimsPrivateProjection(body:Row){const result={...body};delete result.claimant_session_hash;delete result.proposer_session_hash;return result;}
export function claimsApprove(k:CommerceKernel,scope:Scope,kind:string,target:Row,input:Row,binding:Row){
  const s=k.authorize(scope,'action.approve',target.resource_id);integer(input.expires_at);if(input.expected_digest!==target.digest)throw new Error('CLAIM_PREVIEW_CHANGED');
  if(input.expires_at<=k.clock()||input.expires_at>binding.deadline_at)throw new Error('CLAIM_APPROVAL_EXPIRED');
  if(target.body.proposed_by===s.actor_id)throw new Error('SELF_APPROVAL_DENIED');
  const decision=permissionDecision(k.db,s,'action.approve',target.resource_id),body={target_kind:kind,target_id:target.id,target_digest:target.digest,approver:s.actor_id,authority_revision:decision.authority_revision,expires_at:input.expires_at,...binding};
  const approval_id='claim_approval_'+token().slice(0,28);
  k.db.prepare('INSERT INTO commerce_claim_approvals VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,approval_id,target.resource_id,target.customer_id,target.subject_hash,'approved',kind,target.id,canonical(body),contentDigest(body));
  return {id:approval_id,digest:contentDigest(body),expires_at:input.expires_at};
}
export function claimsApproval(k:CommerceKernel,scope:Scope,kind:string,target:Row){
  const s=k.require(scope),rows=k.db.prepare("SELECT * FROM commerce_claim_approvals WHERE tenant_id=? AND store_id=? AND target_kind=? AND target_id=? AND state='approved'").all(s.tenant_id,s.store_id,kind,target.id) as Row[];
  const candidates=rows.map(row=>({...row,body:claimsBody(row)})).filter(row=>row.body.target_digest===target.digest).sort((a,b)=>b.body.expires_at-a.body.expires_at);
  const a=candidates[0];if(!a)throw new Error('CLAIM_APPROVAL_REQUIRED');if(a.body.expires_at<=k.clock())throw new Error('CLAIM_APPROVAL_EXPIRED');
  const member=k.db.prepare('SELECT * FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND active=1').get(s.tenant_id,s.store_id,a.body.approver) as Row|undefined;
  const authority=member&&permissionDecision(k.db,member,'action.approve',target.resource_id);
  if(!authority?.allowed||authority.authority_revision!==a.body.authority_revision||a.body.approver===target.body.proposed_by)throw new Error('APPROVAL_AUTHORITY_CHANGED');
  const author=k.db.prepare('SELECT * FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND active=1').get(s.tenant_id,s.store_id,target.body.proposed_by) as Row|undefined;
  if(!author||!permissionDecision(k.db,author,'action.propose',target.resource_id).allowed)throw new Error('CLAIM_AUTHOR_AUTHORITY_CHANGED');
  return a;
}
export function claimsObservation(k:CommerceKernel,s:Row,target:Row,kind:string,operationId:string,result:Row){
  const body={result,original_operation_id:operationId,source_digest:contentDigest(result)},ref='claim_observation_'+contentDigest([kind,operationId,body]).slice(0,38);
  k.db.prepare('INSERT INTO commerce_claim_observations VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,store_id,id) DO NOTHING').run(s.tenant_id,s.store_id,ref,target.resource_id,target.customer_id,target.subject_hash,result.stage??result.state??'unknown',kind,target.id,operationId,canonical(body),contentDigest(body));
}
export type ClaimTarget= {
  kind:'shipping'|'dispute'|'repair';approvalKind:'shipping'|'dispute'|'warranty';action:string;service:string;
  get:(scope:Scope,targetId:string)=>Row;
  current:(scope:Scope,target:Row)=>{source:Row;source_record_id:string;business_key:string;deadline_at:number;maximum_minor:string;currency:string;evidence_hash:string;payload:Row;context:PartnerContext;pin:PartnerPin};
  linked?:(scope:Scope,target:Row,operationId:string,state:string)=>void;
};

/** One reviewed submission lifecycle for source claims. It cannot refund, credit,
 * reserve stock or create a replacement; those remain the existing gateways. */
export class ClaimSubmissions {
  readonly k:CommerceKernel;readonly source:ClaimsFixtureSource;readonly readiness:PartnerReadiness;readonly target:ClaimTarget;
  constructor(k:CommerceKernel,source:ClaimsFixtureSource,readiness:PartnerReadiness,target:ClaimTarget){this.k=k;this.source=source;this.readiness=readiness;this.target=target;}
  async #bounded<T>(call:()=>Promise<T>){let timer:ReturnType<typeof setTimeout>|undefined;
    try{return await Promise.race([Promise.resolve().then(call),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('CLAIM_SOURCE_TIMEOUT')),1000);})]);}finally{if(timer)clearTimeout(timer);}}
  find(scope:Scope,targetId:string){const s=this.k.require(scope),row=this.k.db.prepare('SELECT * FROM commerce_claim_submissions WHERE tenant_id=? AND store_id=? AND kind=? AND target_id=?').get(s.tenant_id,s.store_id,this.target.kind,id(targetId)) as Row|undefined;
    if(!row)return null;return claimsRow(this.k,scope,'commerce_claim_submissions',row.id,'operation.read');}
  #original(scope:Scope,ref:string,action:string){const r=claimsRow(this.k,scope,'commerce_claim_submissions',ref,action),s=this.k.require(scope);claimsSourceScope(this.k,s,this.source);const c=r.body.command;
    if(r.kind!==this.target.kind||c.kind!==r.kind||c.operation_id!==r.id||c.target_id!==r.target_id||c.resource_id!==r.resource_id||c.customer_id!==r.customer_id||c.tenant_id!==s.tenant_id||c.store_id!==s.store_id||c.source_identity!==this.source.identity||c.account_id!==this.source.account_id||c.business_key!==r.business_key||c.target_digest!==r.body.target_digest)throw new Error('CLAIM_RECORD_INTEGRITY');
    return r;
  }
  #current(scope:Scope,ref:string){const row=this.#original(scope,ref,'operation.dispatch'),target=this.target.get(scope,row.target_id),s=this.k.authorize(scope,'action.execute',row.resource_id);assertRecoveryEgress(this.k);
    if(target.digest!==row.body.target_digest)throw new Error('CLAIM_PREVIEW_CHANGED');const current=this.target.current(scope,target),approval=claimsApproval(this.k,scope,this.target.approvalKind,target);
    if(approval.id!==row.body.approval_id||approval.digest!==row.body.approval_digest)throw new Error('CLAIM_APPROVAL_CHANGED');
    assertExecution(this.k,s,this.target.action,approval.body.control_stamp);this.readiness.assertReady(scope,current.context,row.body.partner_pin);
    const command=this.#command(row.id,target,current);
    if(contentDigest(command)!==contentDigest(row.body.command))throw new Error('EVIDENCE_SOURCE_CHANGED');return {row,target,current,approval};
  }
  #command(operationId:string,target:Row,current:ReturnType<ClaimTarget['current']>){return {schema_version:1,operation_id:operationId,tenant_id:target.tenant_id,store_id:target.store_id,resource_id:target.resource_id,customer_id:target.customer_id,source_identity:this.source.identity,account_id:this.source.account_id,source_config_digest:current.context.source_config_digest,interface_version:CLAIMS_SOURCE_CONTRACT.version,region:this.source.region,kind:this.target.kind,business_key:current.business_key,target_id:target.id,target_digest:target.digest,evidence_hash:current.evidence_hash,source_record_id:current.source_record_id,source_record_version:current.source.version,source_record_digest:contentDigest(current.source),deadline_at:current.deadline_at,maximum_minor:current.maximum_minor,currency_code:current.currency,payload:current.payload};}
  async submit(scope:Scope,targetId:string,operationId:string){id(operationId);const target=this.target.get(scope,targetId),k=this.k,s=k.authorize(scope,'action.execute',target.resource_id);k.authorize(scope,'operation.dispatch',target.resource_id);claimsSourceScope(k,s,this.source);
    const existing=this.find(scope,targetId);if(existing){if(existing.id!==operationId)throw new Error('ORIGINAL_SUBMISSION_REQUIRED');return existing;}
    const prepared=k.transaction(()=>{
      const current=this.target.current(scope,target),approval=claimsApproval(k,scope,this.target.approvalKind,target);assertRecoveryEgress(k);assertExecution(k,s,this.target.action,approval.body.control_stamp);
      this.readiness.assertReady(scope,current.context,approval.body.partner_pin);
      if(k.db.prepare('SELECT 1 FROM commerce_claim_submissions WHERE tenant_id=? AND store_id=? AND kind=? AND business_key=?').get(s.tenant_id,s.store_id,this.target.kind,current.business_key))throw new Error('ORIGINAL_SUBMISSION_REQUIRED');
      const command=this.#command(operationId,target,current),body={command,target_digest:target.digest,approval_id:approval.id,approval_digest:approval.digest,partner_pin:current.pin,result:null};
      k.db.prepare('INSERT INTO commerce_claim_submissions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,operationId,target.resource_id,target.customer_id,target.subject_hash,'unknown',this.target.kind,target.id,current.business_key,null,canonical(body),contentDigest(body));
      this.target.linked?.(scope,target,operationId,'unknown');claimsObservation(k,s,target,this.target.kind,operationId,{state:'unknown',reason:'persisted_before_source_call',operation_id:operationId});return command;
    });
    let result:Row,active=true;try{this.#current(scope,operationId);result=await this.#bounded(()=>this.source.submit(prepared,()=>{if(!active)throw new Error('CLAIM_SUBMISSION_ATTEMPT_CLOSED');this.#current(scope,operationId);active=false;}));}catch{return this.#original(scope,operationId,'operation.read');}finally{active=false;}
    return k.transaction(()=>this.#record(scope,operationId,result));
  }
  #record(scope:Scope,operationId:string,value:Row){const row=this.#original(scope,operationId,'operation.read'),s=this.k.require(scope),result=claimsSourceResult(row.body.command,value),old=row.body.result;
    if(row.native_id&&row.native_id!==result.native_id)throw new Error('CLAIM_SOURCE_RESULT_MISMATCH');
    if(old){if(result.source_version<old.source_version)return row;if(result.source_version===old.source_version){if(contentDigest(result)!==contentDigest(old))throw new Error('CLAIM_SOURCE_VERSION_CONFLICT');return row;}
      const stages:Row={shipping:['submitted','approved','paid'],dispute:['submitted','accepted','decided','recovered'],repair:['submitted','accepted','completed']};
      if(stages[row.kind].indexOf(result.stage)<stages[row.kind].indexOf(old.stage)||old.decision==='lost'&&result.decision!=='lost'||BigInt(result.recovered_minor)<BigInt(old.recovered_minor)||old.payout_ref!==null&&old.payout_ref!==result.payout_ref)throw new Error('CLAIM_SOURCE_STAGE_REGRESSION');
    }
    const target=this.target.get(scope,row.target_id),body={...row.body,result};this.k.db.prepare('UPDATE commerce_claim_submissions SET state=?,native_id=?,body=?,digest=? WHERE tenant_id=? AND store_id=? AND id=?').run(result.stage,result.native_id,canonical(body),contentDigest(body),s.tenant_id,s.store_id,row.id);
    this.target.linked?.(scope,target,row.id,result.stage);claimsObservation(this.k,s,target,row.kind,row.id,result);return this.#original(scope,row.id,'operation.read');
  }
  async reconcile(scope:Scope,targetId:string){const found=this.find(scope,targetId);if(!found)throw new Error('CLAIM_NOT_SUBMITTED');const row=this.#original(scope,found.id,'operation.reconcile'),c=row.body.command;
    // This exact persisted command is proved before a relaxed readiness lookup.
    this.readiness.assertReconcile(scope,{service:this.target.service,account_id:c.account_id,source_identity:c.source_identity,source_config_digest:c.source_config_digest,region:c.region,capability:this.target.kind==='repair'?'repair':'submit'});
    let result:Row|null;try{result=await this.#bounded(()=>this.source.lookup(row.id));}catch{return row;}if(!result)return row;return this.k.transaction(()=>this.#record(scope,row.id,result));
  }
}
