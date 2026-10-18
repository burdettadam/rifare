import { exact,id,integer } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { subjectHash } from './data-guards.mts';
import { unitComponents } from './resolution-ledger.mts';
import { ClaimsFixtureSource } from '../adapters/claims-fixture-source.mts';
import { claimsBody,claimsRow,claimsSourceScope,claimsCustomer,CLAIMS_QUALIFICATION } from './claims-core.mts';

export class WarrantyRegistration {
  readonly k:CommerceKernel;readonly source:ClaimsFixtureSource;
  constructor(k:CommerceKernel,source:ClaimsFixtureSource){this.k=k;this.source=source;}
  publish(scope:Scope,input:unknown){const p=exact(jsonValue(input),['product_id','version']);id(p.product_id);integer(p.version,1);
    return this.k.transaction(()=>{const s=this.k.authorize(scope,'action.configure');claimsSourceScope(this.k,s,this.source);this.source.assertInterface();const terms=this.source.terms(p.product_id,p.version);
      const body={terms,source_identity:this.source.identity,source_config_digest:this.source.configuration().digest,source_digest:contentDigest(terms),published_by:s.actor_id},ref='warranty_terms_'+contentDigest([this.source.identity,p.product_id,p.version]).slice(0,32);
      const old=this.k.db.prepare('SELECT * FROM commerce_warranty_terms WHERE tenant_id=? AND store_id=? AND product_id=? AND version=?').get(s.tenant_id,s.store_id,p.product_id,p.version) as Row|undefined;
      if(old){if(contentDigest(claimsBody(old).terms)!==contentDigest(terms)||claimsBody(old).source_identity!==this.source.identity)throw new Error('WARRANTY_TERMS_IMMUTABLE');return {id:old.id,version:p.version,digest:old.digest};}
      this.k.db.prepare('INSERT INTO commerce_warranty_terms VALUES(?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,ref,p.product_id,p.version,canonical(body),contentDigest(body));return {id:ref,version:p.version,digest:contentDigest(body)};
    });
  }
  purchase(scope:Scope,resourceId:string,ref:string){const k=this.k,s=k.authorize(scope,'resource.read',id(resourceId));claimsSourceScope(k,s,this.source);this.source.assertInterface();const order=k.get(scope,resourceId),purchase=this.source.purchase(id(ref));
    if(order.kind!=='order'||purchase.resource_id!==order.id||purchase.customer_id!==order.customer_id||purchase.order_version!==order.source_version)throw new Error('PURCHASE_UNVERIFIED');
    const facts=order.payload.resolution_facts,line=facts?.paid_lines?.find((row:Row)=>row.id===purchase.line_id);
    if(!facts||!line||facts.currency!==purchase.currency||facts.payment_id!==purchase.payment_id||line.product_id!==purchase.product_id||purchase.unit_index>line.quantity||line.resolved_units?.includes(purchase.unit_index)||unitComponents(facts,line,[purchase.unit_index]).paid_minor!==purchase.paid_minor)throw new Error('PURCHASE_UNVERIFIED');
    return {s,order,purchase};
  }
  register(scope:Scope,input:unknown){const p=exact(jsonValue(input),['registration_id','resource_id','purchase_id','terms_version','consent']);id(p.registration_id);id(p.resource_id);id(p.purchase_id);integer(p.terms_version,1);if(p.consent!==true)throw new Error('REGISTRATION_CONSENT_REQUIRED');
    return this.k.transaction(()=>{const {s,order,purchase}=this.purchase(scope,p.resource_id,p.purchase_id);claimsCustomer(this.k,scope,order.id,order.customer_id);this.k.authorize(scope,'return.request',order.id);
      const row=this.k.db.prepare('SELECT * FROM commerce_warranty_terms WHERE tenant_id=? AND store_id=? AND product_id=? AND version=?').get(s.tenant_id,s.store_id,purchase.product_id,p.terms_version) as Row|undefined;
      if(!row)throw new Error('WARRANTY_TERMS_UNSUPPORTED');const termsBody=claimsBody(row),terms=termsBody.terms;
      if(termsBody.source_identity!==this.source.identity||contentDigest(this.source.terms(purchase.product_id,p.terms_version))!==contentDigest(terms)||terms.region!==this.source.region||purchase.purchased_at<terms.valid_from||purchase.purchased_at>=terms.valid_until||terms.maximum_claims!==1||terms.consent_purpose!=='warranty_registration')throw new Error('WARRANTY_TERMS_UNSUPPORTED');
      const expires_at=purchase.purchased_at+terms.warranty_days*86400000;if(expires_at<=this.k.clock())throw new Error('WARRANTY_EXPIRED');
      const serial_hash=contentDigest([this.source.identity,purchase.serial_number]),old=this.k.db.prepare('SELECT * FROM commerce_warranty_registrations WHERE tenant_id=? AND store_id=? AND (id=? OR serial_hash=?)').get(s.tenant_id,s.store_id,p.registration_id,serial_hash) as Row|undefined;
      if(old){if(old.id===p.registration_id&&old.resource_id===order.id&&claimsBody(old).purchase_id===p.purchase_id&&claimsBody(old).terms.version===p.terms_version)return this.read(scope,old.id);throw new Error('SERIAL_ALREADY_REGISTERED');}
      const purchase_key=contentDigest([order.id,purchase.product_id,purchase.line_id,purchase.unit_index]);
      if(this.k.db.prepare('SELECT 1 FROM commerce_warranty_registrations WHERE tenant_id=? AND store_id=? AND purchase_key=?').get(s.tenant_id,s.store_id,purchase_key))throw new Error('WARRANTY_UNIT_ALREADY_REGISTERED');
      const {serial_number,...proof}=purchase,body={registration_id:p.registration_id,purchase_id:p.purchase_id,product_id:purchase.product_id,line_id:purchase.line_id,unit_index:purchase.unit_index,terms,terms_id:row.id,terms_digest:contentDigest(terms),proof:{...proof,source_identity:this.source.identity,source_digest:contentDigest(purchase),serial_hash},source_identity:this.source.identity,source_config_digest:this.source.configuration().digest,registration_consent:true,consent_purpose:'warranty_registration',registered_at:this.k.clock(),expires_at};
      this.k.db.prepare('INSERT INTO commerce_warranty_registrations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,p.registration_id,order.id,order.customer_id,subjectHash(s.tenant_id,s.store_id,order.customer_id),'registered',serial_hash,purchase_key,canonical(body),contentDigest(body));return this.read(scope,p.registration_id);
    });
  }
  read(scope:Scope,registrationId:string){const row=claimsRow(this.k,scope,'commerce_warranty_registrations',registrationId),body=row.body;
    const terms = body.terms;
    return {id:row.id,resource_id:row.resource_id,customer_id:row.customer_id,state:row.state,digest:row.digest,product_id:body.product_id,line_id:body.line_id,unit_index:body.unit_index,terms,terms_id:body.terms_id,proof:body.proof,registration_consent:body.registration_consent,expires_at:body.expires_at,qualification:CLAIMS_QUALIFICATION,external_qualified:false};
  }
  current(scope:Scope,registrationId:string){const row=claimsRow(this.k,scope,'commerce_warranty_registrations',registrationId),body=row.body;claimsSourceScope(this.k,this.k.require(scope),this.source);
    if(row.state!=='registered'||body.registration_consent!==true||body.expires_at<=this.k.clock())throw new Error('WARRANTY_UNAVAILABLE');
    if(body.source_identity!==this.source.identity||contentDigest(body.terms)!==body.terms_digest||body.terms.maximum_claims!==1||body.terms.region!==this.source.region)throw new Error('WARRANTY_TERMS_UNSUPPORTED');
    const {purchase}=this.purchase(scope,row.resource_id,body.purchase_id);
    if(contentDigest(purchase)!==body.proof.source_digest||purchase.customer_id!==row.customer_id||contentDigest([this.source.identity,purchase.serial_number])!==row.serial_hash)throw new Error('PURCHASE_UNVERIFIED');return row;
  }
}
