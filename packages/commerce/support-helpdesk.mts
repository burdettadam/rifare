import type {CommerceKernel,Scope,Row} from './kernel.mts';
import {SupportConversations} from './support-conversations.mts';
import type {ChatwootSupportSource} from '../adapters/support/chatwoot.mts';
import {supportCase} from './support-core.mts';
import {assertRecoveryEgress} from './data-guards.mts';
export class SupportHelpdesk {
 readonly k:CommerceKernel;readonly conversations:SupportConversations;readonly source:ChatwootSupportSource;
 constructor(k:CommerceKernel,source:ChatwootSupportSource){this.k=k;this.source=source;this.conversations=new SupportConversations(k);}
 async synchronize(scope:Scope,linkId:string,before:number|null=null){const link=this.conversations.linkRecord(scope,linkId),{s}=supportCase(this.k,scope,link.case_id,'support.ingest');assertRecoveryEgress(this.k);
  if(link.channel!=='helpdesk'||link.account_id!==this.source.account||s.tenant_id!==this.source.tenant||s.store_id!==this.source.store)throw new Error('HELPDESK_ACCOUNT_MISMATCH');
  const page=await this.source.history(link.external_id,before);
  return this.k.transaction(()=>{const current=this.conversations.linkRecord(scope,linkId);supportCase(this.k,scope,link.case_id,'support.ingest');if(current.account_id!==link.account_id||current.external_id!==link.external_id||current.case_id!==link.case_id||current.source_revision!==link.source_revision)throw new Error('HELPDESK_CONTEXT_CHANGED');
   const messages=page.messages.map((m:Row)=>this.conversations.ingest(scope,{link_id:linkId,...m}));this.k.db.prepare("UPDATE commerce_support_links SET history='partial',source_revision=source_revision+1 WHERE tenant_id=? AND store_id=? AND id=?").run(s.tenant_id,s.store_id,linkId);
   return {link_id:linkId,messages,source_identity:this.source.identity,history_complete:false,next_before:page.next_before,absence_proves_no_reply:false,production_qualified:false};});
 }
}
