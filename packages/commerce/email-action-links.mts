import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { exact,id,integer,token } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { ROLE_ACTIONS } from './authorization.mts';
import { assertRecoveryEgress } from './data-guards.mts';
import { assertExecution } from './execution-stops.mts';
import { growthBody,growthCustomer } from './growth-marketing-core.mts';
import { OrderEdits } from './order-edit-execution.mts';
import { safeOrder } from './order-edit-core.mts';

/** Links add explicit customer confirmation to an already reviewed canonical cancellation. */
export class EmailActionLinks {
  readonly k:CommerceKernel;readonly edits:OrderEdits;
  constructor(k:CommerceKernel,edits:OrderEdits){if(edits.kernel!==k)throw new Error('EMAIL_ACTION_BOUNDARY');this.k=k;this.edits=edits;}
  #edit(scope:Scope,editId:string){
    const s=this.k.require(scope),status=this.edits.status(scope,id(editId)),row=this.k.db.prepare('SELECT * FROM commerce_order_edits WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,editId) as Row;
    const quoteRow=this.k.db.prepare('SELECT * FROM commerce_edit_quotes WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,row.quote_id) as Row,quote=growthBody(quoteRow);
    if(status.action!=='cancel'||quote.action!=='cancel'||quote.resource_id!==status.resource_id)throw new Error('EMAIL_ACTION_UNSUPPORTED');
    return {s,status,row,quote,quote_digest:quoteRow.digest};
  }
  issue(scope:Scope,input:unknown){
    const p=exact(jsonValue(input),['edit_id','expires_at']);id(p.edit_id);integer(p.expires_at);
    return this.k.transaction(()=>{
      const k=this.k,ctx=this.#edit(scope,p.edit_id),s=k.authorize(scope,'action.execute',ctx.row.resource_id);k.authorize(scope,'operation.dispatch',ctx.row.resource_id);assertRecoveryEgress(k);assertExecution(k,s,'diagnostic.order.edit');
      if(p.expires_at<=k.clock()||p.expires_at>k.clock()+300000||p.expires_at>ctx.quote.expires_at||ctx.status.stages.length)throw new Error('EMAIL_ACTION_ISSUE_DENIED');
      const current=this.edits.source!.order(ctx.row.resource_id);
      if(current.version!==ctx.quote.source_order_version||contentDigest(safeOrder(current))!==ctx.quote.source_order_digest)throw new Error('EMAIL_ACTION_PREVIEW_CHANGED');
      const secret=token(),ref='email_action_'+contentDigest([s.tenant_id,s.store_id,p.edit_id,secret]).slice(0,40),body={id:ref,operation:'order.cancel',original_edit_id:p.edit_id,resource_id:ctx.row.resource_id,customer_id:ctx.quote.customer_id,quote_digest:ctx.quote_digest,source_identity:ctx.quote.source_identity,original_source_version:ctx.quote.source_order_version,original_source_digest:ctx.quote.source_order_digest,issuer_session_hash:s.token_hash,expires_at:p.expires_at,issued_at:k.clock(),customer_confirmed:false};
      k.db.prepare("INSERT INTO commerce_email_action_links VALUES(?,?,?,?,?,?,'issued',?,?,0)").run(s.tenant_id,s.store_id,ref,ctx.row.resource_id,ctx.quote.customer_id,contentDigest(secret),canonical(body),contentDigest(body));
      return {id:ref,token:secret,expires_at:p.expires_at,operation:'order.cancel',plain_email_fallback:'Open your merchant account and review the pending cancellation.',get_mutates:false,execution_authorized:false};
    });
  }
  #link(customer:Scope,secret:unknown){
    if(typeof secret!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(secret))throw new Error('EMAIL_CONFIRMATION_DENIED');
    const s=this.k.require(customer,['customer']),row=this.k.db.prepare('SELECT * FROM commerce_email_action_links WHERE tenant_id=? AND store_id=? AND token_hash=?').get(s.tenant_id,s.store_id,contentDigest(secret)) as Row,b=growthBody(row);
    if(row.revoked||b.expires_at<=this.k.clock())throw new Error('EMAIL_LINK_EXPIRED_OR_REVOKED');
    growthCustomer(this.k,customer,row.resource_id,row.customer_id);
    return {s,row,b};
  }
  #issuer(row:Row,b:Row,customer:Scope){return this.k.restrictedSession(b.issuer_session_hash,row.resource_id,ROLE_ACTIONS.operator,()=>{
    const committed=this.k.db.prepare("SELECT 1 FROM commerce_edit_steps WHERE tenant_id=? AND store_id=? AND edit_id=? AND stage='commit' AND state='confirmed'").get(row.tenant_id,row.store_id,b.original_edit_id);
    if(committed)return;
    const current=this.k.db.prepare('SELECT * FROM commerce_email_action_links WHERE tenant_id=? AND store_id=? AND id=?').get(row.tenant_id,row.store_id,row.id) as Row,value=growthBody(current);
    if(current.revoked||value.expires_at<=this.k.clock()||value.issuer_session_hash!==b.issuer_session_hash||value.original_edit_id!==b.original_edit_id)throw new Error('EMAIL_LINK_REVOKED');
    growthCustomer(this.k,customer,row.resource_id,row.customer_id);
  },{case_id:b.case_id??null});}
  preview(customer:Scope,secret:string){
    const {row,b}=this.#link(customer,secret),issuer=this.#issuer(row,b,customer),ctx=this.#edit(issuer,b.original_edit_id);
    if(ctx.quote_digest!==b.quote_digest||ctx.quote.source_identity!==b.source_identity)throw new Error('EMAIL_ACTION_PREVIEW_CHANGED');
    const source=this.edits.source!.order(row.resource_id);
    if(!b.customer_confirmed&&(source.version!==b.original_source_version||contentDigest(safeOrder(source))!==b.original_source_digest))throw new Error('EMAIL_ACTION_PREVIEW_CHANGED');
    const value={operation:'order.cancel',original_edit_id:b.original_edit_id,resource_id:row.resource_id,currency:ctx.quote.currency,refund_minor:ctx.quote.financial_obligation==='refund'?ctx.quote.amount_minor:'0',original_source_version:b.original_source_version,original_source_digest:b.original_source_digest,quote_digest:b.quote_digest,expires_at:b.expires_at};
    return {...value,digest:contentDigest(value),requires_authenticated_confirmation:true,financial_settlement_claim:false};
  }
  async confirm(customer:Scope,input:unknown){
    const p=exact(jsonValue(input),['token','preview_digest','confirmed']);if(p.confirmed!==true)throw new Error('CUSTOMER_CONFIRMATION_REQUIRED');
    const ctx=this.#link(customer,p.token),issuer=this.#issuer(ctx.row,ctx.b,customer);
    // A repeated request reports the original operation. Unknown work is repaired
    // by the existing operator lookup path, never by issuing another cancellation.
    if(ctx.b.customer_confirmed)return {link_id:ctx.row.id,duplicate:true,operation:this.edits.status(issuer,ctx.b.original_edit_id),customer_confirmed:true};
    this.k.transaction(()=>{
      const fresh=this.#link(customer,p.token),preview=this.preview(customer,p.token);
      if(preview.digest!==p.preview_digest)throw new Error('EMAIL_ACTION_PREVIEW_CHANGED');
      this.k.authorize(issuer,'operation.dispatch',fresh.row.resource_id);assertRecoveryEgress(this.k);assertExecution(this.k,this.k.require(issuer),'diagnostic.order.edit');
      const b={...fresh.b,customer_confirmed:true,confirmed_at:this.k.clock(),confirmation_digest:preview.digest};
      this.k.db.prepare("UPDATE commerce_email_action_links SET state='confirmed',body=?,digest=? WHERE tenant_id=? AND store_id=? AND id=?").run(canonical(b),contentDigest(b),fresh.s.tenant_id,fresh.s.store_id,fresh.row.id);
    });
    const operation=await this.edits.dispatch(issuer,ctx.b.original_edit_id);
    return {link_id:ctx.row.id,duplicate:false,operation,customer_confirmed:true,financial_settlement_claim:false};
  }
}

