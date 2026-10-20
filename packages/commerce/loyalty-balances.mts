import type {CommerceKernel,Scope,Row} from './kernel.mts';
import {exact,id,integer} from './kernel.mts';
import {contentDigest,jsonValue} from './configuration-values.mts';
import {assertRecoveryEgress} from './data-guards.mts';
import {growthCustomerProof} from './growth-shopping-core.mts';
import {SupportConversations} from './support-conversations.mts';
import {supportCase,ownershipRow,assertSupportOwner} from './support-core.mts';
import {LoyaltyFixtureSource,assertSeparateLoyaltyDatabases} from '../adapters/loyalty-fixture-source.mts';
import {LoyaltyScopeError,loyaltyBinding,loyaltyEnvelope,loyaltyFreshness} from './loyalty-values.mts';

const CONTEXT_FIELDS=['case_id','link_id','expected_generation'];
function input(value:unknown,quote=false) {
  const p=exact(jsonValue(value,32768),quote?[...CONTEXT_FIELDS,'points','unit','snapshot_digest']:CONTEXT_FIELDS);
  id(p.case_id);id(p.link_id);integer(p.expected_generation,1);
  if(quote){
    integer(p.points,1);
    if(p.unit!=='points')throw new Error('LOYALTY_UNIT_UNSUPPORTED');
    if(typeof p.snapshot_digest!=='string'||!/^[a-f0-9]{64}$/.test(p.snapshot_digest))throw new Error('LOYALTY_DIGEST_INVALID');
  }
  return p;
}

/** Current scoped information only. No quote or digest grants execution authority. */
export class LoyaltyBalances {
  readonly k:CommerceKernel;readonly source:LoyaltyFixtureSource|null;
  constructor(k:CommerceKernel,source?:LoyaltyFixtureSource) {
    if(source!==undefined&&!(source instanceof LoyaltyFixtureSource))throw new Error('LOYALTY_SOURCE_OWNER_MISMATCH');
    if(source)assertSeparateLoyaltyDatabases(k.db,source.db);
    this.k=k;this.source=source??null;Object.freeze(this);
  }
  #context(scope:Scope,proof:Scope,p:Row) {
    const k=this.k,{s,c}=supportCase(k,scope,p.case_id),v=k.require(proof);
    if(v.role!=='customer'||v.tenant_id!==s.tenant_id||v.store_id!==s.store_id||v.resource_id!==c.resource_id||v.customer_id!==c.customer_id)
      throw new Error('CUSTOMER_VERIFICATION_REQUIRED');
    supportCase(k,proof,c.id);growthCustomerProof(k,v,c.resource_id,c.customer_id);
    const link=new SupportConversations(k).linkRecord(scope,p.link_id),owner=ownershipRow(k,s,c.id);
    if(link.case_id!==c.id||link.resource_id!==c.resource_id||link.customer_id!==c.customer_id)throw new Error('LOYALTY_LINK_MISMATCH');
    if(!owner||owner.generation!==p.expected_generation)throw new Error('SUPPORT_OWNERSHIP_CHANGED');
    if(s.role!=='customer')assertSupportOwner(k,scope,c.id,p.expected_generation);
    assertRecoveryEgress(k);
    let status='needs_configuration',reason='LOYALTY_SOURCE_NOT_CONFIGURED',snapshot:Row|null=null,snapshot_digest:string|null=null;
    const source=this.source;
    if(source){
      assertSeparateLoyaltyDatabases(k.db,source.db);
      if(source.tenant!==s.tenant_id||source.store!==s.store_id)throw new LoyaltyScopeError();
      let observed:Row|null=null;
      try {
        const raw=source.observe(c.customer_id);
        if(raw!==null)observed=loyaltyEnvelope(raw,loyaltyBinding({tenant_id:source.tenant,store_id:source.store,account_id:source.account,provider:source.provider}),c.customer_id);
        status='unavailable';reason='LOYALTY_ACCOUNT_NOT_FOUND';
      }catch(error){
        if(error instanceof LoyaltyScopeError)throw error;
        status='unverified';reason='LOYALTY_SOURCE_INVALID';
      }
      if(observed){
        if(!observed.complete){status='incomplete';reason='LOYALTY_SNAPSHOT_INCOMPLETE';}
        else {
          const stale=loyaltyFreshness(observed,k.clock());
          if(stale){status='stale';reason=stale;}
          else {const {digest,...body}=observed;snapshot=body;snapshot_digest=digest;status='available';reason='LOYALTY_CURRENT_SOURCE';}
        }
      }
    }
    const result={schema_version:1,case_id:c.id,resource_id:c.resource_id,ownership_generation:owner.generation,status,reason,snapshot,snapshot_digest,
      model_required:false,execution_authorized:false,production_qualified:false};
    return {...result,context_digest:contentDigest({tenant_id:s.tenant_id,store_id:s.store_id,link_id:link.id,context:result})};
  }
  context(scope:Scope,customerProof:Scope,value:unknown) {
    const p=input(value);return this.k.transaction(()=>this.#context(scope,customerProof,p));
  }
  quote(scope:Scope,customerProof:Scope,value:unknown) {
    const p=input(value,true);
    return this.k.transaction(()=>{
      const context=this.#context(scope,customerProof,p),snapshot=context.snapshot;
      let reason=context.reason,eligible=false,terms:Row|null=null;
      if(snapshot){
        const capabilities=snapshot.capabilities,rules=snapshot.rules;
        if(p.snapshot_digest!==context.snapshot_digest)reason='LOYALTY_SNAPSHOT_CHANGED';
        else if(!capabilities.redeem)reason='LOYALTY_REDEMPTION_UNSUPPORTED';
        else if(!capabilities.reserve)reason='LOYALTY_RESERVATION_UNSUPPORTED';
        else if(!capabilities.lookup)reason='LOYALTY_RECONCILIATION_UNSUPPORTED';
        else if(p.points<rules.minimum_redemption||p.points>rules.maximum_redemption||BigInt(p.points)%BigInt(rules.redemption_step)!==0n)reason='LOYALTY_REDEMPTION_RULES';
        else if(p.points>snapshot.balances.available)reason='LOYALTY_INSUFFICIENT_POINTS';
        else {
          eligible=true;reason='LOYALTY_QUOTE_ELIGIBLE';terms={account_id:snapshot.account_id,source_identity:snapshot.source_identity,source_revision:snapshot.source_revision,
            rules_revision:rules.revision,points:p.points,unit:p.unit,expires_at:Math.min(snapshot.expires_at,rules.expires_at)};
        }
      }
      const result={schema_version:1,case_id:context.case_id,resource_id:context.resource_id,points:p.points,unit:p.unit,eligible,reason,terms,snapshot_digest:context.snapshot_digest,
        execution_authorized:false,enrollment_authorized:false,send_authorized:false,monetary_conversion_supported:false,production_qualified:false};
      return {...result,quote_digest:contentDigest({context_digest:context.context_digest,quote:result})};
    });
  }
}
