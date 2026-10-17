const $=id=>document.getElementById(id),groups=['risk','route','prevention','pack','economics'];
const state=Object.fromEntries(groups.map(name=>[name,{generation:0,controller:null}]));
const input=id=>{const value=$(id).value.trim();if(!value)throw Error('Enter '+$(id).labels[0].textContent.trim().toLowerCase()+'.');return value;};
const request=(suffix,data,customer=false)=>({path:'/v1/return-depth/'+suffix,data,customer});
const actions={
 'risk-read':()=>request('risk/read',{case_id:input('risk-case'),assessment_id:null}),
 'risk-assess':()=>request('risk/assess',{case_id:input('risk-case'),quote_id:input('risk-quote'),model:null}),
 'risk-evidence':()=>request('risk/review',{assessment_id:input('risk-id'),assessment_digest:input('risk-digest'),action:'request_evidence',reason:'photo_unclear',expires_at:null}),
 'risk-dismiss':()=>request('risk/review',{assessment_id:input('risk-id'),assessment_digest:input('risk-digest'),action:'dismiss',reason:'insufficient_basis',expires_at:null}),
 'risk-appeal':()=>request('risk/appeal',{assessment_id:input('risk-id'),reason:'request_human',evidence_ids:[]},true),
 'route-evaluate':()=>request('destinations/evaluate',{request_id:input('route-request')}),
 'route-read':()=>request('destinations/read',{request_id:input('route-request')}),
 'route-select':()=>{const value=input('route-revision');if(!/^(0|[1-9][0-9]*)$/.test(value)||!Number.isSafeInteger(Number(value)))throw Error('Enter a whole selection revision.');return request('destinations/select',{request_id:input('route-request'),destination_id:input('route-destination'),expected_revision:Number(value)});},
 'prevention-read':()=>request('prevention/read',{case_id:input('prevention-case')}),
 'prevention-preview':()=>request('prevention/preview',{case_id:input('prevention-case'),intent:{kind:'item',line_id:input('prevention-line'),variant_id:input('prevention-variant'),address:null}}),
 'prevention-confirm':()=>request('prevention/confirm',{case_id:input('prevention-case'),quote_id:input('prevention-quote'),quote_digest:input('prevention-digest')},true),
 'prevention-revoke':()=>request('prevention/revoke',{case_id:input('prevention-case'),quote_id:input('prevention-quote')},true),
 'pack-read':()=>request('packs/get',{pack_id:input('pack-id'),revision:null}),
 'economics-read':()=>request('economics/report',{cohort_id:input('economics-cohort')}),
};
function reset(name,message='Inputs changed. Request a fresh result.'){
 const s=state[name];s.generation++;s.controller?.abort();s.controller=null;
 $(name+'-result').hidden=true;$(name+'-summary').replaceChildren();$(name+'-raw').textContent='';
 for(const button of $(name+'-form').querySelectorAll('button'))button.disabled=false;
 say(name,message);
}
function say(name,message,error=false){$(name+'-status').textContent=message;$(name+'-status').dataset.error=String(error);}
function money(currency,minor){return minor===null||minor===undefined?'Unknown':String(currency??'')+' '+String(minor)+' minor units';}
function summarize(name,r){
 const rows=[],add=(label,value)=>{if(value!==undefined&&value!==null)rows.push([label,String(value)]);};
 if(name==='risk'){
  const a=r.assessment;add('Assessment',r.assessment_id);add('Status',r.status);add('Customer message',r.message);
  if(a){add('Policy decision',a.policy?.decision_at_quote?.decision);add('Uncertainty',a.uncertainty);add('Automatic denial',a.automatic_denial?'Yes':'No');
   for(const indicator of a.indicators??[])add('Source indicator · '+indicator.code,indicator.reason+' '+indicator.uncertainty);
   add('Appeal path',a.appeal_path);add('Review events',r.history?.length??0);}
  if(r.assessment_id)$('risk-id').value=r.assessment_id;if(r.digest)$('risk-digest').value=r.digest;
 }else if(name==='route'){
  add('Routing state',r.state);add('Recommended destination',r.recommended_destination_id);add('Selection revision',r.revision??r.selection?.revision??(r.selection===null?0:null));
  const route=r.route??r.selection?.route;add('Selected destination',route?.destination_id);
  for(const d of r.destinations??[])add('Destination · '+d.destination_id,(d.eligible?'Eligible':'Unavailable')+(d.reasons?.length?' · '+d.reasons.join(', '):'')+(d.handling_fee_estimate_minor!==undefined?' · handling estimate '+money(d.currency,d.handling_fee_estimate_minor):''));
  add('Next step','Selection reserves no capacity. Prepare a fresh label quote and obtain separate approval.');
 }else if(name==='prevention'){
  add('Suggestion',r.offer?.text??(r.offer===null?'No active suggestion':null));add('Offer current',r.offer_current);add('Reason',r.offer?.reasons?.join(', '));
  const p=r.preview;if(p){add('Original total',money(p.currency,p.old_total_minor));add('New total',money(p.currency,p.new_total_minor));add('Difference',money(p.currency,p.delta_minor));add('Chosen action',p.intent?.kind);add('Chosen variant',p.intent?.variant_id);add('Original lines',p.original_lines?.map(l=>l.variant_id+' × '+l.quantity).join('; '));}
  add('Confirmation required',r.customer_confirmation_required??r.customer_confirmation_required_for_paid_goods);add('Confirmation recorded',r.confirmed);add('Confirmation revoked',r.revoked);add('Confirmation state',r.state??r.status);
  for(const p of r.previews??[])add('Preview · '+p.quote_id,p.confirmed?'Customer and native confirmation recorded':'Customer confirmation or native registration outstanding');
  add('Next step','Customer confirmation and separate staff approval are required before dispatch.');
  if(r.quote_id)$('prevention-quote').value=r.quote_id;if(r.quote_digest)$('prevention-digest').value=r.quote_digest;
 }else if(name==='pack'){
  const p=r.pack;add('Pack',r.id);add('Revision',r.revision);add('Policy',p?.policy?.policy_id);add('Installed skill',p?.skill?.id);add('Tone',p?.presentation?.tone);add('Locale',p?.presentation?.locale);add('Review mode',p?.review?.mode);add('Allowed destinations',p?.routing?.allowed_destination_ids?.join(', '));add('Required capabilities',p?.required_capabilities?.join(', '));add('Activation',r.activation);
 }else{
  add('Frozen denominator',r.denominator);add('Declared costs complete',r.costs_complete);add('Declared retained revenue',money(r.currency,r.declared_retained_revenue_minor));add('Declared total costs',money(r.currency,r.declared_total_cost_minor));add('Declared contribution',money(r.currency,r.declared_contribution_minor));add('Cases with incomplete costs',r.incomplete_case_ids?.length);add('Duplicate resource cost scope',r.duplicate_resource_cost_scope);add('Observed operations',r.observed_operations?.length);add('Uncertain original operations',r.uncertain_operation_ids?.join(', ')||'None');add('Profitability verified',r.profitability_established?'Yes':'No');
 }
 if(!rows.length)add('Response','Read the complete returned record in source details.');
 for(const [key,value]of rows){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=value;$(name+'-summary').append(dt,dd);}
 $(name+'-raw').textContent=JSON.stringify(r,null,2);$(name+'-result').hidden=false;
}
async function submit(name,action){
 reset(name,'Checking the current source…');const s=state[name],generation=s.generation;
 try{if(!actions[action])throw Error('Choose a supported action.');const config=actions[action](),token=input(config.customer?'customer-token':'staff-token');s.controller=new AbortController();
  for(const button of $(name+'-form').querySelectorAll('button'))button.disabled=true;
  const response=await fetch(config.path,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(config.data),signal:s.controller.signal}),result=await response.json();
  if(generation!==s.generation)return;if(!response.ok)throw Error(typeof result.error==='string'?result.error:'REQUEST_FAILED');
  summarize(name,result);say(name,'Source response received. '+(config.customer?'Customer request recorded.':'Review the returned state before taking the next step.'));
 }catch(error){if(generation===s.generation&&error.name!=='AbortError')say(name,'Unable to complete this request: '+error.message,true);}
 finally{if(generation===s.generation){s.controller=null;for(const button of $(name+'-form').querySelectorAll('button'))button.disabled=false;}}
}
for(const name of groups){$(name+'-form').addEventListener('submit',event=>{event.preventDefault();submit(name,event.submitter?.dataset.action);});for(const field of $(name+'-form').querySelectorAll('input'))for(const event of ['input','change'])field.addEventListener(event,()=>reset(name));}
for(const id of ['risk-case','risk-quote'])for(const event of ['input','change'])$(id).addEventListener(event,()=>{$('risk-id').value='';$('risk-digest').value='';});
for(const id of ['prevention-case','prevention-line','prevention-variant'])for(const event of ['input','change'])$(id).addEventListener(event,()=>{$('prevention-quote').value='';$('prevention-digest').value='';});
for(const id of ['staff-token','customer-token'])for(const event of ['input','change'])$(id).addEventListener(event,()=>groups.forEach(name=>reset(name,'Session changed. Request a fresh result.')));
window.addEventListener('pagehide',()=>{$('staff-token').value='';$('customer-token').value='';groups.forEach(name=>reset(name));});
