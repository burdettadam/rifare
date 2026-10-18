import type { CommerceKernel,Row } from './kernel.mts';
import { subjectHash } from './data-guards.mts';
import { canonical,contentDigest } from './configuration-values.mts';

export const MARKETING_SUBJECT_TABLES=Object.freeze(['commerce_checkout_assignments','commerce_checkout_exposures','commerce_growth_observations','commerce_growth_campaign_recipients','commerce_cart_recoveries','commerce_email_action_links']);
export const MARKETING_CONFIG_TABLES=Object.freeze(['commerce_checkout_experiments','commerce_marketing_segments','commerce_marketing_sync_operations','commerce_growth_campaigns','commerce_growth_campaign_approvals']);
function rows(k:CommerceKernel,table:string,tenant:string,store:string){return k.db.prepare(`SELECT * FROM ${table} WHERE tenant_id=? AND store_id=?`).all(tenant,store) as Row[];}
function checked(row:Row){const body=JSON.parse(row.body);if(contentDigest(body)!==row.digest)throw new Error('GROWTH_RECORD_INTEGRITY');return body;}
function subjectMatch(row:Row,resources:Set<string>,tenant:string,store:string,hash:string,customer?:string){return resources.has(row.resource_id)||row.subject_hash===hash||row.customer_id==='erased_'+hash.slice(0,40)||typeof row.customer_id==='string'&&(row.customer_id===customer||subjectHash(tenant,store,row.customer_id)===hash);}
function projection(row:Row,experiment=false){
  const body={...checked(row)};delete body.issuer_session_hash;delete body.confirming_customer_session_hash;if(experiment)delete body.seed;
  const value={...row,body:canonical(body),digest:contentDigest(body),source_record_digest:row.digest,projection:'subject_export_without_authority'};
  delete value.token_hash;return value;
}
/** Caller must already hold the canonical privacy authority. This is a projection,
 * not an importable authentication or approval record. */
