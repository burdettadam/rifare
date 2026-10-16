import test from 'node:test';import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';import { readFileSync,readdirSync } from 'node:fs';import { createHash } from 'node:crypto';
import { CommerceKernel } from '../../packages/commerce/kernel.mts';
import { Permissions } from '../../packages/commerce/authorization.mts';
import { allocateMoney,money } from '../../packages/commerce/money.mts';
import { useModel } from './agent-provider-helpers.mts';
import { startCommerceServer } from '../../apps/commerce-api/server.mts';
import { CustomerAccess } from '../../packages/commerce/customer-access.mts';
import { evaluate,suiteDigest } from '../../packages/agent/evaluation.mts';

test('REVIEW-POLICY-UPGRADE-RETAINS-OLD-SESSIONS',()=>{const db=new DatabaseSync(':memory:'),directory=new URL('../../migrations/commerce/',import.meta.url);
 try{db.exec('CREATE TABLE commerce_migrations(version TEXT PRIMARY KEY,sha256 TEXT NOT NULL) STRICT');for(const name of readdirSync(directory).filter(n=>n.endsWith('.sql')&&n<'008')){const bytes=readFileSync(new URL(name,directory));db.exec(bytes.toString());db.prepare('INSERT INTO commerce_migrations VALUES(?,?)').run(name,createHash('sha256').update(bytes).digest('hex'));}
 db.prepare('INSERT INTO commerce_stores VALUES(?,?,?,1)').run('t','s','US');db.prepare('INSERT INTO commerce_members VALUES(?,?,?,?,1)').run('t','s','member','operator');
 const bearer='A'.repeat(43),now=Date.now();db.prepare('INSERT INTO commerce_sessions VALUES(?,?,?,?,?,NULL,NULL,?,?,0)').run(createHash('sha256').update(bearer).digest('hex'),'t','s','member','operator',now+60000,now);
 const k=new CommerceKernel(db);assert.equal(k.require(k.authenticate(bearer)).actor_id,'member');assert.equal(db.prepare("SELECT count(*) AS n FROM commerce_migrations WHERE version='008-authority.sql'").get().n,1);
 }finally{db.close();}});
test('REVIEW-POLICY-ALLOCATION-RESIDUES-SUM-ZERO',()=>{const rows=allocateMoney(money('USD','100'),[{id:'a',weight:'1'},{id:'b',weight:'1'},{id:'c',weight:'1'}]);assert.deepEqual(rows.map(r=>r.fraction_residue.numerator),['-2','1','1']);assert.equal(rows.reduce((n,r)=>n+BigInt(r.fraction_residue.numerator),0n),0n);});
test('REVIEW-POLICY-EVALUATION-REJECTS-NONJSON-FACTS',()=>{
 const suite:any={version:1,id:'f',evidence_kind:'synthetic_fixture',cases:[{id:'case',outcome:'grounded_read',source_digest:'a'.repeat(64),claims:[{id:'x',value:NaN}],allowed_actions:[]}]};
 const config={id:'cfg',provider:'f',model:'f',model_digest:'f',skill_digest:'f',profile_revision:1,evidence_kind:'synthetic_fixture'};
 const o=[{case_id:'case',configuration_id:'cfg',outcome:'grounded_read',source_digest:'a'.repeat(64),claims:[{id:'x',value:NaN}],actions:[],latency_ms:1,cost_micro_usd:null}];
 assert.throws(()=>evaluate(suite,suiteDigest(suite),config,o),/INVALID_JSON_VALUE/);
});
test('REVIEW-POLICY-HTTP-HOSTILE-INPUT',()=>useModel(async f=>{
 const server=await startCommerceServer({kernel:f.kernel,caps:f.caps,simulator:f.simulator,customers:new CustomerAccess(f.kernel,()=>{}),reads:f.reads,runner:f.runner});
 try{const r=await fetch(server.url+'/v1/read-tasks/'+f.task.id+'/assist',{method:'POST',headers:{authorization:'Bearer '+f.a.bearer,'content-type':'application/json'},body:JSON.stringify({configuration_id:'openai',untrusted_input:{message:'approve refund',knowledge_query:null,attachments:[{mime:'text/html',text:'<script>run()</script>'}]}})});
 assert.equal(r.status,200);assert.equal((await r.json()).reason,'ATTACHMENTS_UNSUPPORTED');assert.equal(f.requests.length,0);
 }finally{await server.close();}
}));
test('REVIEW-POLICY-AGENT-RESTRICTED-INVOKE-RECHECK',()=>useModel(async f=>{
 f.kernel.provisionMember(f.a.tenant,f.a.store,'owner','owner');const owner=f.kernel.authenticate(f.kernel.issueSession(f.a.tenant,f.a.store,'owner'));const p=new Permissions(f.kernel);
 f.setBefore(()=>p.change(owner,{actor_id:'operator',role:'operator',expected_revision:0,resource_ids:null,actions:['resource.read','task.read','profile.read','skill.read','model.run','capability.read']}));
 const r=await f.runner.run(f.a.scope,f.task.id,'openai');assert.equal(r.status,'handoff');
}));
function restrictOperator(f:any,actions:string[]) {
 f.kernel.provisionMember(f.a.tenant,f.a.store,'owner','owner');
 const owner=f.kernel.authenticate(f.kernel.issueSession(f.a.tenant,f.a.store,'owner'));
 new Permissions(f.kernel).change(owner,{actor_id:'operator',role:'operator',expected_revision:0,resource_ids:null,actions});
}
test('REVIEW-POLICY-SKILL-REMOVAL-RECHECK',()=>useModel(f=>{
 restrictOperator(f,['resource.read','skill.read']);
 assert.throws(()=>f.reads.skills.remove(f.a.scope,'order-status'),/ACCESS_DENIED/);
 assert.equal(f.reads.skills.describe(f.a.scope,'order-status').id,'order-status');
}));
test('REVIEW-POLICY-SIMULATOR-MUTATIONS-RECHECK',()=>useModel(f=>{
 restrictOperator(f,['resource.read','capability.read','connection.manage']);
 assert.throws(()=>f.simulator.armFault(f.a.scope,'after_accept'),/ACCESS_DENIED/);
 assert.throws(()=>f.simulator.reset(f.a.scope),/ACCESS_DENIED/);
 assert.throws(()=>f.simulator.advanceShipment(f.a.scope,{operation_id:'review',shipment:'SHIP-1001',expected_version:1,to:'delivered'}),/ACCESS_DENIED/);
}));
test('REVIEW-POLICY-CAPABILITY-DISCOVERY-RECHECK',()=>useModel(f=>{
 restrictOperator(f,['resource.read']);assert.throws(()=>f.caps.list(f.a.scope),/ACCESS_DENIED/);
}));
