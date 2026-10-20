import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {linkSync} from 'node:fs';
import {LoyaltyAccrual} from '../../packages/commerce/loyalty-accrual.mts';
import {LoyaltyAccrualFixtureSource} from '../../packages/adapters/loyalty-accrual-fixture-source.mts';
import {LoyaltyBalances} from '../../packages/commerce/loyalty-balances.mts';
import {LoyaltyFixtureSource} from '../../packages/adapters/loyalty-fixture-source.mts';
import {ResolutionExecution} from '../../packages/commerce/resolution-execution.mts';
import {ExchangeLineage} from '../../packages/commerce/exchange-lineage.mts';
import {SupportService} from '../../packages/commerce/support-service.mts';
import {ExecutionStops} from '../../packages/commerce/execution-stops.mts';
import {PrivacyLifecycle} from '../../packages/commerce/privacy-lifecycle.mts';
import {CommerceKernel} from '../../packages/commerce/kernel.mts';
import {CustomerAccess} from '../../packages/commerce/customer-access.mts';
import {createRecoverySnapshot,restoreRecoverySnapshot,suppressionCheckpoint} from '../../packages/commerce/safe-recovery.mts';
import {canonical,contentDigest} from '../../packages/commerce/configuration-values.mts';
import {verifiedCustomer,updateResource} from './shopper-memory-helpers.mts';
import {usingAccrual,project,projectInput,ruleInput,balanceInput,oracle,OUTPUT_FIELDS,UNIT_FIELDS,EVENT_FIELDS,PROPOSAL_FIELDS,
  tableRows,databaseState,sourceEffect,alterEffect,restoreEffect,proposalsByUnit,appendTerminal} from './loyalty-accrual-helpers.mts';
import type {Value} from './loyalty-accrual-helpers.mts';

// Exactly twenty independent native cases; fixture money/point expectations are literals.
function nonauthorizing(view:Value) {
  for(const key of ['model_required','execution_authorized','enrollment_authorized','send_authorized','monetary_conversion_supported','production_qualified'])assert.equal(view[key],false,key);
  assert.match(view.projection_digest,/^[a-f0-9]{64}$/);assert.match(view.context_digest,/^[a-f0-9]{64}$/);
}
function event(view:Value,id:string) {const found=view.events.find((e:Value)=>e.operation_id===id);assert.ok(found,'the original financial operation must remain explicit');return found;}
function noBasis(view:Value,status:string,reason?:string) {
  assert.equal(view.status,status);if(reason!==undefined)assert.equal(view.reason,reason);
  assert.equal(view.totals,null);assert.deepEqual(view.units,[]);assert.deepEqual(view.proposals,[]);nonauthorizing(view);
}
function targetIds(view:Value) {return proposalsByUnit(view).map(p=>[p.original_line_id,p.unit_index,p.kind,p.id]);}
function writeHistorical(f:any,table:string,row:Value,change:(body:Value)=>void) {
  const body=JSON.parse(row.body);change(body);const key=table.endsWith('_rules')?'revision':'resource_id';
  f.loyaltyDb.prepare('UPDATE '+table+' SET body=?,digest=? WHERE '+key+'=?').run(canonical(body),contentDigest(body),row[key]);
}
function restoreHistorical(f:any,table:string,row:Value) {const key=table.endsWith('_rules')?'revision':'resource_id';f.loyaltyDb.prepare('UPDATE '+table+' SET body=?,digest=? WHERE '+key+'=?').run(row.body,row.digest,row[key]);}

