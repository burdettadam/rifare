import { DatabaseSync } from 'node:sqlite';
import { InstantExchangeFixtureSource } from '../../packages/adapters/instant-exchange-fixture-source.mts';

const p=JSON.parse(process.env.RIFARE_INSTANT_CHILD??'{}'),db=new DatabaseSync(p.filename);
const source=new InstantExchangeFixtureSource(db,{mode:'fixture',tenant:p.tenant,store:p.store,identity:'instant-source',clock:()=>p.now});
process.stdout.write(JSON.stringify({ready:true})+'\n');
await new Promise<void>(resolve=>process.stdin.once('data',()=>resolve()));
try{const result=p.kind==='capture'?await source.issue(p.input):source.confirmReceived(p.input);process.stdout.write(JSON.stringify({ok:true,result})+'\n');}
catch(error){process.stdout.write(JSON.stringify({ok:false,error:error instanceof Error?error.message:String(error)})+'\n');}
finally{db.close();}
