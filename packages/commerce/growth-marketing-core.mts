import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { id,digest } from './kernel.mts';
import { contentDigest } from './configuration-values.mts';
import { money } from './money.mts';
import { permissionDecision } from './authorization.mts';

export const GROWTH_MARKETING_TABLES=Object.freeze([
  'commerce_checkout_experiments','commerce_checkout_assignments','commerce_checkout_exposures',
  'commerce_growth_observations','commerce_marketing_segments','commerce_marketing_sync_operations',
  'commerce_growth_campaigns','commerce_growth_campaign_approvals','commerce_growth_campaign_recipients',
  'commerce_cart_recoveries','commerce_email_action_links',
]);
export function growthBody(row:Row|undefined|null):Row {
  if(!row)throw new Error('NOT_FOUND');
  const body=JSON.parse(row.body);
  if(contentDigest(body)!==row.digest)throw new Error('GROWTH_RECORD_INTEGRITY');
  if(body.redacted)throw new Error('SUBJECT_ERASED');
  return body;
}
export function growthMinor(value:unknown):bigint {return BigInt(money('USD',value).minor);}
export function growthApproval(k:CommerceKernel,s:Row,approval:Row,resource:string|null=null){
  if(approval.expires_at<=k.clock())throw new Error('APPROVAL_EXPIRED');
  const member=k.db.prepare('SELECT * FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND active=1')
    .get(s.tenant_id,s.store_id,approval.approver) as Row;
  const decision=member&&permissionDecision(k.db,member,'action.approve',resource);
  if(!decision?.allowed||decision.authority_revision!==approval.authority_revision)throw new Error('APPROVAL_AUTHORITY_CHANGED');
}
/** Authenticated customer sessions still need their original current proof binding. */
export function growthCustomer(k:CommerceKernel,scope:Scope,resource:string,customer:string){
  const s=k.require(scope,['customer']);
  if(s.role!=='customer'||s.resource_id!==id(resource)||s.customer_id!==id(customer))throw new Error('CUSTOMER_CONFIRMATION_REQUIRED');
  const order=k.get(scope,resource);
  const proof=k.db.prepare('SELECT * FROM commerce_customer_proof_bindings WHERE token_hash=?').get(s.token_hash) as Row;
  const owner=proof&&k.db.prepare("SELECT * FROM commerce_resources WHERE tenant_id=? AND store_id=? AND id=? AND kind='customer'").get(s.tenant_id,s.store_id,proof.customer_resource_id) as Row;
  const email=owner&&JSON.parse(owner.payload).email;
  if(order.kind!=='order'||order.customer_id!==customer||!owner||owner.external_id!==customer||owner.source_system!==order.source_system||typeof email!=='string'||proof.owner_hash!==digest(JSON.stringify([owner.id,owner.source_version,email.trim().toLowerCase()])))throw new Error('CUSTOMER_CONFIRMATION_REQUIRED');
  return s;
}
