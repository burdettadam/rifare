import {CommerceKernel,exact,id,integer} from './kernel.mts';
import type {Scope,Row} from './kernel.mts';
import {canonical,contentDigest,jsonValue} from './configuration-values.mts';
import {supportCase} from './support-core.mts';
import {LoyaltyBalances} from './loyalty-balances.mts';
import {ResolutionExecution} from './resolution-execution.mts';
import {ExchangeLineage} from './exchange-lineage.mts';
import {loyaltyAccrualEvidence,LoyaltyAccrualEvidenceError} from './loyalty-accrual-evidence.mts';
import {LoyaltyFixtureSource,assertSeparateLoyaltyDatabases} from '../adapters/loyalty-fixture-source.mts';
import {LoyaltyAccrualFixtureSource,LoyaltyAccrualScopeError} from '../adapters/loyalty-accrual-fixture-source.mts';
import {ResolutionFixtureSource} from '../adapters/resolution-fixture-source.mts';
import {ExchangeLineageFixtureSource} from '../adapters/exchange-lineage-fixture-source.mts';
import {FulfillmentFixtureSource} from '../adapters/fulfillment-fixture-source.mts';

type Owners={balances:LoyaltyBalances;finance:ResolutionExecution;lineage:ExchangeLineage;accrual:LoyaltyAccrualFixtureSource};
const STAFF=['operator','reviewer','owner','worker'];
const flags={model_required:false,execution_authorized:false,enrollment_authorized:false,send_authorized:false,monetary_conversion_supported:false,production_qualified:false};
function points(value:bigint){if(value<0n||value>BigInt(Number.MAX_SAFE_INTEGER))throw new LoyaltyAccrualEvidenceError('unsupported','LOYALTY_POINTS_LIMIT');return Number(value);}

