import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {linkSync} from 'node:fs';
import {LoyaltyBalances} from '../../packages/commerce/loyalty-balances.mts';
import {LoyaltyFixtureSource} from '../../packages/adapters/loyalty-fixture-source.mts';
import {SupportService} from '../../packages/commerce/support-service.mts';
import {PrivacyLifecycle} from '../../packages/commerce/privacy-lifecycle.mts';
import {CommerceKernel} from '../../packages/commerce/kernel.mts';
import {CustomerAccess} from '../../packages/commerce/customer-access.mts';
import {ExecutionStops} from '../../packages/commerce/execution-stops.mts';
import {createRecoverySnapshot,restoreRecoverySnapshot,suppressionCheckpoint} from '../../packages/commerce/safe-recovery.mts';
import {contentDigest} from '../../packages/commerce/configuration-values.mts';
import {verifiedCustomer,updateResource} from './shopper-memory-helpers.mts';
import {usingLoyalty,snapshot,contextInput,inspect,quoteInput,quote,sourceRows,replaceSource,restoreSource,effects,coreState,
  CONTEXT_FIELDS,QUOTE_FIELDS,FULL_CAPABILITIES,LIMITED_CAPABILITIES} from './loyalty-balances-helpers.mts';
import type {Value} from './loyalty-balances-helpers.mts';

// ADR-0058 independent tests-first freeze: exactly 20 native cases, no nested tests.
function unavailable(view:Value,status:string,reason?:string) {
  assert.equal(view.status,status);if(reason!==undefined)assert.equal(view.reason,reason);
  assert.equal(view.snapshot,null);assert.equal(view.snapshot_digest,null);
  assert.equal(view.execution_authorized,false);assert.equal(view.production_qualified,false);
}
function deniedQuote(value:Value,reason:string) {
  assert.equal(value.eligible,false);assert.equal(value.reason,reason);assert.equal(value.terms,null);
  assert.equal(value.execution_authorized,false);assert.equal(value.enrollment_authorized,false);assert.equal(value.send_authorized,false);
}

test('CASE-M19-G01-01',()=>usingLoyalty(f=>{
  const before=effects(f),view=inspect(f);
  assert.deepEqual(Object.keys(view).sort(),CONTEXT_FIELDS);assert.equal(view.schema_version,1);
  assert.equal(view.case_id,'case_one');assert.equal(view.resource_id,f.order().id);assert.equal(view.ownership_generation,1);
  assert.equal(view.status,'available');assert.equal(view.reason,'LOYALTY_CURRENT_SOURCE');
  assert.equal(view.model_required,false);assert.equal(view.execution_authorized,false);assert.equal(view.production_qualified,false);
  const s=view.snapshot;assert.equal(s.tenant_id,'tenant-a');assert.equal(s.store_id,'store-a');assert.equal(s.account_id,'loyalty_account');
  assert.equal(s.customer_id,'C-1001');assert.equal(s.source_revision,1);assert.equal(s.observed_at,f.now());assert.equal(s.expires_at,f.now()+300000);
  assert.equal(s.source_identity,f.full.source.identity);assert.equal(s.source_contract,'rifare-loyalty-fixture-v1');assert.equal(s.qualification,'synthetic_only');
  assert.deepEqual(s.balances,{unit:'points',pending:900,earned:1000,reserved:150,redeemed:200,reversed:50,available:600});
  assert.deepEqual(s.capabilities,FULL_CAPABILITIES);assert.equal(s.rules.revision,1);assert.equal(s.rules.unit,'points');
  const q=quote(f);assert.deepEqual(Object.keys(q).sort(),QUOTE_FIELDS);assert.equal(q.eligible,true);assert.equal(q.reason,'LOYALTY_QUOTE_ELIGIBLE');
  assert.deepEqual(q.terms,{account_id:'loyalty_account',source_identity:f.full.source.identity,source_revision:1,rules_revision:1,points:200,unit:'points',expires_at:f.now()+300000});
  assert.equal(q.snapshot_digest,view.snapshot_digest);assert.match(q.quote_digest,/^[a-f0-9]{64}$/);assert.match(view.context_digest,/^[a-f0-9]{64}$/);
  assert.equal(q.execution_authorized,false);assert.equal(q.enrollment_authorized,false);assert.equal(q.send_authorized,false);
  assert.equal(q.monetary_conversion_supported,false);assert.equal(q.production_qualified,false);
  assert.deepEqual(inspect(f,{},f.customer),view);assert.deepEqual(effects(f),before);
}));

