import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { executionFixture } from './execution-helpers.mts';
import { extensionArtifact } from './extensions-helpers.mts';
import { ActionMcp } from '../../packages/agent/action-mcp.mts';
import { MCP_VERSION } from '../../packages/agent/mcp.mts';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const fileSha = (path: string) => createHash('sha256').update(readFileSync(resolve(ROOT, path))).digest('hex');
function sorted(value: any): any {return Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;}
export const objectSha = (value: unknown) => createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex');
const fixture = (name: string) => JSON.parse(readFileSync(new URL('../fixtures/ecosystem-assurance/' + name, import.meta.url), 'utf8'));
export const EXPECTED = fixture('expected.v1.json');

export function qualificationRequest() {
  const artifact = extensionArtifact();
  const protocolSha = fileSha('packages/security/contracts/extension-qualification.v1.json');
  const request = {schema_version: 1, protocol_sha256: protocolSha, artifact, sdk_pins: fixture('sdk-pins.v1.json').pins,
    contributor: {id: 'synthetic_contributor_claim', relationship: 'unverified_external_claim', attribution_sha256: 'a'.repeat(64)},
    development: {core_changes: [], added_privileges: [], tooling: 'ordinary_offline_tools'}, requested_claim: 'local_preparation', review_refs: []};
  return {request, context: {root: ROOT, expectedProtocolSha256: protocolSha, expectedArtifactSha256: objectSha(artifact)}};
}

export function actionMcp(f: ReturnType<typeof executionFixture>) {
  const mcp = new ActionMcp(f.kernel, f.gateway), audience = 'http://127.0.0.1:9000/execution-mcp';
  const grant = mcp.issue(f.agent.scope, {case_id: 'case_one', tools: ['preview_resolution', 'execute_resolution', 'resolution_state']}, audience);
  mcp.dispatch(grant.token, audience, {jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: MCP_VERSION,
    capabilities: {}, clientInfo: {name: 'Rifare assurance fixture', version: '1'}}});
  return {mcp, audience, grant, call: (name: string, args: unknown) => mcp.dispatch(grant.token, audience,
    {jsonrpc: '2.0', id: 2, method: 'tools/call', params: {name, arguments: args}}, MCP_VERSION) as any};
}

/** The actions below really invoke the existing typed services. Only small
 * nonpersonal projections leave the fixture; the expectations are a separate,
 * predeclared JSON oracle and are never derived from these results. */
export function measureTypedFixture(f: ReturnType<typeof executionFixture>) {
  const observations: any[] = [], sourcePins = fixture('typed-source-pins.v1.json').pins;
  const startRead = performance.now(), state = f.gateway.state(f.agent.scope, 'case_one');
  observations.push({task_id: 'typed_resolution_state', observed_at: f.now(), elapsed_ms: performance.now() - startRead,
    evidence_kind: 'local_typed_fixture', actions: ['resolution_state'], source_bindings_sha256: objectSha(sourcePins),
    result_sha256: objectSha(state), output: {resolution: state.resolution, revision: state.revision, financial_effect: state.financial_effect}});
  const startAction = performance.now(), actions: string[] = [];
  const preview = f.gateway.prepare(f.a.scope, f.proposal()); actions.push('action.preview');
  const approval = f.approve(preview); actions.push('action.approve');
  const receipt = f.execute(preview, approval); actions.push('action.execute');
  const finalState = f.gateway.state(f.agent.scope, 'case_one'); actions.push('resolution_state');
  observations.push({task_id: 'typed_approved_resolution', observed_at: f.now(), elapsed_ms: performance.now() - startAction,
    evidence_kind: 'local_typed_fixture', actions, source_bindings_sha256: objectSha(sourcePins), result_sha256: objectSha({receipt, state: finalState}),
    output: {resolution: finalState.resolution, revision: finalState.revision, financial_effect: receipt.financial_effect, approval_consumed: receipt.approval_consumed}});
  const protocolSha = fileSha('packages/security/contracts/code-execution-decision.v1.json'), oracle = fixture('typed-task-oracle.v1.json');
  const request = {schema_version: 1, protocol_sha256: protocolSha, oracle, oracle_sha256: objectSha(oracle), source_pins: sourcePins, observations,
    proposal: {reason: 'measured_need', task_ids: ['typed_resolution_state', 'typed_approved_resolution'], alternative: 'proposed_constrained_code',
      executed: false, observed_results: null, estimated_benefit: null, alternatives: ['typed_actions', 'typed_action_extension', 'manual_review'],
      threat: {trust_boundary: 'untrusted_scoped_facts', ambient_credentials: false, network: 'none', filesystem: 'none', packages: [], child_processes: false, business_actions: 'typed_gateway'},
      limits: {cpu_ms: 1000, wall_ms: 2000, memory_bytes: 67108864, output_bytes: 65536}}, previous_binding_sha256: null, decision_ref: null};
  return {request, context: {root: ROOT, expectedProtocolSha256: protocolSha, expectedOracleSha256: objectSha(oracle), now: f.now()}, receipt};
}

export function usingTyped(fn: (f: ReturnType<typeof executionFixture>, value: ReturnType<typeof measureTypedFixture>) => unknown) {
  const f = executionFixture(); try {return fn(f, measureTypedFixture(f));} finally {f.cleanup();}
}
