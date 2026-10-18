import type { CommerceKernel,Row } from './kernel.mts';
import { canonical,contentDigest } from './configuration-values.mts';
import { PROCUREMENT_TABLES,procurementBody } from './procurement-core.mts';

const select=(body:Row,fields:readonly string[])=>Object.fromEntries(fields.filter(field=>Object.hasOwn(body,field)).map(field=>[field,body[field]]));
const LINE_FIELDS=['line_id','variant_id','location_id','quantity','ordered_quantity','ordered_base_quantity','order_unit','purchase_unit','base_unit','units_per_purchase','base_quantity','currency_code','unit_cost_minor','line_total_minor'];
function line(value:Row){return {...select(value,LINE_FIELDS),conversion:select(value.conversion??{},['numerator','denominator'])};}
function terms(value:Row){return {...select(value,['schema_version','tenant_id','store_id','source_identity','supplier_id','version','currency_code','effective_at','expires_at','observed_at','qualification','digest']),lines:(value.lines??[]).map((entry:Row)=>({...select(entry,['variant_id','order_unit','base_unit','minimum_quantity','lead_time_days','unit_cost_minor']),conversion:select(entry.conversion??{},['numerator','denominator'])}))};}
function command(value:Row){return {...select(value,['schema_version','operation_id','tenant_id','store_id','resource_id','source_identity','po_id','po_version','po_digest','supplier_id','supplier_terms_version','supplier_terms_digest','warehouse_source_identity','currency_code','total_minor']),lines:(value.lines??[]).map(line)};}
function result(value:Row|null){if(!value)return null;return {...select(value,['schema_version','operation_id','tenant_id','store_id','resource_id','source_identity','po_id','po_version','po_digest','native_id','stage','source_version','acknowledgment_ref','payment_state','invoice_state','observed_at','qualification','digest']),cancelled:(value.cancelled??[]).map((entry:Row)=>select(entry,['event_id','line_id','quantity_base']))};}
function allowlist(table:string,b:Row):Row{
 if(b.redacted)return select(b,['redacted','subject_hash','original_record_id','original_record_digest','original_operation_id','original_po_id','original_po_version','source_identity','native_id','amount_minor','currency_code','replay_allowed']);
 if(table==='commerce_procurement_suppliers')return {...select(b,['supplier_id','resource_id','source_identity','observed_at','external_qualified']),terms:terms(b.terms??{})};
 if(table==='commerce_purchase_orders')return select(b,['id','resource_id','supplier_id','authority_revoked']);
 if(table==='commerce_purchase_order_versions')return {...select(b,['schema_version','id','version','resource_id','resource_digest','supplier_id','supplier_source_identity','supplier_terms_version','supplier_terms_digest','supplier_terms_expires_at','warehouse_source_identity','currency_code','total_minor','replenishment_id','proposed_by','created_at','external_qualified']),lines:(b.lines??[]).map(line),drafting_authority:(b.drafting_authority??[]).map((entry:Row)=>select(entry,['actor_id','authority_revision']))};
 if(table==='commerce_procurement_budgets')return select(b,['id','resource_id','revision','currency_code','limit_minor','approval_limit_minor','expires_at','configured_by','configured_at']);
 if(table==='commerce_procurement_approvals')return select(b,['id','po_id','po_version','po_digest','resource_id','approver','authority_revision','budget_id','budget_digest','reservation_id','total_minor','currency_code','expires_at','control_stamp','approved_at']);
 if(table==='commerce_procurement_reservations')return select(b,['id','budget_id','po_id','po_version','po_digest','approval_id','amount_minor','currency_code','created_at']);
 if(table==='commerce_procurement_sends')return {...select(b,['command_digest','approval_id','approval_digest','reservation_id','sender_actor','sender_authority_revision','attempted_at']),command:command(b.command??{}),result:result(b.result??null)};
 return {...select(b,['schema_version','id','resource_id','variant_id','location_id','supplier_id','supplier_terms_digest','order_unit','base_unit','quantity','base_quantity','net_required_units','rounding','minimum_quantity','proposed_by','created_at','purchasing_authorized','external_qualified']),
  forecast:select(b.forecast??{},['id','digest','approval_id','approval_digest','dataset_digest','backtest_digest','method','baseline','quality']),
  assumptions:{...select(b.assumptions??{},['target_units','point_forecast_units','lower_units','upper_units','horizon_days','lead_time_days','available_units','on_hand_units','reserved_units','incoming_units','stock_source_identity','stock_anchor_id','uncertainty_policy','supplier_minimum_quantity','units_per_purchase','forecast_as_of','forecast_valid_until']),...(b.assumptions?.source_window?{source_window:select(b.assumptions.source_window,['start_at','end_at','cutoff'])}:{})},
  open_orders:(b.open_orders??[]).map((po:Row)=>({...select(po,['po_id','version','digest','operation_id','source_digest']),summary:{...select(po.summary??{},['po_id','version','digest','source_identity','reconciled','planning_blocked']),lines:(po.summary?.lines??[]).map((entry:Row)=>select(entry,['line_id','ordered','cancelled','received','unknown','outstanding','returned']))}})),purchasing_authorized:false};
}
function projected(table:string,b:Row){const clean=allowlist(table,b);for(const field of ['proposed_by','drafting_authority','configured_by','approver','authority_revision','sender_actor','sender_authority_revision','control_stamp'])delete clean[field];
 if(table==='commerce_procurement_approvals')clean.expires_at=0;
 if(table==='commerce_replenishment_drafts'){delete clean.forecast?.approval_id;delete clean.forecast?.approval_digest;}
 return {...clean,authority_revoked:true};
}
function rows(k:CommerceKernel,table:string,tenant:string,store:string){return k.db.prepare('SELECT * FROM '+table+' WHERE tenant_id=? AND store_id=? ORDER BY id').all(tenant,store) as Row[];}
function matches(row:Row,b:Row,ids:Set<string>,hash:string,customer?:string){return ids.has(row.resource_id)||b.subject_hash===hash||customer!==undefined&&b.customer_id===customer;}
/** Valid procurement records belong to customer-free catalogs. An unrelated
 * customer's export therefore receives none. Explicit restored subject links
 * are still minimized through the canonical lifecycle's scope and transaction. */
