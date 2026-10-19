import type {CommerceKernel,Row} from './kernel.mts';
import {exact,id,integer} from './kernel.mts';
import {canonical,contentDigest,jsonValue} from './configuration-values.mts';
import {eraseImageRecords,IMAGE_RECEIPT_KINDS} from './image-privacy.mts';

const MAX_IMAGES=10000,MAX_CONTROL_BYTES=131072;
const FIELDS=['tenant_id','store_id','evidence_id','case_id','resource_id','sha256','source_created_at'];
type Store={tenant_id:string;store_id:string};
type Image=Store&{evidence_id:string;case_id:string;resource_id:string;sha256:string;source_created_at:number};
type State={required:boolean;images:Image[];sources:Row[]};
type Replay={images:Image[];applied_at:number};
const invalid=()=>new Error('IMAGE_SUPPRESSION_INVALID');
const key=(r:Store,ref:string)=>JSON.stringify([r.tenant_id,r.store_id,ref]);
function image(value:unknown,observedAt:number):Image {
  try{
    const r=exact(value,FIELDS);integer(observedAt);
    for(const field of FIELDS.slice(0,5))id(r[field]);
    if(typeof r.sha256!=='string'||!/^[a-f0-9]{64}$/.test(r.sha256))throw invalid();
    integer(r.source_created_at);if(r.source_created_at>observedAt)throw invalid();
    return {tenant_id:r.tenant_id,store_id:r.store_id,evidence_id:r.evidence_id,case_id:r.case_id,
      resource_id:r.resource_id,sha256:r.sha256,source_created_at:r.source_created_at};
  }catch{throw invalid();}
}
/** Entries assert erasure observed by the checkpoint, not a fabricated erased_at. */
export function validateImageSuppression(value:unknown,observedAt:number):Image[] {
  if(!Array.isArray(value)||value.length>MAX_IMAGES)throw invalid();
  const seen=new Set<string>();
  return value.map(value=>{const r=image(value,observedAt),identity=key(r,r.evidence_id);
    if(seen.has(identity))throw invalid();seen.add(identity);return r;});
}
function merge(...lists:Image[][]):Image[] {
  const merged=new Map<string,Image>();
  for(const list of lists)for(const r of list){const identity=key(r,r.evidence_id),prior=merged.get(identity);
    if(prior&&canonical(prior)!==canonical(r))throw new Error('IMAGE_SUPPRESSION_CONFLICT');
    merged.set(identity,r);if(merged.size>MAX_IMAGES)throw invalid();}
  return [...merged.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,r])=>r);
}
function sourceImage(row:Row,observedAt:number){
  return image({tenant_id:row.tenant_id,store_id:row.store_id,evidence_id:row.id,case_id:row.case_id,
    resource_id:row.resource_id,sha256:row.sha256,source_created_at:row.created_at},observedAt);
}
function control(row:Row,observedAt:number):Image {
  try{
    if(typeof row.body!=='string'||Buffer.byteLength(row.body)>MAX_CONTROL_BYTES)throw invalid();
    const body=exact(jsonValue(JSON.parse(row.body)),['version','image']),r=image(body.image,observedAt);
    if(row.kind!=='image_suppression'||row.version!==1||body.version!==1||row.id!==r.evidence_id
      ||row.tenant_id!==r.tenant_id||row.store_id!==r.store_id||row.author!=='privacy_replay'
      ||!['recorded','revoked'].includes(row.state)||row.reviewer!==null||row.review_digest!==null||row.expires_at!==null
      ||typeof row.digest!=='string'||!/^[a-f0-9]{64}$/.test(row.digest)||contentDigest(body)!==row.digest)throw invalid();
    integer(row.created_at);if(row.created_at<r.source_created_at||row.created_at>observedAt)throw invalid();
    return r;
  }catch{throw invalid();}
}
function checkSources(images:Image[],sources:Row[],observedAt:number){
  const selected=new Map(images.map(r=>[key(r,r.evidence_id),r]));
  for(const source of sources){const selectedImage=selected.get(key(source as Store,source.id));
    if(selectedImage&&canonical(sourceImage(source,observedAt))!==canonical(selectedImage))throw new Error('IMAGE_SUPPRESSION_CONFLICT');}
}
function collect(sources:Row[],documents:Row[],hasReceipts:boolean,observedAt:number):State {
  if(sources.length>MAX_IMAGES||documents.length>MAX_IMAGES)throw invalid();
  const erased=sources.filter(row=>row.state==='erased').map(row=>{
    if(row.content_erased!==1)throw invalid();return sourceImage(row,observedAt);});
  const images=merge(erased,documents.map(row=>control(row,observedAt)));
  checkSources(images,sources,observedAt);
  return {required:sources.length>0||documents.length>0||hasReceipts,images,sources};
}
function current(k:CommerceKernel,observedAt:number,scope?:Store):State {
  const args=scope?[scope.tenant_id,scope.store_id]:[],where=scope?' WHERE tenant_id=? AND store_id=?':'';
  // Select only identity and erasure flags. Never materialize source bytes or
  // private notes/scanner text in a suppression checkpoint.
  const sources=k.db.prepare(`SELECT tenant_id,store_id,id,case_id,resource_id,sha256,created_at,state,
    (bytes IS NULL AND note='' AND scanner IS NULL) AS content_erased
    FROM commerce_return_evidence${where} LIMIT ${MAX_IMAGES+1}`).all(...args) as Row[];
  const documents=k.db.prepare(`SELECT * FROM commerce_support_documents WHERE kind='image_suppression'
    ${scope?'AND tenant_id=? AND store_id=?':''} LIMIT ${MAX_IMAGES+1}`).all(...args) as Row[];
  const receipt=k.db.prepare(`SELECT 1 FROM commerce_assistance_receipts WHERE
    (CASE WHEN json_valid(body) THEN json_extract(body,'$.kind') ELSE NULL END) IN (?,?,?)
    ${scope?'AND tenant_id=? AND store_id=?':''} LIMIT 1`).get(...IMAGE_RECEIPT_KINDS,...args);
  return collect(sources,documents,!!receipt,observedAt);
}
function portable(rows:Record<string,Row[]>,observedAt:number):State {
  const evidence=rows.commerce_return_evidence,documents=rows.commerce_support_documents.filter(r=>r.kind==='image_suppression');
  const sources=evidence.map(r=>({tenant_id:r.tenant_id,store_id:r.store_id,id:r.id,case_id:r.case_id,
    resource_id:r.resource_id,sha256:r.sha256,created_at:r.created_at,state:r.state,
    content_erased:r.bytes===null&&r.note===''&&r.scanner===null?1:0}));
  const hasReceipts=rows.commerce_assistance_receipts.some(r=>{
    try{return IMAGE_RECEIPT_KINDS.includes(JSON.parse(r.body).kind);}catch{return false;}});
  return collect(sources,documents,hasReceipts,observedAt);
}
export function imageSuppressionState(k:CommerceKernel,observedAt:number,scope?:Store){
  const state=current(k,observedAt,scope);return {required:state.required,images:state.images};
}
/** Internal preparation occurs in the caller's transaction before subject replay
 * can change source state. Original package records add denial, never authority. */
