import { exact,id,integer } from '../../commerce/kernel.mts';
import type { CommerceKernel,Row } from '../../commerce/kernel.mts';
import { canonical,contentDigest,jsonValue } from '../../commerce/configuration-values.mts';
import { money } from '../../commerce/money.mts';
import { assertWooReturnFacts,wooReturnAuthority } from './return-contract.mts';

/** A docs-informed local contract. These names do not qualify a live gateway. */
export const WOO_GATEWAY_CONTRACT='rifare-fixture-card-refund-v1';
export const WOO_GATEWAY_ID='rifare-fixture-card';
export const WOO_REFUND_CONTRACT=Object.freeze({id:'rifare-woocommerce-refund-fixture-v1',version:1,api_version:'wc/v3',
 amount_contract:'explicit-original-paid-minor-v1',gateway_contract:WOO_GATEWAY_CONTRACT,qualification:'synthetic_only',live_transport:false,
 supported:['original_card_refund','manual_refund_record','operation_lookup'],unsupported:['live_gateway','store_credit','exchange','restock','compute_totals']});
export const WOO_REFUND_CONTRACT_DIGEST=contentDigest(WOO_REFUND_CONTRACT);
export const WOO_MANUAL_PENDING='manual_external_settlement_pending';
export function wooHash(v:unknown){if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))throw new Error('WOO_FINANCIAL_BINDING_INVALID');return v;}
export function wooNative(v:unknown){if(typeof v!=='string'||!/^\d{1,15}$/.test(v)||Number(v)<1||!Number.isSafeInteger(Number(v)))throw new Error('WOO_FINANCIAL_BINDING_INVALID');return v;}
export function wooMinor(v:unknown){return BigInt(money('USD',v).minor);}
export function wooOrigin(v:unknown){if(typeof v!=='string')throw new Error('WOO_FINANCIAL_BINDING_INVALID');const u=new URL(v);
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.pathname!=='/'||u.search||u.hash||u.hostname==='localhost')throw new Error('WOO_FINANCIAL_BINDING_INVALID');return u.origin;}
export function checkedWooConfig(value:unknown){const p=exact(jsonValue(value),['contract_id','contract_digest','api_version','account_id','origin','refund_mode','granted_scopes','gateway_id','gateway_account_id','gateway_identity','gateway_contract_version']);
 if(p.contract_id!==WOO_REFUND_CONTRACT.id||p.contract_digest!==WOO_REFUND_CONTRACT_DIGEST||p.api_version!=='wc/v3'||!['gateway','manual'].includes(p.refund_mode)||
  canonical(p.granted_scopes)!==canonical(['read','write'])||p.gateway_id!==WOO_GATEWAY_ID||p.gateway_contract_version!==WOO_GATEWAY_CONTRACT)throw new Error('WOO_REFUND_UNQUALIFIED');
 for(const field of ['account_id','gateway_account_id','gateway_identity'])id(p[field]);if(wooOrigin(p.origin)!==p.origin)throw new Error('WOO_FINANCIAL_BINDING_INVALID');return p;}
export function checkedWooFinancialContract(value:unknown){const p=exact(jsonValue(value),['gateway_id','gateway_account_id','payment_id','transaction_id','currency','original_paid_minor','prior_refunded_minor','instrument_id','history_complete']);
 for(const field of ['gateway_id','gateway_account_id','payment_id','transaction_id','instrument_id'])id(p[field]);money(p.currency,p.original_paid_minor);money(p.currency,p.prior_refunded_minor);
 if(p.history_complete!==true||wooMinor(p.prior_refunded_minor)>wooMinor(p.original_paid_minor))throw new Error('WOO_FINANCIAL_HISTORY_UNVERIFIED');return p;}
export function checkedWooSourceBinding(value:unknown){const p=exact(jsonValue(value),['source_identity','account_id','origin','native_order_id','source_revision','source_digest','contract_digest','granted_scopes']);
 id(p.source_identity);id(p.account_id);if(wooOrigin(p.origin)!==p.origin)throw new Error('WOO_FINANCIAL_BINDING_INVALID');wooNative(p.native_order_id);integer(p.source_revision,1);wooHash(p.source_digest);wooHash(p.contract_digest);
 if(canonical(p.granted_scopes)!==canonical(['read']))throw new Error('WOO_FINANCIAL_SCOPE_REQUIRED');return p;}
