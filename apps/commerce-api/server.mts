import { ReturnDepthApi } from '../../packages/commerce/return-depth-api.mts';
import { ReturnPortabilityApi } from '../../packages/commerce/return-portability-api.mts';
import { RETURN_PORTABILITY_ERRORS } from '../../packages/commerce/return-portability-errors.mts';
import { RETURN_DEPTH_ERRORS } from '../../packages/commerce/return-depth-errors.mts';
import { ExchangeLineage } from '../../packages/commerce/exchange-lineage.mts';
import { ExchangeLineageFixtureSource } from '../../packages/adapters/exchange-lineage-fixture-source.mts';
import { ExchangeCurrency } from '../../packages/commerce/exchange-currency.mts';
import { ExchangeFees } from '../../packages/commerce/exchange-fees.mts';
import { InstantExchanges } from '../../packages/commerce/instant-exchanges.mts';
import { InstantExchangeFixtureSource } from '../../packages/adapters/instant-exchange-fixture-source.mts';
import { SupportService } from '../../packages/commerce/support-service.mts';
import { SUPPORT_ERRORS } from '../../packages/commerce/support-errors.mts';
import { OrderEdits } from '../../packages/commerce/order-edit-execution.mts';
import { OrderEditWorkflow } from '../../packages/commerce/order-edit-workflow.mts';
import { OrderEditFixtureSource } from '../../packages/adapters/order-edit-fixture-source.mts';
import { ReturnReceiving } from '../../packages/commerce/return-receiving.mts';
import { ReturnDisposition } from '../../packages/commerce/return-disposition.mts';
import { ReturnCancellation } from '../../packages/commerce/return-cancellation.mts';
import { ReturnWorkflows } from '../../packages/commerce/return-workflows.mts';
import { NativeChangeReconciliation } from '../../packages/commerce/native-change-reconciliation.mts';
import { WarehouseFixtureSource } from '../../packages/adapters/warehouse-fixture-source.mts';
import { NativeChangeFixtureSource } from '../../packages/adapters/native-change-fixture-source.mts';
import { FulfillmentFixtureSource } from '../../packages/adapters/fulfillment-fixture-source.mts';
import { ReplacementInventory } from '../../packages/commerce/replacement-inventory.mts';
import { ReplacementOrders } from '../../packages/commerce/replacement-orders.mts';
import { ReturnLabels } from '../../packages/commerce/return-labels.mts';
import { FulfillmentExecution } from '../../packages/commerce/fulfillment-execution.mts';
import { ReturnTracking } from '../../packages/commerce/return-tracking.mts';
import { ResolutionLedger } from '../../packages/commerce/resolution-ledger.mts';
import { RefundQuotes } from '../../packages/commerce/refund-quotes.mts';
import { StoreCredit } from '../../packages/commerce/store-credit.mts';
import { VariantExchanges } from '../../packages/commerce/variant-exchanges.mts';
import { ExchangeFinance } from '../../packages/commerce/exchange-finance.mts';
import type { GiftReturns } from '../../packages/commerce/gift-returns.mts';
import { ResolutionExecution } from '../../packages/commerce/resolution-execution.mts';
import type { ResolutionFixtureSource } from '../../packages/adapters/resolution-fixture-source.mts';
import { ReturnIntake } from '../../packages/commerce/return-intake.mts';
import { ReturnReview } from '../../packages/commerce/return-intake-core.mts';
import { ReturnEvidence } from '../../packages/commerce/return-evidence.mts';
import type { EvidenceScanner } from '../../packages/commerce/return-evidence.mts';
import { ReturnDrafts } from '../../packages/commerce/return-drafts.mts';
import { IntegrationReadiness } from '../../packages/commerce/integration-readiness.mts';
import { PrivacyLifecycle,storageInventoryCurrent } from '../../packages/commerce/privacy-lifecycle.mts';
import { WorkerApi } from '../../packages/commerce/worker-api.mts';
import { ExceptionQueue } from '../../packages/commerce/exception-queue.mts';
import type { JournalResolver } from '../../packages/commerce/exception-queue.mts';
import { ExecutionStops } from '../../packages/commerce/execution-stops.mts';
import { BusinessOperations } from '../../packages/commerce/operation-store.mts';
import { OperationReceipts } from '../../packages/commerce/operation-receipts.mts';
import { ActionGateway } from '../../packages/commerce/action-gateway.mts';
import { ActionMcp } from '../../packages/agent/action-mcp.mts';
import { SkillReleases } from '../../packages/commerce/skill-releases.mts';
import { WEBHOOK_MAX_BYTES,WebhookCapacityError } from '../../packages/commerce/webhook-inbox.mts';
import type { WebhookInbox } from '../../packages/commerce/webhook-inbox.mts';
import { ProfileEditor } from '../../packages/commerce/profile-editor.mts';
import { Policies } from '../../packages/commerce/policies.mts';
import { ConfigurationError } from '../../packages/commerce/configuration-values.mts';
import { manifestSchema,validateManifest } from '../../packages/commerce/skill-contract.mts';
import { Permissions } from '../../packages/commerce/authorization.mts';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { body,listen,sameOrigin,send } from '../../packages/development/http.mts';
import { exact,id } from '../../packages/commerce/kernel.mts';
import type { CommerceKernel } from '../../packages/commerce/kernel.mts';
import { Capabilities,CapabilityLimitation,READS } from '../../packages/commerce/capabilities.mts';
import type { CustomerAccess } from '../../packages/commerce/customer-access.mts';
import type { SecretVault } from '../../packages/commerce/secrets.mts';
import type { StoreSimulator } from '../../packages/commerce/simulator.mts';

import { ReadMcp,MCP_VERSION } from '../../packages/agent/mcp.mts';
import { ReadContext } from '../../packages/commerce/read-context.mts';

