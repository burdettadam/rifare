import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { commerceFixture } from './commerce-helpers.mts';
import { CarrierQuotes } from '../../packages/commerce/carrier-quotes.mts';
import { CarrierQuoteFixtureSource } from '../../packages/adapters/carrier-quote-fixture-source.mts';
import { contentDigest } from '../../packages/commerce/configuration-values.mts';
import { Permissions } from '../../packages/commerce/authorization.mts';
import type { Row } from '../../packages/commerce/kernel.mts';

function usingQuotes<T>(run:(f:ReturnType<typeof quoteFixture>)=>T):T {
  const f=quoteFixture();try{return run(f);}finally{f.cleanup();}
}
function quoteFixture() {
  const f=commerceFixture(),first=f.seed(f.a.scope,'alpha','ORDER-A'),second=f.seed(f.a.scope,'beta','ORDER-B');
  const source=new CarrierQuoteFixtureSource({tenant_id:f.a.tenant,store_id:f.a.store},f.now);
  for(const [account_id,carrier_id] of [['account-ground','carrier-ground'],['account-express','carrier-express']])
    source.setAccount({account_id,carrier_id,revision:1,enabled:true,currencies:['USD','JPY'],services:['ground','express']});
  const parcel=(package_id:string,resource_id:string,weight_g:number)=>({package_id,resource_id,revision:1,address_revision:1,
    from_address_ref:'warehouse-a',to_address_ref:'destination-'+package_id,from_country:'US',to_country:'US',
    weight_g,length_mm:200,width_mm:100,height_mm:50});
  source.setPackage(parcel('package-a',first.id,400));source.setPackage(parcel('package-b',second.id,900));
  source.setRate({package_id:'package-a',account_id:'account-ground',service:'ground',rate_id:'rate-a',revision:1,amount_minor:'500',currency:'USD',expires_at:f.now()+60000});
  source.setRate({package_id:'package-b',account_id:'account-express',service:'express',rate_id:'rate-b',revision:1,amount_minor:'900',currency:'USD',expires_at:f.now()+120000});
  const rule=(id:string,account_id:string,carrier_id:string,service:string)=>({id,account_id,carrier_id,service,currency:'USD',max_amount_minor:'999999999999999999999999999999999999',
    from_countries:['US'],to_countries:['US'],max_weight_g:1000,max_length_mm:1000,max_width_mm:1000,max_height_mm:1000});
  const policy={id:'carrier-policy',revision:1,tenant_id:f.a.tenant,store_id:f.a.store,source_identity:source.identity,expires_at:f.now()+600000,
    rules:[rule('ground','account-ground','carrier-ground','ground'),rule('express','account-express','carrier-express','express')]};
  const service=new CarrierQuotes(f.kernel,source,policy);
  const input={batch_id:'batch-one',packages:[{package_id:'package-a',resource_id:first.id,rule_id:'ground'},{package_id:'package-b',resource_id:second.id,rule_id:'express'}]};
  return {...f,first,second,source,parcel,rule,policy,service,input,quote:()=>service.quote(f.a.scope,input)};
}
const row=(result:Row,id:string)=>result.packages.find((p:Row)=>p.package_id===id);

