import type { DatabaseSync } from 'node:sqlite';
import { exact,id,integer,token } from '../commerce/kernel.mts';
import type { Row } from '../commerce/kernel.mts';
import { canonical,contentDigest,jsonValue } from '../commerce/configuration-values.mts';
import { money } from '../commerce/money.mts';

export const CLAIMS_SOURCE_CONTRACT=Object.freeze({id:'rifare-claims-fixture-source',version:'claims-fixture-v1',mode:'fixture',live_transport:false,qualification:'synthetic_only',operations:['warranty.purchase.read','warranty.terms.read','shipping.coverage.read','dispute.records.read','repair.submit','shipping.submit','dispute.submit','submission.lookup']});
const resultFields=['native_id','source_version','stage','decision','recovered_minor','currency','payout_ref','effect_at','qualification'];
export function claimsSourceResult(command:Row,result:unknown){
  const value=exact(jsonValue(result),[...Object.keys(command),...resultFields]);
  for(const key of Object.keys(command))if(canonical(value[key])!==canonical(command[key]))throw new Error('CLAIM_SOURCE_RESULT_MISMATCH');
  id(value.native_id);integer(value.source_version,1);integer(value.effect_at);money(value.currency,value.recovered_minor);
  if(value.qualification!=='synthetic_only'||value.currency!==command.currency_code)throw new Error('CLAIM_SOURCE_RESULT_MISMATCH');
  const stages:Row={shipping:['submitted','approved','paid'],dispute:['submitted','accepted','decided','recovered'],repair:['submitted','accepted','completed']};
  if(!stages[command.kind]?.includes(value.stage))throw new Error('CLAIM_SOURCE_STAGE_INVALID');
  if(command.kind==='dispute'&&['decided','recovered'].includes(value.stage)){if(!['won','lost'].includes(value.decision))throw new Error('CLAIM_SOURCE_DECISION_INVALID');}
  else if(value.decision!==null)throw new Error('CLAIM_SOURCE_DECISION_INVALID');
  const reimbursed=command.kind==='shipping'&&value.stage==='paid'||command.kind==='dispute'&&value.stage==='recovered';
  if(reimbursed){if(command.kind==='dispute'&&value.decision!=='won'||BigInt(value.recovered_minor)<=0n||BigInt(value.recovered_minor)>BigInt(command.maximum_minor))throw new Error('CLAIM_RECOVERY_UNCONFIRMED');id(value.payout_ref);}
  else if(value.recovered_minor!=='0'||value.payout_ref!==null)throw new Error('CLAIM_RECOVERY_UNCONFIRMED');
  return value;
}
function verifiedRecord(row:Row|undefined,missing:string){if(!row)throw new Error(missing);const body=JSON.parse(row.body);if(contentDigest(body)!==row.digest)throw new Error('CLAIM_SOURCE_INTEGRITY');return body;}
/** Separate synthetic source records and submission ledger. It has no payment,
 * stock, delivery, network transport or processor settlement authority. */
