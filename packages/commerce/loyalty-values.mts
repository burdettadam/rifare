import {exact,id,integer} from './kernel.mts';
import type {Row} from './kernel.mts';
import {contentDigest,jsonValue} from './configuration-values.mts';

export const LOYALTY_CONTRACT='rifare-loyalty-fixture-v1';
export const LOYALTY_MAX_AGE=300000;
export const LOYALTY_SNAPSHOT_FIELDS=['customer_id','source_revision','observed_at','expires_at','complete','balances','rules'];
const ENVELOPE_FIELDS=['schema_version','tenant_id','store_id','account_id','provider','source_identity','source_contract','qualification','capabilities',...LOYALTY_SNAPSHOT_FIELDS];

/** Scope failures remain errors; they are never an unavailable account result. */
export class LoyaltyScopeError extends Error {
  constructor(){super('LOYALTY_SOURCE_SCOPE_MISMATCH');}
}
export function loyaltyConfig(value:unknown) {
  const p=exact(jsonValue(value,4096),['tenant_id','store_id','account_id','provider']);
  for(const key of ['tenant_id','store_id','account_id'])id(p[key]);
  if(!['full','limited'].includes(p.provider))throw new Error('LOYALTY_PROVIDER_INVALID');
  return p;
}
export function loyaltyCapabilities(provider:string) {
  if(!['full','limited'].includes(provider))throw new Error('LOYALTY_PROVIDER_INVALID');
  return {read:true,accrue:true,reserve:provider==='full',redeem:true,reverse:provider==='full',lookup:true};
}
export function loyaltySnapshot(value:unknown) {
  const p=exact(jsonValue(value,16384),LOYALTY_SNAPSHOT_FIELDS);
  id(p.customer_id);integer(p.source_revision,1);integer(p.observed_at);integer(p.expires_at);
  if(p.expires_at<=p.observed_at||BigInt(p.expires_at)-BigInt(p.observed_at)>BigInt(LOYALTY_MAX_AGE)||typeof p.complete!=='boolean')
    throw new Error('LOYALTY_SNAPSHOT_INVALID');
  const b=exact(p.balances,['unit','pending','earned','reserved','redeemed','reversed','available']);
  if(b.unit!=='points')throw new Error('LOYALTY_UNIT_UNSUPPORTED');
  for(const field of ['pending','earned','reserved','redeemed','reversed','available'])integer(b[field]);
  if(BigInt(b.available)!==BigInt(b.earned)-BigInt(b.reserved)-BigInt(b.redeemed)-BigInt(b.reversed))
    throw new Error('LOYALTY_BALANCE_INVALID');
  const r=exact(p.rules,['revision','unit','minimum_redemption','maximum_redemption','redemption_step','expires_at']);
  if(r.unit!=='points')throw new Error('LOYALTY_UNIT_UNSUPPORTED');
  for(const field of ['revision','minimum_redemption','maximum_redemption','redemption_step','expires_at'])integer(r[field],1);
  if(r.maximum_redemption<r.minimum_redemption)throw new Error('LOYALTY_RULES_INVALID');
  return p;
}
export function loyaltyBinding(config:Row) {
  return {...config,source_contract:LOYALTY_CONTRACT,source_identity:contentDigest({...config,source_contract:LOYALTY_CONTRACT})};
}
export function assertLoyaltyScope(value:Row,binding:Row,customer:string) {
  for(const field of ['tenant_id','store_id','account_id','provider','source_identity','source_contract'])
    if(Object.hasOwn(value,field)&&value[field]!==binding[field])throw new LoyaltyScopeError();
  if(Object.hasOwn(value,'customer_id')&&value.customer_id!==customer)throw new LoyaltyScopeError();
}
export function loyaltyEnvelope(value:unknown,binding:Row,customer:string) {
  const p=jsonValue(value,32768);
  if(!p||typeof p!=='object'||Array.isArray(p))throw new Error('LOYALTY_SOURCE_INVALID');
  assertLoyaltyScope(p,binding,customer);
  exact(p,[...ENVELOPE_FIELDS,'digest']);
  const {digest,...body}=p;
  if(typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest)||contentDigest(body)!==digest||p.schema_version!==1||p.qualification!=='synthetic_only')
    throw new Error('LOYALTY_SOURCE_INVALID');
  if(contentDigest(p.capabilities)!==contentDigest(loyaltyCapabilities(binding.provider)))throw new Error('LOYALTY_CAPABILITIES_INVALID');
  loyaltySnapshot(Object.fromEntries(LOYALTY_SNAPSHOT_FIELDS.map(key=>[key,p[key]])));
  return p;
}
/** Inclusive expiry; an old observation takes precedence over overlapping expiry. */
export function loyaltyFreshness(snapshot:Row,now:number):string|null {
  integer(now);
  if(snapshot.observed_at>now)return 'LOYALTY_SOURCE_FUTURE';
  if(now-snapshot.observed_at>LOYALTY_MAX_AGE)return 'LOYALTY_SOURCE_STALE';
  if(snapshot.expires_at<=now)return 'LOYALTY_SOURCE_EXPIRED';
  if(snapshot.rules.expires_at<=now)return 'LOYALTY_RULES_EXPIRED';
  return null;
}
