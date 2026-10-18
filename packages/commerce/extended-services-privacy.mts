import type { CommerceKernel } from './kernel.mts';
import { exportPartnerSubject, erasePartnerSubject, revokePartnerForRestore } from './partner-privacy.mts';
import { exportClaimsSubject, eraseClaimsSubject, revokeClaimsForRestore } from './claims-privacy.mts';
import { exportTrialSubject, eraseTrialSubject, revokeTrialsForRestore } from './delivery-trial-privacy.mts';

/** The canonical privacy owner authenticates and authorizes the caller before
 * invoking this explicit inventory. Configuration is included only when linked
 * to the requested subject. Provider stores and caller copies are not exported. */
export function exportExtendedServicesSubject(k:CommerceKernel,tenant:string,store:string,resourceIds:string[],customer:string,hash:string) {
  return {
    ...exportPartnerSubject(k,tenant,store,resourceIds,customer,hash),
    ...exportClaimsSubject(k,tenant,store,resourceIds,customer,hash),
    ...exportTrialSubject(k,tenant,store,resourceIds,customer,hash),
  };
}

/** Called in the canonical transaction even for an empty resource list. Every
 * service reconstructs its allowlist for a repeated or restored subject hash;
 * original uncertain native identities remain without execution authority. */
export function eraseExtendedServicesSubject(k:CommerceKernel,tenant:string,store:string,resourceIds:string[],hash:string) {
  erasePartnerSubject(k,tenant,store,resourceIds,hash);
  eraseClaimsSubject(k,tenant,store,resourceIds,hash);
  eraseTrialSubject(k,tenant,store,resourceIds,hash);
}

/** Imports, snapshot recovery and uninstall revoke authority for all affected
 * subjects, including subjects without erasure tombstones. No source is called. */
export function revokeExtendedServicesForRestore(k:CommerceKernel,tenant?:string,store?:string) {
  if((tenant===undefined)!==(store===undefined))throw new Error('INVALID_INPUT');
  revokePartnerForRestore(k,tenant,store);
  revokeClaimsForRestore(k,tenant,store);
  revokeTrialsForRestore(k,tenant,store);
  return {authority_revoked:true,original_outcomes_retained:true,source_effects_dispatched:0};
}
