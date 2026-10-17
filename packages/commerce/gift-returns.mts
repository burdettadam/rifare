import { timingSafeEqual } from 'node:crypto';
import { digest,exact,id,integer,token } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { email } from './customer-access.mts';
import type { ProofDelivery } from './customer-access.mts';
import { CaseConfigurations } from './case-configurations.mts';
import { ReturnIntake } from './return-intake.mts';
import { reservations } from './return-intake-core.mts';
import { currentGiftSession,giftSource,verifiedGiftCase } from './gift-proof.mts';
import { assertRecoveryEgress } from './data-guards.mts';

/** Bounded recipient views. Merchant operations require their own current Scope;
 * a gift token is never accepted as an ordinary customer or operator bearer. */
export class GiftReturns {
 readonly kernel:CommerceKernel;
 readonly deliver:(proof:ProofDelivery)=>void;
 constructor(k:CommerceKernel,deliver:(proof:ProofDelivery)=>void){this.kernel=k;this.deliver=deliver;}
 #limited(bucket:string,max:number){const k=this.kernel,r=k.db.prepare('SELECT * FROM commerce_challenge_rates WHERE bucket=?').get(bucket) as Row;
  if(!r||r.window_start<=k.clock()-600000){k.db.prepare('INSERT INTO commerce_challenge_rates VALUES(?,?,1) ON CONFLICT(bucket) DO UPDATE SET window_start=excluded.window_start,count=1').run(bucket,k.clock());return false;}
  k.db.prepare('UPDATE commerce_challenge_rates SET count=count+1 WHERE bucket=?').run(bucket);return r.count>=max;
 }
 request(input:unknown,clientAddress:string){
  const p=exact(jsonValue(input),['store_id','gift_id','email']);id(p.store_id);id(p.gift_id);const address=email(p.email),k=this.kernel;
  if(typeof clientAddress!=='string'||!clientAddress||clientAddress.length>128)throw new Error('INVALID_INPUT');assertRecoveryEgress(k);
  const challenge='gift_chal_'+token(),proof=token();let delivery:ProofDelivery|undefined;
  k.transaction(()=>{
   if(this.#limited(digest('gift-client:'+clientAddress),20)||this.#limited(digest(canonical(['gift-target',p.store_id,p.gift_id,address])),3))return;
   const rows=k.db.prepare("SELECT r.tenant_id,r.id FROM commerce_resources r JOIN commerce_stores s USING(tenant_id,store_id) WHERE r.store_id=? AND r.kind='order' AND json_extract(r.payload,'$.gift_facts.gift_id')=? AND s.active=1 LIMIT 2").all(p.store_id,p.gift_id) as Row[];
   let source:ReturnType<typeof giftSource>|null=null;
   if(rows.length===1){try{source=giftSource(k,rows[0].tenant_id,p.store_id,rows[0].id);if(source.gift.recipient_email!==address)source=null;}catch{source=null;}}
   k.db.prepare('INSERT INTO commerce_gift_challenges VALUES(?,?,?,?,?,?,?,0,0)').run(challenge,digest(challenge+':'+proof),source?rows[0].tenant_id:null,p.store_id,source?.order.id??null,source?.source_digest??digest(token()),k.clock()+300000);
   if(source)delivery=Object.freeze({destination:source.gift.recipient_email,challenge_id:challenge,proof,store_id:p.store_id});
  });
  if(delivery){try{this.deliver(delivery);}catch{k.db.prepare('UPDATE commerce_gift_challenges SET consumed=1 WHERE id=?').run(challenge);}}
  return {accepted:true,challenge_id:challenge,expires_in:300};
 }
 complete(input:unknown){
  const k=this.kernel;let p:Row;try{p=exact(jsonValue(input),['store_id','challenge_id','proof']);id(p.store_id);id(p.challenge_id);if(typeof p.proof!=='string'||p.proof.length>512)throw new Error('INVALID_INPUT');}catch{throw new Error('GIFT_VERIFICATION_REQUIRED');}
  assertRecoveryEgress(k);
  const result=k.transaction(()=>{const row=k.db.prepare('SELECT * FROM commerce_gift_challenges WHERE id=?').get(p.challenge_id) as Row;
   if(!row||row.consumed||row.attempts>=5||row.expires_at<=k.clock())return null;
   k.db.prepare('UPDATE commerce_gift_challenges SET attempts=attempts+1 WHERE id=?').run(row.id);
   const expected=Buffer.from(row.proof_hash,'hex'),actual=Buffer.from(digest(row.id+':'+p.proof),'hex');
   if(row.store_id!==p.store_id||actual.length!==expected.length||!timingSafeEqual(actual,expected)||!row.resource_id)return null;
   let source:ReturnType<typeof giftSource>;try{source=giftSource(k,row.tenant_id,row.store_id,row.resource_id);}catch{return null;}
   if(source.source_digest!==row.gift_digest)return null;
   const value=token(),expires=Math.min(k.clock()+900000,source.expires_at);
   k.db.prepare('UPDATE commerce_gift_challenges SET consumed=1 WHERE id=?').run(row.id);
   k.db.prepare('INSERT INTO commerce_gift_sessions VALUES(?,?,?,?,?,?,?,?,0)').run(digest(value),row.tenant_id,row.store_id,row.resource_id,source.gift.gift_id,source.source_digest,source.gift.recipient_customer_id,expires);
   return {token:value,expires_at:expires,operations:['gift.choices','gift.status'],ordinary_order_access:false};
  });
  if(!result)throw new Error('GIFT_VERIFICATION_REQUIRED');return result;
 }
 #session(input:unknown){const p=exact(jsonValue(input),['store_id','token']);id(p.store_id);if(typeof p.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(p.token))throw new Error('GIFT_VERIFICATION_REQUIRED');return currentGiftSession(this.kernel,digest(p.token),p.store_id);}
 choices(input:unknown){const k=this.kernel;return k.transaction(()=>{const {session,order,gift,expires_at}=this.#session(input),reserved=reservations(k,session,order);
  const lines=gift.lines.map((l:Row)=>{const source=order.payload.return_lines.find((r:Row)=>r.id===l.line_id),paid=order.payload.resolution_facts?.paid_lines?.find((r:Row)=>r.id===l.line_id);
   const eligible=l.units.filter((n:number)=>!(paid?.resolved_units??[]).includes(n)&&!k.db.prepare('SELECT 1 FROM commerce_resolution_units WHERE tenant_id=? AND store_id=? AND resource_id=? AND line_id=? AND unit_index=?').get(session.tenant_id,session.store_id,order.id,l.line_id,n)).length;
   return {line_id:l.line_id,remaining:Math.max(0,Math.min(eligible,source.fulfilled-source.returned-(reserved.quantities[l.line_id]??0)))};
  });
  return {gift_id:gift.gift_id,lines,outcomes:[...gift.allowed_outcomes],expires_at:Math.min(session.expires_at,expires_at),qualification:'synthetic_only',approval_required:true};
 });}
 createCase(scope:Scope,input:unknown){const p=exact(jsonValue(input),['gift_token','case_id','profile_id','policy_id']);id(p.case_id);id(p.profile_id);id(p.policy_id);
  const k=this.kernel;return k.transaction(()=>{const s=k.require(scope),{session,order,gift,source_digest}=this.#session({store_id:s.store_id,token:p.gift_token});
   if(session.tenant_id!==s.tenant_id)throw new Error('GIFT_VERIFICATION_REQUIRED');k.authorize(scope,'action.propose',order.id);
   const cases=new CaseConfigurations(k),old=k.db.prepare('SELECT * FROM commerce_gift_cases WHERE tenant_id=? AND store_id=? AND case_id=?').get(s.tenant_id,s.store_id,p.case_id) as Row;
   if(old){if(old.token_hash!==session.token_hash||old.resource_id!==order.id)throw new Error('GIFT_CHOICE_CONFLICT');const existing=cases.inspect(scope,p.case_id);verifiedGiftCase(k,s,p.case_id);
    if(existing.pins.profile.id!==p.profile_id||existing.pins.policy.policy_id!==p.policy_id)throw new Error('GIFT_CHOICE_CONFLICT');return {case_id:p.case_id,state:'open',verification_revision:old.revision,duplicate:true};}
   cases.create(scope,{case_id:p.case_id,resource_id:order.id,profile_id:p.profile_id,policy_id:p.policy_id});
   const b={resource_id:order.id,customer_id:order.customer_id,recipient_customer_id:gift.recipient_customer_id,source_digest};
   k.db.prepare('INSERT INTO commerce_gift_cases VALUES(?,?,?,?,?,?,?,1)').run(s.tenant_id,s.store_id,p.case_id,order.id,session.token_hash,canonical(b),contentDigest(b));
   verifiedGiftCase(k,s,p.case_id);return {case_id:p.case_id,state:'open',verification_revision:1,duplicate:false};
  });
 }
 rebind(scope:Scope,input:unknown){const p=exact(jsonValue(input),['gift_token','case_id','expected_revision']);id(p.case_id);integer(p.expected_revision,1);
  const k=this.kernel;return k.transaction(()=>{const s=k.require(scope),{session,order,gift,source_digest}=this.#session({store_id:s.store_id,token:p.gift_token});
   if(session.tenant_id!==s.tenant_id)throw new Error('GIFT_VERIFICATION_REQUIRED');k.authorize(scope,'action.propose',order.id);
   const row=k.db.prepare('SELECT * FROM commerce_gift_cases WHERE tenant_id=? AND store_id=? AND case_id=?').get(s.tenant_id,s.store_id,p.case_id) as Row;
   if(!row)throw new Error('GIFT_VERIFICATION_REQUIRED');const old=JSON.parse(row.body);
   if(contentDigest(old)!==row.digest||row.resource_id!==order.id||old.customer_id!==order.customer_id||old.recipient_customer_id!==gift.recipient_customer_id)throw new Error('GIFT_VERIFICATION_REQUIRED');
   if(row.revision!==p.expected_revision)throw new Error('GIFT_CHOICE_CONFLICT');
   if(row.token_hash===session.token_hash){verifiedGiftCase(k,s,p.case_id);return {case_id:p.case_id,verification_revision:row.revision,duplicate:true,requires_new_preview:false};}
   const body={resource_id:order.id,customer_id:order.customer_id,recipient_customer_id:gift.recipient_customer_id,source_digest};
   k.db.prepare('UPDATE commerce_gift_cases SET token_hash=?,body=?,digest=?,revision=revision+1 WHERE tenant_id=? AND store_id=? AND case_id=?').run(session.token_hash,canonical(body),contentDigest(body),s.tenant_id,s.store_id,p.case_id);
   k.db.prepare('UPDATE commerce_gift_sessions SET revoked=1 WHERE token_hash=?').run(row.token_hash);
   k.db.prepare('UPDATE commerce_action_approvals SET revoked=1 WHERE tenant_id=? AND store_id=? AND preview_id IN (SELECT id FROM commerce_action_previews WHERE tenant_id=? AND store_id=? AND case_id=?)').run(s.tenant_id,s.store_id,s.tenant_id,s.store_id,p.case_id);
   verifiedGiftCase(k,s,p.case_id);return {case_id:p.case_id,verification_revision:row.revision+1,duplicate:false,requires_new_preview:true};
  });
 }
 prepare(scope:Scope,input:unknown){const p=exact(jsonValue(input),['gift_token','case_id','lines','outcome','reason','request_key']);id(p.case_id);id(p.request_key);
  const k=this.kernel;return k.transaction(()=>{const s=k.require(scope),current=this.#session({store_id:s.store_id,token:p.gift_token});
   const row=k.db.prepare('SELECT * FROM commerce_gift_cases WHERE tenant_id=? AND store_id=? AND case_id=? AND token_hash=?').get(s.tenant_id,s.store_id,p.case_id,current.session.token_hash) as Row;
   if(!row)throw new Error('GIFT_VERIFICATION_REQUIRED');k.authorize(scope,'return.request',row.resource_id);verifiedGiftCase(k,s,p.case_id);
   const intake=new ReturnIntake(k),selection={case_id:p.case_id,lines:p.lines,outcome:p.outcome,reason:p.reason,note:'',evidence_ids:[]};
   const old=k.db.prepare('SELECT * FROM commerce_return_requests WHERE tenant_id=? AND store_id=? AND case_id=?').get(s.tenant_id,s.store_id,p.case_id) as Row;
   if(old){const b=JSON.parse(old.body),preview=k.db.prepare('SELECT body FROM commerce_action_previews WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,old.preview_id) as Row;
    if(old.request_key!==p.request_key)throw new Error('GIFT_CHOICE_CONFLICT');
    if(old.state==='awaiting_review'&&JSON.parse(preview.body).gift_verification_revision!==row.revision){const quote=intake.evaluate(scope,selection);intake.revise(scope,{quote_id:quote.id,quote_digest:quote.digest,expected_preview_id:old.preview_id,override_id:null});return {case_id:p.case_id,state:'awaiting_review',duplicate:false,approval_required:true};}
    if(canonical(b.selection)!==canonical({...selection,lines:[...p.lines].sort((a:Row,b:Row)=>a.line_id.localeCompare(b.line_id))}))throw new Error('GIFT_CHOICE_CONFLICT');return {case_id:p.case_id,state:old.state,duplicate:true,approval_required:true};}
   const quote=intake.evaluate(scope,selection);intake.prepare(scope,{quote_id:quote.id,quote_digest:quote.digest,request_key:p.request_key,override_id:null});
   return {case_id:p.case_id,state:'awaiting_review',duplicate:false,approval_required:true};
  });
 }
 status(input:unknown){const p=exact(jsonValue(input),['store_id','token','case_id']);id(p.case_id);const k=this.kernel,{session}=this.#session({store_id:p.store_id,token:p.token});
  const row=k.db.prepare('SELECT * FROM commerce_gift_cases WHERE tenant_id=? AND store_id=? AND case_id=? AND token_hash=?').get(session.tenant_id,session.store_id,p.case_id,session.token_hash) as Row;
  if(!row)throw new Error('GIFT_VERIFICATION_REQUIRED');verifiedGiftCase(k,session,p.case_id);
  const request=k.db.prepare('SELECT state FROM commerce_return_requests WHERE tenant_id=? AND store_id=? AND case_id=?').get(session.tenant_id,session.store_id,p.case_id) as Row;
  return {case_id:p.case_id,state:request?.state??'not_submitted',qualification:'synthetic_only'};
 }
 revoke(input:unknown){const {session}=this.#session(input);this.kernel.db.prepare('UPDATE commerce_gift_sessions SET revoked=1 WHERE token_hash=?').run(session.token_hash);return {revoked:true};}
}
