import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { exact,id } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { growthBody } from './growth-marketing-core.mts';
import { supportCase } from './support-core.mts';
import { assertRecoveryEgress } from './data-guards.mts';
import type { GrowthCampaigns } from './growth-campaigns.mts';
import {LoyaltyIncentives,assertLoyaltyIncentiveOwner} from './loyalty-incentives.mts';

export interface CurrentCartReader {readonly kernel?:CommerceKernel;readonly k?:CommerceKernel;readCart(scope:Scope,cartId:string):Row;}
export class CartRecovery {
  readonly k:CommerceKernel;readonly carts:CurrentCartReader;readonly campaigns:GrowthCampaigns;
  #incentives:LoyaltyIncentives|null=null;
  constructor(k:CommerceKernel,carts:CurrentCartReader,campaigns:GrowthCampaigns){if((carts.kernel??carts.k)!==k||campaigns.k!==k)throw new Error('RECOVERY_CART_BOUNDARY');this.k=k;this.carts=carts;this.campaigns=campaigns;}
  attachIncentives(value:LoyaltyIncentives){const owner=assertLoyaltyIncentiveOwner(this.k,value);if(owner.recovery!==this||owner.carts!==this.carts||owner.campaigns!==this.campaigns||this.#incentives&&this.#incentives!==owner)throw new Error('LOYALTY_SOURCE_OWNER_MISMATCH');this.#incentives=owner;}
  #eligible(cart:Row,after:number){
    if(cart.status==='purchased')throw new Error('RECOVERY_PURCHASED');
    if(cart.status!=='active'||cart.committed!==true)throw new Error('RECOVERY_CART_UNCOMMITTED');
    if(!Number.isSafeInteger(cart.updated_at)||cart.updated_at>this.k.clock()||this.k.clock()-cart.updated_at<after)throw new Error('RECOVERY_NOT_ABANDONED');
  }
  propose(scope:Scope,input:unknown){
    const p=exact(jsonValue(input),['cart_id','campaign_id']);id(p.cart_id);id(p.campaign_id);
    return this.k.transaction(()=>{
      const s=this.k.authorize(scope,'action.propose'),campaign=this.campaigns.read(scope,p.campaign_id),cart=this.carts.readCart(scope,p.cart_id);assertRecoveryEgress(this.k);
      this.k.authorize(scope,'action.propose',cart.resource_id);
      if(campaign.body.recovery_after_ms===null)throw new Error('RECOVERY_NOT_CONFIGURED');
      this.#eligible(cart,campaign.body.recovery_after_ms);
      const recipient=this.k.db.prepare('SELECT * FROM commerce_growth_campaign_recipients WHERE tenant_id=? AND store_id=? AND campaign_id=? AND resource_id=?').get(s.tenant_id,s.store_id,p.campaign_id,cart.resource_id) as Row;
      const value=growthBody(recipient),{c}=supportCase(this.k,scope,value.case_id);
      if(cart.subject_id!==c.customer_id||cart.resource_id!==c.resource_id)throw new Error('RECOVERY_CART_SCOPE');
      const ref='recovery_'+contentDigest([s.tenant_id,s.store_id,p.cart_id]).slice(0,40),old=this.k.db.prepare('SELECT * FROM commerce_cart_recoveries WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,ref) as Row;
      if(old){const b=growthBody(old);if(b.campaign_id!==p.campaign_id||b.campaign_digest!==campaign.digest)throw new Error('RECOVERY_ALREADY_PROPOSED');return this.inspect(scope,ref);}
      const body={id:ref,cart_id:p.cart_id,campaign_id:p.campaign_id,campaign_digest:campaign.digest,case_id:c.id,resource_id:c.resource_id,customer_id:c.customer_id,cart_revision:cart.revision,proposed_at:this.k.clock(),state:'proposed',service:'automated_recovery_proposal',human_staffed_service:false,discount_applied:false};
      this.k.db.prepare('INSERT INTO commerce_cart_recoveries VALUES(?,?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,ref,p.campaign_id,c.resource_id,c.customer_id,p.cart_id,canonical(body),contentDigest(body));return this.inspect(scope,ref);
    });
  }
  inspect(scope:Scope,recoveryId:string){const s=this.k.require(scope),row=this.k.db.prepare('SELECT * FROM commerce_cart_recoveries WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(recoveryId)) as Row,b=growthBody(row);this.k.get(scope,row.resource_id);return {...b,digest:row.digest,execution_authorized:false,attribution_is_not_incrementality:true};}
  final(scope:Scope,campaignId:string,caseId:string){
    const {s,c}=supportCase(this.k,scope,caseId),campaign=this.campaigns.read(scope,campaignId),row=this.k.db.prepare('SELECT * FROM commerce_cart_recoveries WHERE tenant_id=? AND store_id=? AND campaign_id=? AND resource_id=?').get(s.tenant_id,s.store_id,campaignId,c.resource_id) as Row,b=growthBody(row);
    if(b.state!=='proposed'||b.campaign_digest!==campaign.digest)throw new Error('RECOVERY_PROPOSAL_CHANGED');
    const cart=this.carts.readCart(scope,b.cart_id);
    if(cart.resource_id!==c.resource_id||cart.subject_id!==c.customer_id)throw new Error('RECOVERY_CART_SCOPE');
    this.#eligible(cart,campaign.body.recovery_after_ms);
    if(Object.hasOwn(b,'loyalty_incentive')){if(!this.#incentives)throw new Error('LOYALTY_INCENTIVES_NOT_CONFIGURED');this.#incentives.final(scope,b.id);}
    return {id:b.id,digest:row.digest,cart_id:b.cart_id,purchase_observed:false,discount_applied:false};
  }
}
