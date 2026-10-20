import {CommerceKernel,exact,id,integer} from './kernel.mts';
import type {Scope,Row} from './kernel.mts';
import {contentDigest,jsonValue} from './configuration-values.mts';
import {CaseConfigurations} from './case-configurations.mts';
import {assertSupportOwner,ownershipRow} from './support-core.mts';
import {permissionDecision} from './authorization.mts';
import {dropoffReviewContext} from './dropoff-credential-records.mts';
import {assertRecoveryEgress} from './data-guards.mts';
import {fulfillmentContext,fulfillmentSettings} from './return-fulfillment-core.mts';
import {QualifiedReturnDestinations} from './qualified-return-destinations.mts';
import {ReverseHubs} from './reverse-hubs.mts';
import {PartnerReadiness} from './partner-readiness.mts';
import {DropoffFixtureSource} from '../adapters/dropoff-fixture-source.mts';

type Owners={destinations:QualifiedReturnDestinations;hubs:ReverseHubs;source:DropoffFixtureSource};
const FLAGS=Object.freeze({qualification:'synthetic_only',external_qualified:false,physical_handoff_qualified:false,credential_issued:false,execution_authorized:false,capacity_reserved:false,financial_effect:false});
const unique=(values:string[])=>[...new Set(values)];
function decision(known:string[],unknown:string[]){
  const state=known.length?'unavailable':unknown.length?'unverified':'eligible';
  return {state,eligible:state==='eligible',reasons:unique([...known,...unknown])};
}
const originalItem=(item:Row)=>({line_id:item.line_id,item_id:item.item_id,category:item.category,quantity:item.quantity});

