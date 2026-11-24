import { digest } from './values.mts';
import type { Row } from './values.mts';

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
