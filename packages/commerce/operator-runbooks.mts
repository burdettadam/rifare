import {contentDigest} from './configuration-values.mts';

export type RunbookStep={command:string;method:string;permission:string;expects:string;fixture_control:boolean};
export type OperatorRunbook={version:1;id:string;steps:RunbookStep[]};
const step=(command:string,method:string,permission:string,expects:string,fixture_control=false):RunbookStep=>({command,method,permission,expects,fixture_control});
const definitions:Record<string,OperatorRunbook>={
 'ambiguous-refund':{version:1,id:'ambiguous-refund',steps:[
  step('refund.inspect','ResolutionExecution.read','operation.read','unknown'),
  step('refund.reconcile','ResolutionExecution.reconcile','operation.reconcile','accepted'),
  step('fixture.gateway.settle','WooRefundGatewayFixture.settle','fixture administration','settled',true),
  step('refund.reconcile-settled','ResolutionExecution.reconcile','operation.reconcile','settled'),
 ]},
 'lost-webhook':{version:1,id:'lost-webhook',steps:[
  step('operation.inspect','BusinessOperations.read','operation.read','unknown'),
  step('operation.reconcile','Reconciliation.one','operation.reconcile','succeeded'),
 ]},
 'expired-token':{version:1,id:'expired-token',steps:[
  step('session.inspect-expired','CommerceKernel.authorize','resource.read','ACCESS_DENIED'),
  step('session.issue-local','CommerceKernel.issueSession','local owner administration','active'),
  step('credential.probe','CredentialLifecycle.probe','secret.invoke','succeeded'),
 ]},
 'stuck-hold':{version:1,id:'stuck-hold',steps:[
  step('hold.release','OrderEdits.release','operation.dispatch','EDIT_FOREIGN_HOLD'),
  step('fixture.hold-owner-clear','OrderEditFixtureSource.clearForeignHold','independent hold owner','cleared',true),
  step('hold.release-reviewed','OrderEdits.release','operation.dispatch','released'),
 ]},
 'provider-outage':{version:1,id:'provider-outage',steps:[
  step('operation.inspect','BusinessOperations.read','operation.read','unknown'),
  step('operation.reconcile-unavailable','Reconciliation.one','operation.reconcile','unknown'),
  step('fixture.provider.recover','SyntheticJournal.arm','fixture administration','available',true),
  step('operation.reconcile','Reconciliation.one','operation.reconcile','succeeded'),
 ]},
 'restore':{version:1,id:'restore',steps:[
  step('restore.snapshot','createRecoverySnapshot','local owner administration','snapshot_ready'),
  step('restore.quarantine','restoreRecoverySnapshot','local owner administration','quarantine'),
  step('restore.inspect','CommerceKernel.get / DurableWork.claim','recovery.manage / operation.dispatch','quarantine'),
 ]},
 'agent-incident':{version:1,id:'agent-incident',steps:[
  step('agent.claim','WorkerApi.leases.issue / claim','work.claim','agent'),
  step('agent.takeover','SupportOwnership.takeover','support.takeover','human'),
  step('agent.verify-fence','WorkerApi.returnContext','work.claim','rejected'),
 ]},
};
for(const book of Object.values(definitions)){for(const item of book.steps)Object.freeze(item);Object.freeze(book.steps);Object.freeze(book);}
export const RUNBOOKS:Readonly<Record<string,OperatorRunbook>>=Object.freeze(definitions);
const unsafe=/(?:retry|releaseAll|bypass|(?:^|\s)(?:sh|bash|cmd|powershell)(?:\s|$)|[;|`$])/i;
export function validateRunbook(value:unknown):OperatorRunbook {
 const book=value as OperatorRunbook;
 if(!book||typeof book!=='object'||Object.keys(book).sort().join(',')!=='id,steps,version'||book.version!==1||!Object.hasOwn(RUNBOOKS,book.id)||!Array.isArray(book.steps))throw new Error('RUNBOOK_INVALID');
 for(const item of book.steps)if(!item||typeof item.command!=='string'||unsafe.test(item.command))throw new Error('RUNBOOK_UNSAFE_COMMAND');
 const expected=RUNBOOKS[book.id];
 if(book.steps.length!==expected.steps.length)throw new Error('RUNBOOK_STALE_COMMAND');
 for(let index=0;index<expected.steps.length;index++){
  const item=book.steps[index],current=expected.steps[index];
  if(Object.keys(item).sort().join(',')!=='command,expects,fixture_control,method,permission'||item.command!==current.command||item.method!==current.method)throw new Error('RUNBOOK_STALE_COMMAND');
  if(item.expects!==current.expects||item.permission!==current.permission||item.fixture_control!==current.fixture_control)throw new Error('RUNBOOK_STALE_TRANSITION');
 }
 return book;
}
export async function executeOperatorRunbook(book:OperatorRunbook,commands:Record<string,()=>Promise<{state:string}>|{state:string}>) {
 validateRunbook(book);const trace=[];
 for(const item of book.steps){
  if(typeof commands[item.command]!=='function')throw new Error('RUNBOOK_COMMAND_UNAVAILABLE');
  const result=await commands[item.command]();
  if(result?.state!==item.expects)throw new Error('RUNBOOK_OBSERVED_STATE_CHANGED:'+item.command);
  trace.push({command:item.command,actual_method:item.method,permission:item.permission,observed_state:result.state,fixture_control:item.fixture_control});
 }
 return {runbook_digest:contentDigest(book),trace,qualification:'local_fixture_drill',independent_operator_observed:false,live_effects:false};
}
