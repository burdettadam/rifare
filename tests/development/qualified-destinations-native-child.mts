import { DatabaseSync } from 'node:sqlite';
import { FulfillmentFixtureSource } from '../../packages/adapters/fulfillment-fixture-source.mts';

const config=JSON.parse(process.env.RIFARE_DESTINATION_CHILD??'{}'),db=new DatabaseSync(config.filename);
const source=new FulfillmentFixtureSource(db,{mode:'fixture',identity:'fulfillment-one',tenant:config.tenant,store:config.store,clock:()=>config.now});
process.stdout.write(JSON.stringify({ready:true})+'\n');
process.stdin.once('data',async()=>{
 try{const result=await source.buy(config.command);process.stdout.write(JSON.stringify({ok:true,result})+'\n');}
 catch(error){process.stdout.write(JSON.stringify({ok:false,error:error instanceof Error?error.message:'unexpected_error'})+'\n');}
 finally{db.close();}
});
