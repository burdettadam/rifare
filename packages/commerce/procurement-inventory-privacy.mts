import { id } from './kernel.mts';
import type { CommerceKernel,Row } from './kernel.mts';
import { canonical,contentDigest } from './configuration-values.mts';
import { PROCUREMENT_INVENTORY_TABLES,stockBody } from './procurement-inventory-core.mts';

type Schema=true|{[key:string]:Schema}|[Schema];
const object=(fields:string,nested:Record<string,Schema>={}):Record<string,Schema>=>({...Object.fromEntries(fields.split(' ').filter(Boolean).map(field=>[field,true])),...nested});
function clean(value:any,schema:Schema):any{if(value===null)return null;if(schema===true)return ['string','number','boolean'].includes(typeof value)?value:null;if(Array.isArray(schema))return Array.isArray(value)?value.map(item=>clean(item,schema[0])):[];if(!value||typeof value!=='object'||Array.isArray(value))return {};return Object.fromEntries(Object.keys(schema).filter(key=>Object.hasOwn(value,key)).map(key=>[key,clean(value[key],schema[key])]));}
const identity='version tenant_id store_id resource_id source_identity';
const marking='redacted erased subject_hash privacy_subject_hash original_record_digest replay_allowed';
const reference=object('id version digest'),stamps=object('procurement warehouse');
const material=object('material_id material_version material_digest resource_id variant_id base_unit quantity currency_code unit_cost_minor total_minor');
const outputMaterial=object('id version digest variant_id base_unit');
const plan=object('bom_id bom_version bom_digest resource_id quantity gross_quantity expected_scrap currency_code total_cost_minor unit_output_cost_minor quantity_rounding cost_allocation qualification physical_effect',{output_material:outputMaterial,materials:[material],bom_refs:[reference]});
const nativeProduction=object(identity+' production_id location_id job_digest bom_digest revision stage good scrap wip_cost_minor output_cost_minor scrap_cost_minor qualification',{plan,components:[object('reserved consumed',material)],outputs:[object('event_id kind good_quantity scrap_quantity correction_of corrected_good')]});
const job=object(identity+' id location_id proposer proposer_authority_revision resource_digest created_at',{control_stamps:stamps,plan});
const observation=object('version receipt_id po_id po_digest line_id event_id kind observation_id quantity quantity_delta unit_cost_minor return_event_id credit_minor production_id good_quantity scrap_quantity correction_of observed_at evidence_ref source_identity tenant_id store_id qualification digest',{lines:[object('line_id quantity unit')]});
const receiptLine=object('line_id variant_id location_id quantity_purchase purchase_unit units_per_purchase quantity unit_cost_minor currency_code ordered cancelled receipt_cost_minor');
const receipt=object(identity+' receipt_id po_id po_version po_digest operation_id source_observation_digest observed_at financial_effect qualification digest',{lines:[receiptLine]});
const supplierEvent=object('resource_id operation_id po_version source_observation_digest financial_effect credit_obligation_minor',observation);
const movement=object(identity+' movement_id variant_id location_id kind reference_id linked_movement_id observed_at qualification digest',{delta:object('available on_hand reserved in_transit'),origin:object('kind id unit_id event_id')});
const command=object(identity+' domain operation_id business_key kind receipt_id event_id production_id',{
 po_ref:object('po_id version expected_digest'),po_pin:object('po_id version digest source_identity warehouse_source_identity operation_id native_id source_version source_digest acknowledgment_ref'),
 po_lines:[object('line_id variant_id location_id ordered cancelled')],lines:[receiptLine],observation,job:object('digest',job),expected_production:nativeProduction,
 expected_positions:[object('variant_id location_id',{values:object('available on_hand reserved in_transit')})]
});
const result=object(identity+' operation_id command_digest state qualification digest',{command,receipt,event:supplierEvent,production:nativeProduction,movements:[movement]});
const schemas:Record<string,Schema>={
 commerce_purchase_receipts:object(marking,receipt),
 commerce_supplier_receipt_events:object(marking,supplierEvent),
 commerce_material_items:object(identity+' id version variant_id base_unit currency_code unit_cost_minor defined_by created_at qualification '+marking),
 commerce_bom_versions:object(identity+' id version yield_numerator yield_denominator defined_by created_at qualification '+marking,{output:object('quantity unit',{material:reference}),components:[object('quantity unit',{material:reference,bom:reference})]}),
 commerce_production_orders:object('job_digest approval_id state authority_revoked '+marking,{...job,native:nativeProduction}),
 commerce_stock_operations:object(identity+' operation_id business_key kind state command_digest proposer proposer_authority_revision resource_digest approval_id authority_revoked created_at '+marking,{command,result,control_stamps:stamps}),
 commerce_stock_approvals:object('id tenant_id store_id resource_id reference_id kind state expected_digest proposer proposer_authority_revision approver approver_authority_revision expires_at used '+marking,{control_stamps:stamps})
};
function key(table:string){return table==='commerce_purchase_receipts'?'receipt_id':table==='commerce_supplier_receipt_events'?'event_id':table==='commerce_stock_operations'?'operation_id':'id';}
function stored(k:CommerceKernel,table:string,tenant?:string,store?:string){const where=tenant===undefined?'':' WHERE tenant_id=? AND store_id=?';return k.db.prepare('SELECT * FROM '+table+where+' ORDER BY rowid').all(...(tenant===undefined?[]:[tenant,store])) as Row[];}
function update(k:CommerceKernel,table:string,row:Row,body:Row){const field=key(table),version=['commerce_material_items','commerce_bom_versions'].includes(table),state=Object.hasOwn(row,'state');k.db.prepare('UPDATE '+table+' SET '+(state?'state=?,':'')+'body=?,digest=? WHERE tenant_id=? AND store_id=? AND '+field+'=?'+(version?' AND version=?':'')).run(...(state?[body.state]:[]),canonical(body),contentDigest(body),row.tenant_id,row.store_id,row[field],...(version?[row.version]:[]));}
function selected(row:Row,b:Row,ids:Set<string>,hash:string){return ids.has(row.resource_id)||b.subject_hash===hash||b.privacy_subject_hash===hash;}
function revoke(table:string,b:Row){if(table==='commerce_stock_approvals'){b.state='revoked';b.expires_at=0;}if(table==='commerce_stock_operations'||table==='commerce_production_orders')b.authority_revoked=true;return b;}

