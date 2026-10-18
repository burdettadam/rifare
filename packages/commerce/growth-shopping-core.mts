import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { id,digest } from './kernel.mts';
import { contentDigest } from './configuration-values.mts';
import { email } from './customer-access.mts';
import { assertNotErased } from './data-guards.mts';

export function growthBody(row:Row|undefined){if(!row)throw new Error('NOT_FOUND');const value=JSON.parse(row.body);if(contentDigest(value)!==row.digest)throw new Error('GROWTH_INTEGRITY');return value;}
export function growthText(value:unknown,max=500){if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x1f\x7f]/.test(value))throw new Error('INVALID_INPUT');return value;}
export function growthScope(k:CommerceKernel,scope:Scope,resource:string,action='resource.read'){
 const s=k.authorize(scope,action,id(resource)),order=k.get(scope,resource);
 if(order.kind!=='order'||!order.customer_id)throw new Error('SHOPPING_ORDER_REQUIRED');
 return {s,order};
}
export function growthCustomer(k:CommerceKernel,scope:Scope,resource:string,customer:string){
 const {s,order}=growthScope(k,scope,resource);
 if(s.role!=='customer'||s.resource_id!==resource||s.customer_id!==customer||order.customer_id!==customer)throw new Error('CUSTOMER_VERIFICATION_REQUIRED');
 growthCustomerProof(k,s,resource,customer);
 return s;
}
/** Validate the original proof against current source ownership and contact, not just its live session. */
export function growthCustomerProof(k:CommerceKernel,s:Row,resource:string,customer:string,error='CUSTOMER_VERIFICATION_REQUIRED'){
 const order=k.db.prepare("SELECT * FROM commerce_resources WHERE tenant_id=? AND store_id=? AND id=? AND kind='order'").get(s.tenant_id,s.store_id,resource) as Row|undefined;
 const proof=k.db.prepare('SELECT * FROM commerce_customer_proof_bindings WHERE token_hash=?').get(s.token_hash) as Row|undefined;
 const current=proof?k.db.prepare("SELECT * FROM commerce_resources WHERE tenant_id=? AND store_id=? AND id=? AND kind='customer'").get(s.tenant_id,s.store_id,proof.customer_resource_id) as Row|undefined:undefined;
 if(s.role!=='customer'||s.resource_id!==resource||s.customer_id!==customer||!order||order.customer_id!==customer||!current||current.external_id!==customer||current.source_system!==order.source_system)throw new Error(error);
 let address:string;try{address=email(JSON.parse(current.payload).email);}catch{throw new Error(error);}
 if(proof!.owner_hash!==digest(JSON.stringify([current.id,current.source_version,address])))throw new Error(error);
 assertNotErased(k,s,resource,customer);assertNotErased(k,s,current.id,customer);
 return {order,customer:current,proof};
}