test('CASE-M19-G01-02',()=>usingLoyalty(f=>{
  const before=effects(f),input=quoteInput(f);
  for(const unit of ['USD','money','store_credit'])assert.throws(()=>f.loyalty.quote(f.a.scope,f.customer,{...input,unit}),/LOYALTY_UNIT_UNSUPPORTED/);
  for(const extra of [{amount_minor:200},{conversion_rate:1},{currency:'USD'},{store_credit:200}])assert.throws(()=>f.loyalty.quote(f.a.scope,f.customer,{...input,...extra}));
  for(const balances of [
    {unit:'USD',pending:900,earned:1000,reserved:150,redeemed:200,reversed:50,available:600},
    {unit:'points',pending:900,earned:1000,reserved:150,redeemed:200,reversed:50,available:1500},
    {unit:'points',pending:0,earned:Number.MAX_SAFE_INTEGER,reserved:Number.MAX_SAFE_INTEGER,redeemed:1,reversed:0,available:0},
    {unit:'points',pending:0,earned:10.5,reserved:0,redeemed:0,reversed:0,available:10.5},
  ])assert.throws(()=>f.full.source.publish(snapshot(f,{source_revision:2,balances})));
  assert.equal(inspect(f).snapshot.balances.available,600);assert.deepEqual(effects(f),before);
}));

test('CASE-M19-G01-03',()=>usingLoyalty(f=>{
  const full=quote(f),limited=f.limitedLoyalty.context(f.a.scope,f.customer,contextInput(f));
  assert.equal(limited.status,'available');assert.deepEqual(limited.snapshot.capabilities,LIMITED_CAPABILITIES);
  assert.equal(limited.snapshot.capabilities.reserve,false);assert.equal(limited.snapshot.capabilities.reverse,false);
  assert.equal(full.eligible,true);
  deniedQuote(f.limitedLoyalty.quote(f.a.scope,f.customer,quoteInput(f,{},limited)),'LOYALTY_RESERVATION_UNSUPPORTED');
  assert.equal(f.limited.source.observe('C-1001')!.balances.available,600);
  for(const source of [f.full.source,f.limited.source])for(const method of ['accrue','reserve','redeem','reverse'])
    assert.equal(typeof (source as any)[method],'undefined','capabilities do not install effect methods');
  assert.equal(Object.values(effects(f)).every(n=>n===0),true,'neither provider acquired a financial or delivery operation');
}));

test('M19-G01-STALE-OBSERVATION',()=>usingLoyalty(f=>{
  const original=inspect(f),input=quoteInput(f,{},original);f.advance(300001);
  const stale=inspect(f);unavailable(stale,'stale','LOYALTY_SOURCE_STALE');
  deniedQuote(f.loyalty.quote(f.a.scope,f.customer,input),stale.reason);
  assert.equal(f.full.source.observe('C-1001')!.observed_at,original.snapshot.observed_at,'reading must not refresh source observation time');
}));

test('M19-G01-FUTURE-AND-EXPIRED',()=>usingLoyalty(f=>{
  const old=quoteInput(f);
  f.full.source.publish(snapshot(f,{source_revision:2,observed_at:f.now()+1,expires_at:f.now()+300001}));
  unavailable(inspect(f),'stale','LOYALTY_SOURCE_FUTURE');deniedQuote(f.loyalty.quote(f.a.scope,f.customer,old),'LOYALTY_SOURCE_FUTURE');
  f.full.source.publish(snapshot(f,{source_revision:3,observed_at:f.now()-100,expires_at:f.now()}));
  unavailable(inspect(f),'stale','LOYALTY_SOURCE_EXPIRED');deniedQuote(f.loyalty.quote(f.a.scope,f.customer,old),'LOYALTY_SOURCE_EXPIRED');
}));

