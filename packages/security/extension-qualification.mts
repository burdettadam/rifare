import { readFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exact, id } from '../commerce/kernel.mts';
import type { Row } from '../commerce/kernel.mts';
import { canonical, jsonValue } from '../commerce/configuration-values.mts';
import { inspectExtensionArtifact } from '../commerce/extension-artifacts.mts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PROTOCOL = 'packages/security/contracts/extension-qualification.v1.json';
const SDK_PATHS = ['packages/commerce/skills.mts', 'packages/commerce/skill-contract.mts', 'packages/commerce/skill-installer.mts',
  'packages/conformance/adapter-fixtures.mts', 'packages/conformance/adapter-catalog.mts', 'docs/SKILL-ARCHITECTURE.md',
  'docs/ADAPTER-CONFORMANCE.md', 'planning/licensing-policy.json'];
const OBLIGATIONS = ['ATTRIBUTABLE_EXTERNAL_EXECUTION_MISSING', 'NATIVE_CONFORMANCE_EXECUTION_MISSING', 'INDEPENDENT_SECURITY_REVIEW_MISSING',
  'INDEPENDENT_REGRESSION_REVIEW_MISSING', 'COMPATIBLE_CORE_EXTERNAL_RERUN_MISSING'];
const MAX_BYTES = 262144;
const fail = (reason: string): never => {throw new Error('EXTENSION_QUALIFICATION_' + reason);};
const sha = (value: unknown): string => {if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail('INVALID_DIGEST'); return value as string;};
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const objectHash = (value: unknown) => hash(JSON.stringify(jsonValue(value, MAX_BYTES)));
function localBytes(root: string, path: string) {
  // Paths are a fixed protocol allowlist, never a submitted filename. The root
  // is the caller's explicit local source checkout, not a merchant request field.
  const name = resolve(root, path), stat = lstatSync(name);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 524288) fail('LOCAL_SOURCE_INVALID');
  return readFileSync(name);
}
function strings(value: unknown, maximum = 16): string[] {
  if (!Array.isArray(value) || value.length > maximum || new Set(value).size !== value.length ||
    value.some(v => typeof v !== 'string' || !/^[A-Za-z0-9_./:-]{1,160}$/.test(v))) fail('INVALID');
  return value as string[];
}
function protocol(root: string, expected: string) {
  const raw = localBytes(root, PROTOCOL);
  if (hash(raw) !== sha(expected)) fail('PROTOCOL_CHANGED');
  const p = jsonValue(JSON.parse(raw.toString('utf8')));
  if (p.schema_version !== 1 || p.id !== 'rifare-extension-qualification-preparation-v1' || p.mode !== 'local_preparation_only' ||
    p.maximum_input_bytes !== MAX_BYTES || canonical(p.sdk_paths) !== canonical(SDK_PATHS) ||
    canonical(p.required_external_obligations) !== canonical(OBLIGATIONS) || p.independently_qualified !== false ||
    p.execution_authorized !== false || p.contribution_solicitation_authorized !== false || p.package_execution !== false) fail('PROTOCOL_CHANGED');
  return p;
}
function sdkPins(root: string, value: unknown) {
  if (!Array.isArray(value) || value.length !== SDK_PATHS.length) fail('SDK_MEMBERSHIP');
  const pins = value.map(raw => exact(raw, ['path', 'sha256']));
  if (canonical(pins.map(p => p.path)) !== canonical(SDK_PATHS)) fail('SDK_MEMBERSHIP');
  for (const p of pins) if (hash(localBytes(root, p.path)) !== sha(p.sha256)) fail('SDK_CHANGED');
  return pins;
}
export type ExtensionQualificationContext = {root?: string; expectedProtocolSha256: string; expectedArtifactSha256: string};

/** Validates a caller-owned local preparation packet. Source hashes bind bytes;
 * supplied attribution and review references authenticate no outside person.
 * There is deliberately no path from this packet to qualification or install. */
