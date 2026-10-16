import { DatabaseSync } from 'node:sqlite';
import { CommerceKernel } from '../packages/commerce/kernel.mts';
import { Permissions } from '../packages/commerce/authorization.mts';
import { decimalMoney,allocateMoney,unitReturnMoney } from '../packages/commerce/money.mts';
const db=new DatabaseSync(':memory:');
try {
 const k=new CommerceKernel(db),p=new Permissions(k);k.provisionStore('demo','store');
 k.provisionMember('demo','store','owner','owner');k.provisionMember('demo','store','agent','agent');
 const owner=k.authenticate(k.issueSession('demo','store','owner')),agent=k.authenticate(k.issueSession('demo','store','agent'));
 const order=k.ingest(owner,{kind:'order',source_system:'synthetic',external_id:'ORD-DEMO',source_version:1,source_updated_at:Date.now(),customer_id:null,payload:{status:'processing'}});
 const before=p.preview(agent,'resource.read',order.id);
 p.change(owner,{actor_id:'agent',role:'agent',actions:[],resource_ids:null,expected_revision:0});
 let blocked=false;try{k.get(agent,order.id);}catch(error){blocked=error instanceof Error&&error.message==='ACCESS_DENIED';}
 const total=decimalMoney('USD','1.00');
 console.log(JSON.stringify({demonstration:'synthetic_local_no_financial_effects',role_preview:before,read_blocked_after_revocation:blocked,
  allocation:allocateMoney(total,[{id:'a',weight:'1'},{id:'b',weight:'1'},{id:'c',weight:'1'}]),
  partial_returns:['0','1','2'].map(n=>unitReturnMoney(total,'3',n,'1')),audit:p.events(owner)},null,2));
 if(!blocked)process.exitCode=1;
}finally{db.close();}
