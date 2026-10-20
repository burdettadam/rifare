import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {CommerceKernel} from '../../packages/commerce/kernel.mts';
import {canonical,contentDigest} from '../../packages/commerce/configuration-values.mts';
import {PrivacyLifecycle} from '../../packages/commerce/privacy-lifecycle.mts';
import {SupportService} from '../../packages/commerce/support-service.mts';
import {QualifiedReturnDestinations} from '../../packages/commerce/qualified-return-destinations.mts';
import {ReverseHubs} from '../../packages/commerce/reverse-hubs.mts';
import {DropoffFixtureSource} from '../../packages/adapters/dropoff-fixture-source.mts';
import {DropoffChoices} from '../../packages/commerce/dropoff-choices.mts';
import {E,TOP_FIELDS,SOURCE_FIELDS,pick,method,choices,quote,positive,flags,
  usingFixture,directoryRow,directoryInput,publish,configurePartner,partnerContext,enable,reviseDestination,
  databaseState,sourceState,allState,count,withMethod,externalWorker,withRawSources} from './dropoff-eligibility-helpers.mts';
import type {Value} from './dropoff-eligibility-helpers.mts';

const proofRows=(f:any)=>f.db.prepare("SELECT * FROM commerce_sessions WHERE role='customer' ORDER BY token_hash").all();
const target={service:'reverse_hub',account_id:E.partner_account_id};
const noMain=(view:Value)=>{assert.equal(method(view).eligible,false);assert.ok(!choices(view).includes('main-site/main-destination/qr-bag'));};
const denied=(fn:()=>unknown)=>assert.throws(fn);

test('CASE-M20-G01-01',()=>usingFixture(f=>{
  const before=allState(f),proof=proofRows(f),view=positive(f),source=f.source.observe();
  assert.deepEqual(Object.keys(view).sort(),TOP_FIELDS);assert.equal(view.request_id,f.request.id);assert.equal(view.case_id,'case_one');
  assert.deepEqual(Object.keys(source).sort(),SOURCE_FIELDS);assert.equal(Object.isFrozen(f.source),true);
  assert.deepEqual(pick(source,['schema_version','contract','qualification','source_identity','tenant_id','store_id','fulfillment_source_identity','partner_source_identity','warehouse_source_identity','account_id']),
    {schema_version:1,contract:'rifare-dropoff-fixture-v1',qualification:'synthetic_only',source_identity:f.source.identity,tenant_id:f.a.tenant,store_id:f.a.store,fulfillment_source_identity:f.fulfillment.identity,partner_source_identity:f.partner.identity,warehouse_source_identity:f.warehouse.identity,account_id:'reverse_hub_account'});
  const {digest,...body}=source;assert.equal(digest,contentDigest(body));assert.deepEqual(source,f.declaration);
  assert.equal(view.directory_revision,1);assert.equal(view.directory_digest,digest);assert.equal(view.observed_at,f.now());assert.equal(view.expires_at,f.now()+30000);
  for(const m of view.methods)assert.deepEqual(m.availability,{state:'available',observed_at:f.now(),expires_at:f.now()+30000});
  const byChoice=(a:Value,b:Value)=>a.choice_id.localeCompare(b.choice_id);assert.deepEqual([...view.choices].sort(byChoice),view.methods.filter((m:Value)=>m.eligible).sort(byChoice));
  const legacy=f.destinations.evaluate(f.a.scope,{request_id:f.request.id}),items=f.destinations.evaluateItems(f.a.scope,{request_id:f.request.id});
  assert.deepEqual(pick(items,Object.keys(legacy)),legacy);assert.deepEqual(items.source_items,E.items);assert.equal(items.region,'US-CO');assert.equal(items.disposition,'inspect_then_restock');
  assert.equal(items.source_request_digest,contentDigest(f.sourceRequest));assert.match(items.qualification_digest,/^[a-f0-9]{64}$/);
  assert.deepEqual(items.item_evaluations.map((i:Value)=>({line_id:i.line_id,destinations:[...i.destinations].sort((a:Value,b:Value)=>a.destination_id.localeCompare(b.destination_id))})),[
    {line_id:'alpha',destinations:[{destination_id:'accessory-destination',eligible:false,reasons:['CATEGORY_UNSUPPORTED']},{destination_id:'backup-destination',eligible:true,reasons:[]},{destination_id:'main-destination',eligible:true,reasons:[]}]},
    {line_id:'beta',destinations:[{destination_id:'accessory-destination',eligible:true,reasons:[]},{destination_id:'backup-destination',eligible:true,reasons:[]},{destination_id:'main-destination',eligible:true,reasons:[]}]}
  ]);
  const text=JSON.stringify(view);for(const secret of [E.customer_id,f.customerBearer,'shopper-apparel@example.invalid',...proof.map((p:Value)=>p.token_hash)])assert.equal(text.includes(secret),false);
  assert.equal(text.includes('partner_config_digest'),false);assert.deepEqual(proofRows(f),proof);assert.deepEqual(allState(f),before);
}));