test('CASE-M19-G02-01',()=>usingAccrual(async f=>{
  const initial=project(f);assert.equal(initial.status,'ready');assert.deepEqual(initial.totals,oracle.initial_totals);
  const journey=await f.journey(),view=project(f);assert.equal(view.status,'ready');assert.deepEqual(Object.keys(view).sort(),OUTPUT_FIELDS);
  assert.equal(view.schema_version,1);assert.equal(view.case_id,'loyalty_case');assert.equal(view.resource_id,f.order().id);
  assert.equal(view.source_revision,1);assert.equal(view.rule_revision,1);assert.match(view.rule_digest,/^[a-f0-9]{64}$/);
  assert.deepEqual(view.units,oracle.final_units);assert.deepEqual(view.totals,oracle.final_totals);nonauthorizing(view);
  assert.equal(journey.one.node.carried_minor,'1200');assert.equal(journey.one.node.replacement_retail_minor,'1400');assert.equal(journey.two.node.carried_minor,'900');
  assert.equal(journey.two.node.parent_resource_id,journey.one.node.resource_id);assert.equal(journey.two.node.generation,2);
  assert.deepEqual(view.events.map((e:Value)=>e.operation_id),[journey.first.financial.id,journey.second.financial.id,journey.refund.id].sort());
  for(const e of view.events){assert.deepEqual(Object.keys(e).sort(),EVENT_FIELDS);assert.equal(e.state,'qualified');assert.match(e.evidence_digest,/^[a-f0-9]{64}$/);}
  assert.deepEqual([event(view,journey.first.financial.id).kind,event(view,journey.first.financial.id).amount_minor,event(view,journey.first.financial.id).original_line_id],['additional_payment','200','gamma']);
  assert.deepEqual([event(view,journey.second.financial.id).kind,event(view,journey.second.financial.id).amount_minor,event(view,journey.second.financial.id).original_line_id],['refund','300','gamma']);
  assert.deepEqual([event(view,journey.refund.id).kind,event(view,journey.refund.id).amount_minor,event(view,journey.refund.id).original_line_id,event(view,journey.refund.id).unit_index],['refund','1000','alpha',1]);
  assert.equal(view.proposals.length,6);assert.equal(new Set(view.proposals.map((p:Value)=>p.id)).size,6);assert.deepEqual(targetIds(view),targetIds(initial));
  for(const p of view.proposals){assert.deepEqual(Object.keys(p).sort(),PROPOSAL_FIELDS);assert.equal(p.rule_revision,1);assert.equal(typeof p.eligible,'boolean');assert.equal(new Set(p.operation_ids).size,p.operation_ids.length);}
  assert.deepEqual(proposalsByUnit(view).map(p=>[p.original_line_id,p.unit_index,p.kind,p.points]),[
    ['alpha',1,'accrual',100],['alpha',1,'reversal',100],['alpha',2,'accrual',100],['alpha',2,'reversal',0],['gamma',1,'accrual',120],['gamma',1,'reversal',30]]);
  assert.deepEqual({financial_operations:tableRows(f.financeDb,'fixture_resolution_effects').length,additional_captures:tableRows(f.financeDb,'fixture_payment_captures').length,imported_nodes:tableRows(f.db,'commerce_exchange_lineage_nodes').length},oracle.journal_counts);
  assert.equal(f.balanceSource.observe('C-1001')!.balances.available,600,'a cumulative proposal is not a provider balance mutation');
}));

test('CASE-M19-G02-02',async()=>{
  for(const alphaFirst of [false,true])await usingAccrual(async f=>{
    const j=await f.journey({alphaFirst}),first=project(f),native=databaseState(f.financeDb);
    for(const op of [j.refund,j.second.financial,j.first.financial,j.refund])await f.financeOwner.reconcile(f.a.scope,op.id);
    for(const op of [j.second.operation,j.first.operation,j.second.operation,j.first.operation])f.lineage.materialize(f.a.scope,{operation_id:op.id});
    for(let i=0;i<3;i++){const replay=project(f);assert.deepEqual(replay.units,oracle.final_units);assert.deepEqual(replay.totals,oracle.final_totals);assert.deepEqual(targetIds(replay),targetIds(first));assert.equal(replay.events.length,3);}
    assert.deepEqual(databaseState(f.financeDb),native);assert.equal(tableRows(f.db,'commerce_exchange_lineage_nodes').length,2);
  });
});

test('CASE-M19-G02-03',()=>usingAccrual(async f=>{
  const j=await f.journey({alphaSettled:false}),accepted=project(f);
  assert.equal(accepted.status,'pending');assert.deepEqual(accepted.totals,oracle.alpha_pending_totals);assert.equal(event(accepted,j.refund.id).state,'pending');
  assert.equal(f.financeOwner.read(f.a.scope,j.refund.id).state,'accepted');
  f.financeSource.settle(j.refund.id);const sourceOnly=project(f);assert.equal(sourceOnly.status,'pending');assert.equal(event(sourceOnly,j.refund.id).state,'pending');
  assert.deepEqual(sourceOnly.totals,oracle.alpha_pending_totals,'a source result without a terminal native observation is insufficient');
  await f.financeOwner.reconcile(f.a.scope,j.refund.id);assert.deepEqual(project(f).totals,oracle.final_totals);
  const row=sourceEffect(f,j.refund.id),truth=databaseState(f.db,true);f.financeDb.prepare('DELETE FROM fixture_resolution_effects WHERE operation_id=?').run(j.refund.id);
  const missing=project(f);assert.equal(missing.status,'pending');assert.equal(event(missing,j.refund.id).state,'pending');assert.deepEqual(missing.totals,oracle.alpha_pending_totals);
  assert.deepEqual(databaseState(f.db,true),truth);assert.equal(f.financeOwner.read(f.a.scope,j.refund.id).state,'settled');
  f.financeDb.prepare('INSERT INTO fixture_resolution_effects VALUES(?,?,?,?,?)').run(row.operation_id,row.resource_id,row.command,row.digest,row.body);
  assert.deepEqual(project(f).totals,oracle.final_totals);
}));

