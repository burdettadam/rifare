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
const label=path=>path.split('.').map(part=>part.replaceAll('_',' ')).join(' / ');
function formatMoney(currency,value){
 const scale={USD:2,EUR:2,GBP:2,CAD:2,JPY:0,KWD:3,BHD:3}[currency];
 if(scale===undefined||typeof value!=='string'||! /^-?(0|[1-9][0-9]{0,63})$/.test(value))return String(currency)+' '+String(value)+' minor units';
 const amount=BigInt(value),negative=amount<0n,absolute=negative?-amount:amount,unit=10n**BigInt(scale);
 return String(currency)+' '+(negative?'-':'')+String(absolute/unit)+(scale?'.'+String(absolute%unit).padStart(scale,'0'):'')+' ('+value+' minor units)';
}
function summarize(name,result){
 const list=$(name+'-summary'),rows=[],fields=new Set(['id','operation_id','node_id','obligation_id','allocation_id','state','stage','status','action','qualification','unresolved','unresolved_count','requires_new_approval','next_action','execution_authorized','authorization_settled','payment_settled','retry_allowed']);
 function visit(value,path,currency=null,pair={},depth=0){
  if(!value||typeof value!=='object'||depth>12||rows.length>=60)return;
  if(Array.isArray(value)){value.forEach((item,index)=>visit(item,path+'.'+String(index+1),currency,pair,depth+1));return;}
  const code=typeof value.currency==='string'?value.currency:currency,sides={...pair,...(value.shop_currency?{shop:value.shop_currency}:{}),...(value.presentment_currency?{presentment:value.presentment_currency}:{})};
  if(typeof value.minor==='string'&&code)rows.push([label(path||'Amount'),formatMoney(code,value.minor)]);
  const entries=Object.entries(value);
  for(const [key,item] of entries)if(fields.has(key)&&item!==null&&['string','boolean','number'].includes(typeof item))rows.push([label(path?path+'.'+key:key),String(item)]);
  for(const [key,item] of entries){
   const next=path?path+'.'+key:key;
   if(key.endsWith('_minor')&&typeof item==='string'&&code)rows.push([label(next),formatMoney(code,item)]);
   else if(item&&typeof item==='object')visit(item,next,sides[key]??code,sides,depth+1);
   if(rows.length>=60)break;
  }
 }
 visit(result,'');
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
