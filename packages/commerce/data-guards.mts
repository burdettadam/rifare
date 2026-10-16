import type { CommerceKernel, Row } from './kernel.mts';
import { createHash } from 'node:crypto';

export function subjectHash(tenant:string, store:string, customer:string) {
  return createHash('sha256').update(JSON.stringify(['rifare-subject-v1',tenant,store,customer])).digest('hex');
}
export function erasedResource(k:CommerceKernel, s:Row, resource:string) {
  return !!k.db.prepare('SELECT 1 FROM commerce_privacy_resources WHERE tenant_id=? AND store_id=? AND resource_id=?').get(s.tenant_id,s.store_id,resource);
}
export function assertNotErased(k:CommerceKernel,s:Row,resource:string,customer:string|null=null) {
  if(erasedResource(k,s,resource)||(customer!==null&&k.db.prepare('SELECT 1 FROM commerce_privacy_subjects WHERE tenant_id=? AND store_id=? AND subject_hash=?')
    .get(s.tenant_id,s.store_id,subjectHash(s.tenant_id,s.store_id,customer))))throw new Error('SUBJECT_ERASED');
}
const RECOVERY_READS=new Set(['resource.read','attachment.read','knowledge.read','skill.read','profile.read','task.read','capability.read','case.read','audit.read','operation.read','operation.reconcile','exception.read','privacy.manage','recovery.manage']);
export function assertRecoveryAction(k:CommerceKernel, action:string) {
  const state=k.db.prepare('SELECT mode FROM commerce_recovery_state WHERE id=1').get() as Row|undefined;
  if(state?.mode==='quarantine'&&!RECOVERY_READS.has(action))throw new Error('RESTORE_WRITE_BLOCKED');
  if(state&&['secret.invoke','model.run'].includes(action))throw new Error('RESTORE_EGRESS_BLOCKED');
}
export function assertRecoveryEgress(k:CommerceKernel) {
  if(k.db.prepare('SELECT 1 FROM commerce_recovery_state WHERE id=1').get())throw new Error('RESTORE_EGRESS_BLOCKED');
}
export function assertRecoveredOperation(k:CommerceKernel,s:Row,operation:string) {
  if(k.db.prepare('SELECT 1 FROM commerce_restored_operations WHERE tenant_id=? AND store_id=? AND operation_id=?').get(s.tenant_id,s.store_id,operation))throw new Error('RESTORED_OPERATION_REPLAY_BLOCKED');
}
