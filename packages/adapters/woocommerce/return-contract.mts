import { id } from '../../commerce/kernel.mts';
import type {CommerceKernel,Row} from '../../commerce/kernel.mts';
import {contentDigest} from '../../commerce/configuration-values.mts';

export const WOO_RETURN_CONTRACT=Object.freeze({id:'woocommerce-rma-fixture-v1',version:'1.0.0',platform:'woocommerce',api_version:'wc/v3',qualification:'fixture_only',actions:['diagnostic.return.submit'],effect:'local_return_request_only',native_return:false,external_effects:false});
export const WOO_RETURN_CONTRACT_DIGEST=contentDigest(WOO_RETURN_CONTRACT);
export type WooSourceReader={identity:string;tenant:string;store:string;account_id:string;origin:string;snapshot:(nativeId:string)=>Row};
// Server-attached adapter instances, never caller-selected database paths or transports.
const attached=new WeakMap<CommerceKernel,Map<string,WooSourceReader>>();
export function attachWooReturnSource(k:CommerceKernel,source:WooSourceReader){const entries=attached.get(k)??new Map<string,WooSourceReader>(),old=entries.get(source.identity);
 if(old&&old!==source)throw new Error('WOO_SOURCE_IDENTITY_CONFLICT');entries.set(source.identity,source);attached.set(k,entries);}
export function wooSourceBinding(k:CommerceKernel,s:Row,order:Row){
 if(order.source_system!=='woocommerce'||order.kind!=='order'||order.tenant_id!==s.tenant_id||order.store_id!==s.store_id)throw new Error('WOO_SOURCE_UNQUALIFIED');
 const r=k.db.prepare('SELECT * FROM commerce_woo_return_sources WHERE tenant_id=? AND store_id=? AND resource_id=?').get(s.tenant_id,s.store_id,order.id) as Row;
 if(!r)throw new Error('WOO_SOURCE_UNQUALIFIED');const b=JSON.parse(r.body);
 if(contentDigest(b)!==r.digest||b.contract_digest!==WOO_RETURN_CONTRACT_DIGEST||b.resource_id!==order.id||b.native_order_id!==order.external_id||b.customer_id!==order.customer_id||b.body_digest!==contentDigest(order.payload)||b.source_revision!==r.source_revision||b.source_digest!==r.source_digest||b.source_identity!==r.source_identity||b.account_id!==r.account_id||b.revision!==r.revision||b.canonical_source_version!==order.source_version)throw new Error('WOO_SOURCE_INTEGRITY');
 return b;
}
export function assertWooReturnFacts(k:CommerceKernel,s:Row,order:Row){
 const b=wooSourceBinding(k,s,order),source=attached.get(k)?.get(b.source_identity);
 if(!source||source.tenant!==s.tenant_id||source.store!==s.store_id||source.account_id!==b.account_id||source.origin!==b.origin)throw new Error('WOO_SOURCE_UNAVAILABLE');
 if(b.granted_scopes.join(',')!=='read'||b.observed_at>k.clock()||b.observed_at+300000<=k.clock())throw new Error('WOO_SOURCE_STALE');
 const native=source.snapshot(b.native_order_id);
 if(native.revision!==b.source_revision||native.digest!==b.source_digest)throw new Error('WOO_SOURCE_CHANGED');
 return {...b,payload:order.payload};
}
export function wooCaseCapability(k:CommerceKernel,s:Row,order:Row){const b=assertWooReturnFacts(k,s,order);return {available:true,connection_revision:b.configuration_revision,contract_digest:WOO_RETURN_CONTRACT_DIGEST,source_identity:b.source_identity,account_id:b.account_id,scope:'read',native_order_id:b.native_order_id,production_qualified:false};}
export function recordWooRma(k:CommerceKernel,s:Row,request:Row,quote:Row,receiptId:string){
 const r=k.db.prepare('SELECT * FROM commerce_resources WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,request.resource_id) as Row;
 if(!r||r.source_system!=='woocommerce')return;
 const order={...r,payload:JSON.parse(r.payload)},source=assertWooReturnFacts(k,s,order);
 const body={kind:'composed_local_rma',request_id:request.id,resource_id:request.resource_id,case_id:request.case_id,customer_id:order.customer_id,native_order_id:source.native_order_id,native_return_id:null,
  source_identity:source.source_identity,account_id:source.account_id,source_digest:source.source_digest,source_revision:source.source_revision,contract_digest:source.contract_digest,
  configuration_digest:quote.configuration_digest,quote_digest:contentDigest(quote),receipt_id:receiptId,selection:quote.selection,status:'submitted',qualification:'fixture_only',financial_effect:false};
 k.db.prepare('INSERT INTO commerce_woo_rma_bindings VALUES(?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,request.id,request.resource_id,JSON.stringify(body),contentDigest(body),k.clock());
}
export function wooReturnAuthority(k:CommerceKernel,s:Row,requestId:string){
 id(requestId);const r=k.db.prepare('SELECT * FROM commerce_return_requests WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,requestId) as Row;
 const bound=k.db.prepare('SELECT * FROM commerce_woo_rma_bindings WHERE tenant_id=? AND store_id=? AND request_id=?').get(s.tenant_id,s.store_id,requestId) as Row;
 if(!r||!bound||!r.receipt_id||r.state!=='submitted')throw new Error('WOO_RMA_REQUIRED');
 const body=JSON.parse(bound.body),request=JSON.parse(r.body),receipt=k.db.prepare('SELECT * FROM commerce_action_receipts WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,r.receipt_id) as Row;
 if(!receipt)throw new Error('WOO_RMA_INTEGRITY');const observed=JSON.parse(receipt.body);
 if(contentDigest(body)!==bound.digest||contentDigest(request)!==r.digest||contentDigest(observed)!==receipt.digest||body.kind!=='composed_local_rma'||body.native_return_id!==null||body.request_id!==r.id||body.resource_id!==r.resource_id||body.receipt_id!==r.receipt_id||body.configuration_digest!==observed.configuration_digest||contentDigest(body.selection)!==contentDigest(request.selection)||observed.return_request_id!==r.id||observed.effect!=='local_return_request_only')throw new Error('WOO_RMA_INTEGRITY');
 if(k.db.prepare('SELECT 1 FROM commerce_native_return_operations WHERE tenant_id=? AND store_id=? AND request_id=?').get(s.tenant_id,s.store_id,r.id))throw new Error('WOO_NATIVE_RETURN_FORBIDDEN');
 return {...body,authority_digest:bound.digest};
}
