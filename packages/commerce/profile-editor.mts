import { CommerceKernel,exact,id,integer } from './kernel.mts';
import type { Scope,Row } from './kernel.mts';
import { Capabilities } from './capabilities.mts';
import { compileLayers,baseLayer,EDIT_FIELDS,rulesFromValues } from './profile-layers.mts';
import { canonical,contentDigest,jsonValue,returnDecision,invalid } from './configuration-values.mts';

function scenarioResults(effective:Row){
  const rules=rulesFromValues(effective),facts={delivered_at:0,requested_at:rules.window_days*86400000,tags:[],evidence_provided:true,outcome:rules.outcomes[0]};
  const cases=[{id:'at_window',facts},{id:'after_window',facts:{...facts,requested_at:facts.requested_at+1}},{id:'missing_evidence',facts:{...facts,evidence_provided:false}},{id:'excluded_product',facts:{...facts,tags:rules.excluded_tags}}];
  return cases.map(c=>({id:c.id,facts:c.facts,...returnDecision(rules,c.facts)}));
}
export class ProfileEditor {
  #k:CommerceKernel;#caps:Capabilities;
  constructor(kernel:CommerceKernel,caps:Capabilities){this.#k=kernel;this.#caps=caps;}
  #row(s:Row,profileId:string){id(profileId);const r=this.#k.db.prepare('SELECT * FROM commerce_configuration_drafts WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,profileId) as Row;
    if(!r)throw new Error('NOT_FOUND');return r;}
  #compile(scope:Scope,s:Row,layers:unknown){
    const connection=this.#k.db.prepare('SELECT adapter,revision FROM commerce_connections WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row;
    return {...compileLayers(layers,{tenant_id:s.tenant_id,store_id:s.store_id,platform:connection?.adapter??'none',capabilities:this.#caps.list(scope).filter(c=>c.available).map(c=>c.action)}),connection_revision:connection?.revision??0};
  }
  start(scope:Scope,profileId:string){
    const k=this.#k,s=k.authorize(scope,'profile.write');id(profileId);
    const layer={id:'merchant',kind:'merchant',revision:1,tenant_id:s.tenant_id,store_id:s.store_id,values:{},
      source:{uri:'https://rifare.invalid/profiles/draft',revision:'1',sha256:contentDigest({})}};
    const layers=[baseLayer(),layer];this.#compile(scope,s,layers);
    const history=[{revision:1,values:{},actor:s.actor_id}];
    return k.transaction(()=>{
      if(k.db.prepare('SELECT 1 FROM commerce_configuration_drafts WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,profileId))throw new Error('PROFILE_EXISTS');
      k.db.prepare('INSERT INTO commerce_configuration_drafts VALUES(?,?,?,?,?,?,?,NULL,NULL)').run(s.tenant_id,s.store_id,profileId,1,canonical(layers),canonical(history),s.actor_id);
      k.audit(scope,'profile_draft','allowed');return this.get(scope,profileId);
    });
  }
  get(scope:Scope,profileId:string){
    const s=this.#k.authorize(scope,'profile.read');this.#k.require(scope,['operator','reviewer']);const r=this.#row(s,profileId),layers=JSON.parse(r.body),compiled=this.#compile(scope,s,layers),base=this.#compile(scope,s,[baseLayer()]).effective as Row;
    const diff=EDIT_FIELDS.filter(path=>canonical(base[path])!==canonical(compiled.effective[path])).map(path=>({path,before:base[path],after:compiled.effective[path]}));
    return {id:profileId,revision:r.revision,state:r.request_digest?'review_requested':'draft',...compiled,diff,
      history:JSON.parse(r.history).map((h:Row)=>({revision:h.revision,actor:h.actor})),simulation_digest:r.simulation_digest,request_digest:r.request_digest,activation:'none'};
  }
  edit(scope:Scope,profileId:string,input:unknown){
    const s=this.#k.authorize(scope,'profile.write'),p=exact(jsonValue(input),['expected_revision','changes']);integer(p.expected_revision,1);
    if(!p.changes||typeof p.changes!=='object'||Array.isArray(p.changes)||!Object.keys(p.changes).length)invalid('changes','TYPE');
    for(const path of Object.keys(p.changes))if(!EDIT_FIELDS.includes(path))invalid(path,'PROTECTED_FIELD');
    return this.#change(scope,s,profileId,p.expected_revision,(old:Row)=>({...old,...p.changes}));
  }
  restore(scope:Scope,profileId:string,input:unknown){
    const s=this.#k.authorize(scope,'profile.write'),p=exact(jsonValue(input),['expected_revision','restore_revision']);integer(p.expected_revision,1);integer(p.restore_revision,1);
    return this.#change(scope,s,profileId,p.expected_revision,(_old:Row,history:Row[])=>{
      const row=history.find(h=>h.revision===p.restore_revision);if(!row)throw new Error('NOT_FOUND');return row.values;});
  }
  #change(scope:Scope,s:Row,profileId:string,expected:number,change:(old:Row,history:Row[])=>Row){
    const k=this.#k;return k.transaction(()=>{
      const r=this.#row(s,profileId);if(r.revision!==expected)throw new Error('PROFILE_CHANGED');
      const history=JSON.parse(r.history),layers=JSON.parse(r.body);if(history.length>=64)throw new Error('DRAFT_HISTORY_LIMIT');
      const merchant=layers.find((l:Row)=>l.id==='merchant'),values=jsonValue(change(merchant.values,history));
      const revision=r.revision+1;merchant.values=values;merchant.revision=revision;merchant.source.revision=String(revision);merchant.source.sha256=contentDigest(values);
      this.#compile(scope,s,layers);history.push({revision,values,actor:s.actor_id});
      k.db.prepare('UPDATE commerce_configuration_drafts SET revision=?,body=?,history=?,actor=?,simulation_digest=NULL,request_digest=NULL WHERE tenant_id=? AND store_id=? AND id=?')
        .run(revision,canonical(layers),canonical(history),s.actor_id,s.tenant_id,s.store_id,profileId);
      k.audit(scope,'profile_edit','allowed');return this.get(scope,profileId);
    });
  }
  simulate(scope:Scope,profileId:string,expectedRevision:number){
    const k=this.#k,s=k.authorize(scope,'profile.write');integer(expectedRevision,1);
    return k.transaction(()=>{
      const view=this.get(scope,profileId);if(view.revision!==expectedRevision)throw new Error('PROFILE_CHANGED');
      const results=scenarioResults(view.effective);
      const bound={revision:view.revision,effective_digest:view.effective_digest,composition_digest:view.composition_digest,connection_revision:view.connection_revision,results};
      const simulation_digest=contentDigest(bound);
      k.db.prepare('UPDATE commerce_configuration_drafts SET simulation_digest=?,request_digest=NULL WHERE tenant_id=? AND store_id=? AND id=?').run(simulation_digest,s.tenant_id,s.store_id,profileId);
      return {...bound,simulation_digest,publication_requested:false,execution_authorized:false};
    });
  }
  requestReview(scope:Scope,profileId:string,input:unknown){
    const k=this.#k,s=k.authorize(scope,'profile.write'),p=exact(jsonValue(input),['expected_revision','simulation_digest']);integer(p.expected_revision,1);
    return k.transaction(()=>{
      const r=this.#row(s,profileId),view=this.get(scope,profileId);
      if(r.revision!==p.expected_revision)throw new Error('PROFILE_CHANGED');
      if(!view.readiness.ready)throw new Error('PROFILE_NOT_READY');
      if(!r.simulation_digest||r.simulation_digest!==p.simulation_digest)throw new Error('SIMULATION_REQUIRED');
      // Recompute from current server facts, not a client-supplied green report.
      const results=scenarioResults(view.effective);
      const fresh=contentDigest({revision:view.revision,effective_digest:view.effective_digest,composition_digest:view.composition_digest,connection_revision:view.connection_revision,results});
      if(fresh!==p.simulation_digest)throw new Error('SIMULATION_STALE');
      const request_digest=contentDigest({simulation_digest:fresh,requester:s.actor_id,revision:r.revision});
      k.db.prepare('UPDATE commerce_configuration_drafts SET request_digest=? WHERE tenant_id=? AND store_id=? AND id=?').run(request_digest,s.tenant_id,s.store_id,profileId);
      k.audit(scope,'profile_request','allowed');return {state:'review_requested',request_digest,execution_authorized:false,activation:'none'};
    });
  }
}