test('M19-G01-INCOMPLETE-SOURCE',()=>usingLoyalty(f=>{
  const old=quoteInput(f);f.full.source.publish(snapshot(f,{source_revision:2,complete:false}));
  unavailable(inspect(f),'incomplete','LOYALTY_SNAPSHOT_INCOMPLETE');
  deniedQuote(f.loyalty.quote(f.a.scope,f.customer,old),'LOYALTY_SNAPSHOT_INCOMPLETE');
  assert.equal(f.full.source.observe('C-1001')!.complete,false);
}));

test('M19-G01-STRICT-SNAPSHOT-INTEGRITY',()=>usingLoyalty(f=>{
  const original=sourceRows(f.full.db)[0];
  const mutations=[(b:Value)=>{b.balances.available=601;},(b:Value)=>{b.balances.pending=-1;},
    (b:Value)=>{b.balances.earned=Number.MAX_SAFE_INTEGER+1;},(b:Value)=>{b.complete='yes';},
    (b:Value)=>{b.schema_version=2;},(b:Value)=>{b.source_revision=2;},
    (b:Value)=>{b.rules.unit='store_credit';},(b:Value)=>{b.rules.redemption_step=0;},
    (b:Value)=>{b.capabilities.reserve=false;},
    (b:Value)=>{b.transcript='untrusted transcript';}];
  for(const change of mutations){replaceSource(f.full.db,original,change);unavailable(inspect(f),'unverified','LOYALTY_SOURCE_INVALID');restoreSource(f.full.db,original);}
  for(const field of ['tenant_id','store_id','account_id','customer_id','source_identity']){
    replaceSource(f.full.db,original,b=>{b[field]='foreign_identity';});
    assert.throws(()=>inspect(f),'source scope mismatches must not become unavailable responses');restoreSource(f.full.db,original);
  }
  replaceSource(f.full.db,original,b=>{b.balances.available=500;},false);
  assert.throws(()=>f.full.source.observe('C-1001'));unavailable(inspect(f),'unverified','LOYALTY_SOURCE_INVALID');
  restoreSource(f.full.db,original);assert.equal(inspect(f).snapshot.balances.available,600);
  const getter=snapshot(f,{source_revision:2});Object.defineProperty(getter,'customer_id',{enumerable:true,get:()=>{throw new Error('GETTER_EXECUTED');}});
  assert.throws(()=>f.full.source.publish(getter),(error:any)=>error.message!=='GETTER_EXECUTED');
}));

test('M19-G01-SOURCE-REVISION-REPLAY',()=>usingLoyalty(f=>{
  const first=sourceRows(f.full.db);f.full.source.publish(snapshot(f));assert.deepEqual(sourceRows(f.full.db),first);
  assert.throws(()=>f.full.source.publish(snapshot(f,{complete:false})));assert.deepEqual(sourceRows(f.full.db),first);
  const db=new DatabaseSync(f.full.filename);
  try {
    const contender=new LoyaltyFixtureSource(db,f.full.config,f.now);assert.equal(contender.observe('C-1001')!.source_revision,1);
    f.full.source.publish(snapshot(f,{source_revision:3}));assert.equal(inspect(f).snapshot.source_revision,3);
    assert.throws(()=>contender.publish(snapshot(f,{source_revision:2})),'a second handle cannot use its previously observed head');
    assert.throws(()=>contender.publish(snapshot(f,{source_revision:3,complete:false})));
    assert.deepEqual(sourceRows(f.full.db).map(row=>row.source_revision),[1,3]);
    contender.publish(snapshot(f,{source_revision:4}));assert.equal(f.full.source.observe('C-1001')!.source_revision,4);
    assert.deepEqual(sourceRows(f.full.db).map(row=>row.source_revision),[1,3,4]);
    const reopened=new LoyaltyFixtureSource(f.full.db,f.full.config,f.now);
    assert.equal(reopened.identity,f.full.source.identity);assert.equal(reopened.observe('C-1001')!.source_revision,4);
  }finally{db.close();}
}));

