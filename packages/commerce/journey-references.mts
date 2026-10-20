import type {CommerceKernel,Row} from './kernel.mts';
import {id,integer} from './kernel.mts';
import {canonical,contentDigest,jsonValue} from './configuration-values.mts';
import {nativeReturnRequest} from '../adapters/shopify-return-fixture.mts';
import {journeyReference,journeyHash} from './journey-records.mts';

const TABLES:Record<string,string>={preview:'commerce_action_previews',approval:'commerce_action_approvals',receipt:'commerce_action_receipts',
  return_request:'commerce_return_requests',fulfillment:'commerce_fulfillment_operations',resolution:'commerce_resolution_operations',
  edit:'commerce_order_edits',cart:'commerce_shopping_carts',delivery:'commerce_support_deliveries'};
const ACTIONS:Record<string,{intents:string[];quote:string;effect:string;result:string;kind:string}>={
  'diagnostic.return.submit':{intents:['return','exchange'],quote:'commerce_return_quotes',effect:'local_return_request_only',result:'return_request_id',kind:'return_request'},
  'diagnostic.return.resolve':{intents:['return','exchange'],quote:'commerce_resolution_quotes',effect:'synthetic_resolution_authorized',result:'resolution_operation_id',kind:'resolution'},
  'diagnostic.exchange.create':{intents:['exchange'],quote:'commerce_fulfillment_quotes',effect:'synthetic_fulfillment_authorized',result:'fulfillment_operation_id',kind:'fulfillment'},
  'diagnostic.label.purchase':{intents:['exchange'],quote:'commerce_fulfillment_quotes',effect:'synthetic_fulfillment_authorized',result:'fulfillment_operation_id',kind:'fulfillment'},
  'diagnostic.label.void':{intents:['exchange'],quote:'commerce_fulfillment_quotes',effect:'synthetic_fulfillment_authorized',result:'fulfillment_operation_id',kind:'fulfillment'},
  'diagnostic.order.edit':{intents:['edit'],quote:'commerce_edit_quotes',effect:'synthetic_order_edit_authorized',result:'order_edit_id',kind:'edit'},
};
export function journeyAction(action:string,kind:string,preparing=false) {
  const route=ACTIONS[action];
  if(!route||!route.intents.includes(kind)||preparing&&action==='diagnostic.return.submit')throw new Error('JOURNEY_ACTION_UNSUPPORTED');return route;
}
function check(ok:unknown):asserts ok {if(!ok)throw new Error('JOURNEY_REFERENCE_INTEGRITY');}
function same(a:unknown,b:unknown){return canonical(a)===canonical(b);}
function body(row:Row,column='body',hash='digest'):Row {
  check(row&&typeof row[column]==='string'&&journeyHash(row[hash]));
  const value=jsonValue(JSON.parse(row[column]),1048576);check(value&&typeof value==='object'&&!Array.isArray(value));
  check(contentDigest(value)===row[hash]);return value;
}
export type JourneyArtifact={row:Row;body:Row;reference:Row;action?:string};

/** Scoped historical provenance. This resolver never evaluates current approval
 * usability and never invokes an effect owner or dereferences a privacy export. */