function readonlyResponse(method:string){return new Response(method==='HEAD'?null:'<!doctype html><html lang="en"><title>Review your order</title><p>Open your merchant account and review the pending cancellation. Opening this link does not change your order.</p></html>',{status:200,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; frame-ancestors 'none'",'referrer-policy':'no-referrer'}});}
/** An executable HTTP boundary; preview, prefetch and scanners never touch link state. */
export function emailActionHandler(links:EmailActionLinks){return async (request:Request):Promise<Response>=>{
  if(new URL(request.url).pathname!=='/email-action')return new Response(null,{status:404});
  if(request.method==='GET'||request.method==='HEAD')return readonlyResponse(request.method);
  if(request.method!=='POST')return new Response(null,{status:405,headers:{allow:'GET, HEAD, POST'}});
  try{
    const authorization=request.headers.get('authorization');if(!authorization?.startsWith('Bearer '))throw new Error('AUTHENTICATION_REQUIRED');
    const raw=await request.text();if(Buffer.byteLength(raw)>4096)throw new Error('EMAIL_CONFIRMATION_DENIED');
    const p=exact(jsonValue(JSON.parse(raw)),['intent','token','preview_digest','confirmed']),customer=links.k.authenticate(authorization.slice(7));
    if(p.intent!=='confirm'||p.confirmed!==true)throw new Error('EMAIL_CONFIRMATION_DENIED');
    const response=await links.confirm(customer,{token:p.token,preview_digest:p.preview_digest,confirmed:p.confirmed});
    return Response.json(response,{status:200,headers:{'cache-control':'no-store'}});
  }catch{return Response.json({error:'EMAIL_CONFIRMATION_DENIED'},{status:403,headers:{'cache-control':'no-store'}});}
};}
