import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {usingGift} from './gift-helpers.mts';
import {ReturnReceiving} from '../../packages/commerce/return-receiving.mts';
import {ReturnDisposition} from '../../packages/commerce/return-disposition.mts';
import {ReturnCancellation} from '../../packages/commerce/return-cancellation.mts';
import {WarehouseFixtureSource} from '../../packages/adapters/warehouse-fixture-source.mts';
import {FulfillmentFixtureSource} from '../../packages/adapters/fulfillment-fixture-source.mts';
import {FulfillmentConfiguration} from '../../packages/commerce/return-fulfillment-core.mts';
import {ReturnLabels} from '../../packages/commerce/return-labels.mts';
import {PrivacyLifecycle} from '../../packages/commerce/privacy-lifecycle.mts';
async function receivedGift(f:any){
 await f.authorizeGift();
 const request=f.intake.read(f.a.scope,'gift_case');
 const receiving=new ReturnReceiving(f.kernel);
 const open=receiving.open(f.a.scope,{request_id:request.id,location_id:'warehouse-one'});
 const scanned=receiving.scan(f.a.scope,{session_id:open.session_id,scan_id:'gift_lifecycle_scan',expected_revision:open.revision,
  items:[{line_id:'gamma',observed_variant:'shoe-small',quantity:1,grade:'sellable',evidence_ids:[]}]});
 const closed=receiving.close(f.a.scope,{session_id:open.session_id,expected_revision:scanned.revision});
 assert.equal(closed.total_actual,1);
 assert.equal(closed.expected_received,1);
 assert.equal(closed.inspection,'complete');
 return {request,receiving,closed};
}
function authorizeLife(f:any,q:any){
 const preview=f.gateway.prepare(f.a.scope,q.proposal);
 const approval=f.gateway.approve(f.reviewer.scope,{preview_id:preview.id,preview_digest:preview.digest});
 return f.gateway.execute(f.a.scope,{preview_id:preview.id,preview_digest:preview.digest,approval_id:approval.id});
}

test('M06-G05-FRESH-GIFT-RECEIVING-AND-PURCHASER-VIEW-BOUNDARY',()=>usingGift(async(f:any)=>{
 const {request,receiving,closed}=await receivedGift(f);
 assert.throws(()=>receiving.read(f.buyer,closed.session_id),/ACCESS_DENIED|NOT_FOUND/);
 assert.throws(()=>new ReturnCancellation(f.kernel).read(f.buyer,request.id),/ACCESS_DENIED|NOT_FOUND/);
 assert.throws(()=>f.kernel.authenticate(f.verified.token),/ACCESS_DENIED|SESSION|INVALID/);
}));

test('M06-G05-FRESH-GIFT-STAFF-DISPOSITION-COMPATIBILITY',()=>usingGift(async(f:any)=>{
 const {closed}=await receivedGift(f);
 const warehouseDb=new DatabaseSync(':memory:');
 try{
  const warehouse=new WarehouseFixtureSource(warehouseDb,{mode:'fixture',identity:'gift-review-warehouse',tenant:f.a.tenant,store:f.a.store});
  warehouse.seed('shoe-small','warehouse-one',0);
  const disposition=new ReturnDisposition(f.kernel,warehouse);
  disposition.configure(f.owner.scope,{expected_revision:0,enabled:true,source_identity:warehouse.identity,locations:['warehouse-one'],expires_at:f.now()+3600000});
  const q=disposition.quote(f.a.scope,{session_id:closed.session_id,unit_ids:[closed.units[0].id],disposition:'restock'});
  const receipt=authorizeLife(f,q);
  const applied=await disposition.dispatch(f.a.scope,receipt.lifecycle_operation_id);
  assert.equal(applied.state,'applied');
  assert.equal(warehouse.stock('shoe-small','warehouse-one'),1);
  assert.throws(()=>disposition.read(f.buyer,receipt.lifecycle_operation_id),/ACCESS_DENIED|NOT_FOUND/);
 }finally{warehouseDb.close();}
}));

test('M06-G05-FRESH-GIFT-STAFF-CANCELLATION-COMPATIBILITY',()=>usingGift(async(f:any)=>{
 const {request,receiving,closed}=await receivedGift(f);
 const cancellation=new ReturnCancellation(f.kernel);
 const q=cancellation.quote(f.a.scope,{request_id:request.id,reason:'customer_cancelled'});
 authorizeLife(f,q);
 assert.equal(cancellation.read(f.a.scope,request.id).state,'cancelled');
 assert.equal(receiving.read(f.a.scope,closed.session_id).total_actual,1);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM commerce_return_closures WHERE request_id=?').get(request.id).n,1);
}));

test('M06-G05-ERASURE-REDACTS-PARCEL-ADDRESSES',()=>usingGift(async f=>{await f.authorizeGift();const request=f.intake.read(f.a.scope,'gift_case'),db=new DatabaseSync(':memory:');try{const source=new FulfillmentFixtureSource(db,{mode:'fixture',identity:'gift-parcel-source',tenant:f.a.tenant,store:f.a.store,clock:f.now});new FulfillmentConfiguration(f.kernel).configure(f.owner.scope,{expected_revision:0,enabled:true,source_identity:source.identity,account_id:'gift-account',expires_at:f.now()+300000,resolution_trigger:'carrier_delivery'});const labels=new ReturnLabels(f.kernel,source);labels.configureParcel(f.owner.scope,{case_id:'gift_case',request_id:request.id,expected_revision:0,from_address_ref:'recipient-private-address',to_address_ref:'warehouse-address',address_revision:1,package:{weight_g:500,length_mm:200,width_mm:100,height_mm:100},service:'ground'});const before=f.intake.read(f.a.scope,'gift_case').preview_digest;assert.equal(new PrivacyLifecycle(f.kernel).erase(f.owner.scope,'recipient-one').status,'logically_erased');const parcel=JSON.parse(f.db.prepare('SELECT body FROM commerce_return_parcels WHERE request_id=?').get(request.id).body);assert.equal(parcel.from_address_ref,'erased');assert.equal(parcel.to_address_ref,'erased');assert.equal(f.intake.read(f.a.scope,'gift_case').preview_digest,before);}finally{db.close();}}));
