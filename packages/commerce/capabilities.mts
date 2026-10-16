import { CommerceKernel, digest, exact, id } from './kernel.mts';
import type { Scope, Row } from './kernel.mts';

export const READS = Object.freeze({
  'order.read':Object.freeze({kind:'order',scope:'read_orders'}),
  'customer.read':Object.freeze({kind:'customer',scope:'read_customers'}),
  'shipment.read':Object.freeze({kind:'shipment',scope:'read_shipments'}),
  'catalog.read':Object.freeze({kind:'catalog',scope:'read_catalog'}),
  'payment.read':Object.freeze({kind:'payment',scope:'read_payments'}),
});
export const CONTRACT_VERSION='simulator-read-v1';
export const CONTRACT_HASH=digest(JSON.stringify({version:CONTRACT_VERSION,reads:READS,markets:['US'],writes:false}));
export const ACTIONS=Object.freeze([...Object.keys(READS),'order.refund','order.edit','history.read','support.handoff']);
export class CapabilityLimitation extends Error {
  readonly reason: string;
  constructor(reason:string){super('CAPABILITY_UNAVAILABLE');this.reason=reason;}
}
export class Capabilities {
  #kernel:CommerceKernel;
  constructor(kernel:CommerceKernel){this.#kernel=kernel;}
  configure(scope:Scope,input:unknown) {
    this.#kernel.authorize(scope,'connection.manage');
    const s=this.#kernel.require(scope,['operator']);const r=exact(input,['adapter','contract_version','granted_scopes','qualification']);
    id(r.adapter);id(r.contract_version);
    if(!['simulator','shopify','woocommerce'].includes(r.adapter)||!['synthetic','unverified'].includes(r.qualification)
      ||!Array.isArray(r.granted_scopes)||r.granted_scopes.length>20||new Set(r.granted_scopes).size!==r.granted_scopes.length)throw new Error('INVALID_INPUT');
    for(const grant of r.granted_scopes)id(grant);
    if(r.qualification==='synthetic' && (r.adapter!=='simulator'||r.contract_version!==CONTRACT_VERSION))throw new Error('INVALID_INPUT');
    const evidence=r.qualification==='synthetic'?CONTRACT_HASH:'';
    this.#kernel.db.prepare(`INSERT INTO commerce_connections VALUES(?,?,?,?,?,?,?,1)
      ON CONFLICT(tenant_id,store_id) DO UPDATE SET adapter=excluded.adapter,contract_version=excluded.contract_version,
      granted_scopes=excluded.granted_scopes,qualification=excluded.qualification,evidence_hash=excluded.evidence_hash,revision=commerce_connections.revision+1`)
      .run(s.tenant_id,s.store_id,r.adapter,r.contract_version,JSON.stringify(r.granted_scopes),r.qualification,evidence);
  }
  evaluate(scope:Scope,action:string,resourceId?:string) {
    this.#kernel.authorize(scope,'capability.read');
    const k=this.#kernel,s=k.require(scope);
    const connection=k.db.prepare('SELECT * FROM commerce_connections WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row;
    const store=k.db.prepare('SELECT market FROM commerce_stores WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row;
    const base={action,version:'1',adapter:connection?.adapter??null,contract_version:connection?.contract_version??null,
      connection_revision:connection?.revision??0,market:store.market,production_qualified:false,
      evidence:connection?.qualification==='synthetic'?{kind:'synthetic_contract',sha256:connection.evidence_hash}:null};
    const deny=(status:string,reason:string)=>({...base,status,available:false,reason});
    if(typeof action!=='string'||!ACTIONS.includes(action))return deny('unsupported','UNKNOWN_ACTION');
    if(action==='support.handoff')return deny('manual','HUMAN_HANDOFF_NOT_IMPLEMENTED');
    if(action==='history.read')return deny('unsupported','MESSAGE_HISTORY_UNAVAILABLE');
    if(!(action in READS))return deny('unsupported','READ_ONLY_PHASE');
    if(s.role==='customer'&&action!=='order.read')return deny('unsupported','SESSION_SCOPE_LIMITED');
    if(!connection||connection.qualification!=='synthetic')return deny('unverified','ADAPTER_UNQUALIFIED');
    if(connection.adapter!=='simulator'||connection.contract_version!==CONTRACT_VERSION||connection.evidence_hash!==CONTRACT_HASH)
      return deny('unverified','CONTRACT_EVIDENCE_MISMATCH');
    const spec=READS[action as keyof typeof READS];
    const grants=JSON.parse(connection.granted_scopes);
    if(!Array.isArray(grants)||!grants.includes(spec.scope))return deny('unsupported','REQUIRED_SCOPE_MISSING');
    if(store.market!=='US')return deny('unsupported','MARKET_UNQUALIFIED');
    if(resourceId) {
      const resource=k.get(scope,resourceId);
      if(resource.kind!==spec.kind||resource.source_system!=='synthetic')return deny('unsupported','RESOURCE_CONTEXT_MISMATCH');
      if(resource.kind==='order'&&!['processing','shipped','delivered','cancelled'].includes(resource.payload.status))
        return deny('unverified','RESOURCE_STATE_UNQUALIFIED');
    }
    return {...base,status:'native',available:true,reason:'SYNTHETIC_READ_ONLY'};
  }
  list(scope:Scope){return ACTIONS.map(a=>this.evaluate(scope,a));}
  read(scope:Scope,action:string,resourceId:string) {
    const decision=this.evaluate(scope,action,resourceId);
    if(!decision.available)throw new CapabilityLimitation(decision.reason);
    return this.#kernel.get(scope,resourceId);
  }
  listResources(scope:Scope,kind:string) {
    const spec=Object.entries(READS).find(([,r])=>r.kind===kind);
    if(!spec)throw new CapabilityLimitation('UNKNOWN_ACTION');
    const decision=this.evaluate(scope,spec[0]);if(!decision.available)throw new CapabilityLimitation(decision.reason);
    const rows=this.#kernel.list(scope,kind);
    // Discovery is informational; each resource is evaluated again at execution.
    return rows.filter(r=>this.evaluate(scope,spec[0],r.id).available);
  }
}
