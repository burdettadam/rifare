import { exact,id,integer } from './kernel.mts';
import type { CommerceKernel,Row,Scope } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { assertExecution } from './execution-stops.mts';
import { assertRecoveryEgress } from './data-guards.mts';
import { PackingSessions } from './packing-sessions.mts';
import { ShippingBatchLabels,assertShippingSource,shippingBody } from './shipping-batch-labels.mts';
import { ShippingCarrierFixtureSource } from '../adapters/shipping-carrier-fixture-source.mts';

const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
/** Manifest acknowledgment, pickup and carrier acceptance are separate source observations. */
export class ShippingManifests {
  #k:CommerceKernel;#packing:PackingSessions;#labels:ShippingBatchLabels;#source:ShippingCarrierFixtureSource;#deadline:number;
  constructor(k:CommerceKernel,packing:PackingSessions,labels:ShippingBatchLabels,source:ShippingCarrierFixtureSource,options:{deadline_ms?:number}={}){
    if(!(packing instanceof PackingSessions)||!(labels instanceof ShippingBatchLabels)||Object.keys(options).some(key=>key!=='deadline_ms'))throw new Error('INVALID_INPUT');
    this.#deadline=integer(options.deadline_ms??1000,5);if(this.#deadline>30000)throw new Error('INVALID_INPUT');assertShippingSource(k,source);
    this.#k=k;this.#packing=packing;this.#labels=labels;this.#source=source;
  }
  #scope(scope:Scope){const s=this.#k.require(scope);assertShippingSource(this.#k,this.#source,s);if(this.#labels.source_identity!==this.#source.identity)throw new Error('SOURCE_IDENTITY_CHANGED');return s;}
  #input(input:unknown){const p=exact(jsonValue(input),['manifest_id','package_ids']);id(p.manifest_id);
    if(!Array.isArray(p.package_ids)||!p.package_ids.length||p.package_ids.length>32||new Set(p.package_ids).size!==p.package_ids.length)throw new Error('INVALID_MANIFEST');
    p.package_ids=p.package_ids.map(id).sort();return p;}
  #rows(scope:Scope,manifestId:string){const s=this.#scope(scope),rows=this.#k.db.prepare('SELECT * FROM commerce_shipping_manifest_packages WHERE tenant_id=? AND store_id=? AND manifest_id=? ORDER BY package_id').all(s.tenant_id,s.store_id,id(manifestId)) as Row[];
    return rows.map(row=>{this.#k.authorize(scope,'operation.read',row.resource_id);this.#k.get(scope,row.resource_id);const b=shippingBody(row);
      if(b.manifest_id!==row.manifest_id||b.command.package_id!==row.package_id||b.command.resource_id!==row.resource_id)throw new Error('SHIPPING_INTEGRITY');
      if(b.source_identity!==this.#source.identity)throw new Error('SOURCE_IDENTITY_CHANGED');return b;});}
  #save(b:Row){this.#k.db.prepare('UPDATE commerce_shipping_manifest_packages SET body=?,digest=? WHERE tenant_id=? AND store_id=? AND package_id=? AND manifest_id=?')
    .run(canonical(b),contentDigest(b),b.tenant_id,b.store_id,b.package_id,b.manifest_id);}
  #current(scope:Scope,packageId:string){const k=this.#k,s=this.#scope(scope),packed=this.#packing.qualifiedPackage(scope,packageId),label=this.#labels.packageStatus(scope,packageId);
    if(!packed.qualified||packed.cancelled||packed.shipped||!packed.confirmation_id||packed.packed_count!==packed.expected_count)throw new Error('PACKING_UNQUALIFIED');
    const packing=this.#packing.read(scope,packed.packing_session_id);
    if(packing.source_identity!==label.quote_source_identity)throw new Error('PACKING_SOURCE_MISMATCH');
    if(label.resource_id!==packed.resource_id||!label.label_usable||!label.receipt||label.package_revision!==packed.package_revision||label.source_identity!==this.#source.identity)throw new Error('LABEL_UNQUALIFIED');
    if(!['owner','operator'].includes(s.role))throw new Error('WAREHOUSE_OPERATOR_REQUIRED');
    k.authorize(scope,'warehouse.receive',packed.resource_id);k.authorize(scope,'operation.dispatch',packed.resource_id);k.authorize(scope,'action.execute',packed.resource_id);
    assertRecoveryEgress(k);assertExecution(k,s,'diagnostic.label.purchase');
    return {packed,label,command:{package_id:packageId,resource_id:packed.resource_id,purchase_id:label.purchase_id,native_label_id:label.receipt.native_label_id,
      packing_confirmation_id:packed.confirmation_id,packing_revision:packed.revision,packing_digest:packed.allocation_digest,package_revision:packed.package_revision}};
  }
  #command(s:Row,manifestId:string,packages:Row[]){return {version:1,kind:'outbound_manifest',tenant_id:s.tenant_id,store_id:s.store_id,source_identity:this.#source.identity,
    manifest_id:manifestId,membership_digest:contentDigest(packages),packages};}
  async #bounded<T>(fn:()=>Promise<T>){let timer:ReturnType<typeof setTimeout>|undefined;
    try{return await Promise.race([Promise.resolve().then(fn),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('MANIFEST_SOURCE_TIMEOUT')),this.#deadline);})]);}
    finally{if(timer)clearTimeout(timer);}}
  #ack(scope:Scope,manifestId:string,value:unknown){const r=exact(jsonValue(value),['version','manifest_id','source_identity','tenant_id','store_id','membership_digest','native_manifest_id','acknowledged_at','qualification']);
    const rows=this.#rows(scope,manifestId),s=this.#scope(scope);id(r.native_manifest_id);integer(r.acknowledged_at);
    if(r.version!==1||r.manifest_id!==manifestId||r.source_identity!==this.#source.identity||r.tenant_id!==s.tenant_id||r.store_id!==s.store_id||r.qualification!=='synthetic_only'||r.acknowledged_at>this.#k.clock())throw new Error('MANIFEST_RECEIPT_MISMATCH');
    if(!rows.length||rows.some(b=>b.membership_digest!==r.membership_digest))throw new Error('MANIFEST_MEMBERSHIP_CHANGED');
    for(const b of rows){if(b.native_manifest_id&&(b.native_manifest_id!==r.native_manifest_id||b.acknowledged_at!==r.acknowledged_at))throw new Error('MANIFEST_RECEIPT_MISMATCH');
      b.state='acknowledged';b.manifest_acknowledged=true;b.native_manifest_id=r.native_manifest_id;b.acknowledged_at=r.acknowledged_at;this.#save(b);}
  }
  async create(scope:Scope,input:unknown){const p=this.#input(input),k=this.#k,s=this.#scope(scope),existing=this.#rows(scope,p.manifest_id);
    if(existing.length){if(!same(existing.map(r=>r.package_id),p.package_ids))throw new Error('MANIFEST_MEMBERSHIP_CHANGED');return this.observe(scope,p.manifest_id);}
    const contexts=p.package_ids.map((packageId:string)=>this.#current(scope,packageId)),commands=contexts.map((c:Row)=>c.command),command=this.#command(s,p.manifest_id,commands);
    k.transaction(()=>{
      for(const c of contexts){const current=this.#current(scope,c.command.package_id);if(!same(c.command,current.command))throw new Error('MANIFEST_QUALIFICATION_CHANGED');
        if(k.db.prepare('SELECT 1 FROM commerce_shipping_manifest_packages WHERE tenant_id=? AND store_id=? AND package_id=?').get(s.tenant_id,s.store_id,c.command.package_id))throw new Error('PACKAGE_ALREADY_MANIFESTED');}
      for(const c of contexts){const b={version:1,tenant_id:s.tenant_id,store_id:s.store_id,resource_id:c.command.resource_id,package_id:c.command.package_id,source_identity:this.#source.identity,
        manifest_id:p.manifest_id,membership_digest:command.membership_digest,command:c.command,packing_session_id:c.packed.packing_session_id,state:'unknown',created_by:s.actor_id,created_at:k.clock(),
        manifest_acknowledged:false,native_manifest_id:null,acknowledged_at:null,picked_up:false,pickup_event_id:null,pickup_at:null,
        carrier_accepted:false,shipped:false,acceptance_event_id:null,accepted_at:null,last_sequence:0,last_event_at:null,exception_event_ids:[]};
        k.db.prepare('INSERT INTO commerce_shipping_manifest_packages VALUES(?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,b.resource_id,b.package_id,p.manifest_id,canonical(b),contentDigest(b));}
      k.audit(scope,'shipping_manifest_unknown','allowed');
    });
    try{const receipt=await this.#bounded(()=>{for(const c of contexts)if(!same(this.#current(scope,c.command.package_id).command,c.command))throw new Error('MANIFEST_QUALIFICATION_CHANGED');
        return this.#source.manifest(command);});
      k.transaction(()=>{for(const c of contexts)k.authorize(scope,'operation.dispatch',c.command.resource_id);this.#ack(scope,p.manifest_id,receipt);k.audit(scope,'shipping_manifest_acknowledged','allowed');});
    }catch{/* Acknowledgment is unknown; only the original manifest identity can repair it. */}
    return this.read(scope,p.manifest_id);
  }
  #event(scope:Scope,manifestId:string,value:unknown){const e=exact(jsonValue(value),['manifest_id','package_id','event_id','sequence','stage','at','source_identity','tenant_id','store_id','native_label_id','qualification']),k=this.#k,s=this.#scope(scope);
    for(const key of ['manifest_id','package_id','event_id','native_label_id'])id(e[key]);integer(e.sequence,1);integer(e.at);
    if(e.manifest_id!==manifestId||e.source_identity!==this.#source.identity||e.tenant_id!==s.tenant_id||e.store_id!==s.store_id||e.qualification!=='synthetic_only'||!['pickup','carrier_acceptance','exception'].includes(e.stage)||e.at>k.clock())throw new Error('MANIFEST_EVENT_MISMATCH');
    const b=this.#rows(scope,manifestId).find(b=>b.package_id===e.package_id);if(!b||!b.manifest_acknowledged||e.native_label_id!==b.command.native_label_id||e.at<b.acknowledged_at)throw new Error('MANIFEST_EVENT_MISMATCH');
    k.authorize(scope,'operation.reconcile',b.resource_id);k.authorize(scope,'warehouse.receive',b.resource_id);
    const event={...e,resource_id:b.resource_id},old=k.db.prepare('SELECT * FROM commerce_shipping_manifest_events WHERE tenant_id=? AND store_id=? AND event_id=?').get(s.tenant_id,s.store_id,e.event_id) as Row;
    if(old){if(!same(shippingBody(old),event))throw new Error('MANIFEST_EVENT_CONFLICT');return;}
    if(e.sequence<=b.last_sequence||b.last_event_at!==null&&e.at<b.last_event_at)throw new Error('MANIFEST_EVENT_SEQUENCE');
    if(e.stage==='pickup'){if(!b.picked_up){b.picked_up=true;b.pickup_event_id=e.event_id;b.pickup_at=e.at;}}
    if(e.stage==='carrier_acceptance'&&!b.carrier_accepted){
      // The independently observed carrier event is retained below. The packing
      // observation freezes the same confirmed allocation; it is not its oracle.
      const packed=this.#packing.qualifiedPackage(scope,b.package_id),packing=this.#packing.read(scope,b.packing_session_id),label=this.#labels.packageStatus(scope,b.package_id);
      if(!packed.qualified||packed.cancelled||packed.resource_id!==b.resource_id||packed.packing_session_id!==b.packing_session_id
        ||packed.confirmation_id!==b.command.packing_confirmation_id||packed.allocation_digest!==b.command.packing_digest||packed.package_revision!==b.command.package_revision
        ||packed.packed_count!==packed.expected_count||label.purchase_id!==b.command.purchase_id||label.receipt?.native_label_id!==b.command.native_label_id
        ||packing.source_identity!==label.quote_source_identity||!label.parcel_current||!label.resource_current)throw new Error('MANIFEST_PACKING_BINDING_CHANGED');
      if(packed.shipped){
        // An earlier explicit packing observation can already have frozen these
        // exact units. Preserve its ID and provenance; this distinct source event
        // establishes carrier acceptance without another allocation effect.
        if(!packing.shipment_observation||!packing.units.length||packing.units.some((u:Row)=>u.state!=='shipped'))throw new Error('MANIFEST_PACKING_BINDING_CHANGED');
      }else this.#packing.observeShipment(scope,{session_id:b.packing_session_id,observation_id:e.event_id});
      b.carrier_accepted=true;b.shipped=true;b.acceptance_event_id=e.event_id;b.accepted_at=e.at;
    }
    if(e.stage==='exception')b.exception_event_ids.push(e.event_id);b.last_sequence=e.sequence;b.last_event_at=e.at;
    k.db.prepare('INSERT INTO commerce_shipping_manifest_events VALUES(?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,b.resource_id,b.package_id,e.event_id,manifestId,canonical(event),contentDigest(event));
    this.#save(b);k.audit(scope,'shipping_carrier_event','allowed');
  }
  async observe(scope:Scope,manifestId:string){id(manifestId);const k=this.#k,rows=this.#rows(scope,manifestId);if(!rows.length)throw new Error('NOT_FOUND');
    for(const row of rows){k.authorize(scope,'operation.reconcile',row.resource_id);k.authorize(scope,'warehouse.receive',row.resource_id);}
    // Quarantined recovery permits narrow operation reads, never this allocation mutation.
    k.authorize(scope,'event.process',rows[0].resource_id);
    let receipt:unknown;try{receipt=await this.#bounded(()=>this.#source.lookupManifest(manifestId));}catch{return this.read(scope,manifestId);}
    if(receipt!==null)k.transaction(()=>this.#ack(scope,manifestId,receipt));
    if(this.#rows(scope,manifestId).every(b=>b.manifest_acknowledged)){
      let events:Row[];try{events=await this.#bounded(()=>this.#source.events(manifestId));}catch{return this.read(scope,manifestId);}
      if(!Array.isArray(events)||events.length>4096)throw new Error('MANIFEST_EVENTS_INVALID');
      for(const event of events)k.transaction(()=>this.#event(scope,manifestId,event));
    }
    return this.read(scope,manifestId);
  }
  read(scope:Scope,manifestId:string){const rows=this.#rows(scope,manifestId);if(!rows.length)throw new Error('NOT_FOUND');
    const packages=rows.map(b=>({package_id:b.package_id,resource_id:b.resource_id,manifest_id:b.manifest_id,state:b.state,native_manifest_id:b.native_manifest_id,
      purchase_id:b.command.purchase_id,native_label_id:b.command.native_label_id,packing_confirmation_id:b.command.packing_confirmation_id,
      manifest_acknowledged:b.manifest_acknowledged,acknowledged_at:b.acknowledged_at,picked_up:b.picked_up,pickup_at:b.pickup_at,pickup_event_id:b.pickup_event_id,
      carrier_accepted:b.carrier_accepted,shipped:b.shipped,accepted_at:b.accepted_at,acceptance_event_id:b.acceptance_event_id,exception_event_ids:b.exception_event_ids}));
    return jsonValue({manifest_id:manifestId,packages,outstanding_package_ids:packages.filter(p=>!p.carrier_accepted).map(p=>p.package_id),all_carrier_accepted:packages.every(p=>p.carrier_accepted),
      retry_allowed:false,qualification:'synthetic_only',financial_effect:false,physical_qualified:false,carrier_connected:false,formal_goal_accepted:false});
  }
}
