import { exact,id,integer } from '../commerce/kernel.mts';
import type { Row } from '../commerce/kernel.mts';
import { canonical,contentDigest,jsonValue } from '../commerce/configuration-values.mts';
import { WarehouseFixtureSource } from './warehouse-fixture-source.mts';
import { ensureProcurementSourceTables,procurementCommand,bindProcurementOperation,assertProcurementGuard,procurementEffectPlan,nativeProduction } from './procurement-inventory-source-guards.mts';

export const INVENTORY_FIELDS=Object.freeze(['available','on_hand','reserved','in_transit']);
const zero=()=>({available:0,on_hand:0,reserved:0,in_transit:0});
const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
function signed(n:unknown){if(!Number.isSafeInteger(n))throw new Error('INVALID_QUANTITY');return n as number;}
function sum(a:number,b:number){return signed(a+b);}
export function inventoryTransferState(command:Row):Row{return {transfer_id:command.transfer_id,source_identity:command.source_identity,tenant_id:command.tenant_id,store_id:command.store_id,resource_id:command.resource_id,variant_id:command.variant_id,from_location:command.from_location,to_location:command.to_location,quantity:command.transfer_quantity,revision:1,reserved:0,released:0,dispatched:0,received:0,lost:0,in_transit:0,losses:[]};}
export function nextInventoryTransfer(previous:Row,command:Row):Row {
  const t=jsonValue(previous),q=integer(command.quantity,1),kind=command.kind;
  const limit=kind==='reserve'?t.quantity-t.reserved-t.dispatched-t.released:kind==='dispatch'||kind==='release'?t.reserved:kind==='receive'||kind==='lose'?t.in_transit:kind==='correct_loss'?t.losses.find((loss:Row)=>loss.operation_id===command.correction_of)?.remaining??0:-1;
  if(q>limit||limit<0)throw new Error('TRANSFER_QUANTITY_INVALID');
  if(kind==='reserve')t.reserved+=q;
  if(kind==='dispatch'){t.reserved-=q;t.dispatched+=q;t.in_transit+=q;}
  if(kind==='release'){t.reserved-=q;t.released+=q;}
  if(kind==='receive'){t.in_transit-=q;t.received+=q;}
  if(kind==='lose'){t.in_transit-=q;t.lost+=q;t.losses.push({operation_id:command.operation_id,quantity:q,remaining:q});}
  if(kind==='correct_loss'){t.lost-=q;t.received+=q;t.losses.find((loss:Row)=>loss.operation_id===command.correction_of).remaining-=q;}
  t.revision++;for(const field of ['quantity','revision','reserved','released','dispatched','received','lost','in_transit'])integer(t[field]);
  if(t.reserved+t.released+t.dispatched>t.quantity||t.received+t.lost+t.in_transit!==t.dispatched)throw new Error('TRANSFER_CONSERVATION');return t;
}

