import { exact, id, integer } from './kernel.mts';
import type { CommerceKernel, Row } from './kernel.mts';
import { canonical, contentDigest, jsonValue } from './configuration-values.mts';
import { checkoutSnapshot } from './checkout-preview.mts';
import { subjectHash } from './data-guards.mts';
import type { Principal } from './delegated-receipt-binding.mts';
import { encodeDelegatedCommand, bindDelegatedResponse } from '../adapters/delegated-commands/command-codec.mts';
import type { DelegatedCommandResponse } from '../adapters/delegated-commands/command-codec.mts';

export const CLAIM_KIND = 'delegated_command_claim';
export const CLAIM_MAX_ROWS = 10_000;
export const CLAIM_MAX_BODY_BYTES = 16_384;
export type CommandCorrelation = Readonly<{ provider_ref: string; organization_id: string; actor: Principal }>;
export type CommandClaimRetirement = 'cancelled' | 'subject_erased' | 'uninstall' | 'restored';
export type CommandClaimBody = Readonly<{
  schema_version: 1; id: string; tenant_id: string; store_id: string;
  resource_id: string; subject_ref: string; identity_digest: string; namespace_digest: string;
  original_command_id: string; command_kind: 'START_USE' | 'FINALIZE_USE'; command_digest: string;
  challenge_fingerprint: string | null; response_digest: string | null; result_digest: string | null;
  created_at: number; updated_at: number; observed_at: number | null; revision: number;
  state: 'claimed' | 'observed' | 'cancelled'; retired: boolean;
  retirement_reason: CommandClaimRetirement | null; minimized: boolean;
  personal: Readonly<{ customer_id: string; correlation: CommandCorrelation;
    canonical_request: string; first_response: DelegatedCommandResponse | null }> | null;
}>;
export type CommandClaimRecord = Readonly<{ row: Row; body: CommandClaimBody }>;
export type CommandClaimScope = Readonly<{ tenant_id: string; store_id: string }>;
export type CommandClaimCode =
  | 'COMMAND_CLAIM_CONFIG_INVALID' | 'COMMAND_CLAIM_INPUT_INVALID' | 'COMMAND_CLAIM_BINDING_INVALID'
  | 'COMMAND_CLAIM_ACCESS_DENIED' | 'COMMAND_CLAIM_NOT_FOUND' | 'COMMAND_CLAIM_CONFLICT'
  | 'COMMAND_CLAIM_CHALLENGE_CONFLICT' | 'COMMAND_CLAIM_REVISION_CONFLICT' | 'COMMAND_CLAIM_RETIRED'
  | 'COMMAND_CLAIM_TRANSACTION_OWNERSHIP' | 'COMMAND_CLAIM_CLOCK_INVALID' | 'COMMAND_CLAIM_ROW_LIMIT'
  | 'COMMAND_CLAIM_INTEGRITY' | 'COMMAND_CLAIM_STORAGE_UNAVAILABLE';
export class CommandClaimDenied extends Error {
  readonly code: CommandClaimCode;
  constructor(code: CommandClaimCode) { super(code); this.code = code; this.name = 'CommandClaimDenied'; }
}
export function claimDenied(code: CommandClaimCode): never { throw new CommandClaimDenied(code); }
function insist(value: unknown): asserts value { if (!value) claimDenied('COMMAND_CLAIM_INTEGRITY'); }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX = /^[a-f0-9]{64}$/;
const SHA = /^sha256:[a-f0-9]{64}$/;
const REASONS: readonly unknown[] = ['cancelled', 'subject_erased', 'uninstall', 'restored'];
const ROW_KEYS = ['tenant_id','store_id','kind','id','version','body','digest','author','state',
  'reviewer','review_digest','created_at','expires_at'];
const BODY_KEYS = ['schema_version','id','tenant_id','store_id','resource_id','subject_ref','identity_digest',
  'namespace_digest','original_command_id','command_kind','command_digest','challenge_fingerprint',
  'response_digest','result_digest','created_at','updated_at','observed_at','revision','state','retired',
  'retirement_reason','minimized','personal'];
const ORIGINAL_KEYS = ['id','tenant_id','store_id','resource_id','subject_ref','identity_digest',
  'namespace_digest','original_command_id','command_kind','command_digest','challenge_fingerprint','created_at'] as const;
