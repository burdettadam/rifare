import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { fulfillmentFixture } from './fulfillment-helpers.mts';
import { installPartnerReadiness } from './partner-services-helpers.mts';
import { ClaimsFixtureSource } from '../../packages/adapters/claims-fixture-source.mts';
import { WarrantyRegistration } from '../../packages/commerce/warranty-registration.mts';
import { WarrantyClaims } from '../../packages/commerce/warranty-claims.mts';
import { ShippingClaims } from '../../packages/commerce/shipping-claims.mts';
import { DisputeEvidence } from '../../packages/commerce/dispute-evidence.mts';
import { DisputeSubmissions } from '../../packages/commerce/dispute-submissions.mts';
import { PartnerReadiness } from '../../packages/commerce/partner-readiness.mts';
import { contentDigest } from '../../packages/commerce/configuration-values.mts';
import { CLAIMS_TABLES,CLAIMS_SUBJECT_TABLES } from '../../packages/commerce/claims-core.mts';
import type { Row } from '../../packages/commerce/kernel.mts';

export const claimsOracle=JSON.parse(readFileSync(new URL('../fixtures/claims/known-answer.v1.json',import.meta.url),'utf8'));
const photo=JSON.parse(readFileSync(new URL('../fixtures/return-intake/photo.v1.json',import.meta.url),'utf8')).base64;
export async function claimsFixture(){
  const f=await fulfillmentFixture(),claimsDb=new DatabaseSync(join(f.directory,'claims-source.sqlite'));
  try {
    const source=new ClaimsFixtureSource(claimsDb,{mode:'fixture',identity:'claims-one',tenant:f.a.tenant,store:f.a.store,account_id:'claims-account',region:'US_TEST',resolution_source_identity:f.source.identity,fulfillment_source_identity:f.fulfillmentSource.identity},f.now);
    const readiness=new PartnerReadiness(f.kernel);
    for(const [service,capabilities] of [['warranty',['repair','replacement','refund']],['shipping_claims',['submit']],['dispute_submission',['submit']]] as [string,string[]][]){
      installPartnerReadiness(f.kernel,f.owner.scope,f.reviewer.scope,source.context(service,capabilities[0]),{capabilities});
    }
    const registrations=new WarrantyRegistration(f.kernel,source),warranty=new WarrantyClaims(f.kernel,source,readiness,{resolution:f.executor,fulfillment:f.execution}),shipping=new ShippingClaims(f.kernel,source,readiness),packets=new DisputeEvidence(f.kernel,source),disputes=new DisputeSubmissions(f.kernel,source,readiness,packets);
    const original=f.order();
    for(const [product_id,line_id,unit_index,paid_minor] of [['shirt','alpha',2,'1940'],['shoe','gamma',1,'1000'],['hat','beta',2,'960']] as [string,string,number,string][]){
      source.publishTerms({product_id,version:1,valid_from:f.now()-86400000*10,valid_until:f.now()+86400000*10,warranty_days:365,allowed_outcomes:['repair','replacement','refund'],maximum_claims:1,region:'US_TEST',consent_purpose:'warranty_registration'});
      source.seedPurchase({purchase_id:'purchase-'+product_id,resource_id:original.id,customer_id:original.customer_id,order_version:original.source_version,line_id,unit_index,product_id,serial_number:'SERIAL-'+product_id.toUpperCase(),purchased_at:f.now()-86400000*3,payment_id:'payment-one',currency:'USD',paid_minor,version:1});
      registrations.publish(f.owner.scope,{product_id,version:1});
    }
    const shipment=f.kernel.ingest(f.a.scope,{kind:'shipment',source_system:'synthetic',external_id:'shipment-one',source_version:1,source_updated_at:f.now(),customer_id:original.customer_id,payload:{order_resource_id:original.id,carrier:'fixture_carrier',tracking_code:'tracking-one',status:'damaged'}});
    source.seedShipment({shipment_id:'shipment-one',resource_id:original.id,customer_id:original.customer_id,shipment_resource_id:shipment.id,shipment_version:1,version:1,carrier:'fixture_carrier',coverage:'insured',eligible:true,policy_ref:'fixture-policy-one',deadline_at:f.now()+60000,amount_minor:'1940',currency:'USD'});
    source.seedDispute({dispute_id:'dispute-one',resource_id:original.id,customer_id:original.customer_id,version:1,reason:'product_not_received',amount_minor:'1940',currency:'USD',deadline_at:f.now()+60000,acknowledgement:null,purchase_consent:null,communication:null,untrusted_note:claimsOracle.hostile_note});
    const register=(product='shirt',extra:Row={})=>registrations.register(f.customer,{registration_id:'registration-'+product,resource_id:original.id,purchase_id:'purchase-'+product,terms_version:1,consent:true,...extra});
    const resolutionEffects=()=>(f.sourceDb.prepare('SELECT body FROM fixture_resolution_effects ORDER BY operation_id').all() as Row[]).map(row=>JSON.parse(row.body));
    const refundOperation=()=>{const allocation=f.plan.allocations.find(a=>a.outcome==='refund')!;return f.authorize(f.quotes.quote(f.a.scope,{allocation_id:allocation.id}));};
    const claim=(outcome='refund',extra:Row={})=>{
      const product=outcome==='replacement'?'shoe':outcome==='repair'?'hat':'shirt';
      let registration;try{registration=registrations.read(f.a.scope,'registration-'+product);}catch{registration=register(product);}
      const operation=outcome==='replacement'?f.replacement():outcome==='refund'?refundOperation():null;
      return warranty.draft(f.a.scope,f.customer,{claim_id:'warranty-'+product,registration_id:registration.id,case_id:'resolution_case',outcome,operation_id:operation?.id??null,evidence_ids:[],...extra});
    };
    const approveClaim=(value:Row)=>warranty.approve(f.reviewer.scope,{claim_id:value.id,expected_digest:value.digest,expires_at:f.now()+50000});
    const shippingDraft=(extra:Row={})=>shipping.draft(f.a.scope,f.customer,{claim_id:'shipping-one',case_id:'resolution_case',shipment_id:'shipment-one',loss_type:'damage',evidence_ids:[],...extra});
    const approveShipping=(value:Row)=>shipping.approve(f.reviewer.scope,{claim_id:value.id,expected_digest:value.digest,expires_at:f.now()+50000});
    const packet=(extra:Row={})=>packets.draft(f.a.scope,{packet_id:'packet-one',expected_revision:0,case_id:'resolution_case',dispute_id:'dispute-one',evidence_ids:[],...extra});
    const approvePacket=(value:Row)=>disputes.approve(f.reviewer.scope,{packet_id:value.id,expected_digest:value.digest,expires_at:f.now()+50000});
    const attach=async()=>{const e=f.evidence.upload(f.customer,{case_id:'resolution_case',mime:'image/png',base64:photo,note:claimsOracle.hostile_note});await f.evidence.scan(f.reviewer.scope,e.id);return e;};
    return {...f,claimsDb,claimsSource:source,readiness,registrations,warranty,shipping,packets,disputes,shipment,register,resolutionEffects,refundOperation,claim,approveClaim,shippingDraft,approveShipping,packet,approvePacket,attach,
      cleanup:()=>{claimsDb.close();f.cleanup();}};
  }catch(error){claimsDb.close();f.cleanup();throw error;}
}
export async function usingClaims(fn:(f:Awaited<ReturnType<typeof claimsFixture>>)=>unknown){const f=await claimsFixture();try{return await fn(f);}finally{f.cleanup();}}
export async function claimsMutant(relative:string,name:string,marker:string,replacement:string,fn:(Broken:any)=>unknown){
  const url=new URL(relative,import.meta.url),source=readFileSync(url,'utf8');if(source.split(marker).length!==2)throw new Error('FAULT_MARKER_NOT_UNIQUE');
  const changed=source.replace(marker,replacement).replace(/from '(\.[^']+)'/g,(_m,path)=>"from '"+new URL(path,url).href+"'");
  const directory=mkdtempSync(join(tmpdir(),'rifare-claims-fault-'));
  try{const file=join(directory,'mutant.mts');writeFileSync(file,changed);return await fn((await import(pathToFileURL(file).href))[name]);}finally{rmSync(directory,{recursive:true,force:true});}
}
export function claimsNativeCount(f:Row,kind?:string){return f.claimsDb.prepare('SELECT count(*) n FROM fixture_claim_submissions'+(kind?' WHERE kind=?':'')).get(...(kind?[kind]:[])).n;}
export function changeClaimCustomer(f:Row){const s=f.kernel.require(f.customer),proof=f.db.prepare('SELECT * FROM commerce_customer_proof_bindings WHERE token_hash=?').get(s.token_hash),current=f.db.prepare('SELECT * FROM commerce_resources WHERE id=? AND tenant_id=? AND store_id=?').get(proof.customer_resource_id,s.tenant_id,s.store_id);
  f.kernel.ingest(f.a.scope,{kind:'customer',source_system:current.source_system,external_id:current.external_id,source_version:current.source_version+1,source_updated_at:f.now(),customer_id:null,payload:{email:'changed-claims-owner@example.invalid'}});
}
/** All nine canonical claims tables through their actual services. Root integrates
 * export/erasure/restore against this existing kernel; no second commerce owner. */
