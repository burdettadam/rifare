import {id,integer} from './kernel.mts';
import type {Row} from './kernel.mts';
import {contentDigest} from './configuration-values.mts';
import {DROPOFF_ISSUE_ACTION,dropoffShape,dropoffHash,dropoffCommand,dropoffResult} from './dropoff-credential-values.mts';

export const DROPOFF_HANDOFF_CONTRACT='rifare-dropoff-handoff-fixture-v1',DROPOFF_HANDOFF_ACTION='diagnostic.dropoff.handoff';
export const DROPOFF_HANDOFF_PREFIX='dropoff_event_',DROPOFF_HANDOFF_LIMIT=1000;
export const DROPOFF_HANDOFF_FIELDS=['schema_version','contract','event_id','kind','sequence','tenant_id','store_id','source_identity','credential_source_identity','source_account_id','directory_identity','family_ref','subject_ref','resource_id','issue_operation_id','command_digest','credential_id','generation','items_digest','method_digest','site_id','destination_id','method_id','credential_kind','credential_expires_at','admitted_at','observed_at','parent_event_id','units','qualification','physical_handoff_qualified','warehouse_effect','financial_effect','digest'];
const FAMILY_FIELDS=['tenant_id','store_id','source_identity','credential_source_identity','source_account_id','directory_identity','family_ref','subject_ref','resource_id','items_digest','site_id','destination_id','method_id','credential_kind'];
const ORIGINAL_FIELDS=[...FAMILY_FIELDS,'issue_operation_id','command_digest','credential_id','generation','method_digest','credential_expires_at','admitted_at'];
export const handoffSourceIdentity=(c:Row)=>contentDigest({schema_version:1,contract:DROPOFF_HANDOFF_CONTRACT,credential_source_identity:c.source_identity,source_account_id:c.source_account_id,directory_identity:c.directory_identity,tenant_id:c.tenant_id,store_id:c.store_id});
export const handoffId=(event:Row)=>DROPOFF_HANDOFF_PREFIX+contentDigest([event.source_identity,event.event_id]).slice(0,40);
export const handoffUnitRef=(family:string,line:string,ordinal:number)=>contentDigest(['rifare-dropoff-unit-v1',family,line,ordinal]);
export function handoffManifest(items:unknown,family:string,expectedDigest:string){
  dropoffHash(family);dropoffHash(expectedDigest);
  if(!Array.isArray(items)||!items.length||items.length>20)throw new Error('DROPOFF_HANDOFF_MANIFEST_INVALID');
  let count=0;const seen=new Set<string>();
  const manifest=items.map(raw=>{const item=dropoffShape(raw,['line_id','item_id','category','quantity']);for(const key of ['line_id','item_id','category'])id(item[key]);integer(item.quantity,1);count+=item.quantity;
    if(count>100||seen.has(item.line_id))throw new Error('DROPOFF_HANDOFF_MANIFEST_INVALID');seen.add(item.line_id);return item;});
  if(contentDigest(manifest)!==expectedDigest)throw new Error('DROPOFF_HANDOFF_MANIFEST_INVALID');
  return manifest.flatMap(item=>Array.from({length:item.quantity},(_,i)=>({unit_ref:handoffUnitRef(family,item.line_id,i+1),line_id:item.line_id,item_id:item.item_id,ordinal:i+1}))).sort((a,b)=>a.unit_ref.localeCompare(b.unit_ref));
}
export function handoffUnits(value:unknown){
  if(!Array.isArray(value)||!value.length||value.length>100)throw new Error('DROPOFF_HANDOFF_UNITS_INVALID');
  const seen=new Set<string>();return value.map(raw=>{const u=dropoffShape(raw,['unit_ref','disposition','reason']);dropoffHash(u.unit_ref);
    if(seen.has(u.unit_ref)||u.disposition==='accepted'&&u.reason!=='accepted'||u.disposition==='rejected'&&!['wrong_item','damaged','unsupported','not_present'].includes(u.reason)||!['accepted','rejected'].includes(u.disposition))throw new Error('DROPOFF_HANDOFF_UNITS_INVALID');seen.add(u.unit_ref);return u;
  }).sort((a,b)=>a.unit_ref.localeCompare(b.unit_ref));
}
export function handoffEvent(value:unknown){
  const e=dropoffShape(value,DROPOFF_HANDOFF_FIELDS),{digest,...body}=e;
  for(const key of ['event_id','tenant_id','store_id','source_account_id','resource_id','issue_operation_id','credential_id','site_id','destination_id','method_id'])id(e[key]);
  for(const key of ['source_identity','credential_source_identity','directory_identity','family_ref','subject_ref','command_digest','items_digest','method_digest','digest'])dropoffHash(e[key]);
  for(const key of ['sequence','generation','credential_expires_at'])integer(e[key],1);integer(e.admitted_at);integer(e.observed_at);
  if(e.schema_version!==1||e.contract!==DROPOFF_HANDOFF_CONTRACT||!['acceptance','correction'].includes(e.kind)||!['qr','code'].includes(e.credential_kind)||e.qualification!=='synthetic_only'||e.physical_handoff_qualified!==false||e.warehouse_effect!==false||e.financial_effect!==false||e.admitted_at>=e.credential_expires_at||e.observed_at<e.admitted_at||contentDigest(body)!==digest||contentDigest(handoffUnits(e.units))!==contentDigest(e.units))throw new Error('DROPOFF_HANDOFF_EVENT_INVALID');
  if(e.kind==='acceptance'){if(e.parent_event_id!==null||e.admitted_at!==e.observed_at)throw new Error('DROPOFF_HANDOFF_EVENT_INVALID');}
  else {id(e.parent_event_id);if(e.parent_event_id===e.event_id)throw new Error('DROPOFF_HANDOFF_EVENT_INVALID');}return e;
}
/** Admission is bound to the original issued result, never today's credential state. */
export function handoffBinding(value:unknown,command:Row,result:Row){
  const e=handoffEvent(value),c=dropoffCommand(command),r=dropoffResult(result,c);
  if(c.action!==DROPOFF_ISSUE_ACTION||r.state!=='issued'||e.issue_operation_id!==c.operation_id||e.command_digest!==contentDigest(c)||e.credential_source_identity!==c.source_identity||e.source_identity!==handoffSourceIdentity(c)||e.credential_id!==r.credential_id||e.admitted_at<r.observed_at)throw new Error('DROPOFF_HANDOFF_BINDING_INVALID');
  for(const key of ['tenant_id','store_id','source_account_id','directory_identity','family_ref','subject_ref','resource_id','generation','items_digest','method_digest','site_id','destination_id','method_id','credential_kind','credential_expires_at'])if(e[key]!==c[key])throw new Error('DROPOFF_HANDOFF_BINDING_INVALID');return e;
}
/** Complete family prefix, with current parents tracked separately for every unit. */
export function handoffHistory(values:Row[],expected?:string[]){
  if(values.length>DROPOFF_HANDOFF_LIMIT)throw new Error('DROPOFF_HANDOFF_LIMIT');
  const history=values.map(handoffEvent).sort((a,b)=>a.sequence-b.sequence),events=new Map<string,Row>(),units=new Map<string,Row>(),allowed=expected?new Set(expected):null;
  for(let i=0;i<history.length;i++){
    const e=history[i];if(e.sequence!==i+1||events.has(e.event_id)||i&&e.observed_at<history[i-1].observed_at||FAMILY_FIELDS.some(key=>e[key]!==history[0][key]))throw new Error('DROPOFF_HANDOFF_HISTORY_INVALID');
    const parent=e.kind==='correction'?events.get(e.parent_event_id):null;
    if(e.kind==='correction'&&(!parent||ORIGINAL_FIELDS.some(key=>e[key]!==parent[key])))throw new Error('DROPOFF_HANDOFF_PARENT_INVALID');
    for(const u of e.units){
      const prior=units.get(u.unit_ref);if(allowed&&!allowed.has(u.unit_ref)||e.kind==='acceptance'&&prior||e.kind==='correction'&&(!prior||prior.current_event_id!==e.parent_event_id||!parent!.units.some((p:Row)=>p.unit_ref===u.unit_ref)))throw new Error('DROPOFF_HANDOFF_UNIT_CONFLICT');
      const accepted=u.disposition==='accepted',everAccepted=accepted||prior?.ever_accepted===true,state=accepted?'accepted':everAccepted?'disputed':'rejected';
      units.set(u.unit_ref,{unit_ref:u.unit_ref,state,reason:u.reason,site_id:everAccepted?e.site_id:null,last_accepted_site_id:everAccepted?e.site_id:null,original_event_id:prior?.original_event_id??e.event_id,current_event_id:e.event_id,custody_uncertain:state==='disputed',ever_accepted:everAccepted});
    }events.set(e.event_id,e);
  }return {history,units};
}
export function handoffProjection(issue:Row,expected:string[],items:Row[]|null,values:Row[],revoked:boolean,minimized:boolean){
  const {history,units:observed}=handoffHistory(values,expected),mapping=items?handoffManifest(items,issue.family_ref,issue.items_digest):[];
  const units=expected.map(ref=>{const source=observed.get(ref),m=mapping.find(u=>u.unit_ref===ref);return {unit_ref:ref,line_id:m?.line_id??null,ordinal:m?.ordinal??null,state:source?.state??'outstanding',reason:source?.reason??null,site_id:source?.site_id??null,last_accepted_site_id:source?.last_accepted_site_id??null,original_event_id:source?.original_event_id??null,current_event_id:source?.current_event_id??null,custody_uncertain:source?.custody_uncertain??false};});
  const counts=(selected:Row[])=>({expected:selected.length,accepted:selected.filter(u=>u.state==='accepted').length,rejected:selected.filter(u=>u.state==='rejected').length,disputed:selected.filter(u=>u.state==='disputed').length,outstanding:selected.filter(u=>u.state!=='accepted').length});
  return {schema_version:1,issue_operation_id:issue.operation_id,family_ref:issue.family_ref,resource_id:issue.resource_id,source_identity:handoffSourceIdentity(issue),authority_revoked:revoked,minimized,totals:counts(units),items:items?items.map(item=>({line_id:item.line_id,item_id:item.item_id,...counts(units.filter(u=>u.line_id===item.line_id))})).sort((a,b)=>a.line_id.localeCompare(b.line_id)):[],units,history,stage:'dropoff_acceptance',qualification:'synthetic_only',physical_handoff_qualified:false,warehouse_received:false,inspection_complete:false,stock_effects:0,financial_effect:false};
}
