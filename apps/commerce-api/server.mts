import { ReturnIntake } from '../../packages/commerce/return-intake.mts';
import { ReturnReview } from '../../packages/commerce/return-intake-core.mts';
import { ReturnEvidence } from '../../packages/commerce/return-evidence.mts';
import type { EvidenceScanner } from '../../packages/commerce/return-evidence.mts';
import { ReturnDrafts } from '../../packages/commerce/return-drafts.mts';
import { IntegrationReadiness } from '../../packages/commerce/integration-readiness.mts';
import { PrivacyLifecycle } from '../../packages/commerce/privacy-lifecycle.mts';
import { WorkerApi } from '../../packages/commerce/worker-api.mts';
import { ExceptionQueue } from '../../packages/commerce/exception-queue.mts';
import type { JournalResolver } from '../../packages/commerce/exception-queue.mts';
import { ExecutionStops } from '../../packages/commerce/execution-stops.mts';
import { BusinessOperations } from '../../packages/commerce/operation-store.mts';
import { OperationReceipts } from '../../packages/commerce/operation-receipts.mts';
import { ActionGateway } from '../../packages/commerce/action-gateway.mts';
import { ActionMcp } from '../../packages/agent/action-mcp.mts';
import { SkillReleases } from '../../packages/commerce/skill-releases.mts';
import { WEBHOOK_MAX_BYTES } from '../../packages/commerce/webhook-inbox.mts';
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