test('CASE-M20-G01-02',()=>usingFixture(f=>{
  positive(f);f.readiness.outage(f.owner.scope,{...target,unavailable:true});let view=quote(f);
  assert.deepEqual(view.choices,[]);assert.equal(view.state,'needs_review');assert.equal(method(view).state,'unavailable');assert.ok(method(view).reasons.includes('PARTNER_OUTAGE'));
  f.readiness.outage(f.owner.scope,{...target,unavailable:false});positive(f);
  f.readiness.revoke(f.owner.scope,target);view=quote(f);assert.deepEqual(view.choices,[]);assert.ok(method(view).reasons.includes('SERVICE_DISABLED'));enable(f);positive(f);
  const oldDirectory=f.source.observe(),oldTerms=f.partner.configuration('reverse_hub').body.terms;
  configurePartner(f,{terms:{...oldTerms,sites:oldTerms.sites.filter((s:Value)=>s.site_id!=='main-site')}});
  view=quote(f);noMain(view);assert.equal(method(view,'backup-site').state,'unverified');assert.deepEqual(f.source.observe(),oldDirectory);
  enable(f);publish(f);view=quote(f);noMain(view);assert.equal(method(view).state,'unavailable');assert.deepEqual(choices(view),E.after_main_revocation_choices);
  configurePartner(f);enable(f);publish(f);positive(f);
  const terms=f.partner.configuration('reverse_hub').body.terms;
  configurePartner(f,{terms:{...terms,sites:terms.sites.map((s:Value)=>s.site_id==='main-site'?{...s,categories:['accessory']}:s)}});enable(f);publish(f);
  view=quote(f);noMain(view);assert.equal(method(view).items[0].state,'unavailable');assert.equal(method(view).items[1].state,'eligible');
  publish(f,{combinations:directoryInput(f).combinations.map((c:Value)=>({...c,availability:{...c.availability,state:'unavailable'}}))});
  view=quote(f);assert.deepEqual(view.choices,[]);assert.equal(view.state,'needs_review');assert.equal(method(view,'backup-site').state,'unavailable');
  assert.equal(f.fulfillment.effects().length,0);assert.equal(f.native.admissions().length,0);assert.equal(count(f.warehouseDb,'warehouse_effects'),0);
}));

test('CASE-M20-G01-03',()=>usingFixture(f=>{
  const first=positive(f),directory=f.source.observe(),partner=f.partner.configuration('reverse_hub'),proof=proofRows(f),ready=f.readiness.inspect(f.a.scope,partnerContext(f));
  assert.equal(ready.ready,true);reviseDestination(f,'main-destination',{accepted_categories:['accessory']});
  const changed=quote(f),main=method(changed);assert.deepEqual(choices(changed),E.after_main_revocation_choices);assert.equal(main.state,'unavailable');assert.equal(main.eligible,false);
  assert.deepEqual(main.items.map((i:Value)=>pick(i,['line_id','quantity','state','eligible'])),[{line_id:'alpha',quantity:2,state:'unavailable',eligible:false},{line_id:'beta',quantity:1,state:'eligible',eligible:true}]);
  assert.ok(main.items[0].reasons.includes('CATEGORY_UNSUPPORTED'));assert.notEqual(changed.source_digest,first.source_digest);
  assert.deepEqual(f.source.observe(),directory);assert.deepEqual(f.partner.configuration('reverse_hub'),partner);assert.deepEqual(f.readiness.inspect(f.a.scope,partnerContext(f)),ready);assert.deepEqual(proofRows(f),proof);
  reviseDestination(f,'main-destination',{accepted_categories:['fragile','accessory']});positive(f);
  publish(f,{combinations:directoryInput(f).combinations.map((c:Value)=>({...c,availability:null}))});const missing=quote(f);
  assert.deepEqual(missing.choices,[]);assert.equal(missing.state,'unverified');assert.equal(method(missing).state,'unverified');assert.equal(method(missing).availability,null);
  const mixed=method(missing,'accessory-site');assert.equal(mixed.state,'unavailable');assert.equal(mixed.items[0].state,'unavailable');assert.ok(mixed.items[0].reasons.includes('CATEGORY_UNSUPPORTED'));assert.equal(mixed.items[1].state,'unverified');
}));

