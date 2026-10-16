'use strict';
const $=id=>document.getElementById(id);
let session='',preview=null,approval=null,generation=0;
function clear(){preview=null;approval=null;$('review').hidden=true;$('execute').disabled=true;$('preview').textContent='';$('result').textContent='';}
async function request(path,credential,data){const r=await fetch(path,{method:'POST',headers:{authorization:'Bearer '+credential,'content-type':'application/json'},body:JSON.stringify(data)});const result=await r.json();if(!r.ok)throw new Error(result.error||'REQUEST_DENIED');return result;}
$('proposal').addEventListener('submit',async event=>{event.preventDefault();const current=++generation;clear();session=$('token').value||session;$('token').value='';$('token').required=!session;$('preview-button').disabled=true;
 try{const p=await request('/v1/return-drafts/prepare',session,{case_id:$('case').value,request_key:'draft-'+$('case').value,resolution:$('resolution').value});if(current!==generation)return;preview=p;$('preview').textContent=JSON.stringify(p,null,2);$('review').hidden=false;$('notice').textContent='Preview created. Approval is bound to these exact values.';}
 catch(error){if(current===generation){clear();$('notice').textContent=error.message;}}finally{if(current===generation)$('preview-button').disabled=false;}});
$('approval').addEventListener('submit',async event=>{event.preventDefault();if(!preview)return;const current=++generation;const reviewer=$('reviewer').value;$('reviewer').value='';const p=preview;
 try{const a=await request('/v1/execution/approve',reviewer,{preview_id:p.id,preview_digest:p.digest});if(current!==generation)return;approval=a;$('execute').disabled=false;$('notice').textContent='Approved for one synthetic execution.';}
 catch(error){if(current===generation){clear();$('notice').textContent=error.message;}}});
$('execute').addEventListener('click',async()=>{if(!preview||!approval)return;const current=++generation,p=preview,a=approval;$('execute').disabled=true;
 try{const r=await request('/v1/execution/execute',session,{preview_id:p.id,preview_digest:p.digest,approval_id:a.id});if(current!==generation)return;clear();$('result').textContent=JSON.stringify(r,null,2);$('notice').textContent='Local case-plan changed. No financial effect occurred.';}
 catch(error){if(current===generation){clear();$('notice').textContent=error.message;}}});
$('logout').addEventListener('click',async()=>{generation++;const old=session;session='';$('token').value='';$('token').required=true;$('reviewer').value='';$('preview-button').disabled=false;clear();$('notice').textContent='Signed out locally.';if(old)try{await request('/v1/session/logout',old,{});}catch{}});

$('resume').addEventListener('click',async()=>{const current=++generation;clear();session=$('token').value||session;$('token').value='';$('token').required=!session;try{const p=await request('/v1/return-drafts/resume',session,{case_id:$('case').value});if(current!==generation)return;preview=p;$('preview').textContent=JSON.stringify(p,null,2);$('review').hidden=false;$('notice').textContent='Resumed the stored draft; a model is not required.';}catch(e){if(current===generation)$('notice').textContent=e.message;}});
