import { exact } from '../commerce/kernel.mts';
import type { Row } from '../commerce/kernel.mts';
import { jsonValue } from '../commerce/configuration-values.mts';

export const RETURN_API_VERSION='2026-10';
const fields=`id status order { id } returnLineItems(first: 100) { nodes { ... on ReturnLineItem { id quantity returnReasonNote fulfillmentLineItem { id } } } pageInfo { hasNextPage } } reverseFulfillmentOrders(first: 100) { nodes { id } pageInfo { hasNextPage } }`;
export const CREATE_RETURN=`mutation RifareReturn($returnInput: ReturnInput!) { returnCreate(returnInput: $returnInput) { userErrors { field message } return { ${fields} } } }`;
export const QUERY_RETURN=`query RifareReturn($id: ID!) { return(id: $id) { ${fields} } }`;
export type ReturnTransport=(request:{query:string;variables:Row})=>Promise<{status:number;api_version:string;body:unknown}>;
export function nativeGid(value:unknown,type:string){if(typeof value!=='string'||!new RegExp('^gid://shopify/'+type+'/[1-9][0-9]*$').test(value))throw new Error('NATIVE_RETURN_INVALID');return value;}
export function nativeReturnRequest(orderId:string,lines:Row[],requestId:string) {
 nativeGid(orderId,'Order');if(!Array.isArray(lines)||!lines.length||lines.length>50)throw new Error('NATIVE_RETURN_INVALID');
 return {orderId,returnLineItems:lines.map(l=>({fulfillmentLineItemId:nativeGid(l.fulfillment_line_id,'FulfillmentLineItem'),quantity:l.quantity,returnReason:'OTHER',returnReasonNote:'Rifare '+requestId}))};
}
export function validateNativeReturn(value:unknown,expected:Row) {
 const r=jsonValue(value,131072);nativeGid(r?.id,'Return');if(!['OPEN','CLOSED','CANCELED','DECLINED','REQUESTED'].includes(r.status)||r.order?.id!==expected.orderId)throw new Error('NATIVE_RETURN_MISMATCH');
 const lines=r.returnLineItems,reverse=r.reverseFulfillmentOrders;
 if(!lines?.pageInfo||lines.pageInfo.hasNextPage!==false||!reverse?.pageInfo||reverse.pageInfo.hasNextPage!==false||!Array.isArray(lines.nodes)||!Array.isArray(reverse.nodes)||!reverse.nodes.length||lines.nodes.length!==expected.returnLineItems.length)throw new Error('NATIVE_RETURN_INCOMPLETE');
 const seen=new Set<string>(),lineIds=new Set<string>();
 for(const line of lines.nodes){nativeGid(line.id,'ReturnLineItem');const id=nativeGid(line.fulfillmentLineItem?.id,'FulfillmentLineItem');
  if(seen.has(id)||lineIds.has(line.id))throw new Error('NATIVE_RETURN_MISMATCH');seen.add(id);lineIds.add(line.id);
  const e=expected.returnLineItems.find((v:Row)=>v.fulfillmentLineItemId===id);
  if(!e||line.quantity!==e.quantity||line.returnReasonNote!==e.returnReasonNote)throw new Error('NATIVE_RETURN_MISMATCH');
 }
 const reverseIds=reverse.nodes.map((v:Row)=>nativeGid(v.id,'ReverseFulfillmentOrder'));if(new Set(reverseIds).size!==reverseIds.length)throw new Error('NATIVE_RETURN_MISMATCH');
 return {id:r.id,status:r.status,order_id:r.order.id,lines:lines.nodes.map((l:Row)=>({id:l.id,fulfillment_line_id:l.fulfillmentLineItem.id,quantity:l.quantity})),reverse_fulfillment_ids:reverseIds,financial_effect:false};
}
// No default network client: this constructor accepts only a server-owned fixture
// transport. Production provisioning and readiness are intentionally unavailable.
export class ShopifyReturnFixtureAdapter {
 readonly identity:string;readonly tenant:string;readonly store:string;readonly qualification='fixture_only';#send:ReturnTransport;
 constructor(input:{mode:'fixture';identity:string;tenant:string;store:string;transport:ReturnTransport}){
  exact(input,['mode','identity','tenant','store','transport']);if(input.mode!=='fixture'||typeof input.transport!=='function'||!/^[A-Za-z0-9_.:-]{1,96}$/.test(input.identity)||!input.tenant||!input.store)throw new Error('NATIVE_RETURN_UNQUALIFIED');
  this.identity=input.identity;this.tenant=input.tenant;this.store=input.store;this.#send=input.transport;
 }
 async #call(query:string,variables:Row){
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{const r=await Promise.race([this.#send({query,variables:jsonValue(variables)}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('NATIVE_OUTCOME_UNKNOWN')),2000);})]);
   if(r.status!==200||r.api_version!==RETURN_API_VERSION)throw new Error('NATIVE_OUTCOME_UNKNOWN');const body=jsonValue(r.body,262144);if(body.errors||!body.data)throw new Error('NATIVE_OUTCOME_UNKNOWN');return body.data;
  }finally{clearTimeout(timer);}
 }
 async create(input:Row){const data=await this.#call(CREATE_RETURN,{returnInput:input}),result=data.returnCreate;
  if(!result||!Array.isArray(result.userErrors))throw new Error('NATIVE_OUTCOME_UNKNOWN');
  if(result.return===null&&result.userErrors.length)return {rejected:true as const};
  if(result.userErrors.length)throw new Error('NATIVE_OUTCOME_UNKNOWN');return {rejected:false as const,record:validateNativeReturn(result.return,input)};
 }
 async lookup(returnId:string,input:Row){const data=await this.#call(QUERY_RETURN,{id:nativeGid(returnId,'Return')});if(!data.return)throw new Error('NATIVE_OUTCOME_UNKNOWN');const record=validateNativeReturn(data.return,input);if(record.id!==returnId)throw new Error('NATIVE_RETURN_MISMATCH');return record;}
}