/** A transient operator read. Native owners alone select, issue or receive. */
export class DropoffChoices {
  readonly k:CommerceKernel;readonly destinations:QualifiedReturnDestinations;readonly hubs:ReverseHubs;readonly source:DropoffFixtureSource;
  #core:unknown;
  constructor(k:CommerceKernel,owners:Owners){
    exact(owners,['destinations','hubs','source']);
    if(!(k instanceof CommerceKernel)||!(owners.destinations instanceof QualifiedReturnDestinations)||!(owners.hubs instanceof ReverseHubs)||!(owners.source instanceof DropoffFixtureSource))throw new Error('DROPOFF_OWNER_MISMATCH');
    this.k=k;this.destinations=owners.destinations;this.hubs=owners.hubs;this.source=owners.source;this.#core=k.db;
    this.#owners();Object.freeze(this);
  }
  static assertOwner(k:CommerceKernel,value:unknown):DropoffChoices{
    if(!(value instanceof DropoffChoices)||!(#core in value)||value.k!==k)throw new Error('DROPOFF_OWNER_MISMATCH');
    value.#owners();return value;
  }
  #owners(scope?:Row){
    const k=this.k,s=this.source;
    if(k.db!==this.#core||this.destinations.kernel!==k||this.hubs.k!==k||this.destinations.source!==s.fulfillment||this.hubs.source!==s.partner||this.hubs.warehouse!==s.warehouse)throw new Error('DROPOFF_OWNER_MISMATCH');
    // Calling the native implementation also verifies its private constructor
    // state; a structural lookalike cannot attach an alternate source owner.
    DropoffFixtureSource.prototype.assertAttached.call(s,k.db);
    if(scope&&(scope.tenant_id!==s.tenant||scope.store_id!==s.store))throw new Error('DROPOFF_SOURCE_SCOPE');
  }
  #authority(scope:Scope,requestId:string,review?:Row){
    const k=this.k,s=k.require(scope,['owner','operator','reviewer']);
    if(!['owner','operator','reviewer'].includes(s.role)||k.workerIdentity(scope)!==null)throw new Error('ACCESS_DENIED');
    assertRecoveryEgress(k);this.#owners(s);
    const row=k.db.prepare('SELECT case_id FROM commerce_return_requests WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,requestId) as Row|undefined;
    if(!row)throw new Error('NOT_FOUND');
    const ctx=fulfillmentContext(k,scope,row.case_id,requestId);let owner:Row,actor=s.actor_id,role=s.role;
    if(review){
      const current=ownershipRow(k,s,ctx.c.id),member=k.db.prepare('SELECT * FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND active=1').get(s.tenant_id,s.store_id,review.owner) as Row;
      if(review.request_id!==requestId||review.case_id!==ctx.c.id||review.resource_id!==ctx.c.resource_id||!current||current.owner!==review.owner||current.mode!=='human'||current.generation!==review.ownership_generation||!member||member.role!==review.owner_role||!['owner','operator','reviewer'].includes(member.role)||!permissionDecision(k.db,member,'action.propose',ctx.c.resource_id).allowed||!permissionDecision(k.db,member,'support.read',ctx.c.resource_id).allowed)throw new Error('SUPPORT_OWNERSHIP_CHANGED');
      owner=current;actor=member.actor_id;role=member.role;k.authorize(scope,'action.approve',ctx.c.resource_id);
    }else {owner=assertSupportOwner(k,scope,ctx.c.id).owner;k.authorize(scope,'action.propose',ctx.c.resource_id);}
    k.authorize(scope,'support.read',ctx.c.resource_id);
    const proof=new CaseConfigurations(k).verified(scope,ctx.c.id),settings=fulfillmentSettings(k,s),maxAge=integer(ctx.c.pins.composition.effective['data.max_age_seconds'])*1000,now=integer(k.clock());
    integer(maxAge);integer(ctx.c.order.observed_at);
    if(ctx.c.order.observed_at>now||now-ctx.c.order.observed_at>maxAge)throw new Error('DROPOFF_ORDER_STALE');
    // verified() reads the original proof; it does not authenticate or renew it.
    const session=proof.gift_recipient?null:k.db.prepare('SELECT ss.token_hash,ss.last_seen FROM commerce_cases c JOIN commerce_sessions ss ON c.verification_hash=ss.token_hash WHERE c.tenant_id=? AND c.store_id=? AND c.id=?').get(s.tenant_id,s.store_id,ctx.c.id) as Row|null;
    if(!proof.gift_recipient&&!session)throw new Error('CUSTOMER_VERIFICATION_REQUIRED');
    const expires_at=Math.min(proof.expires_at,session?integer(session.last_seen)+900000:proof.expires_at,ctx.c.order.observed_at+maxAge,settings.expires_at);
    const pin={tenant_id:s.tenant_id,store_id:s.store_id,actor_id:actor,role,case_id:ctx.c.id,resource_id:ctx.c.resource_id,case_revision:ctx.c.revision,
      configuration_digest:ctx.c.configuration_digest,order_digest:contentDigest(ctx.c.order),request_digest:ctx.request.digest,native_return_digest:ctx.native.native_digest,
      ownership_digest:contentDigest(owner),proof_digest:contentDigest(proof),verification_identity:session?.token_hash??contentDigest(proof),settings_digest:settings.digest,expires_at};
    return {case_id:ctx.c.id,pin,expires_at};
  }
  #snapshot(scope:Scope,requestId:string,review=false){
    this.#owners();
    const view=review?this.destinations.reviewItems(scope,{request_id:requestId}):this.destinations.evaluateItems(scope,{request_id:requestId}),directory=this.source.observe(),partner=this.source.partnerConfiguration();
    const readiness=partner?new PartnerReadiness(this.k).inspect(scope,{service:'reverse_hub',account_id:partner.body.account_id,source_identity:this.source.partner.identity,source_config_digest:partner.digest,region:view.region,capability:'route'}):null;
    this.#owners();return {view,directory,partner,readiness};
  }
  #project(requestId:string,authority:Row,observations:Row){
    const {view,directory,partner,readiness}=observations,now=integer(this.k.clock()),known:string[]=[],unknown:string[]=[];
    const expires=[authority.expires_at,view.expires_at];
    if(!directory)unknown.push('DROPOFF_CONFIGURATION_MISSING');
    else{
      expires.push(directory.expires_at);
      if(directory.observed_at>now||now-directory.observed_at>300000||directory.expires_at<=now)unknown.push('DROPOFF_CONFIGURATION_STALE');
    }
    if(!partner)unknown.push('PARTNER_CONFIGURATION_MISSING');
    else{
      expires.push(partner.body.expires_at);
      if(partner.body.expires_at<=now)unknown.push('PARTNER_CONFIGURATION_EXPIRED');
      if(directory&&directory.partner_config_digest!==partner.digest)unknown.push('PARTNER_CONFIGURATION_CHANGED');
      if(!partner.body.regions.includes(view.region))known.push('REGION_UNSUPPORTED');
    }
    if(readiness){
      if(readiness.expires_at!==null)expires.push(readiness.expires_at);
      // A changed source digest needs a fresh declaration and native readiness
      // review. Explicit revocation, outage or missing approval remains a denial.
      for(const reason of readiness.reasons)(reason==='PARTNER_CONFIGURATION_CHANGED'?unknown:known).push(reason);
    }
    const items=view.source_items.map(originalItem),methods=(directory?.combinations??[]).map((combination:Row)=>{
      const whole=view.destinations.find((d:Row)=>d.destination_id===combination.destination_id),site=partner?.body.terms.sites.find((s:Row)=>s.site_id===combination.site_id);
      const methodKnown=[...known],methodUnknown=[...unknown],availability=combination.availability;
      if(partner&&!site)methodKnown.push('SITE_UNAVAILABLE');
      if(site&&site.warehouse_source_identity!==this.source.warehouse.identity)methodKnown.push('WAREHOUSE_SOURCE_MISMATCH');
      if(whole)expires.push(whole.expires_at);
      else methodKnown.push('DESTINATION_UNAVAILABLE');
      if(availability===null)methodUnknown.push('AVAILABILITY_UNVERIFIED');
      else{
        expires.push(availability.expires_at);
        if(availability.observed_at>now||now-availability.observed_at>300000||availability.expires_at<=now)methodUnknown.push('AVAILABILITY_UNVERIFIED');
        else if(availability.state==='unavailable')methodKnown.push('METHOD_UNAVAILABLE');
      }
      const itemResults=view.source_items.map((item:Row)=>{
        const k=[...methodKnown],u=[...methodUnknown],native=view.item_evaluations.find((i:Row)=>i.line_id===item.line_id);
        if(!native)throw new Error('DROPOFF_DESTINATION_VIEW_INVALID');
        const result=native.destinations.find((d:Row)=>d.destination_id===combination.destination_id);
        if(whole&&!result)throw new Error('DROPOFF_DESTINATION_VIEW_INVALID');
        if(result&&!result.eligible)k.push(...result.reasons);
        if(site&&!site.categories.includes(item.category))k.push('SITE_CATEGORY_UNSUPPORTED');
        if(!combination.item_ids.includes(item.item_id))k.push('METHOD_ITEM_UNSUPPORTED');
        if(!combination.category_ids.includes(item.category))k.push('METHOD_CATEGORY_UNSUPPORTED');
        return {...originalItem(item),...decision(k,u)};
      });
      // The aggregate decision is independent of the individual line decisions.
      // In particular, two individually fitting lines need not fit together.
      const allKnown=[...methodKnown,...(whole?.reasons??[])],allUnknown=[...methodUnknown];
      for(const item of itemResults){if(item.state==='unavailable')allKnown.push(...item.reasons);else if(item.state==='unverified')allUnknown.push(...item.reasons);}
      return {choice_id:contentDigest([combination.site_id,combination.destination_id,combination.method_id]),site_id:combination.site_id,destination_id:combination.destination_id,method_id:combination.method_id,
        packaging:combination.packaging,label_required:combination.label_required,credential_kind:combination.credential_kind,instructions_ref:combination.instructions_ref,accessible_alternative:combination.accessible_alternative,availability,
        items:itemResults,...decision(allKnown,allUnknown),fees:{partner_fee:partner?{amount_minor:partner.body.terms.fee_minor,currency:partner.body.terms.currency,basis:'per_handoff'}:null,
          destination_handling_estimate:whole?{amount_minor:whole.handling_fee_estimate_minor,currency:whole.currency,basis:'per_handoff'}:null,total_minor:null,charged:false}};
    });
    const choices=methods.filter((m:Row)=>m.eligible),state=choices.length?'eligible_choices':!directory||methods.some((m:Row)=>m.state==='unverified')?'unverified':'needs_review';
    return jsonValue({schema_version:1,request_id:requestId,case_id:authority.case_id,items,methods,choices,state,
      source_digest:contentDigest({authority:authority.pin,...observations}),directory_revision:directory?.revision??0,directory_digest:directory?.digest??null,
      observed_at:directory?.observed_at??null,expires_at:Math.min(...expires),fallback:'merchant_review_without_dropoff_promise',...FLAGS});
  }
  quote(scope:Scope,input:unknown){
    const p=exact(jsonValue(input),['request_id']);id(p.request_id);
    return this.#current(scope,p.request_id);
  }
  review(scope:Scope,input:unknown){
    const p=exact(jsonValue(input),['quote_id']),q=dropoffReviewContext(this.k,scope,id(p.quote_id));
    return this.#current(scope,q.request_id,q);
  }
  #current(scope:Scope,requestId:string,review?:Row){
    const authority=this.#authority(scope,requestId,review),first=this.#snapshot(scope,requestId,!!review),projection=this.#project(requestId,authority,first);
    const nextAuthority=this.#authority(scope,requestId,review),second=this.#snapshot(scope,requestId,!!review),next=this.#project(requestId,nextAuthority,second),finalAuthority=this.#authority(scope,requestId,review);
    if(contentDigest(authority.pin)!==contentDigest(nextAuthority.pin)||contentDigest(authority.pin)!==contentDigest(finalAuthority.pin)||contentDigest(first)!==contentDigest(second)||contentDigest(projection)!==contentDigest(next))throw new Error('DROPOFF_OBSERVATION_CHANGED');
    return next;
  }
}
