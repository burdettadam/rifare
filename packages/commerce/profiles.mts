import { CommerceKernel, exact, id, integer, boundedJSON, digest } from './kernel.mts';
import type { Scope, Row } from './kernel.mts';
import { Skills } from './skills.mts';

export const PROFILE_ACTIONS = Object.freeze(['order.status','knowledge.search','knowledge.get','skill.read']);
export const PROFILE_SCHEMA = Object.freeze({
  type:'object',additionalProperties:false,
  required:['id','revision','tenant_id','store_id','skill_id','skill_digest','tone','locale','actions','data_scope'],
  properties:{id:{type:'string',pattern:'^[A-Za-z0-9_-]{1,96}$'},revision:{type:'integer',minimum:1},
    tenant_id:{type:'string'},store_id:{type:'string'},skill_id:{type:'string'},skill_digest:{type:'string',pattern:'^[a-f0-9]{64}$'},
    tone:{enum:['neutral','warm','formal']},locale:{enum:['en-US','en-GB','fr-CA']},
    actions:{type:'array',minItems:1,maxItems:4,uniqueItems:true,items:{enum:PROFILE_ACTIONS},contains:{const:'order.status'}},
    data_scope:{type:'object',additionalProperties:false,required:['order','knowledge'],properties:{order:{const:'session_or_store'},knowledge:{const:'visible_only'}}}},
});
export class Profiles {
  #kernel:CommerceKernel;#skills:Skills;
  constructor(kernel:CommerceKernel,skills:Skills){this.#kernel=kernel;this.#skills=skills;}
  put(scope:Scope,input:unknown) {
    this.#kernel.authorize(scope,'profile.write');
    const s=this.#kernel.require(scope,['operator']),r=exact(input,[...PROFILE_SCHEMA.required]);
    id(r.id);id(r.tenant_id);id(r.store_id);id(r.skill_id);integer(r.revision,1);
    if(r.tenant_id!==s.tenant_id||r.store_id!==s.store_id)throw new Error('ACCESS_DENIED');
    if(!['neutral','warm','formal'].includes(r.tone)||!['en-US','en-GB','fr-CA'].includes(r.locale))throw new Error('INVALID_PROFILE');
    if(!Array.isArray(r.actions)||r.actions.length<1||r.actions.length>4||new Set(r.actions).size!==r.actions.length
      ||!r.actions.includes('order.status')||r.actions.some((a:unknown)=>typeof a!=='string'||!PROFILE_ACTIONS.includes(a)))throw new Error('INVALID_PROFILE');
    const data=exact(r.data_scope,['order','knowledge']);
    if(data.order!=='session_or_store'||data.knowledge!=='visible_only')throw new Error('INVALID_PROFILE');
    const skill=this.#skills.describe(scope,r.skill_id);
    if(r.skill_digest!==skill.bundle_digest)throw new Error('SKILL_CHANGED');
    const encoded=boundedJSON(r);
    this.#kernel.transaction(()=>{
      const old=this.#kernel.db.prepare('SELECT revision FROM commerce_profiles WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,r.id) as Row;
      if(r.revision!==(old?.revision??0)+1)throw new Error('SOURCE_VERSION_CONFLICT');
      this.#kernel.db.prepare(`INSERT INTO commerce_profiles VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,store_id,id)
        DO UPDATE SET revision=excluded.revision,body=excluded.body`).run(s.tenant_id,s.store_id,r.id,r.revision,encoded);
    });
    return this.get(scope,r.id);
  }
  get(scope:Scope,profileId:string) {
    this.#kernel.authorize(scope,'profile.read');
    const s=this.#kernel.require(scope);id(profileId);
    const row=this.#kernel.db.prepare('SELECT * FROM commerce_profiles WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,profileId) as Row;
    if(!row)throw new Error('NOT_FOUND');
    const profile=JSON.parse(row.body);
    if(this.#skills.describe(scope,profile.skill_id).bundle_digest!==profile.skill_digest)throw new Error('PROFILE_STALE');
    return {profile,sha256:digest(row.body),authority:'restrictions_and_presentation_only'};
  }
  permit(scope:Scope,profileId:string,action:string) {
    const result=this.get(scope,profileId);
    if(!result.profile.actions.includes(action))throw new Error('PROFILE_ACTION_DENIED');
    return result;
  }
}
