import { exact,id,integer } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { money } from './money.mts';
import { permissionDecision } from './authorization.mts';
import { LocationInventory,assertInventorySource } from './location-inventory.mts';
import { ProcurementFixtureSource } from '../adapters/procurement-fixture-source.mts';
import { procurementScope,procurementSourceScope,procurementPo,procurementResourcePin,procurementRow,procurementBody,initialPurchaseOrderState,revokeUnusedProcurementApprovals,storeProcurementHeader } from './procurement-core.mts';

export class SupplierPurchaseOrders {
 readonly k:CommerceKernel;readonly source:ProcurementFixtureSource;readonly inventory:LocationInventory;
 constructor(k:CommerceKernel,source:ProcurementFixtureSource,inventory:LocationInventory){
  if(!(inventory instanceof LocationInventory)||inventory.kernel!==k)throw new Error('CANONICAL_INVENTORY_REQUIRED');assertInventorySource(k,inventory.source);
  if(!(source instanceof ProcurementFixtureSource))throw new Error('SEPARATE_PROCUREMENT_SOURCE_REQUIRED');this.k=k;this.source=source;this.inventory=inventory;
  const file=(db:CommerceKernel['db'])=>(db.prepare('PRAGMA database_list').all() as Row[]).find(row=>row.name==='main')?.file;
  if([k.db,inventory.source.db].some(db=>source.db===db||file(source.db)&&file(source.db)===file(db)))throw new Error('SEPARATE_PROCUREMENT_SOURCE_REQUIRED');
 }
 importSupplier(scope:Scope,input:unknown){const p=exact(jsonValue(input),['supplier_id','resource_id']),{s}=procurementScope(this.k,scope,p.resource_id,'action.propose');procurementSourceScope(this.k,s,this.source);
  const terms=this.source.terms(id(p.supplier_id));if(terms.expires_at<=this.k.clock()||terms.effective_at>this.k.clock())throw new Error('PROCUREMENT_TERMS_EXPIRED');
  const body={supplier_id:p.supplier_id,resource_id:p.resource_id,source_identity:this.source.identity,terms,observed_at:this.k.clock(),external_qualified:false};
  const old=this.k.db.prepare('SELECT * FROM commerce_procurement_suppliers WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,p.supplier_id) as Row|undefined;
  if(old&&old.resource_id!==p.resource_id)throw new Error('PROCUREMENT_SUPPLIER_SCOPE_CHANGED');
  this.k.db.prepare('INSERT INTO commerce_procurement_suppliers VALUES(?,?,?,?,?,?,?) ON CONFLICT(tenant_id,store_id,id) DO UPDATE SET state=excluded.state,body=excluded.body,digest=excluded.digest').run(s.tenant_id,s.store_id,p.supplier_id,p.resource_id,'observed',canonical(body),contentDigest(body));return {...body,id:p.supplier_id,digest:contentDigest(body)};
 }
 supplier(scope:Scope,input:unknown){const p=exact(jsonValue(input),['supplier_id','resource_id','expected_terms_digest']),{s}=procurementScope(this.k,scope,p.resource_id),local=procurementRow(this.k,scope,'commerce_procurement_suppliers',p.supplier_id);
  procurementSourceScope(this.k,s,this.source);if(local.resource_id!==p.resource_id||local.body.source_identity!==this.source.identity||local.state!=='observed')throw new Error('PROCUREMENT_SUPPLIER_UNAVAILABLE');
  const terms=this.source.terms(p.supplier_id);if(terms.digest!==p.expected_terms_digest||local.body.terms.digest!==terms.digest)throw new Error('PROCUREMENT_TERMS_CHANGED');
  if(terms.expires_at<=this.k.clock()||terms.effective_at>this.k.clock())throw new Error('PROCUREMENT_TERMS_EXPIRED');return terms;
 }
 #lines(terms:Row,input:unknown){if(!Array.isArray(input)||!input.length||input.length>50)throw new Error('PROCUREMENT_LINES_REQUIRED');let total=0n;const seen=new Set<string>();
  const lines=input.map(value=>{const p=exact(jsonValue(value),['line_id','variant_id','location_id','quantity','order_unit']);for(const field of ['line_id','variant_id','location_id'])id(p[field]);integer(p.quantity,1);
   if(p.quantity>1000000||seen.has(p.line_id))throw new Error('PROCUREMENT_LINE_INVALID');seen.add(p.line_id);const term=terms.lines.find((line:Row)=>line.variant_id===p.variant_id&&line.order_unit===p.order_unit);
   if(!term||p.quantity<term.minimum_quantity)throw new Error('PROCUREMENT_UNIT_OR_MINIMUM_INVALID');
   const base=p.quantity*term.conversion.numerator;if(!Number.isSafeInteger(base)||term.conversion.denominator!==1)throw new Error('PROCUREMENT_UNIT_UNSUPPORTED');
   if(base>1000000000)throw new Error('PROCUREMENT_QUANTITY_LIMIT');
   const amount=money(terms.currency_code,(BigInt(term.unit_cost_minor)*BigInt(p.quantity)).toString());total+=BigInt(amount.minor);
   return {...p,ordered_quantity:p.quantity,ordered_base_quantity:base,purchase_unit:p.order_unit,base_unit:term.base_unit,units_per_purchase:term.conversion.numerator,conversion:term.conversion,base_quantity:base,currency_code:terms.currency_code,unit_cost_minor:term.unit_cost_minor,line_total_minor:amount.minor};
  });money(terms.currency_code,total.toString());return {lines,total_minor:total.toString()};
 }
 #version(scope:Scope,input:Row,version:number,previous:Row|null){
  const {s,r}=procurementScope(this.k,scope,input.resource_id,'action.propose');assertInventorySource(this.k,this.inventory.source,s);
  const terms=this.supplier(scope,{supplier_id:input.supplier_id,resource_id:input.resource_id,expected_terms_digest:input.expected_terms_digest}),values=this.#lines(terms,input.lines);
  const drafting_authority=[...(previous?.drafting_authority??[])].filter((entry:Row)=>entry.actor_id!==s.actor_id);drafting_authority.push({actor_id:s.actor_id,authority_revision:permissionDecision(this.k.db,s,'action.propose',input.resource_id).authority_revision});
  return {schema_version:1,id:input.po_id,version,resource_id:input.resource_id,resource_digest:procurementResourcePin(r),supplier_id:input.supplier_id,supplier_source_identity:this.source.identity,
   supplier_terms_version:terms.version,supplier_terms_digest:terms.digest,supplier_terms_expires_at:terms.expires_at,warehouse_source_identity:this.inventory.source.identity,currency_code:terms.currency_code,...values,
   replenishment_id:input.replenishment_id??previous?.replenishment_id??null,proposed_by:s.actor_id,drafting_authority,created_at:this.k.clock(),external_qualified:false};
 }
 draft(scope:Scope,input:unknown){const p=exact(jsonValue(input),['po_id','resource_id','supplier_id','expected_terms_digest','lines','replenishment_id']);id(p.po_id);id(p.supplier_id);if(p.replenishment_id!==null)id(p.replenishment_id);
  return this.k.transaction(()=>{const {s}=procurementScope(this.k,scope,p.resource_id,'action.propose');
   if(this.k.db.prepare('SELECT 1 FROM commerce_purchase_orders WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,p.po_id))throw new Error('PROCUREMENT_PO_ALREADY_EXISTS');
   if(p.replenishment_id!==null){const draft=procurementRow(this.k,scope,'commerce_replenishment_drafts',p.replenishment_id);if(draft.resource_id!==p.resource_id||draft.state!=='draft'||draft.body.supplier_id!==p.supplier_id)throw new Error('PROCUREMENT_REPLENISHMENT_CHANGED');}
   const body=this.#version(scope,p,1,null),initial=initialPurchaseOrderState(),header={id:p.po_id,resource_id:p.resource_id,supplier_id:p.supplier_id,authority_revoked:false};
   this.k.db.prepare('INSERT INTO commerce_purchase_orders VALUES(?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,p.po_id,p.resource_id,1,initial.state,canonical(header),contentDigest(header));
   this.k.db.prepare('INSERT INTO commerce_purchase_order_versions VALUES(?,?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,p.po_id+'-v1',p.resource_id,p.po_id,1,'frozen',canonical(body),contentDigest(body));this.k.audit(scope,'procurement_po_drafted','allowed');
   return this.current(scope,{po_id:p.po_id,version:1,expected_digest:contentDigest(body)});
  });
 }
 revise(scope:Scope,input:unknown){const p=exact(jsonValue(input),['po_id','expected_version','expected_terms_digest','lines']);id(p.po_id);integer(p.expected_version,1);
  return this.k.transaction(()=>{const header=procurementRow(this.k,scope,'commerce_purchase_orders',p.po_id,'action.propose'),s=this.k.require(scope);if(header.current_version!==p.expected_version)throw new Error('PROCUREMENT_PO_VERSION_CHANGED');
   const old=this.k.db.prepare('SELECT * FROM commerce_purchase_order_versions WHERE tenant_id=? AND store_id=? AND po_id=? AND version=?').get(s.tenant_id,s.store_id,p.po_id,p.expected_version) as Row,previous=procurementBody(old);
   revokeUnusedProcurementApprovals(this.k,s,p.po_id,p.expected_version);const version=p.expected_version+1,body=this.#version(scope,{...p,resource_id:header.resource_id,supplier_id:header.body.supplier_id},version,previous);
   this.k.db.prepare('INSERT INTO commerce_purchase_order_versions VALUES(?,?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,p.po_id+'-v'+version,header.resource_id,p.po_id,version,'frozen',canonical(body),contentDigest(body));
   storeProcurementHeader(this.k,s,p.po_id,version,'draft',{...header.body,authority_revoked:false});this.k.audit(scope,'procurement_po_revised','allowed');return this.current(scope,{po_id:p.po_id,version,expected_digest:contentDigest(body)});
  });
 }
 current(scope:Scope,input:unknown){return procurementPo(this.k,scope,input);}
 assertSourceCurrent(scope:Scope,input:unknown){const po=this.current(scope,input),s=this.k.require(scope);procurementSourceScope(this.k,s,this.source);
  if(po.source_identity!==this.source.identity||!po.operation_id)throw new Error('PROCUREMENT_SOURCE_RECONCILIATION_REQUIRED');
  const actual=this.source.observation(po.operation_id);if(!actual||actual.po_digest!==po.digest||actual.digest!==po.source_digest)throw new Error('PROCUREMENT_SOURCE_RECONCILIATION_REQUIRED');return po;
 }
 list(scope:Scope,input:unknown){const p=exact(jsonValue(input),['resource_id']),{s}=procurementScope(this.k,scope,p.resource_id);return (this.k.db.prepare('SELECT v.po_id,v.version,v.digest FROM commerce_purchase_order_versions v JOIN commerce_purchase_orders h ON h.tenant_id=v.tenant_id AND h.store_id=v.store_id AND h.id=v.po_id AND h.current_version=v.version WHERE v.tenant_id=? AND v.store_id=? AND v.resource_id=? ORDER BY v.po_id').all(s.tenant_id,s.store_id,p.resource_id) as Row[]).map(row=>this.current(scope,{po_id:row.po_id,version:row.version,expected_digest:row.digest}));}
}
