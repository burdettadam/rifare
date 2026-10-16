import type { DatabaseSync } from 'node:sqlite';
import { exact,id,integer,token } from '../../commerce/kernel.mts';
import type { Row } from '../../commerce/kernel.mts';
import { canonical,contentDigest,jsonValue } from '../../commerce/configuration-values.mts';

export const JOURNAL_CONTRACT='synthetic-journal-v1';
export type JournalResult={kind:'applied';operation_id:string;payload_hash:string;provider_ref:string;outcome:'synthetic_recorded'}
  |{kind:'not_sent';code:'synthetic_transport_unavailable'}|{kind:'rejected';code:'synthetic_rejected'};
export class SyntheticJournal {
  readonly contract=JOURNAL_CONTRACT;readonly tenant:string;readonly store:string;readonly providerId:string;readonly identity:string;
  #db:DatabaseSync;
  constructor(db:DatabaseSync,tenant:string,store:string,providerId='local-journal'){
    this.#db=db;this.tenant=id(tenant);this.store=id(store);this.providerId=id(providerId);
    db.exec(`PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS journal_binding(id INTEGER PRIMARY KEY CHECK(id=1),tenant TEXT NOT NULL,store TEXT NOT NULL,provider TEXT NOT NULL,identity TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS journal_effects(seq INTEGER PRIMARY KEY AUTOINCREMENT,operation_id TEXT NOT NULL UNIQUE,payload_hash TEXT NOT NULL,provider_ref TEXT NOT NULL UNIQUE,result TEXT NOT NULL CHECK(json_valid(result))) STRICT;
      CREATE TABLE IF NOT EXISTS journal_fault(id INTEGER PRIMARY KEY CHECK(id=1),mode TEXT NOT NULL) STRICT;
      CREATE TRIGGER IF NOT EXISTS journal_no_update BEFORE UPDATE ON journal_effects BEGIN SELECT RAISE(ABORT,'JOURNAL_IMMUTABLE');END;
      CREATE TRIGGER IF NOT EXISTS journal_no_delete BEFORE DELETE ON journal_effects BEGIN SELECT RAISE(ABORT,'JOURNAL_IMMUTABLE');END;`);
    const bound=db.prepare('SELECT * FROM journal_binding WHERE id=1').get() as Row;
    if(bound&&(bound.tenant!==tenant||bound.store!==store||bound.provider!==providerId))throw new Error('JOURNAL_SCOPE_CONFLICT');
    this.identity=bound?.identity??'journal_'+token().slice(0,32);
    if(!bound)db.prepare('INSERT INTO journal_binding VALUES(1,?,?,?,?)').run(tenant,store,providerId,this.identity);
    for(const key of ['contract','tenant','store','providerId','identity'])Object.defineProperty(this,key,{writable:false,configurable:false});
  }
  arm(mode:'none'|'not_sent'|'reject'|'after_accept'|'hang_after_accept'|'lookup_unavailable'){
    if(!['none','not_sent','reject','after_accept','hang_after_accept','lookup_unavailable'].includes(mode))throw new Error('INVALID_INPUT');
    this.#db.prepare('INSERT INTO journal_fault VALUES(1,?) ON CONFLICT(id) DO UPDATE SET mode=excluded.mode').run(mode);
  }
  #mode(){return (this.#db.prepare('SELECT mode FROM journal_fault WHERE id=1').get() as Row)?.mode??'none';}
  #envelope(input:unknown){const e=exact(jsonValue(input),['tenant_id','store_id','operation_id','payload_hash','command']);
    if(e.tenant_id!==this.tenant||e.store_id!==this.store)throw new Error('JOURNAL_SCOPE_CONFLICT');id(e.operation_id);
    if(contentDigest(e.command)!==e.payload_hash||!['diagnostic.case.record','diagnostic.projection.record'].includes(e.command.action)||e.command.financial_effect!==false)throw new Error('JOURNAL_INPUT');return e;}
  send(input:unknown):JournalResult|Promise<JournalResult>{const e=this.#envelope(input),db=this.#db;let mode='none',answer:JournalResult;
    db.exec('BEGIN IMMEDIATE');try{
      const old=db.prepare('SELECT * FROM journal_effects WHERE operation_id=?').get(e.operation_id) as Row;
      if(old){if(old.payload_hash!==e.payload_hash)throw new Error('JOURNAL_CONFLICT');answer=JSON.parse(old.result);}
      else{
        mode=this.#mode();db.prepare("UPDATE journal_fault SET mode='none' WHERE id=1").run();
        if(mode==='not_sent')answer={kind:'not_sent',code:'synthetic_transport_unavailable'};
        else if(mode==='reject')answer={kind:'rejected',code:'synthetic_rejected'};
        else{
          answer={kind:'applied',operation_id:e.operation_id,payload_hash:e.payload_hash,provider_ref:'remote_'+contentDigest([this.providerId,e.operation_id]).slice(0,40),outcome:'synthetic_recorded'};
          db.prepare('INSERT INTO journal_effects(operation_id,payload_hash,provider_ref,result) VALUES(?,?,?,?)').run(e.operation_id,e.payload_hash,answer.provider_ref,canonical(answer));
        }
      }
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    if(mode==='after_accept')throw new Error('SYNTHETIC_RESPONSE_LOST');
    if(mode==='hang_after_accept')return new Promise(()=>{});
    return answer!;
  }
  lookup(operationId:string){id(operationId);if(this.#mode()==='lookup_unavailable')throw new Error('JOURNAL_UNAVAILABLE');
    const row=this.#db.prepare('SELECT result FROM journal_effects WHERE operation_id=?').get(operationId) as Row;
    return row?JSON.parse(row.result) as JournalResult:{kind:'unconfirmed'};
  }
  head(){if(this.#mode()==='lookup_unavailable')throw new Error('JOURNAL_UNAVAILABLE');return (this.#db.prepare('SELECT coalesce(max(seq),0) AS n FROM journal_effects').get() as Row).n as number;}
  page(after:number,ceiling:number,limit:number){integer(after);integer(ceiling);integer(limit,1);if(limit>100||after>ceiling)throw new Error('INVALID_INPUT');this.head();
    const rows=this.#db.prepare('SELECT seq,result FROM journal_effects WHERE seq>? AND seq<=? ORDER BY seq LIMIT ?').all(after,ceiling,limit) as Row[];
    const last=rows.at(-1)?.seq??after,more=!!this.#db.prepare('SELECT 1 FROM journal_effects WHERE seq>? AND seq<=? LIMIT 1').get(last,ceiling);
    return {provider_id:this.providerId,provider_identity:this.identity,tenant_id:this.tenant,store_id:this.store,after,ceiling,entries:rows.map(r=>({seq:r.seq,result:JSON.parse(r.result)})),next:more?last:ceiling,complete:!more};
  }
  count(){return (this.#db.prepare('SELECT count(*) n FROM journal_effects').get() as Row).n as number;}
}
