import { randomUUID } from 'node:crypto';
import { exact, id, integer } from '../commerce/kernel.mts';
import type { Row } from '../commerce/kernel.mts';
import { canonical, contentDigest, jsonValue } from '../commerce/configuration-values.mts';
import { money } from '../commerce/money.mts';

/** Server-local synthetic records only. No network, credentials, charge or label API. */
export class CarrierQuoteFixtureSource {
  #tenant:string; #store:string; #identity:string;
  #accounts=new Map<string,Row>(); #packages=new Map<string,Row>(); #rates=new Map<string,Row>();
  #clock:()=>number;
  constructor(scope:{tenant_id:string;store_id:string},clock:()=>number=Date.now) {
    const s=exact(jsonValue(scope),['tenant_id','store_id']);
    this.#tenant=id(s.tenant_id);this.#store=id(s.store_id);
    this.#identity='carrier_fixture_'+randomUUID().replaceAll('-','');this.#clock=clock;
  }
  get tenant_id(){return this.#tenant;}
  get store_id(){return this.#store;}
  get identity(){return this.#identity;}
  get qualification(){return 'synthetic_only' as const;}
  get contract(){return 'rifare-carrier-quote-fixture-v1' as const;}
  setAccount(input:unknown) {
    const p=exact(jsonValue(input),['account_id','carrier_id','revision','enabled','currencies','services']);
    id(p.account_id);id(p.carrier_id);integer(p.revision,1);
    if(typeof p.enabled!=='boolean')throw new Error('INVALID_INPUT');
    for(const field of ['currencies','services']){
      const values=p[field];if(!Array.isArray(values)||!values.length||values.length>32||new Set(values).size!==values.length)throw new Error('INVALID_INPUT');
      for(const value of values)field==='currencies'?money(value,'0'):id(value);
      p[field]=[...values].sort();
    }
    const old=this.#accounts.get(p.account_id);if(old&&p.revision<=old.revision)throw new Error('SOURCE_VERSION_CONFLICT');
    if(!old&&this.#accounts.size>=32)throw new Error('FIXTURE_CAPACITY');
    this.#accounts.set(p.account_id,jsonValue(p));
  }
  setPackage(input:unknown) {
    const p=exact(jsonValue(input),['package_id','resource_id','revision','address_revision','from_address_ref','to_address_ref','from_country','to_country','weight_g','length_mm','width_mm','height_mm']);
    for(const name of ['package_id','resource_id','from_address_ref','to_address_ref'])id(p[name]);
    integer(p.revision,1);integer(p.address_revision,1);
    for(const name of ['from_country','to_country'])if(typeof p[name]!=='string'||!/^[A-Z]{2}$/.test(p[name]))throw new Error('INVALID_INPUT');
    for(const name of ['weight_g','length_mm','width_mm','height_mm']){integer(p[name],1);if(p[name]>100000)throw new Error('PACKAGE_UNSUPPORTED');}
    const old=this.#packages.get(p.package_id);
    if(old){
      if(p.revision<=old.revision||p.address_revision<old.address_revision||p.resource_id!==old.resource_id)throw new Error('SOURCE_VERSION_CONFLICT');
      const address=['from_address_ref','to_address_ref','from_country','to_country'];
      if(address.some(name=>old[name]!==p[name])&&p.address_revision<=old.address_revision)throw new Error('SOURCE_VERSION_CONFLICT');
    }
    if(!old&&this.#packages.size>=512)throw new Error('FIXTURE_CAPACITY');
    this.#packages.set(p.package_id,jsonValue(p));
  }
  setRate(input:unknown) {
    const p=exact(jsonValue(input),['package_id','account_id','service','rate_id','revision','amount_minor','currency','expires_at']);
    for(const name of ['package_id','account_id','service','rate_id'])id(p[name]);
    integer(p.revision,1);integer(p.expires_at);money(p.currency,p.amount_minor);
    const parcel=this.#packages.get(p.package_id),account=this.#accounts.get(p.account_id);
    if(!parcel||!account)throw new Error('FIXTURE_REFERENCE_MISSING');
    if(!account.services.includes(p.service)||!account.currencies.includes(p.currency))throw new Error('FIXTURE_ACCOUNT_UNSUPPORTED');
    const key=canonical([p.package_id,p.account_id,p.service]),old=this.#rates.get(key);
    if(old&&p.revision<=old.revision)throw new Error('SOURCE_VERSION_CONFLICT');
    for(const [otherKey,other] of this.#rates)if(otherKey!==key&&other.rate_id===p.rate_id)throw new Error('RATE_ID_CONFLICT');
    if(!old&&this.#rates.size>=2048)throw new Error('FIXTURE_CAPACITY');
    const value={...p,source_identity:this.identity,tenant_id:this.tenant_id,store_id:this.store_id,carrier_id:account.carrier_id,
      account_revision:account.revision,account_digest:contentDigest(account),package_revision:parcel.revision,address_revision:parcel.address_revision,
      parcel_digest:contentDigest(parcel),observed_at:integer(this.#clock())};
    this.#rates.set(key,{...value,rate_digest:contentDigest(value)});
  }
  account(accountId:string):Row|null {const row=this.#accounts.get(id(accountId));return row?jsonValue(row):null;}
  package(packageId:string):Row|null {const row=this.#packages.get(id(packageId));return row?jsonValue(row):null;}
  rate(packageId:string,accountId:string,service:string):Row|null {
    const row=this.#rates.get(canonical([id(packageId),id(accountId),id(service)]));return row?jsonValue(row):null;
  }
}
