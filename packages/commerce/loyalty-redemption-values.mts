import {exact,id,integer,digest} from './kernel.mts';
import type {CommerceKernel,Scope,Row} from './kernel.mts';
import {contentDigest,jsonValue} from './configuration-values.mts';

export const LOYALTY_REDEEM_ACTION='diagnostic.loyalty.redeem';
export const LOYALTY_REDEMPTION_CONTRACT='rifare-loyalty-redemption-fixture-v1';
export const LOYALTY_QUOTE_KIND='loyalty_redemption_quote',LOYALTY_OPERATION_KIND='loyalty_redemption_operation';
export const LOYALTY_REDEMPTION_LIMIT=1000,LOYALTY_RESERVATION_TTL=10000;
export const REDEMPTION_BINDING_FIELDS=['tenant_id','store_id','source_account_id','balance_source_identity','source_identity','source_contract'];
export const REDEMPTION_COMMAND_FIELDS=['schema_version','action','operation_id','tenant_id','store_id','resource_id','source_id','source_digest','source_identity','source_account_id','account_key','subject_ref','quote_id','quote_digest','points','unit','benefit_id','benefit_digest','benefits_revision','benefits_digest','source_revision','snapshot_digest','rules_revision','rules_digest','expires_at','financial_effect'];
export const REDEMPTION_RESULT_FIELDS=['schema_version','source_identity','source_account_id','account_key','operation_id','command_digest','points','unit','benefit_id','benefit_digest','state','reason','provider_ref','before_revision','before_digest','after_revision','after_digest','observed_at'];
export const REDEMPTION_TERM_FIELDS=['schema_version','quote_id','tenant_id','store_id','case_id','resource_id','customer_id','subject_ref','account_key','source_identity','source_account_id','balance_source_identity','points','unit','benefit','benefit_digest','benefits_revision','benefits_digest','source_revision','snapshot_digest','rules_revision','rules_digest','configuration_digest','policy_digest','case_revision','resource_version','resource_digest','owner','ownership_generation','proof_hash','proof_expires_at','link_id','link_digest','capability_revision','control_stamp','created_at','expires_at','financial_effect'];
export const REDEMPTION_STATES=['reserved','unknown','redeemed','rejected','released'];
export const REDEMPTION_REASONS=['LOYALTY_REDEEMED','LOYALTY_INSUFFICIENT_POINTS','LOYALTY_REDEMPTION_UNSUPPORTED','LOYALTY_SNAPSHOT_CHANGED','LOYALTY_RULES_CHANGED','LOYALTY_BENEFIT_CHANGED','LOYALTY_TERMS_EXPIRED'];

