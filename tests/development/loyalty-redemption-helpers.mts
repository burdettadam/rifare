import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {loyaltyFixture,snapshot} from './loyalty-balances-helpers.mts';
import {resolutionFixture} from './resolution-helpers.mts';
import {verifiedCustomer,updateResource} from './shopper-memory-helpers.mts';
import {CommerceKernel} from '../../packages/commerce/kernel.mts';
import {LoyaltyBalances} from '../../packages/commerce/loyalty-balances.mts';
import {LoyaltyFixtureSource} from '../../packages/adapters/loyalty-fixture-source.mts';
import {LoyaltyRedemptionFixtureSource} from '../../packages/adapters/loyalty-redemption-fixture-source.mts';
import {LoyaltyRedemptions} from '../../packages/commerce/loyalty-redemptions.mts';
import {ActionGateway} from '../../packages/commerce/action-gateway.mts';
import {SupportConversations} from '../../packages/commerce/support-conversations.mts';
import {SupportOwnership} from '../../packages/commerce/support-core.mts';
import {canonical,contentDigest} from '../../packages/commerce/configuration-values.mts';
import {createRecoverySnapshot,restoreRecoverySnapshot,suppressionCheckpoint} from '../../packages/commerce/safe-recovery.mts';
import {exportMerchant,exportMerchantSuppression,importMerchant,merchantSnapshotDigest} from '../../packages/commerce/merchant-portability.mts';

export type Value=Record<string,any>;
export const EXPECTED=JSON.parse(readFileSync(new URL('../fixtures/loyalty-redemption/independent-values.json',import.meta.url),'utf8'));
export const ACTION='diagnostic.loyalty.redeem';
export const QUOTE_KIND='loyalty_redemption_quote',OP_KIND='loyalty_redemption_operation';
export const CONTEXT_FIELDS=['schema_version','case_id','resource_id','account_key','source_identity','snapshot_digest','status','reason','provider_available_points','held_points','accounted_held_points','effective_available_points','benefits','execution_authorized','production_qualified'].sort();
export const OP_FIELDS=['schema_version','operation_id','state','reason','points','unit','provider_ref','held_points','authority_revoked','restored','minimized','command_digest','source_identity','observation','execution_authorized','production_qualified','financial_effect'].sort();
export const RESULT_FIELDS=['schema_version','source_identity','source_account_id','account_key','operation_id','command_digest','points','unit','benefit_id','benefit_digest','state','reason','provider_ref','before_revision','before_digest','after_revision','after_digest','observed_at','digest'].sort();
export const COMMAND_FIELDS=['schema_version','action','operation_id','tenant_id','store_id','resource_id','source_id','source_digest','source_identity','source_account_id','account_key','subject_ref','quote_id','quote_digest','points','unit','benefit_id','benefit_digest','benefits_revision','benefits_digest','source_revision','snapshot_digest','rules_revision','rules_digest','expires_at','financial_effect'].sort();
export const count=(db:DatabaseSync,table:string)=>Number((db.prepare('SELECT count(*) n FROM '+table).get() as Value).n);
export const input=(subject:Value)=>({case_id:subject.case_id,link_id:subject.link_id,expected_generation:subject.expected_generation});

