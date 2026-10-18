import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { exact,id,integer } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { assertRecoveryEgress } from './data-guards.mts';
import { assertExecution } from './execution-stops.mts';
import { permissionDecision } from './authorization.mts';
import { supportCase } from './support-core.mts';
import { growthBody,growthApproval } from './growth-marketing-core.mts';
import { MarketingFixtureSource,marketingDefinition,marketingMatches } from '../adapters/marketing-fixture-source.mts';

export class MarketingSegments {
  readonly k:CommerceKernel;readonly source:MarketingFixtureSource;
  constructor(k:CommerceKernel,source:MarketingFixtureSource){if(source.db===k.db)throw new Error('GROWTH_SOURCE_BOUNDARY');this.k=k;this.source=source;}
  sourceFor(s:Row){if(this.source.tenant!==s.tenant_id||this.source.store!==s.store_id)throw new Error('GROWTH_SOURCE_SCOPE');return this.source;}
  preview(scope:Scope,input:unknown){
    const s=this.k.authorize(scope,'support.analytics'),definition=marketingDefinition(input),source=this.sourceFor(s),members:Row[]=[],exclusions={incomplete:0,criteria:0};
    for(const row of source.audience()){
      if(row.tenant_id!==s.tenant_id||row.store_id!==s.store_id)throw new Error('SEGMENT_SCOPE_MISMATCH');
      if(!definition.required_fields.every((field:string)=>row.available_fields.includes(field))){exclusions.incomplete++;continue;}
      if(marketingMatches(row,definition))members.push(row);else exclusions.criteria++;
    }
    return {definition,members,audience_count:members.length,exclusions,complete:exclusions.incomplete===0,audience_digest:contentDigest(members),consent_rule:'membership_is_not_send_permission',source_identity:source.identity,connected_qualified:false};
  }
  #row(s:Row,segmentId:string){return this.k.db.prepare('SELECT * FROM commerce_marketing_segments WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(segmentId)) as Row;}
  read(scope:Scope,segmentId:string){const s=this.k.authorize(scope,'support.analytics'),row=this.#row(s,segmentId),body=growthBody(row);return {id:row.id,revision:row.revision,digest:row.digest,body,preview:this.preview(scope,body.definition),approved:!!row.approval_body&&!row.revoked,connected_qualified:false};}
  define(scope:Scope,input:unknown){
    const p=exact(jsonValue(input),['segment_id','expected_revision','definition','template']);id(p.segment_id);integer(p.expected_revision);
    return this.k.transaction(()=>{
      const s=this.k.authorize(scope,'action.propose'),preview=this.preview(scope,p.definition),old=this.#row(s,p.segment_id);
      if((old?.revision??0)!==p.expected_revision)throw new Error('SEGMENT_REVISION_CHANGED');
      for(const member of preview.members){const {c}=supportCase(this.k,scope,member.case_id);if(c.resource_id!==member.resource_id||c.customer_id!==member.customer_id)throw new Error('SEGMENT_MEMBER_IDENTITY');}
      const template=exact(p.template,['headline_key','body_key','offer_id']),copy=this.sourceFor(s).copy(template.headline_key,template.body_key,template.offer_id);
      const body={template:{...template,digest:contentDigest(copy)},template_preview:copy,definition:preview.definition,audience_digest:preview.audience_digest,audience_count:preview.audience_count,exclusions:preview.exclusions,complete:preview.complete,source_identity:preview.source_identity};
      this.k.db.prepare('INSERT INTO commerce_marketing_segments VALUES(?,?,?,?,?,?,?,NULL,NULL,0) ON CONFLICT(tenant_id,store_id,id) DO UPDATE SET revision=excluded.revision,body=excluded.body,digest=excluded.digest,author_id=excluded.author_id,approval_body=NULL,approval_digest=NULL,revoked=0').run(s.tenant_id,s.store_id,p.segment_id,p.expected_revision+1,canonical(body),contentDigest(body),s.actor_id);
      return this.read(scope,p.segment_id);
    });
  }
  approve(scope:Scope,input:unknown){
    const p=exact(jsonValue(input),['segment_id','expected_digest','expires_at']);integer(p.expires_at);
    return this.k.transaction(()=>{const s=this.k.authorize(scope,'action.approve'),row=this.#row(s,p.segment_id),body=growthBody(row);
      if(row.author_id===s.actor_id||row.digest!==p.expected_digest)throw new Error('SEGMENT_APPROVAL_CHANGED');
      const preview=this.previewForApproval(s,body),copy=this.sourceFor(s).copy(body.template.headline_key,body.template.body_key,body.template.offer_id);if(contentDigest(copy)!==body.template.digest)throw new Error('SEGMENT_TEMPLATE_CHANGED');
      if(!body.complete||!preview.complete)throw new Error('SEGMENT_INCOMPLETE');
      if(preview.audience_digest!==body.audience_digest)throw new Error('SEGMENT_AUDIENCE_CHANGED');
      if(p.expires_at<=this.k.clock()||p.expires_at>this.k.clock()+3600000)throw new Error('APPROVAL_EXPIRY_INVALID');
      const approval={segment_id:row.id,segment_digest:row.digest,approver:s.actor_id,authority_revision:permissionDecision(this.k.db,s,'action.approve').authority_revision,expires_at:p.expires_at};
      this.k.db.prepare('UPDATE commerce_marketing_segments SET approval_body=?,approval_digest=?,revoked=0 WHERE tenant_id=? AND store_id=? AND id=?').run(canonical(approval),contentDigest(approval),s.tenant_id,s.store_id,row.id);
      return {segment_id:row.id,approved:true,digest:row.digest};
    });
  }
  private previewForApproval(s:Row,body:Row){
    const source=this.sourceFor(s),members=source.audience();
    if(members.some(m=>m.tenant_id!==s.tenant_id||m.store_id!==s.store_id))throw new Error('SEGMENT_APPROVAL_SCOPE');
    const complete=members.every(m=>body.definition.required_fields.every((field:string)=>m.available_fields.includes(field)));
    return {complete,audience_digest:contentDigest(members.filter(m=>body.definition.required_fields.every((field:string)=>m.available_fields.includes(field))&&marketingMatches(m,body.definition)))};
  }
  approved(scope:Scope,segmentId:string){
    const s=this.k.require(scope),row=this.#row(s,segmentId),body=growthBody(row);
    if(row.revoked||!row.approval_body)throw new Error('SEGMENT_APPROVAL_REQUIRED');
    const approval=JSON.parse(row.approval_body);if(contentDigest(approval)!==row.approval_digest||approval.segment_digest!==row.digest)throw new Error('SEGMENT_APPROVAL_CHANGED');growthApproval(this.k,s,approval);
    const copy=this.sourceFor(s).copy(body.template.headline_key,body.template.body_key,body.template.offer_id);if(contentDigest(copy)!==body.template.digest)throw new Error('SEGMENT_TEMPLATE_CHANGED');
    const current=this.previewForApproval(s,body);if(!current.complete||current.audience_digest!==body.audience_digest)throw new Error('SEGMENT_AUDIENCE_CHANGED');
    return {row,body,approval};
  }
  #assertOriginalSync(s:Row,command:Row){
    const semantic=(value:Row)=>{const {operation_id,...reviewed}=value;return contentDigest(reviewed);};
    const attempts=this.k.db.prepare('SELECT * FROM commerce_marketing_sync_operations WHERE tenant_id=? AND store_id=? AND segment_id=? AND id<>?').all(s.tenant_id,s.store_id,command.segment_id,command.operation_id) as Row[];
    for(const attempt of attempts){const prior=growthBody(attempt);
      // A changed template, revision, account or caller ID cannot escape an
      // unresolved original effect for this scoped segment.
      if(attempt.state==='unknown')throw new Error('MARKETING_SYNC_ORIGINAL_UNRESOLVED');
      if(semantic(prior.command)===semantic(command))throw new Error('MARKETING_SYNC_ORIGINAL_REQUIRED');
    }
  }
  async sync(scope:Scope,input:unknown){
    const p=exact(jsonValue(input),['operation_id','segment_id','headline_key','body_key','offer_id']);id(p.operation_id);const k=this.k,s=k.authorize(scope,'action.execute');assertRecoveryEgress(k);assertExecution(k,s,'customer.message');
    const old=k.db.prepare('SELECT * FROM commerce_marketing_sync_operations WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,p.operation_id) as Row;
    if(old){const b=growthBody(old);if(contentDigest(b.input)!==contentDigest(p))throw new Error('MARKETING_SYNC_IDEMPOTENCY');return this.syncStatus(scope,p.operation_id);}
    let command:Row,segmentDigest:string;
    k.transaction(()=>{const {row,body}=this.approved(scope,p.segment_id),source=this.sourceFor(s),copy=source.copy(p.headline_key,p.body_key,p.offer_id);
      if(contentDigest(copy)!==body.template.digest||p.headline_key!==body.template.headline_key||p.body_key!==body.template.body_key||p.offer_id!==body.template.offer_id)throw new Error('SEGMENT_TEMPLATE_NOT_APPROVED');
      command={operation_id:p.operation_id,tenant_id:s.tenant_id,store_id:s.store_id,account_id:source.account,source_identity:source.identity,segment_id:row.id,definition:body.definition,audience_digest:body.audience_digest,audience_count:body.audience_count,template:{headline_key:p.headline_key,body_key:p.body_key,offer_id:p.offer_id,digest:contentDigest(copy)},facts_digest:copy.source_digest};
      segmentDigest=row.digest;
      this.#assertOriginalSync(s,command);
      const value={input:p,command,command_digest:contentDigest(command),original_operation_id:p.operation_id,original_segment_digest:row.digest,state:'unknown',native:null};
      k.db.prepare("INSERT INTO commerce_marketing_sync_operations VALUES(?,?,?,?,'unknown',?,?)").run(s.tenant_id,s.store_id,p.operation_id,row.id,canonical(value),contentDigest(value));
    });
    // Persist uncertain state first, then recheck all current authority immediately
    // before the synchronous fixture source operation. No alternate sender exists.
    if(this.approved(scope,p.segment_id).row.digest!==segmentDigest!)throw new Error('SEGMENT_APPROVAL_CHANGED');k.authorize(scope,'action.execute');assertRecoveryEgress(k);assertExecution(k,s,'customer.message');this.#assertOriginalSync(s,command!);
    try{const result=this.sourceFor(s).sync(command!);this.#accept(scope,p.operation_id,result);}catch{return this.syncStatus(scope,p.operation_id);}
    return this.syncStatus(scope,p.operation_id);
  }
  syncStatus(scope:Scope,operationId:string){const s=this.k.authorize(scope,'operation.read'),row=this.k.db.prepare('SELECT * FROM commerce_marketing_sync_operations WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(operationId)) as Row,body=growthBody(row);return {operation_id:row.id,state:row.state,native:body.native,original_operation_id:body.original_operation_id,connected_qualified:false,customer_delivered:false};}
  #accept(scope:Scope,operationId:string,native:Row){
    const k=this.k,s=k.require(scope),row=k.db.prepare('SELECT * FROM commerce_marketing_sync_operations WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,operationId) as Row,b=growthBody(row);
    if(native.operation_id!==row.id||native.command_digest!==b.command_digest||native.source_identity!==b.command.source_identity||native.account_id!==b.command.account_id||native.stage!=='template_synced'||native.audience_digest!==b.command.audience_digest||native.template_digest!==b.command.template.digest||!Number.isSafeInteger(native.audience_count)||native.audience_count!==b.command.audience_count||native.qualification!=='synthetic_only'||typeof native.native_id!=='string'||!native.native_id)throw new Error('MARKETING_SYNC_OBSERVATION_MISMATCH');
    if(b.native&&contentDigest(b.native)!==contentDigest(native))throw new Error('MARKETING_SYNC_OBSERVATION_CHANGED');
    const value={...b,state:'source_confirmed',native};k.db.prepare("UPDATE commerce_marketing_sync_operations SET state='source_confirmed',body=?,digest=? WHERE tenant_id=? AND store_id=? AND id=?").run(canonical(value),contentDigest(value),s.tenant_id,s.store_id,operationId);
  }
  async reconcile(scope:Scope,operationId:string){const s=this.k.authorize(scope,'operation.reconcile'),row=this.k.db.prepare('SELECT * FROM commerce_marketing_sync_operations WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(operationId)) as Row,b=growthBody(row);assertRecoveryEgress(this.k);const result=this.sourceFor(s).lookup(operationId,b.command_digest);if(result)this.k.transaction(()=>this.#accept(scope,operationId,result));return this.syncStatus(scope,operationId);}
}
