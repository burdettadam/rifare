import { readFileSync, writeFileSync, appendFileSync, existsSync, unlinkSync, realpathSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { configuration,validateRuntimeFile } from '../packages/development/config.mts';
import { SmokeStore } from '../packages/development/store.mts';
import { CommerceKernel,digest,id } from '../packages/commerce/kernel.mts';
import { CustomerAccess } from '../packages/commerce/customer-access.mts';
import { SecretVault,readWrappingKey } from '../packages/commerce/secrets.mts';
import { Capabilities } from '../packages/commerce/capabilities.mts';
import { StoreSimulator,FIXTURE_CLOCK } from '../packages/commerce/simulator.mts';
import { startCommerceServer } from '../apps/commerce-api/server.mts';

const args=process.argv.slice(2);let port=0,keyPath:string|undefined,keyId='local-wrap-v1';
for(let i=0;i<args.length;i++){
  if(args[i]==='--port')port=Number(args[++i]);
  else if(args[i]==='--wrapping-key')keyPath=args[++i];
  else if(args[i]==='--key-id')keyId=args[++i];
  else throw new Error('Use --port, --wrapping-key and --key-id only.');
}
if(!Number.isSafeInteger(port)||port<0||port>65535)throw new Error('INVALID_PORT');id(keyId);
const root=realpathSync(process.cwd()),config=configuration(root,{}),smoke=new SmokeStore(config,true);
const runFile=join(config.dataDir,'commerce-run.json'),outbox=join(config.dataDir,'commerce-outbox.jsonl');
validateRuntimeFile(runFile);validateRuntimeFile(outbox);
const owner=randomBytes(16).toString('hex');let owned=false;let closing=false;let key:Buffer|undefined;
let server:Awaited<ReturnType<typeof startCommerceServer>>|undefined;const sessions:string[]=[];
try {
  writeFileSync(runFile,JSON.stringify({state:'starting',pid:process.pid,owner}),{flag:'wx',mode:0o600});owned=true;
  key=keyPath?readWrappingKey(resolve(keyPath),root):undefined;
  const kernel=new CommerceKernel(smoke.db),caps=new Capabilities(kernel),simulator=new StoreSimulator(kernel,caps);
  const operators=[];
  for(const profile of ['apparel','fragile']){
    const tenant='demo-'+profile,store='store-'+profile;
    if(!smoke.db.prepare('SELECT 1 FROM commerce_stores WHERE tenant_id=? AND store_id=?').get(tenant,store)){
      kernel.provisionStore(tenant,store);kernel.provisionMember(tenant,store,'local-operator');kernel.provisionMember(tenant,store,'local-worker','worker');
    }
    const bearer=kernel.issueSession(tenant,store,'local-operator');sessions.push(bearer);const scope=kernel.authenticate(bearer);
    if(!smoke.db.prepare('SELECT 1 FROM commerce_simulator WHERE tenant_id=? AND store_id=?').get(tenant,store))simulator.reset(scope,{profile,clock:FIXTURE_CLOCK});
    operators.push({tenant,store,bearer,expires_in_seconds:3600});
  }
  const customers=new CustomerAccess(kernel,message=>{
    validateRuntimeFile(outbox);appendFileSync(outbox,JSON.stringify(message)+'\n',{mode:0o600});
  });
  const vault=key?new SecretVault(kernel,{activeId:keyId,get:requested=>requested===keyId?key:undefined},{'local-probe':credential=>credential.length>0}):undefined;
  server=await startCommerceServer({kernel,caps,customers,simulator,vault,port});
  writeFileSync(runFile,JSON.stringify({state:'ready',owner,pid:process.pid,url:server.url,instance_id:config.instanceId,profile:'commerce-sqlite-diagnostic',operators},null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({event:'commerce_ready',url:server.url,private_run_file:runFile,private_proof_outbox:outbox,key_loaded:!!key,production_qualified:false}));
  const stop=async()=>{
    if(closing)return;closing=true;await server?.close();
    for(const bearer of sessions)smoke.db.prepare('UPDATE commerce_sessions SET revoked=1 WHERE token_hash=?').run(digest(bearer));
    if(owned&&existsSync(runFile)&&JSON.parse(readFileSync(runFile,'utf8')).owner===owner)unlinkSync(runFile);
    smoke.close();key?.fill(0);
  };
  process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());
} catch(error) {
  await server?.close();if(owned&&existsSync(runFile)&&JSON.parse(readFileSync(runFile,'utf8')).owner===owner)unlinkSync(runFile);
  smoke.close();key?.fill(0);console.error(error instanceof Error&&['EEXIST','KEY_UNAVAILABLE'].includes((error as any).code??error.message)?'LOCAL_START_BLOCKED':'LOCAL_START_FAILED');process.exitCode=1;
}
