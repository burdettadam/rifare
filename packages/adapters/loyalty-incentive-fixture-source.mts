import type {DatabaseSync} from 'node:sqlite';
import {exact,id,integer} from '../commerce/kernel.mts';
import type {Row} from '../commerce/kernel.mts';
import {canonical,contentDigest,jsonValue} from '../commerce/configuration-values.mts';
import {loyaltyBinding} from '../commerce/loyalty-values.mts';
import {redemptionBinding} from '../commerce/loyalty-redemption-values.mts';
import {MarketingFixtureSource} from './marketing-fixture-source.mts';
import {ShoppingCatalogFixtureSource} from './shopping-catalog-fixture-source.mts';
import {OrderEditFixtureSource} from './order-edit-fixture-source.mts';
import {LoyaltyRedemptionFixtureSource} from './loyalty-redemption-fixture-source.mts';
import {assertSeparateLoyaltyDatabases} from './loyalty-fixture-source.mts';

type Sources={marketing:MarketingFixtureSource;shopping:ShoppingCatalogFixtureSource;redemption:LoyaltyRedemptionFixtureSource};
const CONTRACT='rifare-loyalty-incentive-fixture-v1';
function combinations(value:unknown) {
  if(!Array.isArray(value)||!value.length||value.length>100)throw new Error('LOYALTY_APPLICABILITY_INVALID');
  const seen=new Set<string>();
  return value.map(raw=>{
    const p=exact(jsonValue(raw),['benefit_id','offer_id','eligible_variant_ids']);id(p.benefit_id);id(p.offer_id);
    const key=canonical([p.benefit_id,p.offer_id]);
    if(seen.has(key)||!Array.isArray(p.eligible_variant_ids)||!p.eligible_variant_ids.length||p.eligible_variant_ids.length>30||new Set(p.eligible_variant_ids).size!==p.eligible_variant_ids.length)throw new Error('LOYALTY_APPLICABILITY_INVALID');
    p.eligible_variant_ids.forEach(id);seen.add(key);return p;
  });
}

