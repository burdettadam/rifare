import type {CommerceKernel,Row} from './kernel.mts';
// Called from the common authorization boundary. No case ownership exists until support is opened.
export function assertSupportAction(k:CommerceKernel,s:Row,action:string,resource:string|null,workerCase:string|null=null) {
 if(!['agent','worker'].includes(s.role)||!['action.propose','action.execute','model.run','work.claim','support.reply','support.send'].includes(action)||resource===null)return;
 const rows=k.db.prepare('SELECT * FROM commerce_support_ownership WHERE tenant_id=? AND store_id=? AND resource_id=?').all(s.tenant_id,s.store_id,resource) as Row[];
 for(const row of rows.filter(r=>workerCase===null||r.case_id===workerCase))if(row.mode!=='agent'||row.owner!==s.actor_id)throw new Error('SUPPORT_TAKEN_OVER');
}
