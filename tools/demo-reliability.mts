import { DatabaseSync } from 'node:sqlite';
import { createHmac,randomBytes } from 'node:crypto';
import { CommerceKernel } from '../packages/commerce/kernel.mts';
import { WebhookInbox } from '../packages/commerce/webhook-inbox.mts';
import { EventProcessor } from '../packages/commerce/event-processing.mts';
import { BusinessOperations } from '../packages/commerce/operation-store.mts';
import { DurableWork } from '../packages/commerce/durable-work.mts';
import { Reconciliation } from '../packages/commerce/reconciliation.mts';
import { OperationReceipts } from '../packages/commerce/operation-receipts.mts';
import { SyntheticJournal } from '../packages/adapters/reliability/synthetic-journal.mts';

if(process.argv.length!==2)throw new Error('No arguments; this demo only uses two isolated in-memory databases.');
const db=new DatabaseSync(':memory:'),source=new DatabaseSync(':memory:'),key=randomBytes(32);
try{
  let now=Date.UTC(2026,0,15,12);const k=new CommerceKernel(db,()=>now);k.provisionStore('demo','store');k.provisionMember('demo','store','owner','owner');
  const scope=k.authenticate(k.issueSession('demo','store','owner'));
  const resource=k.ingest(scope,{kind:'order',source_system:'synthetic',external_id:'ORDER-1',source_version:1,source_updated_at:now,customer_id:'customer-fixture',payload:{status:'processing'}});
  const inbox=new WebhookInbox(k,ref=>ref==='demo-key'?key:undefined),events=new EventProcessor(k),ops=new BusinessOperations(k),work=new DurableWork(k),recon=new Reconciliation(k),receipts=new OperationReceipts(k),journal=new SyntheticJournal(source,'demo','store');
  const route=inbox.register(scope,{provider:'synthetic',topic:'cases/updated',shop_domain:'demo.example.invalid',api_version:'2026-10',key_ref:'demo-key'});
  const deliver=(version:number,state:string,delivery='delivery-'+version)=>{
    const payload={schema_version:1,event_id:'event-'+version,resource_id:resource.id,source_version:version,source_updated_at:now,state},raw=Buffer.from(JSON.stringify(payload)),at=String(now);
    const prefix=JSON.stringify([route.id,route.shop_domain,route.topic,delivery,at])+'\n';
    const headers=['Content-Type','application/json','X-Rifare-Shop',route.shop_domain,'X-Rifare-Topic',route.topic,'X-Rifare-Delivery',delivery,'X-Rifare-Timestamp',at,
      'X-Rifare-Signature',createHmac('sha256',key).update(Buffer.concat([Buffer.from(prefix),raw])).digest('base64')];
    return events.process(scope,inbox.receive(route.id,headers,raw).id);
  };
  const opened=deliver(1,'open'),duplicate=deliver(1,'open','repeat-delivery'),closed=deliver(3,'closed'),delayed=deliver(2,'approved');
  const op=opened.operation_id!;journal.arm('after_accept');const ambiguous=await work.dispatch(scope,op,journal);
  await work.dispatch(scope,op,journal);const effectsBeforeRepair=journal.count(),unknownReceipt=receipts.list(scope,op).at(-1)!;
  const repaired=await recon.one(scope,op,journal),confirmedReceipt=receipts.list(scope,op).at(-1)!;
  const correction=receipts.correct(scope,{receipt_id:unknownReceipt.receipt.id,replacement_receipt_id:confirmedReceipt.receipt.id,reason:'reconciled_source'});
  journal.arm('not_sent');const retry=await work.dispatch(scope,closed.operation_id!,journal);now+=1000;await work.dispatch(scope,closed.operation_id!,journal);
  const run=recon.start(scope,journal);const pages=[];while(recon.read(scope,run.id).state!=='completed')pages.push(recon.step(scope,run.id,journal,1));
  const payload=receipts.attach(scope,{receipt_id:confirmedReceipt.receipt.id,subject_ref:'customer-fixture',kind:'customer_note',content:'Synthetic removable support note',expires_at:now+100});now+=101;
  const erased=receipts.erase(scope,payload.id);
  console.log(JSON.stringify({evidence_kind:'synthetic_two_database_demonstration',duplicate:duplicate.disposition,delayed:delayed.disposition,
    projection:events.state(scope,resource.id),lost_response_state:ambiguous.state,source_effects_before_reconciliation:effectsBeforeRepair,
    repaired:repaired.disposition,original_unknown_receipt_unchanged:receipts.read(scope,unknownReceipt.receipt.id).digest===unknownReceipt.digest,
    correction:correction.code,known_unsent_retry:retry.work.last_code,reconciliation_pages:pages.length,operation:ops.read(scope,op),
    payload_erased:erased.erased,source_effect_count:journal.count(),external_calls:0,financial_effect:false,production_qualified:false},null,2));
}finally{db.close();source.close();key.fill(0);}
