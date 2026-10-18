'use strict';
// Shared browser/Node presentation code. This module makes no source decision,
// stores no preferences, and never returns a formatted string as an action input.
(() => {
  const currencies=Object.freeze({USD:2,EUR:2,GBP:2,CAD:2,JPY:0,KWD:3,BHD:3});
  const locales=Object.freeze(['en-US','en-GB','de-DE','fr-FR','ja-JP']);
  const display_time_zones=Object.freeze(['UTC','America/Denver','America/New_York','Europe/Berlin','Asia/Tokyo']);
  const hasShape=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)
    &&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
  function preferences(value) {
    if(!hasShape(value,['locale','time_zone']))throw new Error('EXPLICIT_PRESENTATION_REQUIRED');
    if(!locales.includes(value.locale))throw new Error('UNSUPPORTED_LOCALE');
    if(!display_time_zones.includes(value.time_zone))throw new Error('UNSUPPORTED_DISPLAY_TIME_ZONE');
    return Object.freeze({locale:value.locale,time_zone:value.time_zone});
  }
  function currency(value) {
    if(typeof value!=='string'||!Object.hasOwn(currencies,value))throw new Error('UNSUPPORTED_CURRENCY');
    return value;
  }
  function canonicalMoney(value) {
    if(!hasShape(value,['minor','currency']))throw new Error('INVALID_SOURCE_AMOUNT');
    const code=currency(value.currency),minor=value.minor;
    // Mirrors the retained money module's supported, signed integer-minor model.
    if(typeof minor!=='string'||minor.length>37||! /^-?(0|[1-9][0-9]{0,35})$/.test(minor)||minor==='-0')throw new Error('INVALID_MINOR_UNITS');
    return Object.freeze({minor,currency:code});
  }
  function sourceAmount(value) {
    if(hasShape(value,['minor','currency']))return canonicalMoney(value);
    if(hasShape(value,['amount_minor','currency'])){
      const minor=value.amount_minor;
      if(typeof minor==='number'&&!Number.isSafeInteger(minor))throw new Error('INVALID_SOURCE_AMOUNT');
      return canonicalMoney({minor:typeof minor==='number'?String(minor):minor,currency:value.currency});
    }
    if(!hasShape(value,['amount','currency']))throw new Error('INVALID_SOURCE_AMOUNT');
    const code=currency(value.currency),scale=currencies[code];
    // Only the adapter's canonical period-decimal contract is accepted here.
    const raw=value.amount;
    if(typeof raw!=='string'||raw.length>40)throw new Error('INVALID_CANONICAL_DECIMAL');
    const match=/^(-?)(0|[1-9][0-9]{0,35})(?:\.([0-9]+))?$/.exec(raw);
    if(!match||(match[3]||'').length>scale)throw new Error('INVALID_CANONICAL_DECIMAL');
    const magnitude=BigInt(match[2])*10n**BigInt(scale)+BigInt((match[3]||'').padEnd(scale,'0')||'0');
    return canonicalMoney({minor:(match[1]?-magnitude:magnitude).toString(),currency:code});
  }
  function amount(value,options) {
    const prefs=preferences(options),canonical=canonicalMoney(value),scale=currencies[canonical.currency];
    const n=BigInt(canonical.minor),negative=n<0n,magnitude=negative?-n:n,factor=10n**BigInt(scale);
    const whole=magnitude/factor,fraction=(magnitude%factor).toString().padStart(scale,'0');
    const formatter=new Intl.NumberFormat(prefs.locale,{style:'currency',currency:canonical.currency,currencyDisplay:'code',
      currencySign:'standard',minimumFractionDigits:scale,maximumFractionDigits:scale,numberingSystem:'latn'});
    // BigInt preserves every whole-unit digit. The only Number sent here is -0,
    // used solely to retain the sign of a negative amount smaller than one unit.
    const signedWhole=negative?(whole===0n?-0:-whole):whole;
    const formatted=formatter.formatToParts(signedWhole).map(part=>part.type==='fraction'?fraction:part.value).join('');
    return Object.freeze({canonical,exponent:scale,decimal:(negative?'-':'')+whole.toString()+(scale?'.'+fraction:''),
      formatted,locale:prefs.locale});
  }
  function canonicalInstant(value) {
    let epoch=value;
    if(typeof value==='string'){
      if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value))throw new Error('INVALID_CANONICAL_INSTANT');
      epoch=Date.parse(value);
    }
    if(typeof epoch!=='number'||!Number.isSafeInteger(epoch)||epoch<0||epoch>253402300799999)throw new Error('INVALID_CANONICAL_INSTANT');
    const iso=new Date(epoch).toISOString();
    if(typeof value==='string'&&iso!==value)throw new Error('INVALID_CANONICAL_INSTANT');
    return {epoch_ms:epoch,iso};
  }
  function policyZone(value) {
    if(typeof value!=='string'||value.length<1||value.length>64)throw new Error('INVALID_POLICY_TIME_ZONE');
    try{new Intl.DateTimeFormat('en-US',{timeZone:value}).format(0);}catch{throw new Error('INVALID_POLICY_TIME_ZONE');}
    return value;
  }
  function instantIn(value,locale,time_zone) {
    const canonical=canonicalInstant(value);
    const formatter=new Intl.DateTimeFormat(locale,{timeZone:time_zone,calendar:'gregory',numberingSystem:'latn',
      year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',
      fractionalSecondDigits:3,hourCycle:'h23',timeZoneName:'longOffset'});
    const formattedParts=formatter.formatToParts(canonical.epoch_ms),parts={};
    for(const key of ['year','month','day','hour','minute','second','fractionalSecond','timeZoneName'])parts[key]=formattedParts.find(part=>part.type===key).value;
    return Object.freeze({...canonical,locale,time_zone,formatted:formatter.format(canonical.epoch_ms),parts:Object.freeze(parts)});
  }
  function instant(value,options) {
    const prefs=preferences(options);return instantIn(value,prefs.locale,prefs.time_zone);
  }
  function deadline(value,options) {
    const prefs=preferences(options),canonical=canonicalInstant(value?.deadline),claimed=canonicalInstant(value?.deadline_utc);
    if(canonical.epoch_ms!==claimed.epoch_ms||value.cutoff_semantics!=='inclusive_elapsed_utc')throw new Error('DEADLINE_PRESENTATION_MISMATCH');
    const zone=policyZone(value.time_zone);
    return Object.freeze({canonical_epoch_ms:canonical.epoch_ms,canonical_utc:canonical.iso,policy_time_zone:zone,
      cutoff_semantics:value.cutoff_semantics,display:instantIn(canonical.epoch_ms,prefs.locale,prefs.time_zone),
      policy:instantIn(canonical.epoch_ms,prefs.locale,zone)});
  }
  const errors=Object.freeze({
    INVALID_MINOR_UNITS:'An amount must use canonical integer minor units. Formatted amounts cannot be used as inputs.',
    INVALID_CANONICAL_DECIMAL:'A canonical decimal with a period is required. Formatted amounts cannot be used as inputs.',
    INVALID_SOURCE_AMOUNT:'The source amount is unavailable or ambiguous. Request a verified canonical amount.',
    UNSUPPORTED_CURRENCY:'This currency is not supported for formatting. The source currency cannot be replaced.',
    CURRENCY_EXPONENT_MISMATCH:'The currency precision does not match the supported source contract.',
    INVALID_CANONICAL_INSTANT:'A fixed UTC timestamp is required. Local dates and times cannot determine a deadline.',
    INVALID_POLICY_TIME_ZONE:'The policy time zone is unavailable. Request a verified deadline.',
    DEADLINE_PRESENTATION_MISMATCH:'The deadline values do not agree. Request a new server estimate.',
    EXPLICIT_PRESENTATION_REQUIRED:'Choose an explicit number/date format and display time zone.',
    UNSUPPORTED_LOCALE:'Choose one of the listed number and date formats.',
    UNSUPPORTED_DISPLAY_TIME_ZONE:'Choose one of the listed display time zones.'
  });
  globalThis.RifarePresentation=Object.freeze({version:1,currencies,locales,display_time_zones,interface_language:'en',
    preferences,sourceAmount,amount,instant,deadline,isError:code=>Object.hasOwn(errors,code),errorText:code=>Object.hasOwn(errors,code)?errors[code]:'Presentation unavailable. Request verified source values.'});
})();
