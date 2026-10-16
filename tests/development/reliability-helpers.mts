import { executionFixture,syntheticHeaders } from './execution-helpers.mts';
import { DatabaseSync } from 'node:sqlite';
import { join,dirname } from 'node:path';
import { BusinessOperations } from '../../packages/commerce/operation-store.mts';
import { DurableWork } from '../../packages/commerce/durable-work.mts';
import { Reconciliation } from '../../packages/commerce/reconciliation.mts';
import { OperationReceipts } from '../../packages/commerce/operation-receipts.mts';
import { EventProcessor } from '../../packages/commerce/event-processing.mts';
import { WebhookInbox } from '../../packages/commerce/webhook-inbox.mts';
import { SyntheticJournal } from '../../packages/adapters/reliability/synthetic-journal.mts';
import { contentDigest } from '../../packages/commerce/configuration-values.mts';
import { CommerceKernel } from '../../packages/commerce/kernel.mts';

export function reliabilityFixture(){const f=executionFixture(),journalFile=join(dirname(f.filename),'journal.sqlite'),providerDB=new DatabaseSync(journalFile),journal=new SyntheticJournal(providerDB,f.a.tenant,f.a.store);
  const ops=new BusinessOperations(f.kernel),work=new DurableWork(f.kernel),recon=new Reconciliation(f.kernel),receipts=new OperationReceipts(f.kernel),events=new EventProcessor(f.kernel);
  const key=Buffer.alloc(32,93),inbox=new WebhookInbox(f.kernel,()=>key),route=inbox.register(f.owner.scope,{provider:'synthetic',topic:'cases/updated',shop_domain:'local.example.invalid',api_version:'2026-10',key_ref:'events-key'});
  function receive(version=1,state='open',extra:any={},delivery='delivery-'+version){const e={schema_version:1,event_id:'event-'+version,resource_id:f.order().id,source_version:version,source_updated_at:f.now(),state,...extra};
    const raw=Buffer.from(JSON.stringify(e));return inbox.receive(route.id,syntheticHeaders(route,raw,key,f.now(),delivery),raw);}
  function execute(resolution='refund',alias='request-one'){
    const p=f.gateway.prepare(f.a.scope,f.proposal('case_one',resolution)),a=f.approve(p),r=f.execute(p,a);
    const op=ops.fromReceipt(f.a.scope,{receipt_id:r.id,idempotency_key:alias,expected_receipt_digest:contentDigest(r)});work.bind(f.a.scope,op.id,journal);return {p,a,r,op};}
  function extraOperation(index:number){
    const r=f.kernel.ingest(f.a.scope,{kind:'order',source_system:'synthetic',external_id:'RECON-'+index,source_version:1,source_updated_at:f.now(),customer_id:'C-1001',payload:{status:'processing'}});
    const e=receive(index+100,'open',{resource_id:r.id},'extra-delivery-'+index);
    const op=ops.read(f.a.scope,events.process(f.a.scope,e.id).operation_id!);work.bind(f.a.scope,op.id,journal);return op;
  }
  function reopen(){const db=new DatabaseSync(f.filename),kernel=new CommerceKernel(db,f.now),scope=kernel.authenticate(f.a.bearer);return {db,kernel,scope,ops:new BusinessOperations(kernel),work:new DurableWork(kernel),recon:new Reconciliation(kernel),events:new EventProcessor(kernel),receipts:new OperationReceipts(kernel)};}
  return {...f,ops,work,recon,receipts,events,inbox,route,key,receive,executeOperation:execute,extraOperation,journal,providerDB,journalFile,reopen,
    cleanup:()=>{providerDB.close();f.cleanup();}};
}
export async function useReliability(fn:(f:ReturnType<typeof reliabilityFixture>)=>unknown){const f=reliabilityFixture();try{return await fn(f);}finally{f.cleanup();}}
