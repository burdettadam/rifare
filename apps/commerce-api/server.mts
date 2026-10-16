import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { body,listen,sameOrigin,send } from '../../packages/development/http.mts';
import { exact,id } from '../../packages/commerce/kernel.mts';
import type { CommerceKernel } from '../../packages/commerce/kernel.mts';
import { Capabilities,CapabilityLimitation,READS } from '../../packages/commerce/capabilities.mts';
import type { CustomerAccess } from '../../packages/commerce/customer-access.mts';
import type { SecretVault } from '../../packages/commerce/secrets.mts';
import type { StoreSimulator } from '../../packages/commerce/simulator.mts';

const SAFE_CODES=new Set(['ACCESS_DENIED','NOT_FOUND','INVALID_INPUT','JSON_REQUIRED','BODY_TOO_LARGE','INVALID_JSON',
  'HOST_DENIED','ORIGIN_DENIED','VERIFICATION_FAILED','SECRET_UNAVAILABLE','ADAPTER_UNAVAILABLE','PROVIDER_REJECTED','PROVIDER_UNAVAILABLE','OUTCOME_UNKNOWN']);
export async function startCommerceServer(options:{kernel:CommerceKernel;caps:Capabilities;customers:CustomerAccess;
  simulator:StoreSimulator;vault?:SecretVault;port?:number;log?:(entry:unknown)=>void}) {
  const {kernel,caps,customers,simulator,vault}=options;let port=0;
  const log=(status:number,code:string)=>{try{options.log?.({event:'http_result',status,code});}catch{/* logging cannot grant access */}};
  const server=createServer(async(req,res)=>{
    try {
      sameOrigin(req,port);
      const url=new URL(req.url??'/',`http://127.0.0.1:${port}`);
      if(url.origin!==`http://127.0.0.1:${port}`)throw new Error('HOST_DENIED');
      if(url.pathname==='/health'&&req.method==='GET'){send(res,200,{ready:true,profile:'commerce-sqlite-diagnostic',production_qualified:false});return;}
      const assets:Record<string,[string,string]>={'/':['index.html','text/html'],'/client.js':['client.js','text/javascript'],'/style.css':['style.css','text/css']};
      if(req.method==='GET'&&assets[url.pathname]&&!url.search){
        const [file,mime]=assets[url.pathname];res.writeHead(200,{'content-type':mime+'; charset=utf-8','cache-control':'no-store',
          'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
          'x-content-type-options':'nosniff','referrer-policy':'no-referrer'});res.end(readFileSync(new URL(file,import.meta.url)));return;
      }
      if(url.search&&url.pathname!=='/v1/lookup'&&url.pathname!=='/v1/resources')throw new Error('INVALID_INPUT');
      if(req.method==='POST'&&url.pathname==='/v1/customer/challenges'){
        const result=customers.request(await body(req),req.socket.remoteAddress??'unknown-local');send(res,202,result);log(202,'CHALLENGE_REQUESTED');return;
      }
      if(req.method==='POST'&&url.pathname==='/v1/customer/verify'){
        send(res,200,customers.complete(await body(req)));log(200,'CUSTOMER_VERIFIED');return;
      }
      const auth=req.headers.authorization;
      if(typeof auth!=='string'||!auth.startsWith('Bearer '))throw new Error('ACCESS_DENIED');
      const scope=kernel.authenticate(auth.slice(7));
      if(req.method==='GET'&&url.pathname==='/v1/capabilities')send(res,200,{capabilities:caps.list(scope)});
      else if(req.method==='GET'&&url.pathname==='/v1/resources'){
        if([...url.searchParams.keys()].join(',')!=='kind')throw new Error('INVALID_INPUT');
        send(res,200,{resources:caps.listResources(scope,url.searchParams.get('kind')!)});
      } else if(req.method==='GET'&&url.pathname==='/v1/lookup'){
        if([...url.searchParams.keys()].sort().join(',')!=='external_id,kind')throw new Error('INVALID_INPUT');
        send(res,200,simulator.read(scope,url.searchParams.get('kind')!,url.searchParams.get('external_id')!));
      } else if(req.method==='GET'&&url.pathname.startsWith('/v1/resources/')){
        const resourceId=id(url.pathname.slice('/v1/resources/'.length));const resource=kernel.get(scope,resourceId);
        const action=Object.entries(READS).find(([,v])=>v.kind===resource.kind)?.[0];
        if(!action)throw new CapabilityLimitation('UNKNOWN_ACTION');send(res,200,caps.read(scope,action,resourceId));
      } else if(req.method==='POST'&&url.pathname==='/v1/actions'){
        const r=exact(await body(req),['action','resource_id']);if(typeof r.action!=='string'||r.action.length>64)throw new Error('INVALID_INPUT');
        send(res,200,caps.read(scope,r.action,id(r.resource_id)));
      } else if(req.method==='POST'&&url.pathname==='/v1/session/logout'){
        kernel.revoke(scope);res.setHeader('clear-site-data','"cache", "storage"');send(res,200,{revoked:true});
      } else if(req.method==='GET'&&url.pathname==='/v1/secrets'){
        if(!vault)throw new Error('SECRET_UNAVAILABLE');send(res,200,{references:vault.list(scope)});
      } else if(req.method==='POST'&&url.pathname==='/v1/secrets/probe'){
        if(!vault)throw new Error('SECRET_UNAVAILABLE');const r=exact(await body(req),['ref','adapter']);
        send(res,200,await vault.probe(scope,id(r.ref),id(r.adapter)));
      } else {send(res,404,{error:'NOT_FOUND'});log(404,'NOT_FOUND');return;}
      log(200,'READ_OR_SESSION_OPERATION');
    } catch(error) {
      if(error instanceof CapabilityLimitation){send(res,403,{error:'CAPABILITY_UNAVAILABLE',reason:error.reason});log(403,'CAPABILITY_UNAVAILABLE');return;}
      const code=error instanceof Error&&SAFE_CODES.has(error.message)?error.message:'INTERNAL_ERROR';
      const status=['ACCESS_DENIED','HOST_DENIED','ORIGIN_DENIED','VERIFICATION_FAILED'].includes(code)?403:code==='NOT_FOUND'?404:code==='INTERNAL_ERROR'?500:
        ['SECRET_UNAVAILABLE','ADAPTER_UNAVAILABLE','PROVIDER_UNAVAILABLE','OUTCOME_UNKNOWN'].includes(code)?503:400;
      send(res,status,{error:code});log(status,code);
    }
  });
  port=await listen(server,options.port??0);
  return {port,url:`http://127.0.0.1:${port}`,close:()=>new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();})};
}