/** Customer-free applicability declarations. Native owners retain all terms and effects. */
export class LoyaltyIncentiveFixtureSource {
  readonly marketing:MarketingFixtureSource;readonly shopping:ShoppingCatalogFixtureSource;readonly redemption:LoyaltyRedemptionFixtureSource;
  readonly db:DatabaseSync;readonly tenant:string;readonly store:string;readonly account:string;readonly identity:string;readonly contract=CONTRACT;
  #refs:Row;#binding:Row;#shoppingIdentity:string;
  constructor(owners:Sources) {
    exact(owners,['marketing','shopping','redemption']);const {marketing,shopping,redemption}=owners;
    if(!(marketing instanceof MarketingFixtureSource)||!(shopping instanceof ShoppingCatalogFixtureSource)||!(shopping.source instanceof OrderEditFixtureSource)||!(redemption instanceof LoyaltyRedemptionFixtureSource))throw new Error('LOYALTY_SOURCE_OWNER_MISMATCH');
    this.marketing=marketing;this.shopping=shopping;this.redemption=redemption;this.db=marketing.db;this.tenant=marketing.tenant;this.store=marketing.store;this.account=marketing.account;
    this.#refs=Object.freeze({marketing_db:marketing.db,shopping_db:shopping.db,loyalty_db:redemption.db,edit:shopping.source,marketing_clock:marketing.clock,shopping_clock:shopping.clock});
    const binding={tenant_id:this.tenant,store_id:this.store,account_id:this.account,marketing_source_identity:marketing.identity,shopping_source_identity:shopping.identity,redemption_source_identity:redemption.identity,loyalty_account_id:redemption.account,balance_source_identity:redemption.balanceSource.identity};
    this.identity=contentDigest({contract:CONTRACT,...binding});this.#binding=Object.freeze({...binding,source_identity:this.identity});
    this.#shoppingIdentity=this.#durableShopping();this.#assertSources();
    this.db.exec('CREATE TABLE IF NOT EXISTS fixture_loyalty_incentive_configuration(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL,digest TEXT NOT NULL) STRICT');
    if(this.db.prepare('SELECT 1 FROM fixture_loyalty_incentive_configuration LIMIT 1').get())this.observe();Object.freeze(this);
  }
  #hashedIdentity(db:DatabaseSync,table:string,expected:Row) {
    const rows=db.prepare('SELECT * FROM '+table+' LIMIT 2').all() as Row[];
    if(rows.length!==1||rows[0].id!==1)throw new Error('LOYALTY_SOURCE_SCOPE_MISMATCH');
    exact(rows[0],['id','body','digest']);const body=jsonValue(JSON.parse(rows[0].body));
    if(canonical(body)!==canonical(expected)||contentDigest(body)!==rows[0].digest)throw new Error('LOYALTY_SOURCE_SCOPE_MISMATCH');
  }
  #durableShopping() {
    const rows=this.shopping.db.prepare('SELECT * FROM edit_source_identity LIMIT 2').all() as Row[];
    if(rows.length!==1)throw new Error('LOYALTY_SOURCE_SCOPE_MISMATCH');
    const row=exact(rows[0],['singleton','label','identity','tenant','store','revision']);id(row.label);integer(row.revision,1);
    if(row.singleton!==1||row.identity!==this.shopping.identity||row.tenant!==this.tenant||row.store!==this.store)throw new Error('LOYALTY_SOURCE_SCOPE_MISMATCH');
    const {revision,...stable}=row;return canonical(stable);
  }
  #assertSources() {
    const m=this.marketing,s=this.shopping,r=this.redemption,refs=this.#refs,b=this.#binding;
    if(m.db!==refs.marketing_db||s.db!==refs.shopping_db||r.db!==refs.loyalty_db||s.source!==refs.edit||s.source.db!==s.db||s.source.identity!==s.identity||s.source.clock!==refs.shopping_clock||m.clock!==refs.marketing_clock||s.clock!==refs.shopping_clock||r.balanceSource.db!==r.db)throw new Error('LOYALTY_SOURCE_OWNER_MISMATCH');
    for(const source of [m,s,s.source,r,r.balanceSource])if(source.tenant!==this.tenant||source.store!==this.store)throw new Error('LOYALTY_SOURCE_SCOPE_MISMATCH');
    if(m.account!==this.account||m.identity!==b.marketing_source_identity||s.identity!==b.shopping_source_identity||r.identity!==b.redemption_source_identity||r.account!==b.loyalty_account_id||r.balanceSource.identity!==b.balance_source_identity)throw new Error('LOYALTY_SOURCE_SCOPE_MISMATCH');
    // The native helper checks that its second argument is a fixture database.
    // Check both directions so no source can add configuration to a core DB.
    const databases=[m.db,s.db,r.db];for(let i=0;i<databases.length;i++)for(let j=i+1;j<databases.length;j++){assertSeparateLoyaltyDatabases(databases[i],databases[j]);assertSeparateLoyaltyDatabases(databases[j],databases[i]);}
    this.#hashedIdentity(m.db,'marketing_source_identity',{tenant:this.tenant,store:this.store,account:this.account,identity:m.identity});
    if(this.#durableShopping()!==this.#shoppingIdentity)throw new Error('LOYALTY_SOURCE_SCOPE_MISMATCH');
    const parent=loyaltyBinding({tenant_id:this.tenant,store_id:this.store,account_id:r.account,provider:r.balanceSource.provider});
    this.#hashedIdentity(r.db,'fixture_loyalty_identity',parent);this.#hashedIdentity(r.db,'fixture_loyalty_redemption_identity',redemptionBinding(parent));
  }
  observe() {
    this.#assertSources();const rows=this.db.prepare('SELECT * FROM fixture_loyalty_incentive_configuration LIMIT 2').all() as Row[];
    if(rows.length!==1||rows[0].id!==1)throw new Error('LOYALTY_APPLICABILITY_UNAVAILABLE');
    exact(rows[0],['id','body','digest']);const body=exact(jsonValue(JSON.parse(rows[0].body)),['schema_version',...Object.keys(this.#binding),'revision','expires_at','combinations']);
    if(body.schema_version!==1||contentDigest(body)!==rows[0].digest||Object.keys(this.#binding).some(key=>body[key]!==this.#binding[key]))throw new Error('LOYALTY_SOURCE_SCOPE_MISMATCH');
    integer(body.revision,1);integer(body.expires_at,1);combinations(body.combinations);return {...body,digest:rows[0].digest};
  }
  configure(value:unknown) {
    const p=exact(jsonValue(value),['revision','expires_at','combinations']);integer(p.revision,1);integer(p.expires_at,1);const pairs=combinations(p.combinations);
    this.#assertSources();this.db.exec('BEGIN IMMEDIATE');
    try {
      this.#assertSources();if(p.expires_at<=integer(this.marketing.clock()))throw new Error('LOYALTY_APPLICABILITY_EXPIRED');
      if(this.db.prepare('SELECT 1 FROM fixture_loyalty_incentive_configuration LIMIT 1').get()&&this.observe().revision>=p.revision)throw new Error('LOYALTY_APPLICABILITY_REVISION');
      const body={schema_version:1,...this.#binding,revision:p.revision,expires_at:p.expires_at,combinations:pairs};
      this.db.prepare('INSERT INTO fixture_loyalty_incentive_configuration VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,digest=excluded.digest').run(canonical(body),contentDigest(body));
      const result=this.observe();this.db.exec('COMMIT');return result;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
}
