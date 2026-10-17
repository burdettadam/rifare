import test from 'node:test';
import assert from 'node:assert/strict';
import { usingResolution as usingBase } from './resolution-helpers.mts';

const using=(fn:Parameters<typeof usingBase>[0])=>usingBase(fn,{zeroFees:true});
export function configureCatalog(f:any,patch:any={}) {
 return f.exchanges.configure(f.owner.scope,{expected_revision:0,enabled:true,catalog_wide:true,price_differences:true,
  allowed_product_ids:[],excluded_product_ids:[],excluded_categories:['final-sale'],incentive_bps:1000,
  incentive_cap_minor:'200',minimum_margin_bps:2000,expires_at:f.now()+300000,...patch});
}
export const catalogFields={product_id:'coat',category:'outerwear',active:true,fulfillment_qualified:true,
 cost_minor:'600',exchange_incentive_eligible:true,unit_price_minor:'1200'};
function quote(f:any,patch:any={}){const p=f.allocate(),c=f.catalog({...catalogFields,...patch});return {c,q:f.exchanges.quote(f.a.scope,{allocation_id:p.allocations[2].id,catalog_id:c.id})};}
function update(f:any,c:any,patch:any){return f.kernel.ingest(f.a.scope,{kind:'catalog',source_system:'synthetic',external_id:c.external_id,source_version:c.source_version+1,source_updated_at:f.now(),customer_id:null,payload:{...c.payload,...patch}});}

