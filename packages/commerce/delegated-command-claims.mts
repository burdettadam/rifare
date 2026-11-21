import { exact, integer } from './kernel.mts';
import type { CommerceKernel, Row, Scope } from './kernel.mts';
import { checkoutSnapshot } from './checkout-preview.mts';
import { contentDigest } from './configuration-values.mts';
import { subjectHash, assertRecoveryEgress } from './data-guards.mts';
import { growthCustomer } from './growth-shopping-core.mts';
import { encodeDelegatedCommand, bindDelegatedResponse, createDelegatedRecovery } from '../adapters/delegated-commands/command-codec.mts';
import type { DelegatedCommandResponse, EncodedDelegatedCommand } from '../adapters/delegated-commands/command-codec.mts';
import { CLAIM_MAX_ROWS, CommandClaimDenied, claimDenied, commandCorrelation, commandNamespaceDigest,
  commandClaimUuid, commandClaimIdentity, commandClaimId, commandChallengeFingerprint,
  commandClaimChallengeAvailable, commandClaimNow, commandClaimRecords, commandClaimHeld,
  insertCommandClaim, updateCommandClaim, retireCommandClaim } from './delegated-command-claim-records.mts';
import type { CommandCorrelation, CommandClaimBody, CommandClaimRecord } from './delegated-command-claim-records.mts';

export { CommandClaimDenied } from './delegated-command-claim-records.mts';
export type { CommandCorrelation } from './delegated-command-claim-records.mts';
const UNVERIFIED = Object.freeze({ evidence_status: 'historical_unverified_observation' as const,
  observation_origin: 'local_unverified_input' as const, execution_authorized: false as const,
  provider_authenticated: false as const, receipt_signature_verified: false as const,
  qualification: 'candidate_contract_only' as const });
export type CommandClaimView = Readonly<{
  claim_id: string; original_command_id: string; namespace_digest: string;
  command_kind: 'START_USE' | 'FINALIZE_USE'; command_digest: string;
  created_at: number; updated_at: number; observed_at: number | null; revision: number;
  state: 'claimed' | 'observed' | 'cancelled'; retired: boolean; minimized: boolean;
  canonical_request: string | null; response: DelegatedCommandResponse | null;
}> & typeof UNVERIFIED;
export type CommandClaimRecovery = EncodedDelegatedCommand & typeof UNVERIFIED;

/** Native access controls this local journal only. Its arbitrary valid protocol
 * intent/result remains unverified and cannot create checkout or provider authority. */
