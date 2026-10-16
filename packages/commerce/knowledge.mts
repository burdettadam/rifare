import { CommerceKernel, boundedJSON, digest, exact, id, integer } from './kernel.mts';
import type { Row, Scope } from './kernel.mts';

function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) throw new Error('INVALID_INPUT');
  return value;
}
export class Knowledge {
  #kernel: CommerceKernel;
  constructor(kernel: CommerceKernel) { this.#kernel = kernel; }

  // Ingestion is an operator action; retrieval never converts prose into policy.
  put(scope: Scope, input: unknown) {
    const s = this.#kernel.require(scope, ['operator']);
    const r = exact(input, ['id','revision','kind','title','content','source_uri','source_updated_at','expires_at','visibility','resource_id']);
    id(r.id); integer(r.revision, 1); integer(r.source_updated_at); integer(r.expires_at);
    if (!['policy','catalog','support'].includes(r.kind) || !['store','staff','private'].includes(r.visibility)) throw new Error('INVALID_INPUT');
    text(r.title, 200); text(r.content, 12000); text(r.source_uri, 1000);
    const uri = new URL(r.source_uri);
    if ((uri.protocol !== 'https:' && !r.source_uri.startsWith('urn:rifare:')) || uri.username || uri.password || uri.hash) throw new Error('INVALID_INPUT');
    const now = this.#kernel.clock();
    if (r.source_updated_at > now || r.expires_at <= now || r.expires_at - now > 366 * 86400000) throw new Error('INVALID_INPUT');
    if (r.resource_id !== null) this.#kernel.get(scope, id(r.resource_id));
    boundedJSON(r);
    this.#kernel.transaction(() => {
      const old = this.#kernel.db.prepare('SELECT revision FROM commerce_knowledge WHERE tenant_id=? AND store_id=? AND id=?')
        .get(s.tenant_id, s.store_id, r.id) as Row;
      if (r.revision !== (old?.revision ?? 0) + 1) throw new Error('SOURCE_VERSION_CONFLICT');
      this.#kernel.db.prepare(`INSERT INTO commerce_knowledge VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)
        ON CONFLICT(tenant_id,store_id,id) DO UPDATE SET revision=excluded.revision,kind=excluded.kind,
        title=excluded.title,content=excluded.content,source_uri=excluded.source_uri,
        source_updated_at=excluded.source_updated_at,observed_at=excluded.observed_at,expires_at=excluded.expires_at,
        visibility=excluded.visibility,owner_actor_id=excluded.owner_actor_id,resource_id=excluded.resource_id,revoked=0`)
        .run(s.tenant_id,s.store_id,r.id,r.revision,r.kind,r.title,r.content,r.source_uri,r.source_updated_at,
          now,r.expires_at,r.visibility,s.actor_id,r.resource_id);
    });
    return this.get(scope, r.id, r.revision);
  }
  revoke(scope: Scope, sourceId: string) {
    const s = this.#kernel.require(scope, ['operator']); id(sourceId);
    this.#kernel.db.prepare('UPDATE commerce_knowledge SET revoked=1 WHERE tenant_id=? AND store_id=? AND id=?').run(s.tenant_id,s.store_id,sourceId);
  }
  #rows(scope: Scope, resourceId?: string): Row[] {
    const s = this.#kernel.require(scope);
    if(resourceId!==undefined)this.#kernel.get(scope,id(resourceId));
    return this.#kernel.db.prepare(`SELECT * FROM commerce_knowledge
      WHERE tenant_id=? AND store_id=? AND revoked=0 AND expires_at>?
      AND (visibility='store' OR (visibility='staff' AND ?!='customer') OR (visibility='private' AND owner_actor_id=? AND ?!='customer'))
      AND (resource_id IS NULL OR ?!='customer' OR resource_id=?)
      AND (resource_id IS NULL OR ? IS NULL OR resource_id=?) ORDER BY id`)
      .all(s.tenant_id,s.store_id,this.#kernel.clock(),s.role,s.actor_id,s.role,s.role,s.resource_id ?? null,resourceId??null,resourceId??null) as Row[];
  }
  #project(r: Row) {
    return {id:r.id,revision:r.revision,kind:r.kind,title:r.title,content:r.content,
      authority:'reference_only',source:{uri:r.source_uri,sha256:digest(r.content),revision:r.revision,
        source_updated_at:r.source_updated_at,observed_at:r.observed_at,expires_at:r.expires_at},
      access:{tenant_id:r.tenant_id,store_id:r.store_id,visibility:r.visibility,resource_id:r.resource_id}};
  }
  get(scope: Scope, sourceId: string, revision: number, resourceId?: string) {
    id(sourceId); integer(revision,1);
    const row = this.#rows(scope,resourceId).find(r => r.id === sourceId && r.revision === revision);
    if (!row) throw new Error('NOT_FOUND');
    return this.#project(row);
  }
  search(scope: Scope, query: string, limit = 5, resourceId?: string) {
    text(query, 200); integer(limit,1); if (limit > 20) throw new Error('INVALID_INPUT');
    const terms = query.toLocaleLowerCase('en-US').trim().split(/\s+/).slice(0,10);
    const rows = this.#rows(scope,resourceId).filter(r => terms.every(t => (r.title+' '+r.content).toLocaleLowerCase('en-US').includes(t))).slice(0,limit);
    return {status:rows.length?'found':'no_permitted_information',authority:'reference_only',sources:rows.map(r => this.#project(r))};
  }
}
