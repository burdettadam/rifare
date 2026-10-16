import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { CommerceKernel } from '../packages/commerce/kernel.mts';
import { Capabilities } from '../packages/commerce/capabilities.mts';
import { StoreSimulator } from '../packages/commerce/simulator.mts';
import { Policies } from '../packages/commerce/policies.mts';
import { ProfileEditor } from '../packages/commerce/profile-editor.mts';
import { SkillInstaller,readInstructionDirectory } from '../packages/commerce/skill-installer.mts';
import { contentDigest } from '../packages/commerce/configuration-values.mts';

const db=new DatabaseSync(':memory:');
try{
  const now=Date.UTC(2026,0,15,12),kernel=new CommerceKernel(db,()=>now),caps=new Capabilities(kernel);
  kernel.provisionStore('demo','store');
  const session=(actor:string,role:'owner'|'operator'|'reviewer')=>{kernel.provisionMember('demo','store',actor,role);return kernel.authenticate(kernel.issueSession('demo','store',actor));};
  const owner=session('demo-owner','owner'),operator=session('demo-operator','operator'),reviewer=session('demo-reviewer','reviewer');
  new StoreSimulator(kernel,caps).reset(operator);
  const policies=new Policies(kernel),editor=new ProfileEditor(kernel,caps),installer=new SkillInstaller(kernel);
  const rules={window_days:14,require_evidence:true,excluded_tags:['final-sale'],outcomes:['refund']};
  const p=policies.create(operator,{policy_id:'returns',expected_version:0,rules,selection:'pin_at_request',sources:[{uri:'https://merchant.example.invalid/returns',revision:'1',sha256:contentDigest(rules)}]});
  policies.test(operator,'returns',1,p.digest);policies.review(reviewer,'returns',1,p.digest);
  policies.publish(owner,{policy_id:'returns',version:1,digest:p.digest,expected_published_version:0,effective_at:now});
  const pin=policies.pin(operator,'returns',{delivered_at:0,requested_at:15*86400000,tags:[],evidence_provided:true,outcome:'refund'});
  const decision=policies.evaluatePin(operator,pin.id);
  const before=editor.start(operator,'draft'),edited=editor.edit(operator,'draft',{expected_revision:1,changes:{'returns.window_days':7}});
  const simulation=editor.simulate(operator,'draft',2),request=editor.requestReview(operator,'draft',{expected_revision:2,simulation_digest:simulation.simulation_digest});
  const restored=editor.restore(operator,'draft',{expected_revision:2,restore_revision:1});
  const bundle=readInstructionDirectory(fileURLToPath(new URL('../packages/commerce/skill-bundles/return-guide/',import.meta.url)));
  const origin='https://publisher.example.invalid/skills',approval=installer.approve(owner,{origin,bundle_digest:bundle.digest,skill_id:bundle.id,version:bundle.version,expires_at:now+60000});
  const installed=installer.install(operator,approval.id,{origin,bundle});
  console.log(JSON.stringify({evidence_kind:'in_memory_synthetic_demonstration',policy_decision:decision,draft_diff:edited.diff,simulation:simulation.results,review_request:request,
    undo_restored_effective_digest:before.effective_digest===restored.effective_digest,installed_skill:installed,external_calls:0,production_qualified:false,reviewer_identities:'synthetic fixture actors, not project reviewers'},null,2));
}finally{db.close();}
