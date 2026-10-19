import test from 'node:test';
import assert from 'node:assert/strict';
import { assessExtensionQualification } from '../../packages/security/extension-qualification.mts';
import { assessCodeExecutionNeed, codeExecutionStatus, requestCodeExecution } from '../../packages/security/code-execution-decision.mts';
import { executionFixture } from './execution-helpers.mts';
import { EXPECTED, qualificationRequest, usingTyped, actionMcp, objectSha } from './ecosystem-assurance-helpers.mts';

test('M12-G07-PREP-ARTIFACT-EVIDENCE', () => {
  const {request, context} = qualificationRequest(), result = assessExtensionQualification(request, context);
  for (const [key, value] of Object.entries(EXPECTED.qualification)) assert.equal(result[key], value);
  assert.equal(result.artifact_sha256, context.expectedArtifactSha256);
  assert.equal(result.local_validation, 'instruction_contract_only');
  assert.ok(result.blockers.includes('ATTRIBUTABLE_EXTERNAL_EXECUTION_MISSING'));
  assert.ok(result.blockers.includes('HUMAN_LICENSE_AND_RIGHTS_DECISION_MISSING'));
  const changed = structuredClone(request); changed.artifact.payload.files['SKILL.md'] += '\nChanged after artifact approval.\n';
  assert.throws(() => assessExtensionQualification(changed, context), /ARTIFACT_CHANGED|DIGEST|ORIGIN/);
});

test('M12-G07-PREP-INDEPENDENCE-REFUSAL', () => {
  const {request, context} = qualificationRequest();
  for (const mutate of [
    (r: any) => {r.contributor.relationship = 'maintainer'; r.requested_claim = 'independent_external';},
    (r: any) => {r.development.core_changes = ['packages/commerce/kernel.mts'];},
    (r: any) => {r.development.added_privileges = ['secret.read'];},
    (r: any) => {r.development.tooling = 'private_maintainer_infrastructure';},
  ]) {
    const changed = structuredClone(request); mutate(changed);
    const result = assessExtensionQualification(changed, context);
    assert.equal(result.independently_qualified, false);
    assert.ok(result.blockers.some((b: string) => ['MAINTAINER_CONTRIBUTION_NOT_INDEPENDENT', 'PRIVATE_CORE_CHANGES', 'PRIVILEGE_WIDENING', 'PRIVATE_INFRASTRUCTURE'].includes(b)));
  }
  assert.throws(() => assessExtensionQualification({...request, review: {approved: true, reviewer_id: 'claimed_owner'}}, context), /INVALID/);
});

test('M12-G07-PREP-COMPATIBILITY-BINDING', () => {
  const {request, context} = qualificationRequest();
  const stale = structuredClone(request); stale.sdk_pins[0].sha256 = '0'.repeat(64);
  assert.throws(() => assessExtensionQualification(stale, context), /SDK_CHANGED/);
  const missing = structuredClone(request); missing.sdk_pins.pop();
  assert.throws(() => assessExtensionQualification(missing, context), /SDK_MEMBERSHIP/);
  const incompatible = structuredClone(request); incompatible.artifact.contract.sdk_version = 'rifare-extension-v999';
  assert.throws(() => assessExtensionQualification(incompatible, {...context, expectedArtifactSha256: objectSha(incompatible.artifact)}), /SDK|CONTRACT|COMPATIB/);
  const removed = structuredClone(request); removed.artifact.evidence.test_pins = [];
  assert.throws(() => assessExtensionQualification(removed, {...context, expectedArtifactSha256: objectSha(removed.artifact)}), /EVIDENCE|PIN|TEST/);
});

test('M12-G08-PREP-TYPED-WORKFLOW', () => usingTyped((_f, {request, context, receipt}) => {
  const result = assessCodeExecutionNeed(request, context);
  for (const [key, value] of Object.entries(EXPECTED.typed)) assert.equal(result[key], value);
  assert.equal(result.code_alternative_executed, false);
  assert.equal(result.code_latency_ms, null);
  assert.equal(result.human_decision_authenticated, false);
  assert.equal(result.observation_authenticity, 'caller_owned_unverified');
  assert.equal(receipt.approval_consumed, true);
  assert.ok(result.tasks.every((task: any) => task.correct && task.elapsed_ms >= 0));
}));

