import {CommerceKernel,exact,id,integer} from './kernel.mts';
import type {Scope,Row} from './kernel.mts';
import {canonical,contentDigest,jsonValue} from './configuration-values.mts';
import {supportCase,assertSupportOwner} from './support-core.mts';
import {SupportConsent} from './support-consent.mts';
import {growthBody} from './growth-marketing-core.mts';
import {ShoppingCart} from './shopping-cart.mts';
import {GrowthCampaigns} from './growth-campaigns.mts';
import {CartRecovery} from './cart-recovery.mts';
import {LoyaltyRedemptions,loyaltyGatewayQuote} from './loyalty-redemptions.mts';
import {loyaltyQuoteRecord} from './loyalty-redemption-records.mts';
import {redemptionHuman,redemptionHash} from './loyalty-redemption-values.mts';
import {LoyaltyIncentiveFixtureSource} from '../adapters/loyalty-incentive-fixture-source.mts';
import {assertSeparateLoyaltyDatabases} from '../adapters/loyalty-fixture-source.mts';

type Owners={redemptions:LoyaltyRedemptions;carts:ShoppingCart;campaigns:GrowthCampaigns;recovery:CartRecovery;source:LoyaltyIncentiveFixtureSource};
const FLAGS=Object.freeze({execution_authorized:false,enrollment_authorized:false,send_authorized:false,monetary_conversion_supported:false,production_qualified:false});
function comparison(value:unknown) {
  const p=exact(jsonValue(value),['quote','digest',...Object.keys(FLAGS)]);redemptionHash(p.digest);
  if(Object.keys(FLAGS).some(key=>p[key]!==false)||contentDigest(p.quote)!==p.digest)throw new Error('LOYALTY_INCENTIVE_CHANGED');return p;
}
export function assertLoyaltyIncentiveOwner(k:CommerceKernel,value:unknown):LoyaltyIncentives {
  if(!(value instanceof LoyaltyIncentives)||value.k!==k)throw new Error('LOYALTY_SOURCE_OWNER_MISMATCH');return value;
}