export function owners(kernel:CommerceKernel,balanceSource:LoyaltyFixtureSource,clock:()=>number){
  const balances=new LoyaltyBalances(kernel,balanceSource),redemptionSource=new LoyaltyRedemptionFixtureSource(balanceSource,clock),redemptions=new LoyaltyRedemptions(kernel,{balances,source:redemptionSource});
  return {balances,redemptionSource,redemptions,gateway:new ActionGateway(kernel,{loyalty:redemptions})};
}
export async function redemptionFixture(options:{finance?:boolean;provider?:'full'|'limited'}={}){
  const base:any=options.finance?await resolutionFixture({zeroFees:true}):loyaltyFixture(),extra:DatabaseSync[]=[],opened:Array<()=>void>=[];
  let coreClosed=false;
  try{
    let full=base.full;
    if(options.finance){
      const filename=join(base.directory,'redemption-provider.sqlite'),db=new DatabaseSync(filename);extra.push(db);
      const config={tenant_id:base.a.tenant,store_id:base.a.store,account_id:'loyalty_account',provider:options.provider??'full'};
      full={filename,db,config,source:new LoyaltyFixtureSource(db,config,base.now)};full.source.publish(snapshot(base));
    }else if(options.provider==='limited')full=base.limited;
    const conversations=base.conversations??new SupportConversations(base.kernel),ownership=base.ownership??new SupportOwnership(base.kernel),caseId=options.finance?'resolution_case':'case_one';
    const link=options.finance?conversations.link(base.a.scope,base.customer,{case_id:caseId,channel:'webchat',account_id:'loyalty_widget',external_id:'redemption_thread',history:'complete',source_revision:1}):base.link;
    const own=owners(base.kernel,full.source,base.now),catalog=own.redemptionSource.publishBenefits({revision:1,expires_at:base.now()+300000,benefits:structuredClone(EXPECTED.benefits)}),anchor=own.redemptionSource.pinAccount(EXPECTED.customer_id);
    const subject={...input({case_id:caseId,link_id:link.id,expected_generation:1}),resource_id:base.order().id,proof:base.customer,token:base.customerBearer};
    const f:any={...base,...own,full,catalog,anchor,conversations,ownership,subject,scope:base.a.scope,caseId};
    f.closeCore=()=>{if(!coreClosed){base.db.close();coreClosed=true;}};
    f.reopen=()=>{
      const db=new DatabaseSync(base.filename),providerDb=new DatabaseSync(full.filename),kernel=new CommerceKernel(db,base.now),parent=new LoyaltyFixtureSource(providerDb,full.config,base.now);
      const scope=kernel.authenticate(base.a.bearer),customer=kernel.authenticate(base.customerBearer),owner=kernel.authenticate(base.owner.bearer);let closed=false;
      const close=()=>{if(!closed){closed=true;providerDb.close();db.close();}};opened.push(close);
      return {db,kernel,...owners(kernel,parent,base.now),scope,customer,owner,close,subject:{...subject,proof:customer}};
    };
    f.cleanup=()=>{
      for(const close of opened)close();for(const db of extra)db.close();
      try{base.cleanup();}catch(error){if(!coreClosed)throw error;}
      finally{if(coreClosed)rmSync(base.directory,{recursive:true,force:true});}
    };
    return f;
  }catch(error){for(const db of extra)db.close();base.cleanup();throw error;}
}
export async function usingRedemption(fn:(f:any)=>unknown,options:{finance?:boolean;provider?:'full'|'limited'}={}){
  const f=await redemptionFixture(options);try{return await fn(f);}finally{f.cleanup();}
}
export function otherCase(f:any,caseId='loyalty_other',newOrder=false){
  let proof=f.customer,token=f.customerBearer,resource=f.order();
  if(newOrder){
    resource=f.kernel.ingest(f.a.scope,{kind:'order',source_system:'synthetic',external_id:'LOYALTY-OTHER',source_version:1,source_updated_at:f.now(),customer_id:EXPECTED.customer_id,payload:{...resource.payload}});
    const verified=verifiedCustomer(f,f.a,'LOYALTY-OTHER');proof=verified.scope;token=verified.bearer;
  }
  f.cases.create(proof,{case_id:caseId,resource_id:resource.id,profile_id:'default',policy_id:'returns'});
  const link=f.conversations.link(f.a.scope,proof,{case_id:caseId,channel:'webchat',account_id:'loyalty_widget',external_id:caseId,history:'complete',source_revision:1});
  return {...input({case_id:caseId,link_id:link.id,expected_generation:1}),resource_id:resource.id,proof,token};
}
export const context=(f:any,subject=f.subject,scope=f.scope)=>f.redemptions.context(scope,subject.proof,input(subject));
export function quote(f:any,points=400,subject=f.subject,overrides:Value={},scope=f.scope){
  const current=context(f,subject,scope);
  return f.redemptions.quote(scope,subject.proof,{...input(subject),points,unit:'points',snapshot_digest:current.snapshot_digest,benefit_id:points===200?'synthetic_reward_200':'synthetic_reward_400',...overrides});
}
export function prepared(f:any,points=400,subject=f.subject){
  const q=quote(f,points,subject),p=f.gateway.prepare(f.scope,{case_id:subject.case_id,action:ACTION,arguments:{quote_id:q.id,quote_digest:q.digest}});
  return {q,p,subject};
}
export function approved(f:any,points=400,subject=f.subject){
  const p=prepared(f,points,subject),a=f.gateway.approve(f.reviewer.scope,{preview_id:p.p.id,preview_digest:p.p.digest});return {...p,a};
}
export function execute(f:any,p:Value,scope=f.scope){
  const receipt=f.gateway.execute(scope,{preview_id:p.p.id,preview_digest:p.p.digest,approval_id:p.a.id});
  assert.equal(typeof receipt.loyalty_operation_id,'string');return {...p,receipt,id:receipt.loyalty_operation_id};
}
export const reserve=(f:any,points=400,subject=f.subject)=>execute(f,approved(f,points,subject));
export function availability(view:Value,expected:Value){
  assert.deepEqual(Object.keys(view).sort(),CONTEXT_FIELDS);assert.equal(view.status,'available');assert.equal(view.reason,'LOYALTY_CURRENT_ENTITLEMENT');
  assert.equal(view.execution_authorized,false);assert.equal(view.production_qualified,false);
  assert.deepEqual(Object.fromEntries(Object.keys(expected).map(k=>[k,view[k]])),expected);
}
export function unspendable(fn:()=>Value){
  let view:Value;try{view=fn();}catch(error){assert.ok(error instanceof Error);return;}
  assert.notEqual(view.status,'available');assert.equal(view.execution_authorized,false);
  assert.equal(typeof view.effective_available_points==='number'&&view.effective_available_points>0,false,'invalid evidence must not expose spendable capacity');
}
export const documentRows=(db:DatabaseSync,kind?:string)=>db.prepare('SELECT * FROM commerce_support_documents WHERE '+(kind?'kind=?':"kind IN ('loyalty_redemption_quote','loyalty_redemption_operation')")+' ORDER BY kind,id,version').all(...(kind?[kind]:[])) as Value[];
export const operationDocument=(db:DatabaseSync,id:string)=>db.prepare('SELECT * FROM commerce_support_documents WHERE kind=? AND id=? AND version=1').get(OP_KIND,id) as Value;
export const nativeOperation=(db:DatabaseSync,id:string)=>db.prepare('SELECT * FROM commerce_operations WHERE id=?').get(id) as Value;
export const nativeWork=(db:DatabaseSync,id:string)=>db.prepare('SELECT * FROM commerce_operation_work WHERE operation_id=?').get(id) as Value;
export function writeDocument(db:DatabaseSync,row:Value,body:Value,state=row.state){
  db.prepare('UPDATE commerce_support_documents SET body=?,digest=?,state=? WHERE tenant_id=? AND store_id=? AND kind=? AND id=? AND version=?')
    .run(canonical(body),contentDigest(body),state,row.tenant_id,row.store_id,row.kind,row.id,row.version);
}
export function restoreDocument(db:DatabaseSync,row:Value){
  db.prepare('UPDATE commerce_support_documents SET body=?,digest=?,state=?,expires_at=? WHERE tenant_id=? AND store_id=? AND kind=? AND id=? AND version=?')
    .run(row.body,row.digest,row.state,row.expires_at,row.tenant_id,row.store_id,row.kind,row.id,row.version);
}
export const sourceJournal=(f:any)=>f.full.db.prepare('SELECT * FROM fixture_loyalty_redemption_journal ORDER BY account_key,seq').all() as Value[];
export const sourceSnapshots=(f:any)=>f.full.db.prepare('SELECT * FROM fixture_loyalty_snapshots WHERE customer_id=? ORDER BY source_revision').all(EXPECTED.customer_id) as Value[];
export function sourceState(f:any){return {snapshots:sourceSnapshots(f),journal:sourceJournal(f)};}
export function assertBalances(f:any,expected:Value,revision:number){
  const rows=sourceSnapshots(f),last=rows.at(-1)!;assert.equal(last.source_revision,revision);
  const body=JSON.parse(last.body);assert.equal(body.source_revision,revision);assert.deepEqual(body.balances,expected);assert.equal(contentDigest(body),last.digest);
}
export function assertDebit(f:any,id:string,expected:Value){
  const row=sourceJournal(f).find(r=>r.operation_id===id);assert.ok(row,'independent provider journal contains original operation');
  const body=JSON.parse(row.body),result=body.result,command=body.command;
  assert.equal(row.seq,expected.seq);assert.equal(body.seq,expected.seq);assert.equal(row.account_key,f.anchor.account_key);
  assert.equal(contentDigest(body),row.digest);assert.equal(body.command_digest,contentDigest(command));
  assert.deepEqual(Object.keys(command).sort(),COMMAND_FIELDS);assert.deepEqual(Object.keys(result).sort(),RESULT_FIELDS);
  assert.equal(command.operation_id,id);assert.equal(command.points,expected.points);assert.equal(command.unit,'points');assert.equal(command.benefit_id,expected.benefit_id);
  assert.equal(command.source_identity,f.redemptionSource.identity);assert.equal(command.account_key,f.anchor.account_key);assert.equal(command.financial_effect,false);
  assert.equal(result.operation_id,id);assert.equal(result.command_digest,body.command_digest);assert.equal(result.points,expected.points);assert.equal(result.unit,'points');
  assert.equal(result.benefit_id,expected.benefit_id);assert.equal(result.benefit_digest,command.benefit_digest);assert.equal(result.state,'redeemed');assert.equal(result.reason,'LOYALTY_REDEEMED');
  assert.equal(result.source_identity,f.redemptionSource.identity);assert.equal(result.source_account_id,f.full.config.account_id);assert.equal(result.account_key,f.anchor.account_key);
  assert.equal(result.before_revision,expected.before_revision);assert.equal(result.after_revision,expected.after_revision);
  const snapshots=sourceSnapshots(f),before=snapshots.find(r=>r.source_revision===expected.before_revision)!,after=snapshots.find(r=>r.source_revision===expected.after_revision)!;
  assert.equal(result.before_digest,before.digest);assert.equal(result.after_digest,after.digest);assert.equal(result.provider_ref,'reward_'+body.command_digest.slice(0,40));
  const {digest,...raw}=result;assert.equal(digest,contentDigest(raw));
  const {source_revision:beforeRevision,balances:beforeBalances,...beforeRest}=JSON.parse(before.body),{source_revision:afterRevision,balances:afterBalances,...afterRest}=JSON.parse(after.body);
  assert.deepEqual(afterRest,beforeRest,'a redemption cannot refresh source observation, rule or expiry terms');
  return {row,body,result,command};
}
export function projection(value:Value,state:string,points=400){
  assert.deepEqual(Object.keys(value).sort(),OP_FIELDS);assert.equal(value.state,state);assert.equal(value.points,points);assert.equal(value.unit,'points');
  assert.equal(value.execution_authorized,false);assert.equal(value.production_qualified,false);assert.equal(value.financial_effect,false);
  assert.equal(value.held_points,['reserved','unknown'].includes(state)?points:0);
}
export function finances(f:any){
  return Object.fromEntries(['commerce_case_effects','commerce_resolution_operations','commerce_fulfillment_operations','commerce_instant_operations','commerce_shopping_carts','commerce_cart_recoveries','commerce_support_deliveries'].map(t=>[t,count(f.db,t)]));
}
export function nativeState(db:DatabaseSync,id:string){
  return {operation:nativeOperation(db,id),work:nativeWork(db,id),document:operationDocument(db,id),receipts:db.prepare('SELECT * FROM commerce_operation_receipts WHERE operation_id=? ORDER BY seq').all(id)};
}
export function withSourceMethod<T>(source:any,name:string,replacement:(original:Function,...args:any[])=>any,fn:()=>T):T{
  const prototype=Object.getPrototypeOf(source),original=prototype[name];
  prototype[name]=function(...args:any[]){return this===source?replacement(original.bind(this),...args):original.apply(this,args);};
  try{return fn();}finally{prototype[name]=original;}
}
export function minimized(db:DatabaseSync,operation:string,customerToken:string,proofHash:string){
  const rows=documentRows(db),row=operationDocument(db,operation);assert.ok(row);
  const body=JSON.parse(row.body);assert.equal(body.minimized,true);assert.equal(body.authority_revoked,true);
  const raw=JSON.stringify(rows);for(const forbidden of [EXPECTED.customer_id,customerToken,proofHash,'shopper-apparel@example.invalid'])assert.equal(raw.includes(forbidden),false,'minimized loyalty rows retain no '+forbidden.slice(0,12));
  assert.equal(contentDigest(body),row.digest);
  return body;
}
export function retireCurrentSubject(f:any){
  const rows=f.db.prepare("SELECT * FROM commerce_resources WHERE tenant_id=? AND store_id=? AND (customer_id=? OR (kind='customer' AND external_id=?)) ORDER BY id").all(f.a.tenant,f.a.store,EXPECTED.customer_id,EXPECTED.customer_id) as Value[];
  for(const row of rows){
    // A source correction can leave only historical loyalty subject records.
    if(row.kind==='customer')f.db.prepare('DELETE FROM commerce_resources WHERE id=?').run(row.id);
    else updateResource(f,{...row,payload:JSON.parse(row.payload)},JSON.parse(row.payload),'C-1002');
  }
}
export const backup=(f:any,label='loyalty_backup')=>createRecoverySnapshot(f.kernel,join(f.directory,label));
export function restore(f:any,saved:any,label='loyalty_restored',suppression=suppressionCheckpoint(f.kernel)){
  const result=restoreRecoverySnapshot({snapshot:saved.directory,destination:join(f.directory,label),manifest_sha256:saved.manifest_sha256,suppression,suppression_sha256:contentDigest(suppression)},f.now),db=new DatabaseSync(result.database),kernel=new CommerceKernel(db,f.now);
  const scope=kernel.authenticate(kernel.issueSession(f.a.tenant,f.a.store,'owner'));
  return {result,db,kernel,scope,...owners(kernel,f.full.source,f.now),close:()=>db.close()};
}
export const merchant=(f:any,id='loyalty_merchant')=>exportMerchant(f.kernel,f.owner.scope,{snapshot_id:id});
export const suppression=(f:any)=>{const value=exportMerchantSuppression(f.kernel,f.owner.scope);return {suppression:value,suppression_sha256:merchantSnapshotDigest(value)};};
export function target(f:any){
  const db=new DatabaseSync(':memory:'),kernel=new CommerceKernel(db,f.now);kernel.provisionStore(f.a.tenant,f.a.store);kernel.provisionMember(f.a.tenant,f.a.store,'destination_owner','owner');
  const scope=kernel.authenticate(kernel.issueSession(f.a.tenant,f.a.store,'destination_owner'));
  return {db,kernel,scope,...owners(kernel,f.full.source,f.now),close:()=>db.close()};
}
export const transfer=(f:any,t:any,x:any,cp=suppression(f))=>importMerchant(t.kernel,t.scope,x,x.digest,cp);

