import { exact,id,integer } from './kernel.mts';
import type { Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue,invalid,returnRules,stringSet,sourceReference } from './configuration-values.mts';

const ORDER=['base','platform','industry','merchant','store','segment','locale'];
export const EDIT_FIELDS=Object.freeze(['returns.window_days','returns.require_evidence','returns.excluded_tags','returns.outcomes','presentation.tone','presentation.locale']);
const ALL=[...EDIT_FIELDS,'data.max_age_seconds','required_capabilities'];
const ALLOWED:Record<string,readonly string[]>={base:ALL,platform:['data.max_age_seconds','required_capabilities'],industry:EDIT_FIELDS,merchant:EDIT_FIELDS,store:EDIT_FIELDS,segment:EDIT_FIELDS,locale:['presentation.locale']};
export function defaultValues(){return {'returns.window_days':30,'returns.require_evidence':false,'returns.excluded_tags':[],'returns.outcomes':['refund','exchange'],
 'presentation.tone':'neutral','presentation.locale':'en-US','data.max_age_seconds':300,'required_capabilities':[]};}
export function rulesFromValues(v:Row){return returnRules({window_days:v['returns.window_days'],require_evidence:v['returns.require_evidence'],excluded_tags:v['returns.excluded_tags'],outcomes:v['returns.outcomes']});}
function fieldValue(path:string,value:unknown){
  if(path==='returns.window_days'){if(!Number.isSafeInteger(value)||Number(value)<0||Number(value)>365)invalid(path,'RANGE');return value;}
  if(path==='returns.require_evidence'){if(typeof value!=='boolean')invalid(path,'TYPE');return value;}
  if(path==='returns.excluded_tags')return stringSet(value,path);
  if(path==='returns.outcomes'){const a=stringSet(value,path,['refund','exchange','store_credit']);if(!a.length)invalid(path,'EMPTY');return a;}
  if(path==='presentation.tone'){if(!['neutral','warm','formal'].includes(value as string))invalid(path,'ENUM');return value;}
  if(path==='presentation.locale'){if(!['en-US','en-GB','fr-CA'].includes(value as string))invalid(path,'ENUM');return value;}
  if(path==='data.max_age_seconds'){if(!Number.isSafeInteger(value)||Number(value)<1||Number(value)>3600)invalid(path,'RANGE');return value;}
  if(path==='required_capabilities')return stringSet(value,path);
  invalid(path,'PROTECTED_FIELD');
}
export type CompositionContext={tenant_id:string;store_id:string;platform:string;capabilities:readonly string[];
  approvals?:readonly {layer_digest:string;actor_id:string}[]};
export function compileLayers(input:unknown,context:CompositionContext){
  id(context.tenant_id);id(context.store_id);id(context.platform);
  if(!Array.isArray(input)||!input.length||input.length>16)invalid('layers','COUNT');
  const layers=jsonValue(input).map((value:any)=>{
    const l=exact(value,['id','kind','revision','tenant_id','store_id','values','source']);id(l.id);integer(l.revision,1);
    if(!ORDER.includes(l.kind))invalid('layer.kind','ENUM');
    if(['base','platform','industry'].includes(l.kind)){
      if(l.tenant_id!==null||l.store_id!==null)invalid('layer','GLOBAL_SCOPE');
    }else if(l.tenant_id!==context.tenant_id||l.store_id!==context.store_id)invalid('layer','SCOPE_MISMATCH');
    if(!l.values||typeof l.values!=='object'||Array.isArray(l.values))invalid('layer.values','TYPE');
    const values:Row={};for(const [path,v] of Object.entries(l.values)){
      if(!ALLOWED[l.kind].includes(path))invalid(path,'PROTECTED_FIELD');values[path]=fieldValue(path,v);
    }
    return {...l,source:sourceReference(l.source),values};
  });
  if(layers.filter((l:any)=>l.kind==='base').length!==1)invalid('layers','ONE_BASE_REQUIRED');
  if(new Set(layers.map((l:any)=>l.id)).size!==layers.length)invalid('layers','DUPLICATE_ID');
  const base=layers.find((l:any)=>l.kind==='base');
  if(Object.keys(base.values).sort().join(',')!==[...ALL].sort().join(','))invalid('base','INCOMPLETE');
  const writes=new Set<string>();for(const l of layers)for(const key of Object.keys(l.values)){
    const conflict=l.kind+':'+key;if(writes.has(conflict))invalid(key,'SAME_PRECEDENCE_CONFLICT');writes.add(conflict);
  }
  layers.sort((a:any,b:any)=>ORDER.indexOf(a.kind)-ORDER.indexOf(b.kind)||a.id.localeCompare(b.id,'en'));
  const effective:Row={},provenance:Row={};
  for(const l of layers){const layer_digest=contentDigest(l),approval=context.approvals?.find(a=>a.layer_digest===layer_digest);
    if(approval)id(approval.actor_id);
    for(const [path,value] of Object.entries(l.values)){
      effective[path]=value;provenance[path]={layer_id:l.id,kind:l.kind,revision:l.revision,source:l.source,layer_digest,approved_by:approval?.actor_id??null};
    }
  }
  rulesFromValues(effective);
  const missing=effective.required_capabilities.filter((a:string)=>!context.capabilities.includes(a));
  return {effective,provenance,effective_digest:contentDigest(effective),composition_digest:contentDigest({layers,context:{tenant_id:context.tenant_id,store_id:context.store_id,platform:context.platform,capabilities:[...context.capabilities].sort()},provenance}),
    readiness:{ready:missing.length===0,missing_capabilities:missing},execution_authorized:false};
}
export function baseLayer(){return {id:'base',kind:'base',revision:1,tenant_id:null,store_id:null,values:defaultValues(),
 source:{uri:'https://rifare.invalid/profiles/base',revision:'1',sha256:contentDigest(defaultValues())}};}
