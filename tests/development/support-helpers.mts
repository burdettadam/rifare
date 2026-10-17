import {DatabaseSync} from 'node:sqlite';import {join} from 'node:path';
import {executionFixture} from './execution-helpers.mts';
import {SupportConversations} from '../../packages/commerce/support-conversations.mts';
import {SupportOwnership} from '../../packages/commerce/support-core.mts';
import {SupportConsent} from '../../packages/commerce/support-consent.mts';
import {SupportTracking} from '../../packages/commerce/support-tracking.mts';
import {SupportDelivery} from '../../packages/commerce/support-delivery.mts';
import {SupportFixtureSource} from '../../packages/adapters/support-fixture-source.mts';
export function supportFixture(){const f=executionFixture();let sourceDb:DatabaseSync|undefined;try{
 sourceDb=new DatabaseSync(join(f.directory,'support-source.sqlite'));const source=new SupportFixtureSource(sourceDb,f.a.tenant,f.a.store,'merchant_mail',f.now),conversations=new SupportConversations(f.kernel),ownership=new SupportOwnership(f.kernel),consent=new SupportConsent(f.kernel),tracking=new SupportTracking(f.kernel,f.reads),delivery=new SupportDelivery(f.kernel,tracking,[source]);
 const link=conversations.link(f.a.scope,f.customer,{case_id:'case_one',channel:'email',account_id:source.account,external_id:'thread_one',history:'partial',source_revision:1});
 const senderInput={id:'sender_one',expected_revision:0,channel:'email',address:'support@example.invalid',account_id:source.account,source_identity:source.identity,source_contract:source.contract,expires_at:f.now()+3600000,jurisdiction:'US_TEST',transactional_basis:'order_service'};
 consent.configureSender(f.owner.scope,senderInput);consent.verifyContact(f.a.scope,f.customer,{link_id:link.id,address:'shopper-apparel@example.invalid'});
 const message=(extras:any={})=>({case_id:'case_one',link_id:link.id,sender_id:'sender_one',template_id:'tracking_status_v1',event_id:'delivery_one',expected_generation:ownership.inspect(f.a.scope,'case_one')!.generation,...extras});
 const grant=(extras:any={})=>({case_id:'case_one',sender_id:'sender_one',channel:'email',purpose:'marketing',state:'granted',event_id:'consent_one',source_version:1,effective_at:f.now(),source_ref:'customer_click',...extras});
 return {...f,sourceDb,source,conversations,ownership,consent,tracking,delivery,link,senderInput,message,grant,cleanup:()=>{sourceDb!.close();f.cleanup();}};
 }catch(e){sourceDb?.close();f.cleanup();throw e;}}
export async function usingSupport(fn:(f:ReturnType<typeof supportFixture>)=>unknown){const f=supportFixture();try{return await fn(f);}finally{f.cleanup();}}
