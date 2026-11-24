/**
 * P03 candidate wire compatibility only. These pure functions perform no I/O,
 * authentication, signature verification, durable claiming or commerce action.
 * All expected mutation intent must be retained independently by the caller.
 */
import { checkoutSnapshot } from '../../commerce/checkout-preview.mts';
import { canonical, contentDigest } from '../../commerce/configuration-values.mts';
import { digest } from '../../commerce/values.mts';
import { receiptTimestampNs } from '../../commerce/delegated-receipt-binding.mts';
import type { GrantRef, Operation } from '../../commerce/delegated-receipt-binding.mts';
import { strictReceiptJson } from '../delegated-receipts/strict-json.mts';

export const COMMAND_PROFILE = 'urn:marty:delegation-command:v1';
export const RESPONSE_PROFILE = 'urn:marty:delegation-command-response:v1';
export const MAX_COMMAND_BYTES = 65_536;
const MAX_COMPACT_CHARACTERS = 100_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const COMPACT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export type StartUseCommand = Readonly<{
  profile: typeof COMMAND_PROFILE; command: 'START_USE'; command_id: string;
  grant: GrantRef; operation: Operation;
}>;
export type FinalizeUseCommand = Readonly<{
  profile: typeof COMMAND_PROFILE; command: 'FINALIZE_USE'; command_id: string;
  challenge_id: string; proof_submission_id: string;
}>;
export type RecoverResultCommand = Readonly<{
  profile: typeof COMMAND_PROFILE; command: 'RECOVER_RESULT';
  original_command_id: string; expected_command_digest: string;
}>;
export type DelegatedUseMutation = StartUseCommand | FinalizeUseCommand;
export type DelegatedCommand = DelegatedUseMutation | RecoverResultCommand;
export type EncodedDelegatedCommand = Readonly<{
  request: DelegatedCommand; canonical_json: string;
  original_command_id: string; command_digest: string;
  execution_authorized: false; qualification: 'candidate_contract_only';
}>;
export type ChallengeResult = Readonly<{
  kind: 'CHALLENGE'; challenge_id: string; grant: GrantRef; operation: Operation;
  created_at: string; expires_at: string;
}>;
export type FinalUseResult = Readonly<{
  kind: 'FINAL_USE'; challenge_id: string; decision: 'PERMIT' | 'DENY';
  receipt_ref: string; receipt_digest: string; recorded_at: string;
  authorization_expires_at: string; semantics: 'EVIDENCE_ONLY';
}>;
export type DelegatedCommandResponse = Readonly<{
  profile: typeof RESPONSE_PROFILE; original_command_id: string;
  command_digest: string; recovered: boolean; result: ChallengeResult | FinalUseResult;
}>;
export type BoundDelegatedResponse = Readonly<{
  response: DelegatedCommandResponse;
  evidence_status: 'unverified_protocol_data';
  execution_authorized: false; qualification: 'candidate_contract_only';
  provider_authenticated: false; receipt_signature_verified: false;
}>;
export type ResponseBindingOptions = Readonly<{
  /** Exact recovery request, when this response was obtained by recovery. */
  recovery?: unknown;
  /** Earlier raw successful response, not a caller-supplied trusted result flag. */
  previous?: unknown;
}>;

export class DelegatedCommandDenied extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = 'DelegatedCommandDenied'; this.code = code; }
}
function fail(code: string): never { throw new DelegatedCommandDenied(code); }
function insist(condition: unknown, code: string): asserts condition { if (!condition) fail(code); }

