import {createInterface} from 'node:readline';
import {createReadStream,writeSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {CommerceKernel} from '../../packages/commerce/kernel.mts';
import {LoyaltyFixtureSource} from '../../packages/adapters/loyalty-fixture-source.mts';
import {LoyaltyRedemptionFixtureSource} from '../../packages/adapters/loyalty-redemption-fixture-source.mts';
import {LoyaltyBalances} from '../../packages/commerce/loyalty-balances.mts';
import {LoyaltyRedemptions} from '../../packages/commerce/loyalty-redemptions.mts';
import {ActionGateway} from '../../packages/commerce/action-gateway.mts';

// Explicit descriptors preserve the pipe protocol when a host misclassifies
// socket-backed child stdio as generic, contentless Node streams.
const input=createReadStream('',{fd:0,autoClose:false}),reader=createInterface({input,crlfDelay:Infinity}),lines=reader[Symbol.asyncIterator]();
let db:DatabaseSync|undefined,provider:DatabaseSync|undefined;
try{
  const first=await lines.next();if(first.done)throw new Error('LOYALTY_RACE_INPUT_REQUIRED');
  const p=JSON.parse(first.value),clock=()=>p.now;db=new DatabaseSync(p.core);provider=new DatabaseSync(p.provider);
  const kernel=new CommerceKernel(db,clock),balanceSource=new LoyaltyFixtureSource(provider,p.config,clock),balances=new LoyaltyBalances(kernel,balanceSource),source=new LoyaltyRedemptionFixtureSource(balanceSource,clock),loyalty=new LoyaltyRedemptions(kernel,{balances,source}),gateway=new ActionGateway(kernel,{loyalty}),scope=kernel.authenticate(p.bearer);
  writeSync(1,JSON.stringify({ready:true})+'\n');
  const signal=await lines.next();if(signal.done||signal.value!=='start')throw new Error('LOYALTY_RACE_BARRIER_REQUIRED');
  try{const receipt=gateway.execute(scope,p.approval);writeSync(1,JSON.stringify({ok:true,operation_id:receipt.loyalty_operation_id,receipt_id:receipt.id})+'\n');}
  catch(error){writeSync(1,JSON.stringify({ok:false,error:error instanceof Error?error.message:String(error)})+'\n');}
}finally{
  reader.close();input.destroy();
  try{provider?.close();}finally{db?.close();}
}