test('M19-G02-CUMULATIVE-INTEGER-ROUNDING',()=>usingAccrual(async f=>{
  assert.deepEqual(project(f).totals,oracle.rounding.initial_totals);await f.journey();const view=project(f);
  assert.equal(view.status,'ready');assert.deepEqual(view.totals,oracle.rounding.final_totals);assert.deepEqual(view.units,oracle.rounding.final_units);
  for(const unit of view.units){assert.deepEqual(Object.keys(unit).sort(),UNIT_FIELDS);for(const key of ['earned_points','reversal_points','net_points'])assert.equal(Number.isSafeInteger(unit[key]),true);}
  assert.equal(view.units[2].earned_points,4,'200 additional minor cross the cumulative 300-minor threshold even though that event alone earns zero');
  for(const patch of [{minor_per_point:'0'},{minor_per_point:10},{minor_per_point:'1.5'},{minor_per_point:'1'.repeat(25)},{revision:1.5},{currency:'usd'},{rounding:'floor_each_event'},{retained_fees:'reverse'},{store_credit:'cash'}])
    assert.throws(()=>f.accrualSource.publishRules(ruleInput({revision:2,...patch})));
  assert.throws(()=>f.accrualSource.publishRules(ruleInput({revision:2,conversion_rate:1})));
  const getter=ruleInput({revision:2});Object.defineProperty(getter,'minor_per_point',{enumerable:true,get:()=>{throw new Error('GETTER_EXECUTED');}});
  assert.throws(()=>f.accrualSource.publishRules(getter),(error:any)=>error.message!=='GETTER_EXECUTED');
  await usingAccrual(other=>{assert.deepEqual(project(other).totals,{earned_points:0,reversal_points:0,net_points:0});},{rules:{minor_per_point:'999999999999999999999999'}});
},{rules:{minor_per_point:'300'}}));

test('M19-G02-HISTORICAL-RULE-AND-PIN',()=>usingAccrual(async f=>{
  const pin=f.accrualSource.readOriginal(f.order().id,'C-1001')!,before=databaseState(f.loyaltyDb),initial=project(f);
  assert.deepEqual(pin.rules.rules,oracle.rules);assert.equal(pin.pin.original_digest,f.pinInput.original_digest);assert.equal(pin.pin.financial_source_identity,f.financeSource.identity);
  for(const envelope of [pin.pin,pin.rules]){assert.equal(envelope.schema_version,1);assert.equal(envelope.tenant_id,'tenant-a');assert.equal(envelope.store_id,'store-a');assert.equal(envelope.account_id,'loyalty_account');assert.equal(envelope.qualification,'synthetic_only');assert.match(envelope.source_identity,/\S/);assert.notEqual(envelope.source_identity,f.balanceSource.identity);const {digest,...body}=envelope;assert.equal(digest,contentDigest(body));}
  f.accrualSource.publishRules(ruleInput());f.accrualSource.pinOriginal(f.pinInput);assert.deepEqual(databaseState(f.loyaltyDb),before);
  assert.throws(()=>f.accrualSource.publishRules(ruleInput({minor_per_point:'1'})));
  assert.throws(()=>f.accrualSource.pinOriginal({...f.pinInput,original_digest:'f'.repeat(64)}));
  f.accrualSource.publishRules(ruleInput({revision:2,minor_per_point:'1'}));assert.throws(()=>f.accrualSource.publishRules(ruleInput()));
  await f.journey();const view=project(f);assert.deepEqual(view.totals,oracle.final_totals);assert.equal(view.rule_revision,1);assert.equal(view.rule_digest,initial.rule_digest);assert.deepEqual(targetIds(view),targetIds(initial));
  assert.deepEqual(new LoyaltyAccrualFixtureSource(f.balanceSource).readOriginal(f.order().id,'C-1001'),pin);
}));

test('M19-G02-PAID-COMPONENTS-ZERO-AND-FEES',async()=>{
  await usingAccrual(f=>{const view=project(f);assert.deepEqual(view.totals,oracle.initial_totals);assert.equal(view.units[0].original_paid_minor,'1000');assert.equal(view.units[0].earned_points,100);},{components:true});
  await usingAccrual(async f=>{const first=await f.makeExchange(f.gamma,'1500'),child=f.lineage.materialize(f.a.scope,{operation_id:first.operation.id}),view=project(f);assert.equal(child.node.quantity,oracle.zero_paid.physical_quantity);assert.equal(child.node.replacement_retail_minor,oracle.zero_paid.retail_minor);assert.equal(child.node.carried_minor,'0');assert.equal(view.status,'ready');assert.deepEqual(view.totals,oracle.zero_paid.totals);assert.equal(view.units[2].earned_points,0);assert.equal(view.units[2].original_paid_minor,'0');assert.equal(tableRows(f.financeDb,'fixture_resolution_effects').length,0);},{zero:true});
  await usingAccrual(async f=>{const refund=await f.refundAlpha(),view=project(f);assert.equal(refund.q.quote.amount_minor,oracle.retained_fee.refund_minor);assert.equal(view.status,'ready');assert.deepEqual(view.totals,oracle.retained_fee.totals);assert.equal(view.units[0].settled_refund_minor,'900');assert.equal(view.units[0].net_points,10,'retained fee is not a settled refund');},{fees:true});
});

