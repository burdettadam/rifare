import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {shadowFixture} from './decision-shadow-helpers.mts';
import {loadSkillDirectory} from '../../packages/commerce/skills.mts';
import {SecretVault} from '../../packages/commerce/secrets.mts';
import {ImageAssistance} from '../../packages/commerce/image-assistance.mts';
import {IMAGE_ADAPTER,IMAGE_MODEL,imageReader} from '../../packages/agent/image-reader.mts';

export const imageFixture=(name:string)=>JSON.parse(readFileSync(new URL('../fixtures/image-assistance/'+name+'.json',import.meta.url),'utf8'));
export const PHOTO=JSON.parse(readFileSync(new URL('../fixtures/return-intake/photo.v1.json',import.meta.url),'utf8')).base64;
export function imageAssistanceFixture(){
  const f=shadowFixture(),requests:any[]=[],wire=imageFixture('wire-responses.v1'),ref='images_a';
  const imageBundle=loadSkillDirectory(fileURLToPath(new URL('../../packages/commerce/skill-bundles/return-intake-images/',import.meta.url)));
  const origin='https://rifare.invalid/skills/return-intake-images';
  const installApproval=f.installer.approve(f.owner.scope,{origin,bundle_digest:imageBundle.digest,skill_id:imageBundle.id,version:imageBundle.version,expires_at:f.now()+3600000});
  f.installer.install(f.a.scope,installApproval.id,{origin,bundle:imageBundle});
  f.reads.profiles.put(f.a.scope,f.profile(f.a,{id:'images',skill_id:imageBundle.id,skill_digest:imageBundle.digest,tone:'warm',locale:'en-US'}));
  const imageCase=f.cases.create(f.customer,{case_id:'image_case_a',resource_id:f.order().id,profile_id:'images',policy_id:'returns'});
  const imageLink=f.conversations.link(f.a.scope,f.customer,{case_id:imageCase.id,channel:'webchat',account_id:'image_channel_a',external_id:'image_thread_a',history:'complete',source_revision:1});
  let counter=0,before:(()=>unknown)|undefined,reply:any=structuredClone(wire.clear);
  const imageMessage=(text:string)=>f.conversations.ingest(f.a.scope,{link_id:imageLink.id,external_id:'image_message_'+(++counter),direction:'incoming',visibility:'public',text,source_at:f.now()});
  imageMessage('The shirt seam is damaged. Please inspect the visible seam; I request a refund.');
  const imageTask=f.reads.createTask(f.a.scope,{order_id:f.order().id,profile_id:'images'});
  const reader=imageReader({serving_configuration_ref:ref,account_id:'a'.repeat(32),approved_account_ids:['a'.repeat(32)],model_id:IMAGE_MODEL,approved_model_ids:[IMAGE_MODEL],fixtureTransport:(async(_url:any,init:any)=>{
    requests.push({body:JSON.parse(init.body),authorization_present:new Headers(init.headers).has('authorization')});await before?.();
    if(reply instanceof Error)throw reply;return new Response(JSON.stringify(reply));
  }) as typeof fetch});
  const vault=new SecretVault(f.kernel,{activeId:'image_fixture_key',get:()=>Buffer.alloc(32,6)},{},{[IMAGE_ADAPTER]:reader});
  const secret=vault.put(f.a.scope,{provider:'cloudflare',adapter:IMAGE_ADAPTER,value:'SYNTHETIC_IMAGE_SECRET'}).ref;
  const configurations=[{id:ref,tenant_id:f.a.tenant,store_id:f.a.store,secret_ref:secret,reader}];
  const images=new ImageAssistance(f.kernel,f.reads,vault,f.evidence,configurations);
  const configuration=(extra:any={})=>({id:ref,expected_version:0,enabled:true,expires_at:f.now()+3600000,purpose:'return_evidence_usability',modality:'image',...extra});
  images.configure(f.owner.scope,configuration());
  const upload=(extra:any={})=>images.upload(f.customer,{configuration_id:ref,case_id:imageCase.id,mime:'image/png',base64:PHOTO,note:'SYNTHETIC_IMAGE_NOTE',customer_opt_in:true,...extra});
  const approvalInput=(e:any,extra:any={})=>({case_id:imageCase.id,task_id:imageTask.id,configuration_id:ref,evidence_id:e.id,sha256:e.sha256,consent:true,...extra});
  const approve=async()=>{const evidence=upload();await f.evidence.scan(f.reviewer.scope,evidence.id);const approval=images.approve(f.customer,approvalInput(evidence));return {evidence,approval};};
  const imageInput=(approval:any,extra:any={})=>({case_id:imageCase.id,task_id:imageTask.id,configuration_id:ref,approval_id:approval.id,request_id:'image_request_'+(++counter),...extra});
  const imageRows=()=>f.db.prepare("SELECT * FROM commerce_assistance_receipts WHERE tenant_id=? AND store_id=? AND json_extract(body,'$.kind') IN ('image_approval','image_observation','image_disagreement') ORDER BY id").all(f.a.tenant,f.a.store);
  return {...f,images,imageReader:reader,imageVault:vault,imageSecret:secret,imageConfigurations:configurations,imageBundle,imageCase,imageTask,imageLink,installApproval,imageRef:ref,configuration,upload,approvalInput,approve,imageInput,imageMessage,imageRows,imageRequests:requests,imageWire:wire,
    imageBefore:(fn:typeof before)=>{before=fn;},imageResponse:(value:any)=>{reply=value;},imageRespond:(name:string)=>{reply=structuredClone(wire[name]);}};
}
export async function usingImages(fn:(f:ReturnType<typeof imageAssistanceFixture>)=>unknown){const f=imageAssistanceFixture();try{return await fn(f);}finally{f.cleanup();}}