export function commandClaimUuid(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !UUID.test(value) || value === '00000000-0000-0000-0000-000000000000')
    claimDenied('COMMAND_CLAIM_INPUT_INVALID');
}
function hash(value: unknown): void { insist(typeof value === 'string' && HEX.test(value)); }

/** These fixed opaque local names establish correlation only, never a URI or
 * authenticated provider identity. No callback or endpoint selection is allowed. */
export function commandCorrelation(input: unknown): CommandCorrelation {
  try {
    const c = checkoutSnapshot(input) as CommandCorrelation;
    exact(c, ['provider_ref','organization_id','actor']); id(c.provider_ref); commandClaimUuid(c.organization_id);
    exact(c.actor, ['type','id']);
    if (!['SERVICE_ACCOUNT','MACHINE_IDENTITY'].includes(c.actor.type) ||
      typeof c.actor.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(c.actor.id))
      claimDenied('COMMAND_CLAIM_CONFIG_INVALID');
    return c;
  } catch { claimDenied('COMMAND_CLAIM_CONFIG_INVALID'); }
}
export const commandNamespaceDigest = (correlation: CommandCorrelation): string =>
  contentDigest(['rifare-command-namespace-v1', correlation]);
export const commandClaimIdentity = (tenant: string, store: string, namespace: string, command: string): string =>
  contentDigest(['rifare-command-claim-v1', tenant, store, namespace, command]);
export const commandClaimId = (identity: string): string => 'delegated_command_' + identity.slice(0, 40);
export const commandChallengeFingerprint = (namespace: string, challenge: string): string =>
  contentDigest(['rifare-command-finalize-challenge-v1', namespace, challenge]);

/** One original finalization UUID per namespace/challenge, including tombstones.
 * Shared by admission and historical validation so corruption cannot bypass it. */
export function commandClaimChallengeAvailable(records: readonly CommandClaimRecord[], candidate: CommandClaimBody): boolean {
  // RCG4BC2-FINAL-CHALLENGE-NONREUSE: targeted-fault mutation point.
  return candidate.challenge_fingerprint === null || records.every(record => {
    const b = record.body;
    return b.tenant_id !== candidate.tenant_id || b.store_id !== candidate.store_id ||
      b.identity_digest === candidate.identity_digest || b.challenge_fingerprint !== candidate.challenge_fingerprint;
  });
}
export function commandClaimNow(k: CommerceKernel, floor = 0): number {
  try {
    const now = integer(k.clock());
    if (now < floor) claimDenied('COMMAND_CLAIM_CLOCK_INVALID');
    return now;
  } catch { claimDenied('COMMAND_CLAIM_CLOCK_INVALID'); }
}

/** Parsing retained history never consults live provider, checkout or clock state.
 * All cryptographic-looking values remain local integrity/correlation metadata. */
