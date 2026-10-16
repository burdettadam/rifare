import { readFileSync } from 'node:fs';import { DatabaseSync } from 'node:sqlite';
import { CommerceKernel } from '../../../packages/commerce/kernel.mts';
import { BusinessOperations } from '../../../packages/commerce/operation-store.mts';
import { EventProcessor } from '../../../packages/commerce/event-processing.mts';
import { DurableWork } from '../../../packages/commerce/durable-work.mts';
import { Reconciliation } from '../../../packages/commerce/reconciliation.mts';
import { SyntheticJournal } from '../../../packages/adapters/reliability/synthetic-journal.mts';
const p=JSON.parse(readFileSync(0,'utf8')),db=new DatabaseSync(p.filename),k=new CommerceKernel(db,()=>p.now),scope=k.authenticate(p.bearer);
let providerDB:DatabaseSync|undefined;
try{
  let result:any;const work=new DurableWork(k);
  if(p.mode==='event')result=new EventProcessor(k).process(scope,p.event_id);
  else if(p.mode==='bind')result=new BusinessOperations(k).fromReceipt(scope,p.input);
  else if(p.mode==='claim')result=work.claim(scope,p.operation_id,100);
  else {
    providerDB=new DatabaseSync(p.journal_file);const journal=new SyntheticJournal(providerDB,p.tenant,p.store);
    if(p.mode==='crash-claimed'){work.claim(scope,p.operation_id,100);process.exit(0);}
    if(p.mode==='crash-sending'){const claim=work.claim(scope,p.operation_id,100)!;work.beginSend(scope,p.operation_id,claim.lease_token);process.exit(0);}
    if(p.mode==='crash-accepted'){const claim=work.claim(scope,p.operation_id,100)!;journal.send(work.beginSend(scope,p.operation_id,claim.lease_token));process.exit(0);}
    if(p.mode==='dispatch')result=await work.dispatch(scope,p.operation_id,journal);
    else if(p.mode==='reconcile-page'){result=new Reconciliation(k).step(scope,p.run_id,journal,1);process.stdout.write(JSON.stringify(result));process.exit(0);}
    else throw new Error('FIXTURE_MODE');
  }
  process.stdout.write(JSON.stringify(result));
}finally{providerDB?.close();db.close();}