test('CASE-M20-G01-04',async()=>{
  await usingFixture(f=>{
    const at=f.now(),proof=proofRows(f),first=quote(f);assert.equal(first.expires_at,at+2000);assert.equal(method(first).eligible,true);
    f.advance(100);const next=quote(f);assert.equal(next.observed_at,at);assert.equal(next.expires_at,at+2000);assert.deepEqual(method(next).availability,method(first).availability);assert.deepEqual(proofRows(f),proof);
    f.advance(1900);const expired=quote(f);assert.equal(method(expired).state,'unverified');assert.deepEqual(expired.choices,[]);assert.deepEqual(method(expired).availability,method(first).availability);
    f.advance(3000);const configExpired=quote(f);assert.equal(configExpired.state,'unverified');assert.equal(method(configExpired).eligible,false);assert.deepEqual(proofRows(f),proof);
  },{directory_ttl_ms:5000,availability_ttl_ms:2000});
  await usingFixture(f=>{
    positive(f);f.advance(-1);const future=quote(f);assert.equal(future.state,'unverified');assert.equal(method(future).state,'unverified');assert.deepEqual(future.choices,[]);f.advance(1);positive(f);
    f.advance(-11);denied(()=>quote(f));f.advance(11);positive(f);
    // Republish every short-lived provider/readiness input while the same original order ages.
    f.advance(300001);configurePartner(f);enable(f);publish(f);assert.equal(f.readiness.inspect(f.a.scope,partnerContext(f)).ready,true);denied(()=>quote(f));
  });
});

test('CASE-M20-G01-05',()=>usingFixture(f=>{
  positive(f);for(const extra of [{region:'US-NY'},{category:'accessory'},{customer_id:'another-customer'},{resource_id:f.order().id},{items:[{line_id:'beta',quantity:1}]}])denied(()=>quote(f,f.a.scope,{request_id:f.request.id,...extra}));
  denied(()=>quote(f,f.a.scope,{request_id:'missing-request'}));
  const row=f.fulfillmentDb.prepare('SELECT * FROM fixture_destination_requests WHERE request_id=? AND revision=1').get(f.request.id),original=JSON.parse(row.body);
  const alterations=[{account_id:'foreign-account'},{customer_id:'foreign-customer'},{resource_id:'foreign-order'},{request_id:'foreign-request'},{native_return_id:'gid://shopify/Return/999'},
    {items:original.items.map((i:Value)=>i.line_id==='alpha'?{...i,item_id:'different-shirt'}:i)},{items:original.items.map((i:Value)=>i.line_id==='alpha'?{...i,quantity:1}:i)}];
  for(const alteration of alterations){const damaged={...original,...alteration};f.fulfillmentDb.prepare('UPDATE fixture_destination_requests SET body=?,digest=? WHERE request_id=? AND revision=1').run(canonical(damaged),contentDigest(damaged),f.request.id);
    try{denied(()=>quote(f));}finally{f.fulfillmentDb.prepare('UPDATE fixture_destination_requests SET body=?,digest=? WHERE request_id=? AND revision=1').run(row.body,row.digest,f.request.id);}positive(f);
  }
  assert.equal(f.native.admissions().length,0);assert.equal(count(f.fulfillmentDb,'fixture_destination_routes'),0);
}));