/** Separate synthetic source journal over the existing warehouse's sole available-stock store. */
export class WarehouseInventoryFixtureSource {
  readonly warehouse:WarehouseFixtureSource;readonly db:WarehouseFixtureSource['db'];readonly identity:string;readonly tenant:string;readonly store:string;readonly clock:()=>number;
  fault:'none'|'before'|'after'|'hang'='none';calls={apply:0,lookup:0};
  constructor(warehouse:WarehouseFixtureSource,options:{clock?:()=>number}={}){
    if(!(warehouse instanceof WarehouseFixtureSource)||Object.keys(options).some(key=>key!=='clock')||options.clock&&typeof options.clock!=='function')throw new Error('WAREHOUSE_SOURCE_REQUIRED');
    this.warehouse=warehouse;this.db=warehouse.db;this.identity=warehouse.identity;this.tenant=warehouse.tenant;this.store=warehouse.store;this.clock=options.clock??Date.now;
    this.db.exec(`CREATE TABLE IF NOT EXISTS warehouse_inventory_movements(movement_id TEXT PRIMARY KEY,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS warehouse_inventory_snapshots(observation_id TEXT PRIMARY KEY,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS warehouse_inventory_transfers(transfer_id TEXT PRIMARY KEY,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS warehouse_inventory_commands(operation_id TEXT PRIMARY KEY,command_digest TEXT NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;`);
    ensureProcurementSourceTables(this);
  }
  #body(row:Row|undefined):Row|null {if(!row)return null;let b:Row;try{b=JSON.parse(row.body);}catch{throw new Error('SOURCE_INTEGRITY');}if(b.redacted||contentDigest(b)!==row.digest)throw new Error('SOURCE_INTEGRITY');return b;}
  #envelope(body:Row){return {...body,digest:contentDigest(body)};}
  #scope(body:Row){if(body.source_identity!==this.identity||body.tenant_id!==this.tenant||body.store_id!==this.store)throw new Error('SOURCE_IDENTITY_CHANGED');}
  #storedMovements(){return (this.db.prepare('SELECT * FROM warehouse_inventory_movements ORDER BY movement_id').all() as Row[]).map(row=>{const b=this.#body(row)!;if(b.movement_id!==row.movement_id)throw new Error('SOURCE_INTEGRITY');this.#scope(b);return this.#envelope(b);});}
  #externalMovements(){const result:Row[]=[];
    for(const effect of this.warehouse.effects()){
      this.#scope(effect);const command={...effect};for(const key of ['id','state','adjustments','qualification'])delete command[key];
      const native=this.db.prepare('SELECT digest FROM warehouse_effects WHERE operation_id=?').get(effect.operation_id) as Row;
      if(!native||native.digest!==contentDigest(command)||effect.state!=='applied'||effect.qualification!=='synthetic_only'||!Array.isArray(effect.units)||!Array.isArray(effect.adjustments)||effect.units.length!==effect.adjustments.length)throw new Error('SOURCE_INTEGRITY');
      for(const [index,u] of effect.units.entries()){
        const a=effect.adjustments[index],expected={unit_id:u.id,variant_id:u.variant_id,location_id:effect.location_id,available_delta:effect.disposition==='restock'?1:0};if(!same(a,expected))throw new Error('SOURCE_INTEGRITY');
        const b=this.#movement({movement_id:'inventory_'+contentDigest(['return_disposition',this.identity,effect.operation_id,u.id]).slice(0,48),resource_id:effect.resource_id,variant_id:a.variant_id,location_id:a.location_id,kind:'return_disposition',delta:{available:a.available_delta,on_hand:a.available_delta,reserved:0,in_transit:0},reference_id:effect.operation_id,linked_movement_id:null,origin:{kind:'return_disposition',id:effect.operation_id,unit_id:u.id,event_id:null},observed_at:null});result.push(this.#envelope(b));
      }
    }
    const events=(this.warehouse as any).returnEvents?.()??[];
    const parentMovement=(parent:string|null,unit:Row)=>{const visited=new Set<string>();while(parent){if(visited.has(parent))throw new Error('SOURCE_INTEGRITY');visited.add(parent);const event=events.find((value:Row)=>value.event_id===parent);if(!event)throw new Error('SOURCE_INTEGRITY');let index=event.adjustments.findIndex((a:Row)=>a.unit_id===unit.unit_id&&a.variant_id===unit.variant_id&&a.location_id===unit.location_id);if(index<0)index=event.adjustments.findIndex((a:Row)=>a.unit_id===unit.unit_id);if(index>=0)return 'inventory_'+contentDigest(['return_event',this.identity,parent,index]).slice(0,48);parent=event.parent_event_id;}return null;};
    for(const event of events){this.#scope(event);const value={...event};delete value.digest;if(event.digest!==contentDigest(value)||!Array.isArray(event.adjustments))throw new Error('SOURCE_INTEGRITY');
      for(const [index,a] of event.adjustments.entries()){signed(a.available_delta);if(a.source_event_id!==event.event_id)throw new Error('SOURCE_INTEGRITY');
        const parent=a.parent_event_id??event.parent_event_id;
        const b=this.#movement({movement_id:'inventory_'+contentDigest(['return_event',this.identity,event.event_id,index]).slice(0,48),resource_id:event.resource_id,variant_id:a.variant_id,location_id:a.location_id,kind:'return_event',delta:{available:a.available_delta,on_hand:a.available_delta,reserved:0,in_transit:0},reference_id:event.event_id,linked_movement_id:parentMovement(parent,a),origin:{kind:'return_event',id:event.event_id,unit_id:a.unit_id,event_id:event.event_id},observed_at:null});result.push(this.#envelope(b));
      }
    }return result;
  }
  #movement(input:Row){for(const field of ['movement_id','resource_id','variant_id','location_id','reference_id'])id(input[field]);if(input.linked_movement_id!==null)id(input.linked_movement_id);exact(input.delta,[...INVENTORY_FIELDS]);for(const field of INVENTORY_FIELDS)signed(input.delta[field]);
    return {version:1,...input,source_identity:this.identity,tenant_id:this.tenant,store_id:this.store,qualification:'synthetic_only'};}
  movements(resourceId?:string){if(resourceId!==undefined)id(resourceId);const all=[...this.#storedMovements(),...this.#externalMovements()];if(new Set(all.map(m=>m.movement_id)).size!==all.length)throw new Error('SOURCE_MOVEMENT_ID_CONFLICT');return all.filter(m=>resourceId===undefined||m.resource_id===resourceId).sort((a,b)=>a.movement_id.localeCompare(b.movement_id));}
  movement(ref:string){return this.movements().find(m=>m.movement_id===id(ref))??null;}
  position(input:unknown){const p=exact(jsonValue(input),['variant_id','location_id']);id(p.variant_id);id(p.location_id);
    // A single SQLite statement observes available and reservation/transit rows at one source snapshot.
    const rows=this.db.prepare("SELECT 'stock' AS kind,available,NULL AS transfer_id,NULL AS body,NULL AS digest FROM warehouse_stock WHERE variant=? AND location=? UNION ALL SELECT 'transfer' AS kind,NULL AS available,transfer_id,body,digest FROM warehouse_inventory_transfers UNION ALL SELECT 'production' AS kind,NULL AS available,production_id AS transfer_id,body,digest FROM warehouse_inventory_production").all(p.variant_id,p.location_id) as Row[],native=rows.find(row=>row.kind==='stock');if(!native)throw new Error('WAREHOUSE_MAPPING_REQUIRED');const available=native.available;let reserved=0,in_transit=0;
    for(const row of rows.filter(row=>row.kind==='transfer')){const t=this.#body(row)!;this.#scope(t);if(t.transfer_id!==row.transfer_id)throw new Error('SOURCE_INTEGRITY');if(t.variant_id===p.variant_id&&t.from_location===p.location_id){reserved=sum(reserved,t.reserved);in_transit=sum(in_transit,t.in_transit);}}
    for(const row of rows.filter(row=>row.kind==='production')){const t=this.#body(row)!;this.#scope(t);if(t.production_id!==row.transfer_id||!Array.isArray(t.components))throw new Error('SOURCE_INTEGRITY');if(t.location_id===p.location_id)for(const component of t.components)if(component.variant_id===p.variant_id)reserved=sum(reserved,integer(component.reserved));}
    return {available:integer(available),on_hand:integer(sum(available,reserved)),reserved:integer(reserved),in_transit:integer(in_transit)};
  }
  snapshot(input:unknown){const p=exact(jsonValue(input),['observation_id','resource_id','variant_id','location_id']);for(const field of Object.keys(p))id(p[field]);this.db.exec('BEGIN IMMEDIATE');try{
    const old=this.observation(p.observation_id);if(old){for(const field of Object.keys(p))if(old[field]!==p[field])throw new Error('OBSERVATION_CONFLICT');this.db.exec('COMMIT');return old;}
    const covered=this.movements().filter(m=>m.variant_id===p.variant_id&&m.location_id===p.location_id).map(m=>m.movement_id).sort();if(covered.length>1024)throw new Error('INVENTORY_OBSERVATION_LIMIT');
    const body={version:1,...p,source_identity:this.identity,tenant_id:this.tenant,store_id:this.store,values:this.position({variant_id:p.variant_id,location_id:p.location_id}),field_owners:Object.fromEntries(INVENTORY_FIELDS.map(field=>[field,this.identity])),covered_movement_ids:covered,observed_at:integer(this.clock()),qualification:'synthetic_only'};
    this.db.prepare('INSERT INTO warehouse_inventory_snapshots VALUES(?,?,?)').run(p.observation_id,canonical(body),contentDigest(body));this.db.exec('COMMIT');return this.#envelope(body);}catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  observation(ref:string){const row=this.db.prepare('SELECT * FROM warehouse_inventory_snapshots WHERE observation_id=?').get(id(ref)) as Row,b=this.#body(row);if(!b)return null;this.#scope(b);if(b.observation_id!==row.observation_id)throw new Error('SOURCE_INTEGRITY');return this.#envelope(b);}
  snapshots(resourceId?:string){if(resourceId!==undefined)id(resourceId);return (this.db.prepare('SELECT observation_id FROM warehouse_inventory_snapshots ORDER BY observation_id').all() as Row[]).map(row=>this.observation(row.observation_id)!).filter(b=>resourceId===undefined||b.resource_id===resourceId);}
  #stock(variant:string,location:string,delta:number){const old=this.warehouse.stock(variant,location);if(old===null)throw new Error('WAREHOUSE_MAPPING_REQUIRED');const next=sum(old,delta);if(next<0)throw new Error('INSUFFICIENT_SOURCE_STOCK');this.db.prepare('UPDATE warehouse_stock SET available=? WHERE variant=? AND location=?').run(next,variant,location);}
  #putMovement(b:Row){this.db.prepare('INSERT INTO warehouse_inventory_movements VALUES(?,?,?)').run(b.movement_id,canonical(b),contentDigest(b));return this.#envelope(b);}
  recordMovement(input:unknown){const p=exact(jsonValue(input),['movement_id','resource_id','variant_id','location_id','kind','quantity_delta','reference_id','linked_movement_id']);for(const field of ['movement_id','resource_id','variant_id','location_id','reference_id'])id(p[field]);if(p.linked_movement_id!==null)id(p.linked_movement_id);signed(p.quantity_delta);
    if(!['receipt','adjustment','shipment'].includes(p.kind)||p.quantity_delta===0||p.kind==='receipt'&&p.quantity_delta<0||p.kind==='shipment'&&p.quantity_delta>0)throw new Error('INVALID_MOVEMENT');
    const old=this.movement(p.movement_id);if(old){const expected={resource_id:p.resource_id,variant_id:p.variant_id,location_id:p.location_id,kind:p.kind,delta:{available:p.quantity_delta,on_hand:p.quantity_delta,reserved:0,in_transit:0},reference_id:p.reference_id,linked_movement_id:p.linked_movement_id};for(const field of Object.keys(expected))if(!same(old[field],expected[field as keyof typeof expected]))throw new Error('MOVEMENT_CONFLICT');return old;}
    this.db.exec('BEGIN IMMEDIATE');try{if(p.linked_movement_id){const linked=this.movement(p.linked_movement_id);if(!linked||linked.variant_id!==p.variant_id||linked.location_id!==p.location_id)throw new Error('MOVEMENT_LINK_REQUIRED');}
      this.#stock(p.variant_id,p.location_id,p.quantity_delta);const b=this.#movement({movement_id:p.movement_id,resource_id:p.resource_id,variant_id:p.variant_id,location_id:p.location_id,kind:p.kind,delta:{available:p.quantity_delta,on_hand:p.quantity_delta,reserved:0,in_transit:0},reference_id:p.reference_id,linked_movement_id:p.linked_movement_id,origin:{kind:'operator',id:p.reference_id,unit_id:null,event_id:null},observed_at:integer(this.clock())});const result=this.#putMovement(b);this.db.exec('COMMIT');return result;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  #command(input:unknown){const c=exact(jsonValue(input),['version','operation_id','source_identity','tenant_id','store_id','resource_id','transfer_id','variant_id','from_location','to_location','transfer_quantity','expected_revision','kind','quantity','correction_of','expected_positions']);
    if(c.version!==1)throw new Error('INVALID_TRANSFER_COMMAND');for(const field of ['operation_id','source_identity','tenant_id','store_id','resource_id','transfer_id','variant_id','from_location','to_location'])id(c[field]);this.#scope(c);integer(c.transfer_quantity,1);integer(c.expected_revision,1);integer(c.quantity,1);if(c.from_location===c.to_location||c.transfer_quantity>1000000)throw new Error('INVALID_TRANSFER');
    if(c.correction_of!==null)id(c.correction_of);if((c.kind==='correct_loss')!==(c.correction_of!==null))throw new Error('TRANSFER_CORRECTION_REQUIRED');exact(c.expected_positions,['from','to']);for(const value of [c.expected_positions.from,c.expected_positions.to]){exact(value,[...INVENTORY_FIELDS]);for(const field of INVENTORY_FIELDS)integer(value[field]);}return c;
  }
  async apply(input:unknown){this.calls.apply++;const c=this.#command(input);if(this.fault==='hang')return new Promise<never>(()=>{});if(this.fault==='before'){this.fault='none';throw new Error('SOURCE_UNAVAILABLE');}let result:Row;
    this.db.exec('BEGIN IMMEDIATE');try{const old=this.db.prepare('SELECT * FROM warehouse_inventory_commands WHERE operation_id=?').get(c.operation_id) as Row;
      if(old){if(old.command_digest!==contentDigest(c))throw new Error('OPERATION_CONFLICT');result=this.#body(old)!;}
      else{const row=this.db.prepare('SELECT * FROM warehouse_inventory_transfers WHERE transfer_id=?').get(c.transfer_id) as Row,t=this.#body(row)??inventoryTransferState(c);
        if(!row&&c.kind!=='reserve')throw new Error('TRANSFER_NOT_RESERVED');for(const field of ['source_identity','tenant_id','store_id','resource_id','transfer_id','variant_id','from_location','to_location'])if(t[field]!==c[field])throw new Error('TRANSFER_IDENTITY_CONFLICT');if(t.quantity!==c.transfer_quantity||t.revision!==c.expected_revision)throw new Error('TRANSFER_REVISION_CHANGED');
        const current={from:this.position({variant_id:t.variant_id,location_id:t.from_location}),to:this.position({variant_id:t.variant_id,location_id:t.to_location})};if(!same(current,c.expected_positions))throw new Error('TRANSFER_SOURCE_CHANGED');
        const next=nextInventoryTransfer(t,c),entries:Row[]=[];let from=zero(),to=zero();
        if(c.kind==='reserve'){this.#stock(t.variant_id,t.from_location,-c.quantity); // reserve only at origin
          from={available:-c.quantity,on_hand:0,reserved:c.quantity,in_transit:0};}
        if(c.kind==='release'){this.#stock(t.variant_id,t.from_location,c.quantity);from={available:c.quantity,on_hand:0,reserved:-c.quantity,in_transit:0};}
        if(c.kind==='dispatch')from={available:0,on_hand:-c.quantity,reserved:-c.quantity,in_transit:c.quantity};
        if(c.kind==='receive'){this.#stock(t.variant_id,t.to_location,c.quantity);from={available:0,on_hand:0,reserved:0,in_transit:-c.quantity};to={available:c.quantity,on_hand:c.quantity,reserved:0,in_transit:0};}
        if(c.kind==='lose')from={available:0,on_hand:0,reserved:0,in_transit:-c.quantity};
        if(c.kind==='correct_loss'){this.#stock(t.variant_id,t.to_location,c.quantity);to={available:c.quantity,on_hand:c.quantity,reserved:0,in_transit:0};}
        this.db.prepare('INSERT INTO warehouse_inventory_transfers VALUES(?,?,?) ON CONFLICT(transfer_id) DO UPDATE SET body=excluded.body,digest=excluded.digest').run(t.transfer_id,canonical(next),contentDigest(next));
        for(const [location,delta] of [[t.from_location,from],[t.to_location,to]] as [string,Row][]){if(INVENTORY_FIELDS.every(field=>delta[field]===0))continue;const linked=c.correction_of?'inventory_'+contentDigest(['transfer',this.identity,c.correction_of,t.from_location]).slice(0,48):null;
          entries.push(this.#putMovement(this.#movement({movement_id:'inventory_'+contentDigest(['transfer',this.identity,c.operation_id,location]).slice(0,48),resource_id:t.resource_id,variant_id:t.variant_id,location_id:location,kind:c.kind,delta,reference_id:c.operation_id,linked_movement_id:linked,origin:{kind:'transfer',id:c.operation_id,unit_id:null,event_id:null},observed_at:integer(this.clock())})));}
        result={version:1,operation_id:c.operation_id,source_identity:this.identity,tenant_id:this.tenant,store_id:this.store,resource_id:c.resource_id,command_digest:contentDigest(c),command:c,state:'applied',transfer:next,movements:entries,qualification:'synthetic_only'};
        this.db.prepare('INSERT INTO warehouse_inventory_commands VALUES(?,?,?,?)').run(c.operation_id,contentDigest(c),canonical(result),contentDigest(result));
      }this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}if(this.fault==='after'){this.fault='none';throw new Error('LOST_SOURCE_RESPONSE');}return this.#envelope(result);
  }
  async lookup(ref:string){this.calls.lookup++;const row=this.db.prepare('SELECT * FROM warehouse_inventory_commands WHERE operation_id=?').get(id(ref)) as Row,b=this.#body(row);if(!b)return null;this.#scope(b);if(b.operation_id!==ref||b.command_digest!==row.command_digest||contentDigest(b.command)!==row.command_digest)throw new Error('SOURCE_INTEGRITY');return this.#envelope(b);}
  production(ref:string){return nativeProduction(this,ref);}
  bindProcurement(input:unknown){return bindProcurementOperation(this,input);}
  /** Typed, currently guarded additions use the original stock, movement and command owner. */
  async applyProcurement(input:unknown){this.calls.apply++;const c=procurementCommand(this,input);if(this.fault==='hang')return new Promise<never>(()=>{});if(this.fault==='before'){this.fault='none';throw new Error('SOURCE_UNAVAILABLE');}let result:Row;
    this.db.exec('BEGIN IMMEDIATE');try{const row=this.db.prepare('SELECT * FROM warehouse_inventory_commands WHERE operation_id=?').get(c.operation_id) as Row;
      if(row){if(row.command_digest!==contentDigest(c))throw new Error('OPERATION_CONFLICT');const old=this.#body(row)!;this.#scope(old);
        result = old; // Original procurement replay has no stock effect.
      }else{assertProcurementGuard(this,c);const plan=procurementEffectPlan(this,c),entries:Row[]=[];assertProcurementGuard(this,c);
        for(const [index,movement] of plan.movements.entries()){this.#stock(movement.variant_id,movement.location_id,movement.delta.available);entries.push(this.#putMovement(this.#movement({movement_id:'inventory_'+contentDigest(['procurement',this.identity,c.operation_id,index]).slice(0,48),resource_id:c.resource_id,variant_id:movement.variant_id,location_id:movement.location_id,kind:c.kind,delta:movement.delta,reference_id:c.operation_id,linked_movement_id:movement.linked_movement_id,origin:{kind:'procurement_inventory',id:c.operation_id,unit_id:null,event_id:c.event_id??c.receipt_id},observed_at:integer(this.clock())})));}
        if(plan.production)this.db.prepare('INSERT INTO warehouse_inventory_production VALUES(?,?,?) ON CONFLICT(production_id) DO UPDATE SET body=excluded.body,digest=excluded.digest').run(c.production_id,canonical(plan.production),contentDigest(plan.production));
        result={version:1,operation_id:c.operation_id,source_identity:this.identity,tenant_id:this.tenant,store_id:this.store,resource_id:c.resource_id,command_digest:contentDigest(c),command:c,state:'applied',receipt:plan.receipt,event:plan.event,production:plan.production,movements:entries,qualification:'synthetic_only'};
        this.db.prepare('INSERT INTO warehouse_inventory_commands VALUES(?,?,?,?)').run(c.operation_id,contentDigest(c),canonical(result),contentDigest(result));
      }this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}if(this.fault==='after'){this.fault='none';throw new Error('LOST_SOURCE_RESPONSE');}return this.#envelope(result);
  }
}