const SAFE_CODES=new Set(['RETURN_NOT_CONFIGURED','RETURN_SETTINGS_CHANGED','RETURN_SETTINGS_INTEGRITY','RETURN_SOURCE_MISSING','RETURN_QUOTE_INTEGRITY','RETURN_QUOTE_CHANGED','RETURN_QUOTE_EXPIRED','RETURN_REVIEW_REQUIRED','RETURN_REQUEST_CONFLICT','RETURN_REQUEST_INTEGRITY','RETURN_OVERRIDE_UNAVAILABLE','RETURN_OVERRIDE_REVOKED','RETURN_OVERRIDE_DENIED','SELF_REVIEW_DENIED','UNKNOWN_RETURN_LINE','INVALID_QUANTITY','DUPLICATE_LINE','INVALID_TIME_ZONE','INVALID_FEE','EVIDENCE_TYPE_REJECTED','EVIDENCE_DECOMPRESSION_LIMIT','EVIDENCE_UNAVAILABLE','EVIDENCE_INTEGRITY','EVIDENCE_LIMIT','EVIDENCE_CHANGED','EVIDENCE_SCAN_INVALID','EVIDENCE_ACCESS_DENIED','BODY_TOO_LARGE','JSON_REQUIRED','INVALID_JSON','INTEGRATION_NOT_READY','SUBJECT_ERASED','RESTORE_WRITE_BLOCKED','RESTORE_EGRESS_BLOCKED','DRAFT_CONFLICT','STORAGE_INVENTORY_CHANGED','PRIVACY_BATCH_LIMIT','PRIVACY_EXPORT_LIMIT','HOLD_NOT_FOUND','WORK_ACCESS_DENIED','WORK_SCOPE_DENIED','WORK_FENCE_REJECTED','WORK_CONTEXT_CHANGED','WORK_LEASE_HELD','WORK_LIMIT','WORK_RESULT_INVALID','WORK_RESULT_INTEGRITY','WORK_ENVELOPE_REJECTED','WORK_IDEMPOTENCY_CONFLICT','EXECUTION_STOPPED','EXECUTION_REAUTHORIZATION_REQUIRED','CONTROL_CHANGED','CONTROL_UNCHANGED','RECONCILIATION_REQUIRED','SOURCE_UNAVAILABLE','OPERATION_CHANGED','CASE_CHANGED','CASE_EXISTS','CASE_PIN_INTEGRITY','CASE_CUSTOMER_CHANGED','CASE_CONTEXT_UNSUPPORTED','SKILL_PIN_MISSING','SKILL_REVOKED','CONFIGURATION_REPREVIEW_REQUIRED','CONFIGURATION_NOT_APPROVED','CUSTOMER_VERIFICATION_REQUIRED','CAPABILITY_CHANGED','CAPABILITY_UNAVAILABLE','UNSUPPORTED_ACTION','SOURCE_STALE','SOURCE_FACTS_MISSING','POLICY_DENIED','PREVIEW_INTEGRITY','PREVIEW_STALE','PREVIEW_EXPIRED','SELF_APPROVAL_DENIED','APPROVAL_EXISTS','APPROVAL_UNAVAILABLE','APPROVAL_AUTHORITY_CHANGED','RECEIPT_INTEGRITY','RELEASE_TRANSITION','RELEASE_INTEGRITY','ACTIVATION_CHANGED','CANARY_FALLBACK_REQUIRED','ROLLBACK_TARGET_INVALID','WEBHOOK_BODY_LIMIT','WEBHOOK_HEADERS_INVALID','WEBHOOK_SIGNATURE_INVALID','WEBHOOK_ROUTE_MISMATCH','WEBHOOK_EXPIRED','WEBHOOK_CONTENT_TYPE','WEBHOOK_ROUTE_UNAVAILABLE','WEBHOOK_KEY_UNAVAILABLE','WEBHOOK_PAYLOAD_INVALID','WEBHOOK_DELIVERY_CONFLICT','WEBHOOK_PERSISTENCE_FAILED','PROFILE_EXISTS','PROFILE_CHANGED','PROFILE_NOT_READY','SIMULATION_REQUIRED','SIMULATION_STALE','DRAFT_HISTORY_LIMIT','POLICY_CHANGED','POLICY_INTEGRITY','POLICY_UNAVAILABLE','POLICY_REVOKED','POLICY_TRANSITION','SELF_REVIEW_DENIED','POLICY_TEST_FAILED','REVIEW_AUTHORITY_CHANGED','ACTIVATION_CONFLICT','ACTIVATION_ORDER','SKILL_APPROVAL_REQUIRED','SKILL_DOWNGRADE_DENIED','ACCESS_DENIED','NOT_FOUND','INVALID_INPUT','JSON_REQUIRED','BODY_TOO_LARGE','INVALID_JSON',
  'INVALID_PERMISSION','AUTHORITY_CHANGED','LAST_OWNER','RESOURCE_DENIED','INVALID_SKILL','SKILL_CHANGED','PROFILE_STALE','PROFILE_ACTION_DENIED','INVALID_PROFILE',
  'NO_CONFIGURATION','RUN_IN_PROGRESS','TASK_CONTEXT_CHANGED','UNKNOWN_READ_ACTION','CURRENT_FACTS_UNAVAILABLE','TASK_LIMIT','HOST_DENIED','ORIGIN_DENIED','VERIFICATION_FAILED','SECRET_UNAVAILABLE','ADAPTER_UNAVAILABLE','PROVIDER_REJECTED','PROVIDER_UNAVAILABLE','OUTCOME_UNKNOWN']);