test('M19-G02-MISSING-HISTORICAL-EVIDENCE',async()=>{
  await usingAccrual(f=>{
    assert.equal(f.accrualSource.readOriginal(f.order().id,'C-1001'),null);noBasis(project(f),'pending');
    f.accrualSource.pinOriginal(f.pinInput);assert.equal(project(f).status,'ready');
    f.loyaltyDb.prepare('DELETE FROM fixture_loyalty_accrual_rules WHERE revision=1').run();noBasis(project(f),'pending');
  },{pin:false});
  await usingAccrual(f=>{noBasis(project(f),'pending');assert.equal(f.order().payload.resolution_facts.prior_refunded_minor,'1000');assert.equal(tableRows(f.financeDb,'fixture_resolution_effects').length,0);},{prior:true});
});

test('M19-G02-HISTORICAL-SOURCE-INTEGRITY',()=>usingAccrual(f=>{
  const table='fixture_loyalty_accrual_originals',pin=tableRows(f.loyaltyDb,table)[0],rules=tableRows(f.loyaltyDb,'fixture_loyalty_accrual_rules')[0];
  writeHistorical(f,table,pin,b=>{b.original_digest='0'.repeat(64);});noBasis(project(f),'discrepant');restoreHistorical(f,table,pin);
  for(const field of ['customer_id','tenant_id','store_id','account_id','source_identity']){
    writeHistorical(f,table,pin,b=>{b[field]='foreign_identity';});assert.throws(()=>f.accrualSource.readOriginal(f.order().id,'C-1001'),/LOYALTY_SCOPE_MISMATCH/);assert.throws(()=>project(f));restoreHistorical(f,table,pin);
  }
  writeHistorical(f,'fixture_loyalty_accrual_rules',rules,b=>{b.rules.rounding='floor_event';});assert.throws(()=>f.accrualSource.readOriginal(f.order().id,'C-1001'));restoreHistorical(f,'fixture_loyalty_accrual_rules',rules);
  writeHistorical(f,'fixture_loyalty_accrual_rules',rules,b=>{b.rules.revision=2;});assert.throws(()=>f.accrualSource.readOriginal(f.order().id,'C-1001'));restoreHistorical(f,'fixture_loyalty_accrual_rules',rules);
  assert.throws(()=>f.accrualSource.pinOriginal({...f.pinInput,points:9999}));
  f.loyaltyDb.prepare('UPDATE fixture_loyalty_accrual_originals SET digest=?').run('f'.repeat(64));assert.throws(()=>f.accrualSource.readOriginal(f.order().id,'C-1001'));restoreHistorical(f,table,pin);
  f.loyaltyDb.prepare('DELETE FROM fixture_loyalty_accrual_identity').run();assert.throws(()=>f.accrualSource.readOriginal(f.order().id,'C-1001'));assert.throws(()=>f.accrualSource.publishRules(ruleInput({revision:2})));assert.throws(()=>f.accrualSource.pinOriginal(f.pinInput));
}));

test('M19-G02-REFUND-TERMINAL-EVIDENCE',()=>usingAccrual(async f=>{
  const refund=await f.refundAlpha(),row=sourceEffect(f,refund.id),before=databaseState(f.db,true);
  for(const [field,value] of [['amount_minor','999'],['allocation_id','wrong_allocation'],['payment_id','wrong_payment'],['native_return_id','gid://shopify/Return/999999'],['id','wrong_native_id']]){
    alterEffect(f,row,b=>{b[field]=value;});const view=project(f);assert.equal(view.status,'discrepant');assert.equal(event(view,refund.id).state,'discrepant');assert.equal(view.totals.reversal_points,0);restoreEffect(f,row);
  }
  assert.deepEqual(databaseState(f.db,true),before);assert.equal(f.financeOwner.read(f.a.scope,refund.id).state,'settled');
  appendTerminal(f,refund.id,b=>{b.allocation_id='wrong_core_allocation';});const conflict=project(f);assert.equal(conflict.status,'discrepant');assert.equal(event(conflict,refund.id).state,'discrepant');assert.equal(conflict.totals.reversal_points,0);
}));

