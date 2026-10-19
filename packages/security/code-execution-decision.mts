import { readFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exact, id, integer } from '../commerce/kernel.mts';
import type { Row } from '../commerce/kernel.mts';
import { canonical, jsonValue } from '../commerce/configuration-values.mts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PROTOCOL = 'packages/security/contracts/code-execution-decision.v1.json';
const TASKS = ['typed_resolution_state', 'typed_approved_resolution'];
const SOURCE_PATHS = ['packages/agent/action-mcp.mts', 'packages/agent/mcp.mts', 'packages/commerce/action-gateway.mts',
  'packages/commerce/case-configurations.mts', 'packages/commerce/authorization.mts', 'packages/commerce/skills.mts', 'packages/commerce/skill-contract.mts'];
const ACTIONS: Record<string, string[]> = {typed_resolution_state: ['resolution_state'],
  typed_approved_resolution: ['action.preview', 'action.approve', 'action.execute', 'resolution_state']};
const CEILING = {cpu_ms: 5000, wall_ms: 5000, memory_bytes: 134217728, output_bytes: 65536};
const fail = (reason: string): never => {throw new Error('CODE_DECISION_' + reason);};
const sha = (value: unknown): string => {if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail('INVALID_DIGEST'); return value as string;};
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const objectHash = (value: unknown) => hash(canonical(value));
function localBytes(root: string, path: string) {
  const name = resolve(root, path), stat = lstatSync(name);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 524288) fail('LOCAL_SOURCE_INVALID');
  return readFileSync(name);
}
function sourcePins(root: string, value: unknown) {
  if (!Array.isArray(value) || value.length !== SOURCE_PATHS.length) fail('SOURCE_MEMBERSHIP');
  const pins = value.map(raw => exact(raw, ['path', 'sha256']));
  if (canonical(pins.map(p => p.path)) !== canonical(SOURCE_PATHS)) fail('SOURCE_MEMBERSHIP');
  for (const p of pins) if (hash(localBytes(root, p.path)) !== sha(p.sha256)) fail('SOURCE_CHANGED');
  return pins;
}
function protocol(root: string, expected: string) {
  const raw = localBytes(root, PROTOCOL); if (hash(raw) !== sha(expected)) fail('PROTOCOL_CHANGED');
  const p = jsonValue(JSON.parse(raw.toString('utf8')));
  if (p.schema_version !== 1 || p.id !== 'rifare-code-execution-decision-preparation-v1' || p.mode !== 'assessment_only' ||
    p.maximum_input_bytes !== 131072 || p.oracle_id !== 'rifare-typed-code-need-v1' || canonical(p.task_ids) !== canonical(TASKS) ||
    canonical(p.source_paths) !== canonical(SOURCE_PATHS) || canonical(p.task_actions) !== canonical(ACTIONS) ||
    canonical(p.proposed_resource_ceiling) !== canonical(CEILING) || p.maximum_observation_age_ms !== 86400000 ||
    p.maximum_observed_elapsed_ms !== 60000 || p.enabled !== false || p.implementation !== 'absent' ||
    p.human_decision_authenticated !== false || p.sandbox_qualified !== false) fail('PROTOCOL_CHANGED');
  return p;
}
function output(value: unknown, task: string) {
  const keys = ['resolution', 'revision', 'financial_effect', ...(task === 'typed_approved_resolution' ? ['approval_consumed'] : [])];
  const p = exact(value, keys);
  if (!['none', 'refund', 'exchange'].includes(p.resolution) || !Number.isSafeInteger(p.revision) || p.revision < 0 ||
    typeof p.financial_effect !== 'boolean' || task === 'typed_approved_resolution' && typeof p.approval_consumed !== 'boolean') fail('EVIDENCE_OUTPUT_INVALID');
  return p;
}
function oracle(input: unknown, expected: string) {
  if (objectHash(input) !== sha(expected)) fail('ORACLE_CHANGED');
  const p = exact(input, ['schema_version', 'id', 'tasks']);
  if (p.schema_version !== 1 || p.id !== 'rifare-typed-code-need-v1' || !Array.isArray(p.tasks) || p.tasks.length !== TASKS.length) fail('ORACLE_MEMBERSHIP');
  const tasks = p.tasks.map((row: Row) => exact(row, ['id', 'actions', 'expected']));
  if (canonical(tasks.map((t: Row) => t.id)) !== canonical(TASKS)) fail('ORACLE_MEMBERSHIP');
  for (const t of tasks) {
    if (canonical(t.actions) !== canonical(ACTIONS[t.id])) fail('ORACLE_ACTIONS_CHANGED');
    output(t.expected, t.id); if (t.expected.financial_effect !== false) fail('ORACLE_SCOPE_CHANGED');
  }
  return tasks;
}
function proposal(input: unknown) {
  const p = exact(input, ['reason', 'task_ids', 'alternative', 'executed', 'observed_results', 'estimated_benefit', 'alternatives', 'threat', 'limits']);
  if (!['measured_need', 'parity_only'].includes(p.reason) || canonical(p.task_ids) !== canonical(TASKS) ||
    p.alternative !== 'proposed_constrained_code' || p.executed !== false || p.observed_results !== null || p.estimated_benefit !== null) fail('ALTERNATIVE_UNOBSERVED');
  if (canonical(p.alternatives) !== canonical(['typed_actions', 'typed_action_extension', 'manual_review'])) fail('ALTERNATIVES_REQUIRED');
  const t = exact(p.threat, ['trust_boundary', 'ambient_credentials', 'network', 'filesystem', 'packages', 'child_processes', 'business_actions']);
  if (typeof t.ambient_credentials !== 'boolean' || typeof t.child_processes !== 'boolean' ||
    !['untrusted_scoped_facts', 'trusted_ambient_host'].includes(t.trust_boundary) || !['none', 'allowlist', 'unrestricted'].includes(t.network) ||
    !['none', 'isolated', 'host'].includes(t.filesystem) || !['typed_gateway', 'direct_adapter'].includes(t.business_actions) ||
    !Array.isArray(t.packages) || t.packages.length > 16 || new Set(t.packages).size !== t.packages.length ||
    t.packages.some((v: unknown) => typeof v !== 'string' || !/^[A-Za-z0-9@._/-]{1,100}$/.test(v))) fail('INVALID_THREAT');
  const limits = exact(p.limits, Object.keys(CEILING)); for (const value of Object.values(limits)) integer(value);
  const unsafe: string[] = [];
  const expected: Row = {trust_boundary: 'untrusted_scoped_facts', ambient_credentials: false, network: 'none', filesystem: 'none',
    packages: [], child_processes: false, business_actions: 'typed_gateway'};
  for (const key of Object.keys(expected)) if (canonical(t[key]) !== canonical(expected[key])) unsafe.push('UNSAFE_' + key.toUpperCase());
  for (const [key, ceiling] of Object.entries(CEILING)) if (limits[key] < 1 || limits[key] > ceiling) unsafe.push('UNSAFE_' + key.toUpperCase());
  if (limits.wall_ms < limits.cpu_ms) unsafe.push('UNSAFE_WALL_MS');
  return {value: p, unsafe: [...new Set(unsafe)]};
}
export type CodeDecisionContext = {root?: string; expectedProtocolSha256: string; expectedOracleSha256: string; now: number};

