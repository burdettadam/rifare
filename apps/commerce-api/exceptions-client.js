(()=>{'use strict';let bearer='',busy=false,epoch=0;const $=id=>document.getElementById(id),queue=$('queue');
const clear=()=>queue.replaceChildren();
async function request(path,data){const response=await fetch(path,{method:data===undefined?'GET':'POST',headers:{authorization:'Bearer '+bearer,'content-type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});const result=await response.json();if(!response.ok)throw new Error(result.error||'Request unavailable');return result;}
function status(text){$('notice').textContent=text;}
function render(result){clear();for(const item of result.items){const card=document.createElement('article');card.dataset.operation=item.operation_id||'';
  const heading=document.createElement('h2');heading.textContent=item.state==='unknown'?'Unknown outcome — reconcile first':item.state==='failed'?'Known failure':item.state;card.append(heading);
  for(const [label,value] of [['Reason',item.reason],['Owner',item.owner||'Unassigned'],['Previous owner',item.previous_owner||'None'],['Generation',item.generation??'None'],['Operation',item.operation_id||'Not created']]){const p=document.createElement('p');p.textContent=label+': '+value;card.append(p);}
  const pre=document.createElement('pre');pre.textContent=JSON.stringify(item.timeline,null,2);card.append(pre);
  for(const action of item.actions){const button=document.createElement('button');button.textContent=action.name==='reconcile'?'Reconcile without resending':action.name==='reauthorize'?'Reauthorize known-unsent work':'Retry disabled';button.disabled=!action.enabled;
    button.addEventListener('click',()=>perform(item,action.name));card.append(button);}queue.append(card);}
  if(!result.items.length){const p=document.createElement('p');p.textContent='No outstanding exceptions.';queue.append(p);}}
async function load(){if(busy)return;const revision=epoch;busy=true;$('refresh').disabled=true;try{const result=await request('/v1/exceptions');if(revision!==epoch)return;render(result);status(result.truncated?'Partial queue; narrow the investigation using operation records.':'Current server state loaded.');}catch(error){if(revision===epoch){clear();status(error.message);}}finally{if(revision===epoch){busy=false;$('refresh').disabled=!bearer;}}}
async function perform(item,action){if(busy||!['reconcile','reauthorize'].includes(action))return;const revision=epoch;busy=true;for(const b of queue.querySelectorAll('button'))b.disabled=true;
  try{await request('/v1/exceptions/'+encodeURIComponent(item.operation_id)+'/'+action,action==='reauthorize'?{expected_revision:item.operation_revision}:{});if(revision!==epoch)return;status('Decision recorded; refreshing.');}catch(error){if(revision===epoch){clear();status(error.message);busy=false;}return;}if(revision===epoch){busy=false;await load();}}
$('access').addEventListener('submit',event=>{event.preventDefault();epoch++;busy=false;clear();bearer=$('token').value.trim();$('token').value='';$('logout').disabled=!bearer;load();});$('refresh').addEventListener('click',load);
$('logout').addEventListener('click',async()=>{const pending=request('/v1/session/logout',{}).catch(()=>{});epoch++;busy=false;bearer='';clear();$('refresh').disabled=true;$('logout').disabled=true;status('Signed out locally.');await pending;});
})();
