import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { Row } from '../commerce/kernel.mts';
import { exact,id,integer } from '../commerce/kernel.mts';
import { canonical,contentDigest,jsonValue } from '../commerce/configuration-values.mts';
import { growthMinor } from '../commerce/growth-marketing-core.mts';

export function marketingDefinition(input:unknown){
  const p=exact(jsonValue(input),['country','required_tag','minimum_spend_minor','required_fields']);id(p.country);id(p.required_tag);growthMinor(p.minimum_spend_minor);
  if(!Array.isArray(p.required_fields)||new Set(p.required_fields).size!==p.required_fields.length||[...p.required_fields].sort().join(',')!=='country,spend_minor,tags')throw new Error('SEGMENT_DEFINITION_UNSUPPORTED');
  return {...p,required_fields:[...p.required_fields].sort()};
}
export function marketingMatches(member:Row,definition:Row){return member.country===definition.country&&member.tags.includes(definition.required_tag)&&growthMinor(member.spend_minor)>=growthMinor(definition.minimum_spend_minor);}

/** A separate local source store; its accepted template state is not message delivery. */
export class MarketingFixtureSource {
  readonly db:DatabaseSync;readonly tenant:string;readonly store:string;readonly account:string;readonly identity:string;readonly clock:()=>number;
  readonly contract='marketing_fixture_v1';readonly evidence_kind='synthetic';
  fault:'none'|'after'|'before'='none';syncCalls=0;lookups=0;
  constructor(db:DatabaseSync,scope:{tenant:string;store:string;account:string},clock:()=>number=Date.now){
    this.db=db;this.tenant=id(scope.tenant);this.store=id(scope.store);this.account=id(scope.account);this.clock=clock;
    db.exec(`CREATE TABLE IF NOT EXISTS marketing_source_identity(id INTEGER PRIMARY KEY,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS marketing_source_facts(id INTEGER PRIMARY KEY,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS marketing_source_members(resource_id TEXT PRIMARY KEY,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS marketing_source_events(event_id TEXT PRIMARY KEY,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS marketing_source_effects(operation_id TEXT PRIMARY KEY,command_digest TEXT NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;`);
    const old=db.prepare('SELECT * FROM marketing_source_identity WHERE id=1').get() as Row;
    if(old){const b=this.#body(old);if(b.tenant!==this.tenant||b.store!==this.store||b.account!==this.account)throw new Error('MARKETING_SOURCE_SCOPE');this.identity=b.identity;}
    else{this.identity='msrc_'+randomUUID().replaceAll('-','');const b={...scope,identity:this.identity};db.prepare('INSERT INTO marketing_source_identity VALUES(1,?,?)').run(canonical(b),contentDigest(b));}
  }
  #body(row:Row|undefined){if(!row)throw new Error('MARKETING_SOURCE_MISSING');const b=JSON.parse(row.body);if(contentDigest(b)!==row.digest)throw new Error('MARKETING_SOURCE_INTEGRITY');return b;}
  configure(input:unknown){
    const p=exact(jsonValue(input),['revision','brand','headlines','bodies','offers','expires_at']);integer(p.revision,1);integer(p.expires_at);
    if(p.expires_at<=this.clock()||typeof p.brand!=='string'||p.brand.length>100)throw new Error('MARKETING_FACTS_INVALID');
    for(const collection of [p.headlines,p.bodies]){if(!collection||typeof collection!=='object'||Array.isArray(collection)||Object.keys(collection).length>20)throw new Error('MARKETING_FACTS_INVALID');for(const [key,text] of Object.entries(collection)){id(key);if(typeof text!=='string'||!text.trim()||text.length>2000||/[\u0000-\u001f]/u.test(text))throw new Error('MARKETING_FACTS_INVALID');}}
    for(const [key,value] of Object.entries(p.offers) as [string,Row][]){id(key);exact(value,['text','currency','discount_minor','catalog_ref']);if(value.currency!=='USD'||typeof value.text!=='string'||value.text.length>2000)throw new Error('MARKETING_FACTS_INVALID');growthMinor(value.discount_minor);id(value.catalog_ref);}
    const old=this.db.prepare('SELECT * FROM marketing_source_facts WHERE id=1').get() as Row;if(old&&this.#body(old).revision>=p.revision)throw new Error('MARKETING_FACTS_REVISION');
    this.db.prepare('INSERT INTO marketing_source_facts VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,digest=excluded.digest').run(canonical(p),contentDigest(p));return this.facts();
  }
  facts(){const row=this.db.prepare('SELECT * FROM marketing_source_facts WHERE id=1').get() as Row;return {...this.#body(row),source_identity:this.identity,source_digest:row.digest};}
  copy(headline:string,bodyKey:string,offerId:string|null){const facts=this.facts();if(facts.expires_at<=this.clock())throw new Error('MARKETING_FACTS_EXPIRED');
    if(!Object.hasOwn(facts.headlines,headline)||!Object.hasOwn(facts.bodies,bodyKey))throw new Error('CAMPAIGN_COPY_UNQUALIFIED');
    if(offerId!==null&&!Object.hasOwn(facts.offers,offerId))throw new Error('CAMPAIGN_OFFER_UNQUALIFIED');
    return {subject:facts.headlines[headline],text:[facts.bodies[bodyKey],...(offerId?[facts.offers[offerId].text]:[])].join('\n'),offer:offerId?facts.offers[offerId]:null,source_digest:facts.source_digest,source_identity:this.identity,expires_at:facts.expires_at,brand:facts.brand};
  }
  seedMember(input:unknown){const p=exact(jsonValue(input),['tenant_id','store_id','case_id','resource_id','customer_id','country','tags','spend_minor','available_fields']);
    for(const field of ['tenant_id','store_id','case_id','resource_id','customer_id','country'])id(p[field]);if(p.tenant_id!==this.tenant||p.store_id!==this.store)throw new Error('MARKETING_SOURCE_SCOPE');
    if(!Array.isArray(p.tags)||p.tags.length>20||!Array.isArray(p.available_fields)||p.available_fields.some((x:string)=>!['country','tags','spend_minor'].includes(x)))throw new Error('MARKETING_MEMBER_INVALID');p.tags.forEach(id);growthMinor(p.spend_minor);
    this.db.prepare('INSERT INTO marketing_source_members VALUES(?,?,?) ON CONFLICT(resource_id) DO UPDATE SET body=excluded.body,digest=excluded.digest').run(p.resource_id,canonical(p),contentDigest(p));
  }
  audience(){return (this.db.prepare('SELECT * FROM marketing_source_members ORDER BY resource_id').all() as Row[]).map(row=>this.#body(row));}
  observe(input:unknown){
    const p=exact(jsonValue(input),['event_id','resource_id','customer_id','kind','purchase_id','channel','at','amount_minor','category','through_at','complete','cost_coverage']);
    [p.event_id,p.resource_id,p.customer_id,p.channel].forEach(id);integer(p.at);growthMinor(p.amount_minor);
    if(p.at>this.clock()||!['purchase','refund','cost','coverage'].includes(p.kind)||typeof p.complete!=='boolean')throw new Error('MARKETING_EVENT_INVALID');
    if(p.kind==='coverage'){const costs=exact(p.cost_coverage,['goods','shipping','payment','marketing']);for(const value of Object.values(costs)){if(value!==null)growthMinor(value);}
      if(p.purchase_id!==null||p.category!==null||p.amount_minor!=='0')throw new Error('MARKETING_EVENT_INVALID');integer(p.through_at);if(p.through_at>this.clock())throw new Error('MARKETING_EVENT_INVALID');}
    else{id(p.purchase_id);if(p.cost_coverage!==null)throw new Error('MARKETING_EVENT_INVALID');if(p.through_at!==null||p.complete||(p.kind==='cost'?!['goods','shipping','payment','marketing'].includes(p.category):p.category!==null))throw new Error('MARKETING_EVENT_INVALID');}
    const b={...p,tenant_id:this.tenant,store_id:this.store,source_identity:this.identity,currency:'USD',observed_at:this.clock(),qualification:'synthetic_only'},old=this.db.prepare('SELECT * FROM marketing_source_events WHERE event_id=?').get(p.event_id) as Row;
    if(old){if(old.digest!==contentDigest(b))throw new Error('MARKETING_EVENT_CONFLICT');return this.#body(old);}
    this.db.prepare('INSERT INTO marketing_source_events VALUES(?,?,?)').run(p.event_id,canonical(b),contentDigest(b));return b;
  }
  event(eventId:string){const row=this.db.prepare('SELECT * FROM marketing_source_events WHERE event_id=?').get(id(eventId)) as Row;return this.#body(row);}
  sync(command:Row){
    this.syncCalls++;const c=exact(jsonValue(command),['operation_id','tenant_id','store_id','account_id','source_identity','segment_id','definition','audience_digest','audience_count','template','facts_digest']);id(c.operation_id);
    if(c.tenant_id!==this.tenant||c.store_id!==this.store||c.account_id!==this.account||c.source_identity!==this.identity)throw new Error('MARKETING_SOURCE_SCOPE');
    const definition=marketingDefinition(c.definition),hash=contentDigest(c),old=this.db.prepare('SELECT * FROM marketing_source_effects WHERE operation_id=?').get(c.operation_id) as Row;
    if(old){if(old.command_digest!==hash)throw new Error('MARKETING_SOURCE_IDEMPOTENCY');return this.#body(old);}
    if(this.fault==='before')throw new Error('MARKETING_SOURCE_UNAVAILABLE');
    const facts=this.facts(),copy=this.copy(c.template.headline_key,c.template.body_key,c.template.offer_id);
    if(c.facts_digest!==facts.source_digest||c.template.digest!==contentDigest(copy))throw new Error('MARKETING_FACTS_CHANGED');
    const members=this.audience().filter(m=>definition.required_fields.every((field:string)=>m.available_fields.includes(field))&&marketingMatches(m,definition));
    if(members.some(m=>m.tenant_id!==this.tenant||m.store_id!==this.store)||(contentDigest(members)!==c.audience_digest||members.length!==c.audience_count))throw new Error('MARKETING_AUDIENCE_CHANGED');
    const result={operation_id:c.operation_id,command_digest:hash,source_identity:this.identity,account_id:this.account,native_id:'template_'+contentDigest([this.identity,c.operation_id]).slice(0,40),stage:'template_synced',audience_count:members.length,audience_digest:c.audience_digest,template_digest:c.template.digest,observed_at:this.clock(),qualification:'synthetic_only',customer_delivered:false};
    this.db.prepare('INSERT INTO marketing_source_effects VALUES(?,?,?,?)').run(c.operation_id,hash,canonical(result),contentDigest(result));if(this.fault==='after')throw new Error('MARKETING_RESPONSE_LOST');return result;
  }
  lookup(operationId:string,commandDigest:string){this.lookups++;const row=this.db.prepare('SELECT * FROM marketing_source_effects WHERE operation_id=?').get(id(operationId)) as Row;if(!row)return null;if(row.command_digest!==commandDigest)throw new Error('MARKETING_SOURCE_IDEMPOTENCY');return this.#body(row);}
}