test('CASE-M20-G01-06',async()=>{
  await usingFixture(f=>{
    positive(f);for(const scope of [f.customer,f.a.worker,f.b.scope,f.c.scope,f.reviewer.scope,{}])denied(()=>quote(f,scope));
    const generation=f.ownership.inspect(f.a.scope,'case_one').generation;
    f.ownership.assign(f.owner.scope,{case_id:'case_one',expected_generation:generation,actor_id:f.agent.actor});
    assert.equal(f.kernel.require(f.agent.scope).role,'agent');assert.equal(f.ownership.inspect(f.agent.scope,'case_one').owner,f.agent.actor);denied(()=>quote(f,f.agent.scope));
    f.ownership.takeover(f.a.scope,{case_id:'case_one',expected_generation:generation+1,reason:'operator_requested'});positive(f);
    // The real grant retains its parent's role but also retains its narrow native action set.
    const worker=externalWorker(f);denied(()=>quote(f,worker));positive(f);
    f.ownership.takeover(f.owner.scope,{case_id:'case_one',expected_generation:generation+2,reason:'operator_requested'});denied(()=>quote(f));positive(f,quote(f,f.owner.scope));
  });
  await usingFixture(f=>{
    positive(f);const other=f.seed(f.a.scope,'other','OTHER-DROPOFF-ORDER'),actor=f.kernel.require(f.a.scope).actor_id;
    f.permissions.change(f.owner.scope,{actor_id:actor,role:'operator',actions:null,resource_ids:[other.id],expected_revision:0});denied(()=>quote(f));
    f.permissions.change(f.owner.scope,{actor_id:actor,role:'operator',actions:null,resource_ids:null,expected_revision:1});positive(f);
    f.kernel.revoke(f.customer);const revoked=proofRows(f);denied(()=>quote(f));assert.deepEqual(proofRows(f),revoked);
  });
});

test('CASE-M20-G01-07',()=>usingFixture(f=>{
  positive(f);const original=f.native.destination('main-destination');
  for(const [patch,reason] of [[{accepted_regions:['US-NY']},'REGION_UNSUPPORTED'],[{accepted_item_ids:['hat']},'ITEM_UNSUPPORTED'],[{handling_capabilities:['standard']},'HANDLING_UNSUPPORTED'],[{dispositions:['quarantine']},'DISPOSITION_UNSUPPORTED'],[{enabled:false},'DESTINATION_DISABLED']] as [Value,string][]){
    reviseDestination(f,'main-destination',patch);const view=quote(f);noMain(view);assert.equal(method(view).state,'unavailable');assert.ok(method(view).reasons.includes(reason));
    reviseDestination(f,'main-destination',original);positive(f);
  }
  for(const restriction of [{item_ids:['hat']},{category_ids:['accessory']}]){
    publish(f,{combinations:directoryInput(f).combinations.map((c:Value)=>c.site_id==='main-site'?{...c,...restriction}:c)});
    const restricted=quote(f),main=method(restricted);noMain(restricted);assert.equal(main.state,'unavailable');assert.deepEqual(choices(restricted),E.after_main_revocation_choices);
    assert.deepEqual(main.items.map((i:Value)=>pick(i,['line_id','state','eligible'])),[{line_id:'alpha',state:'unavailable',eligible:false},{line_id:'beta',state:'eligible',eligible:true}]);
    assert.deepEqual(f.destinations.evaluateItems(f.a.scope,{request_id:f.request.id}).item_evaluations.map((i:Value)=>i.destinations.find((d:Value)=>d.destination_id==='main-destination').eligible),[true,true]);
    assert.equal(f.readiness.inspect(f.a.scope,partnerContext(f)).ready,true);publish(f);positive(f);
  }
  reviseDestination(f,'main-destination',{capacity_units:2});const view=quote(f),main=method(view),native=f.destinations.evaluateItems(f.a.scope,{request_id:f.request.id});
  assert.equal(E.items.reduce((n:number,i:Value)=>n+i.quantity,0),E.capacity_control.selected_units);assert.equal(f.native.capacity('main-destination').available_units,E.capacity_control.available_units);
  assert.deepEqual(main.items.map((i:Value)=>i.eligible),E.capacity_control.per_line_eligible);assert.equal(main.eligible,E.capacity_control.whole_set_eligible);assert.equal(main.state,'unavailable');assert.ok(main.reasons.includes('CAPACITY_EXCEEDED'));noMain(view);
  assert.deepEqual(native.item_evaluations.map((i:Value)=>i.destinations.find((d:Value)=>d.destination_id==='main-destination').eligible),[true,true]);assert.equal(f.native.admissions().length,0);assert.equal(count(f.fulfillmentDb,'fixture_destination_routes'),0);
}));

