import { exact,id,integer,token } from './kernel.mts';
import type { CommerceKernel,Row,Scope } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { money } from './money.mts';
import { permissionDecision } from './authorization.mts';
import { assertExecution } from './execution-stops.mts';
import { assertRecoveryEgress } from './data-guards.mts';
import { CarrierQuotes } from './carrier-quotes.mts';
import { ShippingCarrierFixtureSource } from '../adapters/shipping-carrier-fixture-source.mts';

const RECEIPT_FIELDS=['version','purchase_id','source_identity','tenant_id','store_id','resource_id','package_id','command_digest','native_label_id','native_charge_id','native_tracking_ref',
  'amount_minor','currency','source_revision','created_at','valid_until','void_operation_id','void_state','refund_state','refund_amount_minor','native_refund_id','qualification'];
const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
function resourceDigest(r:Row){return contentDigest({id:r.id,kind:r.kind,source_system:r.source_system,external_id:r.external_id,source_version:r.source_version,source_updated_at:r.source_updated_at,payload:r.payload});}
export function assertShippingSource(k:CommerceKernel,source:ShippingCarrierFixtureSource,s?:Row){
  const file=(db:CommerceKernel['db'])=>db.prepare('PRAGMA database_list').all().find((r:Row)=>r.name==='main')?.file;
  if(!(source instanceof ShippingCarrierFixtureSource)||source.db===k.db||file(k.db)&&file(k.db)===file(source.db))throw new Error('SEPARATE_SYNTHETIC_SOURCE_REQUIRED');
  if(s&&(source.tenant_id!==s.tenant_id||source.store_id!==s.store_id))throw new Error('SOURCE_SCOPE_MISMATCH');
}
export function shippingBody(row:Row):Row {let b:Row;try{b=JSON.parse(row.body);}catch{throw new Error('SHIPPING_INTEGRITY');}
  if(b.redacted||contentDigest(b)!==row.digest||b.tenant_id!==row.tenant_id||b.store_id!==row.store_id||b.resource_id!==row.resource_id||b.package_id!==row.package_id)throw new Error('SHIPPING_INTEGRITY');return b;}

