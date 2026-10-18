import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { spawn } from 'node:child_process';
import { CURRENCIES, decimalMoney } from '../../packages/commerce/money.mts';
import { evaluateReturn } from '../../packages/commerce/return-eligibility.mts';
import { usingReturns } from './return-intake-helpers.mts';
import { startCommerceServer } from '../../apps/commerce-api/server.mts';

const source=readFileSync(new URL('../../packages/presentation/locale-presentation.js',import.meta.url),'utf8');
function presentation(code=source):any {
  const context:any={Intl,Date,BigInt,Number,Object,Array,String,Error,JSON};
  runInNewContext(code,context);return context.RifarePresentation;
}
const p=presentation(),plain=(value:any)=>JSON.parse(JSON.stringify(value));
const en={locale:'en-US',time_zone:'UTC'},de={locale:'de-DE',time_zone:'Europe/Berlin'};
const spaces=(text:string)=>text.replace(/[\u00a0\u202f]/g,' ');
const amount=(minor:string,currency='USD',locale='en-US')=>p.amount({minor,currency},{locale,time_zone:'UTC'});
const spring=Date.parse('2026-03-08T09:30:00.000Z'),fall=Date.parse('2026-11-01T08:30:00.000Z');

async function browser(f:any,scenario:string) {
  const server=await startCommerceServer({kernel:f.kernel,caps:f.caps,customers:f.customers,simulator:f.simulator,reads:f.reads});
  try {
    const input={scenario,url:server.url,at:f.now(),token:f.customerBearer,resource:f.order().id};
    const r=await new Promise<{code:number|null,out:string,err:string}>((resolve,reject)=>{
      const child=spawn(process.env.RIFARE_TEST_PYTHON||'python3',['tests/browser/locale_workflows.py'],
        {env:{...process.env,RIFARE_TEST_INPUT:JSON.stringify(input)},stdio:['ignore','pipe','pipe']});
      let out='',err='';const timer=setTimeout(()=>child.kill('SIGTERM'),20000);
      child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
      child.on('error',error=>{clearTimeout(timer);reject(error);});
      child.on('close',code=>{clearTimeout(timer);resolve({code,out,err});});
    });
    assert.equal(r.code,0,r.err);const result=JSON.parse(r.out);
    assert.equal(result.passed,true);assert.equal(result.scenario,scenario);assert.deepEqual(result.direct_browser_network,[]);
    assert.equal(result.human_assistive_technology_observed,false);
    console.log(JSON.stringify({locale_observation:result}));return result;
  }finally{await server.close();}
}
function calculation(f:any,delivered:string,now:number,zone='America/Denver') {
  return evaluateReturn({order:{...f.order(),payload:{...f.order().payload,delivered_at:Date.parse(delivered)}},
    settings:{...f.settings,time_zone:zone},rules:{window_days:1,require_evidence:false,excluded_tags:[],outcomes:['refund']},
    selection:f.selection(),now});
}

