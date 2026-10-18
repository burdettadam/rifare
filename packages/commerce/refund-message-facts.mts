import type {CommerceKernel,Scope,Row} from './kernel.mts';
import {id} from './kernel.mts';
import {canonical,contentDigest} from './configuration-values.mts';
import {CaseConfigurations} from './case-configurations.mts';
import {ActionGateway} from './action-gateway.mts';
import {ResolutionExecution} from './resolution-execution.mts';
import {ResolutionFixtureSource} from '../adapters/resolution-fixture-source.mts';
import {WooRefundFixtureSource} from '../adapters/woocommerce/refund-fixture-source.mts';
import {money,decimalString} from './money.mts';
import type {RefundMessageReader} from './support-delivery.mts';

export const REFUND_MESSAGE_ERRORS=Object.freeze(['REFUND_MESSAGE_SOURCE_UNAVAILABLE','REFUND_MESSAGE_UNAVAILABLE','REFUND_MESSAGE_INTEGRITY','REFUND_MESSAGE_CONFIGURATION_CHANGED','REFUND_MESSAGE_SOURCE_CHANGED','REFUND_MESSAGE_STALE','REFUND_NOT_SETTLED','REFUND_ALREADY_SETTLED']);
function checked(row:Row|undefined){if(!row)throw new Error('REFUND_MESSAGE_UNAVAILABLE');const b=JSON.parse(row.body);if(contentDigest(b)!==row.digest)throw new Error('REFUND_MESSAGE_INTEGRITY');return b;}
/** Canonical finance receipts and independent source effects supply message facts.
 * Return closure and prose are deliberately absent from this decision. */
