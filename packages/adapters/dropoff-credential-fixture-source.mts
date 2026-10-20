import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {id,integer,digest} from '../commerce/kernel.mts';
import type {Row} from '../commerce/kernel.mts';
import type {Keyring} from '../commerce/secrets.mts';
import {canonical,contentDigest} from '../commerce/configuration-values.mts';
import {DropoffFixtureSource} from './dropoff-fixture-source.mts';
import {DROPOFF_ISSUE_ACTION,DROPOFF_REVOKE_ACTION,DROPOFF_CREDENTIAL_CONTRACT,DROPOFF_CREDENTIAL_LIMIT,DROPOFF_CREDENTIAL_FIELDS,dropoffShape,dropoffHash,dropoffCommand,dropoffResult,dropoffCredentialBody} from '../commerce/dropoff-credential-values.mts';

const IDENTITY_FIELDS=['schema_version','contract','source_identity','source_account_id','directory_identity','tenant_id','store_id'];
const MODES=['apply','reject','timeout_before_effect','timeout_after_effect'];
const TABLES=['fixture_dropoff_credential_identity','fixture_dropoff_credential_operations','fixture_dropoff_credentials'];
type Mode='apply'|'reject'|'timeout_before_effect'|'timeout_after_effect';

/** An independent synchronous synthetic provider. No core approval/transport API. */
export class DropoffCredentialFixtureSource {
  readonly directory:DropoffFixtureSource;readonly db:DatabaseSync;readonly tenant:string;readonly store:string;
  readonly identity:string;readonly contract=DROPOFF_CREDENTIAL_CONTRACT;readonly account:string;
  #keys:Keyring;#binding:Row;#database:DatabaseSync;#clock:()=>number;#modes:{issue:Mode;revoke:Mode}={issue:'apply',revoke:'apply'};#lookup=true;
  constructor(directory:DropoffFixtureSource,keys:Keyring){
    if(!(directory instanceof DropoffFixtureSource)||!keys||typeof keys.get!=='function')throw new Error('DROPOFF_CREDENTIAL_OWNER_MISMATCH');id(keys.activeId);
    // This actual native brand/separation check must precede all credential DDL.
    DropoffFixtureSource.prototype.assertIdentity.call(directory);
    this.directory=directory;this.db=directory.db;this.#database=this.db;this.tenant=directory.tenant;this.store=directory.store;this.#clock=directory.fulfillment.clock;this.#keys=keys;
    const present=TABLES.filter(name=>this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
    if(present.length!==0&&present.length!==TABLES.length)throw new Error('DROPOFF_CREDENTIAL_SOURCE_INTEGRITY');
    let body:Row;
    if(present.length){
      const rows=this.db.prepare('SELECT * FROM fixture_dropoff_credential_identity LIMIT 2').all() as Row[];
      if(rows.length!==1||rows[0].singleton!==1)throw new Error('DROPOFF_CREDENTIAL_SOURCE_INTEGRITY');
      body=dropoffShape(JSON.parse(rows[0].body),IDENTITY_FIELDS);
      if(rows[0].digest!==contentDigest(body))throw new Error('DROPOFF_CREDENTIAL_SOURCE_INTEGRITY');
    }else{
      const config=directory.partnerConfiguration();if(!config)throw new Error('DROPOFF_CREDENTIAL_ACCOUNT_REQUIRED');
      const base={schema_version:1,contract:this.contract,source_account_id:id(config.body.account_id),directory_identity:directory.identity,tenant_id:this.tenant,store_id:this.store};body={...base,source_identity:contentDigest(base)};
    }
    const {source_identity:identity,...base}=body;id(body.source_account_id);dropoffHash(identity);
    if(body.schema_version!==1||body.contract!==this.contract||body.directory_identity!==directory.identity||body.tenant_id!==this.tenant||body.store_id!==this.store||identity!==contentDigest(base))throw new Error('DROPOFF_CREDENTIAL_SOURCE_INTEGRITY');
    this.identity=identity;this.account=body.source_account_id;this.#binding=Object.freeze(body);
    if(!present.length){this.db.exec('BEGIN IMMEDIATE');try{
      this.db.exec(`CREATE TABLE fixture_dropoff_credential_identity(singleton INTEGER PRIMARY KEY CHECK(singleton=1),body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;
        CREATE TABLE fixture_dropoff_credential_operations(operation_id TEXT PRIMARY KEY,command TEXT NOT NULL,command_digest TEXT NOT NULL,result TEXT NOT NULL,digest TEXT NOT NULL) STRICT;
        CREATE TABLE fixture_dropoff_credentials(operation_id TEXT PRIMARY KEY,family_ref TEXT NOT NULL,generation INTEGER NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,key_id TEXT,nonce TEXT,cipher TEXT,tag TEXT,payload_hash TEXT NOT NULL) STRICT;
        CREATE TRIGGER fixture_dropoff_credential_operation_immutable BEFORE UPDATE ON fixture_dropoff_credential_operations BEGIN SELECT RAISE(ABORT,'DROPOFF_ORIGINAL_OPERATION_IMMUTABLE'); END;
        CREATE TRIGGER fixture_dropoff_credential_operation_retained BEFORE DELETE ON fixture_dropoff_credential_operations BEGIN SELECT RAISE(ABORT,'DROPOFF_ORIGINAL_OPERATION_IMMUTABLE'); END;
        CREATE TRIGGER fixture_dropoff_credential_hash_immutable BEFORE UPDATE OF payload_hash ON fixture_dropoff_credentials WHEN NEW.payload_hash<>OLD.payload_hash BEGIN SELECT RAISE(ABORT,'DROPOFF_PAYLOAD_HASH_IMMUTABLE'); END;
        CREATE TRIGGER fixture_dropoff_credential_metadata_retained BEFORE DELETE ON fixture_dropoff_credentials BEGIN SELECT RAISE(ABORT,'DROPOFF_CREDENTIAL_METADATA_RETAINED'); END;`);
      this.db.prepare('INSERT INTO fixture_dropoff_credential_identity VALUES(1,?,?)').run(canonical(body),contentDigest(body));this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}}
    this.#assert();this.journal();Object.freeze(this);
  }
  #assert(){
    DropoffFixtureSource.prototype.assertIdentity.call(this.directory);
    if(this.db!==this.#database||this.directory.db!==this.db||this.directory.fulfillment.clock!==this.#clock)throw new Error('DROPOFF_CREDENTIAL_OWNER_MISMATCH');
    const rows=this.db.prepare('SELECT * FROM fixture_dropoff_credential_identity LIMIT 2').all() as Row[];
    if(rows.length!==1)throw new Error('DROPOFF_CREDENTIAL_SOURCE_INTEGRITY');const r=dropoffShape(rows[0],['singleton','body','digest']);
    if(r.singleton!==1||r.body!==canonical(this.#binding)||r.digest!==contentDigest(this.#binding))throw new Error('DROPOFF_CREDENTIAL_SOURCE_INTEGRITY');
  }
  assertAttached(core:DatabaseSync){this.#assert();DropoffFixtureSource.prototype.assertAttached.call(this.directory,core);}
  #bound(command:Row){for(const [field,value] of Object.entries({tenant_id:this.tenant,store_id:this.store,source_identity:this.identity,source_account_id:this.account,source_contract:this.contract,directory_identity:this.directory.identity}))if(command[field]!==value)throw new Error('DROPOFF_CREDENTIAL_SOURCE_SCOPE');}
  mode(kind:'issue'|'revoke',mode:Mode){if(!['issue','revoke'].includes(kind)||!MODES.includes(mode))throw new Error('INVALID_INPUT');this.#assert();this.#modes[kind]=mode;}
  lookupAvailable(value:boolean){if(typeof value!=='boolean')throw new Error('INVALID_INPUT');this.#assert();this.#lookup=value;}
  journal(){
    this.#assert();const rows=this.db.prepare('SELECT * FROM fixture_dropoff_credential_operations ORDER BY operation_id LIMIT ?').all(DROPOFF_CREDENTIAL_LIMIT+1) as Row[];
    if(rows.length>DROPOFF_CREDENTIAL_LIMIT)throw new Error('DROPOFF_CREDENTIAL_SOURCE_LIMIT');
    const journal=rows.map(raw=>{const r=dropoffShape(raw,['operation_id','command','command_digest','result','digest']),command=dropoffCommand(JSON.parse(r.command));this.#bound(command);const result=dropoffResult(JSON.parse(r.result),command);
      if(r.operation_id!==command.operation_id||r.command_digest!==contentDigest(command)||r.digest!==result.digest||canonical(command)!==r.command||canonical(result)!==r.result)throw new Error('DROPOFF_CREDENTIAL_SOURCE_INTEGRITY');
      return {operation_id:r.operation_id,command_digest:r.command_digest,command,result};});
    // The immutable operation journal is authoritative in both directions.
    // Deleting metadata or resetting a terminal marker cannot restore validity.
    const credentials=this.db.prepare('SELECT operation_id FROM fixture_dropoff_credentials LIMIT ?').all(DROPOFF_CREDENTIAL_LIMIT+1) as Row[],issued=journal.filter(e=>e.result.state==='issued');
    if(credentials.length!==issued.length||credentials.some(r=>!issued.some(e=>e.operation_id===r.operation_id)))throw new Error('DROPOFF_CREDENTIAL_SOURCE_INTEGRITY');
    for(const entry of issued)if(!this.#row(entry.operation_id,journal))throw new Error('DROPOFF_CREDENTIAL_SOURCE_INTEGRITY');return journal;
  }
  lookup(operationId:string){id(operationId);this.#assert();if(!this.#lookup)throw new Error('DROPOFF_LOOKUP_UNAVAILABLE');return this.journal().find(r=>r.operation_id===operationId)?.result??null;}
  #row(operationId:string,journal=this.journal()):Row|null {
    const raw=this.db.prepare('SELECT * FROM fixture_dropoff_credentials WHERE operation_id=?').get(id(operationId)) as Row|undefined;if(!raw)return null;
    const r=dropoffShape(raw,['operation_id','family_ref','generation','body','digest','key_id','nonce','cipher','tag','payload_hash']),b=dropoffCredentialBody(JSON.parse(r.body)),entry=journal.find(e=>e.operation_id===operationId);
    if(!entry||entry.result.state!=='issued'||r.digest!==contentDigest(b)||r.body!==canonical(b)||r.operation_id!==b.operation_id||r.family_ref!==b.family_ref||r.generation!==b.generation||b.command_digest!==entry.command_digest||b.credential_id!==entry.result.credential_id||b.expires_at!==entry.command.credential_expires_at||b.kind!==entry.command.credential_kind)throw new Error('DROPOFF_CREDENTIAL_SOURCE_INTEGRITY');
    for(const field of ['tenant_id','store_id','source_identity','source_account_id','family_ref','subject_ref','operation_id','items_digest','method_digest','generation'])if(b[field]!==entry.command[field])throw new Error('DROPOFF_CREDENTIAL_SOURCE_INTEGRITY');
    dropoffHash(r.payload_hash);const secret=['key_id','nonce','cipher','tag'].map(key=>r[key]);
    if(secret.some(v=>v===null)&&!secret.every(v=>v===null))throw new Error('DROPOFF_CREDENTIAL_SOURCE_INTEGRITY');
    if(r.key_id!==null){id(r.key_id);for(const field of ['nonce','cipher','tag'])if(typeof r[field]!=='string'||r[field].length>512||!r[field].length)throw new Error('DROPOFF_CREDENTIAL_SOURCE_INTEGRITY');}
    const revocations=journal.filter(e=>e.command.action===DROPOFF_REVOKE_ACTION&&e.command.issue_operation_id===b.operation_id&&e.result.state==='revoked'),replacements=journal.filter(e=>e.result.state==='issued'&&e.command.replaces_operation_id===b.operation_id);
    if(revocations.length>1||b.revoked_at!==(revocations[0]?.result.observed_at??null)||revocations.some(e=>e.result.credential_id!==b.credential_id||e.command.family_ref!==b.family_ref||e.command.items_digest!==b.items_digest||e.command.method_digest!==b.method_digest||e.command.generation!==b.generation))throw new Error('DROPOFF_CREDENTIAL_SOURCE_INTEGRITY');
    if(replacements.length>1||b.replaced_by!==(replacements[0]?.operation_id??null)||replacements.some(e=>e.command.family_ref!==b.family_ref||e.command.generation!==b.generation+1))throw new Error('DROPOFF_CREDENTIAL_SOURCE_INTEGRITY');
    return {...r,metadata:b};
  }
  #key(keyId:string){const value=this.#keys.get(keyId);if(!Buffer.isBuffer(value)||value.length!==32)throw new Error('DROPOFF_KEY_UNAVAILABLE');return Buffer.from(value);}
  #keyAvailable(keyId:string|null){if(keyId===null)return false;try{const key=this.#key(keyId);key.fill(0);return true;}catch{return false;}}
  #state(body:Row,now=integer(this.#clock())){return body.revoked_at!==null?'revoked':body.expires_at<=now?'expired':'active';}
  credential(operationId:string){const row=this.#row(operationId);if(!row)return null;const observed_at=integer(this.#clock()),state=this.#state(row.metadata,observed_at),body={...row.metadata,state,delivery_available:state==='active'&&row.cipher!==null&&this.#keyAvailable(row.key_id),observed_at};return {...body,digest:contentDigest(body)};}
  #aad(body:Row){return Buffer.from(canonical({command_digest:body.command_digest,operation_id:body.operation_id,tenant_id:body.tenant_id,store_id:body.store_id,source_identity:body.source_identity,credential_id:body.credential_id,kind:body.kind,expires_at:body.expires_at}));}
  #encrypt(body:Row){const key_id=id(this.#keys.activeId),key=this.#key(key_id),nonce=randomBytes(12),payload=Buffer.from('rifare_dropoff_'+randomBytes(32).toString('base64url'));
    try{const cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(this.#aad(body));const sealed=Buffer.concat([cipher.update(payload),cipher.final()]);return {key_id,nonce:nonce.toString('base64'),cipher:sealed.toString('base64'),tag:cipher.getAuthTag().toString('base64'),payload_hash:digest(payload)};}finally{key.fill(0);payload.fill(0);}}
  deliver(operationId:string){
    const row=this.#row(operationId);if(!row||this.#state(row.metadata)!=='active'||row.cipher===null)throw new Error('DROPOFF_CREDENTIAL_UNAVAILABLE');const key=this.#key(row.key_id);let clear:Buffer|undefined;
    try{const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(row.nonce,'base64'));decipher.setAAD(this.#aad(row.metadata));decipher.setAuthTag(Buffer.from(row.tag,'base64'));clear=Buffer.concat([decipher.update(Buffer.from(row.cipher,'base64')),decipher.final()]);
      if(digest(clear)!==row.payload_hash||clear.length>128||clear.length<32)throw new Error('DROPOFF_CREDENTIAL_AUTHENTICATION_FAILED');
      const b=row.metadata;return {operation_id:b.operation_id,credential_id:b.credential_id,kind:b.kind,payload:clear.toString('utf8'),expires_at:b.expires_at,generation:b.generation};
    }catch{throw new Error('DROPOFF_CREDENTIAL_AUTHENTICATION_FAILED');}finally{key.fill(0);clear?.fill(0);}
  }
  verify(payload:string){
    this.#assert();if(typeof payload!=='string'||payload.length>128)throw new Error('INVALID_INPUT');const raw=this.db.prepare('SELECT operation_id FROM fixture_dropoff_credentials WHERE payload_hash=? LIMIT 2').all(digest(payload)) as Row[];
    if(raw.length>1)throw new Error('DROPOFF_CREDENTIAL_SOURCE_INTEGRITY');const row=raw.length?this.#row(raw[0].operation_id):null,b=row?.metadata,state=b?this.#state(b):'unknown';
    return {usable:state==='active',state,operation_id:b?.operation_id??null,credential_id:b?.credential_id??null,generation:b?.generation??null,financial_effect:false,physical_handoff:false};
  }
  #family(command:Row,journal:Row[]){
    const rows=this.db.prepare('SELECT operation_id FROM fixture_dropoff_credentials WHERE family_ref=? ORDER BY generation,operation_id LIMIT ?').all(command.family_ref,DROPOFF_CREDENTIAL_LIMIT+1) as Row[];
    if(rows.length>DROPOFF_CREDENTIAL_LIMIT)throw new Error('DROPOFF_CREDENTIAL_SOURCE_LIMIT');const credentials=rows.map(r=>this.#row(r.operation_id,journal)!),last=credentials.at(-1);
    // Independent provider family fence; the assigned isolated fault removes this entire guard.
    if(credentials.some(r=>this.#state(r.metadata)==='active')||last&&(command.replaces_operation_id!==last.operation_id||command.generation!==last.generation+1||last.metadata.replaced_by!==null)||!last&&(command.replaces_operation_id!==null||command.generation!==1))throw new Error('DROPOFF_PROVIDER_FAMILY_BLOCKED');
    return last??null;
  }
  #result(command:Row,state:string,credential:string|null,reason:string,observed_at=integer(this.#clock())){const hash=contentDigest(command),body={schema_version:1,operation_id:command.operation_id,action:command.action,command_digest:hash,source_identity:this.identity,source_account_id:this.account,family_ref:command.family_ref,items_digest:command.items_digest,method_digest:command.method_digest,generation:command.generation,issue_operation_id:command.action===DROPOFF_ISSUE_ACTION?command.operation_id:command.issue_operation_id,credential_id:credential,credential_kind:command.credential_kind,credential_expires_at:command.credential_expires_at,state,reason,provider_ref:state==='rejected'?null:(state==='issued'?'credential_':'revocation_')+hash.slice(0,40),observed_at};return dropoffResult({...body,digest:contentDigest(body)},command);}
  #effect(input:unknown,kind:'issue'|'revoke'){
    const command=dropoffCommand(input);this.#bound(command);if(command.action!==(kind==='issue'?DROPOFF_ISSUE_ACTION:DROPOFF_REVOKE_ACTION))throw new Error('DROPOFF_COMMAND_INVALID');this.#assert();
    this.db.exec('BEGIN IMMEDIATE');let result:Row,mode=this.#modes[kind];
    try{
      const journal=this.journal(),old=journal.find(r=>r.operation_id===command.operation_id);
      if(old){if(old.command_digest!==contentDigest(command))throw new Error('DROPOFF_ORIGINAL_OPERATION_CONFLICT');this.db.exec('COMMIT');return old.result;}
      if(journal.length>=DROPOFF_CREDENTIAL_LIMIT)throw new Error('DROPOFF_CREDENTIAL_SOURCE_LIMIT');
      let previous:Row|null=null;
      if(kind==='issue'){
        previous=this.#family(command,journal);const config=this.directory.partnerConfiguration(),directory=this.directory.observe(),now=integer(this.#clock());
        const method=directory?.combinations.find((m:Row)=>m.site_id===command.site_id&&m.destination_id===command.destination_id&&m.method_id===command.method_id);
        if(!config||config.body.account_id!==this.account||config.body.expires_at<=now||!directory||directory.expires_at<=now||directory.partner_config_digest!==config.digest||!method||method.credential_kind!==command.credential_kind||method.availability?.state!=='available'||method.availability.expires_at<=now)throw new Error('DROPOFF_PROVIDER_TERMS_CHANGED');
      }else{
        previous=this.#row(command.issue_operation_id,journal);if(!previous||this.#state(previous.metadata)!=='active'||previous.metadata.replaced_by!==null)throw new Error('DROPOFF_CREDENTIAL_UNAVAILABLE');
        for(const field of ['family_ref','subject_ref','items_digest','method_digest','generation'])if(previous.metadata[field]!==command[field])throw new Error('DROPOFF_COMMAND_INVALID');
        if(previous.metadata.kind!==command.credential_kind||previous.metadata.expires_at!==command.credential_expires_at)throw new Error('DROPOFF_COMMAND_INVALID');
      }
      if(mode==='timeout_before_effect')throw new Error('DROPOFF_TIMEOUT_BEFORE_EFFECT');
      const expired=command.expires_at<=this.#clock()||kind==='issue'&&command.credential_expires_at<=this.#clock();
      if(mode==='reject'||expired)result=this.#result(command,'rejected',null,expired?'DROPOFF_TERMS_EXPIRED':'DROPOFF_PROVIDER_REJECTED');
      else if(kind==='issue'){
        const hash=contentDigest(command),body=dropoffCredentialBody({schema_version:1,tenant_id:this.tenant,store_id:this.store,source_identity:this.identity,source_account_id:this.account,family_ref:command.family_ref,subject_ref:command.subject_ref,operation_id:command.operation_id,command_digest:hash,items_digest:command.items_digest,method_digest:command.method_digest,credential_id:'dc_'+hash.slice(0,40),kind:command.credential_kind,generation:command.generation,expires_at:command.credential_expires_at,revoked_at:null,replaced_by:null}),secret=this.#encrypt(body);
        this.db.prepare('INSERT INTO fixture_dropoff_credentials VALUES(?,?,?,?,?,?,?,?,?,?)').run(body.operation_id,body.family_ref,body.generation,canonical(body),contentDigest(body),secret.key_id,secret.nonce,secret.cipher,secret.tag,secret.payload_hash);
        if(previous){const replaced={...previous.metadata,replaced_by:body.operation_id};this.db.prepare('UPDATE fixture_dropoff_credentials SET body=?,digest=? WHERE operation_id=?').run(canonical(replaced),contentDigest(replaced),previous.operation_id);}
        result=this.#result(command,'issued',body.credential_id,'DROPOFF_ISSUED');
      }else{
        const body={...previous!.metadata,revoked_at:integer(this.#clock())};this.db.prepare('UPDATE fixture_dropoff_credentials SET body=?,digest=? WHERE operation_id=?').run(canonical(body),contentDigest(body),previous!.operation_id);result=this.#result(command,'revoked',body.credential_id,'DROPOFF_REVOKED',body.revoked_at);
      }
      this.db.prepare('INSERT INTO fixture_dropoff_credential_operations VALUES(?,?,?,?,?)').run(command.operation_id,canonical(command),contentDigest(command),canonical(result),result.digest);this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
    if(mode==='timeout_after_effect')throw new Error('DROPOFF_TIMEOUT_AFTER_EFFECT');return result;
  }
  issue(command:unknown){return this.#effect(command,'issue');}
  revoke(command:unknown){return this.#effect(command,'revoke');}
  forgetSubject(subject:string){dropoffHash(subject);this.#assert();const journal=this.journal();for(const entry of journal)if(entry.command.subject_ref===subject&&entry.result.state==='issued')this.#row(entry.operation_id,journal);
    const result=this.db.prepare('UPDATE fixture_dropoff_credentials SET key_id=NULL,nonce=NULL,cipher=NULL,tag=NULL WHERE operation_id IN (SELECT operation_id FROM fixture_dropoff_credential_operations WHERE json_extract(command,\'$.subject_ref\')=? AND json_extract(result,\'$.state\')=\'issued\')').run(subject);
    return {subject_ref:subject,forgotten:Number(result.changes),provider_revoked:false,physical_media_erasure:false};
  }
}