test('M19-G02-ADDITIONAL-CAPTURE-EVIDENCE',()=>usingAccrual(async f=>{
  const exchange=f.prepareExchange(f.gamma,'1400'),op=f.exchangeOperation(exchange.q);await f.financeOwner.dispatch(f.a.scope,op.id);
  assert.equal(event(project(f),op.id).state,'pending');assert.deepEqual(project(f).totals,oracle.initial_totals);
  f.financeSource.settlePayment(op.id,{state:'partial',paid_minor:'100'});await f.financeOwner.reconcile(f.a.scope,op.id);assert.equal(event(project(f),op.id).state,'pending');assert.deepEqual(project(f).totals,oracle.initial_totals);
  f.financeSource.settlePayment(op.id);await f.financeOwner.reconcile(f.a.scope,op.id);assert.deepEqual(project(f).totals,oracle.upgrade_totals);
  const capture=tableRows(f.financeDb,'fixture_payment_captures')[0];f.financeDb.prepare('DELETE FROM fixture_payment_captures WHERE operation_id=?').run(op.id);
  const missing=project(f);assert.equal(missing.status,'pending');assert.equal(event(missing,op.id).state,'pending');assert.deepEqual(missing.totals,oracle.initial_totals);
  f.financeDb.prepare('INSERT INTO fixture_payment_captures VALUES(?,?,?,?,?)').run(capture.operation_id,capture.resource_id,capture.allocation_id,'199',capture.currency);
  assert.equal(project(f).status,'discrepant');f.financeDb.prepare('UPDATE fixture_payment_captures SET amount_minor=? WHERE operation_id=?').run('200',op.id);
  const row=sourceEffect(f,op.id);alterEffect(f,row,b=>{b.payment.settled=false;});assert.equal(project(f).status,'discrepant');restoreEffect(f,row);
  appendTerminal(f,op.id,b=>{b.payment.obligation_id='different_obligation';});assert.equal(project(f).status,'discrepant');
  await usingAccrual(async other=>{const q=other.prepareExchange(other.gamma,'1400'),failed=other.exchangeOperation(q.q);await other.financeOwner.dispatch(other.a.scope,failed.id);
    for(const state of ['failed','expired']){other.financeSource.settlePayment(failed.id,{state,paid_minor:'0'});await other.financeOwner.reconcile(other.a.scope,failed.id);const excluded=project(other);assert.equal(event(excluded,failed.id).state,'excluded');assert.match(event(excluded,failed.id).reason,/\S/);assert.deepEqual(excluded.totals,oracle.initial_totals);}
  });
}));

test('M19-G02-SOURCE-SIDE-COMPLETENESS',()=>usingAccrual(async f=>{
  const first=await f.makeExchange(f.gamma,'1400');f.lineageSource.fault='after';assert.equal(f.lineage.materialize(f.a.scope,{operation_id:first.operation.id}).state,'unknown');
  assert.equal(tableRows(f.financeDb,'fixture_exchange_lineage_nodes').length,1);assert.equal(tableRows(f.db,'commerce_exchange_lineage_nodes').length,0);
  assert.equal(project(f).status,'pending');f.lineage.materialize(f.a.scope,{operation_id:first.operation.id});assert.equal(project(f).status,'ready');
  const node=tableRows(f.financeDb,'fixture_exchange_lineage_nodes')[0];
  for(const change of [(b:Value)=>{b.parent_digest='0'.repeat(64);},(b:Value)=>{b.funding[0].amount_minor='999';},(b:Value)=>{b.consumed_units[0].unit_index=2;},(b:Value)=>{b.currency='EUR';}]){
    const body=JSON.parse(node.body);change(body);f.financeDb.prepare('UPDATE fixture_exchange_lineage_nodes SET body=?,digest=? WHERE operation_id=?').run(canonical(body),contentDigest(body),node.operation_id);
    assert.equal(project(f).status,'discrepant','a valid hash does not establish funded ancestry');
    f.financeDb.prepare('UPDATE fixture_exchange_lineage_nodes SET body=?,digest=? WHERE operation_id=?').run(node.body,node.digest,node.operation_id);
  }
  f.financeDb.prepare('INSERT INTO fixture_payment_captures VALUES(?,?,?,?,?)').run('source_only_capture',f.order().id,'source_only_allocation','10','USD');
  assert.ok(['pending','discrepant'].includes(project(f).status),'an orphan authoritative capture prevents complete readiness');
  f.financeDb.prepare('DELETE FROM fixture_payment_captures WHERE operation_id=?').run('source_only_capture');
  f.financeDb.prepare('INSERT INTO fixture_payment_captures VALUES(?,?,?,?,?)').run('unrelated_capture','unrelated_resource','unrelated_allocation','10','USD');
  assert.equal(project(f).status,'ready','completeness is scoped to the authorized root graph');
  f.financeDb.prepare('DELETE FROM fixture_payment_captures WHERE operation_id=?').run('unrelated_capture');
  const original=sourceEffect(f,first.financial.id),command={...JSON.parse(original.command),operation_id:'source_only_effect',allocation_id:'source_only_allocation'},body={...JSON.parse(original.body),...command,id:'source_only_native'};
  f.financeDb.prepare('INSERT INTO fixture_resolution_effects VALUES(?,?,?,?,?)').run(command.operation_id,f.order().id,canonical(command),contentDigest(command),canonical(body));
  assert.ok(['pending','discrepant'].includes(project(f).status),'an effect absent from core cannot be silently omitted');
}));

