import type { CommerceKernel,Row } from './kernel.mts';
import { contentDigest } from './configuration-values.mts';
import { growthBody } from './growth-shopping-core.mts';

/** An add-line quote is never an alternative route around explicit customer approval. */
export function assertUpsellConfirmation(k:CommerceKernel,s:Row,quoteId:string,q:Row,afterCommit=false){
 if(q.action!=='add')return;
 const offer=k.db.prepare('SELECT * FROM commerce_upsell_offers WHERE tenant_id=? AND store_id=? AND quote_id=?').get(s.tenant_id,s.store_id,quoteId) as Row|undefined;
 const row=k.db.prepare('SELECT * FROM commerce_upsell_confirmations WHERE tenant_id=? AND store_id=? AND quote_id=?').get(s.tenant_id,s.store_id,quoteId) as Row|undefined;
 if(!offer||!row)throw new Error('UPSELL_CUSTOMER_CONFIRMATION_REQUIRED');
 const o=growthBody(offer),c=growthBody(row);
 if(o.quote_digest!==contentDigest(q)||c.quote_digest!==contentDigest(q)||o.quote_id!==quoteId||c.quote_id!==quoteId||offer.resource_id!==q.resource_id||row.resource_id!==q.resource_id||offer.customer_id!==q.customer_id||row.customer_id!==q.customer_id||c.resource_id!==q.resource_id||c.customer_id!==q.customer_id||c.source_identity!==q.source_identity||c.source_order_version!==q.source_order_version||c.source_order_digest!==q.source_order_digest||c.intent_digest!==q.intent_digest||c.configuration_digest!==q.configuration_digest||c.new_total_minor!==q.new_total_minor||c.delta_minor!==q.delta_minor||c.currency!==q.currency||c.terms_digest!==o.terms_digest)throw new Error('UPSELL_CONFIRMATION_CHANGED');
 if(afterCommit)return;
 const customer=k.db.prepare("SELECT * FROM commerce_sessions WHERE token_hash=? AND role='customer' AND revoked=0").get(row.session_hash) as Row|undefined;
 if(row.revoked||c.expires_at<=k.clock()||!customer||customer.expires_at<=k.clock()||customer.last_seen<=k.clock()-900000||customer.tenant_id!==s.tenant_id||customer.store_id!==s.store_id||customer.customer_id!==q.customer_id||customer.resource_id!==q.resource_id)throw new Error('UPSELL_CONFIRMATION_UNAVAILABLE');
}
