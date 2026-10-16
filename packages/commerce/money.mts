import { exact,id } from './kernel.mts';

// Versioned diagnostic subset; adapter-specific currency rules must remain explicit.
export const CURRENCIES=Object.freeze({USD:2,EUR:2,GBP:2,CAD:2,JPY:0,KWD:3,BHD:3});
export type Currency=keyof typeof CURRENCIES;
export type Money=Readonly<{currency:Currency;minor:string}>;
export type Rounding='half_even'|'half_up'|'floor'|'ceiling'|'toward_zero';
function count(value:unknown,signed=false):bigint {
  if(typeof value!=='string'||value.length>37||!(signed?/^-?(0|[1-9][0-9]{0,35})$/:/^(0|[1-9][0-9]{0,35})$/).test(value)||value==='-0')throw new Error('INVALID_MINOR_UNITS');
  return BigInt(value);
}
function currency(value:unknown):Currency {
  if(typeof value!=='string'||!Object.hasOwn(CURRENCIES,value))throw new Error('UNSUPPORTED_CURRENCY');return value as Currency;
}
export function money(code:unknown,minor:unknown,signed=false):Money {
  const c=currency(code),n=count(minor,signed);return Object.freeze({currency:c,minor:n.toString()});
}
function check(value:unknown,signed=true):Money {
  const r=exact(value,['currency','minor']);return money(r.currency,r.minor,signed);
}
export function decimalMoney(code:unknown,decimal:unknown,signed=false):Money {
  const c=currency(code),scale=CURRENCIES[c];
  if(typeof decimal!=='string'||decimal.length>40||!/^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.test(decimal))throw new Error('INVALID_DECIMAL');
  const [,minus,whole,frac='']=/^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(decimal)!;
  if((minus&&!signed)||frac.length>scale)throw new Error('INVALID_PRECISION');
  const n=(BigInt(whole)*10n**BigInt(scale)+BigInt(frac.padEnd(scale,'0')||'0'))*(minus?-1n:1n);
  return money(c,n.toString(),signed);
}
export function decimalString(value:Money) {
  const m=check(value),n=BigInt(m.minor),abs=n<0?-n:n,scale=CURRENCIES[m.currency];
  const s=abs.toString().padStart(scale+1,'0');return (n<0?'-':'')+(scale?s.slice(0,-scale)+'.'+s.slice(-scale):s);
}
export function addMoney(a:Money,b:Money):Money {
  a=check(a);b=check(b);if(a.currency!==b.currency)throw new Error('CURRENCY_MISMATCH');return money(a.currency,(BigInt(a.minor)+BigInt(b.minor)).toString(),true);
}
export function subtractMoney(a:Money,b:Money,unsigned=true):Money {
  a=check(a);b=check(b);if(a.currency!==b.currency)throw new Error('CURRENCY_MISMATCH');return money(a.currency,(BigInt(a.minor)-BigInt(b.minor)).toString(),!unsigned);
}
export function ratioMoney(value:Money,numerator:string,denominator:string,mode:Rounding) {
  const m=check(value),num=count(numerator,true),den=count(denominator);if(den===0n)throw new Error('ZERO_DENOMINATOR');
  if(!['half_even','half_up','floor','ceiling','toward_zero'].includes(mode))throw new Error('ROUNDING_REQUIRED');
  const n=BigInt(m.minor)*num;let q=n/den;const r=n%den,sign=n<0?-1n:1n,abs=r<0?-r:r;
  if(r!==0n&&((mode==='floor'&&n<0)||(mode==='ceiling'&&n>0)
    ||(mode==='half_up'&&2n*abs>=den)||(mode==='half_even'&&(2n*abs>den||(2n*abs===den&&q%2n!==0n)))))q+=sign;
  return {money:money(m.currency,q.toString(),true),rounding:mode,
    residue:{numerator:(n-q*den).toString(),denominator:den.toString()}};
}
export function allocateMoney(value:Money,weights:{id:string;weight:string}[]) {
  const m=check(value,false);if(!Array.isArray(weights)||!weights.length||weights.length>10000)throw new Error('INVALID_ALLOCATION');
  const seen=new Set();const rows=weights.map(w=>{exact(w,['id','weight']);id(w.id);if(seen.has(w.id))throw new Error('DUPLICATE_ALLOCATION');seen.add(w.id);return {id:w.id,w:count(w.weight)};});
  const totalWeight=rows.reduce((n,r)=>n+r.w,0n);if(totalWeight===0n)throw new Error('ZERO_WEIGHT');
  const total=BigInt(m.minor);const shares=rows.map(r=>({id:r.id,amount:total*r.w/totalWeight,remainder:total*r.w%totalWeight}));
  let left=total-shares.reduce((n,r)=>n+r.amount,0n);
  for(const r of [...shares].sort((a,b)=>a.remainder===b.remainder?(a.id<b.id?-1:a.id>b.id?1:0):a.remainder>b.remainder?-1:1)){
    if(left===0n)break;r.amount++;r.remainder-=totalWeight;left--;
  }
  return shares.map(r=>({id:r.id,amount:money(m.currency,r.amount.toString()),
    fraction_residue:{numerator:r.remainder.toString(),denominator:totalWeight.toString()},method:'largest_remainder_id_tiebreak'}));
}
export function remainingMoney(original:Money,prior:Money[]):Money {
  original=check(original,false);if(!Array.isArray(prior)||prior.length>10000)throw new Error('INVALID_ALLOCATION');
  let result=original;for(const p of prior)result=subtractMoney(result,check(p,false));return result;
}
export function unitReturnMoney(original:Money,totalQuantity:string,alreadyReturned:string,returnQuantity:string):Money {
  original=check(original,false);const total=count(totalQuantity),prior=count(alreadyReturned),qty=count(returnQuantity);
  if(total===0n||qty===0n||prior+qty>total)throw new Error('QUANTITY_EXCEEDED');
  // Cumulative-floor delta allocates every residual cent exactly once across partial returns.
  const paid=BigInt(original.minor);return money(original.currency,(paid*(prior+qty)/total-paid*prior/total).toString());
}
export function pairedAmounts(original:Money,presentment:Money,rateReference:string) {
  id(rateReference);return Object.freeze({original:check(original,false),presentment:check(presentment,false),rate_reference:rateReference,
    conversion_performed:false});
}