test('M19-G01-RULES-VERSION-AND-EXPIRY',()=>usingLoyalty(f=>{
  const base=snapshot(f),old=quoteInput(f);
  assert.throws(()=>f.full.source.publish({...base,source_revision:2,rules:{...base.rules,maximum_redemption:900}}));
  f.full.source.publish({...base,source_revision:2,rules:{...base.rules,revision:2,minimum_redemption:200,expires_at:f.now()+100}});
  assert.equal(inspect(f).snapshot.rules.revision,2);assert.equal(quote(f).terms.expires_at,f.now()+100);
  assert.throws(()=>f.full.source.publish({...base,source_revision:3}));
  f.advance(100);unavailable(inspect(f),'stale','LOYALTY_RULES_EXPIRED');
  deniedQuote(f.loyalty.quote(f.a.scope,f.customer,old),'LOYALTY_RULES_EXPIRED');
}));

test('M19-G01-EXACT-QUOTE-BINDING',()=>usingLoyalty(f=>{
  const view=inspect(f),old=quoteInput(f,{},view),before=effects(f);
  f.full.source.publish(snapshot(f,{source_revision:2,balances:{unit:'points',pending:900,earned:1000,reserved:250,redeemed:200,reversed:50,available:500}}));
  deniedQuote(f.loyalty.quote(f.a.scope,f.customer,old),'LOYALTY_SNAPSHOT_CHANGED');assert.equal(quote(f).eligible,true);
  assert.notEqual(inspect(f).snapshot_digest,view.snapshot_digest);
  for(const extra of [{snapshot:view.snapshot},{provider_thread_id:'private_thread'},{account_id:'another_account'},{eligible:true}]){
    assert.throws(()=>f.loyalty.context(f.a.scope,f.customer,{...contextInput(f),...extra}));
    assert.throws(()=>f.loyalty.quote(f.a.scope,f.customer,{...old,...extra}));
  }
  const getter=contextInput(f);Object.defineProperty(getter,'case_id',{enumerable:true,get:()=>{throw new Error('GETTER_EXECUTED');}});
  assert.throws(()=>f.loyalty.context(f.a.scope,f.customer,getter),(error:any)=>error.message!=='GETTER_EXECUTED');
  for(const value of ['A'.repeat(64),'not_a_digest',null])assert.throws(()=>f.loyalty.quote(f.a.scope,f.customer,{...old,snapshot_digest:value}));
  assert.deepEqual(effects(f),before);
}));

test('M19-G01-REDEMPTION-LIMITS',()=>usingLoyalty(f=>{
  for(const points of [50,125,850])deniedQuote(quote(f,{points}),'LOYALTY_REDEMPTION_RULES');
  deniedQuote(quote(f,{points:650}),'LOYALTY_INSUFFICIENT_POINTS');
  assert.equal(quote(f,{points:600}).eligible,true);assert.equal(quote(f,{points:100}).eligible,true);
  for(const points of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1,Infinity,'200'])assert.throws(()=>quote(f,{points}));
  assert.equal(inspect(f).snapshot.balances.available,600,'quoting does not reserve even a valid amount');
  assert.equal(inspect(f).snapshot.balances.pending,900,'pending points do not expand the 600-point availability');
}));

test('M19-G01-CASE-TENANT-CUSTOMER-BINDING',()=>usingLoyalty(f=>{
  const before=effects(f);for(const scope of [f.b.scope,f.c.scope,{}])assert.throws(()=>inspect(f,{},scope));
  f.create('case_two');const second=f.conversations.link(f.a.scope,f.customer,{case_id:'case_two',channel:'webchat',account_id:'widget',external_id:'other_case',history:'unavailable',source_revision:1});
  assert.throws(()=>inspect(f,{link_id:second.id}));assert.throws(()=>inspect(f,{case_id:'case_two'}));
  const other=verifiedCustomer(f,f.a,'ORD-1002');assert.throws(()=>inspect(f,{},f.a.scope,other.scope));assert.throws(()=>inspect(f,{},other.scope,other.scope));
  const order=f.order();updateResource(f,order,order.payload,'C-1002');assert.throws(()=>inspect(f));
  assert.deepEqual(effects(f),before);
}));

