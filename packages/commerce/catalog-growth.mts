import { exact,id,integer } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { growthBody,growthScope,growthText } from './growth-shopping-core.mts';
import { assertRecoveryEgress } from './data-guards.mts';
import { assertExecution } from './execution-stops.mts';
import { EDIT_ACTION } from './order-edit-core.mts';
import { permissionDecision } from './authorization.mts';
import { ShoppingCatalogFixtureSource } from '../adapters/shopping-catalog-fixture-source.mts';

function sourceFor(source:ShoppingCatalogFixtureSource|undefined,s:Row){if(!source)throw new Error('CATALOG_SOURCE_UNAVAILABLE');if(source.tenant!==s.tenant_id||source.store!==s.store_id)throw new Error('CATALOG_SOURCE_SCOPE_MISMATCH');return source;}
/** Reproducible fixture observations, never a live-provider or future-placement claim. */
export class CatalogVisibility {
 readonly kernel:CommerceKernel;readonly source:ShoppingCatalogFixtureSource|undefined;
 constructor(k:CommerceKernel,source?:ShoppingCatalogFixtureSource){this.kernel=k;this.source=source;if(source?.db===k.db)throw new Error('SEPARATE_FIXTURE_SOURCE_REQUIRED');}
 evaluate(scope:Scope,input:unknown){const p=exact(jsonValue(input),['evaluation_id','resource_id','observation_id']);id(p.evaluation_id);const k=this.kernel;
  return k.transaction(()=>{const {s,order}=growthScope(k,scope,p.resource_id,'action.propose');assertRecoveryEgress(k);const source=sourceFor(this.source,s),native=source.visibility(p.observation_id);if(native.source_identity!==source.identity||contentDigest(native.catalog)!==native.catalog_digest)throw new Error('VISIBILITY_SOURCE_CHANGED');
   const old=k.db.prepare('SELECT * FROM commerce_catalog_evaluations WHERE tenant_id=? AND store_id=? AND evaluation_id=?').get(s.tenant_id,s.store_id,p.evaluation_id) as Row|undefined;
   if(old){const b=growthBody(old);if(old.resource_id!==order.id||b.source_observation_digest!==contentDigest(native))throw new Error('VISIBILITY_BASELINE_IMMUTABLE');return b;}
   const results=native.prompt_set.questions.map((question:Row)=>{const answer=native.answers.find((a:Row)=>a.question_id===question.id),observed=native.interface==='permitted_fixture'&&answer?.observed===true;
    if(!observed)return {question_id:question.id,observed:false,status:'unsupported',mentions:[],citations:[],claims:[]};
    const claims=answer.mentions.map((m:Row)=>{const item=native.catalog.find((i:Row)=>i.id===m.variant_id),correct=!!item&&item.unit_minor===m.unit_minor&&(item.available&&!item.excluded&&!item.subscription&&item.stock>0)===m.available;return {...m,status:correct?'correct':'incorrect',source_revision:item?.revision??null};});
    const citations=answer.citations.map((c:Row)=>{const item=native.catalog.find((i:Row)=>i.id===c.variant_id);return {...c,source_version_matched:!!item&&item.revision===c.source_revision};});
    return {question_id:question.id,observed:true,status:'observed',mentions:answer.mentions,citations,claims};
   });
   const summary={questions:results.length,observed_questions:results.filter((r:Row)=>r.observed).length,mentions:results.reduce((n:number,r:Row)=>n+r.mentions.length,0),citations:results.reduce((n:number,r:Row)=>n+r.citations.length,0),correct_claims:results.reduce((n:number,r:Row)=>n+r.claims.filter((c:Row)=>c.status==='correct').length,0),incorrect_claims:results.reduce((n:number,r:Row)=>n+r.claims.filter((c:Row)=>c.status==='incorrect').length,0),unsupported_questions:results.filter((r:Row)=>!r.observed).length,future_placement_guaranteed: false};
   const body={evaluation_id:p.evaluation_id,resource_id:order.id,customer_id:order.customer_id,observation_id:p.observation_id,source_identity:source.identity,source_observation_digest:contentDigest(native),prompt_set:native.prompt_set,prompt_digest:contentDigest(native.prompt_set),catalog_digest:native.catalog_digest,model:native.model,model_digest:contentDigest(native.model),interface:native.interface,observed_at:native.observed_at,results,summary,qualification:'synthetic_only',connected_qualified:false,limitations:['fixed_permitted_fixture_observations_only','mentions_and_citations_are_observations_not_future_placement','descriptive_comparison_not_randomized_causal_evidence']};
   k.db.prepare('INSERT INTO commerce_catalog_evaluations VALUES(?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,p.evaluation_id,order.id,order.customer_id,canonical(body),contentDigest(body));return body;
  });
 }
 history(scope:Scope,resourceId:string){const {s}=growthScope(this.kernel,scope,resourceId);return (this.kernel.db.prepare('SELECT * FROM commerce_catalog_evaluations WHERE tenant_id=? AND store_id=? AND resource_id=? ORDER BY evaluation_id').all(s.tenant_id,s.store_id,resourceId) as Row[]).map(growthBody);}
}

/** Every catalog mutation, including rollback, is a new independently approved exact-revision diff. */
export class ReviewedCatalogChanges {
 readonly kernel:CommerceKernel;readonly source:ShoppingCatalogFixtureSource|undefined;
 constructor(k:CommerceKernel,source?:ShoppingCatalogFixtureSource){this.kernel=k;this.source=source;if(source?.db===k.db)throw new Error('SEPARATE_FIXTURE_SOURCE_REQUIRED');}
 #row(scope:Scope,changeId:string,action='resource.read'){const k=this.kernel,s=k.require(scope),row=k.db.prepare('SELECT * FROM commerce_catalog_changes WHERE tenant_id=? AND store_id=? AND change_id=?').get(s.tenant_id,s.store_id,id(changeId)) as Row,b=growthBody(row),{order}=growthScope(k,scope,row.resource_id,action),source=sourceFor(this.source,s);
  if(b.command.change_id!==row.change_id||b.command.resource_id!==row.resource_id||b.command.customer_id!==row.customer_id||order.customer_id!==row.customer_id||b.command.source_identity!==source.identity||b.command_digest!==contentDigest(b.command))throw new Error('CATALOG_CHANGE_INTEGRITY');return {s,row,b,source};
 }
 read(scope:Scope,changeId:string){const {row,b}=this.#row(scope,changeId);return {change_id:row.change_id,resource_id:row.resource_id,state:row.state,digest:b.command_digest,command:b.command,before:b.before,receipt:b.receipt,qualification:'synthetic_only',connected_qualified:false};}
 propose(scope:Scope,input:unknown){const p=exact(jsonValue(input),['change_id','resource_id','variant_id','expected_revision','description','origin']);id(p.change_id);id(p.variant_id);growthText(p.description,1000);if(!['merchant','model','rollback'].includes(p.origin)||typeof p.expected_revision!=='string'||!/^[a-f0-9]{64}$/.test(p.expected_revision))throw new Error('INVALID_INPUT');const k=this.kernel;
  return k.transaction(()=>{const {s,order}=growthScope(k,scope,p.resource_id,'action.propose');assertRecoveryEgress(k);const control=assertExecution(k,s,EDIT_ACTION),source=sourceFor(this.source,s),before=source.item(p.variant_id);if(before.revision!==p.expected_revision)throw new Error('CATALOG_SOURCE_CHANGED');if(!before.approved_descriptions.includes(p.description))throw new Error('CATALOG_UNSUPPORTED_FACT');if(before.description===p.description)throw new Error('CATALOG_NO_CHANGE');
   const command={operation_id:'catalog_'+contentDigest([s.tenant_id,s.store_id,p.change_id]).slice(0,40),change_id:p.change_id,tenant_id:s.tenant_id,store_id:s.store_id,resource_id:order.id,customer_id:order.customer_id,source_identity:source.identity,variant_id:p.variant_id,expected_revision:p.expected_revision,description:p.description,origin:p.origin},hash=contentDigest(command),old=k.db.prepare('SELECT * FROM commerce_catalog_changes WHERE tenant_id=? AND store_id=? AND change_id=?').get(s.tenant_id,s.store_id,p.change_id) as Row|undefined;
   if(old){if(growthBody(old).command_digest!==hash)throw new Error('CATALOG_CHANGE_CONFLICT');return this.read(scope,p.change_id);}const body={command,command_digest:hash,before:{description:before.description,revision:before.revision},author_id:s.actor_id,control_stamp:control.stamp,created_at:k.clock(),receipt:null};
   k.db.prepare("INSERT INTO commerce_catalog_changes VALUES(?,?,?,?,?,'proposed',?,?)").run(s.tenant_id,s.store_id,p.change_id,order.id,order.customer_id,canonical(body),contentDigest(body));return this.read(scope,p.change_id);
  });
 }
 approve(scope:Scope,input:unknown){const p=exact(jsonValue(input),['change_id','expected_digest','expires_at']);integer(p.expires_at);const k=this.kernel;
  return k.transaction(()=>{const {s,row,b}=this.#row(scope,p.change_id,'action.approve');assertRecoveryEgress(k);if(!['owner','reviewer'].includes(s.role)||s.actor_id===b.author_id)throw new Error('CATALOG_SELF_APPROVAL_DENIED');if(row.state!=='proposed'||p.expected_digest!==b.command_digest||p.expires_at<=k.clock()||p.expires_at>k.clock()+300000)throw new Error('CATALOG_APPROVAL_CHANGED');
   const decision=permissionDecision(k.db,s,'action.approve',row.resource_id),body={change_id:row.change_id,command_digest:b.command_digest,source_revision:b.command.expected_revision,approver:s.actor_id,authority_revision:decision.authority_revision,expires_at:p.expires_at};
   k.db.prepare('INSERT INTO commerce_catalog_approvals VALUES(?,?,?,?,?,?,?,?,0,?,?) ON CONFLICT(tenant_id,store_id,change_id) DO UPDATE SET actor_id=excluded.actor_id,authority_revision=excluded.authority_revision,expires_at=excluded.expires_at,revoked=0,body=excluded.body,digest=excluded.digest').run(s.tenant_id,s.store_id,row.change_id,row.resource_id,row.customer_id,s.actor_id,decision.authority_revision,p.expires_at,canonical(body),contentDigest(body));return {change_id:row.change_id,approved:true,digest:b.command_digest};
  });
 }
 #approval(ctx:Row){const {s,row,b}=ctx,k=this.kernel,approval=k.db.prepare('SELECT * FROM commerce_catalog_approvals WHERE tenant_id=? AND store_id=? AND change_id=?').get(s.tenant_id,s.store_id,row.change_id) as Row|undefined;
  if (!approval) throw new Error('CATALOG_APPROVAL_REQUIRED');
  const value=growthBody(approval);if(approval.revoked||approval.expires_at<=k.clock()||value.command_digest!==b.command_digest||approval.actor_id===b.author_id||value.approver!==approval.actor_id||value.authority_revision!==approval.authority_revision||value.expires_at!==approval.expires_at)throw new Error('CATALOG_APPROVAL_CHANGED');
  const member=k.db.prepare('SELECT * FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND active=1').get(s.tenant_id,s.store_id,approval.actor_id) as Row|undefined,decision=member&&permissionDecision(k.db,member,'action.approve',row.resource_id);if(!member||!['owner','reviewer'].includes(member.role)||!decision?.allowed||decision.authority_revision!==approval.authority_revision)throw new Error('CATALOG_APPROVAL_AUTHORITY_CHANGED');
 }
 #guard(scope:Scope,changeId:string){const ctx=this.#row(scope,changeId,'operation.dispatch'),{s,row,b,source}=ctx;this.kernel.authorize(scope,'action.execute',row.resource_id);assertRecoveryEgress(this.kernel);assertExecution(this.kernel,s,EDIT_ACTION,b.control_stamp);this.#approval(ctx);if(source.item(b.command.variant_id).revision!==b.command.expected_revision)throw new Error('CATALOG_SOURCE_CHANGED');return ctx;}
 #save(scope:Scope,changeId:string,receipt:Row){const {s,row,b}=this.#row(scope,changeId),k=this.kernel,c=b.command;
  if(receipt.operation_id!==c.operation_id||receipt.change_id!==c.change_id||receipt.resource_id!==c.resource_id||receipt.customer_id!==c.customer_id||receipt.source_identity!==c.source_identity||receipt.command_digest!==b.command_digest||receipt.variant_id!==c.variant_id||receipt.before_revision!==c.expected_revision||receipt.before_description!==b.before.description||receipt.after_description!==c.description||typeof receipt.after_revision!=='string'||!receipt.native_id||receipt.qualification!=='synthetic_only')throw new Error('CATALOG_RECEIPT_MISMATCH');
  const body={...b,receipt};k.db.prepare("UPDATE commerce_catalog_changes SET state='applied',body=?,digest=? WHERE tenant_id=? AND store_id=? AND change_id=?").run(canonical(body),contentDigest(body),s.tenant_id,s.store_id,row.change_id);
 }
 async dispatch(scope:Scope,changeId:string){const initial=this.#row(scope,changeId,'operation.dispatch');if(initial.row.state!=='proposed')return this.read(scope,changeId);const {s,row,b,source}=this.#guard(scope,changeId),k=this.kernel;
  k.transaction(()=>{this.#guard(scope,changeId);k.db.prepare("UPDATE commerce_catalog_changes SET state='unknown' WHERE tenant_id=? AND store_id=? AND change_id=? AND state='proposed'").run(s.tenant_id,s.store_id,row.change_id);});
  try{const receipt=await source.applyCatalog(b.command,()=>this.#guard(scope,changeId));k.transaction(()=>{k.authorize(scope,'operation.dispatch',row.resource_id);this.#save(scope,changeId,receipt);});}catch{return this.read(scope,changeId);}return this.read(scope,changeId);
 }
 reconcile(scope:Scope,changeId:string){const {row,b,source}=this.#row(scope,changeId,'operation.reconcile');assertRecoveryEgress(this.kernel);if(row.state==='unknown'){const receipt=source.lookupCatalog(b.command.operation_id);if(receipt)this.kernel.transaction(()=>{this.kernel.authorize(scope,'operation.reconcile',row.resource_id);this.#save(scope,changeId,receipt);});}return this.read(scope,changeId);}
 rollback(scope:Scope,input:unknown){const p=exact(jsonValue(input),['change_id','rollback_id']),{row,b,source}=this.#row(scope,p.change_id,'action.propose');if(row.state!=='applied'||!b.receipt||source.item(b.command.variant_id).revision!==b.receipt.after_revision)throw new Error('CATALOG_ROLLBACK_CONFLICT');return this.propose(scope,{change_id:p.rollback_id,resource_id:row.resource_id,variant_id:b.command.variant_id,expected_revision:b.receipt.after_revision,description:b.before.description,origin:'rollback'});}
}
