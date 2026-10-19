import {CommerceKernel,exact,id,integer} from './kernel.mts';
import type {Scope,Row} from './kernel.mts';
import {canonical,contentDigest,jsonValue} from './configuration-values.mts';
import {AgencyAccess,agencyOwner} from './agency-access.mts';
import {permissionDecision} from './authorization.mts';
import {Profiles,PROFILE_ACTIONS,PROFILE_SCHEMA} from './profiles.mts';
import {Skills} from './skills.mts';
export function templateHash(value:unknown){if(typeof value!=='string'||! /^[a-f0-9]{64}$/.test(value))throw new Error('TEMPLATE_INPUT_INVALID');return value;}
export function presentation(value:unknown){const p=exact(jsonValue(value),['tone','locale']);if(!['neutral','warm','formal'].includes(p.tone)||!['en-US','en-GB','fr-CA'].includes(p.locale))throw new Error('TEMPLATE_PRESENTATION_INVALID');return p;}
export function templateManifest(value:unknown){const p=exact(jsonValue(value),['schema_version','agency_id','template_id','version','values','published_at']);if(p.schema_version!==1)throw new Error('TEMPLATE_INPUT_INVALID');id(p.agency_id);id(p.template_id);integer(p.version,1);integer(p.published_at);presentation(p.values);return p;}
export function templatePublication(value:unknown){const p=exact(jsonValue(value),['tenant_id','store_id','template_id','version','digest']);id(p.tenant_id);id(p.store_id);id(p.template_id);integer(p.version,1);templateHash(p.digest);return p;}
export function agencyProfile(value:unknown){
 const p=exact(jsonValue(value),[...PROFILE_SCHEMA.required]);for(const field of ['id','tenant_id','store_id','skill_id'])id(p[field]);integer(p.revision,1);templateHash(p.skill_digest);presentation({tone:p.tone,locale:p.locale});
 if(!Array.isArray(p.actions)||p.actions.length<1||p.actions.length>4||new Set(p.actions).size!==p.actions.length||!p.actions.includes('order.status')||p.actions.some((a:unknown)=>!PROFILE_ACTIONS.includes(a as string)))throw new Error('TEMPLATE_PROFILE_INVALID');
 const d=exact(p.data_scope,['order','knowledge']);if(d.order!=='session_or_store'||d.knowledge!=='visible_only')throw new Error('TEMPLATE_PROFILE_INVALID');return p;
}
function checked(row:Row){const b=JSON.parse(row.body);if(contentDigest(b)!==row.digest)throw new Error('TEMPLATE_RECORD_INTEGRITY');return b;}
export class SharedTemplates {
 readonly k:CommerceKernel;readonly access:AgencyAccess;readonly profiles:Profiles;
 constructor(k:CommerceKernel){this.k=k;this.access=new AgencyAccess(k);this.profiles=new Profiles(k,new Skills(k));}
 #source(input:unknown,agencyId:string){const p=templatePublication(input),row=this.k.db.prepare('SELECT * FROM commerce_shared_templates WHERE tenant_id=? AND store_id=? AND id=? AND version=?').get(p.tenant_id,p.store_id,p.template_id,p.version) as Row;
  if(!row||row.state!=='published'||row.digest!==p.digest)throw new Error('TEMPLATE_SOURCE_CHANGED');const m=templateManifest(checked(row));if(m.agency_id!==agencyId||m.template_id!==row.id||m.version!==row.version)throw new Error('TEMPLATE_SOURCE_CHANGED');return {publication:p,manifest:m};}
 publish(scope:Scope,input:unknown){const p=exact(jsonValue(input),['template_id','expected_version','values']);id(p.template_id);integer(p.expected_version);const values=presentation(p.values);
  return this.k.transaction(()=>{const {s,grant}=this.access.current(scope,undefined,'profile.write'),old=this.k.db.prepare('SELECT max(version) version FROM commerce_shared_templates WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,p.template_id) as Row;
   if((old.version??0)!==p.expected_version)throw new Error('TEMPLATE_CHANGED');const version=p.expected_version+1,manifest={schema_version:1,agency_id:grant.agency_id,template_id:p.template_id,version,values,published_at:this.k.clock()},hash=contentDigest(manifest);
   this.k.db.prepare("INSERT INTO commerce_shared_templates VALUES(?,?,?,?,'published',?,?)").run(s.tenant_id,s.store_id,p.template_id,version,canonical(manifest),hash);
   return {publication:{tenant_id:s.tenant_id,store_id:s.store_id,template_id:p.template_id,version,digest:hash},manifest,state:'published',stores_activated:0,execution_authorized:false};
  });
 }
 #offer(s:Row,offerId:string){id(offerId);const row=this.k.db.prepare('SELECT * FROM commerce_template_offers WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,offerId) as Row;if(!row)throw new Error('NOT_FOUND');const b=exact(checked(row),['agency_id','proposer','proposer_permission_revision','publication','manifest','profile_id','before_profile','before_profile_digest','created_at','authority_revoked']);
  id(b.agency_id);id(b.proposer);id(b.profile_id);integer(b.proposer_permission_revision,1);integer(b.created_at);templatePublication(b.publication);templateManifest(b.manifest);agencyProfile(b.before_profile);templateHash(b.before_profile_digest);
  if(typeof b.authority_revoked!=='boolean'||b.before_profile.tenant_id!==s.tenant_id||b.before_profile.store_id!==s.store_id||b.before_profile.id!==b.profile_id||b.manifest.agency_id!==b.agency_id||b.manifest.template_id!==b.publication.template_id||b.manifest.version!==b.publication.version||contentDigest(b.manifest)!==b.publication.digest)throw new Error('TEMPLATE_RECORD_INTEGRITY');return {row,body:b};
 }
 get(scope:Scope,offerId:string){const s=this.k.authorize(scope,'profile.read'),{row,body}=this.#offer(s,offerId),decision=this.k.db.prepare('SELECT * FROM commerce_template_decisions WHERE tenant_id=? AND store_id=? AND id=? ORDER BY version DESC LIMIT 1').get(s.tenant_id,s.store_id,offerId) as Row;
  return {offer_id:row.id,digest:row.digest,state:row.state,body,decision:decision?{state:decision.state,version:decision.version,body:checked(decision)}:null,execution_authorized:false};}
 offer(scope:Scope,input:unknown){const p=exact(jsonValue(input),['offer_id','publication','profile_id','expected_profile_revision']);id(p.offer_id);id(p.profile_id);integer(p.expected_profile_revision,1);
  return this.k.transaction(()=>{const {s,grant}=this.access.current(scope,undefined,'profile.write'),source=this.#source(p.publication,grant.agency_id),before=this.profiles.get(scope,p.profile_id);
   if(before.profile.revision!==p.expected_profile_revision)throw new Error('TEMPLATE_PROFILE_CHANGED');agencyProfile(before.profile);
   if(this.k.db.prepare('SELECT 1 FROM commerce_template_offers WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,p.offer_id))throw new Error('TEMPLATE_EXISTS');
   const body={agency_id:grant.agency_id,proposer:s.actor_id,proposer_permission_revision:grant.permission_revision,...source,profile_id:p.profile_id,before_profile:before.profile,before_profile_digest:before.sha256,created_at:this.k.clock(),authority_revoked:false};
   this.k.db.prepare("INSERT INTO commerce_template_offers VALUES(?,?,?,1,'pending',?,?)").run(s.tenant_id,s.store_id,p.offer_id,canonical(body),contentDigest(body));return this.get(scope,p.offer_id);
  });
 }
 #decision(s:Row,offerId:string,version:number,state:string,body:Row){this.k.db.prepare('INSERT INTO commerce_template_decisions VALUES(?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,offerId,version,state,canonical(body),contentDigest(body));this.k.db.prepare('UPDATE commerce_template_offers SET state=? WHERE tenant_id=? AND store_id=? AND id=?').run(state,s.tenant_id,s.store_id,offerId);}
 #owner(scope:Scope){const s=agencyOwner(this.k,scope);this.k.authorize(scope,'profile.write');return s;}
 accept(scope:Scope,input:unknown){this.#owner(scope);const p=exact(jsonValue(input),['offer_id','expected_digest','expected_profile_revision']);id(p.offer_id);templateHash(p.expected_digest);integer(p.expected_profile_revision,1);
  return this.k.transaction(()=>{const s=this.#owner(scope),{row,body:b}=this.#offer(s,p.offer_id);if(row.digest!==p.expected_digest)throw new Error('TEMPLATE_CHANGED');if(row.state!=='pending'||b.authority_revoked)throw new Error('TEMPLATE_TRANSITION');
   this.access.assertMember(scope,b.proposer,b.agency_id,b.proposer_permission_revision,'profile.write');this.#source(b.publication,b.agency_id);
   const current=this.profiles.get(scope,b.profile_id);if(current.profile.revision!==p.expected_profile_revision||current.profile.revision!==b.before_profile.revision||current.sha256!==b.before_profile_digest)throw new Error('TEMPLATE_PROFILE_CHANGED');
   const after=this.profiles.put(scope,{...current.profile,revision:current.profile.revision+1,...b.manifest.values});
   this.#decision(s,row.id,1,'accepted',{agency_id:b.agency_id,offer_digest:row.digest,actor_id:s.actor_id,owner_permission_revision:permissionDecision(this.k.db,s,'authority.manage').authority_revision,at:this.k.clock(),before_profile:current.profile,before_profile_digest:current.sha256,after_profile:after.profile,after_profile_digest:after.sha256,authority_revoked:false});
   return this.get(scope,row.id);
  });
 }
 reject(scope:Scope,input:unknown){this.#owner(scope);const p=exact(jsonValue(input),['offer_id','expected_digest']);id(p.offer_id);templateHash(p.expected_digest);
  return this.k.transaction(()=>{const s=this.#owner(scope),{row,body:b}=this.#offer(s,p.offer_id);if(row.digest!==p.expected_digest)throw new Error('TEMPLATE_CHANGED');if(row.state!=='pending'||b.authority_revoked)throw new Error('TEMPLATE_TRANSITION');
   this.#decision(s,row.id,1,'rejected',{agency_id:b.agency_id,offer_digest:row.digest,actor_id:s.actor_id,owner_permission_revision:permissionDecision(this.k.db,s,'authority.manage').authority_revision,at:this.k.clock(),before_profile:b.before_profile,before_profile_digest:b.before_profile_digest,after_profile:null,after_profile_digest:null,authority_revoked:false});return this.get(scope,row.id);
  });
 }
 rollback(scope:Scope,input:unknown){this.#owner(scope);const p=exact(jsonValue(input),['offer_id','expected_digest','expected_profile_revision']);id(p.offer_id);templateHash(p.expected_digest);integer(p.expected_profile_revision,1);
  return this.k.transaction(()=>{const s=this.#owner(scope),{row,body:b}=this.#offer(s,p.offer_id);if(row.digest!==p.expected_digest)throw new Error('TEMPLATE_CHANGED');if(row.state!=='accepted'||b.authority_revoked)throw new Error('TEMPLATE_TRANSITION');
   const d=this.k.db.prepare("SELECT * FROM commerce_template_decisions WHERE tenant_id=? AND store_id=? AND id=? AND version=1 AND state='accepted'").get(s.tenant_id,s.store_id,row.id) as Row;if(!d)throw new Error('TEMPLATE_TRANSITION');const decision=checked(d);
   if(decision.authority_revoked||decision.offer_digest!==row.digest)throw new Error('TEMPLATE_TRANSITION');agencyProfile(decision.after_profile);templateHash(decision.after_profile_digest);
   const current=this.profiles.get(scope,b.profile_id);if(current.profile.revision!==p.expected_profile_revision||current.profile.revision!==decision.after_profile.revision||current.sha256!==decision.after_profile_digest)throw new Error('TEMPLATE_PROFILE_CHANGED');
   const after=this.profiles.put(scope,{...current.profile,revision:current.profile.revision+1,tone:b.before_profile.tone,locale:b.before_profile.locale});
   this.#decision(s,row.id,2,'rolled_back',{agency_id:b.agency_id,offer_digest:row.digest,actor_id:s.actor_id,owner_permission_revision:permissionDecision(this.k.db,s,'authority.manage').authority_revision,at:this.k.clock(),before_profile:current.profile,before_profile_digest:current.sha256,after_profile:after.profile,after_profile_digest:after.sha256,authority_revoked:false});return this.get(scope,row.id);
  });
 }
}