test('M19-G01-CURRENT-PROOF',()=>usingLoyalty(f=>{
  const old=quoteInput(f),customer=f.kernel.lookup(f.a.scope,'customer','synthetic','C-1001');
  updateResource(f,customer,{...customer.payload,email:'current-loyalty@example.invalid'});
  assert.throws(()=>inspect(f));assert.throws(()=>f.loyalty.quote(f.a.scope,f.customer,old));
  const current=verifiedCustomer(f);assert.equal(inspect(f,{},f.a.scope,current.scope).status,'available');
  f.kernel.revoke(current.scope);assert.throws(()=>inspect(f,{},f.a.scope,current.scope));
  assert.throws(()=>inspect(f,{},f.a.scope,f.owner.scope),'staff authority cannot substitute for customer proof');
}));

test('M19-G01-OWNERSHIP-AND-PERMISSIONS',()=>usingLoyalty(f=>{
  const initial=inspect(f),old=quoteInput(f,{},initial),initialQuote=f.loyalty.quote(f.a.scope,f.customer,old);
  f.ownership.assign(f.owner.scope,{case_id:'case_one',expected_generation:1,actor_id:'agent'});
  assert.throws(()=>inspect(f));assert.throws(()=>inspect(f,{expected_generation:2}));assert.throws(()=>f.loyalty.quote(f.a.scope,f.customer,old));
  const assigned=inspect(f,{expected_generation:2},f.agent.scope);
  assert.equal(assigned.status,'available');assert.equal(assigned.snapshot_digest,initial.snapshot_digest);
  assert.notEqual(assigned.context_digest,initial.context_digest);
  const assignedQuote=f.loyalty.quote(f.agent.scope,f.customer,quoteInput(f,{expected_generation:2},assigned));
  assert.equal(assignedQuote.eligible,true);assert.deepEqual(assignedQuote.terms,initialQuote.terms);
  assert.notEqual(assignedQuote.quote_digest,initialQuote.quote_digest,'unchanged terms remain bound to current ownership generation');
  f.ownership.takeover(f.a.scope,{case_id:'case_one',expected_generation:2,reason:'operator_requested'});
  assert.throws(()=>inspect(f,{expected_generation:3},f.agent.scope));const taken=inspect(f,{expected_generation:3});assert.equal(taken.status,'available');
  assert.notEqual(f.loyalty.quote(f.a.scope,f.customer,quoteInput(f,{expected_generation:3},taken)).quote_digest,initialQuote.quote_digest);
  f.permissions.change(f.owner.scope,{actor_id:'operator',role:'operator',expected_revision:0,actions:['case.read','resource.read'],resource_ids:null});
  assert.throws(()=>inspect(f,{expected_generation:3}),/ACCESS_DENIED/);
}));

