'use strict';
(() => {
  const p=window.RifarePresentation,locale=document.getElementById('display-locale'),zone=document.getElementById('display-zone');
  const notice=document.getElementById('presentation-notice');
  if(!p||!locale||!zone||!notice)return;
  let prefs=p.preferences({locale:locale.value,time_zone:zone.value});
  function money(node,value,expectedScale) {
    const shown=p.amount(value,prefs);
    if(expectedScale!==undefined&&shown.exponent!==expectedScale)throw new Error('CURRENCY_EXPONENT_MISMATCH');
    node.textContent=shown.formatted;node.lang=prefs.locale;node.dataset.rifareMoney='true';
    node.dataset.canonicalMinor=shown.canonical.minor;node.dataset.canonicalCurrency=shown.canonical.currency;
    node.title='Canonical: '+shown.canonical.currency+' '+shown.decimal+' ('+shown.canonical.minor+' minor units)';
  }
  function instant(node,value) {
    const shown=p.instant(value,prefs);node.textContent=shown.formatted+' · '+shown.time_zone+' · '+shown.iso;
    node.lang=prefs.locale;node.dataset.rifareInstant=shown.iso;
  }
  function deadline(node,value) {
    const shown=p.deadline(value,prefs);
    node.replaceChildren();
    const display=document.createElement('span'),policy=document.createElement('span');
    display.lang=prefs.locale;display.textContent=shown.display.formatted+' ['+shown.display.time_zone+']';
    policy.lang=prefs.locale;policy.textContent=shown.policy.formatted+' ['+shown.policy_time_zone+']';
    node.append('Return deadline: ',display,'. Policy time: ',policy,'. Exact inclusive cutoff: '+shown.canonical_utc+'.');
    node.dataset.rifareDeadline=shown.canonical_utc;node.dataset.policyZone=shown.policy_time_zone;
  }
  function refresh() {
    for(const node of document.querySelectorAll('[data-rifare-money]'))money(node,{minor:node.dataset.canonicalMinor,currency:node.dataset.canonicalCurrency});
    for(const node of document.querySelectorAll('[data-rifare-instant]'))instant(node,node.dataset.rifareInstant);
    for(const node of document.querySelectorAll('[data-rifare-deadline]')){
      const iso=node.dataset.rifareDeadline,epoch=p.instant(iso,prefs).epoch_ms;
      deadline(node,{deadline:epoch,deadline_utc:iso,time_zone:node.dataset.policyZone,cutoff_semantics:'inclusive_elapsed_utc'});
    }
  }
  function describe(error) {
    notice.textContent=error?p.errorText(error.message):'Number/date format: '+prefs.locale+'. Display time zone: '+prefs.time_zone+'. Interface and errors: English.';
    notice.setAttribute('role',error?'alert':'status');notice.setAttribute('aria-live',error?'assertive':'polite');
  }
  function change() {
    try{prefs=p.preferences({locale:locale.value,time_zone:zone.value});refresh();describe();}
    catch(error){locale.value=prefs.locale;zone.value=prefs.time_zone;describe(error);}
  }
  locale.disabled=false;zone.disabled=false;locale.addEventListener('change',change);zone.addEventListener('change',change);describe();
  window.RifareLocale=Object.freeze({money,instant,deadline,sourceAmount:p.sourceAmount,errorText:p.errorText,isError:p.isError,
    preferences:()=>Object.freeze({...prefs})});
})();