export class DelegatedCommandClaims {
  readonly #kernel: CommerceKernel;
  readonly #correlation: CommandCorrelation;
  readonly #namespace: string;
  #lastTime = 0;
  constructor(kernel: CommerceKernel, correlation: CommandCorrelation) {
    this.#kernel = kernel; this.#correlation = commandCorrelation(correlation);
    this.#namespace = commandNamespaceDigest(this.#correlation);
  }
  #current(scope: Scope): Row {
    try {
      const s = this.#kernel.require(scope);
      if (s.role !== 'customer') claimDenied('COMMAND_CLAIM_NOT_FOUND');
      growthCustomer(this.#kernel,scope,s.resource_id,s.customer_id);
      return s;
    } catch (error) {
      if (error instanceof CommandClaimDenied) throw error;
      claimDenied('COMMAND_CLAIM_ACCESS_DENIED');
    }
  }
  #owned(s: Row, record: CommandClaimRecord): void {
    const b = record.body;
    if (b.tenant_id !== s.tenant_id || b.store_id !== s.store_id || b.resource_id !== s.resource_id ||
      b.subject_ref !== subjectHash(s.tenant_id,s.store_id,s.customer_id)) claimDenied('COMMAND_CLAIM_NOT_FOUND');
  }
  #lookup(s: Row, records: readonly CommandClaimRecord[], commandId: string): CommandClaimRecord {
    commandClaimUuid(commandId);
    const identity = commandClaimIdentity(s.tenant_id,s.store_id,this.#namespace,commandId);
    const record = records.find(r => r.body.id === commandClaimId(identity));
    if (!record || record.body.identity_digest !== identity) claimDenied('COMMAND_CLAIM_NOT_FOUND');
    this.#owned(s,record); return record;
  }
  #now(records: readonly CommandClaimRecord[]): number {
    const floor = records.reduce((latest,r) => Math.max(latest,r.body.updated_at),this.#lastTime);
    return this.#lastTime = commandClaimNow(this.#kernel,floor);
  }
  #view(record: CommandClaimRecord): CommandClaimView {
    const b = record.body, p = b.retired ? null : b.personal;
    return checkoutSnapshot({ claim_id: b.id, original_command_id: b.original_command_id,
      namespace_digest: b.namespace_digest, command_kind: b.command_kind, command_digest: b.command_digest,
      created_at: b.created_at, updated_at: b.updated_at, observed_at: b.observed_at, revision: b.revision,
      state: b.state, retired: b.retired, minimized: b.minimized,
      canonical_request: p?.canonical_request ?? null, response: p?.first_response ?? null, ...UNVERIFIED });
  }
  #fence(record: CommandClaimRecord): void {
    const b = record.body;
    // All callbacks, clocks and native authority checks have finished. Strict
    // inert reads also catch coherent reentrant replacement or another claim.
    const current = commandClaimRecords(this.#kernel,b).find(r => r.body.id === b.id);
    if (!current || current.body.identity_digest !== b.identity_digest ||
      current.row.digest !== record.row.digest || current.row.state !== record.row.state)
      claimDenied('COMMAND_CLAIM_REVISION_CONFLICT');
  }
  #egress(): void {
    try { assertRecoveryEgress(this.#kernel); }
    catch { claimDenied('COMMAND_CLAIM_ACCESS_DENIED'); }
  }
  #finish(scope: Scope, record: CommandClaimRecord, activeWork = false): CommandClaimView {
    this.#owned(this.#current(scope),record);
    if (activeWork) this.#egress();
    this.#fence(record); return this.#view(record);
  }
  #run<T>(scope: Scope, mutation: boolean, activeWork: boolean, fn: (s: Row, records: CommandClaimRecord[]) => T): T {
    // A savepoint is not a durable claim. Check before authentication can write last_seen.
    if (mutation && this.#kernel.db.isTransaction) claimDenied('COMMAND_CLAIM_TRANSACTION_OWNERSHIP');
    try {
      return this.#kernel.transaction(() => {
        const s = this.#current(scope);
        if (activeWork) this.#egress();
        return fn(s,commandClaimRecords(this.#kernel,s));
      });
    } catch (error) {
      if (error instanceof CommandClaimDenied) throw error;
      claimDenied('COMMAND_CLAIM_STORAGE_UNAVAILABLE');
    }
  }
  claim(scope: Scope, originalMutation: unknown): CommandClaimView {
    return this.#run(scope,true,true,(s,records) => {
      let encoded: EncodedDelegatedCommand;
      try { encoded = encodeDelegatedCommand(originalMutation); }
      catch { claimDenied('COMMAND_CLAIM_INPUT_INVALID'); }
      if (encoded.request.command === 'RECOVER_RESULT') claimDenied('COMMAND_CLAIM_INPUT_INVALID');
      const request = encoded.request;
      const identity = commandClaimIdentity(s.tenant_id,s.store_id,this.#namespace,request.command_id);
      const key = commandClaimId(identity), previous = records.find(r => r.body.id === key);
      const challenge = request.command === 'FINALIZE_USE'
        ? commandChallengeFingerprint(this.#namespace,request.challenge_id) : null;
      if (previous) {
        // Scope is checked before command conflict details, including minimized claims.
        this.#owned(s,previous);
        if (previous.body.identity_digest !== identity) claimDenied('COMMAND_CLAIM_NOT_FOUND');
        // RCG4BC2-ORIGINAL-COMMAND-DIGEST: targeted-fault mutation point.
        if (previous.body.command_digest !== encoded.command_digest) claimDenied('COMMAND_CLAIM_CONFLICT');
        if (previous.body.command_kind !== request.command || previous.body.challenge_fingerprint !== challenge)
          claimDenied('COMMAND_CLAIM_CONFLICT');
        this.#now(records); return this.#finish(scope,previous,true);
      }
      if (records.length >= CLAIM_MAX_ROWS) claimDenied('COMMAND_CLAIM_ROW_LIMIT');
      const now = this.#now(records);
      const body: CommandClaimBody = { schema_version: 1, id: key, tenant_id: s.tenant_id, store_id: s.store_id,
        resource_id: s.resource_id, subject_ref: subjectHash(s.tenant_id,s.store_id,s.customer_id),
        identity_digest: identity, namespace_digest: this.#namespace, original_command_id: request.command_id,
        command_kind: request.command, command_digest: encoded.command_digest, challenge_fingerprint: challenge,
        response_digest: null, result_digest: null, created_at: now, updated_at: now, observed_at: null, revision: 1,
        state: 'claimed', retired: false, retirement_reason: null, minimized: false,
        personal: { customer_id: s.customer_id, correlation: this.#correlation,
          canonical_request: encoded.canonical_json, first_response: null } };
      if (!commandClaimChallengeAvailable(records,body)) {
        const occupied = records.find(r => r.body.challenge_fingerprint === challenge)!;
        this.#owned(s,occupied); claimDenied('COMMAND_CLAIM_CHALLENGE_CONFLICT');
      }
      return this.#finish(scope,insertCommandClaim(this.#kernel,body),true);
    });
  }
  read(scope: Scope, originalCommandId: string): CommandClaimView {
    return this.#run(scope,false,false,(s,records) => this.#finish(scope,this.#lookup(s,records,originalCommandId)));
  }
  observe(scope: Scope, originalCommandId: string, rawResponse: unknown,
    options: Readonly<{ recovery?: unknown }> = {}): CommandClaimView {
    return this.#run(scope,true,true,(s,records) => {
      const current = this.#lookup(s,records,originalCommandId), b = current.body;
      if (b.retired || b.personal === null) claimDenied('COMMAND_CLAIM_RETIRED');
      let selected: { recovery?: unknown };
      try {
        selected = checkoutSnapshot(options);
        exact(selected,Object.hasOwn(selected,'recovery') ? ['recovery'] : []);
      } catch { claimDenied('COMMAND_CLAIM_INPUT_INVALID'); }
      let response: DelegatedCommandResponse;
      try {
        response = bindDelegatedResponse(JSON.parse(b.personal.canonical_request),rawResponse,
          { ...selected, ...(b.personal.first_response ? { previous: b.personal.first_response } : {}) }).response;
      } catch { claimDenied('COMMAND_CLAIM_BINDING_INVALID'); }
      const now = this.#now(records);
      if (b.personal.first_response !== null) return this.#finish(scope,current,true);
      const next = updateCommandClaim(this.#kernel,current,{ ...b, revision: b.revision + 1,
        state: 'observed', observed_at: now, updated_at: now,
        response_digest: contentDigest(response), result_digest: contentDigest(response.result),
        personal: { ...b.personal, first_response: response } });
      return this.#finish(scope,next,true);
    });
  }
  recovery(scope: Scope, originalCommandId: string): CommandClaimRecovery {
    return this.#run(scope,false,true,(s,records) => {
      const record = this.#lookup(s,records,originalCommandId), b = record.body;
      if (b.retired || b.personal === null) claimDenied('COMMAND_CLAIM_RETIRED');
      const encoded = createDelegatedRecovery(JSON.parse(b.personal.canonical_request));
      this.#finish(scope,record,true); return checkoutSnapshot({ ...encoded, ...UNVERIFIED });
    });
  }
  cancel(scope: Scope, input: Readonly<{ command_id: string; expected_revision: number }>): CommandClaimView {
    return this.#run(scope,true,false,(s,records) => {
      let request: typeof input;
      try {
        request = checkoutSnapshot(input); exact(request,['command_id','expected_revision']);
        commandClaimUuid(request.command_id); integer(request.expected_revision,1);
      } catch { claimDenied('COMMAND_CLAIM_INPUT_INVALID'); }
      const record = this.#lookup(s,records,request.command_id);
      if (record.body.revision !== request.expected_revision) claimDenied('COMMAND_CLAIM_REVISION_CONFLICT');
      this.#now(records);
      const next = retireCommandClaim(this.#kernel,record,'cancelled',!commandClaimHeld(this.#kernel,record.body));
      return this.#finish(scope,next);
    });
  }
}