test('CASE-M06-G01-01',()=>using(f=>{configureCatalog(f);const {q}=quote(f);assert.equal(q.quote.allowed,true);assert.equal(q.quote.original_paid_minor,'1000');assert.equal(q.quote.exchange_incentive_minor,'120');assert.equal(q.quote.replacement_minor,'1080');assert.equal(q.quote.balance_minor,'80');assert.equal(q.quote.stock_reserved,false);}));
test('CASE-M06-G01-02',()=>using(f=>{configureCatalog(f);const {q}=quote(f,{category:'final-sale',fulfillment_qualified:false,available:0});assert.equal(q.quote.allowed,false);assert.ok(q.quote.reasons.includes('CATEGORY_EXCLUDED'));assert.ok(q.quote.reasons.includes('FULFILLMENT_UNQUALIFIED'));assert.ok(q.quote.reasons.includes('INSUFFICIENT_STOCK'));assert.deepEqual(q.quote.alternatives,['refund','store_credit']);}));
test('CASE-M06-G01-03',()=>using(f=>{configureCatalog(f);const {c,q}=quote(f);update(f,c,{unit_price_minor:'1300'});assert.throws(()=>f.exchanges.assertCurrent(f.a.scope,{quote_id:q.id,quote_digest:q.digest}),/EXCHANGE_QUOTE_CHANGED/);}));
test('M06-G01-UNKNOWN-MODEL-VARIANT-REJECTED',()=>using(f=>{configureCatalog(f);const p=f.allocate();assert.throws(()=>f.exchanges.quote(f.a.scope,{allocation_id:p.allocations[2].id,catalog_id:'invented_by_agent'}),/NOT_FOUND/);}));
test('M06-G01-MERCHANT-CONFIGURATION-REQUIRED',()=>using(f=>{const {q}=quote(f);assert.equal(q.quote.allowed,false);assert.ok(q.quote.reasons.includes('CATALOG_EXCHANGE_UNQUALIFIED'));}));
test('M06-G01-INCENTIVE-MARGIN-LIMIT',()=>using(f=>{configureCatalog(f);const {q}=quote(f,{cost_minor:'940'});assert.equal(q.quote.exchange_incentive_minor,'25');assert.equal(q.quote.replacement_minor,'1175');assert.equal(q.quote.balance_minor,'175');}));
test('M06-G01-INCENTIVE-CAP',()=>using(f=>{configureCatalog(f,{incentive_bps:5000,incentive_cap_minor:'150'});const {q}=quote(f);assert.equal(q.quote.exchange_incentive_minor,'150');assert.equal(q.quote.replacement_minor,'1050');}));
test('M06-G01-PROMOTION-EXPIRY-REQUIRES-REAPPROVAL',()=>using(f=>{configureCatalog(f);const {q}=quote(f,{promotion_expires_at:f.now()+100});f.advance(101);assert.throws(()=>f.exchanges.assertCurrent(f.a.scope,{quote_id:q.id,quote_digest:q.digest}),/EXCHANGE_QUOTE_CHANGED/);}));
test('M06-G01-CONFIGURATION-REVISION-INVALIDATES-QUOTE',()=>using(f=>{configureCatalog(f);const {q}=quote(f);configureCatalog(f,{expected_revision:1,incentive_bps:0});assert.throws(()=>f.exchanges.assertCurrent(f.a.scope,{quote_id:q.id,quote_digest:q.digest}),/EXCHANGE_QUOTE_CHANGED/);}));
test('M06-G01-CATALOG-PRODUCT-ALLOWLIST',()=>using(f=>{configureCatalog(f,{allowed_product_ids:['shoe']});const {q}=quote(f);assert.equal(q.quote.allowed,false);assert.ok(q.quote.reasons.includes('PRODUCT_NOT_PERMITTED'));}));
test('M06-G01-CATALOG-INACTIVE-VARIANT',()=>using(f=>{configureCatalog(f);const {q}=quote(f,{active:false});assert.equal(q.quote.allowed,false);assert.ok(q.quote.reasons.includes('VARIANT_INACTIVE'));}));
test('M06-G01-BROWSE-ONLY-CURRENT-PERMITTED-OFFERS',()=>using(f=>{configureCatalog(f);const p=f.allocate(),c=f.catalog(catalogFields);const result=f.exchanges.browse(f.a.scope,{allocation_id:p.allocations[2].id});assert.equal(result.offers.length,1);assert.equal(result.offers[0].catalog_id,c.id);assert.equal(result.offers[0].replacement_minor,'1080');assert.equal(result.stock_reserved,false);}));
test('M06-G01-ZERO-PRICE-RETAINS-INVENTORY-BOUNDARY',()=>using(f=>{configureCatalog(f,{incentive_bps:0});const {q}=quote(f,{unit_price_minor:'0',cost_minor:'0',available:2});assert.equal(q.quote.replacement_minor,'0');assert.equal(q.quote.allowed,false);assert.ok(q.quote.reasons.includes('INSUFFICIENT_STOCK'));}));
test('M06-G01-CROSS-TENANT-CONFIGURATION-DENIED',()=>using(f=>{assert.throws(()=>f.exchanges.configure(f.a.scope,{expected_revision:0,enabled:true,catalog_wide:true,price_differences:true,allowed_product_ids:[],excluded_product_ids:[],excluded_categories:[],incentive_bps:0,incentive_cap_minor:'0',minimum_margin_bps:0,expires_at:f.now()+1000}),/ACCESS_DENIED/);}));
test('M06-G01-LEGACY-EXPLICIT-INACTIVE-REJECTED',()=>using(f=>{const p=f.allocate(),c=f.catalog({active:false}),q=f.exchanges.quote(f.a.scope,{allocation_id:p.allocations[2].id,catalog_id:c.id});assert.equal(q.quote.allowed,false);assert.ok(q.quote.reasons.includes('VARIANT_INACTIVE'));}));
test('M06-G01-LEGACY-EXPLICIT-UNQUALIFIED-REJECTED',()=>using(f=>{const p=f.allocate(),c=f.catalog({fulfillment_qualified:false}),q=f.exchanges.quote(f.a.scope,{allocation_id:p.allocations[2].id,catalog_id:c.id});assert.equal(q.quote.allowed,false);assert.ok(q.quote.reasons.includes('FULFILLMENT_UNQUALIFIED'));}));
test('M06-G01-MISSING-CATEGORY-CANNOT-EVADE-EXCLUSIONS',()=>using(f=>{configureCatalog(f,{incentive_bps:0});const p=f.allocate(),c=f.catalog(),q=f.exchanges.quote(f.a.scope,{allocation_id:p.allocations[2].id,catalog_id:c.id});assert.equal(q.quote.allowed,false);assert.ok(q.quote.reasons.includes('CATEGORY_UNQUALIFIED'));}));