test('M19-G02-UNSUPPORTED-MULTIUNIT-ATTRIBUTION',async()=>{
  await usingAccrual(async f=>{const refund=await f.refundAlpha(),view=project(f);assert.equal(view.status,'unsupported');assert.equal(event(view,refund.id).state,'unsupported');assert.equal(view.totals.reversal_points,0);assert.equal(f.financeOwner.read(f.a.scope,refund.id).state,'settled');},{multiAlpha:true});
  await usingAccrual(async f=>{const first=await f.makeExchange(f.gamma,'1400'),child=f.lineage.materialize(f.a.scope,{operation_id:first.operation.id});assert.equal(child.node.quantity,2);assert.equal(project(f).status,'unsupported');},{multiGamma:true});
});

test('M19-G02-ROOT-AND-DESCENDANT-PERMISSIONS',()=>usingAccrual(async f=>{
  const j=await f.journey(),child=await f.openChild(j.two.node,'refund'),link=f.conversations.link(f.a.scope,child.customer,{case_id:child.caseId,channel:'webchat',account_id:'loyalty_widget',external_id:'child_support_thread',history:'unavailable',source_revision:1});
  const descendant=f.projectionOwner.project(f.a.scope,child.customer,{case_id:child.caseId,link_id:link.id,expected_generation:1});
  noBasis(descendant,'unsupported','LOYALTY_ORIGINAL_SCOPE_REQUIRED');assert.equal(descendant.events.length,0);assert.equal(JSON.stringify(descendant).includes('payment-loyalty-original'),false);
  assert.equal(project(f).status,'ready');f.permissions.change(f.owner.scope,{actor_id:'operator',role:'operator',expected_revision:0,actions:null,resource_ids:[f.order().id]});
  assert.throws(()=>project(f),/ACCESS_DENIED/,'root access alone must not bypass descendant resource or operation permissions');
}));

test('M19-G02-CURRENT-CALLER-PROOF-AND-INPUT',()=>usingAccrual(f=>{
  for(const scope of [f.customer,f.agent.scope,f.b.scope,f.c.scope,{}])assert.throws(()=>project(f,{},scope));
  assert.throws(()=>project(f,{},f.a.scope,f.owner.scope));
  for(const extra of [{events:[]},{points:999},{amount_minor:'1'},{snapshot:{}},{account_id:'another_account'},{resource_id:f.order().id},{provider_thread_id:'external_thread'}])assert.throws(()=>project(f,extra));
  const getter=projectInput(f);Object.defineProperty(getter,'case_id',{enumerable:true,get:()=>{throw new Error('GETTER_EXECUTED');}});
  assert.throws(()=>f.projectionOwner.project(f.a.scope,f.customer,getter),(error:any)=>error.message!=='GETTER_EXECUTED');
  const other=verifiedCustomer(f,f.a,'ORD-1002');assert.throws(()=>project(f,{},f.a.scope,other.scope));
  const customer=f.kernel.lookup(f.a.scope,'customer','synthetic','C-1001');updateResource(f,customer,{...customer.payload,email:'current-accrual@example.invalid'});
  assert.throws(()=>project(f));const fresh=verifiedCustomer(f);assert.equal(project(f,{},f.a.scope,fresh.scope).status,'ready');f.kernel.revoke(fresh.scope);assert.throws(()=>project(f,{},f.a.scope,fresh.scope));
}));

test('M19-G02-OWNERSHIP-AND-CURRENT-AUTHORITY',()=>usingAccrual(async f=>{
  const initial=project(f);f.ownership.assign(f.owner.scope,{case_id:'loyalty_case',expected_generation:1,actor_id:'agent'});
  assert.throws(()=>project(f));assert.throws(()=>project(f,{expected_generation:2},f.agent.scope),'agent role remains excluded even after support assignment');
  f.ownership.takeover(f.owner.scope,{case_id:'loyalty_case',expected_generation:2,reason:'operator_requested'});
  const current=project(f,{expected_generation:3},f.owner.scope);assert.equal(current.status,'ready');assert.deepEqual(current.totals,initial.totals);assert.notEqual(current.projection_digest,initial.projection_digest);assert.deepEqual(targetIds(current),targetIds(initial));
  f.ownership.takeover(f.a.scope,{case_id:'loyalty_case',expected_generation:3,reason:'operator_requested'});
  await f.refundAlpha();f.permissions.change(f.owner.scope,{actor_id:'operator',role:'operator',expected_revision:0,actions:['support.read','case.read','resource.read','return.read'],resource_ids:null});
  assert.throws(()=>project(f,{expected_generation:4}),/ACCESS_DENIED/,'current financial operation permission is mandatory');
}));

