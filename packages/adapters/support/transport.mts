import type {CredentialReader} from '../../commerce/secrets.mts';
import {exact,integer} from '../../commerce/kernel.mts';
import {jsonValue} from '../../commerce/configuration-values.mts';
export type SupportHTTP=(url:string,options:{method:string;headers:Record<string,string>;body?:string;redirect:'error';signal:AbortSignal})=>Promise<{status:number;text:()=>Promise<string>}>;
export function safeOrigin(value:string){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/'||u.port)throw new Error('SUPPORT_ORIGIN_INVALID');return u.origin;}
export function supportReader(provider:string,origin:string,account:string,http?:SupportHTTP,timeoutMs=2000):CredentialReader {
 integer(timeoutMs,1);if(timeoutMs>10000)throw new Error('SUPPORT_TIMEOUT_INVALID');const base=safeOrigin(origin);if(!/^[1-9][0-9]{0,12}$/.test(account)&&provider==='chatwoot')throw new Error('ACCOUNT_INVALID');
 return {provider,async execute(credential,input){const p=exact(jsonValue(input,32768),['method','path','body','operation_id']);
  if(!['GET','POST'].includes(p.method)||typeof p.path!=='string'||p.path.includes('..')||p.path.includes('%')||p.path.includes('\\'))throw new Error('SUPPORT_HTTP_INVALID');
  const allowed=provider==='chatwoot'?new RegExp(`^/api/v1/accounts/${account}/conversations/[1-9][0-9]{0,12}(?:/(?:messages|assignments))?(?:\\?before=[1-9][0-9]{0,12})?$`).test(p.path):/^\/emails(?:\/[A-Za-z0-9_-]{1,96})?$/.test(p.path);
  if(!allowed||p.method==='GET'&&p.body!==null||p.method==='POST'&&p.body===null)throw new Error('SUPPORT_HTTP_INVALID');
  if(!http)throw new Error('SUPPORT_TRANSPORT_NOT_CONFIGURED');
  const headers:Record<string,string>={Authorization:'Bearer '+credential.toString('utf8'),'Content-Type':'application/json','User-Agent':'Rifare/diagnostic-support'};
  if(provider==='resend'&&p.method==='POST'){if(typeof p.operation_id!=='string'||p.operation_id.length>96)throw new Error('INVALID_INPUT');headers['Idempotency-Key']=p.operation_id;}
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('SUPPORT_TRANSPORT_TIMEOUT'));},timeoutMs);});
  try {const r=await Promise.race([http(base+p.path,{method:p.method,headers,...(p.body===null?{}:{body:JSON.stringify(p.body)}),redirect:'error',signal:controller.signal}),deadline]);integer(r.status,100);
   const text=await Promise.race([r.text(),deadline]);if(Buffer.byteLength(text)>262144)throw new Error('SUPPORT_RESPONSE_TOO_LARGE');const body=JSON.parse(text);return {status:r.status,body};
  }finally{clearTimeout(timer);}
 }};
}
