import { exact, id, integer } from './kernel.mts';
import type { CommerceKernel, Row, Scope } from './kernel.mts';
import { canonical, contentDigest, jsonValue } from './configuration-values.mts';
import { CarrierQuoteFixtureSource } from '../adapters/carrier-quote-fixture-source.mts';

const MAX_PACKAGE_UNITS=128,MAX_ORDER_UNITS=1024,MAX_SESSION_SCANS=2048;
const FLAGS={qualification:'synthetic_only',physical_qualified:false,inventory_effect:false,financial_effect:false,formal_goal_accepted:false};
const unitKey=(resource:string,line:string,ordinal:number)=>contentDigest(['rifare-packing-unit-v1',resource,line,ordinal]);
const resourceDigest=(r:Row)=>contentDigest({id:r.id,source_system:r.source_system,source_version:r.source_version,source_updated_at:r.source_updated_at,payload:r.payload});
const sortedUnits=(units:Row[])=>[...units].sort((a,b)=>a.line_id.localeCompare(b.line_id)||a.ordinal-b.ordinal);
function body(row:Row) {
  let parsed:Row;try{parsed=JSON.parse(row.body);}catch{throw new Error('PACKING_BODY_INTEGRITY');}
  if(contentDigest(parsed)!==row.digest||parsed.redacted===true)throw new Error('PACKING_BODY_INTEGRITY');return parsed;
}
function requestedUnits(input:unknown) {
  if(!Array.isArray(input)||!input.length||input.length>MAX_PACKAGE_UNITS)throw new Error('INVALID_PACKING_UNITS');
  const seen=new Set<string>();
  const units=input.map(value=>{const r=exact(value,['line_id','ordinal']);id(r.line_id);integer(r.ordinal,1);
    const key=canonical([r.line_id,r.ordinal]);if(seen.has(key))throw new Error('DUPLICATE_PACKING_UNIT');seen.add(key);return r;});
  return sortedUnits(units);
}
/** Explicit current source facts; a scan never changes source quantities or stock. */
function sourceUnits(resource:Row):Row[] {
  try{
    if(resource.kind!=='order')throw new Error('INVALID_INPUT');
    const p=exact(jsonValue(resource.payload.packing),['cancelled','lines']);
    if(typeof p.cancelled!=='boolean'||!Array.isArray(p.lines)||!p.lines.length||p.lines.length>32)throw new Error('INVALID_INPUT');
    const seen=new Set<string>(),out:Row[]=[];
    for(const line of p.lines){
      exact(line,['line_id','sku','quantity','cancelled_ordinals','backordered_ordinals','shipped_ordinals','return_links']);
      id(line.line_id);id(line.sku);integer(line.quantity,1);
      if(line.quantity>512||seen.has(line.line_id)||out.length+line.quantity>MAX_ORDER_UNITS)throw new Error('INVALID_INPUT');seen.add(line.line_id);
      const excluded=new Map<number,string>();
      for(const [field,reason] of [['cancelled_ordinals','cancelled'],['backordered_ordinals','backordered'],['shipped_ordinals','shipped']]){
        if(!Array.isArray(line[field])||line[field].length>line.quantity)throw new Error('INVALID_INPUT');
        for(const ordinal of line[field]){integer(ordinal,1);if(ordinal>line.quantity||excluded.has(ordinal))throw new Error('INVALID_INPUT');excluded.set(ordinal,reason);}
      }
      if(!Array.isArray(line.return_links)||line.return_links.length>line.quantity*4)throw new Error('INVALID_INPUT');
      const links=new Map<number,string[]>();
      for(const link of line.return_links){exact(link,['ordinal','return_id']);integer(link.ordinal,1);id(link.return_id);
        if(link.ordinal>line.quantity||(links.get(link.ordinal)??[]).includes(link.return_id))throw new Error('INVALID_INPUT');
        links.set(link.ordinal,[...(links.get(link.ordinal)??[]),link.return_id]);}
      for(let ordinal=1;ordinal<=line.quantity;ordinal++){
        const reason=p.cancelled&&excluded.get(ordinal)!=='shipped'?'cancelled':excluded.get(ordinal)??null;
        out.push({line_id:line.line_id,ordinal,sku:line.sku,unit_key:unitKey(resource.id,line.line_id,ordinal),
          return_links:(links.get(ordinal)??[]).sort(),eligible:reason===null,blocked_reason:reason});
      }
    }
    return sortedUnits(out);
  }catch{throw new Error('PACKING_ORDER_FACTS_INVALID');}
}

