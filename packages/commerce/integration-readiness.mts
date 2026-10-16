import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { exact, integer } from './kernel.mts';
import { contentDigest } from './configuration-values.mts';
import { CONTRACT_HASH,CONTRACT_VERSION } from './capabilities.mts';
import { controlState } from './execution-stops.mts';

export const DRAFT_ACTION='diagnostic.resolution.set';
export const READINESS_CONTRACT=Object.freeze({version:'1.0.0',action:DRAFT_ACTION,adapter:'simulator',effect:'local_case_plan_only',financial_effect:false,required_scopes:['read_orders'],warehouse_hold:'not_required_for_local_draft'});
export const READINESS_DIGEST=contentDigest(READINESS_CONTRACT);
function connection(k:CommerceKernel,s:Row){return k.db.prepare('SELECT * FROM commerce_connections WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row|undefined;}
function validConnection(c:Row|undefined){return c?.adapter==='simulator'&&c.contract_version===CONTRACT_VERSION&&c.qualification==='synthetic'&&c.evidence_hash===CONTRACT_HASH;}
// Server-owned qualification of the only implemented reversible effect. Not a merchant readiness flag.
export function qualifyLocalDraft(k:CommerceKernel,s:Row,settingsRevision:number,ttl=3600000) {
  integer(ttl,1);if(ttl>3600000)throw new Error('INVALID_INPUT');
  const c=connection(k,s);if(!validConnection(c)||!JSON.parse(c!.granted_scopes).includes('read_orders'))throw new Error('INTEGRATION_NOT_READY');
  const now=k.clock(),evidence=contentDigest({contract:READINESS_DIGEST,connection:c,settings_revision:settingsRevision,checked_at:now,expires_at:now+ttl});
  k.db.prepare(`INSERT INTO commerce_action_readiness VALUES(?,?,?,?,?,?,?,?,?,0) ON CONFLICT(tenant_id,store_id,action) DO UPDATE SET
    connection_revision=excluded.connection_revision,contract_digest=excluded.contract_digest,settings_revision=excluded.settings_revision,
    evidence_digest=excluded.evidence_digest,checked_at=excluded.checked_at,expires_at=excluded.expires_at,revoked=0`)
    .run(s.tenant_id,s.store_id,DRAFT_ACTION,c!.revision,READINESS_DIGEST,settingsRevision,evidence,now,now+ttl);
}
export function readiness(k:CommerceKernel,s:Row,action:string) {
  const reasons:string[]=[],c=connection(k,s),r=k.db.prepare('SELECT * FROM commerce_action_readiness WHERE tenant_id=? AND store_id=? AND action=?').get(s.tenant_id,s.store_id,action) as Row|undefined;
  const settings=k.db.prepare('SELECT enabled,revision FROM commerce_execution_settings WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row|undefined;
  if(action!==DRAFT_ACTION)reasons.push('ACTION_UNQUALIFIED');
  if(!validConnection(c))reasons.push('PLATFORM_UNQUALIFIED');
  if(!c||!JSON.parse(c.granted_scopes).includes('read_orders'))reasons.push('REQUIRED_SCOPE_MISSING');
  if(!settings?.enabled)reasons.push('ACTION_DISABLED');
  if(!r||r.revoked||r.checked_at>k.clock()||r.expires_at<=k.clock())reasons.push('PROOF_MISSING_EXPIRED_OR_REVOKED');
  if(r&&(r.connection_revision!==c?.revision||r.settings_revision!==settings?.revision||r.contract_digest!==READINESS_DIGEST||
    r.evidence_digest!==contentDigest({contract:READINESS_DIGEST,connection:c,settings_revision:r.settings_revision,checked_at:r.checked_at,expires_at:r.expires_at})))reasons.push('PROOF_CONTEXT_CHANGED');
  if(controlState(k,s,action).stopped)reasons.push('EXECUTION_STOPPED');
  if(k.db.prepare("SELECT 1 FROM commerce_recovery_state WHERE id=1 AND mode='quarantine'").get())reasons.push('RESTORE_QUARANTINED');
  return {action,ready:reasons.length===0,reasons,evidence_digest:r?.evidence_digest??null,expires_at:r?.expires_at??null,
    qualifier:'synthetic_local_draft_only',warehouse_hold_verified:false,production_qualified:false,execution_authorized:false};
}
export function assertReady(k:CommerceKernel,s:Row,action:string){const result=readiness(k,s,action);if(!result.ready)throw new Error('INTEGRATION_NOT_READY');return result;}
export class IntegrationReadiness {
  readonly kernel:CommerceKernel;constructor(kernel:CommerceKernel){this.kernel=kernel;}
  inspect(scope:Scope,action:string){const s=this.kernel.authorize(scope,'capability.read');return readiness(this.kernel,s,action);}
  revoke(scope:Scope,input:unknown){const p=exact(input,['action']);if(p.action!==DRAFT_ACTION)throw new Error('INVALID_INPUT');
    return this.kernel.transaction(()=>{const s=this.kernel.authorize(scope,'action.configure');this.kernel.db.prepare('UPDATE commerce_action_readiness SET revoked=1 WHERE tenant_id=? AND store_id=? AND action=?').run(s.tenant_id,s.store_id,p.action);return {revoked:true};});}
}
