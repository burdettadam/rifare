import type { DatabaseSync } from 'node:sqlite';
import type { CommerceKernel,Scope,Row } from '../commerce/kernel.mts';
import { id } from '../commerce/kernel.mts';
import { canonical,contentDigest } from '../commerce/configuration-values.mts';
import { growthBody,growthCustomer } from '../commerce/growth-shopping-core.mts';

type Source={db:DatabaseSync;identity:string;tenant:string;store:string;clock:()=>number;order:(resource:string)=>Row};
export function initializeUpsellSource(db:DatabaseSync){db.exec(`CREATE TABLE IF NOT EXISTS edit_source_upsell_consents(edit_id TEXT PRIMARY KEY,order_id TEXT NOT NULL,revoked INTEGER NOT NULL CHECK(revoked IN(0,1)),consumed INTEGER NOT NULL CHECK(consumed IN(0,1)),body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;`);}
function sourceBody(row:Row|undefined){if(!row)throw new Error('UPSELL_NATIVE_CONFIRMATION_REQUIRED');return growthBody(row);}
function safeDigest(order:Row){const {address,...rest}=order;return contentDigest({...rest,address_digest:contentDigest(address)});}
export function upsellTerms(source:Source,variant:string){const row=source.db.prepare('SELECT * FROM growth_source_listings WHERE variant_id=?').get(id(variant)) as Row|undefined,listing=sourceBody(row);return {terms:listing.terms,digest:contentDigest({terms:listing.terms,revision:row!.revision})};}
/** Trusted local bridge. The customer session and canonical confirmation are checked again here. */
export function confirmUpsellSource(source:Source,k:CommerceKernel,scope:Scope,quoteId:string){const s=k.require(scope),row=k.db.prepare('SELECT * FROM commerce_upsell_confirmations WHERE tenant_id=? AND store_id=? AND quote_id=?').get(s.tenant_id,s.store_id,id(quoteId)) as Row,c=sourceBody(row);growthCustomer(k,scope,row.resource_id,row.customer_id);
 if(row.revoked||row.session_hash!==s.token_hash||c.source_identity!==source.identity||source.tenant!==s.tenant_id||source.store!==s.store_id)throw new Error('UPSELL_CONFIRMATION_CHANGED');
 source.db.exec('BEGIN IMMEDIATE');try{const old=source.db.prepare('SELECT * FROM edit_source_upsell_consents WHERE edit_id=?').get(c.edit_id) as Row|undefined;if(old){const b=sourceBody(old);if(old.revoked||contentDigest(b)!==contentDigest(c))throw new Error('UPSELL_CONFIRMATION_CHANGED');source.db.exec('COMMIT');return {edit_id:c.edit_id,digest:old.digest,consumed:!!old.consumed};}
  const order=source.order(c.resource_id);if(c.expires_at<=source.clock()||order.customer_id!==c.customer_id||order.version!==c.source_order_version||safeDigest(order)!==c.source_order_digest||upsellTerms(source,c.variant_id).digest!==c.terms_digest)throw new Error('UPSELL_SOURCE_CHANGED');source.db.prepare('INSERT INTO edit_source_upsell_consents VALUES(?,?,0,0,?,?)').run(c.edit_id,c.resource_id,canonical(c),contentDigest(c));source.db.exec('COMMIT');return {edit_id:c.edit_id,digest:contentDigest(c),consumed:false};
 }catch(e){source.db.exec('ROLLBACK');throw e;}
}
/** Runs inside the original source effect transaction; only that transaction consumes consent. */
export function assertUpsellNative(source:Source,c:Row,order:Row){if(c.intent?.kind!=='add')return;const row=source.db.prepare('SELECT * FROM edit_source_upsell_consents WHERE edit_id=? AND order_id=?').get(c.edit_id,order.resource_id) as Row,approval=sourceBody(row),before=c.stage.startsWith('hold:')||['begin','change','commit'].includes(c.stage);
 if(approval.edit_id!==c.edit_id||approval.source_identity!==source.identity||approval.resource_id!==order.resource_id||approval.customer_id!==order.customer_id||approval.source_order_version!==c.original_version||approval.source_order_digest!==c.original_digest||approval.intent_digest!==contentDigest(c.intent)||approval.new_total_minor!==c.new_total_minor||approval.delta_minor!==c.delta_minor||approval.currency!==order.currency||contentDigest(approval.line_ids)!==contentDigest(c.line_ids))throw new Error('UPSELL_NATIVE_CONFIRMATION_MISMATCH');
 if(before&&(row.revoked||row.consumed||approval.expires_at<=source.clock()||upsellTerms(source,c.intent.variant_id).digest!==approval.terms_digest))throw new Error('UPSELL_NATIVE_CONFIRMATION_UNAVAILABLE');if(!before&&!row.consumed)throw new Error('UPSELL_NATIVE_COMMIT_REQUIRED');if(c.stage==='commit')source.db.prepare('UPDATE edit_source_upsell_consents SET consumed=1 WHERE edit_id=? AND consumed=0').run(c.edit_id);
}
