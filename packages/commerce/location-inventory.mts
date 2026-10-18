import { exact,id,integer } from './kernel.mts';
import type { CommerceKernel,Row,Scope } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { WarehouseInventoryFixtureSource,INVENTORY_FIELDS } from '../adapters/warehouse-inventory-fixture-source.mts';

export { INVENTORY_FIELDS };
const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
const HASH=/^[a-f0-9]{64}$/;
function quantity(n:unknown){if(!Number.isSafeInteger(n))throw new Error('INVENTORY_INTEGRITY');return n as number;}
export function assertInventorySource(k:CommerceKernel,source:WarehouseInventoryFixtureSource,s?:Row){
  const file=(db:CommerceKernel['db'])=>(db.prepare('PRAGMA database_list').all() as Row[]).find(row=>row.name==='main')?.file;
  if(!(source instanceof WarehouseInventoryFixtureSource)||source.db===k.db||file(k.db)&&file(k.db)===file(source.db))throw new Error('SEPARATE_WAREHOUSE_SOURCE_REQUIRED');
  if(s&&(source.tenant!==s.tenant_id||source.store!==s.store_id))throw new Error('SOURCE_SCOPE_MISMATCH');
}
export function inventoryMovementCore(b:Row){return {source_identity:b.source_identity,variant_id:b.variant_id,location_id:b.location_id,movement_id:b.movement_id,delta:b.delta,ledger_seq:b.ledger_seq,previous_digest:b.previous_digest,original_movement_digest:b.original_movement_digest,anchor_id:b.anchor_id,covered_by_anchor:b.covered_by_anchor};}
export function inventorySnapshotCore(b:Row){return {observation_id:b.observation_id,source_identity:b.source_identity,variant_id:b.variant_id,location_id:b.location_id,values:b.values,covered_movement_ids:b.covered_movement_ids,field_owners:b.field_owners,anchor:b.anchor,original_snapshot_digest:b.original_snapshot_digest};}
export function inventoryRow(row:Row,allowRedacted=false):Row {if(!row)throw new Error('NOT_FOUND');let b:Row;try{b=JSON.parse(row.body);}catch{throw new Error('INVENTORY_INTEGRITY');}
  if(contentDigest(b)!==row.digest||b.redacted&&!allowRedacted)throw new Error('INVENTORY_INTEGRITY');
  for(const field of ['tenant_id','store_id','resource_id','source_identity','variant_id','location_id','movement_id','observation_id','field','id','transfer_id','operation_id','ledger_seq','previous_digest','chain_digest'])if(Object.hasOwn(row,field)&&b[field]!==row[field])throw new Error('INVENTORY_INTEGRITY');return b;
}
function nativeBody(value:Row):Row{const b=jsonValue(value),hash=b.digest;delete b.digest;if(!HASH.test(hash)||contentDigest(b)!==hash||b.redacted||b.qualification!=='synthetic_only')throw new Error('SOURCE_INTEGRITY');return b;}