test('CASE-M20-G01-08',async()=>{
  await usingFixture(f=>{
    positive(f);const original=directoryRow(f),input=directoryInput(f),bad=[{revision:0},{revision:1},{revision:3},{observed_at:f.now()+1},{expires_at:f.now()},{expires_at:f.now()+300001},{partner_config_digest:'0'.repeat(64)},{customer_id:E.customer_id},
      {combinations:[]},{combinations:[...input.combinations,input.combinations[0]]},{combinations:Array.from({length:21},(_,i)=>({...input.combinations[0],method_id:'method-'+i}))},
      ...[{packaging:'anything'},{label_required:'false'},{item_ids:['shirt','shirt']},{category_ids:[]},{credential_kind:'secret'},{credential:'USABLE-SECRET'},{availability:{state:'available',observed_at:f.now()+1,expires_at:f.now()+1000}}].map(c=>({combinations:[{...input.combinations[0],...c}]}))];
    for(const patch of bad){denied(()=>f.source.configure({...structuredClone(input),...patch}));assert.deepEqual(directoryRow(f),original);}positive(f);
    const native=f.partnerDb.prepare("SELECT * FROM partner_source_configurations WHERE service='reverse_hub'").get();f.partnerDb.prepare("DELETE FROM partner_source_configurations WHERE service='reverse_hub'").run();
    try{const absent=quote(f);assert.equal(absent.state,'unverified');assert.deepEqual(absent.choices,[]);assert.equal(method(absent).fees.partner_fee,null);}finally{f.partnerDb.prepare('INSERT INTO partner_source_configurations VALUES(?,?,?)').run(native.service,native.body,native.digest);}positive(f);
    for(let i=0;i<62;i++)f.native.recordDestination({...E.destination_defaults,destination_id:'overflow-'+i,address_ref:'overflow-address-'+i,account_id:E.fulfillment_account_id,revision:1,handling_fee_estimate_minor:'1',expires_at:f.now()+60000});
    let legacyCalls=0;withMethod(f.native,'evaluate',()=>{legacyCalls++;throw new Error('UNBOUNDED_LEGACY_VIEW');},()=>{denied(()=>f.destinations.evaluateItems(f.a.scope,{request_id:f.request.id}));denied(()=>quote(f));});assert.equal(legacyCalls,0);
  });
  await usingFixture(f=>{assert.equal(f.source.observe(),null);const view=quote(f);flags(view);assert.equal(view.state,'unverified');assert.deepEqual(view.methods,[]);assert.deepEqual(view.choices,[]);assert.equal(view.directory_revision,0);assert.equal(view.directory_digest,null);assert.equal(view.observed_at,null);},{directory:false});
  await usingFixture(f=>{assert.equal(f.items.length,21);let legacyCalls=0;withMethod(f.native,'evaluate',()=>{legacyCalls++;throw new Error('UNBOUNDED_LEGACY_VIEW');},()=>{denied(()=>f.destinations.evaluateItems(f.a.scope,{request_id:f.request.id}));denied(()=>quote(f));});assert.equal(legacyCalls,0);},{line_count:21});
});