export class JourneyReferences {
  readonly k:CommerceKernel;readonly s:Row;readonly c:Row;
  constructor(k:CommerceKernel,s:Row,c:Row){this.k=k;this.s=s;this.c=c;}
  row(table:string,ref:string,column='id'):Row {
    id(ref);const r=this.k.db.prepare(`SELECT * FROM ${table} WHERE tenant_id=? AND store_id=? AND ${column}=?`)
      .get(this.s.tenant_id,this.s.store_id,ref) as Row;check(r);return r;
  }
  #identity(r:Row,b:Row,customer=true) {
    check(r.case_id===this.c.id&&r.resource_id===this.c.resource_id);
    check(b.case_id===this.c.id&&b.resource_id===this.c.resource_id&&(!customer||b.customer_id===this.c.customer_id));
  }
  #preview(ref:string) {
    const row=this.row(TABLES.preview,ref),p=body(row),route=ACTIONS[p.action];check(route);
    check(row.case_id===this.c.id&&p.tenant_id===this.s.tenant_id&&p.store_id===this.s.store_id&&p.case_id===this.c.id&&
      p.resource_id===this.c.resource_id&&p.customer_id===this.c.customer_id&&journeyHash(p.configuration_digest));
    const qr=this.row(route.quote,p.arguments?.quote_id),q=body(qr),pin=q.pin??q;
    check(qr.case_id===this.c.id&&qr.resource_id===this.c.resource_id&&q.case_id===this.c.id&&q.resource_id===this.c.resource_id&&
      pin.customer_id===this.c.customer_id&&qr.digest===p.arguments.quote_digest&&pin.configuration_digest===p.configuration_digest&&pin.case_revision===p.case_revision);
    if(pin.tenant_id!==undefined)check(pin.tenant_id===this.s.tenant_id&&pin.store_id===this.s.store_id);
    const original=this.k.db.prepare('SELECT * FROM commerce_case_configurations WHERE tenant_id=? AND store_id=? AND case_id=? AND revision=?')
      .get(this.s.tenant_id,this.s.store_id,this.c.id,p.case_revision) as Row,config=body(original);
    check(original.digest===p.configuration_digest&&config.case_id===this.c.id&&config.resource_id===this.c.resource_id&&config.customer_id===this.c.customer_id);
    if(route.kind==='fulfillment')check(({replacement:'diagnostic.exchange.create',label:'diagnostic.label.purchase',void:'diagnostic.label.void'} as Row)[q.kind]===p.action&&qr.kind===q.kind&&qr.obligation===q.obligation);
    if(q.amount_minor!==undefined)check(p.amount?.minor===q.amount_minor&&p.amount?.currency===q.currency);
    return {row,body:p,quote:qr,q,route};
  }
  #approval(ref:string) {
    const row=this.row(TABLES.approval,ref),preview=this.#preview(row.preview_id);
    check(row.preview_digest===preview.row.digest);return {row,preview};
  }
  #receipt(ref:string) {
    const row=this.row(TABLES.receipt,ref),b=body(row),p=this.#preview(row.preview_id),a=this.#approval(b.approval_id);
    check(row.id===b.id&&row.case_id===this.c.id&&b.case_id===this.c.id&&b.preview_id===p.row.id&&
      b.preview_digest===p.row.digest&&a.row.preview_id===p.row.id&&a.row.preview_digest===p.row.digest&&
      b.configuration_digest===p.body.configuration_digest&&b.case_revision===p.body.case_revision&&b.resource_version===p.body.resource_version&&
      same(b.amount,p.body.amount)&&b.effect===p.route.effect&&b.approval_consumed===true&&b.financial_effect===false);
    id(b[p.route.result]);
    const resultKeys=['return_request_id','resolution_operation_id','fulfillment_operation_id','order_edit_id','instant_operation_id','lifecycle_operation_id'];
    check(resultKeys.filter(key=>Object.hasOwn(b,key)).length===1);return {row,body:b,preview:p};
  }
  #request(ref:string) {
    const row=this.row(TABLES.return_request,ref),b=body(row);
    if(row.state==='awaiting_review')throw new Error('JOURNEY_REFERENCE_MUTABLE');
    check(['submitted','native_unknown','native_created'].includes(row.state));
    const receipt=this.#receipt(row.receipt_id),p=receipt.preview;
    check(row.case_id===this.c.id&&row.resource_id===this.c.resource_id&&b.selection?.case_id===this.c.id&&
      p.body.action==='diagnostic.return.submit'&&row.quote_id===p.quote.id&&row.preview_id===p.row.id&&
      b.quote_digest===p.quote.digest&&b.configuration_digest===p.body.configuration_digest&&same(b.selection,p.q.selection)&&
      receipt.body.return_request_id===row.id);
    return {row,body:b,receipt,action:p.body.action};
  }
  #allocation(ref:string) {
    const row=this.row('commerce_resolution_allocations',ref),b=body(row);this.#identity(row,b);
    check(b.id===row.id&&b.plan_id===row.plan_id&&b.line_id===row.line_id&&b.outcome===row.outcome);
    const pr=this.row('commerce_resolution_plans',row.plan_id),p=body(pr);
    check(pr.case_id===this.c.id&&pr.resource_id===this.c.resource_id&&p.request_id===pr.request_id&&p.intent?.request_id===pr.request_id);
    this.#request(pr.request_id);return {row,body:b,plan:p};
  }
  #effect(kind:string,ref:string) {
    const row=this.row(TABLES[kind],ref),b=body(row,kind==='edit'?'body':'command'),receipt=this.#receipt(row.receipt_id),p=receipt.preview,q=p.q;
    check(row.case_id===this.c.id&&row.resource_id===this.c.resource_id&&row.quote_id===p.quote.id&&p.route.kind===kind&&receipt.body[p.route.result]===row.id);
    if(kind==='edit') {
      this.#identity(row,b,false);check(b.id===row.id&&b.quote_id===row.quote_id&&b.quote_digest===p.quote.digest&&
        b.receipt_id===row.receipt_id&&row.source_identity===q.source_identity);
    }else if(kind==='resolution') {
      const allocation=this.#allocation(row.allocation_id);
      check(q.allocation_id===row.allocation_id&&p.quote.allocation_id===row.allocation_id&&q.allocation_digest===allocation.row.digest);
      const expected:Row={operation_id:row.id,tenant_id:this.s.tenant_id,store_id:this.s.store_id,resource_id:q.resource_id,customer_id:q.customer_id,
        allocation_id:q.allocation_id,kind:q.kind,currency:q.currency,amount_minor:q.amount_minor,payment_id:q.payment_id,native_return_id:q.native_return_id,
        source_identity:q.source_identity,credit_instrument:q.credit_instrument};
      for(const field of ['exchange_quote_id','exchange_quote_digest','original_value_minor','replacement_variant','replacement_minor','quantity','routes','value_routes','payment_expires_at','credit_beneficiary_id','gift_source_digest','line_id','units','money_terms','woo_refund'])if(Object.hasOwn(q,field))expected[field]=q[field];
      check(same(b,expected)&&row.id==='resolution_'+contentDigest([this.s.tenant_id,this.s.store_id,q.allocation_id]).slice(0,40)&&
        row.source_identity===q.source_identity&&row.kind===q.kind&&row.amount_minor===q.amount_minor&&row.currency===q.currency);
    }else {
      this.#request(q.request_id);
      const expected:Row={operation_id:row.id,kind:q.kind,obligation:q.obligation,tenant_id:this.s.tenant_id,store_id:this.s.store_id,
        source_identity:q.pin.source_identity,account_id:q.pin.account_id,case_id:q.case_id,resource_id:q.resource_id,request_id:q.request_id,
        customer_id:q.pin.customer_id,native_return_id:q.pin.native_return_id,original_order_id:q.resource_id,native_original_order_id:q.pin.native_original_order_id,
        settings_digest:q.pin.settings_digest,resolution_trigger:q.pin.resolution_trigger,currency:q.currency,amount_minor:q.amount_minor,...q.details};
      delete expected.from_address_ref;delete expected.to_address_ref;
      check(same(b,expected)&&row.id==='fulfill_'+contentDigest([this.s.tenant_id,this.s.store_id,q.kind,q.obligation]).slice(0,40)&&row.kind===q.kind&&row.obligation===q.obligation);
    }
    return {row,body:b,action:p.body.action};
  }
  #cart(ref:string) {
    const row=this.row(TABLES.cart,ref,'cart_id'),b=body(row);
    check(b.cart_id===row.cart_id&&row.resource_id===this.c.resource_id&&b.resource_id===row.resource_id&&row.customer_id===this.c.customer_id&&
      b.customer_id===row.customer_id&&b.preview?.resource_id===row.resource_id&&b.preview.subject_id===row.customer_id&&
      b.preview.source_identity===b.source_identity&&contentDigest(b.preview)===b.preview_digest&&
      b.operation_id==='cart_'+contentDigest([this.s.tenant_id,this.s.store_id,row.cart_id,b.preview_digest]).slice(0,40));
    id(b.source_identity);check(['proposed','unknown','committed'].includes(row.state));
    if(b.receipt) {
      const command={operation_id:b.operation_id,cart_id:row.cart_id,tenant_id:this.s.tenant_id,store_id:this.s.store_id,resource_id:row.resource_id,
        customer_id:row.customer_id,source_identity:b.source_identity,preview_digest:b.preview_digest,items:b.preview.items.map((i:Row)=>({variant_id:i.variant_id,quantity:i.quantity}))};
      const r=b.receipt;check(r.operation_id===b.operation_id&&r.cart_id===row.cart_id&&r.resource_id===row.resource_id&&r.customer_id===row.customer_id&&
        r.source_identity===b.source_identity&&r.preview_digest===b.preview_digest&&r.command_digest===contentDigest(command)&&r.qualification==='synthetic_only');id(r.native_id);
    }
    check((row.state==='committed')===!!b.receipt);return {row,body:b};
  }
  #delivery(ref:string) {
    const row=this.row(TABLES.delivery,ref,'operation_id'),b=body(row);
    check(!row.erased&&row.case_id===this.c.id&&row.resource_id===this.c.resource_id&&b.case_id===row.case_id&&b.resource_id===row.resource_id&&
      b.kind===row.kind&&b.purpose===row.purpose&&b.account_id===row.account_id);
    const link=this.row('commerce_support_links',row.link_id);
    check(link.case_id===this.c.id&&link.resource_id===this.c.resource_id&&link.customer_id===this.c.customer_id);
    if(row.kind==='email')check(b.link_id===link.id);else check(b.conversation_id===link.external_id);
    const operation=this.row('commerce_operations',ref),command=body(operation,'command','payload_hash');
    check(operation.resource_id===this.c.resource_id&&command.resource_id===this.c.resource_id&&command.payload_digest===row.digest&&
      command.action===(row.kind==='email'?'customer.message':'helpdesk.write')&&command.source_id===operation.source_id&&operation.source_kind==='event'&&
      operation.id==='op_'+contentDigest([this.s.tenant_id,this.s.store_id,operation.source_kind,operation.source_id]).slice(0,40));
    if(row.kind!=='email')check(b.operation_reference===operation.source_id);
    if(row.observation)body(row,'observation','observation_digest');return {row,body:b};
  }
  reference(kind:string,ref:string) {
    check(Object.hasOwn(TABLES,kind));const row=this.row(TABLES[kind],ref,kind==='cart'?'cart_id':kind==='delivery'?'operation_id':'id');
    return journeyReference({kind,id:ref,digest:kind==='approval'?row.preview_digest:kind==='cart'?body(row).preview_digest:row.digest});
  }
  resolve(value:unknown,intent?:string):JourneyArtifact {
    const ref=journeyReference(value);let resolved:Row;
    try {
      if(ref.kind==='preview'){const p=this.#preview(ref.id);resolved={row:p.row,body:p.body,action:p.body.action};}
      else if(ref.kind==='approval'){const a=this.#approval(ref.id);resolved={row:a.row,body:{},action:a.preview.body.action};}
      else if(ref.kind==='receipt'){const r=this.#receipt(ref.id);this.#result(r);resolved={row:r.row,body:r.body,action:r.preview.body.action};}
      else if(ref.kind==='return_request')resolved=this.#request(ref.id);
      else if(['fulfillment','resolution','edit'].includes(ref.kind))resolved=this.#effect(ref.kind,ref.id);
      else if(ref.kind==='cart')resolved=this.#cart(ref.id);else resolved=this.#delivery(ref.id);
      check(ref.digest===(ref.kind==='approval'?resolved.row.preview_digest:ref.kind==='cart'?resolved.body.preview_digest:resolved.row.digest));
      if(intent) {
        if(resolved.action)journeyAction(resolved.action,intent);
        else check(ref.kind==='cart'?intent==='shopping':ref.kind==='delivery'&&['followup','handoff'].includes(intent));
      }
      return {...resolved,reference:ref} as JourneyArtifact;
    }catch(error){if(error instanceof Error&&error.message==='JOURNEY_REFERENCE_MUTABLE')throw error;throw new Error('JOURNEY_REFERENCE_INTEGRITY');}
  }
  #result(receipt:Row) {
    const route=receipt.preview.route;
    if(route.kind==='return_request')this.#request(receipt.body[route.result]);else this.#effect(route.kind,receipt.body[route.result]);
  }
}

/** Bounded resource-wide scans include effects from other cases and effects that
 * were never attached to this journey. Unknown children need actual parents. */
export function unresolvedJourneyEffects(k:CommerceKernel,s:Row,resourceId:string):Row[] {
  const result:Row[]=[],limit=100;
  const scan=(table:string,where:string,args:unknown[]=[])=>{
    const rows=k.db.prepare(`SELECT * FROM ${table} WHERE tenant_id=? AND store_id=? AND ${where} ORDER BY 1,2 LIMIT ?`)
      .all(s.tenant_id,s.store_id,...args,limit+1) as Row[];
    if(rows.length>limit)throw new Error('JOURNEY_UNRESOLVED_LIMIT');return rows;
  };
  const resolver=(caseId:string,resource:string)=>{
    const c=k.db.prepare('SELECT * FROM commerce_cases WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,caseId) as Row;
    check(c&&c.resource_id===resource);return new JourneyReferences(k,s,c);
  };
  const add=(family:string,ref:string,state:string,extra:Row={})=>result.push({family,id:ref,state,handoff_required:true,...extra});
  for(const row of scan('commerce_operations',"resource_id=? AND state IN ('sending','unknown')",[resourceId])) {
    const b=body(row,'command','payload_hash');check(b.resource_id===resourceId&&b.source_id===row.source_id&&
      row.id==='op_'+contentDigest([s.tenant_id,s.store_id,row.source_kind,row.source_id]).slice(0,40));add('generic',row.id,row.state);
  }
  for(const row of scan('commerce_native_return_operations',"state='unknown'")) {
    const request=k.db.prepare('SELECT * FROM commerce_return_requests WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,row.request_id) as Row;
    check(request);const r=resolver(request.case_id,request.resource_id),artifact=r.resolve(r.reference('return_request',request.id));
    check(row.id==='nret_'+contentDigest([s.tenant_id,s.store_id,request.id]).slice(0,40)&&journeyHash(row.request_digest));
    const preview=body(r.row(TABLES.preview,request.preview_id)),quote=body(r.row('commerce_return_quotes',request.quote_id)),receipt=body(r.row(TABLES.receipt,request.receipt_id));
    const input=nativeReturnRequest(quote.native_order_id,preview.lines,request.id);
    check(row.request_digest===contentDigest({input,receipt:request.receipt_id,configuration:receipt.configuration_digest,source:row.source_identity}));
    if(row.native_body)body(row,'native_body','native_digest');
    if(artifact.row.resource_id===resourceId)add('native_return',row.id,row.state,{request_id:request.id});
  }
  for(const [family,table] of [['resolution','commerce_resolution_operations'],['fulfillment','commerce_fulfillment_operations']]) {
    for(const row of scan(table,"resource_id=? AND state='unknown'",[resourceId])) {
      const r=resolver(row.case_id,row.resource_id);r.resolve(r.reference(family,row.id));add(family,row.id,row.state);
    }
  }
  const edits=new Map<string,{row:Row;steps:Row[]}>();
  for(const row of scan('commerce_order_edits',"resource_id=? AND state='unknown'",[resourceId]))edits.set(row.id,{row,steps:[]});
  for(const step of scan('commerce_edit_steps',"state='unknown'")) {
    const row=k.db.prepare('SELECT * FROM commerce_order_edits WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,step.edit_id) as Row;
    check(row&&step.operation_id===row.id+'_'+contentDigest(step.stage).slice(0,20)&&journeyHash(step.command_digest));
    const r=resolver(row.case_id,row.resource_id);r.resolve(r.reference('edit',row.id));
    if(row.resource_id===resourceId){const found=edits.get(row.id)??{row,steps:[]};found.steps.push({operation_id:step.operation_id,stage:step.stage,state:step.state});edits.set(row.id,found);}
  }
  if(edits.size>limit)throw new Error('JOURNEY_UNRESOLVED_LIMIT');
  for(const {row,steps} of edits.values()){const r=resolver(row.case_id,row.resource_id);r.resolve(r.reference('edit',row.id));add('edit',row.id,'unknown',{edit_steps:steps});}
  for(const row of scan('commerce_shopping_carts',"resource_id=? AND state='unknown'",[resourceId])) {
    const r=new JourneyReferences(k,s,{resource_id:resourceId,customer_id:row.customer_id}),value=r.resolve(r.reference('cart',row.cart_id));
    add('cart',value.body.operation_id,row.state,{cart_id:row.cart_id});
  }
  return result.sort((a,b)=>a.family.localeCompare(b.family)||a.id.localeCompare(b.id));
}