export async function populateClaimsPrivacy(f:Awaited<ReturnType<typeof claimsFixture>>){
  const claim=f.claim();f.approveClaim(claim);const issue=f.source.issue.bind(f.source);f.source.issue=async(command:unknown)=>{await issue(command);throw new Error('SYNTHETIC_RESPONSE_LOST');};await f.warranty.dispatch(f.a.scope,claim.id);
  const shipping=f.shippingDraft();f.approveShipping(shipping);f.claimsSource.fault='after';await f.shipping.submit(f.a.scope,{claim_id:shipping.id,operation_id:'privacy-shipping-original'});
  const packet=f.packet();f.approvePacket(packet);f.claimsSource.fault='after';await f.disputes.submit(f.a.scope,{packet_id:packet.id,operation_id:'privacy-dispute-original'});
  return {tables:[...CLAIMS_TABLES],subject_tables:[...CLAIMS_SUBJECT_TABLES],unknown_operations:[{table:'commerce_warranty_claims',id:claim.id,operation_id:claim.operation_id,source_identity:f.source.identity,state:'unknown'},{table:'commerce_claim_submissions',id:'privacy-shipping-original',operation_id:'privacy-shipping-original',source_identity:f.claimsSource.identity,state:'unknown'},{table:'commerce_claim_submissions',id:'privacy-dispute-original',operation_id:'privacy-dispute-original',source_identity:f.claimsSource.identity,state:'unknown'}],resource_id:f.order().id,customer_id:f.order().customer_id,registration_id:claim.registration_id,warranty_claim_id:claim.id,warranty_operation_id:claim.operation_id,shipping_claim_id:shipping.id,shipping_operation_id:'privacy-shipping-original',packet_id:packet.id,dispute_operation_id:'privacy-dispute-original',source_identity:f.claimsSource.identity,source_config_digest:f.claimsSource.configuration().digest};
}
