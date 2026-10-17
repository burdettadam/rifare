import type {CommerceKernel,Scope,Row} from '../../commerce/kernel.mts';import type {SecretVault} from '../../commerce/secrets.mts';import type {SupportSource} from '../support-fixture-source.mts';
import {id} from '../../commerce/kernel.mts';import {contentDigest} from '../../commerce/configuration-values.mts';import {emailAddress} from '../../commerce/support-consent.mts';
export class ResendSupportSource implements SupportSource {
 readonly tenant:string;readonly store:string;readonly account:string;readonly identity:string;readonly contract='resend_email_v1_snapshot';readonly evidence_kind='connected_unqualified' as const;
 readonly k:CommerceKernel;readonly vault:SecretVault;readonly scope:Scope;readonly config:{account:string;secret_ref:string;reader:string;from:string};
 constructor(k:CommerceKernel,vault:SecretVault,scope:Scope,config:{account:string;secret_ref:string;reader:string;from:string}){const s=k.authorize(scope,'secret.invoke');[config.account,config.secret_ref,config.reader].forEach(id);emailAddress(config.from);this.k=k;this.vault=vault;this.scope=scope;this.tenant=s.tenant_id;this.store=s.store_id;this.account=config.account;this.config={...config};this.identity='resend_'+contentDigest([this.tenant,this.store,config]).slice(0,40);}
 async send(c:Row){const p=c.payload;if(c.tenant_id!==this.tenant||c.store_id!==this.store||p.kind!=='email'||p.account_id!==this.account||p.from!==this.config.from||contentDigest(p)!==c.payload_hash)throw new Error('SOURCE_SCOPE_MISMATCH');emailAddress(p.to);
  const r=await this.vault.invokeReader(this.scope,this.config.secret_ref,this.config.reader,{method:'POST',path:'/emails',operation_id:c.operation_id,body:{from:p.from,to:[p.to],subject:p.subject,text:p.text,tags:[{name:'rifare_operation',value:c.operation_id}]}}) as Row;
  if(r.status<200||r.status>=300||typeof r.body.id!=='string'||!/^[A-Za-z0-9_-]{1,96}$/.test(r.body.id))return {kind:'unknown'};
  return {kind:'accepted',operation_id:c.operation_id,payload_hash:c.payload_hash,source_identity:this.identity,account_id:this.account,native_id:r.body.id,stage:'accepted',purpose:p.purpose,customer_delivered:false,observed_at:this.k.clock(),version:1};
 }
 async lookup(opId:string,hash:string){id(opId);const s=this.k.require(this.scope),row=this.k.db.prepare('SELECT body,digest,observation FROM commerce_support_deliveries WHERE tenant_id=? AND store_id=? AND operation_id=? AND source_identity=? AND erased=0').get(s.tenant_id,s.store_id,opId,this.identity) as Row;
  if(!row||row.digest!==hash)throw new Error('SOURCE_SCOPE_MISMATCH');if(!row.observation)return null;const previous=JSON.parse(row.observation),p=JSON.parse(row.body);
  const r=await this.vault.invokeReader(this.scope,this.config.secret_ref,this.config.reader,{method:'GET',path:'/emails/'+previous.native_id,operation_id:null,body:null}) as Row;
  if(r.status!==200||r.body.id!==previous.native_id||r.body.from!==p.from||!Array.isArray(r.body.to)||r.body.to.length!==1||r.body.to[0]!==p.to||r.body.subject!==p.subject||r.body.text!==p.text)return null;
  const stage=({sent:'accepted',delivered:'delivered',bounced:'bounced',failed:'failed'} as any)[r.body.last_event];if(!stage)return null;
  if(stage===previous.stage)return previous;
  return {...previous,stage,customer_delivered:stage==='delivered',observed_at:this.k.clock(),version:previous.version+1};
 }
 limitations(){return {idempotency_window_hours:24,unknown_without_native_id:'requires_verified_native_receipt_no_automatic_retry',account_ownership:'configuration_requires_connected_qualification',events:'native_lookup_only',production_qualified:false};}
}
