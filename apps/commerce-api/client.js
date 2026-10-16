const session=document.querySelector('#session'),status=document.querySelector('#status'),result=document.querySelector('#result');
async function request(route,method='GET') {
  result.textContent='';status.textContent='Loading…';
  try {
    const response=await fetch(route,{method,headers:{authorization:'Bearer '+session.value},cache:'no-store'});
    const value=await response.json();if(!response.ok)throw new Error(value.error||'REQUEST_FAILED');
    result.textContent=JSON.stringify(value,null,2);status.textContent='Synthetic read completed.';
  } catch(error) {status.textContent=error.message;result.textContent='';}
}
document.querySelector('#orders').addEventListener('click',()=>request('/v1/resources?kind=order'));
document.querySelector('#capabilities').addEventListener('click',()=>request('/v1/capabilities'));
document.querySelector('#logout').addEventListener('click',async()=>{await request('/v1/session/logout','POST');session.value='';result.textContent='';status.textContent='Local session cleared; server revocation was attempted.';});