test('CASE-M20-G01-09',()=>usingFixture(f=>{
  positive(f);const original=directoryRow(f),body=JSON.parse(original.body),publishInput=directoryInput(f);
  for(const patch of [{tenant_id:'foreign-tenant'},{store_id:'foreign-store'},{account_id:'foreign-account'},{source_identity:'foreign-source'},{fulfillment_source_identity:'foreign-fulfillment'},{partner_source_identity:'foreign-partner'},{warehouse_source_identity:'foreign-warehouse'},{customer_id:E.customer_id},{revision:2}]){
    const changed={...body,...patch};f.partnerDb.prepare('UPDATE fixture_dropoff_configuration SET body=?,digest=? WHERE singleton=1').run(canonical(changed),contentDigest(changed));
    try{denied(()=>f.source.observe());denied(()=>quote(f));}finally{f.partnerDb.prepare('UPDATE fixture_dropoff_configuration SET body=?,digest=? WHERE singleton=1').run(original.body,original.digest);}positive(f);
  }
  f.partnerDb.prepare('UPDATE fixture_dropoff_configuration SET digest=? WHERE singleton=1').run('0'.repeat(64));try{denied(()=>f.source.observe());}finally{f.partnerDb.prepare('UPDATE fixture_dropoff_configuration SET digest=? WHERE singleton=1').run(original.digest);}
  const identities:[DatabaseSync,string,string,string][]=[[f.fulfillmentDb,'fixture_identity','tenant','foreign-tenant'],[f.partnerDb,'partner_source_identity','identity','foreign-partner'],[f.warehouseDb,'warehouse_identity','identity','foreign-warehouse']];
  for(const [db,table,column,changed] of identities){const prior=db.prepare('SELECT '+column+' value FROM '+table).get().value;db.prepare('UPDATE '+table+' SET '+column+'=?').run(changed);
    try{denied(()=>f.source.observe());denied(()=>f.source.configure(publishInput));denied(()=>quote(f));}finally{db.prepare('UPDATE '+table+' SET '+column+'=?').run(prior);}assert.deepEqual(directoryRow(f),original);positive(f);
  }
  denied(()=>new DropoffFixtureSource({fulfillment:{...f.fulfillment} as any,partner:f.partner,warehouse:f.warehouse}));
  withRawSources(f,{},p=>{const source=new DropoffFixtureSource({fulfillment:p.fulfillment,partner:p.partner,warehouse:p.warehouse});assert.equal(source.observe(),null);assert.equal(Object.isFrozen(source),true);});
  for(const options of [{core:'fulfillment'},{core:'partner'},{core:'warehouse'},{alias:'same_handle'},{alias:'same_file'},{alias:'hardlink'}] as any[]){withRawSources(f,options,p=>{
    const before=databaseState(p.dbs.partner);denied(()=>new DropoffFixtureSource({fulfillment:p.fulfillment,partner:p.partner,warehouse:p.warehouse}));assert.equal(p.dbs.partner.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='fixture_dropoff_configuration'").get(),undefined);assert.deepEqual(databaseState(p.dbs.partner),before);
  });}
}));

test('CASE-M20-G01-10',()=>usingFixture(f=>{
  positive(f);let changed=false;
  withMethod(f.destinations,'evaluateItems',(original,...args)=>{const value=original(...args);if(!changed){changed=true;reviseDestination(f,'main-destination',{accepted_categories:['accessory']});}return value;},()=>denied(()=>quote(f)));assert.equal(changed,true);
  assert.deepEqual(choices(quote(f)),E.after_main_revocation_choices);reviseDestination(f,'main-destination',{accepted_categories:['fragile','accessory']});positive(f);
  changed=false;withMethod(f.readiness,'inspect',(original,...args)=>{const value=original(...args);if(!changed){changed=true;f.readiness.outage(f.owner.scope,{...target,unavailable:true});}return value;},()=>denied(()=>quote(f)));assert.equal(changed,true);
  f.readiness.outage(f.owner.scope,{...target,unavailable:false});positive(f);
  changed=false;const generation=f.ownership.inspect(f.a.scope,'case_one').generation;
  withMethod(f.source,'observe',(original,...args)=>{const value=original(...args);if(!changed){changed=true;f.ownership.takeover(f.owner.scope,{case_id:'case_one',expected_generation:generation,reason:'operator_requested'});}return value;},()=>denied(()=>quote(f)));assert.equal(changed,true);
  positive(f,quote(f,f.owner.scope));assert.equal(f.fulfillment.effects().length,0);assert.equal(f.native.admissions().length,0);assert.equal(count(f.warehouseDb,'warehouse_effects'),0);
}));

test('CASE-M20-G01-11',()=>usingFixture(async f=>{
  const before=allState(f),direct=positive(f);assert.deepEqual(await f.service.post(f.a.scope,'dropoff-choices',{request_id:f.request.id}),direct);assert.deepEqual(allState(f),before);
  await assert.rejects(()=>new SupportService(f.kernel,f.reads).post(f.a.scope,'dropoff-choices',{request_id:f.request.id}),/DROPOFF_NOT_CONFIGURED/);
  for(const bad of [{destinations:{...f.destinations},hubs:f.hubs,source:f.source},{destinations:f.destinations,hubs:{...f.hubs},source:f.source},{destinations:f.destinations,hubs:f.hubs,source:{...f.source}}])denied(()=>new DropoffChoices(f.kernel,bad as any));
  denied(()=>new SupportService(f.kernel,f.reads,{dropoffChoices:{...f.choices}} as any));
  const otherDb=new DatabaseSync(join(f.directory,'dropoff-other-core.sqlite'));try{const other=new CommerceKernel(otherDb,f.now);
    denied(()=>new DropoffChoices(other,{destinations:f.destinations,hubs:f.hubs,source:f.source}));denied(()=>new SupportService(other,f.reads,{dropoffChoices:f.choices}));
  }finally{otherDb.close();}
  withRawSources(f,{},p=>{const source=new DropoffFixtureSource({fulfillment:p.fulfillment,partner:p.partner,warehouse:p.warehouse}),destinations=new QualifiedReturnDestinations(f.kernel,p.fulfillment),hubs=new ReverseHubs(f.kernel,p.partner,p.warehouse);
    denied(()=>new DropoffChoices(f.kernel,{destinations,hubs:f.hubs,source:f.source}));denied(()=>new DropoffChoices(f.kernel,{destinations:f.destinations,hubs,source:f.source}));denied(()=>new DropoffChoices(f.kernel,{destinations:f.destinations,hubs:f.hubs,source}));
  });positive(f);
}));

test('CASE-M20-G01-12',async()=>{
  await usingFixture(f=>{
    const privacy=new PrivacyLifecycle(f.kernel);f.kernel.require(f.owner.scope);const exported=privacy.export(f.owner.scope,E.customer_id),before=allState(f),proof=proofRows(f),source=sourceState(f);
    positive(f);positive(f);assert.deepEqual(privacy.export(f.owner.scope,E.customer_id),exported);assert.deepEqual(proofRows(f),proof);assert.deepEqual(allState(f),before);
    const declaration=directoryRow(f).body;for(const privateValue of [E.customer_id,f.request.id,'case_one',f.customerBearer,'shopper-apparel@example.invalid',...proof.map((p:Value)=>p.token_hash)])assert.equal(declaration.includes(privateValue),false);
    assert.equal(Object.keys(before.core).some(table=>table.includes('dropoff')),false);assert.equal(exported.credentials_included,false);
    assert.equal(privacy.erase(f.owner.scope,E.customer_id).status,'logically_erased');denied(()=>quote(f));assert.deepEqual(sourceState(f),source);
  });
  await usingFixture(f=>{positive(f);const source=sourceState(f);assert.equal(new PrivacyLifecycle(f.kernel).uninstall(f.owner.scope).status,'disconnected');denied(()=>quote(f));assert.deepEqual(sourceState(f),source);});
  await usingFixture(f=>{
    positive(f);const source=sourceState(f);
    // Exercise the existing local recovery gate; this is not physical restore qualification.
    f.db.prepare('INSERT INTO commerce_recovery_state VALUES(1,?,?,?,?,?)').run('dropoff_fixture_quarantine','quarantine','a'.repeat(64),'b'.repeat(64),f.now());
    try{denied(()=>quote(f));f.db.prepare("UPDATE commerce_recovery_state SET mode='diagnostic_only' WHERE id=1").run();denied(()=>quote(f));assert.deepEqual(sourceState(f),source);}finally{f.db.prepare('DELETE FROM commerce_recovery_state WHERE id=1').run();}positive(f);
  });
});
