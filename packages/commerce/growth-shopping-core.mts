import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { id } from './kernel.mts';
import { contentDigest } from './configuration-values.mts';

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
 return s;
}
