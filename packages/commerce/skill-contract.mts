import { readFileSync } from 'node:fs';
import { digest } from './kernel.mts';
import { jsonValue,invalid,canonical } from './configuration-values.mts';

const schema=JSON.parse(readFileSync(new URL('./contracts/commerce-manifest.v2.schema.json',import.meta.url),'utf8'));
export function manifestSchema(){return jsonValue(schema);}
export const ACTION_CONTRACTS=Object.freeze(Object.fromEntries(['order.status','knowledge.search','knowledge.get','skill.read'].map(name=>[name,'1.0.0'])));
// Only the keywords in this checked-in schema are interpreted; this is not a general schema engine.
function validate(value:any,rule:any,path:string){
  if(rule.const!==undefined&&value!==rule.const)invalid(path,'CONST');
  if(rule.enum&&!rule.enum.includes(value))invalid(path,'ENUM');
  if(rule.type==='object'){
    if(!value||typeof value!=='object'||Array.isArray(value))invalid(path,'TYPE');
    for(const key of rule.required??[])if(!Object.hasOwn(value,key))invalid(path+'.'+key,'REQUIRED');
    for(const [key,item] of Object.entries(value)){
      if(!Object.hasOwn(rule.properties,key))invalid(path+'.'+key,'UNKNOWN_FIELD');validate(item,rule.properties[key],path+'.'+key);
    }
  }
  if(rule.type==='array'){
    if(!Array.isArray(value))invalid(path,'TYPE');
    if(value.length<(rule.minItems??0)||value.length>(rule.maxItems??100))invalid(path,'COUNT');
    if(rule.uniqueItems&&new Set(value.map(canonical)).size!==value.length)invalid(path,'DUPLICATE');
    value.forEach((v:any,i:number)=>validate(v,rule.items??{},`${path}[${i}]`));
  }
  if(rule.type==='string'){
    if(typeof value!=='string')invalid(path,'TYPE');
    if(value.length<(rule.minLength??0)||value.length>(rule.maxLength??1000)||rule.pattern&&!new RegExp(rule.pattern).test(value))invalid(path,'FORMAT');
  }
}
export function withinVersion(actual:string,range:{min:string;max_exclusive:string}){
  const parse=(v:string)=>{if(!/^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$/.test(v))invalid('versions','FORMAT');return v.split('.').map(Number);};
  const a=parse(actual),min=parse(range.min),max=parse(range.max_exclusive);
  const cmp=(x:number[],y:number[])=>x[0]-y[0]||x[1]-y[1]||x[2]-y[2];
  if(cmp(min,max)>=0)invalid('versions','EMPTY_RANGE');
  return cmp(a,min)>=0&&cmp(a,max)<0;
}
export function validateManifest(input:unknown,files?:Record<string,string>,contracts:Readonly<Record<string,string>>=ACTION_CONTRACTS){
  const m=jsonValue(input);validate(m,schema,'manifest');
  if(!withinVersion('1.0.0',m.engine))invalid('manifest.engine','INCOMPATIBLE_VERSION');
  const names=m.required_actions.map((a:any)=>a.name);
  if(new Set(names).size!==names.length)invalid('manifest.required_actions','DUPLICATE');
  for(const [i,a] of m.required_actions.entries())if(!Object.hasOwn(contracts,a.name)||!withinVersion(contracts[a.name],a.versions))invalid(`manifest.required_actions[${i}].versions`,'INCOMPATIBLE_ACTION');
  const paths=m.resources.map((r:any)=>r.path);
  if(new Set(paths).size!==paths.length)invalid('manifest.resources','DUPLICATE');
  for(const path of paths)if(path.split('/').some((p:string)=>!p||p==='.'||p==='..'))invalid('manifest.resources','UNSAFE_PATH');
  for(const [key,path] of Object.entries({input_schema:m.input_schema,output_schema:m.output_schema,configuration:m.configuration.schema_resource})){
    if(!paths.includes(path)||!(path as string).endsWith('.json'))invalid('manifest.'+key,'UNDECLARED_RESOURCE');
  }
  if(files){
    const expected=['SKILL.md','commerce-manifest.json',...paths].sort();
    if(Object.keys(files).sort().join('\n')!==expected.join('\n'))invalid('files','MEMBERSHIP');
    for(const r of m.resources)if(typeof files[r.path]!=='string'||digest(files[r.path])!==r.sha256)invalid('files.'+r.path,'DIGEST');
    for(const path of [m.input_schema,m.output_schema,m.configuration.schema_resource]){
      let data:any;try{data=JSON.parse(files[path]);}catch{invalid('files.'+path,'INVALID_JSON_SCHEMA');}
      if(!data||typeof data!=='object'||Array.isArray(data)||data.type!=='object')invalid('files.'+path,'OBJECT_SCHEMA_REQUIRED');
      const visit=(v:any)=>{if(v&&typeof v==='object')for(const [key,item] of Object.entries(v)){
        if(key==='$ref'&&(typeof item!=='string'||!item.startsWith('#/')))invalid('files.'+path,'EXTERNAL_REFERENCE');visit(item);
      }};visit(data);
    }
  }
  return {manifest:m,required_capabilities:[...names].sort(),authority:'requirements_not_permissions',schema_version:2};
}
