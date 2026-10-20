import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {supportFixture} from './support-helpers.mts';
import {LoyaltyFixtureSource} from '../../packages/adapters/loyalty-fixture-source.mts';
import {LoyaltyBalances} from '../../packages/commerce/loyalty-balances.mts';
import {canonical,contentDigest} from '../../packages/commerce/configuration-values.mts';

export type Value=Record<string,any>;
export const CONTEXT_FIELDS=['schema_version','case_id','resource_id','ownership_generation','status','reason','snapshot','snapshot_digest','model_required','execution_authorized','production_qualified','context_digest'].sort();
export const QUOTE_FIELDS=['schema_version','case_id','resource_id','points','unit','eligible','reason','terms','snapshot_digest','execution_authorized','enrollment_authorized','send_authorized','monetary_conversion_supported','production_qualified','quote_digest'].sort();
export const FULL_CAPABILITIES={read:true,accrue:true,reserve:true,redeem:true,reverse:true,lookup:true};
export const LIMITED_CAPABILITIES={read:true,accrue:true,reserve:false,redeem:true,reverse:false,lookup:true};

// Independent finite source facts: 1000 earned - 150 reserved - 200 redeemed
// - 50 reversed = 600 available. The 900 pending points are not spendable.
export function snapshot(f:any,overrides:Value={}) {
  return {customer_id:'C-1001',source_revision:1,observed_at:f.now(),expires_at:f.now()+300000,complete:true,
    balances:{unit:'points',pending:900,earned:1000,reserved:150,redeemed:200,reversed:50,available:600},
    rules:{revision:1,unit:'points',minimum_redemption:100,maximum_redemption:800,redemption_step:50,expires_at:f.now()+600000},...overrides};
}
export function loyaltyFixture() {
  const f=supportFixture(),sources:DatabaseSync[]=[];
  try {
    const makeSource=(provider:'full'|'limited'='full',account='loyalty_account',store=f.a)=>{
      const filename=join(f.directory,'loyalty_'+sources.length+'.sqlite'),db=new DatabaseSync(filename);sources.push(db);
      const config={tenant_id:store.tenant,store_id:store.store,account_id:account,provider};
      const source=new LoyaltyFixtureSource(db,config,f.now);
      return {db,config,source,filename};
    };
    const full=makeSource(),limited=makeSource('limited','limited_account');
    full.source.publish(snapshot(f));limited.source.publish(snapshot(f));
    const loyalty=new LoyaltyBalances(f.kernel,full.source),limitedLoyalty=new LoyaltyBalances(f.kernel,limited.source);
    return {...f,full,limited,loyalty,limitedLoyalty,makeSource,
      cleanup:()=>{for(const db of sources)db.close();f.cleanup();}};
  }catch(error){for(const db of sources)db.close();f.cleanup();throw error;}
}
export async function usingLoyalty(fn:(f:ReturnType<typeof loyaltyFixture>)=>unknown) {
  const f=loyaltyFixture();try{return await fn(f);}finally{f.cleanup();}
}
export function contextInput(f:any,overrides:Value={}) {
  return {case_id:'case_one',link_id:f.link.id,expected_generation:1,...overrides};
}
export const inspect=(f:any,overrides:Value={},scope=f.a.scope,proof=f.customer)=>f.loyalty.context(scope,proof,contextInput(f,overrides));
export function quoteInput(f:any,overrides:Value={},view=inspect(f)) {
  return {...contextInput(f),points:200,unit:'points',snapshot_digest:view.snapshot_digest,...overrides};
}
export const quote=(f:any,overrides:Value={},scope=f.a.scope,proof=f.customer)=>f.loyalty.quote(scope,proof,quoteInput(f,overrides));

export function sourceRows(db:DatabaseSync) {
  return db.prepare('SELECT * FROM fixture_loyalty_snapshots ORDER BY customer_id,source_revision').all() as Value[];
}
export function replaceSource(db:DatabaseSync,row:Value,change:(body:Value)=>void,rehash=true) {
  const body=JSON.parse(row.body);change(body);
  db.prepare('UPDATE fixture_loyalty_snapshots SET body=?,digest=? WHERE customer_id=? AND source_revision=?')
    .run(canonical(body),rehash?contentDigest(body):row.digest,row.customer_id,row.source_revision);
}
export function restoreSource(db:DatabaseSync,row:Value) {
  db.prepare('UPDATE fixture_loyalty_snapshots SET body=?,digest=? WHERE customer_id=? AND source_revision=?')
    .run(row.body,row.digest,row.customer_id,row.source_revision);
}
export function effects(f:any) {
  const tables=['commerce_action_previews','commerce_action_approvals','commerce_operations','commerce_resolution_operations',
    'commerce_fulfillment_operations','commerce_shopping_carts','commerce_cart_recoveries','commerce_support_deliveries'];
  return Object.fromEntries(tables.map(table=>[table,f.db.prepare('SELECT count(*) n FROM '+table).get().n]));
}
export function coreState(db:DatabaseSync) {
  const tables=(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Value[]).map(row=>row.name);
  return {tables,rows:Object.fromEntries(tables.filter(name=>name!=='commerce_sessions').map(name=>[name,
    db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all().map(row=>JSON.stringify(row)).sort()]))};
}
