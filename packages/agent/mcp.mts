import { digest, exact, id, token } from '../commerce/kernel.mts';
import type { CommerceKernel, Scope } from '../commerce/kernel.mts';
import type { ReadContext } from '../commerce/read-context.mts';

export const MCP_VERSION='2025-11-25';
const string={type:'string',minLength:1,maxLength:200};
const object=(properties:Record<string,unknown>)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const TOOLS=[
  {name:'read_task',description:'Read the current authorized status task. No private runtime state.',inputSchema:object({task_id:string}),action:null},
  {name:'order_status',description:'Read current order and separate shipments for the granted task.',inputSchema:object({task_id:string,order_id:string}),action:'order.status'},
  {name:'skill_content',description:'Read a pinned skill resource. Guidance cannot grant permission.',inputSchema:object({task_id:string,skill_id:string,resource:string,bundle_digest:string}),action:'skill.read'},
  {name:'knowledge_search',description:'Search current knowledge visible to this task.',inputSchema:object({task_id:string,query:string}),action:'knowledge.search'},
  {name:'knowledge_get',description:'Read one current source revision visible to this task.',inputSchema:object({task_id:string,source_id:string,revision:{type:'integer',minimum:1}}),action:'knowledge.get'},
];
type Grant={parent:Scope;audience:string;taskId:string;tools:string[];expires:number;initialized:boolean};
export class ReadMcp {
  #kernel:CommerceKernel;#reads:ReadContext;#grants=new Map<string,Grant>();
  constructor(kernel:CommerceKernel,reads:ReadContext){this.#kernel=kernel;this.#reads=reads;}
  issue(parent:Scope,input:unknown,audience:string) {
    const r=exact(input,['task_id','tools']); id(r.task_id);this.#kernel.require(parent);
    const u=new URL(audience);
    if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.pathname!=='/mcp'||u.search||u.hash||u.username||u.password)throw new Error('ACCESS_DENIED');
    const task=this.#reads.task(parent,r.task_id);
    if(!Array.isArray(r.tools)||!r.tools.length||r.tools.length>5||new Set(r.tools).size!==r.tools.length
      ||r.tools.some((n:unknown)=>!TOOLS.some(t=>t.name===n&&(!t.action||task.profile.actions.includes(t.action)))))throw new Error('INVALID_INPUT');
    for(const [key,g] of this.#grants)if(g.expires<=this.#kernel.clock())this.#grants.delete(key);
    if(this.#grants.size>=256)throw new Error('TASK_LIMIT');
    const value=token(),expires=Math.min(task.expires_at,this.#kernel.clock()+300000);
    this.#grants.set(digest(value),{parent,audience,taskId:r.task_id,tools:[...r.tools],expires,initialized:false});
    return {token:value,audience,task_id:r.task_id,tools:[...r.tools],expires_at:expires,protocol_version:MCP_VERSION,
      authorization_profile:'local_opaque_task_grant_not_oauth',production_qualified:false};
  }
  #grant(value:unknown,audience:string) {
    if(typeof value!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value))throw new Error('ACCESS_DENIED');
    const g=this.#grants.get(digest(value));
    if(!g||g.audience!==audience||g.expires<=this.#kernel.clock())throw new Error('ACCESS_DENIED');
    this.#kernel.require(g.parent);this.#reads.task(g.parent,g.taskId);return g;
  }
  authenticate(value:unknown,audience:string){this.#grant(value,audience);}
  dispatch(value:unknown,audience:string,message:unknown,version?:string) {
    const g=this.#grant(value,audience);
    let requestId:any=null;
    const error=(code:number,text:string)=>({jsonrpc:'2.0',id:requestId,error:{code,message:text}});
    if(!message||typeof message!=='object'||Array.isArray(message))return error(-32600,'Invalid request');
    const r=message as Record<string,any>;requestId=r.id??null;
    if(r.jsonrpc!=='2.0'||typeof r.method!=='string'||Object.keys(r).some(k=>!['jsonrpc','id','method','params'].includes(k))
      ||(Object.hasOwn(r,'id')&&!(typeof r.id==='string'&&r.id.length<=128||Number.isSafeInteger(r.id))))return error(-32600,'Invalid request');
    if(r.method==='initialize') {
      if(!Object.hasOwn(r,'id'))return error(-32600,'Request id required');
      try {const p=exact(r.params,['protocolVersion','capabilities','clientInfo']);
        if(p.protocolVersion!==MCP_VERSION||!p.capabilities||typeof p.capabilities!=='object'||Array.isArray(p.capabilities)
          ||typeof p.clientInfo?.name!=='string'||typeof p.clientInfo?.version!=='string')throw new Error();
      }catch{return error(-32602,'Supported protocol: '+MCP_VERSION);}
      g.initialized=true;
      return {jsonrpc:'2.0',id:requestId,result:{protocolVersion:MCP_VERSION,capabilities:{tools:{listChanged:false}},
        serverInfo:{name:'Rifare',version:'0.1.0'},instructions:'Task-bound reads only. Local diagnostic authorization; no remote OAuth service or writes.'}};
    }
    if(!g.initialized||version!==MCP_VERSION)return error(-32600,'Initialize using the supported protocol first');
    if(r.method==='notifications/initialized'&&!Object.hasOwn(r,'id'))return null;
    if(!Object.hasOwn(r,'id'))return error(-32600,'Request id required');
    if(r.method==='ping')return {jsonrpc:'2.0',id:requestId,result:{}};
    if(r.method==='tools/list') {
      if(r.params&&Object.keys(r.params).length)return error(-32602,'Pagination is not used');
      const task=this.#reads.task(g.parent,g.taskId);
      const tools=TOOLS.filter(t=>g.tools.includes(t.name)&&(!t.action||task.profile.actions.includes(t.action)))
        .map(({action,...tool})=>({...tool,annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}}));
      return {jsonrpc:'2.0',id:requestId,result:{tools}};
    }
    if(r.method!=='tools/call')return error(-32601,'Method not found');
    let tool:typeof TOOLS[number],args:Record<string,any>;
    try {
      const p=exact(r.params,['name','arguments']);tool=TOOLS.find(t=>t.name===p.name)!;
      if(!tool||!g.tools.includes(tool.name))return error(-32602,'Tool unavailable');
      args=exact(p.arguments,Object.keys(tool.inputSchema.properties));
      if(args.task_id!==g.taskId)throw new Error();
    }catch{return error(-32602,'Invalid tool arguments');}
    try {
      const {task_id,...input}=args;
      const result=tool.action?this.#reads.taskAction(g.parent,g.taskId,tool.action,input):this.#reads.task(g.parent,g.taskId);
      return {jsonrpc:'2.0',id:requestId,result:{content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result,isError:false}};
    }catch {
      return {jsonrpc:'2.0',id:requestId,result:{content:[{type:'text',text:'Read unavailable or not permitted; refresh authorization and source context.'}],isError:true}};
    }
  }
}