export function assessExtensionQualification(input: unknown, context: ExtensionQualificationContext): Row {
  const root = resolve(context.root ?? ROOT), expectedProtocol = sha(context.expectedProtocolSha256);
  protocol(root, expectedProtocol);
  const p = exact(jsonValue(input, MAX_BYTES), ['schema_version', 'protocol_sha256', 'artifact', 'sdk_pins', 'contributor', 'development', 'requested_claim', 'review_refs']);
  if (p.schema_version !== 1 || p.protocol_sha256 !== expectedProtocol) fail('PROTOCOL_CHANGED');
  const pins = sdkPins(root, p.sdk_pins), artifactSha = objectHash(p.artifact);
  if (artifactSha !== sha(context.expectedArtifactSha256)) fail('ARTIFACT_CHANGED');
  // This calls the real instruction/retained-host validator, including its exact
  // artifact, origin, license, contract, fixture and source/test pin checks.
  const inspected = inspectExtensionArtifact(p.artifact, {root});
  if (inspected.external_qualification !== false || inspected.execution_authorized !== false ||
    !['instruction_contract_only', 'retained_host_source_and_test_pins'].includes(inspected.conformance_scope)) fail('VALIDATOR_BOUNDARY_CHANGED');
  const contributor = exact(p.contributor, ['id', 'relationship', 'attribution_sha256']); id(contributor.id); sha(contributor.attribution_sha256);
  if (!['maintainer', 'unverified_external_claim'].includes(contributor.relationship) ||
    !['local_preparation', 'independent_external'].includes(p.requested_claim)) fail('INVALID');
  const development = exact(p.development, ['core_changes', 'added_privileges', 'tooling']);
  const coreChanges = strings(development.core_changes), privileges = strings(development.added_privileges), references = strings(p.review_refs, 8);
  if (!['ordinary_offline_tools', 'private_maintainer_infrastructure'].includes(development.tooling)) fail('INVALID');
  const blockers = [...OBLIGATIONS];
  if (contributor.relationship === 'maintainer') blockers.push('MAINTAINER_CONTRIBUTION_NOT_INDEPENDENT');
  if (p.requested_claim === 'independent_external') blockers.push('INDEPENDENCE_CLAIM_UNVERIFIED');
  if (coreChanges.length) blockers.push('PRIVATE_CORE_CHANGES');
  if (privileges.length) blockers.push('PRIVILEGE_WIDENING');
  if (development.tooling !== 'ordinary_offline_tools') blockers.push('PRIVATE_INFRASTRUCTURE');
  const licensing = JSON.parse(localBytes(root, 'planning/licensing-policy.json').toString('utf8'));
  blockers.push(!licensing.authority?.owner_decision || !licensing.authority?.rights_holder ?
    'HUMAN_LICENSE_AND_RIGHTS_DECISION_MISSING' : 'HUMAN_LICENSE_AND_RIGHTS_REVIEW_UNAUTHENTICATED');
  if (licensing.authority?.contribution_intake_enabled !== true) blockers.push('CONTRIBUTION_INTAKE_NOT_ADOPTED');
  if (licensing.authority?.publication_authorized !== true) blockers.push('SDK_PUBLICATION_NOT_AUTHORIZED');
  return {schema_version: 1, status: 'blocked_external_qualification', preparation_validated: true,
    protocol_sha256: expectedProtocol, artifact_sha256: artifactSha, artifact_subject_sha256: objectHash(inspected.subject),
    sdk_sha256: objectHash(pins), evidence_bindings_sha256: objectHash(inspected.evidence), packet_sha256: objectHash(p),
    local_validation: inspected.conformance_scope, evidence_scope: 'retained_source_and_test_pins_not_execution_reports',
    native_conformance_observed: false, review_references_received: references.length, review_authenticity: 'not_authenticated',
    contributor_authenticity: 'not_authenticated', independently_qualified: false, execution_authorized: false,
    contribution_solicitation_authorized: false, publication_authorized: false, blockers};
}