/** Append-linked observation ledger. Importing an observation never calls a physical executor. */
export class LocationInventory {
  readonly kernel:CommerceKernel;readonly source:WarehouseInventoryFixtureSource;
  constructor(k:CommerceKernel,source:WarehouseInventoryFixtureSource){assertInventorySource(k,source);this.kernel=k;this.source=source;}
  #scope(scope:Scope,resource:string,action='operation.read'){const s=this.kernel.authorize(scope,action,id(resource));assertInventorySource(this.kernel,this.source,s);this.kernel.get(scope,resource);return s;}
  #source(b:Row,s:Row){if(b.source_identity!==this.source.identity||b.tenant_id!==s.tenant_id||b.store_id!==s.store_id)throw new Error('SOURCE_IDENTITY_CHANGED');}
  #owners(s:Row,variant:string,location:string){return (this.kernel.db.prepare('SELECT * FROM commerce_inventory_owners WHERE tenant_id=? AND store_id=? AND variant_id=? AND location_id=? ORDER BY field').all(s.tenant_id,s.store_id,variant,location) as Row[]).map(row=>inventoryRow(row,true));}
  #owned(s:Row,variant:string,location:string){const owners=this.#owners(s,variant,location);if(owners.length!==INVENTORY_FIELDS.length||INVENTORY_FIELDS.some(field=>!owners.some(owner=>owner.field===field)))throw new Error('INVENTORY_OWNERSHIP_REQUIRED');if(owners.some(owner=>owner.source_identity!==this.source.identity))throw new Error('SOURCE_IDENTITY_CHANGED');return owners;}
  #queue(s:Row,resource:string,variant:string,location:string,detail:Row){const b={tenant_id:s.tenant_id,store_id:s.store_id,resource_id:resource,variant_id:variant,location_id:location,...detail},ref='inventory_issue_'+contentDigest(b).slice(0,40),body={id:ref,...b};this.kernel.db.prepare('INSERT OR IGNORE INTO commerce_inventory_discrepancies VALUES(?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,resource,ref,variant,location,canonical(body),contentDigest(body));return body;}
  claim(scope:Scope,input:unknown){const p=exact(jsonValue(input),['resource_id','variant_id','location_id','source_identity','fields']);for(const field of ['resource_id','variant_id','location_id','source_identity'])id(p[field]);
    if(!Array.isArray(p.fields)||!p.fields.length||p.fields.length>4||new Set(p.fields).size!==p.fields.length||p.fields.some((field:string)=>!INVENTORY_FIELDS.includes(field)))throw new Error('INVALID_FIELD_OWNERSHIP');
    return this.kernel.transaction(()=>{const s=this.#scope(scope,p.resource_id,'action.configure'),old=this.#owners(s,p.variant_id,p.location_id);const conflicts=p.fields.filter((field:string)=>old.some(owner=>owner.field===field&&owner.source_identity!==p.source_identity));
      if(conflicts.length||p.source_identity!==this.source.identity){const d=this.#queue(s,p.resource_id,p.variant_id,p.location_id,{code:'FIELD_OWNER_CONFLICT',claimed_source_identity:p.source_identity,authoritative_source_identity:this.source.identity,fields:[...p.fields].sort()});return {state:'discrepancy',discrepancy:d,physical_effect:false};}
      for(const field of p.fields){if(old.some(owner=>owner.field===field))continue;const body={tenant_id:s.tenant_id,store_id:s.store_id,resource_id:p.resource_id,variant_id:p.variant_id,location_id:p.location_id,field,source_identity:p.source_identity};this.kernel.db.prepare('INSERT INTO commerce_inventory_owners VALUES(?,?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,p.resource_id,p.variant_id,p.location_id,field,p.source_identity,canonical(body),contentDigest(body));}
      this.kernel.audit(scope,'inventory_owner_recorded','allowed');return {state:'claimed',source_identity:this.source.identity,fields:[...p.fields].sort(),physical_effect:false};});
  }
  #snapshots(s:Row,variant:string,location:string){const values=(this.kernel.db.prepare('SELECT * FROM commerce_inventory_snapshots WHERE tenant_id=? AND store_id=? AND variant_id=? AND location_id=? ORDER BY observation_id').all(s.tenant_id,s.store_id,variant,location) as Row[]).map(row=>{
      const b=inventoryRow(row,true);this.#source(b,s);if(typeof b.anchor!=='boolean'||!HASH.test(b.original_snapshot_digest)||contentDigest(inventorySnapshotCore(b))!==b.quantitative_digest)throw new Error('INVENTORY_INTEGRITY');exact(b.values,[...INVENTORY_FIELDS]);for(const field of INVENTORY_FIELDS)integer(b.values[field]);if(b.values.on_hand!==b.values.available+b.values.reserved)throw new Error('INVENTORY_INTEGRITY');
      if(!Array.isArray(b.covered_movement_ids)||new Set(b.covered_movement_ids).size!==b.covered_movement_ids.length)throw new Error('INVENTORY_INTEGRITY');b.covered_movement_ids.forEach(id);for(const field of INVENTORY_FIELDS)if(b.field_owners[field]!==b.source_identity)throw new Error('INVENTORY_INTEGRITY');
      if(!b.redacted){const native={...b};for(const field of ['original_snapshot_digest','anchor','quantitative_digest'])delete native[field];if(contentDigest(native)!==b.original_snapshot_digest)throw new Error('INVENTORY_INTEGRITY');}return b;});
    if(values.filter(value=>value.anchor).length>1)throw new Error('INVENTORY_INTEGRITY');return values;
  }
  #movements(s:Row,variant:string,location:string){let previous='0'.repeat(64),seq=0;return (this.kernel.db.prepare('SELECT * FROM commerce_inventory_movements WHERE tenant_id=? AND store_id=? AND variant_id=? AND location_id=? ORDER BY ledger_seq').all(s.tenant_id,s.store_id,variant,location) as Row[]).map(row=>{
      const b=inventoryRow(row,true);this.#source(b,s);if(b.ledger_seq!==++seq||b.previous_digest!==previous||contentDigest(inventoryMovementCore(b))!==b.chain_digest||!HASH.test(b.original_movement_digest)||typeof b.covered_by_anchor!=='boolean')throw new Error('INVENTORY_INTEGRITY');exact(b.delta,[...INVENTORY_FIELDS]);for(const field of INVENTORY_FIELDS)quantity(b.delta[field]);
      if(b.delta.on_hand!==b.delta.available+b.delta.reserved)throw new Error('INVENTORY_INTEGRITY');if(!b.redacted){const native={...b};for(const field of ['original_movement_digest','ledger_seq','previous_digest','chain_digest','anchor_id','covered_by_anchor'])delete native[field];if(contentDigest(native)!==b.original_movement_digest)throw new Error('INVENTORY_INTEGRITY');}previous=b.chain_digest;return b;});
  }
  #balance(s:Row,variant:string,location:string){this.#owned(s,variant,location);const snapshots=this.#snapshots(s,variant,location),anchor=snapshots.find(b=>b.anchor),movements=this.#movements(s,variant,location);
    if(!anchor)return {source_identity:this.source.identity,variant_id:variant,location_id:location,anchored:false,anchor_id:null,available:null,on_hand:null,reserved:null,in_transit:null};
    const base={...anchor.values}; // absolute snapshots establish one anchor only
    for(const movement of movements){if(anchor.covered_movement_ids.includes(movement.movement_id))continue;for(const field of INVENTORY_FIELDS)base[field]=quantity(base[field]+movement.delta[field]);}
    return {source_identity:this.source.identity,variant_id:variant,location_id:location,anchored:true,anchor_id:anchor.observation_id,...base};
  }
  balance(scope:Scope,input:unknown){const p=exact(jsonValue(input),['resource_id','variant_id','location_id']);id(p.variant_id);id(p.location_id);const s=this.#scope(scope,p.resource_id);return {...this.#balance(s,p.variant_id,p.location_id),resource_id:p.resource_id,qualification:'synthetic_only',physical_qualified:false};}
  #snapshotDifference(s:Row,b:Row){const snapshots=this.#snapshots(s,b.variant_id,b.location_id),anchor=snapshots.find(value=>value.anchor);if(!anchor)return {code:'INVENTORY_ANCHOR_REQUIRED'};
    const movements=this.#movements(s,b.variant_id,b.location_id),expected={...anchor.values},missing:string[]=[];for(const ref of new Set([...anchor.covered_movement_ids,...b.covered_movement_ids])){const direction=Number(b.covered_movement_ids.includes(ref))-Number(anchor.covered_movement_ids.includes(ref));if(!direction)continue;const movement=movements.find(value=>value.movement_id===ref);if(!movement){missing.push(ref);continue;}for(const field of INVENTORY_FIELDS)expected[field]=quantity(expected[field]+direction*movement.delta[field]);}
    if(missing.length)return {code:'MISSING_MOVEMENT_LINK',observation_id:b.observation_id,movement_ids:missing.sort()};if(!same(expected,b.values))return {code:'ABSOLUTE_STOCK_DIFFERENCE',observation_id:b.observation_id,expected,observed:b.values};return null;
  }
  importSnapshot(scope:Scope,ref:string){const native=this.source.observation(id(ref));if(!native)throw new Error('SOURCE_OBSERVATION_NOT_FOUND');const b=nativeBody(native),k=this.kernel;
    return k.transaction(()=>{const s=this.#scope(scope,b.resource_id,'operation.reconcile');k.authorize(scope,'event.process',b.resource_id);this.#source(b,s);this.#owned(s,id(b.variant_id),id(b.location_id));const old=k.db.prepare('SELECT * FROM commerce_inventory_snapshots WHERE tenant_id=? AND store_id=? AND observation_id=?').get(s.tenant_id,s.store_id,ref) as Row;
      if(old){const value=inventoryRow(old);if(value.original_snapshot_digest!==native.digest)throw new Error('OBSERVATION_CONFLICT');return {replayed:true,observation:value,physical_effect:false};}
      if(!Array.isArray(b.covered_movement_ids)||b.covered_movement_ids.length>1024)throw new Error('SOURCE_INTEGRITY');for(const covered of b.covered_movement_ids){const movement=this.source.movement(covered);if(!movement||movement.variant_id!==b.variant_id||movement.location_id!==b.location_id)throw new Error('SOURCE_INTEGRITY');}
      const previous=this.#snapshots(s,b.variant_id,b.location_id),body={...b,original_snapshot_digest:native.digest,anchor:!previous.some(value=>value.anchor),quantitative_digest:''};body.quantitative_digest=contentDigest(inventorySnapshotCore(body));
      k.db.prepare('INSERT INTO commerce_inventory_snapshots VALUES(?,?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,b.resource_id,ref,b.source_identity,b.variant_id,b.location_id,canonical(body),contentDigest(body));
      const difference=this.#snapshotDifference(s,body);if(difference)this.#queue(s,b.resource_id,b.variant_id,b.location_id,difference);k.audit(scope,'inventory_snapshot_imported','allowed');return {replayed:false,observation:body,physical_effect:false};});
  }
  importMovement(scope:Scope,ref:string){const native=this.source.movement(id(ref));if(!native)throw new Error('SOURCE_MOVEMENT_NOT_FOUND');const b=nativeBody(native),k=this.kernel;
    return k.transaction(()=>{const s=this.#scope(scope,b.resource_id,'operation.reconcile');k.authorize(scope,'event.process',b.resource_id);this.#source(b,s);this.#owned(s,id(b.variant_id),id(b.location_id));const old=k.db.prepare('SELECT * FROM commerce_inventory_movements WHERE tenant_id=? AND store_id=? AND movement_id=?').get(s.tenant_id,s.store_id,ref) as Row;
      if(old){const value=inventoryRow(old);if(value.original_movement_digest!==native.digest)throw new Error('MOVEMENT_CONFLICT');this.#movements(s,b.variant_id,b.location_id);return {replayed:true,movement:value,physical_effect:false};}
      const prior=this.#movements(s,b.variant_id,b.location_id),anchor=this.#snapshots(s,b.variant_id,b.location_id).find(value=>value.anchor),body={...b,original_movement_digest:native.digest,ledger_seq:prior.length+1,previous_digest:prior.at(-1)?.chain_digest??'0'.repeat(64),anchor_id:anchor?.observation_id??null,covered_by_anchor:anchor?.covered_movement_ids.includes(ref)??false,chain_digest:''};body.chain_digest=contentDigest(inventoryMovementCore(body));
      k.db.prepare('INSERT INTO commerce_inventory_movements VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,b.resource_id,ref,b.source_identity,b.variant_id,b.location_id,body.ledger_seq,body.previous_digest,body.chain_digest,canonical(body),contentDigest(body));
      this.#movements(s,b.variant_id,b.location_id);k.audit(scope,'inventory_movement_imported','allowed');return {replayed:false,movement:body,physical_effect:false};});
  }
  sync(scope:Scope,input:unknown){const p=exact(jsonValue(input),['resource_id']);this.#scope(scope,p.resource_id,'operation.reconcile');for(const snapshot of this.source.snapshots(p.resource_id))this.importSnapshot(scope,snapshot.observation_id);for(const movement of this.source.movements(p.resource_id))this.importMovement(scope,movement.movement_id);return this.history(scope,p);}
  discrepancies(scope:Scope,input:unknown){const p=exact(jsonValue(input),['resource_id']),s=this.#scope(scope,p.resource_id);return (this.kernel.db.prepare('SELECT * FROM commerce_inventory_discrepancies WHERE tenant_id=? AND store_id=? AND resource_id=? ORDER BY id').all(s.tenant_id,s.store_id,p.resource_id) as Row[]).map(row=>{const b=inventoryRow(row);let resolved=false;if(b.observation_id){const snapshot=this.#snapshots(s,b.variant_id,b.location_id).find(value=>value.observation_id===b.observation_id);if(snapshot)resolved=this.#snapshotDifference(s,snapshot)===null;}return {...b,resolved};});}
  history(scope:Scope,input:unknown){const p=exact(jsonValue(input),['resource_id']),s=this.#scope(scope,p.resource_id),k=this.kernel;
    const rows=(table:string)=>k.db.prepare(`SELECT * FROM ${table} WHERE tenant_id=? AND store_id=? AND resource_id=?`).all(s.tenant_id,s.store_id,p.resource_id) as Row[];
    const owners=rows('commerce_inventory_owners').map(row=>inventoryRow(row)),snapshotRows=rows('commerce_inventory_snapshots'),movementRows=rows('commerce_inventory_movements');
    const keys=new Map<string,[string,string]>();for(const row of [...snapshotRows,...movementRows])keys.set(canonical([row.variant_id,row.location_id]),[row.variant_id,row.location_id]);const snapshots:Row[]=[],movements:Row[]=[];
    for(const [variant,location] of keys.values()){snapshots.push(...this.#snapshots(s,variant,location).filter(b=>b.resource_id===p.resource_id&&!b.redacted));movements.push(...this.#movements(s,variant,location).filter(b=>b.resource_id===p.resource_id&&!b.redacted));}
    return {owners,snapshots:snapshots.sort((a,b)=>a.observation_id.localeCompare(b.observation_id)),movements:movements.sort((a,b)=>a.movement_id.localeCompare(b.movement_id)),discrepancies:this.discrepancies(scope,p),qualification:'synthetic_only'};
  }
}