const SAFE_CODES=new Set(['ADAPTER_UNAVAILABLE','APPROVAL_AUTHORITY_CHANGED','APPROVAL_UNAVAILABLE','DISCREPANCY_REQUIRES_FOLLOWUP','DISPOSITION_DENIED','DISPOSITION_NOT_SENT','DISPOSITION_QUOTE_CHANGED','DISPOSITION_RESULT_INVALID','DISPOSITION_RESULT_MISMATCH','INVALID_INPUT','LIFECYCLE_INTEGRITY','LIFECYCLE_QUOTE_CHANGED','NATIVE_BALANCE_CHANGED','NATIVE_BALANCE_REGRESSION','NATIVE_CHANGE_REVIEW_REQUIRED','NATIVE_HISTORY_CHANGED','NATIVE_HISTORY_REMOVED','NATIVE_PAYMENT_MISMATCH','NATIVE_RECEIPT_CONFLICT','NATIVE_RECEIPT_INVALID','NATIVE_RECONCILIATION_REQUIRED','NATIVE_REFRESH_RACED','NATIVE_REFRESH_REQUIRED','NATIVE_REFUND_INVALID','NATIVE_REFUND_MISMATCH','NATIVE_REPLACEMENT_INVALID','NATIVE_RETURN_INTEGRITY','NATIVE_RETURN_MISMATCH','NATIVE_RETURN_REQUIRED','NATIVE_SETTINGS_CHANGED','NATIVE_SNAPSHOT_INVALID','NATIVE_SNAPSHOT_LIMIT','NATIVE_SOURCE_MISMATCH','NATIVE_SOURCE_STALE','NATIVE_SOURCE_TIMEOUT','NATIVE_SOURCE_UNAVAILABLE','NATIVE_UNIT_CONFLICT','NATIVE_UNIT_INVALID','NATIVE_UNIT_UNPROVEN','NATIVE_VERSION_CONFLICT','NOT_FOUND','OUTCOME_UNSUPPORTED','RECEIPT_KEY_CONFLICT','RECEIVING_CHANGED','RECEIVING_EVIDENCE_UNAVAILABLE','RECEIVING_LIMIT','RECEIVING_LOCATION_CHANGED','RECEIVING_MAPPING_REQUIRED','RECEIVING_NOT_CLOSED','RECEIVING_REVIEW_REQUIRED','RETURN_CLOSED','RETURN_NOT_CLOSED','RETURN_NOT_EXPIRED','SELF_REVIEW_DENIED','SEPARATE_FIXTURE_SOURCE_REQUIRED','UNIT_ALREADY_DISPOSED','UNIT_EXTERNALLY_RESOLVED','WAREHOUSE_MAPPING_REQUIRED','WAREHOUSE_NOT_READY','WAREHOUSE_SETTINGS_CHANGED','WAREHOUSE_SOURCE_MISMATCH','WAREHOUSE_TIMEOUT','WORKFLOW_CONFIGURATION_CHANGED','WORKFLOW_PIN_CHANGED','ALLOCATION_ALREADY_RESERVED','APPROVAL_AUTHORITY_CHANGED','FIXTURE_SOURCE_MISMATCH','FULFILLMENT_APPROVAL_REQUIRED','FULFILLMENT_INTEGRITY','FULFILLMENT_NOT_READY','FULFILLMENT_NOT_SENT','FULFILLMENT_QUOTE_CHANGED','FULFILLMENT_QUOTE_EXPIRED','FULFILLMENT_RESULT_MISMATCH','FULFILLMENT_SETTINGS_CHANGED','FULFILLMENT_SOURCE_STALE','FULFILLMENT_SOURCE_TIMEOUT','FULFILLMENT_STATE_REGRESSION','INVALID_INPUT','LABEL_GENERATION_CONFLICT','LABEL_IDENTITY_CHANGED','LABEL_INTEGRITY','LABEL_PURCHASE_NOT_ESTABLISHED','LABEL_REPLACEMENT_BLOCKED','LABEL_REPLACEMENT_INVALID','LABEL_REPLACEMENT_REQUIRED','LABEL_STATE_INVALID','NATIVE_RETURN_INTEGRITY','NATIVE_RETURN_REQUIRED','NATIVE_RETURN_UNAVAILABLE','NOT_FOUND','OBLIGATION_ALREADY_AUTHORIZED','PACKAGE_UNSUPPORTED','PARCEL_CHANGED','PRICE_DIFFERENCE_UNSUPPORTED','RATE_CHANGED','RECONCILIATION_REQUIRED','REIMBURSEMENT_INVALID','REIMBURSEMENT_REGRESSION','REIMBURSEMENT_UNCONFIRMED','REPLACEMENT_NOT_ESTABLISHED','REPLACEMENT_STATE_INVALID','RESERVATION_CHANGED','RESERVATION_INTEGRITY','RESERVATION_RESULT_INVALID','RESERVATION_RESULT_MISMATCH','RESERVATION_STATE_REGRESSION','RESERVATION_UNAVAILABLE','RETURN_REVIEW_REQUIRED','SEPARATE_FIXTURE_SOURCE_REQUIRED','SOURCE_EVENT_CONFLICT','SOURCE_VERSION_CONFLICT','TRACKING_EVENT_CONFLICT','TRACKING_EVENT_INVALID','TRACKING_REGRESSION','UNSUPPORTED_ACTION','VOID_RESULT_INVALID','VOID_STATE_REGRESSION','VOID_UNAVAILABLE','ALLOCATION_ALREADY_AUTHORIZED','APPROVAL_AUTHORITY_CHANGED','CONFIGURATION_REPREVIEW_REQUIRED','CREDIT_INSTRUMENT_INVALID','CREDIT_UNQUALIFIED','EXCHANGE_QUOTE_CHANGED','EXCHANGE_SOURCE_INVALID','EXCHANGE_SOURCE_UNQUALIFIED','EXCHANGE_UNAVAILABLE','FINANCIAL_SOURCE_STALE','INVALID_INPUT','INVALID_MONEY','NATIVE_RETURN_INTEGRITY','NATIVE_RETURN_REQUIRED','NATIVE_RETURN_UNAVAILABLE','NOT_FOUND','OUTCOME_UNSUPPORTED','PAID_ALLOCATIONS_INVALID','PAID_ALLOCATION_CHANGED','PAID_QUANTITY_MISMATCH','PAID_TOTAL_MISMATCH','QUANTITY_EXCEEDED','REFUND_BALANCE_CONFLICT','REFUND_BALANCE_EXCEEDED','REFUND_FEES_CHANGED','REFUND_QUOTE_CHANGED','REFUND_QUOTE_EXPIRED','REFUND_VALUE_UNSUPPORTED','RESOLUTION_APPROVAL_REQUIRED','RESOLUTION_CONFLICT','RESOLUTION_INTEGRITY','RESOLUTION_NOT_CONFIGURED','RESOLUTION_NOT_READY','RESOLUTION_NOT_SENT','RESOLUTION_RESULT_INVALID','RESOLUTION_RESULT_MISMATCH','RESOLUTION_SETTINGS_CHANGED','RESOLUTION_SOURCE_MISMATCH','RESOLUTION_SOURCE_UNQUALIFIED','RESOLUTION_STAGE_INVALID','RESOLUTION_STAGE_REGRESSION','RETURN_APPROVAL_REQUIRED','RETURN_QUANTITY_MISMATCH','RETURN_REVIEW_REQUIRED','SEPARATE_FIXTURE_SOURCE_REQUIRED','UNIT_ALREADY_ALLOCATED','UNIT_ALREADY_RESOLVED','RETURN_NOT_CONFIGURED','RETURN_SETTINGS_CHANGED','RETURN_SETTINGS_INTEGRITY','RETURN_SOURCE_MISSING','RETURN_QUOTE_INTEGRITY','RETURN_QUOTE_CHANGED','RETURN_QUOTE_EXPIRED','RETURN_REVIEW_REQUIRED','RETURN_REQUEST_CONFLICT','RETURN_REQUEST_INTEGRITY','RETURN_OVERRIDE_UNAVAILABLE','RETURN_OVERRIDE_REVOKED','RETURN_OVERRIDE_DENIED','SELF_REVIEW_DENIED','UNKNOWN_RETURN_LINE','INVALID_QUANTITY','DUPLICATE_LINE','INVALID_TIME_ZONE','INVALID_FEE','EVIDENCE_TYPE_REJECTED','EVIDENCE_DECOMPRESSION_LIMIT','EVIDENCE_UNAVAILABLE','EVIDENCE_INTEGRITY','EVIDENCE_LIMIT','EVIDENCE_CHANGED','EVIDENCE_SCAN_INVALID','EVIDENCE_ACCESS_DENIED','BODY_TOO_LARGE','JSON_REQUIRED','INVALID_JSON','INTEGRATION_NOT_READY','SUBJECT_ERASED','RESTORE_WRITE_BLOCKED','RESTORE_EGRESS_BLOCKED','DRAFT_CONFLICT','STORAGE_INVENTORY_CHANGED','PRIVACY_BATCH_LIMIT','PRIVACY_EXPORT_LIMIT','HOLD_NOT_FOUND','WORK_ACCESS_DENIED','WORK_SCOPE_DENIED','WORK_FENCE_REJECTED','WORK_CONTEXT_CHANGED','WORK_LEASE_HELD','WORK_LIMIT','WORK_RESULT_INVALID','WORK_RESULT_INTEGRITY','WORK_ENVELOPE_REJECTED','WORK_IDEMPOTENCY_CONFLICT','EXECUTION_STOPPED','EXECUTION_REAUTHORIZATION_REQUIRED','CONTROL_CHANGED','CONTROL_UNCHANGED','RECONCILIATION_REQUIRED','SOURCE_UNAVAILABLE','OPERATION_CHANGED','CASE_CHANGED','CASE_EXISTS','CASE_PIN_INTEGRITY','CASE_CUSTOMER_CHANGED','CASE_CONTEXT_UNSUPPORTED','SKILL_PIN_MISSING','SKILL_REVOKED','CONFIGURATION_REPREVIEW_REQUIRED','CONFIGURATION_NOT_APPROVED','CUSTOMER_VERIFICATION_REQUIRED','CAPABILITY_CHANGED','CAPABILITY_UNAVAILABLE','UNSUPPORTED_ACTION','SOURCE_STALE','SOURCE_FACTS_MISSING','POLICY_DENIED','PREVIEW_INTEGRITY','PREVIEW_STALE','PREVIEW_EXPIRED','SELF_APPROVAL_DENIED','APPROVAL_EXISTS','APPROVAL_UNAVAILABLE','APPROVAL_AUTHORITY_CHANGED','RECEIPT_INTEGRITY','RELEASE_TRANSITION','RELEASE_INTEGRITY','ACTIVATION_CHANGED','CANARY_FALLBACK_REQUIRED','ROLLBACK_TARGET_INVALID','WEBHOOK_BODY_LIMIT','WEBHOOK_HEADERS_INVALID','WEBHOOK_SIGNATURE_INVALID','WEBHOOK_ROUTE_MISMATCH','WEBHOOK_EXPIRED','WEBHOOK_CONTENT_TYPE','WEBHOOK_ROUTE_UNAVAILABLE','WEBHOOK_KEY_UNAVAILABLE','WEBHOOK_PAYLOAD_INVALID','WEBHOOK_DELIVERY_CONFLICT','WEBHOOK_PERSISTENCE_FAILED','PROFILE_EXISTS','PROFILE_CHANGED','PROFILE_NOT_READY','SIMULATION_REQUIRED','SIMULATION_STALE','DRAFT_HISTORY_LIMIT','POLICY_CHANGED','POLICY_INTEGRITY','POLICY_UNAVAILABLE','POLICY_REVOKED','POLICY_TRANSITION','SELF_REVIEW_DENIED','POLICY_TEST_FAILED','REVIEW_AUTHORITY_CHANGED','ACTIVATION_CONFLICT','ACTIVATION_ORDER','SKILL_APPROVAL_REQUIRED','SKILL_DOWNGRADE_DENIED','ACCESS_DENIED','NOT_FOUND','INVALID_INPUT','JSON_REQUIRED','BODY_TOO_LARGE','INVALID_JSON',
  'INVALID_PERMISSION','AUTHORITY_CHANGED','LAST_OWNER','RESOURCE_DENIED','INVALID_SKILL','SKILL_CHANGED','PROFILE_STALE','PROFILE_ACTION_DENIED','INVALID_PROFILE',
  'NO_CONFIGURATION','RUN_IN_PROGRESS','TASK_CONTEXT_CHANGED','UNKNOWN_READ_ACTION','CURRENT_FACTS_UNAVAILABLE','TASK_LIMIT','HOST_DENIED','ORIGIN_DENIED','VERIFICATION_FAILED','SECRET_UNAVAILABLE','ADAPTER_UNAVAILABLE','PROVIDER_REJECTED','PROVIDER_UNAVAILABLE','OUTCOME_UNKNOWN']);
