import { digest, exact, integer } from './kernel.mts';
import type { Row } from './kernel.mts';

export class ConfigurationError extends Error {
  readonly issues: {path:string;code:string}[];
  constructor(path:string,code:string){super('CONFIGURATION_INVALID');this.issues=[{path,code}];}
}
export function invalid(path:string,code:string):never {throw new ConfigurationError(path,code);}
export function jsonValue(value:unknown,maxBytes=131072):any {
  function walk(v:any,depth:number):any {
    if(depth>16)invalid('$','TOO_DEEP');
    if(v===null||typeof v==='boolean'||typeof v==='string')return v;
    if(typeof v==='number'&&Number.isFinite(v)&&!Object.is(v,-0))return v;
    if(Array.isArray(v))return v.map(x=>walk(x,depth+1));
    if(v&&typeof v==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(v))){
      const out:Row=Object.create(null);
      for(const key of Object.keys(v).sort()){
        if(['__proto__','constructor','prototype'].includes(key))invalid('$','UNSAFE_KEY');
        const descriptor=Object.getOwnPropertyDescriptor(v,key)!;
        if(!Object.hasOwn(descriptor,'value'))invalid('$','NON_JSON');
        out[key]=walk(descriptor.value,depth+1);
      }
      if(Reflect.ownKeys(v).length!==Object.keys(v).length)invalid('$','NON_JSON');
      return out;
    }
    invalid('$','NON_JSON');
  }
  const text=JSON.stringify(walk(value,0));
  if(Buffer.byteLength(text)>maxBytes)invalid('$','TOO_LARGE');
  return JSON.parse(text);
}
export const canonical=(value:unknown)=>JSON.stringify(jsonValue(value));
export const contentDigest=(value:unknown)=>digest(canonical(value));
export function stringSet(value:unknown,path:string,allowed?:readonly string[],max=32):string[]{
  if(!Array.isArray(value)||value.length>max||new Set(value).size!==value.length
    ||value.some(v=>typeof v!=='string'||!/^[a-zA-Z0-9_.-]{1,80}$/.test(v)||allowed&&!allowed.includes(v)))invalid(path,'INVALID_SET');
  return [...value].sort();
}
export const RETURN_FIELDS=Object.freeze(['window_days','require_evidence','excluded_tags','outcomes']);
export function returnRules(value:unknown) {
  let r:Row;try{r=exact(jsonValue(value),[...RETURN_FIELDS]);}catch{invalid('returns','FIELDS');}
  if(!Number.isSafeInteger(r.window_days)||r.window_days<0||r.window_days>365)invalid('returns.window_days','RANGE');
  if(typeof r.require_evidence!=='boolean')invalid('returns.require_evidence','TYPE');
  const excluded_tags=stringSet(r.excluded_tags,'returns.excluded_tags');
  const outcomes=stringSet(r.outcomes,'returns.outcomes',['refund','exchange','store_credit']);
  if(!outcomes.length)invalid('returns.outcomes','EMPTY');
  return {window_days:r.window_days,require_evidence:r.require_evidence,excluded_tags,outcomes};
}
export function returnDecision(rules:unknown,facts:unknown){
  const r=returnRules(rules),f=exact(jsonValue(facts),['delivered_at','requested_at','tags','evidence_provided','outcome']);
  integer(f.delivered_at);integer(f.requested_at);
  if(f.requested_at<f.delivered_at||typeof f.evidence_provided!=='boolean'||typeof f.outcome!=='string')invalid('facts','INVALID');
  const tags=stringSet(f.tags,'facts.tags');
  const reasons:string[]=[];
  if(f.requested_at-f.delivered_at>r.window_days*86400000)reasons.push('RETURN_WINDOW_EXPIRED');
  if(tags.some(tag=>r.excluded_tags.includes(tag)))reasons.push('PRODUCT_EXCLUDED');
  if(!r.outcomes.includes(f.outcome))reasons.push('OUTCOME_NOT_ALLOWED');
  if(r.require_evidence&&!f.evidence_provided)reasons.push('EVIDENCE_REQUIRED');
  return {eligible:!reasons.length,reasons:reasons.length?reasons:['ELIGIBLE'],execution_authorized:false};
}
export function sourceReference(value:unknown){
  const r=exact(jsonValue(value),['uri','revision','sha256']);
  if(typeof r.uri!=='string'||r.uri.length>400||typeof r.revision!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(r.revision)
    ||typeof r.sha256!=='string'||!/^[a-f0-9]{64}$/.test(r.sha256))invalid('source','INVALID');
  let url:URL;try{url=new URL(r.uri);}catch{invalid('source.uri','INVALID');}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)invalid('source.uri','UNSAFE');
  return r;
}