export function exportProcurementSubject(k:CommerceKernel,tenant:string,store:string,resourceIds:readonly string[],customer:string,hash:string){
 const ids=new Set(resourceIds),output:Record<string,Row[]>={};
 for(const table of PROCUREMENT_TABLES)output[table]=rows(k,table,tenant,store).filter(row=>matches(row,procurementBody(row,true),ids,hash,customer)).map(row=>{const body=projected(table,procurementBody(row,true));return {...row,state:table==='commerce_procurement_approvals'?'revoked':row.state,body:canonical(body),digest:contentDigest(body),source_record_digest:row.digest,projection:'procurement_without_authority'};});
 return output;
}
export function eraseProcurementSubject(k:CommerceKernel,tenant:string,store:string,resourceIds:readonly string[],hash:string){
 const ids=new Set(resourceIds);let minimized=0;
 for(const table of PROCUREMENT_TABLES)for(const row of rows(k,table,tenant,store)){const b=procurementBody(row,true);
  if(!matches(row,b,ids,hash)){let body=allowlist(table,b);if(canonical(body)===canonical(b))continue;
   if(table==='commerce_purchase_orders'&&!body.redacted)body={...body,authority_revoked:true};
   const state=table==='commerce_procurement_approvals'?'revoked':row.state;
   k.db.prepare('UPDATE '+table+' SET state=?,body=?,digest=? WHERE tenant_id=? AND store_id=? AND id=?').run(state,canonical(body),contentDigest(body),tenant,store,row.id);minimized++;continue;
  }
  const body={redacted:true,subject_hash:hash,original_record_id:row.id,original_record_digest:b.original_record_digest??row.digest,
   original_operation_id:b.original_operation_id??b.command?.operation_id??(table==='commerce_procurement_sends'?row.id:null),original_po_id:b.original_po_id??row.po_id??b.po_id??(table==='commerce_purchase_orders'?row.id:null),original_po_version:b.original_po_version??row.po_version??b.version??null,
   source_identity:b.source_identity??b.supplier_source_identity??b.command?.source_identity??null,native_id:b.native_id??b.result?.native_id??null,
   amount_minor:row.amount_minor??b.amount_minor??b.total_minor??null,currency_code:row.currency_code??b.currency_code??b.command?.currency_code??null,replay_allowed:false};
  const state=row.state==='unknown'?'unknown':row.state==='committed'?'committed':'erased';
  k.db.prepare('UPDATE '+table+' SET state=?,body=?,digest=? WHERE tenant_id=? AND store_id=? AND id=?').run(state,canonical(body),contentDigest(body),tenant,store,row.id);minimized++;
 }
 return {minimized,original_unknown_outcomes_preserved:true,source_effects_dispatched:0,physical_deletion:false};
}
export function revokeProcurementForRestore(k:CommerceKernel,tenant?:string,store?:string){
 if((tenant===undefined)!==(store===undefined))throw new Error('PROCUREMENT_SCOPE_REQUIRED');
 const where=tenant===undefined?'':' WHERE tenant_id=? AND store_id=?',args=tenant===undefined?[]:[tenant,store];
 for(const table of PROCUREMENT_TABLES)for(const row of k.db.prepare('SELECT * FROM '+table+where).all(...args) as Row[]){let body=allowlist(table,procurementBody(row,true)),state=row.state;
  if(table==='commerce_purchase_orders'&&!body.redacted)body={...body,authority_revoked:true};
  if(table==='commerce_procurement_approvals')state='revoked';
  else if(['commerce_procurement_suppliers','commerce_replenishment_drafts','commerce_purchase_order_versions','commerce_procurement_budgets'].includes(table))state='revoked_restore';
  k.db.prepare('UPDATE '+table+' SET state=?,body=?,digest=? WHERE tenant_id=? AND store_id=? AND id=?').run(state,canonical(body),contentDigest(body),row.tenant_id,row.store_id,row.id);
 }
 // Reservations and sends retain exact state, amount, command and native identity.
 // Source guards recheck the revoked header/review immediately before any effect.
 return {approvals_revoked:true,source_execution_authority_revoked:true,budgets_disabled:true,original_unknown_outcomes_preserved:true,reservation_amounts_preserved:true,source_effects_dispatched:0};
}
