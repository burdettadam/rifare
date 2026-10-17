import { exact,id,integer } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { email } from './customer-access.mts';
import { assertNotErased,assertRecoveryEgress } from './data-guards.mts';

/** Recipient authority comes only from an explicitly supplied synthetic source
 * entitlement and a completed delivery proof. This module issues no Scope. */
export function giftSource(k:CommerceKernel,tenant:string,store:string,resource:string){
 const row=k.db.prepare("SELECT r.* FROM commerce_resources r JOIN commerce_stores s USING(tenant_id,store_id) WHERE r.tenant_id=? AND r.store_id=? AND r.id=? AND r.kind='order' AND s.active=1").get(tenant,store,resource) as Row;
 if(!row||row.source_system!=='synthetic'||!row.customer_id)throw new Error('GIFT_VERIFICATION_REQUIRED');
 const order=k.project(row),g=exact(jsonValue(order.payload.gift_facts),['gift_id','recipient_customer_id','recipient_email','revision','observed_at','expires_at','lines','allowed_outcomes']);
 id(g.gift_id);id(g.recipient_customer_id);g.recipient_email=email(g.recipient_email);integer(g.revision,1);integer(g.observed_at);integer(g.expires_at);
 if(g.recipient_customer_id===order.customer_id||g.observed_at>k.clock()||order.observed_at>k.clock()||k.clock()-g.observed_at>300000||k.clock()-order.observed_at>300000||g.expires_at<=k.clock())throw new Error('GIFT_VERIFICATION_REQUIRED');
 assertNotErased(k,{tenant_id:tenant,store_id:store},resource,g.recipient_customer_id);
 if(!Array.isArray(g.allowed_outcomes)||!g.allowed_outcomes.length||new Set(g.allowed_outcomes).size!==g.allowed_outcomes.length||g.allowed_outcomes.some((o:unknown)=>!['exchange','store_credit'].includes(String(o))))throw new Error('GIFT_VERIFICATION_REQUIRED');
 if(!Array.isArray(g.lines)||!g.lines.length||g.lines.length>50||new Set(g.lines.map((l:Row)=>l.line_id)).size!==g.lines.length)throw new Error('GIFT_VERIFICATION_REQUIRED');
 for(const l of g.lines){exact(l,['line_id','units']);id(l.line_id);const original=order.payload.return_lines?.find((r:Row)=>r.id===l.line_id);
  if(!original||!Array.isArray(l.units)||!l.units.length||l.units.length>100||new Set(l.units).size!==l.units.length)throw new Error('GIFT_VERIFICATION_REQUIRED');
  for(const unit of l.units){integer(unit,1);if(unit>original.fulfilled)throw new Error('GIFT_VERIFICATION_REQUIRED');}l.units.sort((a:number,b:number)=>a-b);
 }
 g.lines.sort((a:Row,b:Row)=>a.line_id.localeCompare(b.line_id));g.allowed_outcomes.sort();
 const source_digest=contentDigest({resource_id:order.id,source_version:order.source_version,customer_id:order.customer_id,gift:g});
 return {order,gift:g,source_digest,expires_at:Math.min(g.expires_at,g.observed_at+300000,order.observed_at+300000)};
}
export function currentGiftSession(k:CommerceKernel,hash:string,store:string){
 assertRecoveryEgress(k);
 const session=k.db.prepare('SELECT * FROM commerce_gift_sessions WHERE token_hash=? AND store_id=? AND revoked=0 AND expires_at>?').get(hash,store,k.clock()) as Row;
 if(!session)throw new Error('GIFT_VERIFICATION_REQUIRED');
 let source:ReturnType<typeof giftSource>;try{source=giftSource(k,session.tenant_id,session.store_id,session.resource_id);}catch{throw new Error('GIFT_VERIFICATION_REQUIRED');}
 if(source.source_digest!==session.gift_digest||source.gift.gift_id!==session.gift_id||source.gift.recipient_customer_id!==session.recipient_customer_id)throw new Error('GIFT_VERIFICATION_REQUIRED');
 return {session,...source};
}
export function verifiedGiftCase(k:CommerceKernel,s:Row,caseId:string){
 const row=k.db.prepare('SELECT * FROM commerce_gift_cases WHERE tenant_id=? AND store_id=? AND case_id=?').get(s.tenant_id,s.store_id,id(caseId)) as Row;
 if(!row)return null;const body=JSON.parse(row.body);
 if(contentDigest(body)!==row.digest)throw new Error('GIFT_VERIFICATION_REQUIRED');
 const current=currentGiftSession(k,row.token_hash,s.store_id),{session,order,gift}=current;
 if(session.tenant_id!==s.tenant_id||session.resource_id!==row.resource_id||body.resource_id!==row.resource_id||body.customer_id!==order.customer_id||body.source_digest!==current.source_digest||body.recipient_customer_id!==gift.recipient_customer_id)throw new Error('GIFT_VERIFICATION_REQUIRED');
 return {customer_id:order.customer_id,recipient_customer_id:gift.recipient_customer_id,resource_id:order.id,
  gift_id:gift.gift_id,source_digest:current.source_digest,allowed_outcomes:gift.allowed_outcomes,lines:gift.lines,
  verification_revision:row.revision,expires_at:Math.min(session.expires_at,current.expires_at),identity_only_not_payment_consent:true,gift_recipient:true};
}
export function assertGiftOutcome(k:CommerceKernel,scope:Scope,caseId:string,outcome:string,lines?:Row[]){
 const s=k.require(scope),gift=verifiedGiftCase(k,s,caseId);if(!gift)return null;
 if(!gift.allowed_outcomes.includes(outcome))throw new Error('GIFT_OUTCOME_DENIED');
 if(lines)for(const selected of lines){const allowed=gift.lines.find((l:Row)=>l.line_id===selected.line_id);
  if(!allowed)throw new Error('GIFT_UNITS_DENIED');
  if(Array.isArray(selected.units)?selected.units.some((n:number)=>!allowed.units.includes(n)):selected.quantity>allowed.units.length)throw new Error('GIFT_UNITS_DENIED');
 }
 return gift;
}
export function assertGiftAction(k:CommerceKernel,scope:Scope,caseId:string,action:string){
 const gift=verifiedGiftCase(k,k.require(scope),caseId);if(!gift)return;
 if(!['diagnostic.return.submit','diagnostic.return.resolve','diagnostic.exchange.create','diagnostic.label.purchase','diagnostic.label.void'].includes(action))throw new Error('GIFT_ACTION_DENIED');
}
/** Privacy erasure keeps the purchaser order and monetary audit, but removes the
 * separate recipient grant. Caller holds the canonical privacy transaction. */
