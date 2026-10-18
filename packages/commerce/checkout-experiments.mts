import { createHmac,randomBytes } from 'node:crypto';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { exact,id,integer } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { supportCase } from './support-core.mts';
import { subjectHash } from './data-guards.mts';
import { growthBody } from './growth-marketing-core.mts';

/** A new randomized checkout cohort. Existing nonrandom prevention cohorts are unchanged. */
export class CheckoutExperiments {
  readonly k:CommerceKernel;readonly seedFactory:()=>string;
  constructor(k:CommerceKernel,seedFactory:()=>string=()=>randomBytes(32).toString('hex')){this.k=k;this.seedFactory=seedFactory;}
  configure(scope:Scope,input:unknown){
    const p=exact(jsonValue(input),['experiment_id','version','starts_at','ends_at','attribution_window_ms','followup_through_at','currency','variants','members']);
    id(p.experiment_id);integer(p.version,1);integer(p.starts_at);integer(p.ends_at);integer(p.attribution_window_ms,1);integer(p.followup_through_at);
    if(p.currency!=='USD'||p.starts_at<this.k.clock()||p.ends_at<=p.starts_at||p.ends_at-p.starts_at>30*86400000||p.attribution_window_ms>30*86400000||p.followup_through_at<p.ends_at||p.followup_through_at-p.ends_at>90*86400000)throw new Error('EXPERIMENT_WINDOW_INVALID');
    if(!Array.isArray(p.members)||!p.members.length||p.members.length>500||new Set(p.members).size!==p.members.length||!Array.isArray(p.variants)||p.variants.length!==2)throw new Error('EXPERIMENT_COHORT_INVALID');
    const variants=p.variants.map((v:Row)=>{exact(v,['id','weight']);id(v.id);integer(v.weight,1);return {...v};}).sort((a:Row,b:Row)=>a.id.localeCompare(b.id));
    if(variants.map((v:Row)=>v.id).join(',')!=='holdout,treatment'||variants.reduce((n:number,v:Row)=>n+v.weight,0)!==10000)throw new Error('EXPERIMENT_VARIANTS_INVALID');
    return this.k.transaction(()=>{
      const k=this.k,s=k.authorize(scope,'support.configure');
      if(k.db.prepare('SELECT 1 FROM commerce_checkout_experiments WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,p.experiment_id))throw new Error('EXPERIMENT_FROZEN');
      const seed=this.seedFactory();if(!/^[a-f0-9]{64}$/.test(seed))throw new Error('EXPERIMENT_ENTROPY_INVALID');
      const seen=new Set<string>(),members=p.members.map((caseId:string)=>{
        const {c}=supportCase(k,scope,id(caseId)),facts=c.order.payload.marketing_eligibility;
        if(seen.has(c.customer_id))throw new Error('EXPERIMENT_SUBJECT_DUPLICATE');seen.add(c.customer_id);
        const reason=facts?.bot===true?'BOT':facts?.eligible!==true||facts?.bot!==false?'INELIGIBLE_OR_UNKNOWN':null;
        const draw=createHmac('sha256',Buffer.from(seed,'hex')).update([s.tenant_id,s.store_id,p.experiment_id,String(p.version),c.customer_id].join('\0')).digest().readUInt32BE(0);
        const arm=reason?null:draw/0x100000000<variants.find((v:Row)=>v.id==='treatment').weight/10000?'treatment':'holdout';
        return {case_id:c.id,resource_id:c.resource_id,customer_id:c.customer_id,subject_hash:subjectHash(s.tenant_id,s.store_id,c.customer_id),arm,state:reason?'excluded':'assigned',reason,source_version:c.order.source_version,eligibility_digest:contentDigest(facts??null)};
      });
      const denominators={treatment:members.filter((m:Row)=>m.arm==='treatment').length,holdout:members.filter((m:Row)=>m.arm==='holdout').length};
      const config={id:p.experiment_id,version:p.version,starts_at:p.starts_at,ends_at:p.ends_at,attribution_window_ms:p.attribution_window_ms,followup_through_at:p.followup_through_at,currency:p.currency,variants,seed,denominators,enrolled:members.length,excluded:members.filter((m:Row)=>!m.arm).length,unit:'scoped_customer',allocation:'hmac_sha256_seeded_randomized_v1',version_change_rule:'new_explicit_experiment_identity_required',eligibility_rule:'frozen_at_enrollment_current_bot_or_ineligible_blocks_exposure',automatic_promotion:false};
      k.db.prepare('INSERT INTO commerce_checkout_experiments VALUES(?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,p.experiment_id,p.version,canonical(config),contentDigest(config),k.clock());
      for(const member of members)k.db.prepare('INSERT INTO commerce_checkout_assignments VALUES(?,?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,p.experiment_id,member.resource_id,member.customer_id,member.subject_hash,member.arm,canonical(member),contentDigest(member));
      return this.inspect(scope,p.experiment_id);
    });
  }
  inspect(scope:Scope,experimentId:string){const session=this.k.require(scope),s=this.k.authorize(scope,'support.read',session.role==='customer'?session.resource_id:null),row=this.k.db.prepare('SELECT * FROM commerce_checkout_experiments WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(experimentId)) as Row;const {seed,...safe}=growthBody(row);return {...safe,digest:row.digest,qualification:'synthetic_only'};}
  assign(scope:Scope,input:unknown){
    const p=exact(jsonValue(input),['experiment_id','case_id','frontend_variants']),{s,c}=supportCase(this.k,scope,p.case_id),experiment=this.inspect(scope,p.experiment_id);
    if(!Array.isArray(p.frontend_variants)||p.frontend_variants.length!==2||[...p.frontend_variants].sort().join(',')!=='holdout,treatment')throw new Error('EXPERIMENT_VARIANTS_CHANGED');
    const row=this.k.db.prepare('SELECT * FROM commerce_checkout_assignments WHERE tenant_id=? AND store_id=? AND experiment_id=? AND subject_hash=?').get(s.tenant_id,s.store_id,experiment.id,subjectHash(s.tenant_id,s.store_id,c.customer_id)) as Row;
    const member=growthBody(row);
    if(member.resource_id!==c.resource_id||member.case_id!==c.id||member.customer_id!==c.customer_id||member.arm!==row.arm)throw new Error('EXPERIMENT_ASSIGNMENT_MISMATCH');
    const frozen={experiment_id:experiment.id,version:experiment.version,arm:member.arm,state:member.state,reason:member.reason,assignment_digest:row.digest,unit:experiment.unit,automatic_promotion:false};
    return frozen;
  }
  expose(scope:Scope,input:unknown){
    const p=exact(jsonValue(input),['experiment_id','case_id','channel','offer_shown','event_id']);id(p.event_id);id(p.channel);if(typeof p.offer_shown!=='boolean')throw new Error('EXPOSURE_INVALID');
    return this.k.transaction(()=>{
      const {s,c}=supportCase(this.k,scope,p.case_id);this.k.authorize(scope,'support.analytics',c.resource_id);
      const exp=this.inspect(scope,p.experiment_id),assignment=this.assign(scope,{experiment_id:p.experiment_id,case_id:p.case_id,frontend_variants:['holdout','treatment']});
      const facts=c.order.payload.marketing_eligibility;
      if(assignment.state!=='assigned'||facts?.eligible!==true||facts?.bot!==false)throw new Error('EXPERIMENT_EXPOSURE_EXCLUDED');
      if(this.k.clock()<exp.starts_at||this.k.clock()>exp.ends_at)throw new Error('EXPERIMENT_WINDOW_CLOSED');
      const subject=subjectHash(s.tenant_id,s.store_id,c.customer_id),ref='exposure_'+contentDigest([exp.id,subject,p.channel]).slice(0,40),old=this.k.db.prepare('SELECT * FROM commerce_checkout_exposures WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,ref) as Row;
      if(old){const value=growthBody(old);if(value.offer_shown!==p.offer_shown)throw new Error('EXPOSURE_CONFLICT');return {id:ref,duplicate:true,exposure_unit:exp.unit};}
      const body={event_id:p.event_id,experiment_id:exp.id,version:exp.version,resource_id:c.resource_id,customer_id:c.customer_id,assignment_digest:assignment.assignment_digest,arm:assignment.arm,channel:p.channel,offer_shown:p.offer_shown,at:this.k.clock()};
      this.k.db.prepare('INSERT INTO commerce_checkout_exposures VALUES(?,?,?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,ref,exp.id,c.resource_id,c.customer_id,subject,p.channel,canonical(body),contentDigest(body));
      return {id:ref,duplicate:false,exposure_unit:exp.unit,contamination:assignment.arm==='holdout'&&p.offer_shown};
    });
  }
}
