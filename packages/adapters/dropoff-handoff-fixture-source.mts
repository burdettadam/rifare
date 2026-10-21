import type {DatabaseSync} from 'node:sqlite';
import {id,integer} from '../commerce/kernel.mts';
import type {Row} from '../commerce/kernel.mts';
import {canonical,contentDigest} from '../commerce/configuration-values.mts';
import {DropoffCredentialFixtureSource} from './dropoff-credential-fixture-source.mts';
import {dropoffShape} from '../commerce/dropoff-credential-values.mts';
import {DROPOFF_HANDOFF_CONTRACT,DROPOFF_HANDOFF_LIMIT,handoffSourceIdentity,handoffManifest,handoffUnits,handoffBinding,handoffHistory} from '../commerce/dropoff-handoff-values.mts';

/** Synthetic provider admission. This journal contains no credential or item mapping. */
export class DropoffHandoffFixtureSource {
  readonly credentials:DropoffCredentialFixtureSource;readonly db:DatabaseSync;readonly identity:string;
  readonly contract=DROPOFF_HANDOFF_CONTRACT;readonly tenant:string;readonly store:string;readonly account:string;
  #credentials:DropoffCredentialFixtureSource;#database:DatabaseSync;#clock:()=>number;#mode='apply';#lookup=true;
  constructor(credentials:DropoffCredentialFixtureSource){
    if(!(credentials instanceof DropoffCredentialFixtureSource))throw new Error('DROPOFF_HANDOFF_OWNER_MISMATCH');
    // Actual private brand and physical parent separation, before any handoff DDL.
    DropoffCredentialFixtureSource.prototype.journal.call(credentials);
    this.credentials=credentials;this.#credentials=credentials;this.db=credentials.db;this.#database=this.db;this.#clock=credentials.directory.fulfillment.clock;
    this.tenant=credentials.tenant;this.store=credentials.store;this.account=credentials.account;
    this.identity=handoffSourceIdentity({source_identity:credentials.identity,source_account_id:this.account,directory_identity:credentials.directory.identity,tenant_id:this.tenant,store_id:this.store});
    if(!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='fixture_dropoff_handoff_events'").get()){
      this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE fixture_dropoff_handoff_events(event_id TEXT PRIMARY KEY,family_ref TEXT NOT NULL,sequence INTEGER NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,UNIQUE(family_ref,sequence)) STRICT;
        CREATE TRIGGER fixture_dropoff_handoff_event_immutable BEFORE UPDATE ON fixture_dropoff_handoff_events BEGIN SELECT RAISE(ABORT,'DROPOFF_HANDOFF_EVENT_IMMUTABLE'); END;
        CREATE TRIGGER fixture_dropoff_handoff_event_retained BEFORE DELETE ON fixture_dropoff_handoff_events BEGIN SELECT RAISE(ABORT,'DROPOFF_HANDOFF_EVENT_IMMUTABLE'); END;
        COMMIT;`);
    }
    this.journal();Object.freeze(this);
  }
  #assert(){
    const c=this.#credentials;if(this.credentials!==c||this.db!==this.#database||c.db!==this.db||c.directory.fulfillment.clock!==this.#clock)throw new Error('DROPOFF_HANDOFF_OWNER_MISMATCH');
    return DropoffCredentialFixtureSource.prototype.journal.call(c);
  }
  assertAttached(core:DatabaseSync){this.#assert();DropoffCredentialFixtureSource.prototype.assertAttached.call(this.#credentials,core);}
  mode(value:'apply'|'timeout_after_effect'){if(!['apply','timeout_after_effect'].includes(value))throw new Error('INVALID_INPUT');this.#assert();this.#mode=value;}
  lookupAvailable(value:boolean){if(typeof value!=='boolean')throw new Error('INVALID_INPUT');this.#assert();this.#lookup=value;}
  journal(){
    const credentials=this.#assert(),rows=this.db.prepare('SELECT * FROM fixture_dropoff_handoff_events ORDER BY family_ref,sequence LIMIT ?').all(DROPOFF_HANDOFF_LIMIT+1) as Row[];
    if(rows.length>DROPOFF_HANDOFF_LIMIT)throw new Error('DROPOFF_HANDOFF_LIMIT');
    const events=rows.map(raw=>{const r=dropoffShape(raw,['event_id','family_ref','sequence','body','digest']),e=JSON.parse(r.body),original=credentials.find(c=>c.operation_id===e.issue_operation_id);
      if(!original)throw new Error('DROPOFF_HANDOFF_BINDING_INVALID');handoffBinding(e,original.command,original.result);
      const terminal=credentials.filter(c=>c.result.state==='revoked'&&c.command.issue_operation_id===e.issue_operation_id||c.result.state==='issued'&&c.command.replaces_operation_id===e.issue_operation_id);
      // Equal-clock observations preserve a legitimate earlier admission.
      if(terminal.some(c=>e.admitted_at>c.result.observed_at))throw new Error('DROPOFF_HANDOFF_ADMISSION_INVALID');
      if(e.source_identity!==this.identity||r.event_id!==e.event_id||r.family_ref!==e.family_ref||r.sequence!==e.sequence||r.body!==canonical(e)||r.digest!==e.digest||e.observed_at>this.#clock())throw new Error('DROPOFF_HANDOFF_SOURCE_INTEGRITY');return e;
    });
    for(const family of new Set(events.map(e=>e.family_ref)))handoffHistory(events.filter(e=>e.family_ref===family));return events;
  }
  event(eventId:string){id(eventId);this.#assert();if(!this.#lookup)throw new Error('DROPOFF_HANDOFF_LOOKUP_UNAVAILABLE');return this.journal().find(e=>e.event_id===eventId)??null;}
  #write(events:Row[],event:Row){
    if(events.length>=DROPOFF_HANDOFF_LIMIT)throw new Error('DROPOFF_HANDOFF_LIMIT');handoffHistory([...events.filter(e=>e.family_ref===event.family_ref),event]);
    this.db.prepare('INSERT INTO fixture_dropoff_handoff_events VALUES(?,?,?,?,?)').run(event.event_id,event.family_ref,event.sequence,canonical(event),event.digest);
  }
  #transaction(build:(events:Row[])=>{event:Row;existing:boolean}){
    this.#assert();this.db.exec('BEGIN IMMEDIATE');let result:{event:Row;existing:boolean};
    try{const events=this.journal();result=build(events);if(!result.existing)this.#write(events,result.event);this.db.exec('COMMIT');}
    catch(error){this.db.exec('ROLLBACK');throw error;}
    if(!result.existing&&this.#mode==='timeout_after_effect')throw new Error('DROPOFF_HANDOFF_TIMEOUT_AFTER_EFFECT');return result.event;
  }
  recordAcceptance(input:unknown){
    const p=dropoffShape(input,['event_id','issue_operation_id','payload','items','units']);id(p.event_id);id(p.issue_operation_id);
    return this.#transaction(events=>{
      const credentials=this.#assert(),original=credentials.find(r=>r.operation_id===p.issue_operation_id);
      if(!original||original.result.state!=='issued')throw new Error('DROPOFF_HANDOFF_CREDENTIAL_UNAVAILABLE');const c=original.command,r=original.result,expected=handoffManifest(p.items,c.family_ref,c.items_digest);
      if(!Array.isArray(p.units)||!p.units.length||p.units.length>100)throw new Error('DROPOFF_HANDOFF_UNITS_INVALID');
      const units=handoffUnits(p.units.map((raw:unknown)=>{const u=dropoffShape(raw,['line_id','ordinal','disposition','reason']);id(u.line_id);integer(u.ordinal,1);const member=expected.find(v=>v.line_id===u.line_id&&v.ordinal===u.ordinal);if(!member)throw new Error('DROPOFF_HANDOFF_UNITS_INVALID');return {unit_ref:member.unit_ref,disposition:u.disposition,reason:u.reason};}));
      const verified=DropoffCredentialFixtureSource.prototype.verify.call(this.#credentials,p.payload),old=events.find(e=>e.event_id===p.event_id);
      if(verified.operation_id!==p.issue_operation_id||verified.credential_id!==r.credential_id||verified.generation!==c.generation)throw new Error('DROPOFF_HANDOFF_CREDENTIAL_UNAVAILABLE');
      // An exact historical retry remains retrievable after expiry, revocation or key loss.
      if(old){if(old.kind!=='acceptance'||old.issue_operation_id!==p.issue_operation_id||contentDigest(old.units)!==contentDigest(units)||old.items_digest!==contentDigest(p.items))throw new Error('DROPOFF_HANDOFF_EVENT_CONFLICT');return {event:old,existing:true};}
      const now=integer(this.#clock());if(!verified.usable||now<r.observed_at||now>=c.credential_expires_at||credentials.some(v=>v.result.state==='revoked'&&v.command.issue_operation_id===p.issue_operation_id||v.result.state==='issued'&&v.command.replaces_operation_id===p.issue_operation_id))throw new Error('DROPOFF_HANDOFF_CREDENTIAL_UNAVAILABLE');
      const body={schema_version:1,contract:this.contract,event_id:p.event_id,kind:'acceptance',sequence:events.filter(e=>e.family_ref===c.family_ref).length+1,tenant_id:c.tenant_id,store_id:c.store_id,source_identity:this.identity,credential_source_identity:c.source_identity,source_account_id:c.source_account_id,directory_identity:c.directory_identity,family_ref:c.family_ref,subject_ref:c.subject_ref,resource_id:c.resource_id,issue_operation_id:c.operation_id,command_digest:original.command_digest,credential_id:r.credential_id,generation:c.generation,items_digest:c.items_digest,method_digest:c.method_digest,site_id:c.site_id,destination_id:c.destination_id,method_id:c.method_id,credential_kind:c.credential_kind,credential_expires_at:c.credential_expires_at,admitted_at:now,observed_at:now,parent_event_id:null,units,qualification:'synthetic_only',physical_handoff_qualified:false,warehouse_effect:false,financial_effect:false};
      return {event:handoffBinding({...body,digest:contentDigest(body)},c,r),existing:false};
    });
  }
  recordCorrection(input:unknown){
    const p=dropoffShape(input,['event_id','parent_event_id','units']);id(p.event_id);id(p.parent_event_id);const units=handoffUnits(p.units);
    return this.#transaction(events=>{
      const old=events.find(e=>e.event_id===p.event_id);
      if(old){if(old.kind!=='correction'||old.parent_event_id!==p.parent_event_id||contentDigest(old.units)!==contentDigest(units))throw new Error('DROPOFF_HANDOFF_EVENT_CONFLICT');return {event:old,existing:true};}
      const parent=events.find(e=>e.event_id===p.parent_event_id);if(!parent)throw new Error('DROPOFF_HANDOFF_PARENT_INVALID');const {digest,...original}=parent;
      const body={...original,event_id:p.event_id,kind:'correction',sequence:events.filter(e=>e.family_ref===parent.family_ref).length+1,observed_at:integer(this.#clock()),parent_event_id:p.parent_event_id,units};
      return {event:{...body,digest:contentDigest(body)},existing:false};
    });
  }
}