/** Reuse the native strict decoder/snapshot; never discard duplicate wire keys. */
function data(input: unknown): unknown {
  try {
    const value = input instanceof Uint8Array
      ? strictReceiptJson(input, MAX_COMMAND_BYTES) : checkoutSnapshot(input);
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_COMMAND_BYTES) fail('COMMAND_JSON_INVALID');
    return value;
  } catch { fail('COMMAND_JSON_INVALID'); }
}
function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  insist(value !== null && typeof value === 'object' && !Array.isArray(value), 'COMMAND_FIELDS_INVALID');
  const r = value as Record<string, unknown>, keys = Object.keys(r);
  insist(required.every(k => Object.hasOwn(r, k)) &&
    keys.every(k => required.includes(k) || optional.includes(k)), 'COMMAND_FIELDS_INVALID');
  return r;
}
function uuid(value: unknown): void {
  insist(typeof value === 'string' && UUID.test(value) && value !== NIL_UUID, 'COMMAND_UUID_INVALID');
}
function sha(value: unknown): void {
  insist(typeof value === 'string' && SHA256.test(value), 'COMMAND_DIGEST_INVALID');
}
/** Validate original URI spelling. URL is a final syntax check, never a rewriter. */
function uri(value: unknown): void {
  insist(typeof value === 'string' && value.length > 0 && value.length <= 1024 &&
    /^[\x21-\x7e]+$/.test(value) && !/[\\*]/.test(value) &&
    !/%(?![0-9a-fA-F]{2})/.test(value), 'COMMAND_URI_INVALID');
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):(.*)$/.exec(value);
  insist(scheme && scheme[2].length > 0, 'COMMAND_URI_INVALID');
  const parts = scheme[2].split('#');
  insist(parts.length <= 2, 'COMMAND_URI_INVALID');
  const fragment = parts[1], queryStart = parts[0].indexOf('?');
  const query = queryStart < 0 ? undefined : parts[0].slice(queryStart + 1);
  let path = queryStart < 0 ? parts[0] : parts[0].slice(0, queryStart);
  const queryChars = /^[A-Za-z0-9\-._~!$&'()+,;=:@%/?]*$/;
  insist((query === undefined || queryChars.test(query)) &&
    (fragment === undefined || queryChars.test(fragment)), 'COMMAND_URI_INVALID');
  const hierarchical = path.startsWith('//');
  if (hierarchical) {
    const authorityEnd = path.indexOf('/', 2);
    const authority = authorityEnd < 0 ? path.slice(2) : path.slice(2, authorityEnd);
    const hostParts = authority.split('@');
    insist(hostParts.length <= 2 && (hostParts.length === 1 ||
      /^[A-Za-z0-9\-._~!$&'()+,;=:%]*$/.test(hostParts[0])), 'COMMAND_URI_INVALID');
    const host = hostParts.at(-1)!;
    insist(host.startsWith('[')
      ? /^\[[^\[\]]+\](?::[0-9]*)?$/.test(host)
      : /^[A-Za-z0-9\-._~!$&'()+,;=%]+(?::[0-9]*)?$/.test(host), 'COMMAND_URI_INVALID');
    path = authorityEnd < 0 ? '' : path.slice(authorityEnd);
  }
  insist(/^[A-Za-z0-9\-._~!$&'()+,;=:@%/]*$/.test(path), 'COMMAND_URI_INVALID');
  const http = ['http', 'https'].includes(scheme[1].toLowerCase());
  insist(!http || hierarchical, 'COMMAND_URI_INVALID');
  try {
    const parsed = new URL(value);
    insist(!http || parsed.hostname.length > 0, 'COMMAND_URI_INVALID');
  } catch { fail('COMMAND_URI_INVALID'); }
}
function grant(value: unknown): GrantRef {
  const r = fields(value, ['id', 'revision', 'terms_digest']); uuid(r.id); sha(r.terms_digest);
  insist(typeof r.revision === 'number' && Number.isSafeInteger(r.revision) && r.revision >= 1,
    'COMMAND_GRANT_INVALID');
  return r as GrantRef;
}
function operation(value: unknown): Operation {
  const r = fields(value, ['action', 'resource_id', 'audience', 'request_profile', 'request_digest']);
  for (const key of ['action', 'resource_id', 'audience', 'request_profile']) uri(r[key]);
  sha(r.request_digest); return r as Operation;
}
function time(value: unknown): bigint {
  try {
    insist(typeof value === 'string' && value.length <= 64, 'COMMAND_TIME_INVALID');
    return receiptTimestampNs(value);
  } catch { fail('COMMAND_TIME_INVALID'); }
}
function orderedTimes(start: unknown, end: unknown): void {
  insist(time(start) < time(end), 'COMMAND_TIME_ORDER_INVALID');
}
function command(input: unknown): DelegatedCommand {
  const r = fields(data(input), ['profile', 'command'], [
    'command_id', 'grant', 'operation', 'challenge_id', 'proof_submission_id',
    'original_command_id', 'expected_command_digest',
  ]);
  insist(r.profile === COMMAND_PROFILE, 'COMMAND_PROFILE_INVALID');
  if (r.command === 'START_USE') {
    fields(r, ['profile', 'command', 'command_id', 'grant', 'operation']);
    uuid(r.command_id); grant(r.grant); operation(r.operation);
  } else if (r.command === 'FINALIZE_USE') {
    fields(r, ['profile', 'command', 'command_id', 'challenge_id', 'proof_submission_id']);
    uuid(r.command_id); uuid(r.challenge_id); uuid(r.proof_submission_id);
  } else if (r.command === 'RECOVER_RESULT') {
    fields(r, ['profile', 'command', 'original_command_id', 'expected_command_digest']);
    uuid(r.original_command_id); sha(r.expected_command_digest);
  } else fail('COMMAND_KIND_UNSUPPORTED');
  return r as DelegatedCommand;
}
function mutation(input: unknown): DelegatedUseMutation {
  const original = command(input);
  insist(original.command !== 'RECOVER_RESULT', 'COMMAND_ORIGINAL_REQUIRED');
  return original;
}
function mutationDigest(original: DelegatedUseMutation): string { return 'sha256:' + contentDigest(original); }

/** For recovery, command_digest is the referenced original mutation digest. */
export function encodeDelegatedCommand(input: unknown): EncodedDelegatedCommand {
  const request = command(input);
  return checkoutSnapshot({
    request, canonical_json: canonical(request),
    original_command_id: request.command === 'RECOVER_RESULT' ? request.original_command_id : request.command_id,
    command_digest: request.command === 'RECOVER_RESULT' ? request.expected_command_digest : mutationDigest(request),
    execution_authorized: false, qualification: 'candidate_contract_only',
  });
}
/** No ID generation, retry decision, authority refresh or durable claim occurs. */
export function createDelegatedRecovery(originalMutation: unknown): EncodedDelegatedCommand {
  const original = mutation(originalMutation);
  return encodeDelegatedCommand({ profile: COMMAND_PROFILE, command: 'RECOVER_RESULT',
    original_command_id: original.command_id, expected_command_digest: mutationDigest(original) });
}

function responseFor(original: DelegatedUseMutation, input: unknown): DelegatedCommandResponse {
  const r = fields(data(input), ['profile', 'original_command_id', 'command_digest', 'recovered', 'result']);
  insist(r.profile === RESPONSE_PROFILE, 'COMMAND_PROFILE_INVALID');
  uuid(r.original_command_id); sha(r.command_digest);
  insist(typeof r.recovered === 'boolean', 'COMMAND_FIELDS_INVALID');
  insist(r.original_command_id === original.command_id && r.command_digest === mutationDigest(original),
    'COMMAND_ORIGINAL_MISMATCH');
  if (original.command === 'START_USE') {
    const result = fields(r.result, ['kind', 'challenge_id', 'grant', 'operation', 'created_at', 'expires_at']);
    insist(result.kind === 'CHALLENGE', 'COMMAND_RESULT_MISMATCH');
    uuid(result.challenge_id); grant(result.grant); operation(result.operation);
    insist(canonical(result.grant) === canonical(original.grant), 'COMMAND_RESULT_MISMATCH');
    // RCG4BC1-START-OPERATION-BINDING: targeted-fault mutation point.
    insist(canonical(result.operation) === canonical(original.operation), 'COMMAND_RESULT_MISMATCH');
    orderedTimes(result.created_at, result.expires_at);
  } else {
    const result = fields(r.result, ['kind', 'challenge_id', 'decision', 'receipt_ref', 'receipt_digest',
      'recorded_at', 'authorization_expires_at', 'semantics']);
    insist(result.kind === 'FINAL_USE' && result.semantics === 'EVIDENCE_ONLY', 'COMMAND_RESULT_MISMATCH');
    uuid(result.challenge_id);
    insist(result.challenge_id === original.challenge_id, 'COMMAND_RESULT_MISMATCH');
    insist(result.decision === 'PERMIT' || result.decision === 'DENY', 'COMMAND_RESULT_MISMATCH');
    uri(result.receipt_ref); sha(result.receipt_digest);
    orderedTimes(result.recorded_at, result.authorization_expires_at);
  }
  return r as DelegatedCommandResponse;
}
/** Options can contain original byte buffers; inspect only own data descriptors. */
function optionsData(input: ResponseBindingOptions): Record<string, unknown> {
  try {
    insist(input !== null && typeof input === 'object' &&
      [Object.prototype, null].includes(Object.getPrototypeOf(input)), 'COMMAND_OPTIONS_INVALID');
    const keys = Reflect.ownKeys(input), result: Record<string, unknown> = Object.create(null);
    insist(keys.length <= 2, 'COMMAND_OPTIONS_INVALID');
    for (const key of keys) {
      insist(key === 'recovery' || key === 'previous', 'COMMAND_OPTIONS_INVALID');
      const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
      insist(Object.hasOwn(descriptor, 'value') && descriptor.enumerable === true, 'COMMAND_OPTIONS_INVALID');
      result[key] = descriptor.value;
    }
    return result;
  } catch { fail('COMMAND_OPTIONS_INVALID'); }
}

/** Correlation of untrusted protocol data, not authentication or current authority. */
export function bindDelegatedResponse(
  originalMutation: unknown, responseInput: unknown, options: ResponseBindingOptions = {},
): BoundDelegatedResponse {
  const original = mutation(originalMutation), selected = optionsData(options);
  const response = responseFor(original, responseInput);
  if (Object.hasOwn(selected, 'recovery')) {
    const recovery = command(selected.recovery);
    insist(recovery.command === 'RECOVER_RESULT' && recovery.original_command_id === original.command_id &&
      recovery.expected_command_digest === mutationDigest(original) && response.recovered === true,
    'COMMAND_RECOVERY_MISMATCH');
  }
  if (Object.hasOwn(selected, 'previous')) {
    const previous = responseFor(original, selected.previous);
    insist(canonical(previous.result) === canonical(response.result), 'COMMAND_HISTORY_CHANGED');
  }
  return checkoutSnapshot({ response, evidence_status: 'unverified_protocol_data', execution_authorized: false,
    qualification: 'candidate_contract_only', provider_authenticated: false, receipt_signature_verified: false });
}

/** Match exact original compact bytes without decoding, fetching or retaining them. */
export function correlateDelegatedReceipt(
  originalMutation: unknown, responseInput: unknown, compactJws: string, options: ResponseBindingOptions = {},
): BoundDelegatedResponse & Readonly<{ receipt_digest_matched: true }> {
  const bound = bindDelegatedResponse(originalMutation, responseInput, options);
  insist(bound.response.result.kind === 'FINAL_USE', 'COMMAND_RESULT_MISMATCH');
  insist(typeof compactJws === 'string' && compactJws.length <= MAX_COMPACT_CHARACTERS && COMPACT.test(compactJws),
    'COMMAND_RECEIPT_BYTES_INVALID');
  insist('sha256:' + digest(compactJws) === bound.response.result.receipt_digest, 'COMMAND_RECEIPT_DIGEST_MISMATCH');
  return checkoutSnapshot({ ...bound, receipt_digest_matched: true });
}
