import { CommerceKernel, boundedJSON, digest, exact, id, integer, resourceKey } from './kernel.mts';
import type { Row, Scope } from './kernel.mts';
import { Capabilities,CONTRACT_VERSION,READS } from './capabilities.mts';

export const FIXTURE_CLOCK=Date.UTC(2026,0,15,12);
const PROFILES=Object.freeze({apparel:Object.freeze({title:'Sample shirt',unit:2500,quantity:5,total:12500}),
  fragile:Object.freeze({title:'Sample bowl',unit:3200,quantity:2,total:6400})});
const MODES=['none','reject','before_accept','after_accept'];
export class StoreSimulator {
  #kernel:CommerceKernel;#caps:Capabilities;
  constructor(kernel:CommerceKernel,caps:Capabilities){this.#kernel=kernel;this.#caps=caps;}
  reset(scope:Scope,input:unknown={profile:'apparel',clock:FIXTURE_CLOCK}) {
    const s=this.#kernel.require(scope,['operator']),r=exact(input,['profile','clock']);
    if(!Object.hasOwn(PROFILES,r.profile)||r.clock!==FIXTURE_CLOCK)throw new Error('SIMULATION_ONLY');
    const p=PROFILES[r.profile as keyof typeof PROFILES],db=this.#kernel.db;
    const facts=[
      {kind:'customer',external:'C-1001',customer:null,payload:{email:'shopper-'+r.profile+'@example.invalid',name:'Synthetic shopper'}},
      {kind:'customer',external:'C-1002',customer:null,payload:{email:'other-'+r.profile+'@example.invalid',name:'Other synthetic shopper'}},
      {kind:'catalog',external:'SKU-1',customer:null,payload:{title:p.title,price_minor:p.unit,currency:'USD',available_quantity:10}},
      {kind:'order',external:'ORD-1001',customer:'C-1001',payload:{status:'shipped',currency:'USD',total_minor:p.total,items:[{sku:'SKU-1',quantity:p.quantity,unit_minor:p.unit}]}},
      {kind:'order',external:'ORD-1002',customer:'C-1002',payload:{status:'processing',currency:'USD',total_minor:p.unit,items:[{sku:'SKU-1',quantity:1,unit_minor:p.unit}]}},
      {kind:'shipment',external:'SHIP-1001',customer:'C-1001',payload:{order_number:'ORD-1001',status:'in_transit',carrier:'synthetic',tracking:'SIM-TRACK-1'}},
      {kind:'payment',external:'PAY-1001',customer:'C-1001',payload:{order_number:'ORD-1001',state:'simulated_captured',amount_minor:p.total,currency:'USD',simulated:true}},
    ];
    this.#kernel.transaction(()=>{
      for(const table of ['commerce_read_jobs','commerce_attachments','commerce_simulator_receipts'])db.prepare(`DELETE FROM ${table} WHERE tenant_id=? AND store_id=?`).run(s.tenant_id,s.store_id);
      db.prepare("DELETE FROM commerce_sessions WHERE tenant_id=? AND store_id=? AND role='customer'").run(s.tenant_id,s.store_id);
      db.prepare('DELETE FROM commerce_challenges WHERE store_id=?').run(s.store_id);
      db.prepare('DELETE FROM commerce_resources WHERE tenant_id=? AND store_id=?').run(s.tenant_id,s.store_id);
      for(const f of facts)db.prepare('INSERT INTO commerce_resources VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(s.tenant_id,s.store_id,resourceKey(s.tenant_id,s.store_id,f.kind,'synthetic',f.external),f.kind,'synthetic',f.external,1,r.clock,r.clock,f.customer,boundedJSON(f.payload));
      db.prepare(`INSERT INTO commerce_simulator VALUES(?,?,?,?,'none') ON CONFLICT(tenant_id,store_id)
        DO UPDATE SET profile=excluded.profile,clock=excluded.clock,fault='none'`).run(s.tenant_id,s.store_id,r.profile,r.clock);
      this.#caps.configure(scope,{adapter:'simulator',contract_version:CONTRACT_VERSION,granted_scopes:Object.values(READS).map(r=>r.scope),qualification:'synthetic'});
    });
    return {profile:r.profile,fixture_version:'1',clock:r.clock,resources:7,simulated:true};
  }
  armFault(scope:Scope,mode:string) {
    const s=this.#kernel.require(scope,['operator']);if(!MODES.includes(mode))throw new Error('INVALID_INPUT');
    const result=this.#kernel.db.prepare('UPDATE commerce_simulator SET fault=? WHERE tenant_id=? AND store_id=?').run(mode,s.tenant_id,s.store_id);
    if(result.changes!==1)throw new Error('SIMULATOR_NOT_INITIALIZED');
  }
  #takeFault(scope:Scope) {
    const s=this.#kernel.require(scope,['operator','worker']);const db=this.#kernel.db;
    return this.#kernel.transaction(()=>{
      const row=db.prepare('SELECT fault FROM commerce_simulator WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row;
      if(!row)throw new Error('SIMULATOR_NOT_INITIALIZED');
      db.prepare("UPDATE commerce_simulator SET fault='none' WHERE tenant_id=? AND store_id=?").run(s.tenant_id,s.store_id);
      return row.fault;
    });
  }
  read(scope:Scope,kind:string,external:string) {
    const action=Object.entries(READS).find(([,v])=>v.kind===kind)?.[0];
    if(!action)throw new Error('CAPABILITY_UNAVAILABLE');
    const resource=this.#kernel.lookup(scope,kind,'synthetic',external);
    const row=this.#caps.read(scope,action,resource.id);const fault=this.#takeFault(scope);
    if(fault==='reject')throw new Error('PROVIDER_REJECTED');
    if(fault==='before_accept')throw new Error('PROVIDER_UNAVAILABLE');
    if(fault==='after_accept')throw new Error('OUTCOME_UNKNOWN');
    return row;
  }
  receipt(scope:Scope,operationId:string) {
    const s=this.#kernel.require(scope,['operator','worker']);id(operationId);
    const row=this.#kernel.db.prepare('SELECT result FROM commerce_simulator_receipts WHERE tenant_id=? AND store_id=? AND operation_id=?')
      .get(s.tenant_id,s.store_id,operationId) as Row;
    if(!row)return {status:'unknown',simulated:true};
    return {status:'simulated_state_changed',simulated:true,result:JSON.parse(row.result)};
  }
  advanceShipment(scope:Scope,input:unknown) {
    const s=this.#kernel.require(scope,['operator']);const r=exact(input,['operation_id','shipment','expected_version','to']);
    id(r.operation_id);id(r.shipment);integer(r.expected_version,1);if(!['in_transit','delivered'].includes(r.to))throw new Error('INVALID_INPUT');
    const hash=digest(JSON.stringify([r.shipment,r.expected_version,r.to]));const db=this.#kernel.db;
    const previous=db.prepare('SELECT * FROM commerce_simulator_receipts WHERE tenant_id=? AND store_id=? AND operation_id=?')
      .get(s.tenant_id,s.store_id,r.operation_id) as Row;
    if(previous){if(previous.input_hash!==hash)throw new Error('IDEMPOTENCY_CONFLICT');return JSON.parse(previous.result);}
    const fault=this.#takeFault(scope);
    if(fault==='reject')throw new Error('PROVIDER_REJECTED');
    if(fault==='before_accept')throw new Error('PROVIDER_UNAVAILABLE');
    const result=this.#kernel.transaction(()=>{
      const shipment=this.#kernel.lookup(scope,'shipment','synthetic',r.shipment);
      if(shipment.source_version!==r.expected_version)throw new Error('SOURCE_VERSION_CONFLICT');
      const transitions:Record<string,string>={created:'in_transit',in_transit:'delivered'};
      if(transitions[shipment.payload.status]!==r.to)throw new Error('INVALID_TRANSITION');
      const state=db.prepare('SELECT clock FROM commerce_simulator WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row;
      const now=integer(state.clock+1000);
      const payload={...shipment.payload,status:r.to};
      db.prepare('UPDATE commerce_resources SET payload=?,source_version=source_version+1,source_updated_at=?,observed_at=? WHERE tenant_id=? AND store_id=? AND id=?')
        .run(boundedJSON(payload),now,now,s.tenant_id,s.store_id,shipment.id);
      db.prepare('UPDATE commerce_simulator SET clock=? WHERE tenant_id=? AND store_id=?').run(now,s.tenant_id,s.store_id);
      const snapshot=this.#kernel.get(scope,shipment.id);
      db.prepare('INSERT INTO commerce_simulator_receipts VALUES(?,?,?,?,?)').run(s.tenant_id,s.store_id,r.operation_id,hash,boundedJSON(snapshot));
      return snapshot;
    });
    if(fault==='after_accept')throw new Error('OUTCOME_UNKNOWN');return result;
  }
  replay(scope:Scope,input:unknown) {
    this.#kernel.require(scope,['operator']);const r=exact(input,['profile','operations']);
    if(!Object.hasOwn(PROFILES,r.profile)||!Array.isArray(r.operations)||r.operations.length>100)throw new Error('SIMULATION_ONLY');
    // Validate the complete request before resetting or reading anything.
    const operations=r.operations.map((value:unknown)=>{
      const op=exact(value,['kind','external_id']);id(op.external_id);
      if(!Object.values(READS).some(v=>v.kind===op.kind))throw new Error('SIMULATION_ONLY');return op;
    });
    this.reset(scope,{profile:r.profile,clock:FIXTURE_CLOCK});
    return operations.map((op:Row)=>this.read(scope,op.kind,op.external_id));
  }
}