test('M19-G01-SOURCE-BOUNDARY',()=>usingLoyalty(async f=>{
  assert.throws(()=>new LoyaltyBalances(f.kernel,{...f.full.source} as any));
  const tables=coreState(f.db).tables;
  assert.throws(()=>new LoyaltyBalances(f.kernel,new LoyaltyFixtureSource(f.db,f.full.config,f.now)));
  assert.deepEqual(coreState(f.db).tables,tables,'reject the commerce database before creating fixture tables');
  const alias=join(f.directory,'core-alias.sqlite');linkSync(f.filename,alias);
  for(const filename of [f.filename,alias]){
    const db=new DatabaseSync(filename);
    try{assert.throws(()=>new LoyaltyFixtureSource(db,f.full.config,f.now));}
    finally{db.close();}
    assert.deepEqual(coreState(f.db).tables,tables,'separate handles and physical aliases must not create fixture tables');
  }
  for(const config of [{...f.full.config,account_id:'different_account'},{...f.full.config,tenant_id:'different_tenant'},{...f.full.config,provider:'limited'}])
    assert.throws(()=>new LoyaltyFixtureSource(f.full.db,config as any,f.now));
  const foreign=f.makeSource('full','other_account',f.b);foreign.source.publish(snapshot(f));
  assert.throws(()=>new LoyaltyBalances(f.kernel,foreign.source).context(f.a.scope,f.customer,contextInput(f)));
  const changed=f.makeSource('full','changed_identity');changed.source.publish(snapshot(f));
  changed.db.prepare('DELETE FROM fixture_loyalty_identity').run();
  assert.throws(()=>changed.source.observe('C-1001'),'an existing source revalidates its identity row before reading');
  assert.throws(()=>changed.source.publish(snapshot(f,{source_revision:2})),'an existing source revalidates its identity row before publishing');
  assert.deepEqual(sourceRows(changed.db).map(row=>row.source_revision),[1]);
  await usingLoyalty(other=>{
    assert.throws(()=>other.loyalty.context(f.a.scope,f.customer,contextInput(f)));
    assert.throws(()=>new SupportService(f.kernel,f.reads,{loyalty:other.loyalty}));
  });
  assert.equal(inspect(f).snapshot.account_id,'loyalty_account');
}));

test('M19-G01-MISSING-SOURCE-AND-ACCOUNT',()=>usingLoyalty(f=>{
  const missing=new LoyaltyBalances(f.kernel),empty=f.makeSource('full','empty_account'),emptyOwner=new LoyaltyBalances(f.kernel,empty.source),old=quoteInput(f);
  unavailable(missing.context(f.a.scope,f.customer,contextInput(f)),'needs_configuration','LOYALTY_SOURCE_NOT_CONFIGURED');
  deniedQuote(missing.quote(f.a.scope,f.customer,old),'LOYALTY_SOURCE_NOT_CONFIGURED');
  assert.equal(empty.source.observe('C-1001'),null);
  empty.source.publish(snapshot(f,{customer_id:'C-1002'}));
  unavailable(emptyOwner.context(f.a.scope,f.customer,contextInput(f)),'unavailable','LOYALTY_ACCOUNT_NOT_FOUND');
  deniedQuote(emptyOwner.quote(f.a.scope,f.customer,old),'LOYALTY_ACCOUNT_NOT_FOUND');
}));

test('M19-G01-DISPATCHER-NO-AUTHORITY',()=>usingLoyalty(async f=>{
  const service=new SupportService(f.kernel,f.reads,{sources:[f.source],loyalty:f.loyalty}),before=effects(f);
  new ExecutionStops(f.kernel).set(f.owner.scope,{action:'model.run',stopped:true,expected_revision:0,reason:'maintenance'});
  const body={customer_token:f.customerBearer,input:contextInput(f)},view:any=await service.post(f.a.scope,'loyalty-context',body);
  assert.equal(view.status,'available');assert.equal(view.model_required,false);
  const q:any=await service.post(f.a.scope,'loyalty-quote',{customer_token:f.customerBearer,input:quoteInput(f)});assert.equal(q.eligible,true);
  assert.equal(q.execution_authorized,false);assert.equal(q.enrollment_authorized,false);assert.equal(q.send_authorized,false);
  for(const action of ['loyalty-enroll','loyalty-reserve','loyalty-redeem','loyalty-send'])await assert.rejects(()=>service.post(f.a.scope,action,body),/SUPPORT_ROUTE_UNSUPPORTED/);
  await assert.rejects(()=>service.post(f.a.scope,'loyalty-context',{...body,available:true}));
  await assert.rejects(()=>service.post(f.a.scope,'loyalty-context',{...body,customer_token:f.owner.bearer}));
  const unconfigured=new SupportService(f.kernel,f.reads);unavailable(await unconfigured.post(f.a.scope,'loyalty-context',body) as Value,'needs_configuration','LOYALTY_SOURCE_NOT_CONFIGURED');
  assert.deepEqual(effects(f),before);assert.equal(f.source.calls,0);
}));

