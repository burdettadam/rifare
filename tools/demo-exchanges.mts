import { createExchangeDepthDemo } from '../packages/development/exchange-depth-demo.mts';
import { startCommerceServer } from '../apps/commerce-api/server.mts';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';import { join } from 'node:path';import { tmpdir } from 'node:os';
if(process.argv.length>3||process.argv.length===3&&process.argv[2]!=='--serve')throw new Error('Use no arguments or --serve');
const directory=mkdtempSync(join(tmpdir(),'rifare-exchanges-')),outboxFile=join(directory,'gift-proof.json'),f=await createExchangeDepthDemo(p=>writeFileSync(outboxFile,JSON.stringify(p,null,2),{mode:0o600}));
let app:Awaited<ReturnType<typeof startCommerceServer>>|undefined;
try{
 if(process.argv.includes('--serve')){app=await startCommerceServer({kernel:f.kernel,caps:f.caps,simulator:f.simulator,customers:f.customers,reads:f.reads,gifts:f.gifts,resolutionSource:f.source});
  const sessions=join(directory,'sessions.json');writeFileSync(sessions,JSON.stringify({operator:f.operator.token,reviewer:f.reviewer.token,owner:f.owner.token,allocation_id:f.exchangeAllocation.id,store_id:f.store,gift_id:f.giftFacts.gift_id,gift_email:f.giftFacts.recipient_email},null,2),{mode:0o600});
  console.log(JSON.stringify({catalog:app.url+'/exchanges',gift:app.url+'/gift-returns',session_file:sessions,local_gift_delivery_file:outboxFile,profile:'synthetic_only',clock:'fixed_disposable_fixture',external_calls:0},null,2));
  await new Promise<void>(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
 }else{
  const offers=f.exchanges.browse(f.operator.scope,{allocation_id:f.exchangeAllocation.id}),q=f.exchanges.quote(f.operator.scope,{allocation_id:f.exchangeAllocation.id,catalog_id:f.catalog.id}),finance=f.exchangeFinance.quote(f.operator.scope,{exchange_quote_id:q.id,exchange_quote_digest:q.digest,outcome:'additional_payment'}),receipt=f.authorize(finance),operation=await f.moneyExecution.dispatch(f.operator.scope,receipt.resolution_operation_id);
  const request=f.gifts.request({store_id:f.store,gift_id:f.giftFacts.gift_id,email:f.giftFacts.recipient_email},'demo'),proof=f.outbox.at(-1),verified=f.gifts.complete({store_id:f.store,challenge_id:request.challenge_id,proof:proof.proof});
  console.log(JSON.stringify({profile:'synthetic_only',catalog:offers.offers,quote:{original_paid_minor:q.quote.original_paid_minor,incentive_minor:q.quote.exchange_incentive_minor,replacement_minor:q.quote.replacement_minor,payment_due_minor:finance.quote.amount_minor},additional_payment:{state:operation.state,cash_settled:operation.cash_settled,source_effects:f.sourceDb.prepare('SELECT count(*) n FROM fixture_resolution_effects').get().n},gift_choices:f.gifts.choices({store_id:f.store,token:verified.token}),external_calls:0,model_required:false,production_qualified:false},null,2));
 }
}finally{await app?.close();f.cleanup();rmSync(directory,{recursive:true,force:true});}
