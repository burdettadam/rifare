import { exact,id,integer } from './kernel.mts';
import type { Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { inspectExtensionArtifact,extensionHash } from './extension-artifacts.mts';
import type { ExtensionContext } from './extension-artifacts.mts';

const PROFILE_FIELDS=['id','revision','tenant_id','store_id','skill_id','skill_digest','tone','locale','actions','data_scope'];
export function classifyProfileTransition(before:unknown,after:unknown){
 const a=exact(jsonValue(before),PROFILE_FIELDS),b=exact(jsonValue(after),PROFILE_FIELDS);
 for(const p of [a,b]){for(const field of ['id','tenant_id','store_id','skill_id'])id(p[field]);integer(p.revision,1);extensionHash(p.skill_digest);if(!['neutral','warm','formal'].includes(p.tone)||!['en-US','en-GB','fr-CA'].includes(p.locale))throw new Error('EXTENSION_PROFILE_INVALID');}
 if(a.id!==b.id||a.tenant_id!==b.tenant_id||a.store_id!==b.store_id||b.revision!==a.revision+1)throw new Error('EXTENSION_PROFILE_SCOPE_CHANGED');
 const changed=PROFILE_FIELDS.filter(field=>canonical(a[field])!==canonical(b[field])),breaking=changed.filter(field=>['actions','data_scope','skill_id'].includes(field));
 return {classification:breaking.length?'breaking':'compatible',changed_fields:changed,breaking_fields:breaking,before_digest:contentDigest(a),after_digest:contentDigest(b),skill_binding_changed:a.skill_digest!==b.skill_digest,pending_cases:'retain_immutable_pins',execution_authorized:false};
}
function semantics(checked:ReturnType<typeof inspectExtensionArtifact>){
 if(!checked.bundle)return {contract:checked.contract,payload:checked.artifact.payload};
 const m=JSON.parse(checked.bundle.files['commerce-manifest.json']);
 return {contract:checked.contract,engine:m.engine,required_actions:m.required_actions,configuration:m.configuration,
  input_schema:JSON.parse(checked.bundle.files[m.input_schema]),output_schema:JSON.parse(checked.bundle.files[m.output_schema]),configuration_schema:JSON.parse(checked.bundle.files[m.configuration.schema_resource])};
}
export function classifyExtensionTransition(previous:unknown,next:unknown,options:ExtensionContext={}){
 const a=inspectExtensionArtifact(previous,options),b=inspectExtensionArtifact(next,options);if(a.subject.id!==b.subject.id||a.subject.kind!==b.subject.kind)throw new Error('EXTENSION_IDENTITY_CHANGED');
 if(a.digest===b.digest)throw new Error('EXTENSION_VERSION_UNCHANGED');
 const x=a.subject.version.split('.').map(Number),y=b.subject.version.split('.').map(Number);if((y[0]-x[0]||y[1]-x[1]||y[2]-x[2])<=0)throw new Error('EXTENSION_VERSION_ORDER');
 const before=semantics(a),after=semantics(b),changed=Object.keys(before).filter(key=>canonical((before as Row)[key])!==canonical((after as Row)[key]));
 const breaking=changed.length>0;if(breaking&&y[0]<=x[0])throw new Error('EXTENSION_BREAKING_VERSION_REQUIRED');
 return {classification:breaking?'breaking':'compatible',changed_contract_fields:changed,from_digest:a.digest,to_digest:b.digest,from_version:a.subject.version,to_version:b.subject.version,required_strategy:breaking?'retain_pins_and_repreview':null,pending_cases:'retain_immutable_pins',execution_authorized:false};
}
function strings(input:unknown,max=128){if(!Array.isArray(input)||input.length>max||new Set(input).size!==input.length||input.some(x=>typeof x!=='string'||!x||x.length>200))throw new Error('EXTENSION_IMPACT_INVALID');return [...input].sort() as string[];}
export function retirementImpact(requiredTests:unknown,retainedTests:unknown,goals:unknown,stores:unknown){
 const required=strings(requiredTests),retained=strings(retainedTests),missing=required.filter(id=>!retained.includes(id));if(!required.length)throw new Error('EXTENSION_EVIDENCE_REQUIRED');
 if(missing.length)throw new Error('EXTENSION_TEST_RETIREMENT_BLOCKED');
 return {retained_tests:retained,removed_tests:missing,affected_goals:strings(goals),affected_stores:strings(stores),requires_human_adoption:true,release_authorized:false};
}