test('M19-G01-ERASURE-AND-UNINSTALL',async()=>{
  await usingLoyalty(f=>{
    const old=quoteInput(f),providerBefore=sourceRows(f.full.db);assert.equal(new PrivacyLifecycle(f.kernel).erase(f.owner.scope,'C-1001').status,'logically_erased');
    assert.throws(()=>inspect(f));assert.throws(()=>f.loyalty.quote(f.a.scope,f.customer,old));
    assert.deepEqual(sourceRows(f.full.db),providerBefore,'native erasure does not falsely attest external provider deletion');
  });
  await usingLoyalty(f=>{
    const old=quoteInput(f);assert.equal(new PrivacyLifecycle(f.kernel).uninstall(f.owner.scope).status,'disconnected');
    assert.throws(()=>inspect(f));assert.throws(()=>f.loyalty.quote(f.a.scope,f.customer,old));
  });
});

test('M19-G01-RESTORE-GUARD',()=>usingLoyalty(f=>{
  const input=contextInput(f),old=quoteInput(f),saved=createRecoverySnapshot(f.kernel,join(f.directory,'loyalty-backup')),
    suppression=suppressionCheckpoint(f.kernel),restored=restoreRecoverySnapshot({snapshot:saved.directory,destination:join(f.directory,'loyalty-restored'),
      manifest_sha256:saved.manifest_sha256,suppression,suppression_sha256:contentDigest(suppression)},f.now),db=new DatabaseSync(restored.database);
  try {
    const kernel=new CommerceKernel(db,f.now),owner=kernel.authenticate(kernel.issueSession(f.a.tenant,f.a.store,'owner')),
      loyalty=new LoyaltyBalances(kernel,f.full.source);
    assert.equal((db.prepare('SELECT mode FROM commerce_recovery_state').get() as Value).mode,'quarantine');
    assert.throws(()=>kernel.authenticate(f.customerBearer));
    assert.throws(()=>loyalty.context(owner,f.customer,input));assert.throws(()=>loyalty.quote(owner,f.customer,old));
    let proofs=0;assert.throws(()=>new CustomerAccess(kernel,()=>{proofs++;}).request({store_id:f.a.store,order_number:'ORD-1001',email:'shopper-apparel@example.invalid'},'127.0.0.1'),/RESTORE_EGRESS_BLOCKED/);
    assert.equal(proofs,0);assert.equal(coreState(db).tables.some(name=>name.includes('loyalty')),false);
    assert.equal(f.full.source.observe('C-1001')!.balances.available,600);
  }finally{db.close();}
}));

test('M19-G01-NO-PERSISTENT-PERSONAL-CACHE',()=>usingLoyalty(f=>{
  const before=coreState(f.db),providerBefore=sourceRows(f.full.db),exportBefore=new PrivacyLifecycle(f.kernel).export(f.owner.scope,'C-1001');
  const view=inspect(f);for(const points of [100,200,600])assert.equal(quote(f,{points}).eligible,true);
  try{view.snapshot.balances.available=999999;view.snapshot.rules.maximum_redemption=999999;}
  catch(error){assert.ok(error instanceof TypeError,'immutable returned snapshots are also acceptable');}
  const reopened=new LoyaltyBalances(f.kernel,new LoyaltyFixtureSource(f.full.db,f.full.config,f.now));
  assert.equal(reopened.context(f.a.scope,f.customer,contextInput(f)).snapshot.balances.available,600);
  assert.deepEqual(sourceRows(f.full.db),providerBefore);assert.deepEqual(coreState(f.db),before);
  assert.deepEqual(new PrivacyLifecycle(f.kernel).export(f.owner.scope,'C-1001'),exportBefore);
  assert.equal(before.tables.some(name=>name.includes('loyalty')),false);
  assert.equal(f.source.calls,0);
}));