/** Outbound package operations. Returning to this service never recreates an uncertain purchase. */
export class ShippingBatchLabels {
  #k:CommerceKernel;#quotes:CarrierQuotes;#source:ShippingCarrierFixtureSource;#deadline:number;
  constructor(k:CommerceKernel,quotes:CarrierQuotes,source:ShippingCarrierFixtureSource,options:{deadline_ms?:number}={}){
    if(!(quotes instanceof CarrierQuotes)||Object.keys(options).some(key=>key!=='deadline_ms'))throw new Error('INVALID_INPUT');
    this.#deadline=integer(options.deadline_ms??1000,5);if(this.#deadline>30000)throw new Error('INVALID_INPUT');assertShippingSource(k,source);
    this.#k=k;this.#quotes=quotes;this.#source=source;
  }
  get source_identity(){return this.#source.identity;}
  #scope(scope:Scope){const s=this.#k.require(scope);assertShippingSource(this.#k,this.#source,s);return s;}
  #requests(snapshot:unknown){const b=jsonValue(snapshot);id(b.batch_id);
    if(!Array.isArray(b.packages)||!b.packages.length||b.packages.length>32)throw new Error('INVALID_BATCH');const seen=new Set();
    for(const p of b.packages){id(p.package_id);id(p.resource_id);if(seen.has(p.package_id))throw new Error('DUPLICATE_PACKAGE');seen.add(p.package_id);}return b;
  }
  #operation(scope:Scope,packageId:string,action='operation.read',optional=false):Row|null {
    const s=this.#scope(scope),k=this.#k,row=k.db.prepare('SELECT * FROM commerce_shipping_label_operations WHERE tenant_id=? AND store_id=? AND package_id=?').get(s.tenant_id,s.store_id,id(packageId)) as Row;
    if(!row){if(optional)return null;throw new Error('NOT_FOUND');}k.authorize(scope,action,row.resource_id);k.get(scope,row.resource_id);
    const b=shippingBody(row);if(b.purchase_id!==row.purchase_id||contentDigest(b.command)!==b.command_digest||b.command.purchase_id!==row.purchase_id||b.command.package_id!==row.package_id||b.command.resource_id!==row.resource_id
      ||b.command.tenant_id!==row.tenant_id||b.command.store_id!==row.store_id||b.command.quote.package_id!==row.package_id||b.command.quote.resource_id!==row.resource_id)throw new Error('SHIPPING_INTEGRITY');
    if(b.source_identity!==this.#source.identity||b.command.source_identity!==this.#source.identity)throw new Error('SOURCE_IDENTITY_CHANGED');return b;
  }
  #save(op:Row){this.#k.db.prepare('UPDATE commerce_shipping_label_operations SET body=?,digest=? WHERE tenant_id=? AND store_id=? AND package_id=? AND purchase_id=?')
    .run(canonical(op),contentDigest(op),op.tenant_id,op.store_id,op.package_id,op.purchase_id);}
  #command(s:Row,p:Row,purchaseId:string){return {version:1,kind:'outbound_label',tenant_id:s.tenant_id,store_id:s.store_id,resource_id:p.resource_id,package_id:p.package_id,purchase_id:purchaseId,
    source_identity:this.#source.identity,quote_source_identity:p.quote.source_identity,quote:p.quote};}
  #revoke(op:Row,kind:'purchase'|'void'){const aid=kind==='purchase'?op.approval_id:op.void?.approval_id;
    if(aid)this.#k.db.prepare('UPDATE commerce_shipping_label_approvals SET revoked=1 WHERE tenant_id=? AND store_id=? AND id=?').run(op.tenant_id,op.store_id,aid);}
  prepare(scope:Scope,snapshot:unknown){const request=this.#requests(snapshot),k=this.#k,s=this.#scope(scope),checked=this.#quotes.revalidate(scope,snapshot);
    return k.transaction(()=>{const packages=checked.packages.map((p:Row)=>{
      const old=this.#operation(scope,p.package_id,'action.propose',true);
      if(old&&old.resource_id!==p.resource_id)throw new Error('PACKAGE_RESOURCE_MISMATCH');
      if(old&&old.state!=='proposed')return this.packageStatus(scope,p.package_id);
      if(p.status!=='eligible')return {package_id:p.package_id,resource_id:p.resource_id,state:'blocked',blocked_reasons:p.reasons,execution_authorized:false};
      k.authorize(scope,'action.propose',p.resource_id);const control=assertExecution(k,s,'diagnostic.label.purchase');
      const purchaseId=old?.purchase_id??'buy_'+token().slice(0,32),command=this.#command(s,p,purchaseId),hash=contentDigest(command);
      if(old&&old.command_digest===hash&&old.control_stamp===control.stamp)return this.packageStatus(scope,p.package_id);
      if(old)this.#revoke(old,'purchase');
      const op={version:1,tenant_id:s.tenant_id,store_id:s.store_id,resource_id:p.resource_id,package_id:p.package_id,purchase_id:purchaseId,source_identity:this.#source.identity,
        command,command_digest:hash,proposer:s.actor_id,created_at:k.clock(),state:'proposed',approval_id:null,control_stamp:control.stamp,receipt:null,void:null};
      if(old)this.#save(op);else k.db.prepare('INSERT INTO commerce_shipping_label_operations VALUES(?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,p.resource_id,p.package_id,purchaseId,canonical(op),contentDigest(op));
      k.audit(scope,'shipping_label_proposed','allowed');return this.packageStatus(scope,p.package_id);
    });return {batch_id:request.batch_id,packages,qualification:'synthetic_only',financial_effect:false,formal_goal_accepted:false};});
  }
  #approve(scope:Scope,op:Row,kind:'purchase'|'void',expiresAt:number){const k=this.#k,s=k.authorize(scope,'action.approve',op.resource_id);
    if(!['owner','reviewer'].includes(s.role))throw new Error('HUMAN_REVIEWER_REQUIRED');if(s.actor_id===op.proposer)throw new Error('SELF_APPROVAL_DENIED');
    integer(expiresAt);if(expiresAt<=k.clock()||expiresAt>Math.min(k.clock()+300000,kind==='purchase'?op.command.quote.expires_at:Number.MAX_SAFE_INTEGER))throw new Error('APPROVAL_EXPIRY_INVALID');
    const action=kind==='purchase'?'diagnostic.label.purchase':'diagnostic.label.void',control=assertExecution(k,s,action,kind==='purchase'?op.control_stamp:undefined);
    const commandDigest=kind==='purchase'?op.command_digest:contentDigest(op.void.command);this.#revoke(op,kind);
    const body={id:'shipping_approval_'+token().slice(0,32),tenant_id:s.tenant_id,store_id:s.store_id,resource_id:op.resource_id,package_id:op.package_id,kind,command_digest:commandDigest,
      approver:s.actor_id,authority_revision:permissionDecision(k.db,s,'action.approve',op.resource_id).authority_revision,expires_at:expiresAt,control_stamp:control.stamp,created_at:k.clock(),used:false};
    k.db.prepare('INSERT INTO commerce_shipping_label_approvals VALUES(?,?,?,?,?,?,?,0)').run(s.tenant_id,s.store_id,op.resource_id,op.package_id,body.id,canonical(body),contentDigest(body));
    if(kind==='purchase')op.approval_id=body.id;else{op.void.approval_id=body.id;op.void.control_stamp=control.stamp;}this.#save(op);k.audit(scope,'shipping_label_approved','allowed');
    return {id:body.id,package_id:op.package_id,kind,command_digest:commandDigest,expires_at:expiresAt,qualification:'synthetic_only',financial_effect:false};
  }
  approve(scope:Scope,packageId:string,input:unknown){const p=exact(jsonValue(input),['expected_digest','expires_at']);return this.#k.transaction(()=>{
    const op=this.#operation(scope,packageId)!;if(op.state!=='proposed'||p.expected_digest!==op.command_digest)throw new Error('PROPOSAL_CHANGED');return this.#approve(scope,op,'purchase',p.expires_at);});}
  approveVoid(scope:Scope,packageId:string,input:unknown){const p=exact(jsonValue(input),['expected_receipt_digest','expires_at']);return this.#k.transaction(()=>{
    const op=this.#operation(scope,packageId)!;if(op.state!=='purchased'||!op.receipt||p.expected_receipt_digest!==contentDigest(op.receipt)||op.receipt.void_state!=='not_requested'||op.void&&op.void.state!=='proposed')throw new Error('VOID_UNAVAILABLE');
    const command={version:1,kind:'outbound_void',tenant_id:op.tenant_id,store_id:op.store_id,source_identity:this.#source.identity,resource_id:op.resource_id,package_id:op.package_id,purchase_id:op.purchase_id,
      void_id:op.void?.command.void_id??'void_'+token().slice(0,32),native_label_id:op.receipt.native_label_id,native_charge_id:op.receipt.native_charge_id};
    op.void={command,approval_id:op.void?.approval_id??null,state:'proposed',control_stamp:null};return this.#approve(scope,op,'void',p.expires_at);});}
  revokeApproval(scope:Scope,packageId:string){return this.#k.transaction(()=>{const op=this.#operation(scope,packageId)!;this.#k.authorize(scope,'action.approve',op.resource_id);
    this.#revoke(op,'purchase');this.#revoke(op,'void');this.#k.audit(scope,'shipping_approval_revoked','allowed');return {revoked:true};});}
  #approval(op:Row,kind:'purchase'|'void',used:boolean){const k=this.#k,aid=kind==='purchase'?op.approval_id:op.void?.approval_id;
    const row=aid&&k.db.prepare('SELECT * FROM commerce_shipping_label_approvals WHERE tenant_id=? AND store_id=? AND id=?').get(op.tenant_id,op.store_id,aid) as Row;
    if(!row||row.revoked)throw new Error('APPROVAL_REQUIRED');const a=shippingBody(row),expected=kind==='purchase'?op.command_digest:contentDigest(op.void.command);
    if(a.kind!==kind||a.command_digest!==expected||a.package_id!==op.package_id||a.resource_id!==op.resource_id||a.used!==used||a.expires_at<=k.clock())throw new Error('APPROVAL_REQUIRED');
    const member=k.db.prepare('SELECT * FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND active=1').get(op.tenant_id,op.store_id,a.approver) as Row;
    const decision=member&&permissionDecision(k.db,member,'action.approve',op.resource_id);
    if(!member||!['owner','reviewer'].includes(member.role)||!decision?.allowed||decision.authority_revision!==a.authority_revision||a.approver===op.proposer)throw new Error('APPROVAL_AUTHORITY_CHANGED');return a;
  }
  #before(scope:Scope,op:Row,kind:'purchase'|'void',used:boolean){const k=this.#k,s=this.#scope(scope);k.authorize(scope,'action.execute',op.resource_id);k.authorize(scope,'operation.dispatch',op.resource_id);k.get(scope,op.resource_id);
    assertRecoveryEgress(k);const a=this.#approval(op,kind,used);assertExecution(k,s,kind==='purchase'?'diagnostic.label.purchase':'diagnostic.label.void',a.control_stamp);
    if(kind==='purchase'&&a.control_stamp!==op.control_stamp)throw new Error('EXECUTION_REAUTHORIZATION_REQUIRED');return a;
  }
  #consume(a:Row){a.used=true;this.#k.db.prepare('UPDATE commerce_shipping_label_approvals SET body=?,digest=? WHERE tenant_id=? AND store_id=? AND id=? AND revoked=0')
    .run(canonical(a),contentDigest(a),a.tenant_id,a.store_id,a.id);}
  async #bounded<T>(fn:()=>Promise<T>){let timer:ReturnType<typeof setTimeout>|undefined;
    try{return await Promise.race([Promise.resolve().then(fn),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('SHIPPING_SOURCE_TIMEOUT')),this.#deadline);})]);}
    finally{if(timer)clearTimeout(timer);}}
  #record(op:Row,value:unknown){const r=exact(jsonValue(value),RECEIPT_FIELDS),q=op.command.quote,k=this.#k;
    if(r.version!==1||r.qualification!=='synthetic_only'||r.command_digest!==op.command_digest)throw new Error('RECEIPT_MISMATCH');
    for(const key of ['purchase_id','source_identity','tenant_id','store_id','resource_id','package_id'])if(r[key]!==op[key])throw new Error('RECEIPT_MISMATCH');
    for(const key of ['native_label_id','native_charge_id','native_tracking_ref'])id(r[key]);integer(r.source_revision,1);integer(r.created_at);integer(r.valid_until);money(r.currency,r.amount_minor);money(r.currency,r.refund_amount_minor);
    if(r.amount_minor!==q.amount_minor||r.currency!==q.currency||r.created_at>k.clock()||r.valid_until<=r.created_at)throw new Error('RECEIPT_MISMATCH');
    if(!['not_requested','requested','confirmed','rejected'].includes(r.void_state)||!['not_requested','pending','refunded','rejected'].includes(r.refund_state))throw new Error('RECEIPT_MISMATCH');
    if(r.void_state==='not_requested'){if(r.void_operation_id!==null||r.refund_state!=='not_requested')throw new Error('VOID_RECEIPT_MISMATCH');}
    else if(!op.void||r.void_operation_id!==op.void.command.void_id)throw new Error('VOID_RECEIPT_MISMATCH');
    if(r.refund_state==='refunded'){if(r.void_state!=='confirmed'||r.refund_amount_minor!==q.amount_minor)throw new Error('REFUND_UNCONFIRMED');id(r.native_refund_id);}
    else if(r.refund_amount_minor!=='0'||r.native_refund_id!==null)throw new Error('REFUND_UNCONFIRMED');
    if(r.void_state==='requested'&&r.refund_state!=='pending'||r.void_state==='confirmed'&&!['pending','refunded'].includes(r.refund_state)||r.void_state==='rejected'&&r.refund_state!=='rejected')throw new Error('REFUND_UNCONFIRMED');
    const old=op.receipt;if(old){
      for(const key of ['native_label_id','native_charge_id','native_tracking_ref','created_at','valid_until'])if(old[key]!==r[key])throw new Error('RECEIPT_MISMATCH');
      if(r.source_revision<old.source_revision)return;if(r.source_revision===old.source_revision){if(!same(old,r))throw new Error('SOURCE_VERSION_CONFLICT');return;}
      const allowed:Row={not_requested:['not_requested','requested','confirmed','rejected'],requested:['requested','confirmed','rejected'],confirmed:['confirmed'],rejected:['rejected']};
      if(!allowed[old.void_state].includes(r.void_state)||old.refund_state==='refunded'&&(r.refund_state!=='refunded'||r.native_refund_id!==old.native_refund_id))throw new Error('LABEL_STATE_REGRESSION');
    }
    op.receipt=r;op.state='purchased';if(op.void&&r.void_operation_id===op.void.command.void_id)op.void.state=r.void_state;this.#save(op);
  }
  async purchase(scope:Scope,snapshot:unknown){const request=this.#requests(snapshot),k=this.#k;this.#scope(scope);
    const operations=request.packages.map((p:Row)=>{const op=this.#operation(scope,p.package_id);if(op!.resource_id!==p.resource_id)throw new Error('PACKAGE_RESOURCE_MISMATCH');return op!;});
    const hasUnsent=operations.some((op:Row)=>op.state==='proposed');
    // Old sealed snapshots only route already durable observations after restart.
    // A new outbound effect always requires this instance's fresh G01 validation.
    const checked=hasUnsent?this.#quotes.revalidate(scope,snapshot):null,blocked=new Map<string,string[]>();
    for(const op of operations.filter((p:Row)=>p.state==='proposed')){
      const p=checked!.packages.find((p:Row)=>p.package_id===op.package_id);
      if(p.status!=='eligible'){blocked.set(op.package_id,p.reasons);continue;}
      if(contentDigest(this.#command(op,p,op.purchase_id))!==op.command_digest){blocked.set(op.package_id,['APPROVED_QUOTE_CHANGED']);continue;}
      this.#before(scope,op,'purchase',false);
    }
    for(const original of operations){if(original.state==='unknown'){await this.reconcile(scope,original.package_id);continue;}
      if(original.state!=='proposed'||blocked.has(original.package_id))continue;
      const op=k.transaction(()=>{const current=this.#operation(scope,original.package_id,'operation.dispatch')!;if(current.state!=='proposed')return null;
        const a=this.#before(scope,current,'purchase',false);this.#consume(a);current.state='unknown';this.#save(current);k.audit(scope,'shipping_purchase_unknown','allowed');return current;});
      if(!op)continue;
      try{const result=await this.#bounded(()=>{const current=this.#operation(scope,op.package_id,'operation.dispatch')!;this.#before(scope,current,'purchase',true);
          const p=this.#quotes.revalidate(scope,snapshot).packages.find((p:Row)=>p.package_id===op.package_id);
          if(p.status!=='eligible'||contentDigest(this.#command(current,p,current.purchase_id))!==current.command_digest)throw new Error('QUOTE_CHANGED');return this.#source.purchase(current.command);});
        k.transaction(()=>{const current=this.#operation(scope,op.package_id,'operation.dispatch')!;this.#record(current,result);k.audit(scope,'shipping_label_observed','allowed');});
      }catch{/* Original identity is durable before dispatch. Unknown never becomes a retry permit. */}
    }
    return {batch_id:request.batch_id,packages:request.packages.map((p:Row)=>({...this.packageStatus(scope,p.package_id),blocked_reasons:blocked.get(p.package_id)??[]})),qualification:'synthetic_only',financial_effect:false,formal_goal_accepted:false};
  }
  async reconcile(scope:Scope,packageId:string){const op=this.#operation(scope,packageId,'operation.reconcile')!;if(op.state==='proposed')throw new Error('PURCHASE_NOT_SENT');
    const identity=op.purchase_id;
    let result:unknown;try{result=await this.#bounded(()=>this.#source.lookup(identity));}catch(error){if((error as Error).message==='SOURCE_INTEGRITY')throw error;return this.packageStatus(scope,packageId);}
    if(result!==null)this.#k.transaction(()=>this.#record(this.#operation(scope,packageId,'operation.reconcile')!,result));return this.packageStatus(scope,packageId);
  }
  async requestVoid(scope:Scope,packageId:string){let op=this.#operation(scope,packageId,'operation.dispatch')!;
    if(!op.void)throw new Error('APPROVAL_REQUIRED');if(op.void.state!=='proposed')return this.packageStatus(scope,packageId);
    op=this.#k.transaction(()=>{const current=this.#operation(scope,packageId,'operation.dispatch')!;if(current.state!=='purchased'||!current.receipt||current.receipt.void_state!=='not_requested')throw new Error('VOID_UNAVAILABLE');
      if(this.#k.db.prepare('SELECT 1 FROM commerce_shipping_manifest_packages WHERE tenant_id=? AND store_id=? AND package_id=?').get(current.tenant_id,current.store_id,packageId))throw new Error('LABEL_ALREADY_MANIFESTED');
      const approval=this.#before(scope,current,'void',false);this.#consume(approval);current.void.state='unknown';this.#save(current);this.#k.audit(scope,'shipping_void_unknown','allowed');return current;});
    try{const receipt=await this.#bounded(()=>{const current=this.#operation(scope,packageId,'operation.dispatch')!;this.#before(scope,current,'void',true);return this.#source.requestVoid(current.void.command);});
      this.#k.transaction(()=>this.#record(this.#operation(scope,packageId,'operation.dispatch')!,receipt));}catch{/* Reconcile this purchase and original void ID; no fresh void command. */}
    return this.packageStatus(scope,packageId);
  }
  packageStatus(scope:Scope,packageId:string){const op=this.#operation(scope,packageId)!,r=op.receipt,k=this.#k;
    const parcel=this.#source.currentParcel(packageId),current=k.get(scope,op.resource_id),parcelCurrent=!!parcel&&contentDigest(parcel)===op.command.quote.parcel_digest;
    const accountCurrent=this.#source.accountCurrent(op.command.quote);
    const voidState=op.void?.state==='proposed'?'not_requested':op.void?.state??r?.void_state??'not_requested';
    return jsonValue({package_id:op.package_id,resource_id:op.resource_id,purchase_id:op.purchase_id,state:op.state,command_digest:op.command_digest,approval_id:op.approval_id,
      source_identity:op.source_identity,quote_source_identity:op.command.quote_source_identity,package_revision:op.command.quote.package_revision,parcel_digest:op.command.quote.parcel_digest,
      resource_current:resourceDigest(current)===op.command.quote.resource_digest,parcel_current:parcelCurrent,account_current:accountCurrent,receipt:r,void_operation_id:op.void?.command.void_id??null,void_state:voidState,
      refund_state:r?.refund_state??'not_requested',refund_amount_minor:r?.refund_amount_minor??'0',native_refund_id:r?.native_refund_id??null,
      label_usable:op.state==='purchased'&&!!r&&r.valid_until>k.clock()&&voidState==='not_requested'&&parcelCurrent&&accountCurrent&&resourceDigest(current)===op.command.quote.resource_digest,
      retry_allowed:false,qualification:'synthetic_only',financial_effect:false,carrier_connected:false,formal_goal_accepted:false});
  }
}
