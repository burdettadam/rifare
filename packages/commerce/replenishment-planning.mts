import { exact,id,integer } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { InventoryForecasts } from './inventory-forecasts.mts';
import { LocationInventory,INVENTORY_FIELDS,inventoryRow } from './location-inventory.mts';
import { SupplierPurchaseOrders } from './supplier-purchase-orders.mts';
import { PurchaseReceiving } from './purchase-receiving.mts';
import { procurementScope,procurementRow } from './procurement-core.mts';

/** Exact base-unit arithmetic used by the authenticated planning service. */
export function calculateReplenishment(input:Row){
 exact(input,['target_units','available_units','incoming_units','units_per_purchase','minimum_quantity']);
 const target=integer(input.target_units),available=integer(input.available_units);
 const incoming = integer(input.incoming_units);
 const conversion=integer(input.units_per_purchase,1),minimum=integer(input.minimum_quantity,1);
 const needed=Math.max(0,target-available-incoming),quantity=needed===0?0:Math.max(minimum,Math.ceil(needed/conversion)),base=quantity*conversion;
 if(!Number.isSafeInteger(base)||base>1000000000)throw new Error('REPLENISHMENT_QUANTITY_INVALID');
 return {quantity,base_quantity:base,net_required_units:needed,rounding:'ceiling_to_supported_purchase_unit',minimum_quantity:minimum};
}
export class ReplenishmentPlanning {
 readonly k:CommerceKernel;readonly forecasts:InventoryForecasts;readonly inventory:LocationInventory;readonly orders:SupplierPurchaseOrders;readonly receipts:PurchaseReceiving;
 constructor(k:CommerceKernel,forecasts:InventoryForecasts,inventory:LocationInventory,orders:SupplierPurchaseOrders,receipts:PurchaseReceiving){
  if(!(forecasts instanceof InventoryForecasts)||forecasts.k!==k||!(inventory instanceof LocationInventory)||inventory.kernel!==k||!(orders instanceof SupplierPurchaseOrders)||orders.k!==k||orders.inventory!==inventory||!(receipts instanceof PurchaseReceiving)||receipts.k!==k||receipts.inventory!==inventory||receipts.source!==inventory.source)throw new Error('CANONICAL_PLANNING_SERVICES_REQUIRED');
  this.k=k;this.forecasts=forecasts;this.inventory=inventory;this.orders=orders;this.receipts=receipts;
 }
 propose(scope:Scope,input:unknown){const p=exact(jsonValue(input),['replenishment_id','resource_id','variant_id','location_id','forecast_id','expected_forecast_digest','supplier_id','expected_terms_digest','order_unit']);
  for(const field of ['replenishment_id','resource_id','variant_id','location_id','forecast_id','supplier_id'])id(p[field]);
  return this.k.transaction(()=>{const {s}=procurementScope(this.k,scope,p.resource_id,'action.propose'),forecast=this.forecasts.assertReviewed(scope,{forecast_id:p.forecast_id,expected_digest:p.expected_forecast_digest});
   if(forecast.resource_id!==p.resource_id||forecast.variant_id!==p.variant_id||forecast.location_id!==p.location_id||forecast.unit!=='each'||!['evaluated','baseline_fallback'].includes(forecast.quality))throw new Error('REPLENISHMENT_FORECAST_SCOPE');
   const terms=this.orders.supplier(scope,{supplier_id:p.supplier_id,resource_id:p.resource_id,expected_terms_digest:p.expected_terms_digest}),term=terms.lines.find((line:Row)=>line.variant_id===p.variant_id&&line.order_unit===p.order_unit);
   if(!term||term.base_unit!=='each'||forecast.horizon_days<term.lead_time_days||forecast.valid_until<this.k.clock()+term.lead_time_days*86400000)throw new Error('REPLENISHMENT_HORIZON_OR_UNIT_UNSUPPORTED');
   const balance=this.inventory.balance(scope,{resource_id:p.resource_id,variant_id:p.variant_id,location_id:p.location_id}),native=this.inventory.source.position({variant_id:p.variant_id,location_id:p.location_id});
   if(!balance.anchored||INVENTORY_FIELDS.some(field=>balance[field]!==native[field])||this.inventory.discrepancies(scope,{resource_id:p.resource_id}).some((row:Row)=>!row.resolved))throw new Error('REPLENISHMENT_INVENTORY_UNRECONCILED');
   const transfers=this.k.db.prepare('SELECT * FROM commerce_inventory_transfer_operations WHERE tenant_id=? AND store_id=? AND resource_id=?').all(s.tenant_id,s.store_id,p.resource_id) as Row[];
   if(transfers.some(row=>inventoryRow(row,true).state==='unknown')||this.k.db.prepare("SELECT 1 FROM commerce_stock_operations WHERE tenant_id=? AND store_id=? AND resource_id=? AND state='unknown'").get(s.tenant_id,s.store_id,p.resource_id))throw new Error('REPLENISHMENT_INVENTORY_UNCERTAIN');
   const summaries:Row[]=[];let incoming=0;
   for(const po of this.orders.list(scope,{resource_id:p.resource_id})){
    const matching=po.lines.filter((line:Row)=>line.variant_id===p.variant_id&&line.location_id===p.location_id);if(!matching.length)continue;
    if(['unknown','sent'].includes(po.state))throw new Error('REPLENISHMENT_PO_UNCERTAIN');
    if(po.state!=='acknowledged')continue;
    this.orders.assertSourceCurrent(scope,{po_id:po.id,version:po.version,expected_digest:po.digest});
    if(po.warehouse_source_identity!==this.inventory.source.identity)throw new Error('REPLENISHMENT_INVENTORY_SOURCE_CHANGED');
    const summary=this.receipts.summary(scope,{po_id:po.id,version:po.version,expected_digest:po.digest});
    if(summary.planning_blocked||!summary.reconciled)throw new Error('REPLENISHMENT_RECEIPTS_UNCERTAIN');
    for(const line of matching){const result=summary.lines.find((row:Row)=>row.line_id===line.line_id);if(!result)throw new Error('REPLENISHMENT_RECEIPT_LINE_MISSING');
     for(const field of ['ordered','cancelled','received','unknown','outstanding'])integer(result[field]);
     if(result.unknown!==0||result.ordered!==line.ordered_base_quantity||result.cancelled!==line.cancelled_quantity_base||result.ordered!==result.cancelled+result.received+result.unknown+result.outstanding)throw new Error('REPLENISHMENT_RECEIPT_CONSERVATION');
     incoming+=result.outstanding;if(!Number.isSafeInteger(incoming))throw new Error('REPLENISHMENT_QUANTITY_INVALID');
    }
    summaries.push({po_id:po.id,version:po.version,digest:po.digest,operation_id:po.operation_id,source_digest:po.source_digest,summary});
   }
   const arithmetic=calculateReplenishment({target_units:forecast.upper_units,available_units:balance.available,incoming_units:incoming,units_per_purchase:term.conversion.numerator,minimum_quantity:term.minimum_quantity});
   const body={schema_version:1,id:p.replenishment_id,resource_id:p.resource_id,variant_id:p.variant_id,location_id:p.location_id,supplier_id:p.supplier_id,supplier_terms_digest:terms.digest,order_unit:p.order_unit,base_unit:'each',...arithmetic,
    forecast:{id:forecast.id,digest:forecast.digest,approval_id:forecast.approval_id,approval_digest:forecast.approval_digest,dataset_digest:forecast.dataset_digest,backtest_digest:forecast.backtest_digest,method:forecast.method,baseline:forecast.baseline,quality:forecast.quality},
    assumptions:{target_units:forecast.upper_units,point_forecast_units:forecast.quantity,lower_units:forecast.lower_units,upper_units:forecast.upper_units,horizon_days:forecast.horizon_days,forecast_as_of:forecast.as_of,forecast_valid_until:forecast.valid_until,source_window:forecast.source_window,lead_time_days:term.lead_time_days,available_units:balance.available,on_hand_units:balance.on_hand,reserved_units:balance.reserved,incoming_units:incoming,stock_source_identity:this.inventory.source.identity,stock_anchor_id:balance.anchor_id,uncertainty_policy:'plan_against_evaluated_upper_units',supplier_minimum_quantity:term.minimum_quantity,units_per_purchase:term.conversion.numerator},
    open_orders:summaries,proposed_by:s.actor_id,created_at:this.k.clock(),purchasing_authorized:false,external_qualified:false};
   this.k.db.prepare('INSERT INTO commerce_replenishment_drafts VALUES(?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,p.replenishment_id,p.resource_id,'draft',canonical(body),contentDigest(body));this.k.audit(scope,'replenishment_drafted','allowed');return {...body,state:'draft',digest:contentDigest(body)};
  });
 }
 read(scope:Scope,replenishmentId:string){const row=procurementRow(this.k,scope,'commerce_replenishment_drafts',replenishmentId);return {...row.body,state:row.state,digest:row.digest,purchasing_authorized:false};}
}