export function wooSourceBinding(binding:Row){return checkedWooSourceBinding(Object.fromEntries(['source_identity','account_id','origin','native_order_id','source_revision','source_digest','contract_digest','granted_scopes'].map(key=>[key,binding[key]])));}
export function assertWooFinancialFacts(k:CommerceKernel,s:Row,c:Row,f:Row){const binding=assertWooReturnFacts(k,s,c.order),p=checkedWooFinancialContract(binding.financial_contract),instruments=f.instrument_allocations;
 if(p.payment_id!==f.payment_id||p.currency!==f.currency||p.original_paid_minor!==f.original_paid_minor||p.prior_refunded_minor!==f.prior_refunded_minor||
  !instruments||instruments.instruments.length!==1||instruments.instruments[0].id!==p.instrument_id||instruments.instruments[0].type!=='card'||instruments.instruments[0].supported!==true||
  instruments.instruments[0].original_paid_minor!==p.original_paid_minor||instruments.instruments[0].prior_refunded_minor!==p.prior_refunded_minor)throw new Error('WOO_ORIGINAL_INSTRUMENT_UNVERIFIED');
 return binding;}
export function wooRefundTerms(k:CommerceKernel,s:Row,c:Row,settings:Row,requestId:string,f:Row){const config=checkedWooConfig(settings.woo_refund),binding=assertWooFinancialFacts(k,s,c,f),financial=checkedWooFinancialContract(binding.financial_contract),source=wooSourceBinding(binding),rma=wooReturnAuthority(k,s,requestId),
 authority=Object.fromEntries(['kind','native_return_id','request_id','source_identity','source_digest','authority_digest','status','qualification'].map(key=>[key,rma[key]]));
 if(config.account_id!==source.account_id||config.origin!==source.origin||config.gateway_id!==financial.gateway_id||config.gateway_account_id!==financial.gateway_account_id||
  authority.native_return_id!==null||authority.kind!=='composed_local_rma'||authority.source_identity!==source.source_identity)throw new Error('WOO_FINANCIAL_SOURCE_MISMATCH');
 return checkedWooTerms({...config,native_order_id:source.native_order_id,source_binding:source,financial_contract:financial,return_authority:authority});}
export function checkedWooTerms(value:unknown){const p=exact(jsonValue(value),['contract_id','contract_digest','api_version','account_id','origin','refund_mode','granted_scopes','gateway_id','gateway_account_id','gateway_identity','gateway_contract_version','native_order_id','source_binding','financial_contract','return_authority']);
 const config=checkedWooConfig(Object.fromEntries(['contract_id','contract_digest','api_version','account_id','origin','refund_mode','granted_scopes','gateway_id','gateway_account_id','gateway_identity','gateway_contract_version'].map(key=>[key,p[key]]))),source=checkedWooSourceBinding(p.source_binding),financial=checkedWooFinancialContract(p.financial_contract);
 const authority=exact(p.return_authority,['kind','native_return_id','request_id','source_identity','source_digest','authority_digest','status','qualification']);id(authority.request_id);id(authority.source_identity);wooHash(authority.source_digest);wooHash(authority.authority_digest);
 if(authority.kind!=='composed_local_rma'||authority.native_return_id!==null||authority.status!=='submitted'||authority.qualification!=='fixture_only'||authority.source_identity!==source.source_identity||
  config.account_id!==source.account_id||config.origin!==source.origin||p.native_order_id!==source.native_order_id||config.gateway_id!==financial.gateway_id||config.gateway_account_id!==financial.gateway_account_id)throw new Error('WOO_FINANCIAL_SOURCE_MISMATCH');
 return {...config,native_order_id:p.native_order_id,source_binding:source,financial_contract:financial,return_authority:authority};}
export function checkedWooCommand(value:unknown){const p=exact(jsonValue(value),['operation_id','tenant_id','store_id','resource_id','customer_id','allocation_id','kind','currency','amount_minor','payment_id','native_return_id','source_identity','credit_instrument','routes','value_routes','line_id','units','woo_refund']);
 for(const field of ['operation_id','tenant_id','store_id','resource_id','customer_id','allocation_id','payment_id','source_identity'])id(p[field]);const terms=checkedWooTerms(p.woo_refund);money(p.currency,p.amount_minor);wooNative(p.line_id);
 if(p.kind!=='refund'||p.credit_instrument!==null||p.native_return_id!==null||wooMinor(p.amount_minor)<=0n||p.currency!==terms.financial_contract.currency||p.payment_id!==terms.financial_contract.payment_id)throw new Error('WOO_REFUND_UNQUALIFIED');
 if(!Array.isArray(p.units)||!p.units.length||p.units.length>100||new Set(p.units).size!==p.units.length)throw new Error('WOO_ORIGINAL_UNITS_INVALID');p.units.forEach((n:unknown)=>integer(n,1));
 const routes=[{instrument_id:terms.financial_contract.instrument_id,type:'card',amount_minor:p.amount_minor}];
 if(canonical(p.routes)!==canonical(routes)||canonical(p.value_routes)!==canonical(routes))throw new Error('WOO_ORIGINAL_INSTRUMENT_UNVERIFIED');return p;}