for(const code of ["APPROVAL_AUTHORITY_CHANGED", "EDIT_ADDRESS_INVALID", "EDIT_ADDRESS_UNSUPPORTED", "EDIT_ALREADY_ACTIVE", "EDIT_APPROVAL_CHANGED", "EDIT_BALANCE_INVALID", "EDIT_CALCULATION_CHANGED", "EDIT_CONFIGURATION_CHANGED", "EDIT_CUSTOMER_CHANGED", "EDIT_DISCOUNT_UNSUPPORTED", "EDIT_FINAL_VERSION_CHANGED", "EDIT_FINANCE_UNCONFIRMED", "EDIT_FOREIGN_HOLD", "EDIT_HOLD_MISSING", "EDIT_HOLD_OWNERSHIP", "EDIT_HOLD_PROBE_FAILED", "EDIT_HOLD_REMAINS", "EDIT_HOLD_UNCONFIRMED", "EDIT_INTEGRATION_NOT_READY", "EDIT_INTEGRITY", "EDIT_LINE_IRREVERSIBLE", "EDIT_MONEY_INVALID", "EDIT_NATIVE_TOTAL_CHANGED", "EDIT_NO_CHANGE", "EDIT_OPERATION_CONFLICT", "EDIT_ORDER_EXISTS", "EDIT_PAYMENT_MISMATCH", "EDIT_PAYMENT_OUTSTANDING", "EDIT_PAYMENT_VERSION_CHANGED", "EDIT_QUOTE_CHANGED", "EDIT_QUOTE_EXPIRED", "EDIT_READINESS_CHANGED", "EDIT_RECONCILIATION_REQUIRED", "EDIT_REFUND_BALANCE", "EDIT_RESULT_MISMATCH", "EDIT_SESSION_MISSING", "EDIT_SETTINGS_CHANGED", "EDIT_SOURCE_CHANGED", "EDIT_SOURCE_INTEGRITY", "EDIT_SOURCE_MISMATCH", "EDIT_SOURCE_MISSING", "EDIT_SOURCE_REGRESSION", "EDIT_SOURCE_RESPONSE_LOST", "EDIT_SOURCE_STALE", "EDIT_SOURCE_TIMEOUT", "EDIT_SOURCE_UNAVAILABLE", "EDIT_SOURCE_UNQUALIFIED", "EDIT_STAGE_UNSUPPORTED", "EDIT_STOCK_UNAVAILABLE", "EDIT_TAX_ROUNDING_UNQUALIFIED", "EDIT_TAX_SHIPPING_UNQUALIFIED", "EDIT_TOTAL_MISMATCH", "EDIT_UNQUALIFIED_WAREHOUSE", "EDIT_UNSUPPORTED_ACTION", "EDIT_VARIANT_UNSUPPORTED", "EDIT_WAREHOUSE_CHANGED", "EDIT_WAREHOUSE_IRREVERSIBLE", "EDIT_WAREHOUSE_MISSING", "EDIT_WAREHOUSE_STALE", "EDIT_WAREHOUSE_UNAVAILABLE", "EDIT_WINDOW_CLOSED", "FIXTURE_ONLY", "INVALID_INPUT", "NOT_FOUND", "SEPARATE_FIXTURE_SOURCE_REQUIRED", "WORKFLOW_CONFIGURATION_CHANGED", "WORKFLOW_PIN_CHANGED"])SAFE_CODES.add(code);
for(const code of ['GIFT_VERIFICATION_REQUIRED','GIFT_CHOICE_CONFLICT','GIFT_OUTCOME_DENIED','GIFT_ACTION_DENIED','GIFT_UNITS_DENIED','GIFT_PRIVATE_NOTE_REQUIRES_EVIDENCE','GIFT_RECIPIENT_UNQUALIFIED','GIFT_RECIPIENT_MISMATCH','EXCHANGE_PAYMENT_OUTSTANDING','EXCHANGE_FINANCE_MISMATCH','EXCHANGE_FINANCE_OUTCOME_UNSUPPORTED','CATALOG_CONFIGURATION_CHANGED','CATALOG_PAGE_REQUIRED','BUNDLE_POLICY_UNAPPROVED','BUNDLE_ALLOCATION_INVALID','BUNDLE_ALLOCATION_CHANGED','INSTRUMENT_ROUTING_UNSUPPORTED','INSTRUMENT_BALANCE_EXCEEDED','INSTRUMENT_HISTORY_UNVERIFIED','REFUND_ACCOUNTING_UNVERIFIED'])SAFE_CODES.add(code);
for(const code of ["ALLOCATION_ALREADY_AUTHORIZED", "APPROVAL_AUTHORITY_CHANGED", "ASYNC_TRANSACTION_DENIED", "BUNDLE_POLICY_UNAPPROVED", "CONVERSION_PROVENANCE_REQUIRED", "CREDIT_UNQUALIFIED", "CURRENCY_ACCOUNT_MISMATCH", "CURRENCY_BINDING_MISMATCH", "CURRENCY_BINDING_REQUIRED", "CURRENCY_COMBINATION_UNQUALIFIED", "CURRENCY_HISTORY_INTEGRITY", "CURRENCY_MISMATCH", "CURRENCY_OUTCOME_UNQUALIFIED", "CURRENCY_QUALIFICATION_CHANGED", "CURRENCY_QUALIFICATION_EXPIRED", "CURRENCY_SOURCE_UNQUALIFIED", "EXCHANGE_CURRENCY_UNQUALIFIED", "EXCHANGE_FINANCE_MISMATCH", "EXCHANGE_FINANCE_OUTCOME_UNSUPPORTED", "EXCHANGE_PAYMENT_OUTSTANDING", "FEE_DIFFERENCE_UNRESOLVED", "FEE_ESTIMATE_MISMATCH", "FEE_ESTIMATE_REQUIRED", "FEE_EVENT_CONFLICT", "FEE_EVENT_MISMATCH", "FEE_EXCEEDS_ORIGINAL_VALUE", "FEE_FINAL_UNQUALIFIED", "FEE_HISTORY_INTEGRITY", "FEE_SOURCE_REQUIRED", "FEE_SOURCE_UNQUALIFIED", "FIXTURE_ONLY", "FIXTURE_RESPONSE_LOST", "FIXTURE_TRANSPORT_FAILURE", "INSTANT_ACCOUNT_REVISION", "INSTANT_ACCOUNT_UNQUALIFIED", "INSTANT_APPROVAL_REQUIRED", "INSTANT_BINDING_CHANGED", "INSTANT_CAPTURE_EXISTS", "INSTANT_COMBINATION_UNQUALIFIED", "INSTANT_COMMAND_BINDING_CHANGED", "INSTANT_CONFIGURATION_CHANGED", "INSTANT_CONSENT_BINDING_CHANGED", "INSTANT_CONSENT_EXPIRED", "INSTANT_CONSENT_REQUIRED", "INSTANT_CONSENT_REVOKED", "INSTANT_CONSENT_UNQUALIFIED", "INSTANT_CONSENT_USED", "INSTANT_DEADLINE_INVALID", "INSTANT_DISABLED", "INSTANT_FRESH_CONSENT_REQUIRED", "INSTANT_GIFT_UNQUALIFIED", "INSTANT_INTEGRITY", "INSTANT_MANDATE_EXPIRED", "INSTANT_MANDATE_INACTIVE", "INSTANT_MANDATE_UNCONFIRMED", "INSTANT_NOT_COLLECTIBLE", "INSTANT_NOT_SENT", "INSTANT_OBLIGATIONS_UNRESOLVED", "INSTANT_OBLIGATION_EXISTS", "INSTANT_OPERATION_EXISTS", "INSTANT_OPERATION_EXPIRED", "INSTANT_ORIGINAL_AMOUNT_CHANGED", "INSTANT_QUOTE_CHANGED", "INSTANT_QUOTE_EXPIRED", "INSTANT_REAUTHORIZATION_REQUIRED", "INSTANT_RECEIPT_CONFLICT", "INSTANT_RECEIPT_INVALID", "INSTANT_RELEASE_CONFLICT", "INSTANT_RELEASE_UNCONFIRMED", "INSTANT_RELEASE_UNRESOLVED", "INSTANT_RESULT_INVALID", "INSTANT_RESULT_MISMATCH", "INSTANT_SOURCE_BINDING_INVALID", "INSTANT_SOURCE_INTEGRITY", "INSTANT_SOURCE_MISMATCH", "INSTANT_SOURCE_NOT_FOUND", "INSTANT_SOURCE_TIMEOUT", "INSTANT_SOURCE_UNAVAILABLE", "INSTANT_STAGE_REGRESSION", "INSTANT_STOCK_SOURCE_UNQUALIFIED", "INSTANT_TERMS_CHANGED", "INSTANT_TERMS_REVISION", "INSTANT_TERMS_UNQUALIFIED", "INSTANT_TRIAL_ACTIVE", "INSTANT_TRIAL_ENDED", "INSTANT_UNITS_INVALID", "INSTANT_UNIT_ALREADY_CLAIMED", "INVALID_INPUT", "INVALID_MONEY", "LINEAGE_COMMAND_CHANGED", "LINEAGE_DELIVERY_REQUIRED", "LINEAGE_GENERATION_LIMIT", "LINEAGE_GIFT_QUALIFICATION_REQUIRED", "LINEAGE_INSTRUMENT_CHANGED", "LINEAGE_INSTRUMENT_UNQUALIFIED", "LINEAGE_INTEGRITY", "LINEAGE_ORIGINAL_IMMUTABLE", "LINEAGE_ORIGINAL_SOURCE_REQUIRED", "LINEAGE_PAID_VALUE_CHANGED", "LINEAGE_PAID_VALUE_EXCEEDED", "LINEAGE_PARENT_ALREADY_CONSUMED", "LINEAGE_PARENT_BALANCE_EXCEEDED", "LINEAGE_PARENT_FINANCIAL_OPERATION", "LINEAGE_PHYSICAL_UNITS_CHANGED", "LINEAGE_REPLACEMENT_UNCONFIRMED", "LINEAGE_SEED_TOO_LATE", "LINEAGE_SETTLEMENT_REQUIRED", "LINEAGE_SOURCE_BINDING_REQUIRED", "LINEAGE_SOURCE_CHANGED", "LINEAGE_SOURCE_INTEGRITY", "LINEAGE_SOURCE_MISMATCH", "LINEAGE_SOURCE_REQUIRED", "LINEAGE_SOURCE_RESPONSE_LOST", "LINEAGE_SOURCE_UNAVAILABLE", "LINEAGE_SOURCE_UNQUALIFIED", "LINEAGE_TRANSFER_UNRESOLVED", "LINEAGE_UNIT_INVALID", "LINEAGE_UNIT_LIMIT", "LINEAGE_VALUE_MISMATCH", "MONEY_AMOUNT_MISMATCH", "MONEY_COMMAND_BINDING_REQUIRED", "MONEY_COMMAND_CHANGED", "MONEY_COMPONENT_MISMATCH", "MONEY_HISTORY_UNQUALIFIED", "MONEY_ORIGINAL_TOTAL_MISMATCH", "MONEY_SOURCE_INTEGRITY", "MONEY_SOURCE_NOT_FOUND", "MONEY_TERMS_CHANGED", "MONEY_UNITS_INVALID", "NATIVE_RETURN_INTEGRITY", "NATIVE_RETURN_REQUIRED", "NATIVE_RETURN_UNAVAILABLE", "NOT_FOUND", "ORIGINAL_MONEY_IMMUTABLE", "ORIGINAL_UNIT_ALREADY_RESOLVED", "OUTCOME_UNSUPPORTED", "PRESENTMENT_BALANCE_EXCEEDED", "REFUND_BALANCE_EXCEEDED", "RESOLUTION_INTEGRITY", "RESOLUTION_SOURCE_MISMATCH", "SEPARATE_FIXTURE_SOURCE_REQUIRED", "UNSUPPORTED_ACTION"])SAFE_CODES.add(code);
for(const code of RETURN_PORTABILITY_ERRORS)SAFE_CODES.add(code);
export async function startCommerceServer(options:{support?:SupportService;gifts?:GiftReturns;resolutionExecution?:ResolutionExecution;kernel:CommerceKernel;caps:Capabilities;customers:CustomerAccess;
  simulator:StoreSimulator;instantSource?:InstantExchangeFixtureSource;lineageSource?:ExchangeLineageFixtureSource;orderEditSource?:OrderEditFixtureSource;warehouseSource?:WarehouseFixtureSource;nativeChangeSource?:NativeChangeFixtureSource;fulfillmentSource?:FulfillmentFixtureSource;resolutionSource?:ResolutionFixtureSource;evidenceScanner?:EvidenceScanner;reconciliationJournals?:JournalResolver;vault?:SecretVault;inbox?:WebhookInbox;reads?:ReadContext;runner?:{run:(scope:object,taskId:string,configurationId:string,untrustedInput?:unknown)=>Promise<unknown>;receipt:(scope:object,taskId:string,receiptId:string)=>unknown};port?:number;log?:(entry:unknown)=>void}) {
  const {kernel,caps,customers,simulator,vault}=options;const orderEdits=new OrderEdits(kernel,options.orderEditSource),editWorkflow=new OrderEditWorkflow(orderEdits);const reads=options.reads??new ReadContext(kernel,caps);const mcp=new ReadMcp(kernel,reads);const editor=new ProfileEditor(kernel,caps),policies=new Policies(kernel);let port=0;const gateway=new ActionGateway(kernel),actionMcp=new ActionMcp(kernel,gateway),releases=new SkillReleases(kernel);
  if(options.gifts&&options.gifts.kernel!==kernel)throw new Error('GIFT_VERIFICATION_REQUIRED');
  const resolutionLedger=new ResolutionLedger(kernel),refundQuotes=new RefundQuotes(kernel),storeCredit=new StoreCredit(kernel),exchanges=new VariantExchanges(kernel),exchangeFinance=new ExchangeFinance(kernel),resolutionExecution=options.resolutionExecution??(options.resolutionSource?new ResolutionExecution(kernel,options.resolutionSource):null);
  if(resolutionExecution&&resolutionExecution.kernel!==kernel)throw new Error('RESOLUTION_SOURCE_MISMATCH');
  const lineage=options.lineageSource?new ExchangeLineage(kernel,options.lineageSource):null,instant=options.instantSource?new InstantExchanges(kernel,options.instantSource):null,currency=options.resolutionSource?new ExchangeCurrency(kernel,options.resolutionSource):null,fees=options.resolutionSource?new ExchangeFees(kernel,options.resolutionSource):null;
  const fulfillment=options.fulfillmentSource?new FulfillmentExecution(kernel,options.fulfillmentSource):null,inventory=options.fulfillmentSource?new ReplacementInventory(kernel,options.fulfillmentSource):null,labels=options.fulfillmentSource?new ReturnLabels(kernel,options.fulfillmentSource):null,replacements=new ReplacementOrders(kernel),tracking=fulfillment?new ReturnTracking(fulfillment):null;
  const receiving=new ReturnReceiving(kernel),disposition=new ReturnDisposition(kernel,options.warehouseSource??null),cancellation=new ReturnCancellation(kernel),returnWorkflows=new ReturnWorkflows(kernel),nativeChanges=options.nativeChangeSource?new NativeChangeReconciliation(kernel,options.nativeChangeSource):null;
  const intake=new ReturnIntake(kernel),returnReview=new ReturnReview(kernel),returnEvidence=new ReturnEvidence(kernel,options.evidenceScanner??null);
  const drafts=new ReturnDrafts(kernel),privacy=new PrivacyLifecycle(kernel),readiness=new IntegrationReadiness(kernel);
  const returnDepth=new ReturnDepthApi(kernel,caps,orderEdits,options.fulfillmentSource);
  const portability=new ReturnPortabilityApi(kernel,reads,resolutionExecution,options.support??null);
  const workerApi=new WorkerApi(kernel,{resolutionExecution}),exceptions=new ExceptionQueue(kernel,options.reconciliationJournals);
  const log=(status:number,code:string)=>{try{options.log?.({event:'http_result',status,code});}catch{/* logging cannot grant access */}};
  const server=createServer(async(req,res)=>{
    try {
      sameOrigin(req,port);
      const url=new URL(req.url??'/',`http://127.0.0.1:${port}`);
      if(url.origin!==`http://127.0.0.1:${port}`)throw new Error('HOST_DENIED');
      if(url.pathname==='/health'&&req.method==='GET'){send(res,200,{ready:true,profile:'commerce-sqlite-diagnostic',production_qualified:false});return;}
      const assets:Record<string,[string,string]>={'/return-assistance':['return-assistance.html','text/html'],'/return-assistance-client.js':['return-assistance-client.js','text/javascript'],'/return-assistance.css':['return-assistance.css','text/css'],'/exchange-history':['exchange-history.html','text/html'],'/exchange-history-client.js':['exchange-history-client.js','text/javascript'],'/exchange-history.css':['exchange-history.css','text/css'],'/exchanges':['exchanges.html','text/html'],'/gift-returns':['gift-returns.html','text/html'],'/exchange-depth-client.js':['exchange-depth-client.js','text/javascript'],'/exchange-depth.css':['exchange-depth.css','text/css'],'/return-operations.html':['return-operations.html','text/html'],'/order-edits.html':['order-edits.html','text/html'],'/support-tracking.html':['support-tracking.html','text/html'],'/support':['support.html','text/html'],'/tracking':['support-tracking.html','text/html'],'/support-client.js':['support-client.js','text/javascript'],'/support.css':['support.css','text/css'],'/order-edits':['order-edits.html','text/html'],'/order-edits-client.js':['order-edits-client.js','text/javascript'],'/order-edits.css':['order-edits.css','text/css'],'/return-operations':['return-operations.html','text/html'],'/return-operations-client.js':['return-operations-client.js','text/javascript'],'/return-operations.css':['return-operations.css','text/css'],'/returns':['returns.html','text/html'],'/returns-client.js':['returns-client.js','text/javascript'],'/returns.css':['returns.css','text/css'],'/return-draft':['return-draft.html','text/html'],'/return-draft-client.js':['return-draft-client.js','text/javascript'],'/exceptions':['exceptions.html','text/html'],'/exceptions.css':['exceptions.css','text/css'],
    '/exceptions-client.js':['exceptions-client.js','text/javascript'],'/execution':['execution.html','text/html'],'/execution.html':['execution.html','text/html'],'/execution-client.js':['execution-client.js','text/javascript'],'/configuration':['configuration.html','text/html'],'/configuration-client.js':['configuration-client.js','text/javascript'],'/configuration.css':['configuration.css','text/css'],'/':['index.html','text/html'],'/client.js':['client.js','text/javascript'],'/style.css':['style.css','text/css'],'/status':['status.html','text/html'],'/status-client.js':['status-client.js','text/javascript'],'/status.css':['status.css','text/css']};
      Object.assign(assets,{'/accessibility-client.js':['accessibility-client.js','text/javascript'],'/accessibility.css':['accessibility.css','text/css']});
      Object.assign(assets,{'/locale-presentation.js':['../../packages/presentation/locale-presentation.js','text/javascript'],'/locale-client.js':['locale-client.js','text/javascript']});
      Object.assign(assets,{'/return-portability':['return-portability.html','text/html'],'/return-portability-client.js':['return-portability-client.js','text/javascript'],'/return-portability.css':['return-portability.css','text/css']});
      if(req.method==='GET'&&assets[url.pathname]&&!url.search){
        const [file,mime]=assets[url.pathname];res.writeHead(200,{'content-type':mime+'; charset=utf-8','cache-control':'no-store',
          'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
          'x-content-type-options':'nosniff','referrer-policy':'no-referrer'});res.end(readFileSync(new URL(file,import.meta.url)));return;
      }
      if(url.search&&!['/v1/lookup','/v1/resources','/v1/knowledge/search','/v1/skill-content'].includes(url.pathname))throw new Error('INVALID_INPUT');
      if(req.method==='POST'&&url.pathname==='/v1/customer/challenges'){
        const result=customers.request(await body(req),req.socket.remoteAddress??'unknown-local');send(res,202,result);log(202,'CHALLENGE_REQUESTED');return;
      }
      if(req.method==='POST'&&url.pathname==='/v1/customer/verify'){
        send(res,200,customers.complete(await body(req)));log(200,'CUSTOMER_VERIFIED');return;
      }
      if(req.method==='POST'&&['/v1/gifts/challenges','/v1/gifts/verify','/v1/gifts/choices','/v1/gifts/status','/v1/gifts/revoke'].includes(url.pathname)){
        if(!options.gifts)throw new Error('ADAPTER_UNAVAILABLE');const p=await body(req),op=url.pathname.split('/')[3];
        const result=op==='challenges'?options.gifts.request(p,req.socket.remoteAddress??'unknown-local'):op==='verify'?options.gifts.complete(p):op==='choices'?options.gifts.choices(p):op==='status'?options.gifts.status(p):options.gifts.revoke(p);
        send(res,op==='challenges'?202:200,result);log(200,'GIFT_OPERATION');return;
      }
      if(url.pathname==='/mcp') {
        const auth=req.headers.authorization;
        if(typeof auth!=='string'||!auth.startsWith('Bearer '))throw new Error('ACCESS_DENIED');
        const value=auth.slice(7),audience=`http://127.0.0.1:${port}/mcp`;
        mcp.authenticate(value,audience);
        if(req.method!=='POST'){res.setHeader('allow','POST');send(res,405,{error:'METHOD_NOT_ALLOWED'});return;}
        if(!req.headers.accept?.includes('application/json')||!req.headers.accept.includes('text/event-stream')){send(res,406,{error:'MCP_ACCEPT_REQUIRED'});return;}
        const message=await body(req),version=req.headers['mcp-protocol-version'];
        if(version!==undefined&&version!==MCP_VERSION){send(res,400,{error:'UNSUPPORTED_MCP_VERSION'});return;}
        const result=mcp.dispatch(value,audience,message,typeof version==='string'?version:undefined);
        if(result===null){res.writeHead(202,{'cache-control':'no-store'});res.end();}else send(res,200,result);
        return;
      }
      if(req.method==='POST'&&/^\/webhooks\/[A-Za-z0-9_-]+$/.test(url.pathname)){
        if(!options.inbox){send(res,404,{error:'NOT_FOUND'});return;}
        const chunks:Buffer[]=[];let length=0;
        if(Number(req.headers['content-length']??0)>WEBHOOK_MAX_BYTES)throw new Error('WEBHOOK_BODY_LIMIT');
        for await(const value of req){const b=Buffer.from(value);length+=b.length;if(length>WEBHOOK_MAX_BYTES)throw new Error('WEBHOOK_BODY_LIMIT');chunks.push(b);}
        try{const result=options.inbox.receive(url.pathname.split('/')[2],req.rawHeaders,Buffer.concat(chunks));send(res,result.http_status,result);return;}
        catch(error){if(!(error instanceof WebhookCapacityError))throw error;
          res.setHeader('retry-after',String(error.retry_after_seconds));send(res,429,{error:error.message,acknowledged:false,retry_after_seconds:error.retry_after_seconds});log(429,error.message);return;}
      }
      if(url.pathname==='/execution-mcp'){
        const authorization=req.headers.authorization;if(typeof authorization!=='string'||!authorization.startsWith('Bearer '))throw new Error('ACCESS_DENIED');
        const value=authorization.slice(7),audience=`http://127.0.0.1:${port}/execution-mcp`;actionMcp.authenticate(value,audience);
        if(req.method!=='POST'){res.setHeader('allow','POST');send(res,405,{error:'METHOD_NOT_ALLOWED'});return;}
        if(!req.headers.accept?.includes('application/json')||!req.headers.accept.includes('text/event-stream')){send(res,406,{error:'MCP_ACCEPT_REQUIRED'});return;}
        const version=req.headers['mcp-protocol-version'];if(version!==undefined&&version!==MCP_VERSION){send(res,400,{error:'UNSUPPORTED_MCP_VERSION'});return;}
        const result=actionMcp.dispatch(value,audience,await body(req),typeof version==='string'?version:undefined);
        if(result===null){res.writeHead(202,{'cache-control':'no-store'});res.end();}else send(res,200,result);return;
      }
      const auth=req.headers.authorization;
      if(typeof auth!=='string'||!auth.startsWith('Bearer '))throw new Error('ACCESS_DENIED');
      if(url.pathname.startsWith('/v1/worker/')){
        const value=auth.slice(7),audience=`http://127.0.0.1:${port}/v1/worker`;workerApi.leases.authenticate(value,audience);
        const operation=url.pathname.slice('/v1/worker/'.length);
        if(req.method==='GET'&&/^results\/[A-Za-z0-9_-]+$/.test(operation)){send(res,200,workerApi.result(value,audience,operation.split('/')[1]));return;}
        if(req.method!=='POST'){send(res,405,{error:'METHOD_NOT_ALLOWED'});return;}
        const p=await body(req);
        if(operation==='claim')send(res,200,workerApi.leases.claim(value,audience,exact(p,['lease_ms']).lease_ms));
        else if(operation==='context')send(res,200,workerApi.context(value,audience,exact(p,['generation']).generation));
        else if(operation==='return-context')send(res,200,workerApi.returnContext(value,audience,exact(p,['generation']).generation));
        else if(operation==='return-action')send(res,200,await workerApi.returnAction(value,audience,p));
        else if(operation==='renew'){const r=exact(p,['generation','lease_ms']);send(res,200,workerApi.leases.renew(value,audience,r.generation,r.lease_ms));}
        else if(operation==='proposals')send(res,200,workerApi.submit(value,audience,p));
        else if(operation==='execute')send(res,200,workerApi.execute(value,audience,p));
        else if(operation==='complete')send(res,200,workerApi.leases.complete(value,audience,p));
        else send(res,404,{error:'NOT_FOUND'});return;
      }
      const scope=kernel.authenticate(auth.slice(7));
      if(req.method==='POST'&&url.pathname==='/v1/return-portability/context'){send(res,200,portability.context(scope,await body(req)));return;}
      if(req.method==='POST'&&url.pathname.startsWith('/v1/return-depth/')){send(res,200,await returnDepth.post(scope,url.pathname.slice('/v1/return-depth/'.length),await body(req)));log(200,'RETURN_DEPTH_OPERATION');return;}
      if(req.method==='POST'&&['/v1/gifts/case','/v1/gifts/prepare','/v1/gifts/rebind'].includes(url.pathname)){
        if(!options.gifts)throw new Error('ADAPTER_UNAVAILABLE');const p=await body(req),op=url.pathname.split('/')[3];
        send(res,200,op==='case'?options.gifts.createCase(scope,p):op==='prepare'?options.gifts.prepare(scope,p):options.gifts.rebind(scope,p));return;
      }
      if(req.method==='POST'&&/^\/v1\/support\/[a-z-]+$/.test(url.pathname)){if(!options.support)throw new Error('SUPPORT_NOT_CONFIGURED');send(res,200,await options.support.post(scope,url.pathname.split('/')[3],await body(req)));log(200,'SUPPORT_OPERATION');return;}


      if(req.method==='POST'&&url.pathname.startsWith('/v1/order-edits/')){
        const op=url.pathname.slice('/v1/order-edits/'.length),p=await body(req);let result:unknown;
        if(op==='configure')result=orderEdits.configure(scope,p);
        else if(op==='refresh')result=orderEdits.refresh(scope,exact(p,['case_id']).case_id);
        else if(op==='quote')result=orderEdits.quote(scope,p);
        else if(op==='prepare')result=orderEdits.prepare(scope,p);
        else if(op==='list')result=orderEdits.list(scope,exact(p,['case_id']).case_id);
        else if(op==='status')result=orderEdits.status(scope,exact(p,['edit_id']).edit_id);
        else if(op==='dispatch')result=await orderEdits.dispatch(scope,exact(p,['edit_id']).edit_id);
        else if(op==='reconcile')result=orderEdits.reconcile(scope,exact(p,['edit_id']).edit_id);
        else if(op==='release')result=await orderEdits.release(scope,exact(p,['edit_id']).edit_id);
        else throw new Error('NOT_FOUND');send(res,200,result);return;
      }
      if(req.method==='POST'&&url.pathname.startsWith('/v1/edit-workflows/')){
        const op=url.pathname.slice('/v1/edit-workflows/'.length),p=await body(req);let result:unknown;
        if(op==='open')result=editWorkflow.open(scope,p);else if(op==='status')result=editWorkflow.status(scope,p);else if(op==='quote')result=editWorkflow.quote(scope,p);else throw new Error('NOT_FOUND');send(res,200,result);return;
      }


      if(req.method==='POST'&&url.pathname.startsWith('/v1/return-workflows/')){
        const op=url.pathname.slice('/v1/return-workflows/'.length),p=await body(req);let result:unknown;
        if(op==='open')result=returnWorkflows.open(scope,p);else if(op==='status')result=returnWorkflows.status(scope,p);else if(op==='quote')result=returnWorkflows.quote(scope,p);else throw new Error('NOT_FOUND');send(res,200,result);return;
      }
      if(req.method==='POST'&&url.pathname.startsWith('/v1/receiving/')){
        const op=url.pathname.slice('/v1/receiving/'.length),p=await body(req);let result:unknown;
        if(op==='open')result=receiving.open(scope,p);else if(op==='scan')result=receiving.scan(scope,p);else if(op==='close')result=receiving.close(scope,p);else if(op==='review')result=receiving.review(scope,p);else if(op==='status')result=receiving.read(scope,exact(p,['session_id']).session_id);else throw new Error('NOT_FOUND');send(res,200,result);return;
      }
      if(req.method==='POST'&&url.pathname.startsWith('/v1/disposition/')){
        const op=url.pathname.slice('/v1/disposition/'.length),p=await body(req);let result:unknown;
        if(op==='quote')result=disposition.quote(scope,p);else {const ref=exact(p,['operation_id']).operation_id;if(op==='status')result=disposition.read(scope,ref);else if(op==='dispatch')result=await disposition.dispatch(scope,ref);else if(op==='reconcile')result=await disposition.reconcile(scope,ref);else throw new Error('NOT_FOUND');}send(res,200,result);return;
      }
      if(req.method==='POST'&&url.pathname.startsWith('/v1/return-closure/')){
        const op=url.pathname.slice('/v1/return-closure/'.length),p=await body(req);let result:unknown;
        if(op==='quote')result=cancellation.quote(scope,p);else if(op==='status')result=cancellation.read(scope,exact(p,['request_id']).request_id);else if(op==='cleanup'){if(!options.fulfillmentSource)throw new Error('ADAPTER_UNAVAILABLE');result=cancellation.cleanup(scope,p,options.fulfillmentSource);}else throw new Error('NOT_FOUND');send(res,200,result);return;
      }
      if(req.method==='POST'&&url.pathname==='/v1/returns/native-changes'){
        if(!nativeChanges)throw new Error('ADAPTER_UNAVAILABLE');send(res,200,await nativeChanges.refresh(scope,exact(await body(req),['request_id']).request_id));return;
      }
      if(req.method==='POST'&&url.pathname==='/v1/integrations/readiness') {const p=exact(await body(req),['action']);send(res,200,readiness.inspect(scope,p.action));return;}
      if(req.method==='GET'&&url.pathname==='/v1/fulfillment/contract'){send(res,200,JSON.parse(readFileSync(new URL('../../packages/commerce/contracts/return-fulfillment.v1.json',import.meta.url),'utf8')));return;}
      if(req.method==='POST'&&url.pathname.startsWith('/v1/fulfillment/')){
        const action=url.pathname.slice('/v1/fulfillment/'.length),p=await body(req);let result:unknown;
        if(!['reserve','reservation','reservation-reconcile','release','replacement-quote','parcel','label-quote','void-quote','operation','dispatch','reconcile','label','tracking','refresh-tracking'].includes(action))throw new Error('NOT_FOUND');
        if(!fulfillment||!inventory||!labels||!tracking)throw new Error('ADAPTER_UNAVAILABLE');
        if(action==='reserve')result=inventory.reserve(scope,p);
        else if(action==='reservation')result=inventory.read(scope,exact(p,['reservation_id']).reservation_id);
        else if(action==='reservation-reconcile')result=inventory.reconcile(scope,exact(p,['reservation_id']).reservation_id);
        else if(action==='release')result=inventory.release(scope,p);
        else if(action==='replacement-quote')result=replacements.quote(scope,p);
        else if(action==='parcel')result=labels.configureParcel(scope,p);
        else if(action==='label-quote')result=labels.quote(scope,p);
        else if(action==='void-quote')result=labels.quoteVoid(scope,p);
        else if(action==='label')result=labels.inspect(scope,exact(p,['label_id']).label_id);
        else if(action==='tracking')result=tracking.read(scope,exact(p,['label_id']).label_id);
        else if(action==='refresh-tracking')result=await tracking.refresh(scope,exact(p,['label_id']).label_id);
        else {const ref=exact(p,['operation_id']).operation_id;result=action==='operation'?fulfillment.read(scope,ref):action==='dispatch'?await fulfillment.dispatch(scope,ref):await fulfillment.reconcile(scope,ref);}
        send(res,200,result);return;
      }
      if(req.method==='POST'&&url.pathname.startsWith('/v1/exchange-lineage/')){
        if(!lineage)throw new Error('ADAPTER_UNAVAILABLE');const action=url.pathname.slice('/v1/exchange-lineage/'.length),p=await body(req);let result:unknown;
        if(action==='materialize')result=lineage.materialize(scope,p);else if(action==='node')result=lineage.read(scope,exact(p,['node_id']).node_id);else throw new Error('NOT_FOUND');send(res,200,result);return;
      }
      if(req.method==='POST'&&url.pathname.startsWith('/v1/exchange-money/')){
        if(!currency||!fees)throw new Error('ADAPTER_UNAVAILABLE');const action=url.pathname.slice('/v1/exchange-money/'.length),p=await body(req);let result:unknown;
        if(action==='bind')result=currency.bind(scope,p);else if(action==='currency')result=currency.read(scope,p);else if(action==='refresh-fee')result=fees.refresh(scope,p);else if(action==='fees')result=fees.read(scope,p);else throw new Error('NOT_FOUND');send(res,200,result);return;
      }
      if(req.method==='POST'&&url.pathname.startsWith('/v1/instant-exchanges/')){
        if(!instant)throw new Error('ADAPTER_UNAVAILABLE');const action=url.pathname.slice('/v1/instant-exchanges/'.length),p=await body(req);let result:unknown;
        if(action==='configure')result=instant.configure(scope,p);else if(action==='authorize-quote')result=instant.quoteAuthorize(scope,p);else if(action==='reauthorize-quote')result=instant.quoteReauthorize(scope,p);else if(action==='capture-quote')result=instant.quoteCapture(scope,p);else if(action==='cancel-quote')result=instant.quoteCancel(scope,p);else if(action==='binding')result=instant.binding(scope,exact(p,['exchange_quote_id']).exchange_quote_id);
        else {const ref=exact(p,['operation_id']).operation_id;if(action==='operation')result=instant.read(scope,ref);else if(action==='dispatch')result=await instant.dispatch(scope,ref);else if(action==='reconcile')result=await instant.reconcile(scope,ref);else throw new Error('NOT_FOUND');}send(res,200,result);return;
      }
      if(req.method==='POST'&&url.pathname.startsWith('/v1/resolutions/')){
        const action=url.pathname.slice('/v1/resolutions/'.length),p=await body(req);let result:unknown;
        if(action==='allocate')result=resolutionLedger.allocate(scope,p);
        else if(action==='plan')result=resolutionLedger.read(scope,exact(p,['plan_id']).plan_id);
        else if(action==='quote')result=refundQuotes.quote(scope,p);
        else if(action==='credit-quote')result=storeCredit.quote(scope,exact(p,['allocation_id']).allocation_id);
        else if(action==='exchange-quote')result=exchanges.quote(scope,p);
        else if(action==='exchange-configure')result=exchanges.configure(scope,p);
        else if(action==='exchange-browse')result=exchanges.browse(scope,p);
        else if(action==='exchange-finance-quote')result=exchangeFinance.quote(scope,p);
        else if(action==='exchange-current')result=exchanges.assertCurrent(scope,p);
        else if(['operation','dispatch','reconcile','instrument'].includes(action)){
          const ref=exact(p,['operation_id']).operation_id;
          if(!resolutionExecution)throw new Error('ADAPTER_UNAVAILABLE');
          result=action==='operation'?resolutionExecution.read(scope,ref):action==='dispatch'?await resolutionExecution.dispatch(scope,ref):action==='reconcile'?await resolutionExecution.reconcile(scope,ref):storeCredit.instrument(scope,resolutionExecution,ref);
        }else throw new Error('NOT_FOUND');
        send(res,200,result);return;
      }
      if(req.method==='POST'&&url.pathname==='/v1/returns/configure'){send(res,200,intake.configure(scope,await body(req)));return;}
      if(req.method==='POST'&&url.pathname==='/v1/returns/form'){send(res,200,intake.form(scope,exact(await body(req),['case_id']).case_id));return;}
      if(req.method==='POST'&&url.pathname==='/v1/returns/quote'){send(res,200,intake.evaluate(scope,await body(req)));return;}
      if(req.method==='POST'&&url.pathname==='/v1/returns/prepare'){send(res,200,intake.prepare(scope,await body(req)));return;}
      if(req.method==='POST'&&url.pathname==='/v1/returns/revise'){send(res,200,intake.revise(scope,await body(req)));return;}
      if(req.method==='POST'&&url.pathname==='/v1/returns/status'){send(res,200,intake.read(scope,exact(await body(req),['case_id']).case_id));return;}
      if(req.method==='POST'&&url.pathname==='/v1/returns/review/evidence'){send(res,200,returnReview.requestEvidence(scope,await body(req)));return;}
      if(req.method==='POST'&&url.pathname==='/v1/returns/review/resolve-evidence'){send(res,200,returnReview.resolveEvidence(scope,await body(req)));return;}
      if(req.method==='POST'&&url.pathname==='/v1/returns/review/override'){send(res,200,returnReview.override(scope,await body(req)));return;}
      if(req.method==='POST'&&url.pathname==='/v1/returns/review/revoke'){send(res,200,returnReview.revoke(scope,exact(await body(req),['override_id']).override_id));return;}
      if(req.method==='POST'&&url.pathname==='/v1/return-evidence/upload'){
        if(req.headers['content-type']!=='application/json')throw new Error('JSON_REQUIRED');let length=0;const chunks:Buffer[]=[];
        for await(const chunk of req){length+=chunk.length;if(length>360000)throw new Error('BODY_TOO_LARGE');chunks.push(Buffer.from(chunk));}
        let value:unknown;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('INVALID_JSON');}
        send(res,201,returnEvidence.upload(scope,value));return;
      }
      if(req.method==='POST'&&/^\/v1\/return-evidence\/(status|scan|sign|erase)$/.test(url.pathname)){
        const ref=exact(await body(req),['id']).id,action=url.pathname.split('/')[3];
        send(res,200,action==='status'?returnEvidence.inspect(scope,ref):action==='scan'?await returnEvidence.scan(scope,ref):action==='sign'?returnEvidence.sign(scope,ref):returnEvidence.erase(scope,ref));return;
      }
      if(req.method==='POST'&&url.pathname==='/v1/return-evidence/content'){
        const p=exact(await body(req),['id','token']),bytes=returnEvidence.content(scope,p.id,p.token);
        res.writeHead(200,{'content-type':'application/octet-stream','content-disposition':'attachment; filename="evidence.png"','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; sandbox"});res.end(bytes);return;
      }

      if(req.method==='POST'&&url.pathname==='/v1/return-drafts/prepare') {send(res,200,drafts.prepare(scope,await body(req)));return;}
      if(req.method==='POST'&&url.pathname==='/v1/return-drafts/resume') {const p=exact(await body(req),['case_id']);send(res,200,drafts.read(scope,p.case_id));return;}
      if(req.method==='GET'&&url.pathname==='/v1/privacy/inventory') {kernel.authorize(scope,'privacy.manage');send(res,200,storageInventoryCurrent(kernel));return;}
      if(req.method==='POST'&&url.pathname==='/v1/privacy/export') {const p=exact(await body(req),['customer_id']);send(res,200,privacy.export(scope,p.customer_id));return;}
      if(req.method==='POST'&&url.pathname==='/v1/privacy/erase') {const p=exact(await body(req),['customer_id']);send(res,200,privacy.erase(scope,p.customer_id));return;}
      if(req.method==='POST'&&url.pathname==='/v1/privacy/hold') {send(res,200,privacy.hold(scope,await body(req)));return;}
      if(req.method==='POST'&&url.pathname==='/v1/privacy/uninstall') {exact(await body(req),[]);send(res,200,privacy.uninstall(scope));return;}

      if(req.method==='POST'&&url.pathname==='/v1/work-grants'){send(res,201,workerApi.leases.issue(scope,await body(req),`http://127.0.0.1:${port}/v1/worker`));return;}
      if(req.method==='POST'&&url.pathname==='/v1/work-release'){send(res,200,workerApi.leases.release(scope,exact(await body(req),['case_id']).case_id));return;}
      if(req.method==='GET'&&url.pathname==='/v1/worker-contract'){send(res,200,JSON.parse(readFileSync(new URL('../../packages/commerce/contracts/worker-api.v1.json',import.meta.url),'utf8')));return;}
      if(req.method==='POST'&&url.pathname==='/v1/execution-stops'){send(res,200,new ExecutionStops(kernel).set(scope,await body(req)));return;}
      if(req.method==='GET'&&url.pathname==='/v1/exceptions'){send(res,200,exceptions.list(scope));return;}
      if(req.method==='POST'&&/^\/v1\/exceptions\/[A-Za-z0-9_-]+\/(reconcile|reauthorize)$/.test(url.pathname)){
        const [, , ,ref,action]=url.pathname.split('/'),p=await body(req);
        if(action==='reconcile'){exact(p,[]);send(res,200,await exceptions.reconcile(scope,ref));}
        else send(res,200,exceptions.reauthorize(scope,ref,exact(p,['expected_revision']).expected_revision));return;
      }

      if(req.method==='GET'&&/^\/v1\/operations\/[A-Za-z0-9_-]+$/.test(url.pathname)){send(res,200,new BusinessOperations(kernel).read(scope,url.pathname.split('/')[3]));return;}
      if(req.method==='GET'&&/^\/v1\/operations\/[A-Za-z0-9_-]+\/receipts$/.test(url.pathname)){send(res,200,new OperationReceipts(kernel).list(scope,url.pathname.split('/')[3]));return;}
      if(req.method==='GET'&&/^\/v1\/resources\/[A-Za-z0-9_-]+\/operations$/.test(url.pathname)){send(res,200,new BusinessOperations(kernel).list(scope,url.pathname.split('/')[3]));return;}
      if(req.method==='POST'&&url.pathname==='/v1/operations/by-receipt'){send(res,200,new BusinessOperations(kernel).fromReceipt(scope,await body(req)));return;}
      if(req.method==='POST'&&url.pathname==='/v1/cases'){send(res,201,gateway.cases.create(scope,await body(req)));return;}
      if(req.method==='GET'&&/^\/v1\/cases\/[A-Za-z0-9_-]+$/.test(url.pathname)){send(res,200,gateway.cases.resume(scope,url.pathname.split('/')[3]));return;}
      if(req.method==='POST'&&/^\/v1\/cases\/[A-Za-z0-9_-]+\/migrate$/.test(url.pathname)){send(res,200,gateway.cases.migrate(scope,url.pathname.split('/')[3],await body(req)));return;}
      if(req.method==='GET'&&url.pathname==='/v1/execution-contract'){send(res,200,JSON.parse(readFileSync(new URL('../../packages/commerce/contracts/execution-api.openapi.json',import.meta.url),'utf8')));return;}
      if(req.method==='POST'&&url.pathname==='/v1/execution/grants'){send(res,201,actionMcp.issue(scope,await body(req),`http://127.0.0.1:${port}/execution-mcp`));return;}
      if(req.method==='POST'&&/^\/v1\/execution\/(configure|preview|approve|execute)$/.test(url.pathname)){
        const action=url.pathname.split('/')[3],value=await body(req);
        send(res,200,action==='preview'?gateway.prepare(scope,value):action==='configure'?gateway.configure(scope,value):action==='approve'?gateway.approve(scope,value):gateway.execute(scope,value));return;
      }
      if(req.method==='POST'&&/^\/v1\/execution\/approvals\/[A-Za-z0-9_-]+\/revoke$/.test(url.pathname)){exact(await body(req),[]);send(res,200,gateway.revokeApproval(scope,url.pathname.split('/')[4]));return;}
      if(req.method==='GET'&&/^\/v1\/execution\/receipts\/[A-Za-z0-9_-]+$/.test(url.pathname)){send(res,200,gateway.receipt(scope,url.pathname.split('/')[4]));return;}
      if(req.method==='GET'&&/^\/v1\/execution\/state\/[A-Za-z0-9_-]+$/.test(url.pathname)){send(res,200,gateway.state(scope,url.pathname.split('/')[4]));return;}
      if(req.method==='POST'&&/^\/v1\/skill-releases\/(stage|evaluate|review|publish|rollback|revoke)$/.test(url.pathname)){
        const action=url.pathname.split('/')[3],p=await body(req);
        const result=action==='evaluate'?releases.evaluate(scope,exact(p,['release_id']).release_id):releases[action as 'stage'|'review'|'publish'|'rollback'|'revoke'](scope,p);send(res,200,result);return;
      }
      if(req.method==='GET'&&/^\/v1\/webhook-inbox\/[A-Za-z0-9_-]+$/.test(url.pathname)){if(!options.inbox)throw new Error('NOT_FOUND');send(res,200,options.inbox.read(scope,url.pathname.split('/')[3]));return;}

      if(req.method==='GET'&&url.pathname==='/v1/skill-manifest-schema'){
        kernel.authorize(scope,'skill.read');send(res,200,manifestSchema());
      } else if(req.method==='POST'&&url.pathname==='/v1/skill-manifest/validate'){
        kernel.authorize(scope,'skill.read');send(res,200,validateManifest(await body(req)));
      } else if(req.method==='POST'&&url.pathname==='/v1/configuration/start'){
        const p=exact(await body(req),['id']);send(res,201,editor.start(scope,id(p.id)));
      } else if(req.method==='GET'&&/^\/v1\/configuration\/[A-Za-z0-9_-]+$/.test(url.pathname)){
        send(res,200,editor.get(scope,id(url.pathname.split('/')[3])));
      } else if(req.method==='POST'&&/^\/v1\/configuration\/[A-Za-z0-9_-]+\/(edit|restore|simulate|request)$/.test(url.pathname)){
        const profileId=id(url.pathname.split('/')[3]),operation=url.pathname.split('/')[4],p=await body(req);
        if(operation==='edit')send(res,200,editor.edit(scope,profileId,p));
        else if(operation==='restore')send(res,200,editor.restore(scope,profileId,p));
        else if(operation==='simulate')send(res,200,editor.simulate(scope,profileId,exact(p,['expected_revision']).expected_revision));
        else send(res,200,editor.requestReview(scope,profileId,p));
      } else if(req.method==='POST'&&url.pathname==='/v1/policies/draft'){
        send(res,201,policies.create(scope,await body(req)));
      } else if(req.method==='GET'&&/^\/v1\/policies\/[A-Za-z0-9_-]+\/[0-9]+$/.test(url.pathname)){
        send(res,200,policies.get(scope,id(url.pathname.split('/')[3]),Number(url.pathname.split('/')[4])));
      } else if(req.method==='POST'&&/^\/v1\/policies\/(test|review|publish|revoke|pin|evaluate)$/.test(url.pathname)){
        const action=url.pathname.split('/')[3],input=await body(req);
        if(action==='publish')send(res,200,policies.publish(scope,input));
        else if(action==='pin'){const p=exact(input,['policy_id','facts']);send(res,201,policies.pin(scope,id(p.policy_id),p.facts));}
        else if(action==='evaluate'){const p=exact(input,['pin_id']);send(res,200,policies.evaluatePin(scope,id(p.pin_id)));}
        else {const p=exact(input,['policy_id','version','digest']);send(res,200,policies[action as 'test'|'review'|'revoke'](scope,id(p.policy_id),p.version,p.digest));}
      } else if(req.method==='GET'&&url.pathname==='/v1/permissions'){
        const p=new Permissions(kernel);send(res,200,{decisions:['resource.read','model.run','authority.manage','audit.read'].map(a=>p.preview(scope,a)),execution_authorized:false});
      } else if(req.method==='POST'&&url.pathname==='/v1/permissions/change'){
        send(res,200,new Permissions(kernel).change(scope,await body(req)));
      } else if(req.method==='GET'&&url.pathname==='/v1/permissions/events'){
        send(res,200,{events:new Permissions(kernel).events(scope)});
      } else if(req.method==='POST'&&url.pathname==='/v1/mcp-grants') {
        send(res,201,mcp.issue(scope,await body(req),`http://127.0.0.1:${port}/mcp`));
      } else if(req.method==='GET'&&url.pathname==='/v1/read-contract') {
        send(res,200,JSON.parse(readFileSync(new URL('../../packages/commerce/contracts/read-api.openapi.json',import.meta.url),'utf8')));
      } else if(req.method==='GET'&&/^\/v1\/orders\/[A-Za-z0-9_-]+\/status$/.test(url.pathname)) {
        send(res,200,reads.orderStatus(scope,id(url.pathname.split('/')[3])));
      } else if(req.method==='GET'&&url.pathname==='/v1/knowledge/search') {
        if([...url.searchParams.keys()].join(',')!=='query')throw new Error('INVALID_INPUT');
        send(res,200,reads.knowledge.search(scope,url.searchParams.get('query')!));
      } else if(req.method==='GET'&&/^\/v1\/knowledge\/[A-Za-z0-9_-]+\/revisions\/[0-9]+$/.test(url.pathname)) {
        send(res,200,reads.knowledge.get(scope,url.pathname.split('/')[3],Number(url.pathname.split('/')[5])));
      } else if(req.method==='GET'&&url.pathname==='/v1/skill-content') {
        if([...url.searchParams.keys()].sort().join(',')!=='bundle_digest,resource,skill_id')throw new Error('INVALID_INPUT');
        send(res,200,reads.skills.read(scope,id(url.searchParams.get('skill_id')),url.searchParams.get('resource')!,url.searchParams.get('bundle_digest')!));
      } else if(req.method==='GET'&&/^\/v1\/profiles\/[A-Za-z0-9_-]+$/.test(url.pathname)) {
        send(res,200,reads.profiles.get(scope,id(url.pathname.split('/')[3])));
      } else if(req.method==='POST'&&/^\/v1\/read-tasks\/[A-Za-z0-9_-]+\/assist$/.test(url.pathname)) {
        if(!options.runner)throw new Error('ADAPTER_UNAVAILABLE');
        const value=await body(req);
        const input=exact(value,value&&typeof value==='object'&&Object.hasOwn(value,'untrusted_input')?['configuration_id','untrusted_input']:['configuration_id']);
        send(res,200,await options.runner.run(scope,id(url.pathname.split('/')[3]),id(input.configuration_id),input.untrusted_input));
      } else if(req.method==='GET'&&/^\/v1\/read-tasks\/[A-Za-z0-9_-]+\/receipts\/[A-Za-z0-9_-]+$/.test(url.pathname)) {
        if(!options.runner)throw new Error('ADAPTER_UNAVAILABLE');
        send(res,200,options.runner.receipt(scope,id(url.pathname.split('/')[3]),id(url.pathname.split('/')[5])));
      } else if(req.method==='POST'&&url.pathname==='/v1/read-tasks') {
        send(res,201,reads.createTask(scope,await body(req)));
      } else if(req.method==='GET'&&/^\/v1\/read-tasks\/[A-Za-z0-9_-]+$/.test(url.pathname)) {
        send(res,200,reads.task(scope,id(url.pathname.split('/')[3])));
      } else if(req.method==='POST'&&/^\/v1\/read-tasks\/[A-Za-z0-9_-]+\/actions$/.test(url.pathname)) {
        const r=exact(await body(req),['action','arguments']);if(typeof r.action!=='string'||r.action.length>64)throw new Error('INVALID_INPUT');
        send(res,200,reads.taskAction(scope,id(url.pathname.split('/')[3]),r.action,r.arguments));
      } else if(req.method==='GET'&&url.pathname==='/v1/capabilities')send(res,200,{capabilities:caps.list(scope)});
      else if(req.method==='GET'&&url.pathname==='/v1/resources'){
        if([...url.searchParams.keys()].join(',')!=='kind')throw new Error('INVALID_INPUT');
        send(res,200,{resources:caps.listResources(scope,url.searchParams.get('kind')!)});
      } else if(req.method==='GET'&&url.pathname==='/v1/lookup'){
        if([...url.searchParams.keys()].sort().join(',')!=='external_id,kind')throw new Error('INVALID_INPUT');
        send(res,200,simulator.read(scope,url.searchParams.get('kind')!,url.searchParams.get('external_id')!));
      } else if(req.method==='GET'&&url.pathname.startsWith('/v1/resources/')){
        const resourceId=id(url.pathname.slice('/v1/resources/'.length));const resource=kernel.get(scope,resourceId);
        const action=Object.entries(READS).find(([,v])=>v.kind===resource.kind)?.[0];
        if(!action)throw new CapabilityLimitation('UNKNOWN_ACTION');send(res,200,caps.read(scope,action,resourceId));
      } else if(req.method==='POST'&&url.pathname==='/v1/actions'){
        const r=exact(await body(req),['action','resource_id']);if(typeof r.action!=='string'||r.action.length>64)throw new Error('INVALID_INPUT');
        send(res,200,caps.read(scope,r.action,id(r.resource_id)));
      } else if(req.method==='POST'&&url.pathname==='/v1/session/logout'){
        kernel.revoke(scope);res.setHeader('clear-site-data','"cache", "storage"');send(res,200,{revoked:true});
      } else if(req.method==='GET'&&url.pathname==='/v1/secrets'){
        if(!vault)throw new Error('SECRET_UNAVAILABLE');send(res,200,{references:vault.list(scope)});
      } else if(req.method==='POST'&&url.pathname==='/v1/secrets/probe'){
        if(!vault)throw new Error('SECRET_UNAVAILABLE');const r=exact(await body(req),['ref','adapter']);
        send(res,200,await vault.probe(scope,id(r.ref),id(r.adapter)));
      } else {send(res,404,{error:'NOT_FOUND'});log(404,'NOT_FOUND');return;}
      log(200,'READ_OR_SESSION_OPERATION');
    } catch(error) {
      if(error instanceof ConfigurationError){send(res,400,{error:error.message,issues:error.issues});log(400,error.message);return;}
      if(error instanceof CapabilityLimitation){send(res,403,{error:'CAPABILITY_UNAVAILABLE',reason:error.reason});log(403,'CAPABILITY_UNAVAILABLE');return;}
      const code=error instanceof Error&&/^EDIT_INELIGIBLE:/.test(error.message)?'EDIT_INELIGIBLE':error instanceof Error&&(SAFE_CODES.has(error.message)||SUPPORT_ERRORS.has(error.message)||RETURN_DEPTH_ERRORS.has(error.message))?error.message:'INTERNAL_ERROR';
      const status=code==='WORK_ACCESS_DENIED'?401:code==='WEBHOOK_PERSISTENCE_FAILED'?503:code==='WEBHOOK_BODY_LIMIT'?413:code==='WEBHOOK_SIGNATURE_INVALID'?401:['ACCESS_DENIED','HOST_DENIED','ORIGIN_DENIED','VERIFICATION_FAILED'].includes(code)?403:code==='NOT_FOUND'?404:code==='INTERNAL_ERROR'?500:
        ['SECRET_UNAVAILABLE','ADAPTER_UNAVAILABLE','PROVIDER_UNAVAILABLE','OUTCOME_UNKNOWN'].includes(code)?503:400;
      send(res,status,{error:code});log(status,code);
    }
  });
  port=await listen(server,options.port??0);
  return {port,url:`http://127.0.0.1:${port}`,close:()=>new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();})};
}
