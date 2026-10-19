import type { CommerceKernel } from './kernel.mts';
import { exportAgencySubject, eraseAgencySubject, revokeAgencyForRestore } from './agency-privacy.mts';
import { exportExtensionSubject, eraseExtensionSubject, revokeExtensionsForRestore } from './extension-privacy.mts';

/** Authentication and customer resource selection stay with PrivacyLifecycle.
 * Agency/configuration/extension business records contain no customer facts and
 * cannot disclose store authority, profile history or artifacts in that export. */
export function exportEcosystemSubject(k:CommerceKernel,tenant:string,store:string,resourceIds:string[],customer:string,hash:string) {
  return {
    ...exportAgencySubject(k,tenant,store,resourceIds,customer,hash),
    ...exportExtensionSubject(k,tenant,store,resourceIds,customer,hash),
  };
}

/** Reapply typed nested allowlists even for an empty resource list and repeated
 * hash-only erasure. Keep valid unrelated merchant history and original pins;
 * malformed restored authority cannot survive merely because its keys are known. */
export function eraseEcosystemSubject(k:CommerceKernel,tenant:string,store:string,resourceIds:string[],hash:string) {
  eraseAgencySubject(k,tenant,store,resourceIds,hash);
  eraseExtensionSubject(k,tenant,store,resourceIds,hash);
}

/** Called inside the canonical import/recovery/uninstall transaction. No subject
 * tombstone is required to revoke restored grants and approvals. This performs
 * no new installation, delivery, migration or native business effect. */
export function revokeEcosystemForRestore(k:CommerceKernel,tenant?:string,store?:string) {
  if((tenant===undefined)!==(store===undefined))throw new Error('INVALID_INPUT');
  revokeAgencyForRestore(k,tenant,store);
  revokeExtensionsForRestore(k,tenant,store);
  return {authority_revoked:true,archived_history_retained:true,source_effects_dispatched:0};
}