test('M19-G02-NATIVE-OWNER-AND-PHYSICAL-BOUNDARIES',()=>usingAccrual(async f=>{
  for(const key of ['balances','finance','lineage','accrual'])assert.throws(()=>new LoyaltyAccrual(f.kernel,{...f.owners,[key]:{...f.owners[key as keyof typeof f.owners]}} as any));
  await usingAccrual(other=>{for(const key of ['balances','finance','lineage','accrual'])assert.throws(()=>new LoyaltyAccrual(f.kernel,{...f.owners,[key]:other.owners[key as keyof typeof other.owners]}));});
  const core=databaseState(f.db,true),alias=join(f.directory,'core-accrual-alias.sqlite');linkSync(f.filename,alias);const coreHandle=new DatabaseSync(alias);
  try{assert.throws(()=>new LoyaltyFixtureSource(coreHandle,f.balanceConfig,f.now));}finally{coreHandle.close();}
  for(const [filename,label] of [[f.financeFilename,'finance'],[f.fulfillmentFilename,'fulfillment']]){
    const aliasName=join(f.directory,label+'-accrual-alias.sqlite');linkSync(filename,aliasName);const db=new DatabaseSync(aliasName);
    try{const source=new LoyaltyFixtureSource(db,f.balanceConfig,f.now),balances=new LoyaltyBalances(f.kernel,source),accrual=new LoyaltyAccrualFixtureSource(source);assert.throws(()=>new LoyaltyAccrual(f.kernel,{...f.owners,balances,accrual}));}
    finally{db.close();}
  }
  assert.deepEqual(databaseState(f.db,true),core);assert.equal(project(f).status,'ready');
}));

test('M19-G02-CAPABILITIES-FRESHNESS-AND-CURRENCY',async()=>{
  await usingAccrual(async f=>{const j=await f.journey(),view=project(f);assert.equal(view.status,'unsupported');assert.deepEqual(view.units,oracle.final_units);assert.deepEqual(view.totals,oracle.limited_totals);for(const proposal of view.proposals.filter((p:Value)=>p.kind==='reversal'))assert.equal(proposal.eligible,false);assert.equal(f.financeOwner.read(f.a.scope,j.refund.id).state,'settled');assert.equal(f.balanceSource.observe('C-1001')!.balances.reversed,50);},{provider:'limited'});
  await usingAccrual(async f=>{const exchange=await f.makeExchange(f.gamma,'950',{outcome:'store_credit'});f.lineage.materialize(f.a.scope,{operation_id:exchange.operation.id});const view=project(f);assert.equal(view.status,'unsupported');assert.equal(event(view,exchange.financial.id).state,'unsupported');assert.equal(view.totals.reversal_points,0);assert.equal(f.financeOwner.read(f.a.scope,exchange.financial.id).state,'issued');assert.equal(tableRows(f.financeDb,'fixture_credit_accounts')[0].balance_minor,'250');});
  await usingAccrual(f=>{f.balanceSource.publish(balanceInput(f,{source_revision:2,complete:false}));noBasis(project(f),'incomplete');f.balanceSource.publish(balanceInput(f,{source_revision:3,observed_at:f.now()-300001,expires_at:f.now()-1}));noBasis(project(f),'stale');});
  await usingAccrual(f=>{noBasis(project(f),'discrepant');},{rules:{currency:'EUR'}});
});

test('M19-G02-EDITED-FACTS-AND-UNATTRIBUTED-CHANGES',()=>usingAccrual(f=>{
  const original=structuredClone(f.order().payload),changed={...original,total_minor:'5000',order_edit_observation:{return_read_models_require_refresh:true}};
  delete changed.resolution_facts;delete changed.return_lines;const old=f.order();f.kernel.ingest(f.a.scope,{kind:'order',source_system:'synthetic',external_id:old.external_id,source_version:old.source_version+1,source_updated_at:f.now(),customer_id:old.customer_id,payload:changed});
  noBasis(project(f),'pending','LOYALTY_PAID_ALLOCATIONS_REQUIRED');assert.equal(f.order().payload.total_minor,'5000');assert.equal(f.order().payload.resolution_facts,undefined);
  const now=f.order();f.kernel.ingest(f.a.scope,{kind:'order',source_system:'synthetic',external_id:now.external_id,source_version:now.source_version+1,source_updated_at:f.now(),customer_id:now.customer_id,payload:original});
  const facts=structuredClone(f.facts);facts.paid_lines[0].gross_minor='2200';facts.original_paid_minor='3200';f.update({resolution_facts:facts,total_minor:'3200'});noBasis(project(f),'discrepant');
  f.update({resolution_facts:{...f.facts,prior_refunded_minor:'1000',paid_lines:f.facts.paid_lines.map((l:Value)=>l.id==='alpha'?{...l,resolved_units:[1]}:l)},return_lines:f.lines.map(l=>l.id==='alpha'?{...l,returned:1}:l),total_minor:'3000'});
  noBasis(project(f),'pending');assert.equal(tableRows(f.financeDb,'fixture_resolution_effects').length,0,'aggregate refunded money is not a settled event');
}));