/** Staff-only cumulative proposals. No amount here is a spendable balance or an effect command. */
export class LoyaltyAccrual {
  readonly k:CommerceKernel;readonly balances:LoyaltyBalances;readonly finance:ResolutionExecution;readonly lineage:ExchangeLineage;readonly accrual:LoyaltyAccrualFixtureSource;
  #sources:Row;#binding:string;#persisted:string;
  constructor(k:CommerceKernel,owners:Owners){
    if(!owners||typeof owners!=='object'||Array.isArray(owners))throw new Error('LOYALTY_SOURCE_OWNER_MISMATCH');
    const descriptors=Object.getOwnPropertyDescriptors(owners),keys=Reflect.ownKeys(owners);
    if(keys.length!==4||keys.some(key=>typeof key!=='string'||!['balances','finance','lineage','accrual'].includes(key)||!Object.hasOwn(descriptors[key],'value')))throw new Error('LOYALTY_SOURCE_OWNER_MISMATCH');
    const {balances,finance,lineage,accrual}=owners;
    if(!(k instanceof CommerceKernel)||!(balances instanceof LoyaltyBalances)||!(finance instanceof ResolutionExecution)||!(lineage instanceof ExchangeLineage)||!(accrual instanceof LoyaltyAccrualFixtureSource)||balances.k!==k||finance.kernel!==k||lineage.kernel!==k||!(balances.source instanceof LoyaltyFixtureSource)||!(finance.source instanceof ResolutionFixtureSource)||!(lineage.source instanceof ExchangeLineageFixtureSource)||!(lineage.source.fulfillment instanceof FulfillmentFixtureSource)||finance.source!==lineage.source.finance||lineage.source.fulfillment.financeSource!==finance.source||accrual.source!==balances.source)throw new Error('LOYALTY_SOURCE_OWNER_MISMATCH');
    this.k=k;this.balances=balances;this.finance=finance;this.lineage=lineage;this.accrual=accrual;
    this.#sources=Object.freeze({balance:balances.source,finance:finance.source,lineage:lineage.source,fulfillment:lineage.source.fulfillment,core:k.db,finance_db:finance.source.db,fulfillment_db:lineage.source.fulfillment.db,loyalty_db:balances.source.db});
    this.#binding=this.#identity();this.#assertSources();this.#persisted=this.#durableIdentity();Object.freeze(this);
  }
  #identity(){return canonical([this.balances.source,this.finance.source,this.lineage.source,this.lineage.source.fulfillment,this.accrual].map(source=>({identity:source!.identity,tenant:source!.tenant,store:source!.store})));}
  #durableIdentity(){
    const finance=this.#sources.finance_db.prepare('SELECT * FROM fixture_resolution_identity LIMIT 2').all() as Row[],fulfillment=this.#sources.fulfillment_db.prepare('SELECT * FROM fixture_identity LIMIT 2').all() as Row[];
    if(finance.length!==1||fulfillment.length!==1)throw new LoyaltyAccrualScopeError();
    try{exact(finance[0],['id','label','identity','tenant','store']);exact(fulfillment[0],['id','tenant','store','label']);id(finance[0].label);id(fulfillment[0].label);}catch{throw new LoyaltyAccrualScopeError();}
    if(finance[0].id!==1||finance[0].identity!==this.#sources.finance.identity||finance[0].tenant!==this.#sources.finance.tenant||finance[0].store!==this.#sources.finance.store||fulfillment[0].id!==this.#sources.fulfillment.identity||fulfillment[0].tenant!==this.#sources.fulfillment.tenant||fulfillment[0].store!==this.#sources.fulfillment.store)throw new LoyaltyAccrualScopeError();
    return canonical({finance:finance[0],fulfillment:fulfillment[0]});
  }
  #assertSources(s?:Row){
    const refs=this.#sources;
    if(this.k.db!==refs.core||this.balances.k!==this.k||this.finance.kernel!==this.k||this.lineage.kernel!==this.k||this.balances.source!==refs.balance||this.finance.source!==refs.finance||this.lineage.source!==refs.lineage||this.lineage.source.finance!==refs.finance||this.lineage.source.fulfillment!==refs.fulfillment||this.lineage.source.fulfillment.financeSource!==refs.finance||this.accrual.source!==refs.balance||this.accrual.db!==refs.loyalty_db||this.finance.source.db!==refs.finance_db||this.lineage.source.db!==refs.finance_db||this.lineage.source.fulfillment.db!==refs.fulfillment_db||this.#identity()!==this.#binding)throw new LoyaltyAccrualScopeError();
    const databases=[refs.core,refs.finance_db,refs.fulfillment_db,refs.loyalty_db];for(let i=0;i<databases.length;i++)for(let j=i+1;j<databases.length;j++)assertSeparateLoyaltyDatabases(databases[i],databases[j]);
    const expected=s??{tenant_id:this.balances.source!.tenant,store_id:this.balances.source!.store};
    for(const source of [refs.balance,refs.finance,refs.lineage,refs.fulfillment,this.accrual])if(source.tenant!==expected.tenant_id||source.store!==expected.store_id)throw new LoyaltyAccrualScopeError();
  }
  #readSources<T>(read:()=>T):T {
    // Stable read snapshots also cover source-side captures and descendants during the core transaction.
    const opened:any[]=[];try{for(const db of [this.#sources.loyalty_db,this.#sources.finance_db,this.#sources.fulfillment_db]){db.exec('SAVEPOINT loyalty_accrual_projection');opened.push(db);}return read();}
    finally{for(const db of opened.reverse())db.exec('RELEASE loyalty_accrual_projection');}
  }
  project(scope:Scope,customerProof:Scope,value:unknown){
    const p=exact(jsonValue(value,32768),['case_id','link_id','expected_generation']);id(p.case_id);id(p.link_id);integer(p.expected_generation,1);
    const k=this.k;return k.transaction(()=>{
      const s=k.require(scope,['operator','reviewer','owner','worker']);if(!STAFF.includes(s.role))throw new Error('ACCESS_DENIED');this.#assertSources(s);
      return this.#readSources(()=>{
        if(this.#durableIdentity()!==this.#persisted)throw new LoyaltyAccrualScopeError();
        const context=this.balances.context(scope,customerProof,p),{c}=supportCase(k,scope,p.case_id);
        let rule:Row|null=null,economic:Row|null=null;
        const finish=(status:string,reason:string,units:Row[]=[],events:Row[]=[],proposals:Row[]=[],totals:Row|null=null)=>{
          const output={schema_version:1,case_id:c.id,resource_id:c.resource_id,status,reason,context_digest:context.context_digest,source_revision:context.snapshot?.source_revision??null,rule_revision:rule?.rules.rules.revision??null,rule_digest:rule?.rules.digest??null,units,events,proposals,totals,...flags};
          return {...output,projection_digest:contentDigest({projection:output,original_source_digest:contentDigest(c.order),historical_pin_digest:rule?.pin.digest??null,evidence_digest:economic?.evidence_digest??null})};
        };
        if(context.status!=='available')return finish(context.status,context.reason);
        const knownChild=k.db.prepare('SELECT 1 FROM commerce_exchange_lineage_nodes WHERE tenant_id=? AND store_id=? AND resource_id=?').get(s.tenant_id,s.store_id,c.resource_id)||this.lineage.source.db.prepare('SELECT 1 FROM fixture_exchange_lineage_nodes WHERE resource_id=?').get(c.resource_id);
        if(knownChild)return finish('unsupported','LOYALTY_ORIGINAL_SCOPE_REQUIRED');
        try{rule=this.accrual.readOriginal(c.resource_id,c.customer_id);}catch(error){if(error instanceof LoyaltyAccrualScopeError)throw error;return finish(error instanceof Error&&error.message==='LOYALTY_ACCRUAL_RULES_REQUIRED'?'pending':'discrepant','LOYALTY_HISTORICAL_RULE_EVIDENCE_REQUIRED');}
        if(!rule)return finish('pending','LOYALTY_HISTORICAL_PIN_REQUIRED');
        try{
          economic=loyaltyAccrualEvidence(k,scope,c,this.finance,this.lineage,rule);
          const divisor=BigInt(rule.rules.rules.minor_per_point),capabilities=context.snapshot!.capabilities,issues=[...economic.issues],units:Row[]=[],proposals:Row[]=[];
          let earnedTotal=0n,reversedTotal=0n;
          for(const unit of economic.units){
            const funded=BigInt(unit.original_paid_minor)+unit.additional,remaining=funded>=unit.refunds?funded-unit.refunds:0n,earned=funded/divisor,reversed=earned-remaining/divisor;
            const valid=unit.refunds<=funded;if(!valid)issues.push({state:'discrepant',reason:'LOYALTY_REFUND_EXCEEDS_FUNDED_UNIT'});
            const accrue=valid&&capabilities.accrue,reverse=valid&&capabilities.reverse;
            if(!capabilities.accrue||!capabilities.reverse)issues.push({state:'unsupported',reason:!capabilities.accrue?'LOYALTY_ACCRUAL_CAPABILITY_UNSUPPORTED':'LOYALTY_REVERSAL_CAPABILITY_UNSUPPORTED'});
            const out={original_line_id:unit.original_line_id,unit_index:unit.unit_index,original_paid_minor:unit.original_paid_minor,additional_paid_minor:unit.additional.toString(),settled_refund_minor:unit.refunds.toString(),earned_points:points(earned),reversal_points:points(reversed),net_points:points(earned-reversed)};units.push(out);
            for(const kind of ['accrual','reversal'])proposals.push({id:'loyalty_target_'+contentDigest({source_identity:this.accrual.identity,account_id:this.accrual.account,resource_id:c.resource_id,original_line_id:unit.original_line_id,unit_index:unit.unit_index,rule_digest:rule.rules.digest,kind}).slice(0,48),kind,original_line_id:unit.original_line_id,unit_index:unit.unit_index,points:kind==='accrual'?out.earned_points:out.reversal_points,eligible:kind==='accrual'?accrue:reverse,rule_revision:rule.rules.rules.revision,operation_ids:[...(kind==='accrual'?unit.accrual_operations:unit.reversal_operations)].sort()});
            if(accrue)earnedTotal+=earned;if(reverse)reversedTotal+=reversed;
          }
          const precedence=['discrepant','unsupported','pending'],state=precedence.find(state=>issues.some(issue=>issue.state===state))??'ready',reason=issues.filter(issue=>issue.state===state).map(issue=>issue.reason).sort()[0]??'LOYALTY_ORIGINAL_UNIT_PROJECTION_READY';
          const latest=this.balances.context(scope,customerProof,p);this.#assertSources(s);
          if(latest.context_digest!==context.context_digest)return finish(latest.status==='available'?'pending':latest.status,latest.status==='available'?'LOYALTY_CONTEXT_CHANGED':latest.reason);
          return finish(state,reason,units,economic.events,proposals,{earned_points:points(earnedTotal),reversal_points:points(reversedTotal),net_points:points(earnedTotal>=reversedTotal?earnedTotal-reversedTotal:0n)});
        }catch(error){if(error instanceof LoyaltyAccrualEvidenceError){if(error.evidence)economic=error.evidence;return finish(error.state,error.message,[],error.evidence?.events??[]);}throw error;}
      });
    });
  }
}