test('CASE-M07-G16-01',()=>usingReturns(async f=>{
  const before=JSON.stringify(f.order());const r=await browser(f,'presentation');
  assert.equal(JSON.stringify(f.order()),before);assert.equal(r.return_quote_count,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_return_quotes').get().n,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_return_requests').get().n,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_action_receipts').get().n,0);
}));
test('CASE-M07-G16-02',()=>usingReturns(async f=>{
  await browser(f,'invalid-source');
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_return_requests').get().n,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_action_receipts').get().n,0);
}));
test('CASE-M07-G16-03',()=>usingReturns(f=>{
  // One elapsed day crosses Denver's spring clock change: 02:30 becomes 03:30.
  for(const offset of [-1,0,1]){
    const d=calculation(f,'2026-03-07T09:30:00.000Z',spring+offset);
    assert.equal(d.deadline,spring);assert.equal(d.deadline_utc,'2026-03-08T09:30:00.000Z');
    assert.equal(d.decision,offset<=0?'allow':'review');
    const shown=p.deadline(d,en);assert.equal(shown.policy.time_zone,'America/Denver');
    assert.equal(shown.policy.parts.hour,'03');assert.equal(shown.policy.parts.minute,'30');
  }
  const marker='const raw=value.amount;';assert.equal(source.split(marker).length,2);
  const mutant=presentation(source.replace(marker,"const raw=typeof value.amount==='string'?value.amount.replaceAll('.', '').replace(',', '.'):value.amount;"));
  const rejectLocalized=(implementation:any)=>assert.throws(()=>implementation.sourceAmount({amount:'1.234,56',currency:'USD'}),/INVALID_CANONICAL_DECIMAL/);
  rejectLocalized(p);assert.throws(()=>rejectLocalized(mutant),assert.AssertionError);
  assert.equal(mutant.sourceAmount({amount:'1.234,56',currency:'USD'}).minor,'123456');
  console.log(JSON.stringify({targeted_fault:'localized_decimal_reinterpreted_as_canonical',detected:true}));
}));
test('M07-G16-CURRENCY-GOLDENS',()=>{
  for(const [locale,expected] of [['en-US','USD 1,234.56'],['en-GB','USD 1,234.56'],['de-DE','1.234,56 USD'],['fr-FR','1 234,56 USD'],['ja-JP','USD 1,234.56']]){
    const r=amount('123456','USD',locale);assert.equal(spaces(r.formatted),expected);
    assert.deepEqual(plain(r.canonical),{minor:'123456',currency:'USD'});assert.equal(r.decimal,'1234.56');
  }
});
test('M07-G16-LARGE-AND-NEGATIVE-EXACT',()=>{
  assert.equal(spaces(amount('900719925474099312345678901234567890').formatted),'USD 9,007,199,254,740,993,123,456,789,012,345,678.90');
  assert.equal(spaces(amount('-1').formatted),'-USD 0.01');
  assert.equal(spaces(amount('-1001','KWD').formatted),'-KWD 1.001');
  assert.equal(amount('0','JPY').decimal,'0');
  for(const value of ['-0','+1','01','1.0','1,00',' 1','1e3','١٢', '1'.repeat(37),1,Number.MAX_SAFE_INTEGER])assert.throws(()=>amount(value as string),/INVALID_MINOR_UNITS/);
});
test('M07-G16-EXISTING-CURRENCY-MODEL',()=>{
  assert.deepEqual(plain(p.currencies),CURRENCIES);
  for(const [currency,scale] of Object.entries(CURRENCIES)){
    const r=amount('12345',currency,'de-DE');assert.equal(r.exponent,scale);
    assert.equal(r.decimal,scale===0?'12345':scale===2?'123.45':'12.345');
    assert.deepEqual(plain(r.canonical),{currency,minor:'12345'});
  }
  for(const currency of ['AUD','usd','XXX','BTC','US',null])assert.throws(()=>amount('1',currency as string),/UNSUPPORTED_CURRENCY/);
});
test('M07-G16-SOURCE-TOTALS-STRICT',()=>{
  assert.deepEqual(plain(p.sourceAmount({amount_minor:12500,currency:'USD'})),{minor:'12500',currency:'USD'});
  assert.deepEqual(plain(p.sourceAmount({amount_minor:'9007199254740993',currency:'USD'})),{minor:'9007199254740993',currency:'USD'});
  assert.deepEqual(plain(p.sourceAmount({amount:'1.001',currency:'KWD'})),decimalMoney('KWD','1.001'));
  for(const value of ['1,234.56','1.234,56','1 234,56','USD 1.00','1e3','01.00',' 1.00','1.001'])assert.throws(()=>p.sourceAmount({amount:value,currency:'USD'}),/INVALID_CANONICAL_DECIMAL/);
  for(const value of [{amount_minor:9007199254740992,currency:'USD'},{amount_minor:1.2,currency:'USD'},{amount:1,currency:'USD'},{minor:'100',amount:'1.00',currency:'USD'}])assert.throws(()=>p.sourceAmount(value),/INVALID_SOURCE_AMOUNT|INVALID_CANONICAL_DECIMAL/);
});
test('M07-G16-INSTANT-GOLDENS',()=>{
  const before=p.instant('2026-03-08T08:30:00.000Z',{locale:'en-US',time_zone:'America/Denver'});
  const after=p.instant(spring,{locale:'en-US',time_zone:'America/Denver'});
  assert.deepEqual(plain(before.parts),{year:'2026',month:'03',day:'08',hour:'01',minute:'30',second:'00',fractionalSecond:'000',timeZoneName:'GMT-07:00'});
  assert.deepEqual(plain(after.parts),{year:'2026',month:'03',day:'08',hour:'03',minute:'30',second:'00',fractionalSecond:'000',timeZoneName:'GMT-06:00'});
  assert.equal(after.iso,'2026-03-08T09:30:00.000Z');assert.equal(after.epoch_ms,spring);
  const german=p.instant(spring,de);assert.equal(german.parts.hour,'10');assert.equal(german.parts.day,'08');
  assert(german.formatted.includes('08.03.2026'));assert(before.formatted.includes('03/08/2026'));
});
test('M07-G16-INVALID-INSTANTS',()=>{
  for(const value of ['03/08/2026','2026-03-08','2026-03-08T02:30:00','2026-03-08T09:30:00+00:00','2026-02-30T09:30:00.000Z','2026-03-08T09:30:60.000Z',null,NaN,Infinity,1.1,-1,253402300800000,new Date(0)])assert.throws(()=>p.instant(value,en),/INVALID_CANONICAL_INSTANT/);
  assert.equal(p.instant(0,en).iso,'1970-01-01T00:00:00.000Z');
});
test('M07-G16-EXPLICIT-LOCALE-AND-ZONE',()=>{
  assert.deepEqual(plain(p.preferences(en)),en);
  for(const prefs of [undefined,{}, {locale:'de',time_zone:'UTC'},{locale:'en-US-u-nu-arab',time_zone:'UTC'},{locale:'en-US',time_zone:'GMT-07:00'},{locale:'en-US',time_zone:'local'},{...en,currency:'EUR'}])assert.throws(()=>p.preferences(prefs),/EXPLICIT_PRESENTATION_REQUIRED|UNSUPPORTED_LOCALE|UNSUPPORTED_DISPLAY_TIME_ZONE/);
  assert.equal(p.interface_language,'en');assert.equal(p.errorText('INVALID_CANONICAL_DECIMAL'),'A canonical decimal with a period is required. Formatted amounts cannot be used as inputs.');
});
test('M07-G16-FALL-BACK-DEADLINE',()=>usingReturns(f=>{
  for(const offset of [-1,0,1]){
    const d=calculation(f,'2026-10-31T08:30:00.000Z',fall+offset);
    assert.equal(d.deadline,fall);assert.equal(d.decision,offset<=0?'allow':'review');
    const shown=p.deadline(d,{locale:'en-US',time_zone:'America/New_York'});
    assert.equal(shown.policy.parts.hour,'01');assert.equal(shown.policy.parts.timeZoneName,'GMT-07:00');
    assert.equal(shown.display.parts.hour,'03');assert.equal(shown.canonical_utc,'2026-11-01T08:30:00.000Z');
  }
}));
test('M07-G16-UTC-DATE-BOUNDARY',()=>{
  const iso='2026-01-01T00:30:00.001Z';
  const west=p.instant(iso,{locale:'en-US',time_zone:'America/Denver'}),east=p.instant(iso,{locale:'ja-JP',time_zone:'Asia/Tokyo'});
  assert.equal(west.parts.year,'2025');assert.equal(west.parts.month,'12');assert.equal(west.parts.day,'31');assert.equal(west.parts.hour,'17');
  assert.equal(east.parts.year,'2026');assert.equal(east.parts.day,'01');assert.equal(east.parts.hour,'09');
  assert.equal(west.iso,east.iso);assert.equal(west.parts.fractionalSecond,'001');
});
test('M07-G16-DEADLINE-CANONICAL-FENCE',()=>usingReturns(f=>{
  const d=calculation(f,'2026-03-07T09:30:00.000Z',spring),original=JSON.stringify(d);
  for(const locale of p.locales)for(const time_zone of p.display_time_zones){const shown=p.deadline(d,{locale,time_zone});assert.equal(shown.canonical_epoch_ms,spring);assert.equal(shown.cutoff_semantics,'inclusive_elapsed_utc');}
  assert.equal(JSON.stringify(d),original);
  for(const patch of [{deadline_utc:'2026-03-08T08:30:00.000Z'},{cutoff_semantics:'calendar_days'},{time_zone:'invented/zone'},{deadline:'03/08/2026'}])assert.throws(()=>p.deadline({...d,...patch},en),/DEADLINE_PRESENTATION_MISMATCH|INVALID_POLICY_TIME_ZONE|INVALID_CANONICAL_INSTANT/);
}));
test('M07-G16-FORMATTED-TEXT-NEVER-SUBMITTED',()=>usingReturns(async f=>{
  const r=await browser(f,'confirmation');assert.equal(r.prepare_count,1);
  const row=f.db.prepare('SELECT body,quote_id FROM commerce_return_requests').get(),body=JSON.parse(row.body);
  assert.deepEqual(body.fees,{currency:'USD',gross_minor:'2000',restocking_minor:'200',shipping_minor:'100',net_minor:'1700',rounding:'restocking_floor_minor',estimated_only:true});
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_action_receipts').get().n,0);
  assert.equal(r.original_quote_identity_used,true);
}));
test('M07-G16-STATIC-ASSETS-AND-OPTIONAL-FALLBACK',()=>usingReturns(async f=>{
  const r=await browser(f,'fallback');assert.equal(r.canonical_fallback,true);
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_return_requests').get().n,0);
}));
