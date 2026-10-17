import type { CommerceKernel,Row } from './kernel.mts';
import { canonical,contentDigest } from './configuration-values.mts';

export function lineageNode(k:CommerceKernel,s:Row,resource:string,nativeOrder?:string){
 const row=k.db.prepare('SELECT * FROM commerce_exchange_lineage_nodes WHERE tenant_id=? AND store_id=? AND (resource_id=? OR native_order_id=?)').get(s.tenant_id,s.store_id,resource,nativeOrder??'') as Row;
 if(!row)return null;const body=JSON.parse(row.body);if(contentDigest(body)!==row.digest)throw new Error('LINEAGE_INTEGRITY');return {row,body};
}
/** A native descendant cannot become a new retail purchase by losing optional metadata. */
export function assertLineageIngest(k:CommerceKernel,s:Row,resource:string,input:Row){
 if(input.kind!=='order')return;
 const found=lineageNode(k,s,resource,input.payload?.native_order_id);if(!found){if(input.payload?.exchange_lineage||input.payload?.resolution_facts?.lineage_digest)throw new Error('LINEAGE_SOURCE_REQUIRED');return;}
 const {row,body:n}=found,p=input.payload,f=p?.resolution_facts;
 if(row.resource_id!==resource||input.source_system!=='synthetic'||input.external_id!==n.external_id||input.customer_id!==n.customer_id||p.native_order_id!==n.native_order_id||p.currency!==n.currency||p.total_minor!==n.carried_minor||p.delivered_at!==n.delivered_at)throw new Error('LINEAGE_SOURCE_MISMATCH');
 if(!f||f.payment_id!==n.payment_id||f.currency!==n.currency||f.original_paid_minor!==n.carried_minor||f.lineage_digest!==row.digest||canonical(p.exchange_lineage??null)!==canonical({node_id:n.id,digest:row.digest}))throw new Error('LINEAGE_PAID_VALUE_CHANGED');
 const lines=f.paid_lines?.map(({resolved_units,...l}:Row)=>l),expected=n.paid_lines.map(({resolved_units,...l}:Row)=>l);
 if(canonical(lines??null)!==canonical(expected))throw new Error('LINEAGE_PAID_VALUE_CHANGED');
 const pin=(x:Row)=>x&&({...x,instruments:x.instruments.map(({prior_refunded_minor,...i}:Row)=>i)});
 if(canonical(pin(f.instrument_allocations)??null)!==canonical(pin(n.instrument_allocations)))throw new Error('LINEAGE_INSTRUMENT_CHANGED');
 if(!Array.isArray(p.return_lines)||p.return_lines.length!==1||p.return_lines[0].id!==n.line_id||p.return_lines[0].fulfillment_line_id!==n.fulfillment_line_id||p.return_lines[0].ordered!==n.quantity||p.return_lines[0].fulfilled!==n.quantity)throw new Error('LINEAGE_PHYSICAL_UNITS_CHANGED');
}
export function assertLineageFacts(k:CommerceKernel,c:Row){const order=c.order;assertLineageIngest(k,{tenant_id:order.tenant_id,store_id:order.store_id},order.id,{kind:order.kind,source_system:order.source_system,external_id:order.external_id,customer_id:order.customer_id,payload:order.payload});}
