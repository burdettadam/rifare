import {permissionDecision} from './authorization.mts';
import type {CommerceKernel,Scope,Row} from './kernel.mts';
import {id,integer,exact} from './kernel.mts';
import {canonical,contentDigest,jsonValue} from './configuration-values.mts';
import {supportCase,saveDocument,documentRow,checkedDocument,ownershipRow,supportEvent,assertSupportOwner} from './support-core.mts';
import type {SupportDelivery} from './support-delivery.mts';
import {assertCaseWorkerScope} from './work-leases.mts';
const TRIGGERS=['message_received','shipment_exception','return_requested'] as const;
const ACTIONS=['handoff_request','draft_return','queue_tracking'] as const;
function validateRule(input:unknown){const p=exact(jsonValue(input),['id','expected_version','trigger','conditions','priority','wait_ms','calendar','action','expires_at']);
 id(p.id);integer(p.expected_version);integer(p.priority);integer(p.wait_ms);integer(p.expires_at);
 if(!TRIGGERS.includes(p.trigger)||!ACTIONS.includes(p.action)||p.priority>100||p.wait_ms>7*86400000)throw new Error('RULE_INVALID');
 exact(p.conditions,['channel','requires_verified_case']);if(!['any','email','webchat','helpdesk'].includes(p.conditions.channel)||p.conditions.requires_verified_case!==true)throw new Error('RULE_INVALID');
 exact(p.calendar,['timezone','weekdays','start_minute','end_minute']);integer(p.calendar.start_minute);integer(p.calendar.end_minute);
 if(p.calendar.timezone!=='UTC'||!Array.isArray(p.calendar.weekdays)||!p.calendar.weekdays.length||p.calendar.weekdays.length>7||new Set(p.calendar.weekdays).size!==p.calendar.weekdays.length||p.calendar.weekdays.some((d:any)=>!Number.isInteger(d)||d<0||d>6)||p.calendar.start_minute>=p.calendar.end_minute||p.calendar.end_minute>1440)throw new Error('RULE_CALENDAR_UNSUPPORTED');
 return p;
}
export function nextRuleTime(at:number,calendar:Row){integer(at);const d=new Date(at);for(let n=0;n<9;n++){const start=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()+n)+calendar.start_minute*60000,end=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()+n)+calendar.end_minute*60000,day=new Date(start).getUTCDay();if(calendar.weekdays.includes(day)&&at<end)return Math.max(at,start);}throw new Error('RULE_CALENDAR_UNAVAILABLE');}
export class SupportRules {
 readonly k:CommerceKernel;readonly delivery:SupportDelivery;constructor(k:CommerceKernel,delivery:SupportDelivery){this.k=k;this.delivery=delivery;}
 draft(scope:Scope,input:unknown){const p=validateRule(input);if(p.expires_at<=this.k.clock()||p.expires_at>this.k.clock()+30*86400000)throw new Error('RULE_INVALID');return this.k.transaction(()=>{const s=this.k.authorize(scope,'support.configure');return saveDocument(this.k,s,'support_rules',p.id,p.expected_version,p,'draft',p.expires_at);});}
 simulate(scope:Scope,ref:string,version:number,input:unknown){const s=this.k.authorize(scope,'policy.test'),r=documentRow(this.k,s,'support_rules',ref,version),event=this.#event(input),p=validateRule(r.body);return {rule_digest:r.digest,matched:this.#matches(p,event),action:p.action,due_at:nextRuleTime(event.at+p.wait_ms,p.calendar),execution_authorized:false,calendar_qualification:'UTC_only_no_local_timezone_inference'};}
 review(scope:Scope,ref:string,version:number,expectedDigest:string){return this.k.transaction(()=>{const s=this.k.authorize(scope,'policy.review'),r=documentRow(this.k,s,'support_rules',ref,version);if(r.state!=='draft'||r.digest!==expectedDigest||r.author===s.actor_id)throw new Error('RULE_REVIEW_INVALID');validateRule(r.body);this.k.db.prepare("UPDATE commerce_support_documents SET state='reviewed',reviewer=?,review_digest=? WHERE tenant_id=? AND store_id=? AND kind='support_rules' AND id=? AND version=?").run(s.actor_id,contentDigest({digest:r.digest,revision:permissionDecision(this.k.db,s,'policy.review').authority_revision}),s.tenant_id,s.store_id,ref,version);return {state:'reviewed',digest:r.digest};});}
 publish(scope:Scope,ref:string,version:number){return this.k.transaction(()=>{const s=this.k.authorize(scope,'support.configure'),r=documentRow(this.k,s,'support_rules',ref,version),member=this.k.db.prepare('SELECT active,role FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=?').get(s.tenant_id,s.store_id,r.reviewer) as Row;
  const authority=member?.active?permissionDecision(this.k.db,{...s,actor_id:r.reviewer,role:member.role},'policy.review'):null;
  if(r.state!=='reviewed'||!authority?.allowed||r.review_digest!==contentDigest({digest:r.digest,revision:authority?.authority_revision})||r.expires_at<=this.k.clock())throw new Error('RULE_REVIEW_INVALID');this.k.db.prepare("UPDATE commerce_support_documents SET state='active' WHERE tenant_id=? AND store_id=? AND kind='support_rules' AND id=? AND version=?").run(s.tenant_id,s.store_id,ref,version);return {state:'active',id:ref,version,digest:r.digest};});}
 revoke(scope:Scope,ref:string,version:number){return this.k.transaction(()=>{const s=this.k.authorize(scope,'support.configure');documentRow(this.k,s,'support_rules',ref,version);this.k.db.prepare("UPDATE commerce_support_documents SET state='revoked' WHERE tenant_id=? AND store_id=? AND kind='support_rules' AND id=? AND version=?").run(s.tenant_id,s.store_id,ref,version);return {state:'revoked'};});}
 // A decision selects one existing manual-work rule, never schedule()'s fan-out.
 selection(scope:Scope,input:unknown){const p=exact(jsonValue(input),['id','version','digest']),s=this.k.authorize(scope,'support.read'),r=checkedDocument(this.k,s,'support_rules',p.id,p.version);validateRule(r.body);
  const member=this.k.db.prepare('SELECT active,role FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=?').get(s.tenant_id,s.store_id,r.reviewer) as Row,authority=member?.active?permissionDecision(this.k.db,{...s,actor_id:r.reviewer,role:member.role},'policy.review'):null;
  if(!authority?.allowed||r.review_digest!==contentDigest({digest:r.digest,revision:authority.authority_revision}))throw new Error('ROUTING_REVIEW_CHANGED');
  if(r.digest!==p.digest||!['handoff_request','draft_return'].includes(r.body.action)||r.body.trigger!=='return_requested'||r.body.wait_ms!==0||!['any','webchat'].includes(r.body.conditions.channel))throw new Error('RULE_SELECTION_INVALID');return r;
 }
 applySelected(scope:Scope,input:unknown){const p=exact(jsonValue(input),['rule_id','rule_version','rule_digest','case_id','event_id','expected_generation']);integer(p.expected_generation,1);id(p.event_id);
  return this.k.transaction(()=>{const {s,c}=supportCase(this.k,scope,p.case_id,'support.reply'),ownership=assertSupportOwner(this.k,scope,c.id,p.expected_generation),r=this.selection(scope,{id:p.rule_id,version:p.rule_version,digest:p.rule_digest});assertCaseWorkerScope(this.k,scope,c.id);
   const now=this.k.clock(),due=nextRuleTime(now,r.body.calendar);if(due!==now)throw new Error('RULE_SELECTION_NOT_DUE');
   const event=this.#event({id:p.event_id,case_id:c.id,trigger:'return_requested',channel:'webchat',at:now,visited:[],depth:0,link_id:null,sender_id:null}),ref='sj_'+contentDigest([s.tenant_id,s.store_id,r.id,event.id]).slice(0,40);
   const previous=this.k.db.prepare('SELECT * FROM commerce_support_rule_jobs WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,ref) as Row;
   if(previous){if(previous.case_id!==c.id||previous.rule_digest!==r.digest||previous.rule_version!==r.version||previous.generation!==ownership.owner.generation||previous.state!=='completed')throw new Error('RULE_EVENT_CONFLICT');return this.job(scope,ref);}
   this.k.db.prepare("INSERT INTO commerce_support_rule_jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?, 'waiting',NULL)").run(s.tenant_id,s.store_id,ref,c.id,c.resource_id,r.id,r.version,r.digest,event.id,canonical(event),ownership.owner.generation,due);
   return this.execute(scope,ref);
  });
 }
 #event(input:unknown){const e=exact(jsonValue(input),['id','case_id','trigger','channel','at','visited','depth','link_id','sender_id']);[e.id,e.case_id].forEach(id);integer(e.at);integer(e.depth);if(!TRIGGERS.includes(e.trigger)||!['email','webchat','helpdesk'].includes(e.channel)||e.at>this.k.clock()||!Array.isArray(e.visited)||e.visited.length>8||e.depth>8||new Set(e.visited).size!==e.visited.length)throw new Error('RULE_EVENT_INVALID');e.visited.forEach(id);if(e.link_id!==null)id(e.link_id);if(e.sender_id!==null)id(e.sender_id);return e;}
 #matches(p:Row,e:Row){return e.trigger===p.trigger&&(p.conditions.channel==='any'||p.conditions.channel===e.channel);}
 schedule(scope:Scope,input:unknown){const e=this.#event(input);return this.k.transaction(()=>{const {s,c}=supportCase(this.k,scope,e.case_id,'support.reply'),owner=ownershipRow(this.k,s,c.id);if(!owner)throw new Error('SUPPORT_OWNERSHIP_CHANGED');
  if(e.depth>=4)return {jobs:[],loop_stopped:true};const rows=this.k.db.prepare("SELECT id,max(version) version FROM commerce_support_documents WHERE tenant_id=? AND store_id=? AND kind='support_rules' AND state='active' AND expires_at>? GROUP BY id LIMIT 100").all(s.tenant_id,s.store_id,this.k.clock()) as Row[];
  const rules=rows.map(r=>checkedDocument(this.k,s,'support_rules',r.id,r.version)).filter(r=>this.#matches(r.body,e)&&!e.visited.includes(r.id)).sort((a,b)=>b.body.priority-a.body.priority||a.id.localeCompare(b.id));if(rules.length>20)throw new Error('RULE_MATCH_LIMIT');const jobs=[];
  for(const r of rules){const ref='sj_'+contentDigest([s.tenant_id,s.store_id,r.id,e.id]).slice(0,40),old=this.k.db.prepare('SELECT * FROM commerce_support_rule_jobs WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,ref) as Row;
   if(old){if(old.event_body!==canonical(e))throw new Error('RULE_EVENT_CONFLICT');jobs.push(this.job(scope,ref));continue;}
   const due=nextRuleTime(e.at+r.body.wait_ms,r.body.calendar);this.k.db.prepare("INSERT INTO commerce_support_rule_jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?, 'waiting',NULL)").run(s.tenant_id,s.store_id,ref,c.id,c.resource_id,r.id,r.version,r.digest,e.id,canonical(e),owner.generation,due);jobs.push(this.job(scope,ref));}
  return {jobs,loop_stopped:false};});}
 job(scope:Scope,ref:string){id(ref);const s=this.k.require(scope),r=this.k.db.prepare('SELECT * FROM commerce_support_rule_jobs WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,ref) as Row;if(!r)throw new Error('NOT_FOUND');supportCase(this.k,scope,r.case_id);return {id:r.id,case_id:r.case_id,rule_id:r.rule_id,version:r.version,rule_digest:r.rule_digest,due_at:r.due_at,state:r.state,result:r.result?JSON.parse(r.result):null};}
 execute(scope:Scope,ref:string){return this.k.transaction(()=>{const current=this.job(scope,ref),{s,c}=supportCase(this.k,scope,current.case_id,'support.reply'),r=this.k.db.prepare('SELECT * FROM commerce_support_rule_jobs WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,ref) as Row;
  if(r.state==='completed')return current;if(r.due_at>this.k.clock())throw new Error('RULE_NOT_DUE');const rule=checkedDocument(this.k,s,'support_rules',r.rule_id,r.version),owner=ownershipRow(this.k,s,c.id),event=JSON.parse(r.event_body);
  if(rule.digest!==r.rule_digest||owner?.generation!==r.generation||owner.owner!==s.actor_id)throw new Error('RULE_CONTEXT_CHANGED');let result:any;
  if(rule.body.action==='queue_tracking'){if(!event.link_id||!event.sender_id)throw new Error('RULE_MESSAGE_ROUTE_MISSING');result=this.delivery.queue(scope,{case_id:c.id,link_id:event.link_id,sender_id:event.sender_id,event_id:ref,template_id:'tracking_status_v1',expected_generation:r.generation});}
  else{supportEvent(this.k,s,c.id,rule.body.action,r.generation,ref);result={kind:rule.body.action,case_id:c.id,execution_authorized:false,manual_action_required:true};}
  const out={...result,visited:[...event.visited,rule.id],depth:event.depth+1};this.k.db.prepare("UPDATE commerce_support_rule_jobs SET state='completed',result=? WHERE tenant_id=? AND store_id=? AND id=?").run(canonical(out),s.tenant_id,s.store_id,ref);return this.job(scope,ref);});}
}