export function prepareImageSuppression(k:CommerceKernel,checkpoint:Row,scope?:Store,portableRows?:Record<string,Row[]>):Replay {
  const applied_at=k.clock(),state=current(k,applied_at,scope),original=portableRows?portable(portableRows,applied_at):undefined;
  if(checkpoint.version!==1&&checkpoint.version!==2)throw invalid();
  if(checkpoint.version===1&&(state.required||original?.required))throw new Error('IMAGE_SUPPRESSION_REQUIRED');
  const incoming=checkpoint.version===2?validateImageSuppression(checkpoint.images,checkpoint.generated_at):[];
  if(scope&&incoming.some(r=>r.tenant_id!==scope.tenant_id||r.store_id!==scope.store_id))throw invalid();
  const images=merge(state.images,original?.images??[],incoming);
  checkSources(images,state.sources,applied_at);if(original)checkSources(images,original.sources,applied_at);
  return {images,applied_at};
}
/** Caller owns the same synchronous transaction as preparation and subject replay.
 * A trusted source erasure supersedes a hold copied in the old snapshot. */
export function applyImageSuppression(k:CommerceKernel,replay:Replay){
  const groups=new Map<string,{scope:Store;ids:string[]}>();
  const clear=k.db.prepare("UPDATE commerce_return_evidence SET state='erased',bytes=NULL,note='',scanner=NULL WHERE tenant_id=? AND store_id=? AND id=? AND case_id=? AND resource_id=? AND sha256=? AND created_at=?");
  const retain=k.db.prepare("INSERT OR IGNORE INTO commerce_support_documents(tenant_id,store_id,kind,id,version,body,digest,author,state,reviewer,review_digest,created_at,expires_at) VALUES(?,?,'image_suppression',?,1,?,?,'privacy_replay','recorded',NULL,NULL,?,NULL)");
  for(const r of replay.images){
    clear.run(r.tenant_id,r.store_id,r.evidence_id,r.case_id,r.resource_id,r.sha256,r.source_created_at);
    const body={version:1,image:r};retain.run(r.tenant_id,r.store_id,r.evidence_id,canonical(body),contentDigest(body),replay.applied_at);
    const identity=JSON.stringify([r.tenant_id,r.store_id]),group=groups.get(identity)??{scope:r,ids:[]};
    group.ids.push(r.evidence_id);groups.set(identity,group);
  }
  for(const {scope,ids} of groups.values())eraseImageRecords(k,scope.tenant_id,scope.store_id,{evidence_ids:ids});
}