test('M19-G02-DISPATCHER-NO-EFFECT-AUTHORITY',()=>usingAccrual(async f=>{
  const service=new SupportService(f.kernel,f.reads,{loyalty:f.balances,loyaltyAccrual:f.projectionOwner}),body={customer_token:f.customerBearer,input:projectInput(f)};
  assert.throws(()=>new SupportService(f.kernel,f.reads,{loyalty:new LoyaltyBalances(f.kernel,f.balanceSource),loyaltyAccrual:f.projectionOwner}));
  new ExecutionStops(f.kernel).set(f.owner.scope,{action:'model.run',stopped:true,expected_revision:0,reason:'maintenance'});
  const core=databaseState(f.db,true),native=databaseState(f.financeDb),view=await service.post(f.a.scope,'loyalty-accrual',body) as Value;
  assert.equal(view.status,'ready');assert.deepEqual(view.totals,oracle.initial_totals);nonauthorizing(view);
  await assert.rejects(()=>new SupportService(f.kernel,f.reads).post(f.a.scope,'loyalty-accrual',body),/LOYALTY_ACCRUAL_NOT_CONFIGURED/);
  for(const action of ['loyalty-accrue','loyalty-reverse','loyalty-reserve','loyalty-redeem'])await assert.rejects(()=>service.post(f.a.scope,action,body),/SUPPORT_ROUTE_UNSUPPORTED/);
  for(const extra of [{events:[]},{eligible:true}])await assert.rejects(()=>service.post(f.a.scope,'loyalty-accrual',{...body,...extra}));
  await assert.rejects(()=>service.post(f.customer,'loyalty-accrual',body));await assert.rejects(()=>service.post(f.a.scope,'loyalty-accrual',{...body,customer_token:f.owner.bearer}));
  assert.deepEqual(databaseState(f.financeDb),native);
  // Authorization denials may add native security events; no money or points records may change.
  for(const name of Object.keys(core).filter(n=>n!=='commerce_security_events'))assert.deepEqual(databaseState(f.db,true)[name],core[name]);
  for(const method of ['accrue','reverse','reserve','redeem'])assert.equal(typeof (f.accrualSource as any)[method],'undefined');
}));

test('M19-G02-PRIVACY-RECOVERY-AND-NO-CACHE',async()=>{
  await usingAccrual(async f=>{
    await f.journey();const before=databaseState(f.db,true),finance=databaseState(f.financeDb),loyalty=databaseState(f.loyaltyDb),exported=new PrivacyLifecycle(f.kernel).export(f.owner.scope,'C-1001'),view=project(f);
    for(let i=0;i<3;i++)assert.deepEqual(project(f).totals,oracle.final_totals);
    try{view.units[0].earned_points=99999;}catch(error){assert.ok(error instanceof TypeError);}
    assert.deepEqual(new LoyaltyAccrual(f.kernel,f.owners).project(f.a.scope,f.customer,projectInput(f)).units,oracle.final_units);
    assert.deepEqual(databaseState(f.financeDb),finance);assert.deepEqual(databaseState(f.loyaltyDb),loyalty);assert.deepEqual(databaseState(f.db,true),before);
    assert.deepEqual(new PrivacyLifecycle(f.kernel).export(f.owner.scope,'C-1001'),exported);assert.equal(Object.keys(before).some(name=>name.includes('loyalty')),false);
    new PrivacyLifecycle(f.kernel).erase(f.owner.scope,'C-1001');assert.throws(()=>project(f));assert.deepEqual(databaseState(f.loyaltyDb),loyalty);
  });
  await usingAccrual(f=>{new PrivacyLifecycle(f.kernel).uninstall(f.owner.scope);assert.throws(()=>project(f));});
  await usingAccrual(f=>{
    const saved=createRecoverySnapshot(f.kernel,join(f.directory,'accrual-backup')),suppression=suppressionCheckpoint(f.kernel),restored=restoreRecoverySnapshot({snapshot:saved.directory,destination:join(f.directory,'accrual-restored'),manifest_sha256:saved.manifest_sha256,suppression,suppression_sha256:contentDigest(suppression)},f.now),db=new DatabaseSync(restored.database);
    try{const kernel=new CommerceKernel(db,f.now),owner=kernel.authenticate(kernel.issueSession(f.a.tenant,f.a.store,'owner')),balances=new LoyaltyBalances(kernel,f.balanceSource),projection=new LoyaltyAccrual(kernel,{balances,finance:new ResolutionExecution(kernel,f.financeSource),lineage:new ExchangeLineage(kernel,f.lineageSource),accrual:f.accrualSource});
      assert.throws(()=>kernel.authenticate(f.customerBearer));assert.throws(()=>projection.project(owner,f.customer,projectInput(f)));
      let proofs=0;assert.throws(()=>new CustomerAccess(kernel,()=>{proofs++;}).request({store_id:f.a.store,order_number:'ORD-1001',email:'shopper-apparel@example.invalid'},'127.0.0.1'),/RESTORE_EGRESS_BLOCKED/);assert.equal(proofs,0);assert.equal(Object.keys(databaseState(db)).some(name=>name.includes('loyalty')),false);
    }finally{db.close();}
  });
});