export class RefundMessageFacts implements RefundMessageReader {
 readonly k:CommerceKernel;readonly executions:ReadonlyMap<string,ResolutionExecution>;
 constructor(k:CommerceKernel,executions:ResolutionExecution[]){this.k=k;const sources=new Map<string,ResolutionExecution>();
  for(const execution of executions){if(!(execution instanceof ResolutionExecution)||execution.kernel!==k||sources.has(execution.source.identity))throw new Error('REFUND_MESSAGE_SOURCE_UNAVAILABLE');sources.set(execution.source.identity,execution);}this.executions=sources;
 }
 read(scope:Scope,caseId:string,operationId:string){
  const k=this.k,c=new CaseConfigurations(k).resume(scope,id(caseId)),s=k.authorize(scope,'support.read',c.resource_id);id(operationId);
  const op=k.db.prepare('SELECT * FROM commerce_resolution_operations WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,operationId) as Row;
  if(!op||op.case_id!==c.id||op.resource_id!==c.resource_id||op.kind!=='refund')throw new Error('REFUND_MESSAGE_UNAVAILABLE');
  const execution=this.executions.get(op.source_identity);if(!execution)throw new Error('REFUND_MESSAGE_SOURCE_UNAVAILABLE');
  const view=execution.read(scope,op.id),command=JSON.parse(op.command);if(contentDigest(command)!==op.digest)throw new Error('REFUND_MESSAGE_INTEGRITY');
  const q=checked(k.db.prepare('SELECT body,digest FROM commerce_resolution_quotes WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,op.quote_id) as Row);
  if(q.case_id!==c.id||q.resource_id!==c.resource_id||q.customer_id!==c.customer_id||q.configuration_digest!==c.configuration_digest||q.policy_digest!==c.pins.policy.digest)throw new Error('REFUND_MESSAGE_CONFIGURATION_CHANGED');
  const receipt=new ActionGateway(k).receipt(scope,op.receipt_id);
  if(receipt.resolution_operation_id!==op.id)throw new Error('REFUND_MESSAGE_INTEGRITY');
  const observation=(k.db.prepare('SELECT body,digest,observed_at FROM commerce_resolution_observations WHERE tenant_id=? AND store_id=? AND operation_id=? AND stage=? ORDER BY seq DESC LIMIT 1').get(s.tenant_id,s.store_id,op.id,op.state)) as Row;
  const recorded=checked(observation),source=execution.source;let proof:Row,sourceAt:number,settled=false,stage:string;
  if(source instanceof WooRefundFixtureSource){
   const independent=source.inspect(op.id),result=source.result(op.id);
   if(!independent||!result||independent.command_digest!==op.digest||canonical(independent.command)!==canonical(command)||independent.state!==op.state||canonical(result)!==canonical(recorded))throw new Error('REFUND_MESSAGE_SOURCE_CHANGED');
   proof=independent;sourceAt=independent.observed_at;
   settled=independent.state==='settled'&&independent.refund_record!==null&&independent.gateway_effect?.state==='settled'&&independent.gateway_effect?.settled===true;
   stage=result.woo_evidence.financial_stage;
  }else if(source instanceof ResolutionFixtureSource){
   const r=source.db.prepare('SELECT * FROM fixture_resolution_effects WHERE operation_id=?').get(op.id) as Row;
   if(!r||r.digest!==op.digest||canonical(JSON.parse(r.command))!==canonical(command)||canonical(JSON.parse(r.body))!==canonical(recorded)||recorded.state!==op.state)throw new Error('REFUND_MESSAGE_SOURCE_CHANGED');
   for(const key of Object.keys(command))if(canonical(recorded[key])!==canonical(command[key]))throw new Error('REFUND_MESSAGE_INTEGRITY');
   proof={command_digest:r.digest,effect:JSON.parse(r.body),qualification:'synthetic_only'};sourceAt=observation.observed_at;settled=op.state==='settled';stage=settled?'fixture_gateway_settled':op.state;
  }else throw new Error('REFUND_MESSAGE_SOURCE_UNAVAILABLE');
  const maxAge=c.pins.composition.effective['data.max_age_seconds']*1000;
  if(!Number.isSafeInteger(sourceAt)||sourceAt>k.clock()||sourceAt+maxAge<=k.clock()||observation.observed_at>k.clock()||observation.observed_at+maxAge<=k.clock())throw new Error('REFUND_MESSAGE_STALE');
  if(!['accepted','settled','manual_external_settlement_pending'].includes(op.state)||view.cash_settled!==settled)throw new Error('REFUND_MESSAGE_UNAVAILABLE');
  const facts={case_id:c.id,resource_id:c.resource_id,operation_id:op.id,receipt_id:op.receipt_id,configuration_digest:c.configuration_digest,policy_digest:c.pins.policy.digest,
   source_identity:source.identity,source_version:c.order.source_version,source_effect_digest:contentDigest(proof),source_observed_at:sourceAt,financial_stage:stage,state:op.state,
   amount_minor:op.amount_minor,currency:op.currency,settlement_verified:settled,native_refund_reference:op.native_id,qualification:'synthetic_only',live_financial_effect:false};
  return {...facts,source_digest:contentDigest(facts)};
 }
 render(scope:Scope,caseId:string,operationId:string,templateId:string){
  if(!['return_refund_pending_v1','return_refund_completed_v1'].includes(templateId))throw new Error('TEMPLATE_UNSUPPORTED');
  const facts=this.read(scope,caseId,operationId),completed=templateId==='return_refund_completed_v1';
  if(completed&&!facts.settlement_verified)throw new Error('REFUND_NOT_SETTLED');if(!completed&&facts.settlement_verified)throw new Error('REFUND_ALREADY_SETTLED');
  const amount=`${facts.currency} ${decimalString(money(facts.currency,facts.amount_minor))}`;
  const text=completed?`Refund of ${amount}: settlement is confirmed in the local test gateway. No live payment was made.`:
   facts.state==='manual_external_settlement_pending'?`A refund record for ${amount} has been created. External settlement is pending; returned payment has not been confirmed.`:
   `Refund of ${amount}: the test gateway has accepted the request. Settlement has not been confirmed.`;
  const result={status:'available',template_id:templateId,subject:completed?'Your refund test result':'Your refund status',text,...facts};
  return {...result,source_digest:contentDigest(result),execution_authorized:false};
 }
}
