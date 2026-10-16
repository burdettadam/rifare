import { digest,exact,id,token } from '../commerce/kernel.mts';
import type { CommerceKernel,Scope } from '../commerce/kernel.mts';
import { ActionGateway } from '../commerce/action-gateway.mts';
import { MCP_VERSION } from './mcp.mts';

const text={type:'string',minLength:1,maxLength:96};
const schema=(properties:Record<string,unknown>)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const TOOLS=[
  {name:'preview_resolution',permission:'action.propose',inputSchema:schema({case_id:text,resolution:{enum:['none','refund','exchange']}})},
  {name:'execute_resolution',permission:'action.execute',inputSchema:schema({case_id:text,preview_id:text,preview_digest:{type:'string',pattern:'^[a-f0-9]{64}$'},approval_id:text})},
  {name:'resolution_state',permission:'case.read',inputSchema:schema({case_id:text})},
];
type Grant={parent:Scope;caseId:string;tools:string[];audience:string;expires:number;initialized:boolean};
export class ActionMcp {
  #k:CommerceKernel;#gateway:ActionGateway;#grants=new Map<string,Grant>();
  constructor(k:CommerceKernel,gateway:ActionGateway){this.#k=k;this.#gateway=gateway;}
  issue(scope:Scope,input:unknown,audience:string){
    const p=exact(input,['case_id','tools']);id(p.case_id);const u=new URL(audience);
    if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.pathname!=='/execution-mcp'||u.search||u.hash||u.username||u.password)throw new Error('ACCESS_DENIED');
    const c=this.#gateway.cases.inspect(scope,p.case_id);
    if(!Array.isArray(p.tools)||!p.tools.length||p.tools.length>3||new Set(p.tools).size!==p.tools.length)throw new Error('INVALID_INPUT');
    for(const name of p.tools){const tool=TOOLS.find(t=>t.name===name);if(!tool)throw new Error('INVALID_INPUT');this.#k.authorize(scope,tool.permission,c.resource_id);}
    for(const [key,g] of this.#grants)if(g.expires<=this.#k.clock())this.#grants.delete(key);
    if(this.#grants.size>=256)throw new Error('TASK_LIMIT');
    const value=token(),expires=Math.min(this.#k.require(scope).expires_at,this.#k.clock()+300000);
    this.#grants.set(digest(value),{parent:scope,caseId:p.case_id,tools:[...p.tools],audience,expires,initialized:false});
    return {token:value,audience,case_id:p.case_id,tools:[...p.tools],expires_at:expires,authorization_profile:'local_opaque_case_grant_not_oauth',production_qualified:false};
  }
  #grant(value:unknown,audience:string){
    if(typeof value!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value))throw new Error('ACCESS_DENIED');
    const g=this.#grants.get(digest(value));if(!g||g.audience!==audience||g.expires<=this.#k.clock())throw new Error('ACCESS_DENIED');
    this.#k.require(g.parent);this.#gateway.cases.inspect(g.parent,g.caseId);return g;
  }
  authenticate(value:unknown,audience:string){this.#grant(value,audience);}
  dispatch(value:unknown,audience:string,input:unknown,version?:string){
    const g=this.#grant(value,audience);let requestId:any=null;
    const error=(code:number,message:string)=>({jsonrpc:'2.0',id:requestId,error:{code,message}});
    if(!input||typeof input!=='object'||Array.isArray(input))return error(-32600,'Invalid request');
    const r=input as Record<string,any>;requestId=r.id??null;
    if(r.jsonrpc!=='2.0'||typeof r.method!=='string'||Object.keys(r).some(k=>!['jsonrpc','id','method','params'].includes(k))
      ||Object.hasOwn(r,'id')&&!(typeof r.id==='string'&&r.id.length<=128||Number.isSafeInteger(r.id)))return error(-32600,'Invalid request');
    if(r.method==='initialize'){
      if(!Object.hasOwn(r,'id'))return error(-32600,'Request id required');
      try{const p=exact(r.params,['protocolVersion','capabilities','clientInfo']);if(p.protocolVersion!==MCP_VERSION||!p.capabilities||typeof p.capabilities!=='object'||Array.isArray(p.capabilities)||typeof p.clientInfo?.name!=='string'||typeof p.clientInfo?.version!=='string')throw new Error();}catch{return error(-32602,'Unsupported initialization');}
      g.initialized=true;return {jsonrpc:'2.0',id:requestId,result:{protocolVersion:MCP_VERSION,capabilities:{tools:{listChanged:false}},serverInfo:{name:'Rifare execution',version:'0.1.0'},instructions:'Synthetic case-plan changes only. Approval is not an MCP tool. Server authority is rechecked.'}};
    }
    if(!g.initialized||version!==MCP_VERSION)return error(-32600,'Initialize first');
    if(r.method==='notifications/initialized'&&!Object.hasOwn(r,'id'))return null;
    if(!Object.hasOwn(r,'id'))return error(-32600,'Request id required');
    if(r.method==='ping')return {jsonrpc:'2.0',id:requestId,result:{}};
    if(r.method==='tools/list'){
      if(r.params&&Object.keys(r.params).length)return error(-32602,'Pagination is not used');
      const c=this.#gateway.cases.inspect(g.parent,g.caseId);
      const allowed=TOOLS.filter(t=>{if(!g.tools.includes(t.name))return false;try{this.#k.authorize(g.parent,t.permission,c.resource_id);return true;}catch{return false;}});
      return {jsonrpc:'2.0',id:requestId,result:{tools:allowed.map(({permission,...t})=>({...t,description:'Synthetic case-bound '+t.name,
        annotations:{readOnlyHint:t.name==='resolution_state',destructiveHint:t.name==='execute_resolution',idempotentHint:t.name==='resolution_state',openWorldHint:false}}))}};
    }
    if(r.method!=='tools/call')return error(-32601,'Method not found');
    let name:string,args:Record<string,any>;
    try{const p=exact(r.params,['name','arguments']),t=TOOLS.find(t=>t.name===p.name);if(!t||!g.tools.includes(t.name))return error(-32602,'Tool unavailable');
      name=t.name;args=exact(p.arguments,Object.keys(t.inputSchema.properties));if(args.case_id!==g.caseId)throw new Error();
      for(const [field,s] of Object.entries(t.inputSchema.properties) as [string,any][]){const v=args[field];if(s.enum?!s.enum.includes(v):typeof v!=='string'||s.pattern&&!new RegExp(s.pattern).test(v)||s.maxLength&&(v.length<1||v.length>s.maxLength))throw new Error();}
    }catch{return error(-32602,'Invalid arguments');}
    try{
      let result:any;
      if(name==='preview_resolution')result=this.#gateway.prepare(g.parent,{case_id:g.caseId,action:'diagnostic.resolution.set',arguments:{resolution:args.resolution}});
      else if(name==='resolution_state')result=this.#gateway.state(g.parent,g.caseId);
      else {
        // Bind the preview to the granted case before using the same gateway as REST/UI.
        const s=this.#k.require(g.parent),p=this.#k.db.prepare('SELECT case_id FROM commerce_action_previews WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,args.preview_id) as any;
        if(!p||p.case_id!==g.caseId)throw new Error('ACCESS_DENIED');
        result=this.#gateway.execute(g.parent,{preview_id:args.preview_id,preview_digest:args.preview_digest,approval_id:args.approval_id});
      }
      return {jsonrpc:'2.0',id:requestId,result:{content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result,isError:false}};
    }catch{return {jsonrpc:'2.0',id:requestId,result:{content:[{type:'text',text:'Execution denied or stale. Refresh case, permission and exact preview.'}],isError:true}};}
  }
}
