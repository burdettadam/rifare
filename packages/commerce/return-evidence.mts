import { createHmac,randomBytes,timingSafeEqual } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { exact,id,integer,digest,token } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { CaseConfigurations } from './case-configurations.mts';
import { contentDigest,jsonValue } from './configuration-values.mts';
import { subjectHash } from './data-guards.mts';
import { eraseImageRecords } from './image-privacy.mts';

export const MAX_EVIDENCE_BYTES=262144;
export type EvidenceScanner={identity:string;scan:(bytes:Buffer)=>Promise<{verdict:'clean'|'rejected'|'unavailable';sha256:string}>};
function crc32(bytes:Buffer){let c=0xffffffff;for(const byte of bytes){c^=byte;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
export function validateEvidencePng(bytes:Buffer){
 if(bytes.length>MAX_EVIDENCE_BYTES||bytes.length<57||!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))throw new Error('EVIDENCE_TYPE_REJECTED');
 let offset=8,width=0,height=0,channels=0,ended=false;const chunks:Buffer[]=[];let seenData=false;
 while(offset<bytes.length){
  if(offset+12>bytes.length)throw new Error('EVIDENCE_TYPE_REJECTED');const length=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8),end=offset+12+length;
  if(end>bytes.length||length>MAX_EVIDENCE_BYTES||crc32(bytes.subarray(offset+4,end-4))!==bytes.readUInt32BE(end-4))throw new Error('EVIDENCE_TYPE_REJECTED');
  const data=bytes.subarray(offset+8,end-4);
  if(offset===8){if(type!=='IHDR'||length!==13)throw new Error('EVIDENCE_TYPE_REJECTED');width=data.readUInt32BE(0);height=data.readUInt32BE(4);channels=data[9]===2?3:data[9]===6?4:0;
   if(!width||!height||width*height>4000000||!channels||data[8]!==8||data[10]!==0||data[11]!==0||data[12]!==0)throw new Error('EVIDENCE_DECOMPRESSION_LIMIT');}
  else if(type==='IDAT'){seenData=true;chunks.push(data);}
  else if(type==='IEND'&&length===0&&seenData&&end===bytes.length){ended=true;offset=end;break;}
  else throw new Error('EVIDENCE_TYPE_REJECTED');
  offset=end;
 }
 if(!ended)throw new Error('EVIDENCE_TYPE_REJECTED');
 const expected=(width*channels+1)*height;let expanded:Buffer;
 let consumed:number;const compressed=Buffer.concat(chunks);
 try{const result=inflateSync(compressed,{maxOutputLength:Math.min(expected+1,16000001),info:true});expanded=result.buffer;consumed=result.engine.bytesWritten;}catch{throw new Error('EVIDENCE_DECOMPRESSION_LIMIT');}
 if(consumed!==compressed.length)throw new Error('EVIDENCE_TYPE_REJECTED');
 if(expanded.length!==expected)throw new Error('EVIDENCE_TYPE_REJECTED');
 for(let row=0;row<height;row++)if(expanded[row*(width*channels+1)]>4)throw new Error('EVIDENCE_TYPE_REJECTED');
 return {width,height,mime:'image/png',metadata_removed_by_rejection:true};
}
export function evidenceRows(k:CommerceKernel,s:Row,caseId:string,ids:string[]) {
 return ids.map(ref=>{
  const r=k.db.prepare('SELECT * FROM commerce_return_evidence WHERE tenant_id=? AND store_id=? AND id=? AND case_id=?').get(s.tenant_id,s.store_id,id(ref),caseId) as Row;
  if(!r||r.state==='erased'||r.expires_at<=k.clock())throw new Error('EVIDENCE_UNAVAILABLE');
  if(!r.bytes||digest(Buffer.from(r.bytes))!==r.sha256)throw new Error('EVIDENCE_INTEGRITY');
  return {id:r.id,sha256:r.sha256,state:r.state,scanner:r.scanner,expires_at:r.expires_at};
 });
}
export class ReturnEvidence {
 #k:CommerceKernel;#cases:CaseConfigurations;#scanner:EvidenceScanner|null;#key:Buffer;
 constructor(k:CommerceKernel,scanner:EvidenceScanner|null=null,key:Buffer=randomBytes(32)) {
  if(key.length!==32||scanner&&(!/^[A-Za-z0-9_.:-]{1,96}$/.test(scanner.identity)||typeof scanner.scan!=='function'))throw new Error('INVALID_INPUT');
  this.#k=k;this.#cases=new CaseConfigurations(k);this.#scanner=scanner;this.#key=Buffer.from(key);
 }
 upload(scope:Scope,input:unknown) {
  const k=this.#k,p=exact(jsonValue(input,400000),['case_id','mime','base64','note']);id(p.case_id);
  if(p.mime!=='image/png'||typeof p.base64!=='string'||p.base64.length>349528||typeof p.note!=='string'||Buffer.byteLength(p.note)>2000)throw new Error('EVIDENCE_TYPE_REJECTED');
  const bytes=Buffer.from(p.base64,'base64');if(bytes.toString('base64')!==p.base64)throw new Error('INVALID_INPUT');validateEvidencePng(bytes);
  return k.transaction(()=>{
   const c=this.#cases.inspect(scope,p.case_id),s=k.authorize(scope,'return.evidence',c.resource_id);this.#cases.verified(scope,c.id);
   const settings=k.db.prepare('SELECT body FROM commerce_return_settings WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row;
   if(!settings)throw new Error('RETURN_NOT_CONFIGURED');
   const count=k.db.prepare("SELECT count(*) n FROM commerce_return_evidence WHERE tenant_id=? AND store_id=? AND case_id=? AND state!='erased'").get(s.tenant_id,s.store_id,c.id) as Row;
   if(count.n>=8)throw new Error('EVIDENCE_LIMIT');const ref='ev_'+token().slice(0,32),expires=k.clock()+JSON.parse(settings.body).retention_days*86400000;
   k.db.prepare("INSERT INTO commerce_return_evidence VALUES(?,?,?,?,?,?,'quarantined',?,?,?,?,NULL,?,?)").run(s.tenant_id,s.store_id,ref,c.id,c.resource_id,s.actor_id,bytes,digest(bytes),p.mime,p.note,k.clock(),expires);
   return {id:ref,case_id:c.id,status:'quarantined',sha256:digest(bytes),expires_at:expires,model_access:false};
  });
 }
 inspect(scope:Scope,ref:string) {
  const k=this.#k,s=k.require(scope),r=k.db.prepare('SELECT * FROM commerce_return_evidence WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(ref)) as Row;
  if(!r)throw new Error('NOT_FOUND');this.#cases.inspect(scope,r.case_id);k.authorize(scope,'return.read',r.resource_id);
  return {id:r.id,case_id:r.case_id,state:r.expires_at<=k.clock()?'expired':r.state,sha256:r.sha256,expires_at:r.expires_at,scanner:r.scanner,model_access:false};
 }
 async scan(scope:Scope,ref:string) {
  const k=this.#k,s=k.require(scope),info=this.inspect(scope,ref);k.authorize(scope,'return.review',this.#cases.inspect(scope,info.case_id).resource_id);
  if(info.state!=='quarantined')throw new Error('EVIDENCE_UNAVAILABLE');
  const r=k.db.prepare('SELECT bytes FROM commerce_return_evidence WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,ref) as Row;
  if(!this.#scanner)return {...info,scanner_available:false};
  let result:Awaited<ReturnType<EvidenceScanner['scan']>>;let timer:ReturnType<typeof setTimeout>|undefined;
  try{result=await Promise.race([this.#scanner.scan(Buffer.from(r.bytes)),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('EVIDENCE_SCAN_TIMEOUT')),2000);})]);}catch{return {...this.inspect(scope,ref),scanner_available:false};}finally{clearTimeout(timer);}
  return k.transaction(()=>{
   const current=this.inspect(scope,ref);k.authorize(scope,'return.review',this.#cases.inspect(scope,info.case_id).resource_id);
   if(current.state!=='quarantined'||current.sha256!==info.sha256)throw new Error('EVIDENCE_CHANGED');
   if(!result||result.sha256!==info.sha256||!['clean','rejected','unavailable'].includes(result.verdict))throw new Error('EVIDENCE_SCAN_INVALID');
   if(result.verdict==='unavailable')return {...current,scanner_available:false};
   k.db.prepare('UPDATE commerce_return_evidence SET state=?,scanner=? WHERE tenant_id=? AND store_id=? AND id=?').run(result.verdict,this.#scanner!.identity,s.tenant_id,s.store_id,ref);
   return this.inspect(scope,ref);
  });
 }
 sign(scope:Scope,ref:string) {
  const info=this.inspect(scope,ref),s=this.#k.require(scope);if(info.state!=='clean')throw new Error('EVIDENCE_UNAVAILABLE');
  const payload=Buffer.from(JSON.stringify({id:ref,session:s.token_hash,sha256:info.sha256,expires_at:Math.min(this.#k.clock()+60000,info.expires_at)})).toString('base64url');
  const signature=createHmac('sha256',this.#key).update(payload).digest('base64url');
  return {id:ref,token:payload+'.'+signature,expires_at:Math.min(this.#k.clock()+60000,info.expires_at),disposition:'attachment',model_access:false};
 }
 content(scope:Scope,ref:string,grant:unknown) {
  if(typeof grant!=='string'||grant.length>1024)throw new Error('EVIDENCE_ACCESS_DENIED');
  const [payload,sig,...extra]=grant.split('.');const expected=createHmac('sha256',this.#key).update(payload??'').digest();const actual=Buffer.from(sig??'','base64url');
  if(extra.length||actual.length!==expected.length||!timingSafeEqual(actual,expected))throw new Error('EVIDENCE_ACCESS_DENIED');
  let p:Row;try{p=JSON.parse(Buffer.from(payload,'base64url').toString());}catch{throw new Error('EVIDENCE_ACCESS_DENIED');}
  const s=this.#k.require(scope),info=this.inspect(scope,ref);
  if(p.id!==ref||p.session!==s.token_hash||p.sha256!==info.sha256||!Number.isSafeInteger(p.expires_at)||p.expires_at<=this.#k.clock()||info.state!=='clean')throw new Error('EVIDENCE_ACCESS_DENIED');
  const row=this.#k.db.prepare('SELECT bytes FROM commerce_return_evidence WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,ref) as Row;
  if(!row.bytes||digest(Buffer.from(row.bytes))!==info.sha256)throw new Error('EVIDENCE_INTEGRITY');
  return Buffer.from(row.bytes);
 }
 #held(s:Row,caseId:string){const k=this.#k,c=k.db.prepare('SELECT customer_id FROM commerce_cases WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,caseId) as Row;
  if(!c)throw new Error('EVIDENCE_INTEGRITY');
  const gift=k.db.prepare('SELECT body,digest FROM commerce_gift_cases WHERE tenant_id=? AND store_id=? AND case_id=?').get(s.tenant_id,s.store_id,caseId) as Row;
  const recipient=gift?JSON.parse(gift.body):null;if(gift&&contentDigest(recipient)!==gift.digest)throw new Error('EVIDENCE_INTEGRITY');
  return [c.customer_id,recipient?.recipient_customer_id].filter(Boolean).some(customer=>!!k.db.prepare('SELECT 1 FROM commerce_privacy_holds WHERE tenant_id=? AND store_id=? AND subject_hash=? AND released=0 AND expires_at>?').get(s.tenant_id,s.store_id,subjectHash(s.tenant_id,s.store_id,customer),k.clock()));}
 purgeExpired(scope:Scope,after:string|null=null){const k=this.#k;if(after!==null)id(after);return k.transaction(()=>{const s=k.authorize(scope,'privacy.manage');
  const rows=k.db.prepare("SELECT id,case_id FROM commerce_return_evidence WHERE tenant_id=? AND store_id=? AND expires_at<=? AND state!='erased' AND id>? ORDER BY id LIMIT 100").all(s.tenant_id,s.store_id,k.clock(),after??'') as Row[];let erased=0,held=0;
  for(const row of rows){if(this.#held(s,row.case_id)){held++;continue;}eraseImageRecords(k,s.tenant_id,s.store_id,{evidence_ids:[row.id]});k.db.prepare("UPDATE commerce_return_evidence SET state='erased',bytes=NULL,note='',scanner=NULL WHERE tenant_id=? AND store_id=? AND id=?").run(s.tenant_id,s.store_id,row.id);erased++;}
  return {erased,batch_limit:100,physical_erasure:false,...(held?{held}:{}),...(rows.length===100?{next_cursor:rows.at(-1)!.id}:{})};});}
 erase(scope:Scope,ref:string){const k=this.#k;return k.transaction(()=>{const info=this.inspect(scope,ref),s=k.authorize(scope,'return.evidence',this.#cases.inspect(scope,info.case_id).resource_id);
  if(this.#held(s,info.case_id))return {erased:false,held:true,physical_erasure:false};
  eraseImageRecords(k,s.tenant_id,s.store_id,{evidence_ids:[ref]});
  k.db.prepare("UPDATE commerce_return_evidence SET state='erased',bytes=NULL,note='',scanner=NULL WHERE tenant_id=? AND store_id=? AND id=?").run(s.tenant_id,s.store_id,ref);return {erased:true,physical_erasure:false};});}
}
