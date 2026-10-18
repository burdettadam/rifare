'use strict';
(() => {
  const el=id=>document.getElementById(id),result=el('result'),message=el('message');
  let session='',sequence=0,active,challenge=null,expiry;
  function say(text,error=false){if(window.RifareA11y)window.RifareA11y.announce(message,text,{error});else{message.textContent=text;message.className=error?'error':'';message.focus();}}
  function clear(){clearTimeout(expiry);result.replaceChildren();result.hidden=true;}
  function cancel(){sequence++;active?.abort();clear();}
  function line(parent,label,value){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=typeof value==='string'?value:JSON.stringify(value);parent.append(dt,dd);}
  function time(value){return typeof value==='number'&&Number.isFinite(value)?new Date(value).toISOString():'Unavailable';}
  async function request(path,method='GET',data,auth=session,signal){
    const response=await fetch(path,{method,cache:'no-store',credentials:'omit',redirect:'error',signal,
      headers:{...(auth?{authorization:'Bearer '+auth}:{}),...(data?{'content-type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
    if(!response.ok)throw new Error(response.status===403||response.status===404?'Not permitted or not found. Verify the session and order.':'Source unavailable. No current facts are displayed.');
    return response.json();
  }
  function render(facts){
    clear();if(!facts.order){say('Current source unavailable ('+String(facts.status)+'). No previous facts are displayed.',true);return;}
    const heading=document.createElement('h2');heading.id='result-heading';heading.tabIndex=-1;heading.textContent='Order '+facts.order.number;result.append(heading);
    const list=document.createElement('dl');result.append(list);
    line(list,'Source state',facts.status==='fixture_snapshot'?'Synthetic fixture snapshot — not live':facts.status);
    line(list,'Fulfillment status',facts.order.fulfillment_status??'Unavailable');
    line(list,'Totals (source values)',facts.order.totals??'Unavailable');
    line(list,'Source system',facts.source.system);line(list,'Observed at',time(facts.source.observed_at));
    line(list,'Source updated at',time(facts.source.source_updated_at));line(list,'Source revision',facts.source.revision);
    const h=document.createElement('h3');h.textContent='Shipments';result.append(h);
    for(const [i,shipment] of (facts.order.shipments??[]).entries()){
      const card=document.createElement('article'),title=document.createElement('h4'),details=document.createElement('dl');
      title.textContent='Shipment '+(i+1);card.append(title,details);line(details,'Status',shipment.delivery_state??shipment.status??'Unavailable');
      line(details,'Carrier',shipment.carrier??'Unavailable');line(details,'Tracking',shipment.tracking_number??shipment.tracking??'Unavailable');
      if(shipment.source)line(details,'Shipment source',shipment.source);result.append(card);
    }
    if(!facts.order.shipments?.length){const note=document.createElement('p');note.textContent='No visible shipment data. This does not establish that nothing shipped.';result.append(note);}
    result.hidden=false;say('Source facts loaded. No model was called.');window.RifareA11y?.focus('result-heading');
    if(facts.status==='fresh'){
      const remaining=facts.source.observed_at+300000-Date.now();
      expiry=setTimeout(()=>{clear();say('Source snapshot expired. Reload to check current facts.',true);},Math.max(0,remaining));
    }
  }
  async function load(){
    cancel();const run=sequence;active=new AbortController();
    if(el('token').value)session=el('token').value;el('token').value='';
    const order=el('order').value;
    if(!session||!/^res_[A-Za-z0-9_-]+$/.test(order)){say('A valid session and order resource ID are required.',true);return;}
    say('Loading source facts…');
    try{const facts=await request('/v1/orders/'+encodeURIComponent(order)+'/status','GET',undefined,session,active.signal);if(run===sequence)render(facts);}
    catch(error){if(run===sequence){clear();say(error.message,true);}}
  }
  el('lookup').addEventListener('submit',event=>{event.preventDefault();void load();});
  el('logout').addEventListener('click',async()=>{const old=session;session='';challenge=null;cancel();el('token').value='';el('proof').value='';el('order').value='';el('email').value='';
    window.RifareA11y?.clearErrors();window.RifareA11y?.focus('token');say('Local data cleared. Revoking session…');
    try{if(old)await request('/v1/session/logout','POST',{},old);say('Signed out. Local data cleared.');}
    catch{say('Local data cleared; server revocation could not be confirmed.',true);}
  });
  el('challenge').addEventListener('submit',async event=>{event.preventDefault();cancel();challenge=null;const run=sequence;
    try{const store=el('store').value;const r=await request('/v1/customer/challenges','POST',{store_id:store,order_number:el('number').value,email:el('email').value},'');
      if(run===sequence){challenge={store,challenge_id:r.challenge_id};say('Request received. Use the proof from the authorized delivery channel.');}}
    catch(error){if(run===sequence)say(error.message,true);}
  });
  el('verify').addEventListener('submit',async event=>{event.preventDefault();const current=challenge,run=sequence,proof=el('proof').value;el('proof').value='';
    if(!current){say('Request a proof first.',true);return;}
    try{const verified=await request('/v1/customer/verify','POST',{store_id:current.store,challenge_id:current.challenge_id,proof},'');
      if(run===sequence){session=verified.token;challenge=null;el('order').value=verified.resource_id;await load();}}
    catch(error){if(run===sequence)say(error.message,true);}
  });
  window.addEventListener('pagehide',()=>{session='';challenge=null;cancel();});
})();