export function exportMarketingSubject(k:CommerceKernel,tenant:string,store:string,resourceIds:readonly string[],customer:string,hash:string){
  const resources=new Set(resourceIds),result:Record<string,Row[]>=Object.fromEntries([...MARKETING_SUBJECT_TABLES,...MARKETING_CONFIG_TABLES].map(table=>[table,[]]));
  for(const table of MARKETING_SUBJECT_TABLES)result[table]=rows(k,table,tenant,store).filter(r=>subjectMatch(r,resources,tenant,store,hash,customer)).map(row=>projection(row));
  const experiments=new Set(result.commerce_checkout_assignments.map(r=>r.experiment_id)),campaigns=new Set([...result.commerce_growth_campaign_recipients,...result.commerce_cart_recoveries].map(r=>r.campaign_id));
  result.commerce_checkout_experiments=rows(k,'commerce_checkout_experiments',tenant,store).filter(r=>experiments.has(r.id)).map(r=>projection(r,true));
  const campaignRows=rows(k,'commerce_growth_campaigns',tenant,store).filter(r=>campaigns.has(r.id));
  result.commerce_growth_campaigns=campaignRows.map(r=>projection(r));
  result.commerce_growth_campaign_approvals=rows(k,'commerce_growth_campaign_approvals',tenant,store).filter(r=>campaigns.has(r.campaign_id)).map(r=>({...projection(r),revoked:1}));
  const segments=new Set(campaignRows.map(r=>checked(r).segment_id));
  result.commerce_marketing_segments=rows(k,'commerce_marketing_segments',tenant,store).filter(r=>segments.has(r.id)).map(r=>({...projection(r),approval_body:null,approval_digest:null,revoked:1}));
  result.commerce_marketing_sync_operations=rows(k,'commerce_marketing_sync_operations',tenant,store).filter(r=>segments.has(r.segment_id)).map(r=>projection(r));
  return result;
}
function minimize(table:string,row:Row,b:Row,hash:string){
  const common={redacted:true,subject_hash:hash,unavailable:true};
  if(table==='commerce_checkout_assignments')return {...common,arm:row.arm,state:'unavailable',original_assignment_digest:b.original_assignment_digest??row.digest};
  if(table==='commerce_checkout_exposures')return {...common,original_exposure_id:row.id,arm:b.arm??null,channel:row.channel};
  if(table==='commerce_growth_observations')return {...common,original_event_id:row.event_id,original_purchase_id:b.original_purchase_id??b.purchase_id??null,source_identity:row.source_identity};
  if(table==='commerce_growth_campaign_recipients')return {...common,original_operation_id:row.operation_id,original_campaign_id:row.campaign_id,unit_cost_minor:b.unit_cost_minor,state:'suppressed_erased'};
  if(table==='commerce_cart_recoveries')return {...common,original_cart_id:row.cart_id,original_campaign_id:row.campaign_id,state:'cancelled_erased'};
  return {...common,original_edit_id:b.original_edit_id,source_identity:b.source_identity,state:'revoked_erased'};
}
export function eraseMarketingSubject(k:CommerceKernel,tenant:string,store:string,resourceIds:readonly string[],hash:string){
  const resources=new Set(resourceIds),affectedCampaigns=new Set<string>();let changed=0;
  for(const table of MARKETING_SUBJECT_TABLES){
    const pk=(k.db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).filter(c=>c.pk).sort((a,b)=>a.pk-b.pk).map(c=>c.name);
    for(const row of rows(k,table,tenant,store).filter(r=>subjectMatch(r,resources,tenant,store,hash))){
      const b=checked(row),body=minimize(table,row,b,hash);if(row.campaign_id)affectedCampaigns.add(row.campaign_id);
      const link=table==='commerce_email_action_links';
      k.db.prepare(`UPDATE ${table} SET body=?,digest=?,customer_id=?${link?",revoked=1,state='revoked_erased',token_hash=?":''} WHERE ${pk.map(c=>c+'=?').join(' AND ')}`)
        .run(canonical(body),contentDigest(body),'erased_'+hash.slice(0,40),...(link?[contentDigest(['revoked_email_link',tenant,store,row.id])]:[]),...pk.map(c=>row[c]));changed++;
    }
  }
  for(const campaignId of affectedCampaigns){
    k.db.prepare("UPDATE commerce_growth_campaigns SET state='paused_erasure' WHERE tenant_id=? AND store_id=? AND id=?").run(tenant,store,campaignId);
    k.db.prepare('UPDATE commerce_growth_campaign_approvals SET revoked=1 WHERE tenant_id=? AND store_id=? AND campaign_id=?').run(tenant,store,campaignId);
  }
  // Experiment configurations and assignment arm columns are deliberately left
  // intact. Missing subjects remain unavailable in their original denominator.
  return {minimized:changed,paused_campaigns:affectedCampaigns.size,denominators_preserved:true,source_effects_dispatched:0};
}
export function revokeMarketingForRestore(k:CommerceKernel,tenant?:string,store?:string){
  const where=tenant===undefined?'':store===undefined?' WHERE tenant_id=?':' WHERE tenant_id=? AND store_id=?',args=tenant===undefined?[]:store===undefined?[tenant]:[tenant,store];
  k.db.prepare('UPDATE commerce_marketing_segments SET revoked=1'+where).run(...args);
  k.db.prepare('UPDATE commerce_growth_campaign_approvals SET revoked=1'+where).run(...args);
  k.db.prepare("UPDATE commerce_growth_campaigns SET state='paused_restore'"+where).run(...args);
  for(const table of ['commerce_cart_recoveries','commerce_email_action_links']){
    const all=k.db.prepare('SELECT * FROM '+table+where).all(...args) as Row[];
    for(const row of all){const b=checked(row);delete b.issuer_session_hash;delete b.confirming_customer_session_hash;const body={...b,state:table==='commerce_email_action_links'?'revoked_restore':'cancelled_restore'};
      k.db.prepare(`UPDATE ${table} SET body=?,digest=?${table==='commerce_email_action_links'?",revoked=1,state='revoked_restore'":''} WHERE tenant_id=? AND store_id=? AND id=?`).run(canonical(body),contentDigest(body),row.tenant_id,row.store_id,row.id);
    }
  }
  return {approvals_revoked:true,campaigns_paused:true,recoveries_cancelled:true,email_links_revoked:true,original_sync_outcomes_preserved:true,source_effects_dispatched:0};
}