export function validateCommandClaimRows(k: CommerceKernel, rows: Row[], allowRevokedRow = false): CommandClaimRecord[] {
  if (rows.length > CLAIM_MAX_ROWS) claimDenied('COMMAND_CLAIM_ROW_LIMIT');
  try {
    const seen = new Set<string>();
    const records = rows.map(input => {
      const row = checkoutSnapshot(input); exact(row, ROW_KEYS);
      for (const value of [row.tenant_id,row.store_id,row.id]) id(value);
      insist(row.kind === CLAIM_KIND && row.version === 1 && row.author === 'delegated_command_claims' &&
        row.reviewer === null && row.review_digest === null && row.expires_at === null &&
        typeof row.body === 'string' && Buffer.byteLength(row.body) <= CLAIM_MAX_BODY_BYTES); hash(row.digest);
      const b = checkoutSnapshot(jsonValue(JSON.parse(row.body), CLAIM_MAX_BODY_BYTES)) as CommandClaimBody;
      exact(b, BODY_KEYS); insist(canonical(b) === row.body && contentDigest(b) === row.digest);
      for (const value of [b.id,b.tenant_id,b.store_id,b.resource_id]) id(value);
      for (const value of [b.subject_ref,b.identity_digest,b.namespace_digest]) hash(value);
      commandClaimUuid(b.original_command_id);
      for (const value of [b.created_at,b.updated_at]) integer(value); integer(b.revision, 1);
      insist(b.schema_version === 1 && b.tenant_id === row.tenant_id && b.store_id === row.store_id &&
        b.id === row.id && b.id === commandClaimId(b.identity_digest) && b.created_at === row.created_at &&
        b.identity_digest === commandClaimIdentity(b.tenant_id,b.store_id,b.namespace_digest,b.original_command_id) &&
        typeof b.command_digest === 'string' && SHA.test(b.command_digest) &&
        ['START_USE','FINALIZE_USE'].includes(b.command_kind) && b.updated_at >= b.created_at &&
        ['claimed','observed','cancelled'].includes(b.state) && typeof b.retired === 'boolean' &&
        typeof b.minimized === 'boolean' && b.retired === (b.retirement_reason !== null) &&
        (b.retirement_reason === null || REASONS.includes(b.retirement_reason)) &&
        (b.state !== 'cancelled' || b.retired) && (b.retirement_reason !== 'cancelled' || b.state === 'cancelled') &&
        b.minimized === (b.personal === null) && (!b.minimized || b.retired) &&
        (row.state === (b.retired ? 'revoked' : 'active') || allowRevokedRow && row.state === 'revoked'));
      if (b.command_kind === 'FINALIZE_USE') hash(b.challenge_fingerprint);
      else insist(b.challenge_fingerprint === null);
      const observed = b.response_digest !== null;
      insist(observed === (b.result_digest !== null) && observed === (b.observed_at !== null) &&
        (b.state !== 'claimed' || !observed) && (b.state !== 'observed' || observed));
      if (observed) {
        hash(b.response_digest); hash(b.result_digest); integer(b.observed_at);
        insist(b.observed_at! >= b.created_at && b.observed_at! <= b.updated_at && b.revision >= 2);
      }
      if (b.retired) insist(b.revision >= 2);
      if (b.revision === 1) insist(b.state === 'claimed' && !b.retired && b.updated_at === b.created_at);
      if (b.personal !== null) {
        const p = b.personal; exact(p, ['customer_id','correlation','canonical_request','first_response']); id(p.customer_id);
        insist(subjectHash(b.tenant_id,b.store_id,p.customer_id) === b.subject_ref &&
          commandNamespaceDigest(commandCorrelation(p.correlation)) === b.namespace_digest &&
          typeof p.canonical_request === 'string' && observed === (p.first_response !== null));
        const encoded = encodeDelegatedCommand(new TextEncoder().encode(p.canonical_request));
        insist(encoded.request.command !== 'RECOVER_RESULT' && encoded.request.command === b.command_kind &&
          encoded.original_command_id === b.original_command_id && encoded.command_digest === b.command_digest &&
          encoded.canonical_json === p.canonical_request);
        if (encoded.request.command === 'FINALIZE_USE')
          insist(commandChallengeFingerprint(b.namespace_digest,encoded.request.challenge_id) === b.challenge_fingerprint);
        if (p.first_response !== null) {
          const bound = bindDelegatedResponse(encoded.request,p.first_response);
          insist(contentDigest(bound.response) === b.response_digest && contentDigest(bound.response.result) === b.result_digest);
        }
      }
      const identity = canonical([b.tenant_id,b.store_id,b.identity_digest]);
      insist(!seen.has(identity)); seen.add(identity);
      return { row: { ...row }, body: b };
    });
    const challenges = new Map<string,CommandClaimRecord>();
    for (const record of records) {
      const b = record.body;
      if (b.challenge_fingerprint === null) continue;
      const key = canonical([b.tenant_id,b.store_id,b.challenge_fingerprint]), prior = challenges.get(key);
      if (prior) insist(commandClaimChallengeAvailable([prior],b));
      challenges.set(key,record);
    }
    return records;
  } catch { claimDenied('COMMAND_CLAIM_INTEGRITY'); }
}
export function commandClaimRecords(k: CommerceKernel, scope?: CommandClaimScope, allowRevokedRow = false): CommandClaimRecord[] {
  const rows = k.db.prepare(`SELECT * FROM commerce_support_documents WHERE kind=?
    ${scope ? 'AND tenant_id=? AND store_id=?' : ''} ORDER BY tenant_id,store_id,id,version LIMIT ?`)
    .all(CLAIM_KIND, ...(scope ? [id(scope.tenant_id),id(scope.store_id)] : []), CLAIM_MAX_ROWS + 1) as Row[];
  return validateCommandClaimRows(k,rows,allowRevokedRow);
}
function rowFor(b: CommandClaimBody): Row {
  return { tenant_id: b.tenant_id, store_id: b.store_id, kind: CLAIM_KIND, id: b.id, version: 1,
    body: canonical(b), digest: contentDigest(b), author: 'delegated_command_claims',
    state: b.retired ? 'revoked' : 'active', reviewer: null, review_digest: null,
    created_at: b.created_at, expires_at: null };
}
/** Internal typed writes. The public journal or existing privacy owner owns the transaction. */
export function insertCommandClaim(k: CommerceKernel, body: CommandClaimBody): CommandClaimRecord {
  const record = validateCommandClaimRows(k,[rowFor(body)])[0], r = record.row;
  k.db.prepare('INSERT INTO commerce_support_documents VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...ROW_KEYS.map(key => r[key]));
  return record;
}
export function updateCommandClaim(k: CommerceKernel, previous: CommandClaimRecord, body: CommandClaimBody): CommandClaimRecord {
  const before = previous.body;
  for (const key of ORIGINAL_KEYS) if (body[key] !== before[key]) claimDenied('COMMAND_CLAIM_CONFLICT');
  if (body.revision !== before.revision + 1 || body.updated_at < before.updated_at ||
    before.retired && !body.retired || before.minimized && !body.minimized ||
    before.state === 'cancelled' && body.state !== 'cancelled' || before.state === 'observed' && body.state === 'claimed')
    claimDenied('COMMAND_CLAIM_REVISION_CONFLICT');
  if (before.response_digest !== null && (body.response_digest !== before.response_digest ||
    body.result_digest !== before.result_digest || body.observed_at !== before.observed_at))
    claimDenied('COMMAND_CLAIM_REVISION_CONFLICT');
  if (before.retired && (body.response_digest !== before.response_digest || body.observed_at !== before.observed_at))
    claimDenied('COMMAND_CLAIM_RETIRED');
  if (body.personal !== null && before.personal !== null) {
    const { first_response: oldResponse, ...oldOriginal } = before.personal;
    const { first_response: newResponse, ...newOriginal } = body.personal;
    if (canonical(oldOriginal) !== canonical(newOriginal) || oldResponse !== null && canonical(oldResponse) !== canonical(newResponse))
      claimDenied('COMMAND_CLAIM_CONFLICT');
  }
  const record = validateCommandClaimRows(k,[rowFor(body)])[0], r = record.row;
  const result = k.db.prepare(`UPDATE commerce_support_documents SET body=?,digest=?,state=?
    WHERE tenant_id=? AND store_id=? AND kind=? AND id=? AND version=1 AND digest=? AND state=?
      AND json_extract(body,'$.revision')=?`).run(r.body,r.digest,r.state,r.tenant_id,r.store_id,
        CLAIM_KIND,r.id,previous.row.digest,previous.row.state,before.revision);
  if (result.changes !== 1) claimDenied('COMMAND_CLAIM_REVISION_CONFLICT');
  return record;
}
export function commandClaimHeld(k: CommerceKernel, b: CommandClaimBody): boolean {
  return !!k.db.prepare(`SELECT 1 FROM commerce_privacy_holds WHERE tenant_id=? AND store_id=?
    AND subject_hash=? AND released=0 AND expires_at>?`).get(b.tenant_id,b.store_id,b.subject_ref,k.clock());
}
export function retireCommandClaim(k: CommerceKernel, record: CommandClaimRecord,
  reason: CommandClaimRetirement, minimize: boolean): CommandClaimRecord {
  const b = record.body;
  if (!REASONS.includes(reason) || typeof minimize !== 'boolean') claimDenied('COMMAND_CLAIM_INPUT_INVALID');
  if (b.retired && (!minimize || b.minimized) && record.row.state === 'revoked') return record;
  return updateCommandClaim(k,record,{ ...b, revision: b.revision + 1, updated_at: commandClaimNow(k,b.updated_at),
    retired: true, retirement_reason: b.minimized ? b.retirement_reason : reason,
    state: reason === 'cancelled' ? 'cancelled' : b.state,
    minimized: b.minimized || minimize, personal: minimize ? null : b.personal });
}