export async function startCommerceServer(options:{kernel:CommerceKernel;caps:Capabilities;customers:CustomerAccess;
  simulator:StoreSimulator;evidenceScanner?:EvidenceScanner;reconciliationJournals?:JournalResolver;vault?:SecretVault;inbox?:WebhookInbox;reads?:ReadContext;runner?:{run:(scope:object,taskId:string,configurationId:string,untrustedInput?:unknown)=>Promise<unknown>;receipt:(scope:object,taskId:string,receiptId:string)=>unknown};port?:number;log?:(entry:unknown)=>void}) {
  const {kernel,caps,customers,simulator,vault}=options;const reads=options.reads??new ReadContext(kernel,caps);const mcp=new ReadMcp(kernel,reads);const editor=new ProfileEditor(kernel,caps),policies=new Policies(kernel);let port=0;const gateway=new ActionGateway(kernel),actionMcp=new ActionMcp(kernel,gateway),releases=new SkillReleases(kernel);
  const intake=new ReturnIntake(kernel),returnReview=new ReturnReview(kernel),returnEvidence=new ReturnEvidence(kernel,options.evidenceScanner??null);
  const drafts=new ReturnDrafts(kernel),privacy=new PrivacyLifecycle(kernel),readiness=new IntegrationReadiness(kernel);
  const workerApi=new WorkerApi(kernel),exceptions=new ExceptionQueue(kernel,options.reconciliationJournals);
  const log=(status:number,code:string)=>{try{options.log?.({event:'http_result',status,code});}catch{/* logging cannot grant access */}};
  const server=createServer(async(req,res)=>{
    try {
      sameOrigin(req,port);
      const url=new URL(req.url??'/',`http://127.0.0.1:${port}`);
      if(url.origin!==`http://127.0.0.1:${port}`)throw new Error('HOST_DENIED');
      if(url.pathname==='/health'&&req.method==='GET'){send(res,200,{ready:true,profile:'commerce-sqlite-diagnostic',production_qualified:false});return;}
      const assets:Record<string,[string,string]>={'/returns':['returns.html','text/html'],'/returns-client.js':['returns-client.js','text/javascript'],'/returns.css':['returns.css','text/css'],'/return-draft':['return-draft.html','text/html'],'/return-draft-client.js':['return-draft-client.js','text/javascript'],'/exceptions':['exceptions.html','text/html'],'/exceptions.css':['exceptions.css','text/css'],
    '/exceptions-client.js':['exceptions-client.js','text/javascript'],'/execution':['execution.html','text/html'],'/execution-client.js':['execution-client.js','text/javascript'],'/configuration':['configuration.html','text/html'],'/configuration-client.js':['configuration-client.js','text/javascript'],'/configuration.css':['configuration.css','text/css'],'/':['index.html','text/html'],'/client.js':['client.js','text/javascript'],'/style.css':['style.css','text/css'],'/status':['status.html','text/html'],'/status-client.js':['status-client.js','text/javascript'],'/status.css':['status.css','text/css']};
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
        const result=options.inbox.receive(url.pathname.split('/')[2],req.rawHeaders,Buffer.concat(chunks));send(res,result.http_status,result);return;
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
        else if(operation==='renew'){const r=exact(p,['generation','lease_ms']);send(res,200,workerApi.leases.renew(value,audience,r.generation,r.lease_ms));}
        else if(operation==='proposals')send(res,200,workerApi.submit(value,audience,p));
        else if(operation==='execute')send(res,200,workerApi.execute(value,audience,p));
        else if(operation==='complete')send(res,200,workerApi.leases.complete(value,audience,p));
        else send(res,404,{error:'NOT_FOUND'});return;
      }
      const scope=kernel.authenticate(auth.slice(7));
      if(req.method==='POST'&&url.pathname==='/v1/integrations/readiness') {const p=exact(await body(req),['action']);send(res,200,readiness.inspect(scope,p.action));return;}
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
      const code=error instanceof Error&&SAFE_CODES.has(error.message)?error.message:'INTERNAL_ERROR';
      const status=code==='WORK_ACCESS_DENIED'?401:code==='WEBHOOK_PERSISTENCE_FAILED'?503:code==='WEBHOOK_BODY_LIMIT'?413:code==='WEBHOOK_SIGNATURE_INVALID'?401:['ACCESS_DENIED','HOST_DENIED','ORIGIN_DENIED','VERIFICATION_FAILED'].includes(code)?403:code==='NOT_FOUND'?404:code==='INTERNAL_ERROR'?500:
        ['SECRET_UNAVAILABLE','ADAPTER_UNAVAILABLE','PROVIDER_UNAVAILABLE','OUTCOME_UNKNOWN'].includes(code)?503:400;
      send(res,status,{error:code});log(status,code);
    }
  });
  port=await listen(server,options.port??0);
  return {port,url:`http://127.0.0.1:${port}`,close:()=>new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();})};
}