export async function raceApprovals(f:any,items:Value[]){
  const file=fileURLToPath(new URL('./loyalty-redemption-race-worker.mts',import.meta.url)),networkGuard=fileURLToPath(new URL('../harness/network-deny.mts',import.meta.url)),children:any[]=[];
  try{
    for(const p of items){
      const child:any=spawn(process.execPath,['--experimental-strip-types','--import',networkGuard,file],{stdio:['pipe','pipe','pipe']});children.push(child);
      child.closed=new Promise<void>(resolve=>child.once('close',()=>resolve()));
      let out='',err='',resolveReady:()=>void=()=>{},rejectReady:(e:Error)=>void=()=>{},resolveDone:(v:Value)=>void=()=>{},rejectDone:(e:Error)=>void=()=>{};
      const ready=new Promise<void>((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;}),done=new Promise<Value>((resolve,reject)=>{resolveDone=resolve;rejectDone=reject;});
      // Attach rejection handlers immediately; a child failure before the barrier
      // must not leave an unhandled rejection while another process opens SQLite.
      void done.catch(()=>{});void ready.catch(()=>{});
      const timer=setTimeout(()=>{child.kill('SIGKILL');const e=new Error('LOYALTY_RACE_TIMEOUT');rejectReady(e);rejectDone(e);},15000);
      child.stdout.on('data',(chunk:Buffer)=>{out+=chunk;for(;;){const end=out.indexOf('\n');if(end<0)break;const line=out.slice(0,end);out=out.slice(end+1);if(!line)continue;
        try{const value=JSON.parse(line);if(value.ready)resolveReady();else child.result=value;}catch(error){rejectReady(error as Error);rejectDone(error as Error);}}});
      child.stderr.on('data',(chunk:Buffer)=>{err+=chunk;});
      child.on('error',(error:Error)=>{clearTimeout(timer);rejectReady(error);rejectDone(error);});
      child.on('close',(code:number)=>{clearTimeout(timer);if(code!==0||!child.result){const e=new Error('LOYALTY_RACE_CHILD '+code+' '+err);rejectReady(e);rejectDone(e);}else resolveDone(child.result);});
      child.ready=ready;child.done=done;
      child.stdin.write(JSON.stringify({core:f.filename,provider:f.full.filename,config:f.full.config,now:f.now(),bearer:f.a.bearer,
        approval:{preview_id:p.p.id,preview_digest:p.p.digest,approval_id:p.a.id}})+'\n');
    }
    await Promise.all(children.map(child=>child.ready));for(const child of children)child.stdin.end('start\n');
    return await Promise.all(children.map(child=>child.done));
  }finally{
    for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
    await Promise.allSettled(children.map(child=>child.closed));
  }
}