test('CASE-M08-G01-01',()=>usingQuotes(f=>{
  const q=f.quote();assert.equal(q.all_eligible,true);
  assert.deepEqual(q.packages.map((p:Row)=>[p.package_id,p.status,p.quote.carrier_id,p.quote.service,p.quote.amount_minor,p.quote.currency]),
    [['package-a','eligible','carrier-ground','ground','500','USD'],['package-b','eligible','carrier-express','express','900','USD']]);
  assert.deepEqual(q.totals,[{currency:'USD',amount_minor:'1400',package_ids:['package-a','package-b']}]);
  assert.equal(row(q,'package-a').quote.expires_at,f.now()+60000);assert.equal(row(q,'package-b').quote.expires_at,f.now()+120000);
  assert.equal(row(q,'package-a').quote.package_revision,1);assert.equal(row(q,'package-a').quote.address_revision,1);
  assert.equal(q.execution_authorized,false);assert.equal(q.financial_effect,false);assert.equal(q.qualification,'synthetic_only');
}));
test('CASE-M08-G01-02',()=>usingQuotes(f=>{
  const foreign=f.seed(f.b.scope,'alpha','FOREIGN');
  f.source.setPackage(f.parcel('oversized',f.second.id,1001));
  const q=f.service.quote(f.a.scope,{batch_id:'mixed-eligibility',packages:[f.input.packages[0],
    {package_id:'oversized',resource_id:f.second.id,rule_id:'ground'},
    {package_id:'package-b',resource_id:f.second.id,rule_id:'other-tenant-account'},
    {package_id:'foreign',resource_id:foreign.id,rule_id:'ground'}]});
  assert.equal(q.all_eligible,false);assert.equal(row(q,'package-a').status,'eligible');
  assert.deepEqual(row(q,'oversized').reasons,['PACKAGE_UNSUPPORTED']);
  assert.deepEqual(row(q,'package-b').reasons,['SERVICE_NOT_PERMITTED']);
  assert.deepEqual(row(q,'foreign').reasons,['RESOURCE_UNAVAILABLE']);
  assert.deepEqual(q.totals,[{currency:'USD',amount_minor:'500',package_ids:['package-a']}]);
  for(const p of q.packages.filter((p:Row)=>p.status==='blocked'))assert.equal(p.quote,null);
}));
test('CASE-M08-G01-03',async()=>{
  const f=quoteFixture(),temporary=mkdtempSync(join(tmpdir(),'rifare-carrier-mutant-'));
  try{
  const q=f.quote(),unchanged=contentDigest(row(q,'package-b').quote);
  f.source.setRate({package_id:'package-a',account_id:'account-ground',service:'ground',rate_id:'rate-a',revision:2,amount_minor:'650',currency:'USD',expires_at:f.now()+60000});
  const checked=f.service.revalidate(f.a.scope,q);
  assert.deepEqual(row(checked,'package-a').reasons,['RATE_CHANGED']);assert.equal(row(checked,'package-a').status,'stale');
  assert.equal(contentDigest(row(checked,'package-b').quote),unchanged);assert.equal(row(checked,'package-b').status,'eligible');
  assert.deepEqual(checked.totals,[{currency:'USD',amount_minor:'900',package_ids:['package-b']}]);
  const fresh=f.quote();assert.deepEqual(fresh.totals,[{currency:'USD',amount_minor:'1550',package_ids:['package-a','package-b']}]);
  const packageOracle=(value:Row)=>assert.deepEqual(value.packages.map((p:Row)=>[p.quote.service,p.quote.amount_minor]),[['ground','650'],['express','900']]);
  packageOracle(fresh);
  // Execute the named fault in an isolated source copy before totals and HMAC sealing.
  const sourceURL=new URL('../../packages/commerce/carrier-quotes.mts',import.meta.url);
  const source=readFileSync(sourceURL,'utf8');
  const marker='  #seal(batchId:string,createdAt:number,checkedAt:number,packages:Row[]):Row {';
  assert.equal(source.split(marker).length,2);
  const injected=marker+"\n    const first=packages.find(p=>p.status==='eligible');\n    if(first)packages=packages.map(p=>p.status==='eligible'?{...p,quote:{...p.quote,service:first.quote.service,amount_minor:first.quote.amount_minor}}:p);";
  const mutant=source.replace(marker,injected).replace(/from '(\.[^']+)'/g,(_match,path)=>"from '"+new URL(path,sourceURL).href+"'");
  const modulePath=join(temporary,'carrier-quotes.mts');writeFileSync(modulePath,mutant);
  const {CarrierQuotes:BrokenCarrierQuotes}=await import(pathToFileURL(modulePath).href);
  const broken=new BrokenCarrierQuotes(f.kernel,f.source,f.policy).quote(f.a.scope,f.input);
  assert.deepEqual(broken.packages.map((p:Row)=>[p.quote.service,p.quote.amount_minor]),[['ground','650'],['ground','650']]);
  assert.throws(()=>packageOracle(broken),{code:'ERR_ASSERTION'});
  packageOracle(f.quote());
  }finally{f.cleanup();rmSync(temporary,{recursive:true,force:true});}
});
test('M08-G01-ADDRESS-PARCEL-AND-RESOURCE-FENCES',()=>usingQuotes(f=>{
  const q=f.quote();f.source.setPackage({...f.source.package('package-a')!,revision:2,address_revision:2,to_address_ref:'corrected-destination',weight_g:450});
  const checked=f.service.revalidate(f.a.scope,q);assert.deepEqual(row(checked,'package-a').reasons,['PACKAGE_CHANGED']);assert.equal(row(checked,'package-b').status,'eligible');
  assert.deepEqual(row(f.quote(),'package-a').reasons,['RATE_PACKAGE_CHANGED']);
  f.kernel.ingest(f.a.scope,{kind:'order',source_system:'synthetic',external_id:'ORDER-B',source_version:2,source_updated_at:f.now(),customer_id:'C-1001',payload:{label:'beta',total_minor:6400,status:'cancelled'}});
  assert.deepEqual(row(f.service.revalidate(f.a.scope,q),'package-b').reasons,['RESOURCE_CHANGED']);
}));
test('M08-G01-ACCOUNT-AND-SERVICE-POLICY',()=>usingQuotes(f=>{
  const q=f.quote();f.policy.rules[0].max_weight_g=1;assert.equal(row(f.quote(),'package-a').status,'eligible');
  f.source.setAccount({account_id:'account-ground',carrier_id:'carrier-ground',revision:2,enabled:false,currencies:['USD'],services:['ground']});
  const checked=f.service.revalidate(f.a.scope,q);assert.deepEqual(row(checked,'package-a').reasons,['ACCOUNT_UNAVAILABLE']);assert.equal(row(checked,'package-b').status,'eligible');
  const policy=JSON.parse(JSON.stringify(f.policy));policy.rules[1].account_id='foreign-account';
  assert.deepEqual(row(new CarrierQuotes(f.kernel,f.source,policy).quote(f.a.scope,f.input),'package-b').reasons,['ACCOUNT_UNAVAILABLE']);
  policy.rules[1].account_id='account-express';policy.rules[1].to_countries=['CA'];
  assert.deepEqual(row(new CarrierQuotes(f.kernel,f.source,policy).quote(f.a.scope,f.input),'package-b').reasons,['DESTINATION_NOT_PERMITTED']);
}));
test('M08-G01-EXPIRY-IS-PACKAGE-SPECIFIC',()=>usingQuotes(f=>{
  const q=f.quote();f.advance(60000);const checked=f.service.revalidate(f.a.scope,q);
  assert.deepEqual(row(checked,'package-a').reasons,['QUOTE_EXPIRED']);assert.equal(row(checked,'package-b').status,'eligible');
  f.advance(60000);assert.equal(f.service.revalidate(f.a.scope,q).totals.length,0);
  const policy={...f.policy,expires_at:f.now()};assert.throws(()=>new CarrierQuotes(f.kernel,f.source,policy),/POLICY_EXPIRED/);
}));
test('M08-G01-MIXED-CURRENCIES-STAY-SEPARATE',()=>usingQuotes(f=>{
  f.source.setRate({package_id:'package-b',account_id:'account-express',service:'express',rate_id:'rate-b',revision:2,amount_minor:'725',currency:'JPY',expires_at:f.now()+120000});
  assert.deepEqual(row(f.quote(),'package-b').reasons,['RATE_CURRENCY_NOT_PERMITTED']);
  const policy=JSON.parse(JSON.stringify(f.policy));policy.rules[1].currency='JPY';
  const q=new CarrierQuotes(f.kernel,f.source,policy).quote(f.a.scope,f.input);
  assert.deepEqual(q.totals,[{currency:'JPY',amount_minor:'725',package_ids:['package-b']},{currency:'USD',amount_minor:'500',package_ids:['package-a']}]);
  assert.equal(q.currency_conversion_performed,false);assert.equal(q.combined_total,null);
}));
test('M08-G01-EXACT-LARGE-AMOUNTS-AND-PRICE-LIMIT',()=>usingQuotes(f=>{
  const rate={package_id:'package-a',account_id:'account-ground',service:'ground',rate_id:'rate-a',revision:2,amount_minor:'9007199254740993',currency:'USD',expires_at:f.now()+60000};
  f.source.setRate(rate);assert.equal(f.quote().totals[0].amount_minor,'9007199254741893');
  assert.throws(()=>f.source.setRate({...rate,revision:3,amount_minor:'1,50'}),/INVALID_MINOR_UNITS/);
  assert.throws(()=>f.source.setRate({...rate,revision:3,currency:'ABC'}),/UNSUPPORTED_CURRENCY/);
  assert.throws(()=>f.source.setRate({...rate,revision:3,amount_minor:'-1'}),/INVALID_MINOR_UNITS/);
  const policy=JSON.parse(JSON.stringify(f.policy));policy.rules[0].max_amount_minor='500';
  assert.deepEqual(row(new CarrierQuotes(f.kernel,f.source,policy).quote(f.a.scope,f.input),'package-a').reasons,['RATE_EXCEEDS_POLICY']);
}));
test('M08-G01-SNAPSHOT-TAMPER-CANNOT-CHANGE-PRICE-OR-MEMBERSHIP',()=>usingQuotes(f=>{
  const q=f.quote();assert.equal(f.service.revalidate(f.a.scope,JSON.parse(JSON.stringify(q))).all_eligible,true);
  for(const change of [(v:Row)=>{v.packages[0].quote.amount_minor='0';},(v:Row)=>{v.packages.pop();},(v:Row)=>{v.totals[0].amount_minor='0';},(v:Row)=>{v.execution_authorized=true;}]){
    const altered=JSON.parse(JSON.stringify(q));change(altered);assert.throws(()=>f.service.revalidate(f.a.scope,altered),/SNAPSHOT_INTEGRITY/);
    altered.integrity=contentDigest(altered);assert.throws(()=>f.service.revalidate(f.a.scope,altered),/SNAPSHOT_INTEGRITY/);
  }
}));
test('M08-G01-RESTART-REVOCATION-AND-SCOPE',()=>usingQuotes(f=>{
  const q=f.quote();assert.throws(()=>new CarrierQuotes(f.kernel,f.source,f.policy).revalidate(f.a.scope,q),/SNAPSHOT_INTEGRITY/);
  assert.throws(()=>f.service.revalidate(f.b.scope,q),/SOURCE_SCOPE_MISMATCH/);
  assert.throws(()=>f.service.quote(f.c.scope,f.input),/SOURCE_SCOPE_MISMATCH/);
  assert.throws(()=>f.service.quote({},f.input),/ACCESS_DENIED/);
  f.kernel.provisionMember(f.a.tenant,f.a.store,'owner','owner');
  const owner=f.kernel.authenticate(f.kernel.issueSession(f.a.tenant,f.a.store,'owner'));
  new Permissions(f.kernel).change(owner,{actor_id:'operator',role:'operator',expected_revision:0,actions:null,resource_ids:[f.first.id]});
  const limited=f.quote();assert.equal(row(limited,'package-a').status,'eligible');assert.deepEqual(row(limited,'package-b').reasons,['RESOURCE_UNAVAILABLE']);
  f.kernel.revoke(f.a.scope);assert.throws(()=>f.service.revalidate(f.a.scope,q),/ACCESS_DENIED/);
}));
test('M08-G01-READ-ONLY-PREPARATION-HAS-NO-LABEL-EFFECT',()=>usingQuotes(f=>{
  const tables=()=>f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  const effects=()=>['commerce_operations','commerce_fulfillment_operations','commerce_return_labels'].map(name=>f.db.prepare('SELECT COUNT(*) n FROM '+name).get()!.n);
  const before={tables:tables(),effects:effects()};const q=f.quote();const again=f.service.revalidate(f.a.scope,q);
  assert.deepEqual(tables(),before.tables);assert.deepEqual(effects(),before.effects);assert.equal(again.financial_effect,false);
  assert.equal(again.execution_authorized,false);assert.equal(again.carrier_connected,false);assert.equal(again.label_purchase_supported,false);
  assert.equal('buy' in f.source,false);assert.equal('dispatch' in f.service,false);assert.equal('private_key' in q,false);
}));
test('M08-G01-DUPLICATE-PACKAGE-AND-EXTRA-FIELDS-REJECTED',()=>usingQuotes(f=>{
  assert.throws(()=>f.service.quote(f.a.scope,{...f.input,packages:[f.input.packages[0],f.input.packages[0]]}),/DUPLICATE_PACKAGE/);
  assert.throws(()=>f.service.quote(f.a.scope,{...f.input,amount_minor:'1'}),/INVALID_INPUT/);
  assert.throws(()=>f.service.quote(f.a.scope,{...f.input,packages:[{...f.input.packages[0],amount_minor:'1'}]}),/INVALID_INPUT/);
  assert.throws(()=>f.service.quote(f.a.scope,{...f.input,packages:[]}),/INVALID_BATCH/);
  assert.throws(()=>f.source.setPackage({...f.source.package('package-a')!,revision:2,weight_g:0}),/INVALID_INPUT/);
  assert.throws(()=>f.source.setPackage({...f.source.package('package-a')!,to_address_ref:'changed-without-revision'}),/SOURCE_VERSION_CONFLICT/);
}));
test('M08-G01-SOURCE-PINS-ARE-RECHECKED',()=>usingQuotes(f=>{
  const rate=f.source.rate.bind(f.source);f.source.rate=(packageId,accountId,service)=>{
    const result=rate(packageId,accountId,service);return result&&packageId==='package-a'?{...result,tenant_id:'tenant-b'}:result;
  };
  const q=f.quote();assert.deepEqual(row(q,'package-a').reasons,['RATE_SOURCE_MISMATCH']);assert.equal(row(q,'package-b').status,'eligible');
  assert.throws(()=>new CarrierQuotes(f.kernel,f.source,{...f.policy,source_identity:'different-source'}),/SOURCE_SCOPE_MISMATCH/);
}));
test('M08-G01-CLI-CONTRACT',()=>{
  const script=new URL('../../tools/demo-carrier-quotes.mts',import.meta.url).pathname;
  const describe=JSON.parse(execFileSync(process.execPath,['--experimental-strip-types',script,'--describe'],{encoding:'utf8',timeout:10000}));
  assert.equal(describe.goal_id,'M08-G01');assert.equal(describe.carrier_connected,false);assert.equal(describe.label_purchase_supported,false);
  const demo=JSON.parse(execFileSync(process.execPath,['--experimental-strip-types',script,'--run-local'],{encoding:'utf8',timeout:10000}));
  assert.deepEqual(demo.initial.totals,[{currency:'USD',amount_minor:'1400',package_ids:['package-a','package-b']}]);
  assert.equal(demo.revalidated.packages[0].status,'stale');assert.equal(demo.revalidated.packages[1].status,'eligible');assert.equal(demo.financial_effect,false);
});
