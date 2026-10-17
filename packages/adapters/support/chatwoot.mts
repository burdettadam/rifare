import type {CommerceKernel,Scope,Row} from '../../commerce/kernel.mts';
import type {SecretVault} from '../../commerce/secrets.mts';
import type {SupportSource} from '../support-fixture-source.mts';
import {id,integer} from '../../commerce/kernel.mts';
import {contentDigest} from '../../commerce/configuration-values.mts';
import {safeOrigin} from './transport.mts';
export const CHATWOOT_CONTRACT='chatwoot_support_v419_snapshot';
export class ChatwootSupportSource implements SupportSource {
 readonly tenant:string;readonly store:string;readonly account:string;readonly identity:string;readonly contract=CHATWOOT_CONTRACT;readonly evidence_kind='connected_unqualified' as const;
 readonly k:CommerceKernel;readonly vault:SecretVault;readonly scope:Scope;readonly config:{origin:string;secret_ref:string;reader:string};
 constructor(k:CommerceKernel,vault:SecretVault,scope:Scope,input:{account:string;origin:string;secret_ref:string;reader:string}) {
  const s=k.authorize(scope,'secret.invoke');this.k=k;this.vault=vault;this.scope=scope;this.tenant=s.tenant_id;this.store=s.store_id;
  if(!/^[1-9][0-9]{0,12}$/.test(input.account))throw new Error('ACCOUNT_INVALID');id(input.secret_ref);id(input.reader);this.account=input.account;this.config={origin:safeOrigin(input.origin),secret_ref:input.secret_ref,reader:input.reader};
  this.identity='chatwoot_'+contentDigest([this.tenant,this.store,this.account,this.config]).slice(0,40);
 }
 async #request(method:string,path:string,body:unknown=null,operation:string|null=null){return await this.vault.invokeReader(this.scope,this.config.secret_ref,this.config.reader,{method,path,body,operation_id:operation}) as Row;}
 #path(conversation:string){if(!/^[1-9][0-9]{0,12}$/.test(conversation))throw new Error('CONVERSATION_INVALID');return `/api/v1/accounts/${this.account}/conversations/${conversation}`;}
 async history(conversation:string,before:number|null=null){if(before!==null)integer(before,1);const r=await this.#request('GET',this.#path(conversation)+'/messages'+(before===null?'':'?before='+before));
  if(r.status!==200||!Array.isArray(r.body.payload)||r.body.payload.length>100)throw new Error('HELPDESK_HISTORY_UNAVAILABLE');
  const seen=new Set<number>(),messages=r.body.payload.map((m:any)=>{integer(m.id,1);integer(m.created_at);if(seen.has(m.id)||m.account_id!==Number(this.account)||m.conversation_id!==Number(conversation)||typeof m.private!=='boolean'||typeof m.content!=='string'||Buffer.byteLength(m.content)>8000||![0,1,2].includes(m.message_type))throw new Error('HELPDESK_MESSAGE_INVALID');seen.add(m.id);return {external_id:String(m.id),text:m.content,direction:m.private?'internal':m.message_type===0?'incoming':'outgoing',visibility:m.private?'staff':'public',source_at:m.created_at*1000};});
  return {messages,history:'partial',next_before:messages.length?Math.min(...seen):null,absence_proves_no_reply:false,outbound_history:'only_returned_page',assignment:'supported_contract_unqualified',customer_sending:false};
 }
 async send(command:Row){const p=command.payload;if(command.tenant_id!==this.tenant||command.store_id!==this.store||p.account_id!==this.account||contentDigest(p)!==command.payload_hash||!['note','handoff'].includes(p.kind))throw new Error('SOURCE_SCOPE_MISMATCH');
  const path=this.#path(p.conversation_id),marker=`[Rifare ${command.operation_id} ${command.payload_hash}]`;
  const r=await this.#request('POST',path+(p.kind==='note'?'/messages':'/assignments'),p.kind==='note'?{content:p.text+'\n'+marker,message_type:'outgoing',private:true,content_type:'text'}:{assignee_id:Number(p.assignee_id)},command.operation_id);
  if(r.status<200||r.status>=300)return {kind:'unknown'};
  if(p.kind==='note'){const b=r.body;if(b.account_id!==Number(this.account)||b.conversation_id!==Number(p.conversation_id)||b.private!==true||b.content!==p.text+'\n'+marker||!Number.isSafeInteger(b.id))return {kind:'unknown'};return this.#result(command,String(b.id),'internal_note');}
  const assignee=r.body.assignee??r.body;if(assignee.id!==Number(p.assignee_id))return {kind:'unknown'};
  return this.#result(command,'assignment_'+p.conversation_id+'_'+p.assignee_id,'assigned');
 }
 #result(command:Row,native:string,stage:string){return {kind:'accepted',operation_id:command.operation_id,payload_hash:command.payload_hash,source_identity:this.identity,account_id:this.account,native_id:native,stage,purpose:'internal',customer_delivered:false,observed_at:this.k.clock(),version:1};}
 async lookup(opId:string,hash:string){id(opId);const s=this.k.require(this.scope),row=this.k.db.prepare('SELECT body,digest,observation FROM commerce_support_deliveries WHERE tenant_id=? AND store_id=? AND operation_id=? AND source_identity=? AND erased=0').get(s.tenant_id,s.store_id,opId,this.identity) as Row;
  if(!row||row.digest!==hash)throw new Error('SOURCE_SCOPE_MISMATCH');const p=JSON.parse(row.body),command={operation_id:opId,payload_hash:hash};
  if(p.kind==='note'){const marker=`[Rifare ${opId} ${hash}]`,page=await this.history(p.conversation_id);const found=page.messages.filter((m:any)=>m.visibility==='staff'&&m.text===p.text+'\n'+marker);
   if(found.length!==1)return null;return this.#result(command,found[0].external_id,'internal_note');}
  // Assignment state without an operation correlation is not proof this operation succeeded.
  return row.observation?JSON.parse(row.observation):null;
 }
}
