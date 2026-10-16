import { digest,exact } from '../commerce/kernel.mts';

export type Fact={id:string;value:unknown;source:Record<string,unknown>};
export function statusFacts(snapshot:any) {
  if(!snapshot?.order||!['fresh','fixture_snapshot'].includes(snapshot.status))throw new Error('CURRENT_FACTS_UNAVAILABLE');
  const facts:Fact[]=[];
  const add=(id:string,value:unknown,source=snapshot.source)=>{
    if(value!==undefined&&value!==null)facts.push({id,value,source});
  };
  add('order.number',snapshot.order.number);add('order.fulfillment_status',snapshot.order.fulfillment_status);
  add('source.state',snapshot.status);add('source.observed_at',snapshot.source.observed_at);
  add('order.totals',snapshot.order.totals);
  for(const [index,s] of (snapshot.order.shipments??[]).entries()) {
    add(`shipment.${index}.state`,s.delivery_state??s.status,s.source??snapshot.source);
    add(`shipment.${index}.carrier`,s.carrier,s.source??snapshot.source);
    add(`shipment.${index}.tracking`,s.tracking_number??s.tracking,s.source??snapshot.source);
  }
  const required=facts.filter(f=>['order.number','order.fulfillment_status','source.state'].includes(f.id)||/^shipment\.\d+\.state$/.test(f.id)).map(f=>f.id);
  return {digest:digest(JSON.stringify(snapshot)),facts,required,evidence_kind:snapshot.source.evidence_kind,
    production_qualified:false};
}
export function finishStatus(input:unknown,catalog:ReturnType<typeof statusFacts>,profile:any) {
  const r=exact(input,['source_digest','fact_ids']);
  if(r.source_digest!==catalog.digest||!Array.isArray(r.fact_ids)||!r.fact_ids.length||r.fact_ids.length>50
    ||new Set(r.fact_ids).size!==r.fact_ids.length||r.fact_ids.some((x:any)=>typeof x!=='string'||!catalog.facts.some(f=>f.id===x))
    ||catalog.required.some(x=>!r.fact_ids.includes(x)))throw new Error('UNGROUNDED_OUTPUT');
  const claims=r.fact_ids.map((id:string)=>catalog.facts.find(f=>f.id===id)!);
  const intro=profile.locale==='fr-CA'?'État de la commande vérifié dans les données disponibles.':profile.tone==='warm'?'Here are the available order facts.':'Available order facts.';
  return {status:'grounded_read',source_digest:catalog.digest,claims,
    answer:intro+'\n'+claims.map((f:Fact)=>f.id+': '+(typeof f.value==='string'?f.value:JSON.stringify(f.value))).join('\n'),
    evidence_kind:catalog.evidence_kind,production_qualified:false,answer_mode:'validated_fact_selection_not_free_prose'};
}
export const STATUS_TOOLS=Object.freeze([
  {name:'read_order_status',description:'Read current source facts for this authorized task. Input is empty.',schema:{type:'object',properties:{},required:[],additionalProperties:false}},
  {name:'finish_status',description:'Finish by selecting observed fact IDs. Include every required fact. Never invent text, values or citations.',schema:{type:'object',additionalProperties:false,
    properties:{source_digest:{type:'string'},fact_ids:{type:'array',items:{type:'string'}}},required:['source_digest','fact_ids']}},
]);
