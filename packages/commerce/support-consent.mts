import type {CommerceKernel,Scope,Row} from './kernel.mts';
import {id,integer,exact,digest} from './kernel.mts';
import {canonical,contentDigest,jsonValue} from './configuration-values.mts';
import {SupportConversations} from './support-conversations.mts';
import {supportCase,checkedDocument,saveDocument} from './support-core.mts';

export function emailAddress(input:unknown) {if(typeof input!=='string'||input.length>254||!/^[-A-Za-z0-9.!#$%&'*+/=?^_`{|}~]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(input))throw new Error('EMAIL_INVALID');return input.toLowerCase();}
export class SupportConsent {
 readonly k:CommerceKernel;constructor(k:CommerceKernel){this.k=k;}
 configureSender(scope:Scope,input:unknown) {const p=exact(jsonValue(input),['id','expected_revision','channel','address','account_id','source_identity','source_contract','expires_at','jurisdiction','transactional_basis']);
  id(p.id);id(p.account_id);id(p.source_identity);id(p.source_contract);integer(p.expected_revision);integer(p.expires_at);
  if(p.channel!=='email'||p.jurisdiction!=='US_TEST'||!['explicit_only','order_service'].includes(p.transactional_basis)||p.expires_at<=this.k.clock()||p.expires_at>this.k.clock()+86400000)throw new Error('SENDER_UNQUALIFIED');
  const address=emailAddress(p.address);return this.k.transaction(()=>{const s=this.k.authorize(scope,'support.configure');return saveDocument(this.k,s,'sender',p.id,p.expected_revision,{...p,address},'active',p.expires_at);});
 }
 verifyContact(scope:Scope,customer:Scope,input:unknown) {const p=exact(input,['link_id','address']);const address=emailAddress(p.address);
  return this.k.transaction(()=>{const link=new SupportConversations(this.k).linkRecord(scope,p.link_id),{s,c}=supportCase(this.k,scope,link.case_id,'support.link'),v=this.k.require(customer,['customer']);
   if(v.role!=='customer'||v.tenant_id!==s.tenant_id||v.store_id!==s.store_id||v.resource_id!==c.resource_id||v.customer_id!==c.customer_id||link.channel!=='email')throw new Error('CONTACT_VERIFICATION_REQUIRED');
   const proof=this.k.db.prepare('SELECT * FROM commerce_customer_proof_bindings WHERE token_hash=?').get(v.token_hash) as Row;
   const customerRecord=proof?this.k.db.prepare("SELECT * FROM commerce_resources WHERE tenant_id=? AND store_id=? AND id=? AND kind='customer'").get(s.tenant_id,s.store_id,proof.customer_resource_id) as Row:null;
   if(!customerRecord||customerRecord.external_id!==c.customer_id)throw new Error('CONTACT_VERIFICATION_REQUIRED');
   const currentAddress=emailAddress(JSON.parse(customerRecord.payload).email);
   if(currentAddress!==address||proof.owner_hash!==digest(JSON.stringify([customerRecord.id,customerRecord.source_version,currentAddress])))throw new Error('CONTACT_VERIFICATION_REQUIRED');
   const old=this.k.db.prepare('SELECT * FROM commerce_support_contacts WHERE tenant_id=? AND store_id=? AND link_id=?').get(s.tenant_id,s.store_id,link.id) as Row;
   if(old?.erased)throw new Error('CONTACT_VERIFICATION_REQUIRED');
   const revision=old?old.revision+(old.address===address?0:1):1;
   this.k.db.prepare('INSERT INTO commerce_support_contacts VALUES(?,?,?,?,?,?,?,?,0) ON CONFLICT(tenant_id,store_id,link_id) DO UPDATE SET address=excluded.address,address_digest=excluded.address_digest,revision=excluded.revision,verified_at=excluded.verified_at')
    .run(s.tenant_id,s.store_id,link.id,'email',address,contentDigest(address),revision,this.k.clock());return {link_id:link.id,revision,address_digest:contentDigest(address),verified:true};
  });
 }
 record(scope:Scope,input:unknown) {const p=exact(jsonValue(input),['case_id','sender_id','channel','purpose','state','event_id','source_version','effective_at','source_ref']);
  id(p.sender_id);id(p.event_id);id(p.source_ref);integer(p.source_version,1);integer(p.effective_at);
  if(!['email','sms'].includes(p.channel)||!['transactional','marketing','*'].includes(p.purpose)||!['granted','withdrawn'].includes(p.state)||p.purpose==='*'&&p.state!=='withdrawn'||p.effective_at>this.k.clock())throw new Error('CONSENT_INPUT_INVALID');
  return this.k.transaction(()=>{const {s,c}=supportCase(this.k,scope,p.case_id),customer=s.role==='customer';
   if(!customer)this.k.authorize(scope,'support.consent',c.resource_id);
   if(p.state==='granted'&&!customer)throw new Error('CUSTOMER_CONSENT_REQUIRED');
   checkedDocument(this.k,s,'sender',p.sender_id);
   const body={...p,customer_id:c.customer_id,source_kind:customer?'verified_customer_request':'verified_suppression_import'},hash=contentDigest(body),prevEvent=this.k.db.prepare('SELECT digest FROM commerce_support_consent_events WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,p.event_id) as Row;
   if(prevEvent){if(prevEvent.digest!==hash)throw new Error('CONSENT_EVENT_CONFLICT');return {duplicate:true};}
   const old=this.k.db.prepare('SELECT * FROM commerce_support_consent WHERE tenant_id=? AND store_id=? AND customer_id=? AND sender_id=? AND channel=? AND purpose=?').get(s.tenant_id,s.store_id,c.customer_id,p.sender_id,p.channel,p.purpose) as Row;
   const stale=old&&(p.effective_at<old.effective_at||p.source_version<old.source_version||p.effective_at===old.effective_at&&old.state==='withdrawn'&&p.state==='granted');
   if(old&&!stale&&p.source_version===old.source_version&&hash!==old.digest)throw new Error('CONSENT_EVENT_CONFLICT');
   this.k.db.prepare('INSERT INTO commerce_support_consent_events VALUES(?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,p.event_id,c.customer_id,canonical(body),hash,this.k.clock());
   if(!stale)this.k.db.prepare('INSERT INTO commerce_support_consent VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,store_id,customer_id,sender_id,channel,purpose) DO UPDATE SET state=excluded.state,source_id=excluded.source_id,source_version=excluded.source_version,effective_at=excluded.effective_at,observed_at=excluded.observed_at,digest=excluded.digest')
    .run(s.tenant_id,s.store_id,c.customer_id,p.sender_id,p.channel,p.purpose,p.state,p.source_ref,p.source_version,p.effective_at,this.k.clock(),hash);
   return {duplicate:false,ignored_stale:!!stale,state:stale?old.state:p.state};
  });
 }
 eligibility(scope:Scope,caseId:string,senderId:string,channel:string,purpose:string) {
  if(!['email','sms'].includes(channel)||!['marketing','transactional'].includes(purpose))throw new Error('CONSENT_INPUT_INVALID');
  const {s,c}=supportCase(this.k,scope,caseId),sender=checkedDocument(this.k,s,'sender',id(senderId));
  if(sender.body.channel!==channel)return {allowed:false,reason:'CHANNEL_UNQUALIFIED',stamp:null};
  const rows=this.k.db.prepare('SELECT * FROM commerce_support_consent WHERE tenant_id=? AND store_id=? AND customer_id=? AND sender_id=? AND channel=? AND purpose IN (?,?)').all(s.tenant_id,s.store_id,c.customer_id,senderId,channel,purpose,'*') as Row[];
  const explicit=rows.find(r=>r.purpose===purpose),blanket=rows.find(r=>r.purpose==='*');
  // A later purpose-specific reconsent must be a new verified customer request.
  const suppressed=(blanket&&(!explicit||explicit.state!=='granted'||explicit.effective_at<=blanket.effective_at))||explicit?.state==='withdrawn';
  const allowed=!suppressed&&(explicit?.state==='granted'||purpose==='transactional'&&sender.body.transactional_basis==='order_service');
  return {allowed:!!allowed,reason:suppressed?'WITHDRAWN':allowed?'CONFIGURED_PURPOSE_ALLOWED':'CONSENT_REQUIRED',stamp:contentDigest(rows.map(r=>r.digest).sort()),sender_revision:sender.version};
 }
}