/** Durable local allocations and scanner observations behind kernel authority. */
export class PackingSessions {
  #k:CommerceKernel;#source:CarrierQuoteFixtureSource;
  constructor(kernel:CommerceKernel,source:CarrierQuoteFixtureSource) {
    if(!(source instanceof CarrierQuoteFixtureSource))throw new Error('SYNTHETIC_SOURCE_REQUIRED');this.#k=kernel;this.#source=source;
  }
  #scope(scope:Scope) {
    const s=this.#k.require(scope);
    if(s.tenant_id!==this.#source.tenant_id||s.store_id!==this.#source.store_id)throw new Error('SOURCE_SCOPE_MISMATCH');return s;
  }
  #resource(scope:Scope,resourceId:string,write=false) {
    const s=this.#scope(scope);this.#k.authorize(scope,write?'warehouse.receive':'operation.read',id(resourceId));
    const resource=this.#k.get(scope,resourceId);if(resource.kind!=='order')throw new Error('PACKING_ORDER_REQUIRED');return {s,resource};
  }
  #parcel(packageId:string,resourceId:string) {
    const p=this.#source.package(id(packageId));if(!p)throw new Error('PACKAGE_UNAVAILABLE');
    if(p.package_id!==packageId||p.resource_id!==resourceId)throw new Error('PACKAGE_RESOURCE_MISMATCH');return p;
  }
  #row(scope:Scope,sessionId:string,write=false) {
    const s=this.#scope(scope),row=this.#k.db.prepare('SELECT * FROM commerce_packing_sessions WHERE tenant_id=? AND store_id=? AND id=?')
      .get(s.tenant_id,s.store_id,id(sessionId)) as Row;
    if(!row)throw new Error('PACKING_SESSION_NOT_FOUND');const {resource}=this.#resource(scope,row.resource_id,write);const data=body(row);
    return {s,row,data,resource};
  }
  #allocations(s:Row,row:Row):Row[] {
    const rows=this.#k.db.prepare('SELECT * FROM commerce_packing_allocations WHERE tenant_id=? AND store_id=? AND session_id=? ORDER BY id')
      .all(s.tenant_id,s.store_id,row.id) as Row[];
    return rows.map(r=>{if(r.resource_id!==row.resource_id)throw new Error('PACKING_ALLOCATION_INTEGRITY');const unit=body(r);
      if(unit.unit_key!==r.unit_key||unit.unit_key!==unitKey(row.resource_id,unit.line_id,unit.ordinal))throw new Error('PACKING_ALLOCATION_INTEGRITY');
      return {...unit,allocation_id:r.id,scanned:r.scanned===1,state:r.state};});
  }
  #currentReason(data:Row,resource:Row,row:Row) {
    if(data.source_identity!==this.#source.identity)return 'SOURCE_CHANGED';
    let parcel:Row;try{parcel=this.#parcel(row.package_id,row.resource_id);}catch{return 'PACKAGE_CHANGED';}
    if(contentDigest(parcel)!==data.parcel_digest||parcel.revision!==data.package_revision)return 'PACKAGE_CHANGED';
    if(resourceDigest(resource)!==data.resource_digest||resource.source_version!==data.resource_revision)return 'ORDER_CHANGED';
    const current=sourceUnits(resource),keys=new Map(current.map(u=>[u.unit_key,u]));
    for(const unit of data.units){const now=keys.get(unit.unit_key);
      if(!now||!now.eligible||now.sku!==unit.sku||canonical(now.return_links)!==canonical(unit.return_links))return 'UNIT_NOT_AVAILABLE';}
    return null;
  }
  #view(s:Row,row:Row,data:Row) {
    const units=sortedUnits(this.#allocations(s,row));
    if(units.length!==row.expected_count||units.filter(u=>u.scanned).length!==row.packed_count||row.packed_count>row.expected_count)throw new Error('PACKING_COUNT_INTEGRITY');
    if(canonical(units.map(({allocation_id,scanned,state,...u})=>u))!==canonical(data.units))throw new Error('PACKING_ALLOCATION_INTEGRITY');
    const lines:Row[]=[];
    for(const u of units){let line=lines.find(l=>l.line_id===u.line_id);if(!line){line={line_id:u.line_id,sku:u.sku,expected:0,packed:0,missing:0};lines.push(line);}
      line.expected++;if(u.scanned)line.packed++;else line.missing++;}
    const scans=this.#k.db.prepare('SELECT * FROM commerce_packing_scans WHERE tenant_id=? AND store_id=? AND session_id=? ORDER BY rowid')
      .all(s.tenant_id,s.store_id,row.id) as Row[];
    const observations=scans.map(r=>{if(r.resource_id!==row.resource_id)throw new Error('PACKING_SCAN_INTEGRITY');return {id:r.id,outcome:r.outcome,...body(r)};});
    if(observations.filter(r=>r.outcome==='accepted').length!==row.packed_count)throw new Error('PACKING_COUNT_INTEGRITY');
    let confirmation:Row|null=null;
    if(row.confirmation_id){const saved=this.#k.db.prepare('SELECT * FROM commerce_packing_confirmations WHERE tenant_id=? AND store_id=? AND id=?')
      .get(s.tenant_id,s.store_id,row.confirmation_id) as Row;
      if(!saved||saved.session_id!==row.id||saved.resource_id!==row.resource_id)throw new Error('PACKING_CONFIRMATION_INTEGRITY');confirmation=body(saved);
      if(confirmation.allocation_digest!==data.allocation_digest||confirmation.expected_count!==row.expected_count||confirmation.packed_count!==row.packed_count)throw new Error('PACKING_CONFIRMATION_INTEGRITY');}
    if(['confirmed','shipped'].includes(row.state)&&(!confirmation||row.packed_count!==row.expected_count))throw new Error('PACKING_CONFIRMATION_INTEGRITY');
    return {id:row.id,package_id:row.package_id,resource_id:row.resource_id,state:row.state,revision:row.revision,expected_count:row.expected_count,
      packed_count:row.packed_count,missing_count:row.expected_count-row.packed_count,confirmation_id:row.confirmation_id,
      confirmed_by:confirmation?.actor_id??null,package_revision:data.package_revision,allocation_digest:data.allocation_digest,
      source_identity:data.source_identity,units,lines,discrepancies:observations.filter(r=>r.outcome!=='accepted'),
      released_count:data.cancellation?.released_unit_keys.length??0,shipment_observation:data.shipment_observation??null,...FLAGS};
  }
  read(scope:Scope,sessionId:string):Row {const {s,row,data}=this.#row(scope,sessionId);return this.#view(s,row,data);}
  #remaining(s:Row,resource:Row) {
    const units=sourceUnits(resource),rows=this.#k.db.prepare("SELECT * FROM commerce_packing_allocations WHERE tenant_id=? AND store_id=? AND resource_id=? AND state!='released'")
      .all(s.tenant_id,s.store_id,resource.id) as Row[];
    const reserved=new Map<string,Row>();for(const r of rows){body(r);if(reserved.has(r.unit_key))throw new Error('PACKING_ALLOCATION_INTEGRITY');reserved.set(r.unit_key,r);}
    const available=units.filter(u=>u.eligible&&!reserved.has(u.unit_key));
    const counts={ordered_count:units.length,available_count:available.length,allocated_count:0,shipped_count:0,cancelled_count:0,backordered_count:0};
    for(const u of units){const allocation=reserved.get(u.unit_key);
      if(u.blocked_reason==='shipped'||allocation?.state==='shipped')counts.shipped_count++;
      else if(u.blocked_reason==='cancelled')counts.cancelled_count++;
      else if(u.blocked_reason==='backordered')counts.backordered_count++;
      else if(allocation)counts.allocated_count++;}
    return {resource_id:resource.id,resource_revision:resource.source_version,...counts,
      available_units:available.map(({eligible,blocked_reason,...u})=>u),...FLAGS};
  }
  remaining(scope:Scope,resourceId:string):Row {const {s,resource}=this.#resource(scope,resourceId);return this.#remaining(s,resource);}
  open(scope:Scope,input:unknown):Row {
    const p=exact(jsonValue(input),['session_id','package_id','resource_id','units']);for(const name of ['session_id','package_id','resource_id'])id(p[name]);p.units=requestedUnits(p.units);
    return this.#k.transaction(()=>{
      const {s,resource}=this.#resource(scope,p.resource_id,true),parcel=this.#parcel(p.package_id,p.resource_id);
      const request_digest=contentDigest(p),prior=this.#k.db.prepare('SELECT * FROM commerce_packing_sessions WHERE tenant_id=? AND store_id=? AND id=?')
        .get(s.tenant_id,s.store_id,p.session_id) as Row;
      if(prior){const data=body(prior);if(data.request_digest!==request_digest||prior.resource_id!==p.resource_id)throw new Error('PACKING_SESSION_CONFLICT');
        return this.#view(s,prior,data);}
      if(this.#k.db.prepare('SELECT 1 FROM commerce_packing_sessions WHERE tenant_id=? AND store_id=? AND package_id=?').get(s.tenant_id,s.store_id,p.package_id))throw new Error('PACKAGE_ALREADY_ALLOCATED');
      const available=this.#remaining(s,resource).available_units as Row[];
      const units=p.units.map((wanted:Row)=>{const u=available.find(u=>u.line_id===wanted.line_id&&u.ordinal===wanted.ordinal);if(!u)throw new Error('UNIT_NOT_AVAILABLE');return u;});
      const allocation_digest=contentDigest({resource_id:p.resource_id,units}),now=integer(this.#k.clock());
      const data={request_digest,source_identity:this.#source.identity,source_system:resource.source_system,resource_revision:resource.source_version,
        resource_digest:resourceDigest(resource),package_revision:parcel.revision,parcel_digest:contentDigest(parcel),opened_by:s.actor_id,
        units,allocation_digest,cancellation:null,shipment_observation:null};
      this.#k.db.prepare("INSERT INTO commerce_packing_sessions VALUES(?,?,?,?,?,'open',1,?,0,NULL,?,?,?,?)")
        .run(s.tenant_id,s.store_id,p.session_id,p.resource_id,p.package_id,units.length,canonical(data),contentDigest(data),now,now);
      for(const u of units){const ref='palloc_'+contentDigest([s.tenant_id,s.store_id,p.session_id,u.unit_key]).slice(0,48);
        this.#k.db.prepare("INSERT INTO commerce_packing_allocations VALUES(?,?,?,?,?,?,'allocated',0,?,?)")
          .run(s.tenant_id,s.store_id,ref,p.resource_id,p.session_id,u.unit_key,canonical(u),contentDigest(u));}
      this.#k.audit(scope,'packing_open','allowed');return this.read(scope,p.session_id);
    });
  }
  #increment(s:Row,sessionId:string) {
    this.#k.db.prepare('UPDATE commerce_packing_sessions SET packed_count=packed_count+1,revision=revision+1,updated_at=? WHERE tenant_id=? AND store_id=? AND id=?')
      .run(integer(this.#k.clock()),s.tenant_id,s.store_id,sessionId);
  }
  scan(scope:Scope,input:unknown):Row {
    const p=exact(jsonValue(input),['session_id','scanner_id','scan_id','line_id','ordinal','sku']);
    for(const name of ['session_id','scanner_id','scan_id','line_id','sku'])id(p[name]);integer(p.ordinal,1);
    return this.#k.transaction(()=>{
    const {s,row,data,resource}=this.#row(scope,p.session_id,true);
    this.#view(s,row,data);const scanId='pscan_'+contentDigest([s.tenant_id,s.store_id,p.scanner_id,p.scan_id]).slice(0,48),command_digest=contentDigest(p);
    // scan-deduplication-before-count
    const prior=this.#k.db.prepare('SELECT * FROM commerce_packing_scans WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,scanId) as Row;
    if(prior){if(prior.command_digest!==command_digest||prior.resource_id!==row.resource_id||prior.session_id!==row.id)throw new Error('SCAN_ID_CONFLICT');
      body(prior);const current=this.read(scope,row.id);return {scan_id:p.scan_id,outcome:prior.outcome,replayed:true,packed_count:current.packed_count,...FLAGS};}
    if(row.state!=='open')throw new Error('PACKING_SESSION_CLOSED');
    const observed=this.#k.db.prepare('SELECT count(*) n FROM commerce_packing_scans WHERE tenant_id=? AND store_id=? AND session_id=?')
      .get(s.tenant_id,s.store_id,row.id) as Row;if(observed.n>=MAX_SESSION_SCANS)throw new Error('PACKING_SCAN_LIMIT');
    const reason=this.#currentReason(data,resource,row);if(reason)throw new Error(reason);
    const allocation=this.#allocations(s,row).find(u=>u.line_id===p.line_id&&u.ordinal===p.ordinal);
    const outcome=!allocation?'unexpected_unit':allocation.sku!==p.sku?'wrong_sku':allocation.scanned?'duplicate_unit':'accepted';
    if(outcome==='accepted'){
      const changed=this.#k.db.prepare("UPDATE commerce_packing_allocations SET scanned=1 WHERE tenant_id=? AND store_id=? AND id=? AND scanned=0 AND state='allocated'")
        .run(s.tenant_id,s.store_id,allocation!.allocation_id);if(changed.changes!==1)throw new Error('UNIT_NOT_AVAILABLE');
      this.#increment(s,row.id); // scan-count-after-deduplication
    }
    const observation={command:p,actor_id:s.actor_id,unit_key:allocation?.unit_key??null};
    this.#k.db.prepare('INSERT INTO commerce_packing_scans VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(s.tenant_id,s.store_id,scanId,row.resource_id,row.id,command_digest,outcome,canonical(observation),contentDigest(observation),integer(this.#k.clock()));
    this.#k.audit(scope,'packing_scan','allowed');const current=this.read(scope,row.id);
    return {scan_id:p.scan_id,outcome,replayed:false,packed_count:current.packed_count,...FLAGS};
    });
  }
  confirm(scope:Scope,input:unknown):Row {
    const p=exact(jsonValue(input),['session_id','expected_revision']);id(p.session_id);integer(p.expected_revision,1);
    return this.#k.transaction(()=>{
      const {s,row,data,resource}=this.#row(scope,p.session_id,true),view=this.#view(s,row,data);
      if(row.revision!==p.expected_revision)throw new Error('PACKING_REVISION_CHANGED');
      if(!['open','confirmed'].includes(row.state))throw new Error('PACKING_SESSION_CLOSED');
      const reason=this.#currentReason(data,resource,row);if(reason)throw new Error(reason);
      if(row.state==='confirmed')return view;if(row.packed_count!==row.expected_count)throw new Error('PACKING_INCOMPLETE');
      const ref='pconfirm_'+contentDigest([s.tenant_id,s.store_id,row.id,data.allocation_digest]).slice(0,48);
      const confirmation={session_id:row.id,package_id:row.package_id,actor_id:s.actor_id,expected_revision:p.expected_revision,
        allocation_digest:data.allocation_digest,resource_digest:data.resource_digest,parcel_digest:data.parcel_digest,
        expected_count:row.expected_count,packed_count:row.packed_count,source_identity:data.source_identity,observed_at:integer(this.#k.clock()),...FLAGS};
      this.#k.db.prepare('INSERT INTO commerce_packing_confirmations VALUES(?,?,?,?,?,?,?,?)')
        .run(s.tenant_id,s.store_id,ref,row.resource_id,row.id,canonical(confirmation),contentDigest(confirmation),integer(this.#k.clock()));
      this.#k.db.prepare("UPDATE commerce_packing_sessions SET state='confirmed',confirmation_id=?,revision=revision+1,updated_at=? WHERE tenant_id=? AND store_id=? AND id=?")
        .run(ref,integer(this.#k.clock()),s.tenant_id,s.store_id,row.id);
      this.#k.audit(scope,'packing_confirm','allowed');return this.read(scope,row.id);
    });
  }
  qualifiedPackage(scope:Scope,packageId:string):Row {
    const s=this.#scope(scope),found=this.#k.db.prepare('SELECT id FROM commerce_packing_sessions WHERE tenant_id=? AND store_id=? AND package_id=?')
      .get(s.tenant_id,s.store_id,id(packageId)) as Row;
    if(!found)throw new Error('PACKING_SESSION_NOT_FOUND');const {row,data,resource}=this.#row(scope,found.id),view=this.#view(s,row,data);
    const current=this.#currentReason(data,resource,row),reason=current??(row.state==='cancelled'?'PACKING_CANCELLED':!['confirmed','shipped'].includes(row.state)?'PACKING_CONFIRMATION_REQUIRED':null);
    return {package_id:row.package_id,resource_id:row.resource_id,tenant_id:s.tenant_id,store_id:s.store_id,packing_session_id:row.id,
      confirmation_id:row.confirmation_id,revision:row.revision,package_revision:data.package_revision,allocation_digest:data.allocation_digest,
      allocations:view.lines.map((line:Row)=>({line_id:line.line_id,quantity:line.expected})),expected_count:row.expected_count,packed_count:row.packed_count,
      qualified:reason===null,cancelled:row.state==='cancelled',shipped:row.state==='shipped',state:row.state,reason,...FLAGS};
  }
  cancel(scope:Scope,input:unknown):Row {
    const p=exact(jsonValue(input),['session_id','expected_revision']);id(p.session_id);integer(p.expected_revision,1);
    return this.#k.transaction(()=>{
      const {s,row,data,resource}=this.#row(scope,p.session_id,true),view=this.#view(s,row,data);
      if(row.revision!==p.expected_revision)throw new Error('PACKING_REVISION_CHANGED');
      if(row.state==='shipped')throw new Error('SHIPPED_ALLOCATION_IMMUTABLE');if(row.state==='cancelled')return view;
      // A manifest may have reached its source even when acknowledgment was lost.
      // Retain allocation until an explicitly supported withdrawal workflow exists.
      if(this.#k.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='commerce_shipping_manifest_packages'").get()
        &&this.#k.db.prepare('SELECT 1 FROM commerce_shipping_manifest_packages WHERE tenant_id=? AND store_id=? AND package_id=?')
          .get(s.tenant_id,s.store_id,row.package_id))throw new Error('PACKAGE_ALREADY_MANIFESTED');
      const current=new Map(sourceUnits(resource).map(u=>[u.unit_key,u])),released:string[]=[],unavailable:string[]=[],shipped:string[]=[];
      for(const allocation of this.#allocations(s,row)){
        const unit=current.get(allocation.unit_key);
        if(allocation.state==='shipped'||unit?.blocked_reason==='shipped'){
          this.#k.db.prepare("UPDATE commerce_packing_allocations SET state='shipped' WHERE tenant_id=? AND store_id=? AND id=?")
            .run(s.tenant_id,s.store_id,allocation.allocation_id);shipped.push(allocation.unit_key);
        }else if(unit){
          this.#k.db.prepare("UPDATE commerce_packing_allocations SET state='released' WHERE tenant_id=? AND store_id=? AND id=? AND state='allocated'")
            .run(s.tenant_id,s.store_id,allocation.allocation_id);(unit.eligible?released:unavailable).push(allocation.unit_key);
        }else unavailable.push(allocation.unit_key); // Unknown source units stay reserved.
      }
      data.cancellation={actor_id:s.actor_id,observed_at:integer(this.#k.clock()),released_unit_keys:released,unavailable_unit_keys:unavailable,shipped_unit_keys:shipped};
      this.#k.db.prepare("UPDATE commerce_packing_sessions SET state='cancelled',revision=revision+1,body=?,digest=?,updated_at=? WHERE tenant_id=? AND store_id=? AND id=?")
        .run(canonical(data),contentDigest(data),integer(this.#k.clock()),s.tenant_id,s.store_id,row.id);
      this.#k.audit(scope,'packing_cancel','allowed');return this.read(scope,row.id);
    });
  }
  /** Explicit operator fixture observation only; never proves carrier acceptance. */
  observeShipment(scope:Scope,input:unknown):Row {
    const p=exact(jsonValue(input),['session_id','observation_id']);id(p.session_id);id(p.observation_id);
    return this.#k.transaction(()=>{
      const {s,row,data,resource}=this.#row(scope,p.session_id,true);this.#k.authorize(scope,'operation.dispatch',row.resource_id);
      const view=this.#view(s,row,data);if(row.state==='shipped'){
        if(data.shipment_observation?.observation_id!==p.observation_id)throw new Error('SHIPMENT_OBSERVATION_CONFLICT');return view;}
      if(row.state!=='confirmed')throw new Error('PACKING_CONFIRMATION_REQUIRED');const reason=this.#currentReason(data,resource,row);if(reason)throw new Error(reason);
      data.shipment_observation={observation_id:p.observation_id,actor_id:s.actor_id,observed_at:integer(this.#k.clock()),
        source_kind:'explicit_operator_fixture',carrier_acceptance:false,physical_qualified:false};
      this.#k.db.prepare("UPDATE commerce_packing_allocations SET state='shipped' WHERE tenant_id=? AND store_id=? AND session_id=? AND state='allocated'")
        .run(s.tenant_id,s.store_id,row.id);
      this.#k.db.prepare("UPDATE commerce_packing_sessions SET state='shipped',revision=revision+1,body=?,digest=?,updated_at=? WHERE tenant_id=? AND store_id=? AND id=?")
        .run(canonical(data),contentDigest(data),integer(this.#k.clock()),s.tenant_id,s.store_id,row.id);
      this.#k.audit(scope,'packing_shipment_observe','allowed');return this.read(scope,row.id);
    });
  }
}