/** The fixed oracle and source pins assess submitted local measurements. The
 * native test caller supplies actual typed-service observations; this reader
 * cannot authenticate an external execution or a human decision from JSON. */
export function assessCodeExecutionNeed(input: unknown, context: CodeDecisionContext): Row {
  const root = resolve(context.root ?? ROOT), expectedProtocol = sha(context.expectedProtocolSha256); integer(context.now);
  const contract = protocol(root, expectedProtocol);
  const p = exact(jsonValue(input), ['schema_version', 'protocol_sha256', 'oracle', 'oracle_sha256', 'source_pins', 'observations', 'proposal', 'previous_binding_sha256', 'decision_ref']);
  if (p.schema_version !== 1 || p.protocol_sha256 !== expectedProtocol) fail('PROTOCOL_CHANGED');
  if (p.oracle_sha256 !== sha(context.expectedOracleSha256)) fail('ORACLE_CHANGED');
  const expected = oracle(p.oracle, context.expectedOracleSha256), pins = sourcePins(root, p.source_pins), sourceSha = objectHash(pins);
  if (!Array.isArray(p.observations) || p.observations.length !== expected.length) fail('EVIDENCE_MEMBERSHIP');
  const observations = p.observations.map((raw: Row) => exact(raw, ['task_id', 'observed_at', 'elapsed_ms', 'evidence_kind', 'actions', 'source_bindings_sha256', 'result_sha256', 'output']));
  if (canonical(observations.map((o: Row) => o.task_id)) !== canonical(TASKS)) fail('EVIDENCE_MEMBERSHIP');
  const tasks = observations.map((o: Row, index: number) => {
    integer(o.observed_at); sha(o.result_sha256);
    if (o.evidence_kind !== 'local_typed_fixture' || !Number.isFinite(o.elapsed_ms) || o.elapsed_ms < 0 || o.elapsed_ms > contract.maximum_observed_elapsed_ms ||
      o.observed_at > context.now || context.now - o.observed_at > contract.maximum_observation_age_ms || o.source_bindings_sha256 !== sourceSha) fail('OBSERVATION_INVALID');
    output(o.output, o.task_id);
    if (canonical(o.actions) !== canonical(expected[index].actions) || canonical(o.output) !== canonical(expected[index].expected)) fail('EVIDENCE_EXPECTATION_FAILED');
    return {id: o.task_id, correct: true, action_count: o.actions.length, elapsed_ms: o.elapsed_ms, evidence_sha256: objectHash(o)};
  });
  const proposed = proposal(p.proposal);
  if (p.previous_binding_sha256 !== null) sha(p.previous_binding_sha256);
  if (p.decision_ref !== null) id(p.decision_ref);
  const binding = objectHash({protocol_sha256: expectedProtocol, oracle_sha256: p.oracle_sha256, source_bindings_sha256: sourceSha,
    observations: tasks.map((t: Row) => t.evidence_sha256), proposal: proposed.value});
  const changed = p.previous_binding_sha256 !== null && p.previous_binding_sha256 !== binding;
  const blockers = ['EXPLICIT_HUMAN_DECISION_MISSING', 'SANDBOX_IMPLEMENTATION_ABSENT', 'EXTERNAL_MEASUREMENT_AUTHENTICITY_UNVERIFIED', ...proposed.unsafe];
  if (changed) blockers.push('DECISION_BINDING_CHANGED');
  if (p.proposal.reason === 'parity_only') blockers.push('PARITY_IS_NOT_UNMET_NEED');
  blockers.push('MEASURABLE_UNMET_NEED_ABSENT_IN_THIS_TASK_SET');
  return {schema_version: 1, status: 'human_decision_preparation', ...codeExecutionStatus(), protocol_sha256: expectedProtocol,
    oracle_sha256: p.oracle_sha256, source_bindings_sha256: sourceSha, binding_sha256: binding, task_count: tasks.length, correct: tasks.length,
    action_count: tasks.reduce((sum: number, t: Row) => sum + t.action_count, 0), unmet_task_count: 0,
    elapsed_ms: tasks.reduce((sum: number, t: Row) => sum + t.elapsed_ms, 0), tasks, code_alternative_executed: false, code_latency_ms: null,
    observation_authenticity: 'caller_owned_unverified', scope: 'two_fixed_local_case_plan_tasks', decision_reference_received: p.decision_ref !== null,
    review_required: true, binding_changed: changed,
    recommendation: proposed.unsafe.length ? 'reject_unsafe_design' : p.proposal.reason === 'parity_only' ? 'reject_parity_only' : 'retain_typed_actions_pending_human_decision', blockers};
}

/** Fresh informational value only; callers cannot mutate a shared enable flag. */
export function codeExecutionStatus(): Row {
  return {enabled: false, implementation: 'absent', human_decision_authenticated: false, sandbox_qualified: false,
    conditional_goal: 'M12-G09', state: 'deferred', business_action_authority: 'existing_typed_gateway_only'};
}
/** No input inspection, code loading, callbacks, subprocesses or egress. */
export function requestCodeExecution(_input: unknown): never {throw new Error('CODE_EXECUTION_DISABLED');}
