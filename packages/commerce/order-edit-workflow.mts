import { exact,id,digest } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { Skills } from './skills.mts';
import { editBody,editContext,editSettings } from './order-edit-core.mts';
import { OrderEdits } from './order-edit-execution.mts';

/** Guidance and task context are portable; policy and execution remain server-owned. */
export class OrderEditWorkflow {
 readonly kernel:CommerceKernel; readonly edits:OrderEdits; readonly skills:Skills;
 constructor(edits:OrderEdits){this.edits=edits;this.kernel=edits.kernel;this.skills=new Skills(this.kernel);}
 open(scope:Scope,input:unknown){const p=exact(jsonValue(input),['case_id','skill_digest']);id(p.case_id);if(typeof p.skill_digest!=='string'||!/^[a-f0-9]{64}$/.test(p.skill_digest))throw new Error('INVALID_INPUT');const k=this.kernel;
  return k.transaction(()=>{const {s,c}=editContext(k,scope,p.case_id),old=k.db.prepare('SELECT * FROM commerce_edit_workflow_pins WHERE tenant_id=? AND store_id=? AND case_id=?').get(s.tenant_id,s.store_id,c.id) as Row;
   if(old){if(editBody(old).skill_digest!==p.skill_digest)throw new Error('WORKFLOW_PIN_CHANGED');return this.status(scope,{case_id:c.id});}
   const bundle=this.skills.snapshot(scope,'safe-order-edit',p.skill_digest),b={case_id:c.id,configuration_digest:c.configuration_digest,case_revision:c.revision,skill_id:bundle.id,skill_digest:bundle.digest,skill_version:bundle.version,created_at:k.clock()};
   k.db.prepare('INSERT INTO commerce_edit_workflow_pins VALUES(?,?,?,?,?)').run(s.tenant_id,s.store_id,c.id,canonical(b),contentDigest(b));return this.status(scope,{case_id:c.id});});}
 status(scope:Scope,input:unknown){const p=exact(jsonValue(input),['case_id']),k=this.kernel,{s,c}=editContext(k,scope,id(p.case_id)),row=k.db.prepare('SELECT * FROM commerce_edit_workflow_pins WHERE tenant_id=? AND store_id=? AND case_id=?').get(s.tenant_id,s.store_id,c.id) as Row,pin=editBody(row),bundle=this.skills.snapshot(scope,pin.skill_id,pin.skill_digest);
  if(pin.configuration_digest!==c.configuration_digest||pin.case_revision!==c.revision)throw new Error('WORKFLOW_CONFIGURATION_CHANGED');
  let settings:Row|null=null,reason:string|null=null;try{settings=editSettings(k,s);}catch(e){reason=e instanceof Error?e.message:'EDIT_READINESS_CHANGED';}
  const operations=this.edits.list(scope,c.id),source={case_id:c.id,configuration_digest:c.configuration_digest,case_revision:c.revision,operations};
  return {...source,source_digest:contentDigest(source),pin,merchant:{tone:c.pins.composition.effective['presentation.tone'],locale:c.pins.composition.effective['presentation.locale']},rules:settings?.rules??null,
   reason,handoff_required:!!reason||operations.some((o:Row)=>o.stages.some((t:Row)=>t.state==='unknown')),execution_authorized:false,qualification:'synthetic_only',
   skill:{id:bundle.id,version:bundle.version,digest:bundle.digest,resources:Object.entries(bundle.files).sort(([a],[b])=>a.localeCompare(b)).map(([path,content])=>({path,sha256:digest(content),content,authority:'guidance_only'}))}};
 }
 quote(scope:Scope,input:unknown){const p=exact(jsonValue(input),['case_id','intent']),status=this.status(scope,{case_id:p.case_id});if(status.reason)throw new Error(status.reason);const v=exact(p.intent,['kind','line_id','variant_id','address']);return this.edits.quote(scope,{case_id:p.case_id,...v});}
}
