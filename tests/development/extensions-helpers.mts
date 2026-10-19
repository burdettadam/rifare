import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { executionFixture } from './execution-helpers.mts';
import { Extensions } from '../../packages/commerce/extension-lifecycle.mts';
import { EXTENSION_TABLES } from '../../packages/commerce/extension-privacy.mts';
import { contentDigest } from '../../packages/commerce/configuration-values.mts';

export const extensionRoot=fileURLToPath(new URL('../../',import.meta.url));
export const extensionOracle=JSON.parse(readFileSync(new URL('../fixtures/extensions/compatibility.v1.json',import.meta.url),'utf8'));
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const pin=(path:string)=>({path,sha256:hash(readFileSync(join(extensionRoot,path)))});
export function extensionArtifact(version='1.0.0',options:{breaking?:boolean;kind?:'instruction'|'host_adapter'}={}){
 const origin='https://extensions.example.invalid/releases/order-status';
 const files:Record<string,string>={
  'SKILL.md':'---\nname: order-status\ndescription: Read current order status through the existing typed tools.\n---\nSelect current source facts. This instruction grants no permissions.\n',
  'references/input.json':JSON.stringify({type:'object',properties:{order_id:{type:'string'},...(options.breaking?{requested_locale:{type:'string'}}:{})},required:['order_id'],additionalProperties:false}),
  'references/output.json':JSON.stringify({type:'object',properties:{status:{type:'string'}},required:['status'],additionalProperties:false}),
  'references/config.json':JSON.stringify({type:'object',properties:{},additionalProperties:false}),
  'references/guide.md':'Synthetic locally mirrored instruction '+version+'. No model or vendor service is required.\n',
  'references/NOTICE.txt':'Synthetic fixture notice; no rights attested.',
 };
 const manifest={schema_version:2,id:'order-status',version,engine:{min:'1.0.0',max_exclusive:'2.0.0'},required_actions:[{name:'order.status',versions:{min:'1.0.0',max_exclusive:'2.0.0'}}],resources:Object.entries(files).filter(([path])=>path!=='SKILL.md').map(([path,text])=>({path,sha256:hash(text)})),input_schema:'references/input.json',output_schema:'references/output.json',configuration:{schema_resource:'references/config.json',fields:[]},scripts:[],egress:[]};
 files['commerce-manifest.json']=JSON.stringify(manifest);
 const artifact:any={format:'rifare-extension-artifact-v1',id:'order-status',version,kind:options.kind??'instruction',
  origin:{uri:origin,revision:'e36dbcd7cf392d04f21d082e834698bbc6a1ac79',sha256:''},
  ownership:{owner_id:'synthetic_contributor',license:'Apache-2.0',notice_sha256:hash('Synthetic fixture notice; no rights attested.'),provenance_sha256:pin('tests/fixtures/extensions/compatibility.v1.json').sha256,support_id:'synthetic_support'},
  contract:{sdk_version:'rifare-extension-v1',engine_version:'1.0.0',actions:[{name:'order.status',version:'1.0.0'}]},
  evidence:{fixture:{...pin('tests/fixtures/extensions/compatibility.v1.json'),version:'rifare-extension-fixtures-v1'},source_pins:[pin('packages/commerce/skill-contract.mts'),pin('packages/commerce/skill-installer.mts')],test_pins:extensionOracle.retained_cases.map((id:string)=>({id,...pin('tests/development/skill-contract.test.mts')}))},
  payload:{format:'rifare-instruction-bundle-v1',origin,files}};
 if(artifact.kind==='host_adapter'){
  const catalog=JSON.parse(readFileSync(join(extensionRoot,'tests/fixtures/conformance/adapter-catalog.v1.json'),'utf8')),adapter=catalog.adapters.find((a:any)=>a.id==='shopify_orders'),op=adapter.operations.find((o:any)=>o.id==='orders.get');
  artifact.id='shopify-orders';artifact.payload={adapter_id:adapter.id,version:adapter.version,api_version:adapter.api_version,operations:[op.id],source_pins:adapter.source_files,notice_text:'Synthetic fixture notice; no rights attested.'};
  artifact.contract.actions=[];artifact.evidence.source_pins=adapter.source_files;
  artifact.evidence.test_pins=op.native_cases.map(({id,path,sha256}:any)=>({id,path,sha256}));
 }
 artifact.origin.sha256=contentDigest(artifact.payload);return artifact;
}
export function artifactBytes(artifact:unknown){const bytes=Buffer.from(JSON.stringify(artifact));return {bytes,sha256:hash(bytes)};}
export function extensionsFixture(){
 const f=executionFixture(),extensions=new Extensions(f.kernel,{root:extensionRoot});
 const member=(store:any,name:string,role:'owner'|'reviewer')=>{f.kernel.provisionMember(store.tenant,store.store,name,role);return f.kernel.authenticate(f.kernel.issueSession(store.tenant,store.store,name));};
 const otherOwner=member(f.b,'extension_owner','owner'),otherReviewer=member(f.b,'extension_reviewer','reviewer');
 f.reads.profiles.put(f.b.scope,f.profile(f.b));
 function stage(artifact=extensionArtifact(),scope=f.a.scope,owner=f.owner.scope){const encoded=artifactBytes(artifact),a=extensions.stage(scope,{bytes:encoded.bytes,sha256:encoded.sha256}),review=extensions.reviewArtifact(owner,{artifact_id:a.id,expires_at:f.now()+600000});return {artifact,a,review};}
 function install(version='1.0.0',scope=f.a.scope,owner=f.owner.scope){const x=stage(extensionArtifact(version),scope,owner),p=f.reads.profiles.get(scope,'default');extensions.install(scope,{artifact_id:x.a.id,review_id:x.review.id,profile_id:'default',expected_profile_revision:p.profile.revision});return x;}
 function next(version='1.1.0',options:{breaking?:boolean;strategy?:string|null;changes?:any}={}){
  const active=extensions.installed(f.a.scope,'order-status'),x=stage(extensionArtifact(version,{breaking:options.breaking})),p=f.reads.profiles.get(f.a.scope,'default');
  const transition=extensions.planTransition(f.a.scope,{id:'transition_'+version.replaceAll('.','_'),from_artifact_id:active.id,to_artifact_id:x.a.id,review_id:x.review.id,profile_id:'default',expected_profile_revision:p.profile.revision,changes:options.changes??{tone:'warm',locale:'fr-CA'},strategy:options.strategy??null});
  extensions.reviewTransition(f.reviewer.scope,{transition_id:transition.id,expected_digest:transition.digest,expires_at:f.now()+600000});return {...x,transition};
 }
 function publishExtension(artifactId:string,percent=100,scope=f.a.scope,reviewer=f.reviewer.scope,owner=f.owner.scope){const x=extensions.get(scope,artifactId),r=f.releases.stage(scope,{skill_id:x.extension_id,bundle_digest:x.bundle_digest,rollout_percent:percent}),evaluated=f.releases.evaluate(scope,r.id);f.releases.review(reviewer,{release_id:r.id,test_digest:evaluated.test_digest,rollout_percent:percent});const active=f.releases.active(scope,x.extension_id);f.releases.publish(owner,{release_id:r.id,expected_revision:active?.revision??0,rollout_percent:percent});return {release:r,evaluated};}
 return {...f,extensions,otherOwner,otherReviewer,stage,install,next,publishExtension};
}
export async function usingExtensions(run:(f:ReturnType<typeof extensionsFixture>)=>unknown){const f=extensionsFixture();try{return await run(f);}finally{f.cleanup();}}
export function populateExtensionPrivacy(f:ReturnType<typeof extensionsFixture>){
 const first=f.install(),next=f.next();f.extensions.activate(f.a.scope,{transition_id:next.transition.id,expected_profile_revision:2});
 const retirement=f.extensions.proposeRetirement(f.a.scope,{id:'privacy_retirement',artifact_id:first.a.id,replacement_artifact_id:next.a.id,notice:{uri:'https://extensions.example.invalid/notices/order-status',revision:'1',sha256:'a'.repeat(64)},effective_at:f.now()+86400000,export_digest:f.extensions.exportArtifact(f.a.scope,first.a.id).digest,reader_retained:true,retained_test_ids:[...extensionOracle.retained_cases],strategy:'retain_pins_and_repreview'});
 f.extensions.reviewRetirement(f.reviewer.scope,{retirement_id:retirement.id,expected_digest:retirement.digest,expires_at:f.now()+600000});
 const approvalIds=f.db.prepare('SELECT body FROM commerce_extension_reviews WHERE tenant_id=? AND store_id=?').all(f.a.tenant,f.a.store).map((r:any)=>JSON.parse(r.body).skill_approval_id).filter(Boolean);
 const unrelated=f.db.prepare('SELECT id FROM commerce_skill_approvals WHERE tenant_id=? AND store_id=?').all(f.a.tenant,f.a.store).map((r:any)=>r.id).filter((id:string)=>!approvalIds.includes(id));
 return {owner_scope:f.owner.scope,tables:[...EXTENSION_TABLES],subject_tables:[],authority_tables:['commerce_extension_reviews','commerce_extension_transitions','commerce_extension_retirements'],authority_state:'revoked',approval_ids:approvalIds,unrelated_approval_ids:unrelated,installation_refs:[{tenant_id:f.a.tenant,store_id:f.a.store,skill_id:'order-status'}],first,next,retirement};
}