/** Compares existing terms; only native redemption and delivery owners execute effects. */
export class LoyaltyIncentives {
  readonly k:CommerceKernel;readonly redemptions:LoyaltyRedemptions;readonly carts:ShoppingCart;readonly campaigns:GrowthCampaigns;readonly recovery:CartRecovery;readonly source:LoyaltyIncentiveFixtureSource;
  #core:unknown;
  constructor(k:CommerceKernel,owners:Owners) {
    exact(owners,['redemptions','carts','campaigns','recovery','source']);
    if(!(k instanceof CommerceKernel)||!(owners.redemptions instanceof LoyaltyRedemptions)||!(owners.carts instanceof ShoppingCart)||!(owners.campaigns instanceof GrowthCampaigns)||!(owners.recovery instanceof CartRecovery)||!(owners.source instanceof LoyaltyIncentiveFixtureSource))throw new Error('LOYALTY_SOURCE_OWNER_MISMATCH');
    this.k=k;this.redemptions=owners.redemptions;this.carts=owners.carts;this.campaigns=owners.campaigns;this.recovery=owners.recovery;this.source=owners.source;this.#core=k.db;
    this.#owners();this.recovery.attachIncentives(this);Object.freeze(this);
  }
  #owners(s?:Row) {
    const k=this.k,source=this.source,scope=s??{tenant_id:source.tenant,store_id:source.store};
    if(k.db!==this.#core||this.redemptions.k!==k||this.carts.kernel!==k||this.campaigns.k!==k||this.campaigns.segments.k!==k||this.campaigns.experiments.k!==k||this.recovery.k!==k||this.recovery.carts!==this.carts||this.recovery.campaigns!==this.campaigns||this.carts.source!==source.shopping||this.redemptions.source!==source.redemption||this.campaigns.segments.sourceFor(scope)!==source.marketing||scope.tenant_id!==source.tenant||scope.store_id!==source.store)throw new Error('LOYALTY_SOURCE_OWNER_MISMATCH');
    for(const db of [source.db,source.shopping.db,source.redemption.db])assertSeparateLoyaltyDatabases(k.db,db);
    return source.observe();
  }
  #terms(scope:Scope,quoteId:string,quoteDigest:string,cartId:string,campaignId:string) {
    const k=this.k,s=redemptionHuman(k,scope),applicability=this.#owners(s),record=loyaltyQuoteRecord(k,s,id(quoteId));
    redemptionHash(quoteDigest);if(record.body.terms_digest!==quoteDigest||!record.body.terms)throw new Error('LOYALTY_INCENTIVE_CHANGED');
    const q=record.body.terms;
    loyaltyGatewayQuote(this.redemptions,scope,{case_id:q.case_id,arguments:{quote_id:quoteId,quote_digest:quoteDigest}},q.created_at);
    const cart=this.carts.readCart(scope,id(cartId)),preview=this.carts.currentPreview(scope,cartId),offer=this.campaigns.approvedOffer(scope,id(campaignId),q.case_id);
    if(cart.status==='purchased')throw new Error('RECOVERY_PURCHASED');
    if(cart.status!=='active'||cart.committed!==true||preview.committed!==true||preview.requires_new_proposal||preview.resource_id!==q.resource_id||preview.subject_id!==q.customer_id||cart.resource_id!==q.resource_id||cart.subject_id!==q.customer_id||offer.resource_id!==q.resource_id||offer.case_id!==q.case_id||offer.offer_id===null||!offer.offer||offer.offer.currency!==preview.currency)throw new Error('LOYALTY_INCENTIVE_CHANGED');
    const pair=applicability.combinations.find((p:Row)=>p.benefit_id===q.benefit.id&&p.offer_id===offer.offer_id);
    if(!pair||!preview.items.length||preview.items.some((item:Row)=>!pair.eligible_variant_ids.includes(item.variant_id)))throw new Error('LOYALTY_INCENTIVE_INELIGIBLE');
    const consent=new SupportConsent(k).eligibility(scope,q.case_id,offer.sender_id,'email','marketing');
    if(!consent.allowed)throw new Error('LOYALTY_INCENTIVE_CHANGED');
    const expires=Math.min(q.expires_at,offer.ends_at,offer.approval_expires_at,offer.offer_expires_at,applicability.expires_at);
    if(expires<=k.clock())throw new Error('LOYALTY_TERMS_EXPIRED');
    return {schema_version:1,case_id:q.case_id,resource_id:q.resource_id,cart_id:cartId,campaign_id:campaignId,loyalty_quote_id:quoteId,loyalty_quote_digest:quoteDigest,points:{unit:'points',quantity:q.points},benefit:q.benefit,
      discount:{offer_id:offer.offer_id,...offer.offer},eligible_items:preview.items,cart_total_minor:preview.total_minor,cart_currency:preview.currency,cart_digest:preview.preview_digest,campaign_digest:offer.campaign_digest,consent_stamp:consent.stamp,applicability_digest:applicability.digest,
      source_references:{loyalty_source_identity:q.source_identity,snapshot_digest:q.snapshot_digest,rules_digest:q.rules_digest,benefits_digest:q.benefits_digest,shopping_source_identity:preview.source_identity,marketing_source_identity:offer.source_identity,marketing_facts_digest:offer.source_facts_digest,applicability_source_identity:applicability.source_identity},
      created_at:q.created_at,expires_at:expires,prospective_earning_supported:false,qualification:'synthetic_only'};
  }
  quote(scope:Scope,customerProof:Scope,value:unknown) {
    const p=exact(jsonValue(value,32768),['case_id','link_id','expected_generation','cart_id','campaign_id','benefit_id']);
    for(const field of ['case_id','link_id','cart_id','campaign_id','benefit_id'])id(p[field]);integer(p.expected_generation,1);
    return this.k.transaction(()=>{
      redemptionHuman(this.k,scope);const {c}=assertSupportOwner(this.k,scope,p.case_id,p.expected_generation);this.k.authorize(scope,'action.propose',c.resource_id);
      const context={case_id:p.case_id,link_id:p.link_id,expected_generation:p.expected_generation},capacity=this.redemptions.context(scope,customerProof,context),benefit=capacity.benefits.find((b:Row)=>b.id===p.benefit_id);
      if(!benefit)throw new Error('LOYALTY_BENEFIT_CHANGED');
      const original=this.redemptions.quote(scope,customerProof,{...context,points:benefit.points,unit:'points',snapshot_digest:capacity.snapshot_digest,benefit_id:p.benefit_id});
      const quote=this.#terms(scope,original.id,original.digest,p.cart_id,p.campaign_id);return {quote,digest:contentDigest(quote),...FLAGS};
    });
  }
  validate(scope:Scope,value:unknown) {
    const p=comparison(value);return this.k.transaction(()=>{
      const q=p.quote,current=this.#terms(scope,q.loyalty_quote_id,q.loyalty_quote_digest,q.cart_id,q.campaign_id);
      if(contentDigest(current)!==p.digest)throw new Error('LOYALTY_INCENTIVE_CHANGED');
      return {valid:true,digest:p.digest,expires_at:current.expires_at,execution_authorized:false,send_authorized:false};
    });
  }
  bind(scope:Scope,value:unknown) {
    const p=exact(jsonValue(value),['recovery_id','quote']);id(p.recovery_id);const compared=comparison(p.quote);
    return this.k.transaction(()=>{
      const s=redemptionHuman(this.k,scope),q=compared.quote;this.validate(scope,compared);
      const {c}=assertSupportOwner(this.k,scope,q.case_id);this.k.authorize(scope,'action.propose',c.resource_id);
      const row=this.k.db.prepare('SELECT * FROM commerce_cart_recoveries WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,p.recovery_id) as Row,b=growthBody(row);
      if(b.id!==p.recovery_id||b.state!=='proposed'||b.cart_id!==q.cart_id||b.campaign_id!==q.campaign_id||b.campaign_digest!==q.campaign_digest||b.case_id!==c.id||b.resource_id!==c.resource_id||b.customer_id!==c.customer_id||row.cart_id!==b.cart_id||row.campaign_id!==b.campaign_id||row.resource_id!==b.resource_id||row.customer_id!==b.customer_id)throw new Error('LOYALTY_INCENTIVE_CHANGED');
      const result={recovery_id:p.recovery_id,quote_digest:compared.digest,bound:true,execution_authorized:false,send_authorized:false};
      if(Object.hasOwn(b,'loyalty_incentive')){
        const old=exact(jsonValue(b.loyalty_incentive),['quote','digest']);
        if(old.digest!==compared.digest||canonical(old.quote)!==canonical(q))throw new Error('LOYALTY_INCENTIVE_BINDING_IMMUTABLE');return result;
      }
      const recipient=this.k.db.prepare('SELECT * FROM commerce_growth_campaign_recipients WHERE tenant_id=? AND store_id=? AND campaign_id=? AND resource_id=?').get(s.tenant_id,s.store_id,q.campaign_id,q.resource_id) as Row;
      if(!recipient||recipient.operation_id!==null)throw new Error('LOYALTY_INCENTIVE_ALREADY_QUEUED');
      const updated={...b,loyalty_incentive:{quote:q,digest:compared.digest}};
      const changed=this.k.db.prepare('UPDATE commerce_cart_recoveries SET body=?,digest=? WHERE tenant_id=? AND store_id=? AND id=? AND digest=?').run(canonical(updated),contentDigest(updated),s.tenant_id,s.store_id,p.recovery_id,row.digest);
      if(changed.changes!==1)throw new Error('LOYALTY_INCENTIVE_CHANGED');return result;
    });
  }
  final(scope:Scope,recoveryId:string) {
    const recovery=this.recovery.inspect(scope,id(recoveryId)),binding=exact(jsonValue(recovery.loyalty_incentive),['quote','digest']);
    const {c}=supportCase(this.k,scope,recovery.case_id),q=binding.quote;
    if(recovery.state!=='proposed'||q.case_id!==c.id||q.resource_id!==c.resource_id||q.cart_id!==recovery.cart_id||q.campaign_id!==recovery.campaign_id||q.campaign_digest!==recovery.campaign_digest||recovery.customer_id!==c.customer_id)throw new Error('LOYALTY_INCENTIVE_CHANGED');
    this.validate(scope,{...binding,...FLAGS});return {digest:binding.digest};
  }
}