export function redemptionHash(value:unknown):string {
  if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw new Error('LOYALTY_REDEMPTION_INTEGRITY');return value;
}
export function redemptionShape(value:unknown,fields:string[],limit=32768):Row {return exact(jsonValue(value,limit),fields);}
export function redemptionPoints(value:bigint):number {
  if(value<0n||value>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('LOYALTY_POINTS_LIMIT');return Number(value);
}
/** Same canonical encoding as contentDigest, with an explicit bound for a
 * complete 1000-entry journal. Individual records retain the small bound. */
export function redemptionHistoryDigest(value:unknown) {return digest(JSON.stringify(jsonValue(value,8*1024*1024)));}
export function redemptionHuman(k:CommerceKernel,scope:Scope) {
  const s=k.require(scope);
  if(!['owner','operator','reviewer'].includes(s.role)||k.workerIdentity(scope)!==null)throw new Error('ACCESS_DENIED');return s;
}
export function redemptionBinding(parent:Row) {
  const body={tenant_id:id(parent.tenant_id),store_id:id(parent.store_id),source_account_id:id(parent.account_id),balance_source_identity:redemptionHash(parent.source_identity),source_contract:LOYALTY_REDEMPTION_CONTRACT};
  return {...body,source_identity:contentDigest(body)};
}
export function redemptionAccount(binding:Row,subject:string) {
  redemptionHash(subject);return 'lac_'+contentDigest([binding.tenant_id,binding.store_id,binding.source_account_id,binding.balance_source_identity,subject]);
}
export function redemptionBenefit(value:unknown) {
  const b=redemptionShape(value,['id','points','unit','kind'],4096);id(b.id);integer(b.points,1);
  if(b.unit!=='points'||b.kind!=='synthetic_reward')throw new Error('LOYALTY_BENEFIT_INVALID');return b;
}
export function redemptionBenefits(value:unknown) {
  if(!Array.isArray(value)||!value.length||value.length>20)throw new Error('LOYALTY_BENEFIT_INVALID');
  const benefits=value.map(redemptionBenefit);if(new Set(benefits.map(b=>b.id)).size!==benefits.length)throw new Error('LOYALTY_BENEFIT_INVALID');return benefits;
}
export function redemptionBound(value:Row,binding:Row) {
  for(const field of REDEMPTION_BINDING_FIELDS)if(value[field]!==binding[field])throw new Error('LOYALTY_SOURCE_SCOPE_MISMATCH');
}
export function redemptionCatalog(value:unknown,binding:Row) {
  const p=redemptionShape(value,['schema_version',...REDEMPTION_BINDING_FIELDS,'revision','expires_at','benefits','digest']);
  const {digest:hash,...body}=p;redemptionHash(hash);redemptionBound(body,binding);integer(body.revision,1);integer(body.expires_at,1);redemptionBenefits(body.benefits);
  if(body.schema_version!==1||contentDigest(body)!==hash)throw new Error('LOYALTY_BENEFIT_INVALID');return p;
}
export function redemptionOperationId(tenant:string,store:string,receipt:string) {return 'op_'+contentDigest([tenant,store,'case',receipt]).slice(0,40);}
export function redemptionCommand(value:unknown) {
  const p=redemptionShape(value,REDEMPTION_COMMAND_FIELDS);
  for(const field of ['operation_id','tenant_id','store_id','resource_id','source_id','source_account_id','account_key','quote_id','benefit_id'])id(p[field]);
  for(const field of ['source_digest','source_identity','subject_ref','quote_digest','benefit_digest','benefits_digest','snapshot_digest','rules_digest'])redemptionHash(p[field]);
  for(const field of ['points','benefits_revision','source_revision','rules_revision','expires_at'])integer(p[field],1);
  if(p.schema_version!==1||p.action!==LOYALTY_REDEEM_ACTION||p.unit!=='points'||p.financial_effect!==false||p.operation_id!==redemptionOperationId(p.tenant_id,p.store_id,p.source_id))throw new Error('LOYALTY_COMMAND_INVALID');
  return p;
}
export function redemptionResult(value:unknown,command:Row) {
  const c=redemptionCommand(command),p=redemptionShape(value,[...REDEMPTION_RESULT_FIELDS,'digest']),{digest:hash,...body}=p;
  redemptionHash(hash);redemptionHash(p.command_digest);redemptionHash(p.before_digest);redemptionHash(p.after_digest);
  integer(p.before_revision,1);integer(p.after_revision,1);integer(p.observed_at);
  for(const field of ['source_identity','source_account_id','account_key','operation_id','points','unit','benefit_id','benefit_digest'])if(p[field]!==c[field])throw new Error('LOYALTY_RESULT_INVALID');
  if(p.schema_version!==1||p.command_digest!==contentDigest(c)||hash!==contentDigest(body)||!REDEMPTION_REASONS.includes(p.reason))throw new Error('LOYALTY_RESULT_INVALID');
  if(p.state==='redeemed'){
    if(p.reason!=='LOYALTY_REDEEMED'||p.provider_ref!=='reward_'+p.command_digest.slice(0,40)||p.before_revision!==c.source_revision||p.before_digest!==c.snapshot_digest||BigInt(p.after_revision)!==BigInt(p.before_revision)+1n||p.after_digest===p.before_digest)throw new Error('LOYALTY_RESULT_INVALID');
  }else if(p.state!=='rejected'||p.reason==='LOYALTY_REDEEMED'||p.provider_ref!==null||p.after_revision!==p.before_revision||p.after_digest!==p.before_digest)throw new Error('LOYALTY_RESULT_INVALID');
  return p;
}
export function redemptionTerms(value:unknown) {
  const p=redemptionShape(value,REDEMPTION_TERM_FIELDS);
  for(const field of ['quote_id','tenant_id','store_id','case_id','resource_id','customer_id','account_key','source_account_id','owner','link_id'])id(p[field]);
  for(const field of ['subject_ref','source_identity','balance_source_identity','benefit_digest','benefits_digest','snapshot_digest','rules_digest','configuration_digest','policy_digest','resource_digest','proof_hash','link_digest'])redemptionHash(p[field]);
  for(const field of ['points','benefits_revision','source_revision','rules_revision','case_revision','resource_version','ownership_generation','proof_expires_at','capability_revision','expires_at'])integer(p[field],1);
  integer(p.created_at);const benefit=redemptionBenefit(p.benefit);
  if(p.schema_version!==1||p.unit!=='points'||p.financial_effect!==false||benefit.points!==p.points||contentDigest(benefit)!==p.benefit_digest||p.expires_at<=p.created_at||p.expires_at>p.created_at+LOYALTY_RESERVATION_TTL||p.expires_at>p.proof_expires_at||typeof p.control_stamp!=='string'||!/^\d+:\d+:\d+$/.test(p.control_stamp))throw new Error('LOYALTY_QUOTE_INVALID');
  return p;
}