/** Customer-free inventory records are excluded from unrelated customer exports.
 * Explicit resource/tombstone lineage, if restored, gets a bounded projection. */
export function exportProcurementInventorySubject(k:CommerceKernel,tenant:string,store:string,resourceIds:readonly string[],_customer:string,hash:string){const ids=new Set(resourceIds),out:Record<string,Row[]>={};
 for(const table of PROCUREMENT_INVENTORY_TABLES)out[table]=stored(k,table,tenant,store).filter(row=>selected(row,stockBody(row,true),ids,hash)).map(row=>{const b=revoke(table,clean(stockBody(row,true),schemas[table]));for(const field of ['proposer','proposer_authority_revision','approver','approver_authority_revision','defined_by','control_stamps'])delete b[field];b.replay_allowed=false;return {...row,...(Object.hasOwn(row,'state')?{state:b.state}:{}),body:canonical(b),digest:contentDigest(b),source_record_digest:row.digest,projection:'stock_without_execution_authority'};});return out;
}
export function eraseProcurementInventorySubject(k:CommerceKernel,tenant:string,store:string,resourceIds:readonly string[],hash:string){const ids=new Set(resourceIds);let minimized=0;
 for(const table of PROCUREMENT_INVENTORY_TABLES)for(const row of stored(k,table,tenant,store)){const b=stockBody(row,true),matches=selected(row,b,ids,hash);let next:Row=clean(b,schemas[table]);if(matches){next={...next,redacted:true,erased:true,privacy_subject_hash:hash,original_record_digest:b.original_record_digest??row.digest,replay_allowed:false};for(const field of ['proposer','proposer_authority_revision','approver','approver_authority_revision','defined_by','control_stamps'])delete next[field];}
  if(matches||!same(next,b)){next=revoke(table,next);update(k,table,row,next);minimized++;}
 }
 return {minimized,customer_free_business_data_preserved:true,original_unknown_outcomes_preserved:true,source_effects_dispatched:0,physical_deletion:false};
}
const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
export function revokeProcurementInventoryForRestore(k:CommerceKernel,tenant?:string,store?:string){if((tenant===undefined)!==(store===undefined))throw new Error('STOCK_SCOPE_REQUIRED');if(tenant!==undefined){id(tenant);id(store);}let revoked=0;
 for(const table of PROCUREMENT_INVENTORY_TABLES)for(const row of stored(k,table,tenant,store)){const b=revoke(table,clean(stockBody(row,true),schemas[table]));update(k,table,row,b);revoked++;}
 return {records_sanitized:revoked,approvals_revoked:true,source_execution_authority_revoked:true,original_unknown_outcomes_preserved:true,source_effects_dispatched:0};
}