export function eraseGiftRecipient(k:CommerceKernel,s:Row,customer:string){
 const orders=(k.db.prepare("SELECT * FROM commerce_resources WHERE tenant_id=? AND store_id=? AND kind='order'").all(s.tenant_id,s.store_id) as Row[]).filter(r=>JSON.parse(r.payload).gift_facts?.recipient_customer_id===customer);
 for(const order of orders){const payload=JSON.parse(order.payload);payload.gift_facts={redacted:true,revoked:true};
  k.db.prepare('UPDATE commerce_resources SET payload=? WHERE tenant_id=? AND store_id=? AND id=?').run(canonical(payload),s.tenant_id,s.store_id,order.id);
  k.db.prepare('DELETE FROM commerce_gift_challenges WHERE tenant_id=? AND store_id=? AND resource_id=?').run(s.tenant_id,s.store_id,order.id);
 }
 const sessions=k.db.prepare('SELECT token_hash FROM commerce_gift_sessions WHERE tenant_id=? AND store_id=? AND recipient_customer_id=?').all(s.tenant_id,s.store_id,customer) as Row[];
 for(const session of sessions){const rows=k.db.prepare('SELECT case_id,digest FROM commerce_gift_cases WHERE tenant_id=? AND store_id=? AND token_hash=?').all(s.tenant_id,s.store_id,session.token_hash) as Row[];
  for(const row of rows){const b={redacted:true,original_digest:row.digest};k.db.prepare("UPDATE commerce_gift_cases SET token_hash='revoked',body=?,digest=? WHERE tenant_id=? AND store_id=? AND case_id=?").run(canonical(b),contentDigest(b),s.tenant_id,s.store_id,row.case_id);}
 }
 k.db.prepare('DELETE FROM commerce_gift_sessions WHERE tenant_id=? AND store_id=? AND recipient_customer_id=?').run(s.tenant_id,s.store_id,customer);
 return orders.length+sessions.length;
}
