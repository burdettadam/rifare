import type { CommerceKernel } from './kernel.mts';
import { exportForecastSubject, eraseForecastSubject, revokeForecastsForRestore } from './forecast-privacy.mts';
import { exportProcurementSubject, eraseProcurementSubject, revokeProcurementForRestore } from './procurement-privacy.mts';
import { exportProcurementInventorySubject, eraseProcurementInventorySubject, revokeProcurementInventoryForRestore } from './procurement-inventory-privacy.mts';

/** The canonical privacy owner authenticates subject requests. These merchant
 * aggregate/catalog records accept no customer facts and disclose no business
 * records or replay credentials in a customer export. */
export function exportInventoryPlanningSubject(k:CommerceKernel,tenant:string,store:string,resourceIds:string[],customer:string,hash:string) {
  return {
    ...exportForecastSubject(k,tenant,store,resourceIds,customer,hash),
    ...exportProcurementSubject(k,tenant,store,resourceIds,customer,hash),
    ...exportProcurementInventorySubject(k,tenant,store,resourceIds,customer,hash),
  };
}

/** Always reapply the declared field allowlists, including repeated hash-only
 * erasure. Original business records and uncertain native identities survive;
 * arbitrary restored customer copies cannot become permanent merchant data. */
export function eraseInventoryPlanningSubject(k:CommerceKernel,tenant:string,store:string,resourceIds:string[],hash:string) {
  eraseForecastSubject(k,tenant,store,resourceIds,hash);
  eraseProcurementSubject(k,tenant,store,resourceIds,hash);
  eraseProcurementInventorySubject(k,tenant,store,resourceIds,hash);
}

/** Imports, recovery and uninstall revoke all affected planning/spend/stock
 * authority, including stores with no customer tombstones. Source lookup and
 * historical obligations remain; this function dispatches no external effect. */
export function revokeInventoryPlanningForRestore(k:CommerceKernel,tenant?:string,store?:string) {
  if((tenant===undefined)!==(store===undefined))throw new Error('INVALID_INPUT');
  revokeForecastsForRestore(k,tenant,store);
  revokeProcurementForRestore(k,tenant,store);
  revokeProcurementInventoryForRestore(k,tenant,store);
  return {authority_revoked:true,original_outcomes_retained:true,source_effects_dispatched:0};
}
