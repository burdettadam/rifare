import { CommerceKernel,exact,id,integer,digest } from './kernel.mts';
import type { Scope,Row } from './kernel.mts';
import { jsonValue,contentDigest } from './configuration-values.mts';
import { queueOperation } from './operation-store.mts';

export class EventProcessor {
  #k:CommerceKernel;constructor(kernel:CommerceKernel){this.#k=kernel;}
  process(scope:Scope,inboxId:string){const k=this.#k;id(inboxId);
    return k.transaction(()=>{const s=k.require(scope),r=k.db.prepare(`SELECT i.*,r.enabled,r.provider,r.topic FROM commerce_webhook_inbox i
      JOIN commerce_webhook_routes r ON r.id=i.route_id WHERE i.tenant_id=? AND i.store_id=? AND i.id=?`).get(s.tenant_id,s.store_id,inboxId) as Row;
      if(!r)throw new Error('NOT_FOUND');const metadata=JSON.parse(r.metadata);
      if(r.status!=='pending'||r.provider!=='synthetic'||metadata.routing_verified!==true||!r.enabled||r.topic!=='cases/updated')throw new Error('EVENT_NOT_PROCESSABLE');
      const raw=Buffer.from(r.body);if(digest(raw)!==r.sha256)throw new Error('WEBHOOK_INTEGRITY');
      const e=exact(jsonValue(JSON.parse(raw.toString('utf8'))),['schema_version','event_id','resource_id','source_version','source_updated_at','state']);
      id(e.event_id);id(e.resource_id);integer(e.source_version,1);integer(e.source_updated_at);
      if(e.schema_version!==1||e.source_updated_at>k.clock()||!['open','approved','closed'].includes(e.state))throw new Error('EVENT_INVALID');
      k.authorize(scope,'event.process',e.resource_id);const source=k.get(scope,e.resource_id);
      if(source.kind!=='order'||source.source_system!=='synthetic')throw new Error('EVENT_NOT_PROCESSABLE');
      const processed=k.db.prepare('SELECT disposition,operation_id,event_id FROM commerce_event_consumption WHERE tenant_id=? AND store_id=? AND inbox_id=?').get(s.tenant_id,s.store_id,inboxId) as Row;
      if(processed)return {...processed,replayed:true};
      const hash=contentDigest(e),prior=k.db.prepare('SELECT * FROM commerce_event_identities WHERE tenant_id=? AND store_id=? AND event_id=?').get(s.tenant_id,s.store_id,e.event_id) as Row;
      let disposition='applied',operationId:string|null=null;
      if(prior){disposition=prior.event_hash===hash?'duplicate':'conflict';}
      else{
        const old=k.db.prepare('SELECT * FROM commerce_event_projections WHERE tenant_id=? AND store_id=? AND resource_id=?').get(s.tenant_id,s.store_id,e.resource_id) as Row;
        const stateHash=contentDigest({source_version:e.source_version,source_updated_at:e.source_updated_at,state:e.state});
        if(old){
          if(e.source_version<old.source_version||e.source_updated_at<old.source_updated_at)disposition='stale';
          else if(e.source_version===old.source_version)disposition=stateHash===old.state_hash?'duplicate':'conflict';
          else if(old.state==='closed'&&e.state!=='closed'||old.state==='approved'&&e.state==='open')disposition='conflict';
        }
        k.db.prepare('INSERT INTO commerce_event_identities VALUES(?,?,?,?,?,?)').run(s.tenant_id,s.store_id,e.event_id,hash,inboxId,e.resource_id);
        if(disposition==='applied'){
          k.db.prepare(`INSERT INTO commerce_event_projections VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,store_id,resource_id)
            DO UPDATE SET source_version=excluded.source_version,source_updated_at=excluded.source_updated_at,state=excluded.state,state_hash=excluded.state_hash,inbox_id=excluded.inbox_id`)
            .run(s.tenant_id,s.store_id,e.resource_id,e.source_version,e.source_updated_at,e.state,stateHash,inboxId);
          operationId=queueOperation(k,s,e.resource_id,'event',e.event_id,{schema_version:1,action:'diagnostic.projection.record',resource_id:e.resource_id,
            source_id:e.event_id,source_digest:hash,state:e.state,source_version:e.source_version,financial_effect:false}).id;
        }
      }
      k.db.prepare('INSERT INTO commerce_event_consumption VALUES(?,?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,inboxId,e.event_id,hash,e.resource_id,disposition,operationId,k.clock());
      return {disposition,operation_id:operationId,event_id:e.event_id,replayed:false};
    });}
  state(scope:Scope,resourceId:string){const k=this.#k,s=k.authorize(scope,'resource.read',id(resourceId));
    const r=k.db.prepare('SELECT source_version,source_updated_at,state,inbox_id FROM commerce_event_projections WHERE tenant_id=? AND store_id=? AND resource_id=?').get(s.tenant_id,s.store_id,resourceId) as Row;
    if(!r)throw new Error('NOT_FOUND');return {...r,diagnostic_projection:true};}
}
