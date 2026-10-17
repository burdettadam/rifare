const $=id=>document.getElementById(id);
const groups=['lineage','money','fees','instant'];
const state=Object.fromEntries(groups.map(name=>[name,{generation:0,controller:null}]));
const actions={
 lineage:{materialize:{path:'/v1/exchange-lineage/materialize',fields:{operation_id:'lineage-operation-id'}},node:{path:'/v1/exchange-lineage/node',fields:{node_id:'lineage-node-id'}}},
 money:{bind:{path:'/v1/exchange-money/bind',fields:{allocation_id:'money-allocation-id'}},currency:{path:'/v1/exchange-money/currency',fields:{allocation_id:'money-allocation-id'}}},
 fees:{'refresh-fee':{path:'/v1/exchange-money/refresh-fee',fields:{allocation_id:'fee-allocation-id',event_id:'fee-event-id'}},fees:{path:'/v1/exchange-money/fees',fields:{allocation_id:'fee-allocation-id'}}},
 instant:{'authorize-quote':{path:'/v1/instant-exchanges/authorize-quote',fields:{exchange_quote_id:'exchange-quote-id',exchange_quote_digest:'exchange-quote-digest',consent_id:'consent-id'},quote:true},'reauthorize-quote':{path:'/v1/instant-exchanges/reauthorize-quote',fields:{obligation_id:'obligation-id',consent_id:'consent-id'},quote:true},'capture-quote':{path:'/v1/instant-exchanges/capture-quote',fields:{obligation_id:'obligation-id'},quote:true},'cancel-quote':{path:'/v1/instant-exchanges/cancel-quote',fields:{obligation_id:'obligation-id'},quote:true},operation:{path:'/v1/instant-exchanges/operation',fields:{operation_id:'instant-operation-id'}},dispatch:{path:'/v1/instant-exchanges/dispatch',fields:{operation_id:'instant-operation-id'}},reconcile:{path:'/v1/instant-exchanges/reconcile',fields:{operation_id:'instant-operation-id'}}}
};
const say=(name,text,error=false)=>{$(name+'-status').textContent=text;$(name+'-status').dataset.error=String(error);};
function busy(name,value){for(const button of $(name+'-form').querySelectorAll('button'))button.disabled=value;$(name+'-form').setAttribute('aria-busy',String(value));}
function reset(name,message='Inputs changed. Request a fresh result for this section.'){
 const current=state[name];current.generation++;current.controller?.abort();current.controller=null;busy(name,false);
 $(name+'-result').hidden=true;$(name+'-summary').replaceChildren();$(name+'-raw').textContent='';$(name+'-details').open=false;
 if(name==='instant')$('instant-next').hidden=true;say(name,message);
}
function formatMoney(currency,value){
 const scale={USD:2,EUR:2,GBP:2,CAD:2,JPY:0,KWD:3,BHD:3}[currency];
 if(scale===undefined||typeof value!=='string'||! /^-?(0|[1-9][0-9]{0,63})$/.test(value))return String(currency)+' '+String(value)+' minor units';
 const amount=BigInt(value),negative=amount<0n,absolute=negative?-amount:amount,unit=10n**BigInt(scale);
 return String(currency)+' '+(negative?'-':'')+String(absolute/unit)+(scale?'.'+String(absolute%unit).padStart(scale,'0'):'')+' ('+value+' minor units)';
}
function summarize(name,result){
 const list=$(name+'-summary'),rows=[];
 const add=(title,value)=>{if(value!==null&&value!==undefined)rows.push([title,String(value)]);};
 const amount=(title,currency,value)=>{if(currency&&value!==null&&value!==undefined)add(title,formatMoney(currency,value));};
 const date=(title,value)=>{if(value!==null&&value!==undefined){const time=new Date(value);add(title,Number.isNaN(time.getTime())?String(value):time.toISOString().replace('T',' ').replace('Z',' UTC'));}};
 const pair=(shopCurrency,presentmentCurrency,shop,presentment)=>[shop!==null&&shop!==undefined&&shopCurrency?formatMoney(shopCurrency,shop):null,presentment!==null&&presentment!==undefined&&presentmentCurrency?formatMoney(presentmentCurrency,presentment):null].filter(Boolean).join(' · ');
 const feeTotal=value=>{const parts=['restocking_minor','return_shipping_minor','tax_minor'].map(key=>value?.[key]);return parts.every(part=>typeof part==='string'&&/^(0|[1-9][0-9]*)$/.test(part))?parts.reduce((sum,part)=>sum+BigInt(part),0n).toString():null;};
 if(name==='lineage'){
  const node=result.node??{},currency=node.currency;add('Lineage state',result.state);add('Exchange generation',node.generation);
  amount('Carried value',currency,node.carried_minor);amount('Original parent paid',currency,node.parent_paid_minor);amount('Additional paid',currency,node.additional_paid_minor);
  amount(node.terminal_outflow_kind==='refund'?'Refund outflow':node.terminal_outflow_kind==='store_credit'?'Store credit outflow':'Refund / credit outflow',currency,node.terminal_outflow_minor);
  amount('Retained fees',currency,node.fees_minor);amount('Retail reference',currency,node.replacement_retail_minor);
  const instruments=new Set();for(const funding of node.funding??[]){if(instruments.has(funding.instrument_id))continue;instruments.add(funding.instrument_id);amount('Funding · '+funding.instrument_id,currency,funding.amount_minor);}
  add('Node ID',node.id);if(result.requires_original_operation_lookup)add('Next step','Look up the original replacement operation.');
 }else if(name==='money'){
  const binding=result.binding??{},shop=binding.components?.shop,presentment=binding.components?.presentment;
  amount('Shop original paid',binding.shop_currency,shop?.paid_minor);amount('Presentment original paid',binding.presentment_currency,presentment?.paid_minor);
  const duties=pair(binding.shop_currency,binding.presentment_currency,shop?.duties_minor,presentment?.duties_minor);if(duties)add('Original duty allocation',duties);
  add('Original conversion reference',binding.rate_provenance?.id);date('Issuance qualification expires',binding.qualification?.expires_at);
 }else if(name==='fees'){
  const estimate=result.estimate,final=result.final,shop=estimate?.shop_currency,presentment=estimate?.presentment_currency;
  add('Fee state',result.state);if(estimate)add('Estimated fees',pair(shop,presentment,feeTotal(estimate.shop),feeTotal(estimate.presentment)));
  add('Final fees',final?pair(final.shop_currency,final.presentment_currency,feeTotal(final.shop),feeTotal(final.presentment)):'Awaiting final amount');
  const delta=result.delta_from_authorized??result.delta_from_estimate;if(delta)add(result.delta_from_authorized?'Difference from approved fees':'Difference from estimate',pair(shop,presentment,delta.shop,delta.presentment));
  add('Next step',result.unresolved?'Reconcile the original operation; the difference is unresolved.':result.requires_new_approval?'Prepare a new exact quote and approval.':result.next_action==='none'?'No new financial effect is authorized.':result.next_action);
  add('Operation ID',result.operation_id);
 }else{
  const quote=result.quote,value=quote??result,plan=quote?.plan??result.source??{},currency=value.currency??plan.currency;
  add('Operation stage',result.state);add('Quote action',quote?.kind);
  if(value.amount_minor===plan.maximum_minor)amount('Amount / ceiling',currency,value.amount_minor);else{amount('Amount',currency,value.amount_minor);amount('Ceiling',currency,plan.maximum_minor);}
  if(!quote&&result.source){amount('Captured',currency,result.source.captured_minor);amount('Unreturned value',currency,result.source.remaining_minor);if(result.source.compensation_required_minor!=='0')amount('Compensation requiring review',currency,result.source.compensation_required_minor);}
  date('Trial deadline',plan.trial_deadline_at);date('Mandate expires',plan.expires_at);if(quote)date('Quote expires',quote.expires_at);
  add('Next step',quote?'Approval is required before dispatch.':result.state==='unknown'?'Reconcile this original operation.':result.source?.compensation_required_minor&&result.source.compensation_required_minor!=='0'?'Review the unresolved compensation on this obligation.':result.state==='authorized'?'Dispatch the already approved operation.':'Review the returned source stage before preparing another quote.');
  if(quote){add('Quote ID',result.id);add('Quote digest',result.digest);}add('Obligation ID',value.obligation_id);
 }
 if(!rows.length)rows.push(['Response','Source details contain the complete returned record.']);
 for(const [title,value] of rows){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=title;dd.textContent=value;list.append(dt,dd);}
 $(name+'-raw').textContent=JSON.stringify(result,null,2);$(name+'-result').hidden=false;
}
function returnedStage(result){
 for(const value of [result,result?.operation,result?.quote,result?.node,result?.obligation,result?.authorization])if(value&&typeof value==='object')for(const key of ['state','stage','status'])if(typeof value[key]==='string')return value[key];
 return null;
}
async function submit(name,action){
 reset(name,'Checking the current source record…');const config=actions[name][action],current=state[name],generation=current.generation;
 try{
  if(!config)throw new Error('Choose a supported action.');const token=$('operator-token').value.trim();if(!token)throw new Error('Enter an operator session token.');
  const input={};for(const [key,field] of Object.entries(config.fields)){const value=$(field).value.trim();if(!value)throw new Error('Enter '+$(field).labels[0].textContent.trim().toLowerCase()+'.');input[key]=value;}
  current.controller=new AbortController();busy(name,true);
  const response=await fetch(config.path,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(input),signal:current.controller.signal});
  const result=await response.json();if(generation!==current.generation)return;if(!response.ok)throw new Error(typeof result.error==='string'?result.error:'REQUEST_FAILED');
  summarize(name,result);const stage=returnedStage(result);say(name,(config.quote?'Quote prepared for review.':'Source response received.')+(stage?' Returned stage: '+stage+'.':''));
  if(name==='instant')$('instant-next').hidden=!config.quote;
 }catch(error){if(generation===current.generation&&error.name!=='AbortError')say(name,'Unable to complete this request: '+error.message,true);}
 finally{if(generation===current.generation){current.controller=null;busy(name,false);}}
}
for(const name of groups){
 $(name+'-form').addEventListener('submit',event=>{event.preventDefault();submit(name,event.submitter?.dataset.action);});
 for(const input of $(name+'-form').querySelectorAll('input'))for(const event of ['input','change'])input.addEventListener(event,()=>reset(name));
}
for(const event of ['input','change'])$('operator-token').addEventListener(event,()=>groups.forEach(name=>reset(name,'Session changed. Request a fresh result.')));
window.addEventListener('pagehide',()=>{$('operator-token').value='';groups.forEach(name=>reset(name));});