test('M12-G08-PREP-PARITY-AND-PRIVILEGES', () => usingTyped((_f, {request, context}) => {
  const parity = structuredClone(request); parity.proposal.reason = 'parity_only';
  assert.equal(assessCodeExecutionNeed(parity, context).recommendation, 'reject_parity_only');
  for (const [field, value] of [['ambient_credentials', true], ['network', 'unrestricted'], ['filesystem', 'host'], ['child_processes', true], ['business_actions', 'direct_adapter']] as const) {
    const changed: any = structuredClone(request); changed.proposal.threat[field] = value;
    const result = assessCodeExecutionNeed(changed, context);
    assert.equal(result.recommendation, 'reject_unsafe_design');
    assert.equal(result.enabled, false);
    assert.ok(result.blockers.includes('UNSAFE_' + field.toUpperCase()));
  }
}));

test('M12-G08-PREP-THREAT-BINDING', () => usingTyped((_f, {request, context}) => {
  const first = assessCodeExecutionNeed(request, context), changed: any = structuredClone(request);
  changed.previous_binding_sha256 = first.binding_sha256; changed.proposal.limits.output_bytes = 32768;
  const result = assessCodeExecutionNeed(changed, context);
  assert.equal(result.review_required, true);
  assert.ok(result.blockers.includes('DECISION_BINDING_CHANGED'));
  assert.notEqual(result.binding_sha256, first.binding_sha256);
  const stale = structuredClone(request); stale.source_pins[0].sha256 = '0'.repeat(64);
  assert.throws(() => assessCodeExecutionNeed(stale, context), /SOURCE_CHANGED/);
}));

test('M12-G08-PREP-EVIDENCE-MEMBERSHIP', () => usingTyped((_f, {request, context}) => {
  for (const mutate of [
    (r: any) => r.observations.pop(),
    (r: any) => {r.observations[1].task_id = r.observations[0].task_id;},
    (r: any) => {r.observations[0].observed_at = context.now + 1;},
    (r: any) => {r.observations[0].source_bindings_sha256 = '0'.repeat(64);},
    (r: any) => {r.observations[0].output = {resolution: 'refund', revision: 9, financial_effect: true};},
    (r: any) => {r.proposal.executed = true; r.proposal.observed_results = {passed: true};},
  ]) {
    const changed = structuredClone(request); mutate(changed);
    assert.throws(() => assessCodeExecutionNeed(changed, context), /EVIDENCE|OBSERVATION|ALTERNATIVE/);
  }
  const missing = structuredClone(request); missing.oracle.tasks.pop(); missing.oracle_sha256 = objectSha(missing.oracle);
  assert.throws(() => assessCodeExecutionNeed(missing, context), /ORACLE_CHANGED/);
}));

test('M12-G09-DEFERRED-NO-GO', () => {
  for (const [key, value] of Object.entries(EXPECTED.disabled)) assert.equal(codeExecutionStatus()[key], value);
  let accessed = 0;
  const allegedAuthority = {approved: true, human_decision: 'go', get execute() {accessed++; return () => {accessed++;};}};
  assert.throws(() => requestCodeExecution(allegedAuthority), /CODE_EXECUTION_DISABLED/);
  assert.equal(accessed, 0);
  const copy = codeExecutionStatus(); copy.enabled = true;
  assert.equal(codeExecutionStatus().enabled, false);
});

test('M12-G09-DEFERRED-CANONICAL-BOUNDARY', () => {
  const f = executionFixture();
  try {
    const m = actionMcp(f), before = f.gateway.state(f.a.scope, 'case_one');
    for (const name of ['execute_code', 'eval', 'run_shell', 'adapter_write']) {
      const result = m.call(name, {case_id: 'case_one', code: 'untrusted inert text', approved: true});
      assert.equal(result.error.code, -32602);
    }
    assert.throws(() => f.gateway.prepare(f.agent.scope, {case_id: 'case_one', action: 'code.execute', arguments: {source: 'untrusted inert text'}}), /UNSUPPORTED_ACTION/);
    assert.deepEqual(f.gateway.state(f.a.scope, 'case_one'), before);
    assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_action_receipts').get()!.n, 0);
    assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_case_effects').get()!.n, 0);
  } finally {f.cleanup();}
});