export class ClaimsFixtureSource {
  readonly db:DatabaseSync;readonly identity:string;readonly tenant:string;readonly store:string;readonly account_id:string;readonly region:string;readonly clock:()=>number;
  fault:'none'|'before'|'after'='none';calls={submit:0,lookup:0};
  constructor(db:DatabaseSync,input:{mode:'fixture';identity:string;tenant:string;store:string;account_id:string;region:string;resolution_source_identity:string;fulfillment_source_identity:string},clock=Date.now){
    exact(input,['mode','identity','tenant','store','account_id','region','resolution_source_identity','fulfillment_source_identity']);if(input.mode!=='fixture')throw new Error('LIVE_CLAIMS_DISABLED');
    for(const key of ['identity','tenant','store','account_id','region','resolution_source_identity','fulfillment_source_identity'])id(input[key as keyof typeof input]);
    this.db=db;this.tenant=input.tenant;this.store=input.store;this.account_id=input.account_id;this.region=input.region;this.clock=clock;
    db.exec(`PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS fixture_claim_identity(id INTEGER PRIMARY KEY,body TEXT NOT NULL,digest TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS fixture_warranty_terms(id TEXT PRIMARY KEY,product_id TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,UNIQUE(product_id,version));
      CREATE TABLE IF NOT EXISTS fixture_claim_purchases(id TEXT PRIMARY KEY,body TEXT NOT NULL,digest TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS fixture_claim_shipments(id TEXT PRIMARY KEY,body TEXT NOT NULL,digest TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS fixture_claim_disputes(id TEXT PRIMARY KEY,body TEXT NOT NULL,digest TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS fixture_claim_submissions(id TEXT PRIMARY KEY,kind TEXT NOT NULL,business_key TEXT NOT NULL,command TEXT NOT NULL,digest TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(kind,business_key));`);
    const row=db.prepare('SELECT * FROM fixture_claim_identity WHERE id=1').get() as Row|undefined;
    const current=row?verifiedRecord(row,'CLAIM_SOURCE_MISSING'):null;
    if(current&&canonical(current.options)!==canonical(input))throw new Error('CLAIM_SOURCE_SCOPE');
    this.identity=current?.source_identity??'claims_source_'+token().slice(0,30);
    if(!row){const body={options:input,source_identity:this.identity,interface_version:CLAIMS_SOURCE_CONTRACT.version,revision:1};db.prepare('INSERT INTO fixture_claim_identity VALUES(1,?,?)').run(canonical(body),contentDigest(body));}
  }
  configuration(){const body=verifiedRecord(this.db.prepare('SELECT * FROM fixture_claim_identity WHERE id=1').get() as Row,'CLAIM_SOURCE_MISSING');return {body,digest:contentDigest(body)};}
  context(service:string,capability:string){id(service);id(capability);return {service,account_id:this.account_id,source_identity:this.identity,source_config_digest:this.configuration().digest,region:this.region,capability};}
  assertInterface(){if(this.configuration().body.interface_version!==CLAIMS_SOURCE_CONTRACT.version)throw new Error('CLAIM_INTERFACE_UNSUPPORTED');}
  setInterface(version:string){id(version);const {body}=this.configuration();const next={...body,revision:body.revision+1,interface_version:version};this.db.prepare('UPDATE fixture_claim_identity SET body=?,digest=? WHERE id=1').run(canonical(next),contentDigest(next));}
  #save(table:string,key:string,value:Row){const old=this.db.prepare('SELECT * FROM '+table+' WHERE id=?').get(key) as Row|undefined;if(old){const previous=verifiedRecord(old,'CLAIM_SOURCE_MISSING');if(value.version<=previous.version){if(value.version===previous.version&&contentDigest(value)===old.digest)return previous;throw new Error('CLAIM_SOURCE_VERSION_CONFLICT');}}
    this.db.prepare('INSERT INTO '+table+' VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,digest=excluded.digest').run(key,canonical(value),contentDigest(value));return value;}
  publishTerms(input:unknown){const p=exact(jsonValue(input),['product_id','version','valid_from','valid_until','warranty_days','allowed_outcomes','maximum_claims','region','consent_purpose']);id(p.product_id);id(p.region);integer(p.version,1);integer(p.valid_from);integer(p.valid_until);integer(p.warranty_days,1);integer(p.maximum_claims,1);
    if(p.valid_until<=p.valid_from||p.warranty_days>3650||p.maximum_claims!==1||p.region!==this.region||p.consent_purpose!=='warranty_registration'||!Array.isArray(p.allowed_outcomes)||!p.allowed_outcomes.length||p.allowed_outcomes.length>3||new Set(p.allowed_outcomes).size!==p.allowed_outcomes.length||p.allowed_outcomes.some((x:unknown)=>!['repair','replacement','refund'].includes(x as string)))throw new Error('WARRANTY_TERMS_UNSUPPORTED');
    const key=p.product_id+'_'+p.version,old=this.db.prepare('SELECT * FROM fixture_warranty_terms WHERE id=?').get(key) as Row|undefined;
    if(old){if(old.digest!==contentDigest(p))throw new Error('WARRANTY_TERMS_IMMUTABLE');return p;}
    const latest=this.db.prepare('SELECT max(version) v FROM fixture_warranty_terms WHERE product_id=?').get(p.product_id) as Row;
    if(latest.v!==null&&p.version!==latest.v+1)throw new Error('CLAIM_SOURCE_VERSION_CONFLICT');
    this.db.prepare('INSERT INTO fixture_warranty_terms VALUES(?,?,?,?,?)').run(key,p.product_id,p.version,canonical(p),contentDigest(p));return p;}
  terms(product:string,version:number){id(product);integer(version,1);return verifiedRecord(this.db.prepare('SELECT * FROM fixture_warranty_terms WHERE product_id=? AND version=?').get(product,version) as Row,'WARRANTY_TERMS_UNSUPPORTED');}
  latestTerms(product:string){id(product);return verifiedRecord(this.db.prepare('SELECT * FROM fixture_warranty_terms WHERE product_id=? ORDER BY version DESC LIMIT 1').get(product) as Row,'WARRANTY_TERMS_UNSUPPORTED');}
  seedPurchase(input:unknown){const p=exact(jsonValue(input),['purchase_id','resource_id','customer_id','order_version','line_id','unit_index','product_id','serial_number','purchased_at','payment_id','currency','paid_minor','version']);for(const key of ['purchase_id','resource_id','customer_id','line_id','product_id','serial_number','payment_id'])id(p[key]);for(const key of ['order_version','unit_index','version'])integer(p[key],1);integer(p.purchased_at);money(p.currency,p.paid_minor);if(p.purchased_at>this.clock()||BigInt(p.paid_minor)<=0n)throw new Error('PURCHASE_UNVERIFIED');return this.#save('fixture_claim_purchases',p.purchase_id,p);}
  purchase(ref:string){return verifiedRecord(this.db.prepare('SELECT * FROM fixture_claim_purchases WHERE id=?').get(id(ref)) as Row,'PURCHASE_UNVERIFIED');}
  seedShipment(input:unknown){const p=exact(jsonValue(input),['shipment_id','resource_id','customer_id','shipment_resource_id','shipment_version','version','carrier','coverage','eligible','policy_ref','deadline_at','amount_minor','currency']);for(const key of ['shipment_id','resource_id','customer_id','shipment_resource_id','carrier'])id(p[key]);for(const key of ['shipment_version','version'])integer(p[key],1);integer(p.deadline_at);money(p.currency,p.amount_minor);
    if(!['insured','uninsured','unknown'].includes(p.coverage)||typeof p.eligible!=='boolean'||p.policy_ref!==null&&typeof p.policy_ref!=='string'||p.policy_ref?.length>96)throw new Error('SHIPPING_FACTS_INVALID');if(p.policy_ref!==null)id(p.policy_ref);return this.#save('fixture_claim_shipments',p.shipment_id,p);}
  shipment(ref:string){return verifiedRecord(this.db.prepare('SELECT * FROM fixture_claim_shipments WHERE id=?').get(id(ref)) as Row,'SHIPPING_SOURCE_MISSING');}
  seedDispute(input:unknown){const p=exact(jsonValue(input),['dispute_id','resource_id','customer_id','version','reason','amount_minor','currency','deadline_at','acknowledgement','purchase_consent','communication','untrusted_note']);for(const key of ['dispute_id','resource_id','customer_id','reason'])id(p[key]);integer(p.version,1);integer(p.deadline_at);money(p.currency,p.amount_minor);
    for(const field of ['acknowledgement','purchase_consent','communication'])if(p[field]!==null){const r=exact(p[field],['record_id','version','resource_id','customer_id','value']);id(r.record_id);integer(r.version,1);if(r.resource_id!==p.resource_id||r.customer_id!==p.customer_id||r.value!==true)throw new Error('DISPUTE_FACTS_INVALID');}
    if(typeof p.untrusted_note!=='string'||Buffer.byteLength(p.untrusted_note)>4000)throw new Error('DISPUTE_FACTS_INVALID');return this.#save('fixture_claim_disputes',p.dispute_id,p);}
  dispute(ref:string){return verifiedRecord(this.db.prepare('SELECT * FROM fixture_claim_disputes WHERE id=?').get(id(ref)) as Row,'DISPUTE_SOURCE_MISSING');}
  proof(kind:string,ref:string){return kind==='shipping'?this.shipment(ref):kind==='dispute'?this.dispute(ref):kind==='repair'?this.purchase(ref):(()=>{throw new Error('CLAIM_SOURCE_KIND_INVALID');})();}
  async submit(input:unknown,authorize:()=>void){this.calls.submit++;const p=exact(jsonValue(input),['schema_version','operation_id','tenant_id','store_id','resource_id','customer_id','source_identity','account_id','source_config_digest','interface_version','region','kind','business_key','target_id','target_digest','evidence_hash','source_record_id','source_record_version','source_record_digest','deadline_at','maximum_minor','currency_code','payload']);
    for(const key of ['operation_id','tenant_id','store_id','resource_id','customer_id','source_identity','account_id','region','target_id','source_record_id'])id(p[key]);
    if(p.schema_version!==1||!['shipping','dispute','repair'].includes(p.kind)||p.tenant_id!==this.tenant||p.store_id!==this.store||p.source_identity!==this.identity||p.account_id!==this.account_id||p.region!==this.region)throw new Error('CLAIM_SOURCE_SCOPE');
    integer(p.deadline_at);integer(p.source_record_version,1);money(p.currency_code,p.maximum_minor);for(const key of ['business_key','target_digest','evidence_hash','source_record_digest','source_config_digest'])if(typeof p[key]!=='string'||!/^[a-f0-9]{64}$/.test(p[key]))throw new Error('CLAIM_SOURCE_COMMAND_INVALID');
    const fault=this.fault;this.fault='none';if(fault==='before')throw new Error('CLAIM_SOURCE_UNAVAILABLE');
    this.db.exec('BEGIN IMMEDIATE');let result:Row;try{
      const old=this.db.prepare('SELECT * FROM fixture_claim_submissions WHERE id=? OR (kind=? AND business_key=?)').get(p.operation_id,p.kind,p.business_key) as Row|undefined;
      if(old){if(old.id!==p.operation_id||old.digest!==contentDigest(p))throw new Error('ORIGINAL_SUBMISSION_REQUIRED');result=claimsSourceResult(p,JSON.parse(old.body));}
      else{
        this.assertInterface();if(p.interface_version!==CLAIMS_SOURCE_CONTRACT.version||p.source_config_digest!==this.configuration().digest)throw new Error('CLAIM_SOURCE_CONFIGURATION_CHANGED');
        const proof=this.proof(p.kind,p.source_record_id);
        if(proof.resource_id!==p.resource_id||proof.customer_id!==p.customer_id||proof.version!==p.source_record_version||contentDigest(proof)!==p.source_record_digest)throw new Error('EVIDENCE_SOURCE_CHANGED');
        if(p.kind!=='repair'&&p.deadline_at!==proof.deadline_at||p.deadline_at<=this.clock())throw new Error('CLAIM_DEADLINE_ELAPSED');
        if(p.kind==='shipping'&&(proof.coverage!=='insured'||!proof.eligible||proof.policy_ref===null))throw new Error('SHIPPING_COVERAGE_UNCONFIRMED');
        if(typeof authorize!=='function')throw new Error('CLAIM_APPROVAL_REQUIRED');authorize();
        result={...p,native_id:'native_claim_'+contentDigest(p).slice(0,32),source_version:1,stage:'submitted',decision:null,recovered_minor:'0',currency:p.currency_code,payout_ref:null,effect_at:this.clock(),qualification:'synthetic_only'};
        this.db.prepare('INSERT INTO fixture_claim_submissions VALUES(?,?,?,?,?,?)').run(p.operation_id,p.kind,p.business_key,canonical(p),contentDigest(p),canonical(result));
      }
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
    if(fault==='after')throw new Error('CLAIM_RESPONSE_LOST');return result;
  }
  async lookup(operationId:string){this.calls.lookup++;const row=this.db.prepare('SELECT * FROM fixture_claim_submissions WHERE id=?').get(id(operationId)) as Row|undefined;if(!row)return null;const command=JSON.parse(row.command);if(contentDigest(command)!==row.digest)throw new Error('CLAIM_SOURCE_INTEGRITY');return claimsSourceResult(command,JSON.parse(row.body));}
  /** Test-source administration records a later observation; HTTP success never
   * calls this or establishes any real payout, win, delivery, or repair. */
  advance(operationId:string,input:unknown){const p=exact(jsonValue(input),['stage','decision','recovered_minor','payout_ref']),row=this.db.prepare('SELECT * FROM fixture_claim_submissions WHERE id=?').get(id(operationId)) as Row|undefined;if(!row)throw new Error('CLAIM_SOURCE_MISSING');const command=JSON.parse(row.command),old=claimsSourceResult(command,JSON.parse(row.body));
    const allowed:Row={shipping:{submitted:['approved'],approved:['paid'],paid:[]},dispute:{submitted:['accepted'],accepted:['decided'],decided:['recovered'],recovered:[]},repair:{submitted:['accepted'],accepted:['completed'],completed:[]}};
    if(p.stage===old.stage){if(['stage','decision','recovered_minor','payout_ref'].every(key=>p[key]===old[key]))return old;throw new Error('CLAIM_SOURCE_VERSION_CONFLICT');}
    if(!allowed[command.kind][old.stage]?.includes(p.stage)||old.decision==='lost'&&p.stage==='recovered')throw new Error('CLAIM_SOURCE_STAGE_REGRESSION');
    const next=claimsSourceResult(command,{...old,...p,source_version:old.source_version+1,effect_at:this.clock()});this.db.prepare('UPDATE fixture_claim_submissions SET body=? WHERE id=?').run(canonical(next),operationId);return next;
  }
}
