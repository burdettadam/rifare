import { exact, id, integer, digest } from './kernel.mts';
import type { CommerceKernel, Scope, Row } from './kernel.mts';
import { canonical, contentDigest, jsonValue } from './configuration-values.mts';
import { email } from './customer-access.mts';
import { subjectHash, assertNotErased, assertRecoveryAction, assertRecoveryEgress } from './data-guards.mts';
import { assertExecution } from './execution-stops.mts';
import { permissionDecision } from './authorization.mts';
import { OptionalProviderFixtureSource, OptionalNoEffectError } from '../adapters/optional-provider-fixture-source.mts';

export const OPTIONAL_QUALIFICATION = 'synthetic_local_preparation_only';
const ACKNOWLEDGEMENTS = ['purpose_specific', 'destination_bound', 'retention_bound', 'non_biometric', 'withdrawable', 'no_fit_or_policy_guarantee'];
export type OptionalQuality = {
  assertReady(scope: Scope, configuration?: Row): Row;
  projectOutput(result: Row, command: Row): Row;
};
export function optionalChecked(row: Row | undefined, absent = 'NOT_FOUND') {
  if (!row) throw new Error(absent);
  const body = jsonValue(JSON.parse(row.body));
  if (contentDigest(body) !== row.digest) throw new Error('OPTIONAL_RECORD_INTEGRITY');
  return {...row, body};
}
function bodyWrite(k: CommerceKernel, table: string, row: Row, body: Row, state: string) {
  if (!['commerce_optional_consents', 'commerce_optional_media', 'commerce_optional_operations', 'commerce_optional_deletions'].includes(table)) throw new Error('OPTIONAL_TABLE_DENIED');
  k.db.prepare(`UPDATE ${table} SET body=?,digest=?,state=? WHERE tenant_id=? AND store_id=? AND id=?`)
    .run(canonical(body), contentDigest(body), state, row.tenant_id, row.store_id, row.id);
}
export function optionalSourceScope(k: CommerceKernel, s: Row, source: OptionalProviderFixtureSource) {
  if (source.db === k.db || source.tenant_id !== s.tenant_id || source.store_id !== s.store_id) throw new Error('SOURCE_SCOPE_DENIED');
}
function currentActor(k: CommerceKernel, s: Row, actorId: string, action: string, resource: string | null = null) {
  const member = k.db.prepare('SELECT role FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND active=1')
    .get(s.tenant_id, s.store_id, actorId) as Row | undefined;
  return !!member && permissionDecision(k.db, {...s, actor_id: actorId, role: member.role}, action, resource).allowed;
}
export function optionalConfiguration(k: CommerceKernel, s: Row, source: OptionalProviderFixtureSource) {
  optionalSourceScope(k, s, source);
  const row = optionalChecked(k.db.prepare('SELECT * FROM commerce_optional_configurations WHERE tenant_id=? AND store_id=? AND kind=?')
    .get(s.tenant_id, s.store_id, source.purpose) as Row | undefined, 'OPTIONAL_DISABLED');
  if (!row.enabled || row.expires_at <= k.clock() || row.body.mode !== 'fixture') throw new Error('OPTIONAL_DISABLED');
  if (!currentActor(k, s, row.body.configured_by, 'action.configure')) throw new Error('OPTIONAL_CONFIGURATION_AUTHORITY_CHANGED');
  const current = source.configuration();
  if (row.body.source_config_digest !== current.digest || contentDigest(row.body.source_configuration) !== current.digest) throw new Error('SOURCE_CONFIGURATION_CHANGED');
  if (current.body.expires_at <= k.clock()) throw new Error('OPTIONAL_DISABLED');
  return {...row, source: current};
}
export function verifiedOptionalCustomer(k: CommerceKernel, scope: Scope, resourceId: string) {
  const s = k.authorize(scope, 'resource.read', id(resourceId));
  if (s.role !== 'customer') throw new Error('VERIFIED_CUSTOMER_REQUIRED');
  const order = k.get(scope, resourceId);
  const proof = k.db.prepare('SELECT * FROM commerce_customer_proof_bindings WHERE token_hash=?').get(s.token_hash) as Row | undefined;
  const customer = proof ? k.db.prepare("SELECT * FROM commerce_resources WHERE tenant_id=? AND store_id=? AND id=? AND kind='customer'")
    .get(s.tenant_id, s.store_id, proof.customer_resource_id) as Row | undefined : null;
  if (!customer || order.kind !== 'order' || s.resource_id !== resourceId || order.customer_id !== s.customer_id || customer.external_id !== s.customer_id || customer.source_system !== order.source_system) throw new Error('VERIFIED_CUSTOMER_REQUIRED');
  const address = email(JSON.parse(customer.payload).email);
  if (proof!.owner_hash !== digest(JSON.stringify([customer.id, customer.source_version, address]))) throw new Error('VERIFIED_CUSTOMER_REQUIRED');
  assertNotErased(k, s, resourceId, s.customer_id);
  return {s, order, customer, subject_hash: subjectHash(s.tenant_id, s.store_id, s.customer_id)};
}

function deletionFor(k: CommerceKernel, row: Row) {
  const deletion_id = 'optional_delete_' + digest(JSON.stringify([row.tenant_id, row.store_id, row.source_identity, row.id])).slice(0, 32);
  const body = {original_operation_id: row.id, source_identity: row.source_identity, native_id: row.native_id ?? null,
    original_state: row.state, eligible: true, replay_allowed: false};
  k.db.prepare(`INSERT INTO commerce_optional_deletions VALUES(?,?,?,?,?,?,?,?,'pending',?,?,?)
    ON CONFLICT(tenant_id,store_id,source_identity,original_operation_id) DO NOTHING`)
    .run(row.tenant_id, row.store_id, deletion_id, row.resource_id, row.subject_hash, row.source_identity, row.id, row.native_id ?? null,
      canonical(body), contentDigest(body), k.clock());
}
function redactOperation(k: CommerceKernel, row: Row) {
  deletionFor(k, row);
  const state = ['queued', 'blocked'].includes(row.state) ? 'cancelled' : row.state;
  const body = {redacted: true, operation_id: row.id, source_identity: row.source_identity, native_id: row.native_id ?? null,
    kind: row.kind, original_state: state, replay_allowed: false};
  bodyWrite(k, 'commerce_optional_operations', row, body, state);
}
function minimizeConsent(k: CommerceKernel, row: Row) {
  bodyWrite(k, 'commerce_optional_consents', row, {redacted: true, consent_id: row.id, purpose: row.kind, granted: false, replay_allowed: false}, 'withdrawn');
  const media = k.db.prepare('SELECT * FROM commerce_optional_media WHERE tenant_id=? AND store_id=? AND consent_id=?')
    .all(row.tenant_id, row.store_id, row.id) as Row[];
  for (const entry of media) bodyWrite(k, 'commerce_optional_media', entry, {redacted: true, media_id: entry.id, purpose: 'try_on', model_access: false}, 'erased');
  const operations = k.db.prepare('SELECT * FROM commerce_optional_operations WHERE tenant_id=? AND store_id=? AND consent_id=?')
    .all(row.tenant_id, row.store_id, row.id) as Row[];
  for (const entry of operations) redactOperation(k, entry);
}

export function revokeOptionalQuality(k: CommerceKernel, tenant: string, store: string, qualityId: string) {
  const operations = k.db.prepare('SELECT * FROM commerce_optional_operations WHERE tenant_id=? AND store_id=?').all(tenant, store) as Row[];
  const consentIds = new Set(operations.filter(row => optionalChecked(row).body.quality_id === qualityId).map(row => row.consent_id));
  for (const consentId of consentIds) {
    const consent = k.db.prepare('SELECT * FROM commerce_optional_consents WHERE tenant_id=? AND store_id=? AND id=?').get(tenant, store, consentId) as Row | undefined;
    if (consent) minimizeConsent(k, consent);
  }
}

/** Canonical privacy integration. Pure local minimization queues original-source
 * deletion; it never contacts a processor and never replays processing. */
export function eraseOptionalSubject(k: CommerceKernel, tenant: string, store: string, resourceIds: string[], hash: string) {
  id(tenant); id(store); resourceIds.forEach(id);
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('OPTIONAL_INPUT_INVALID');
  return k.transaction(() => {
    const owned = (row: Row) => row.subject_hash === hash || resourceIds.includes(row.resource_id);
    for (const row of k.db.prepare('SELECT * FROM commerce_optional_consents WHERE tenant_id=? AND store_id=?').all(tenant, store) as Row[]) if (owned(row)) minimizeConsent(k, row);
    // Explicitly rebuild allowlists even if a restored or previously redacted
    // body contains extra private fields, and cover orphan rows independently.
    for (const row of k.db.prepare('SELECT * FROM commerce_optional_media WHERE tenant_id=? AND store_id=?').all(tenant, store) as Row[])
      if (owned(row)) bodyWrite(k, 'commerce_optional_media', row, {redacted: true, media_id: row.id, purpose: 'try_on', model_access: false}, 'erased');
    for (const row of k.db.prepare('SELECT * FROM commerce_optional_operations WHERE tenant_id=? AND store_id=?').all(tenant, store) as Row[]) if (owned(row)) redactOperation(k, row);
    for (const row of k.db.prepare('SELECT * FROM commerce_optional_deletions WHERE tenant_id=? AND store_id=?').all(tenant, store) as Row[])
      if (owned(row)) bodyWrite(k, 'commerce_optional_deletions', row, {redacted: true, original_operation_id: row.original_operation_id,
        source_identity: row.source_identity, native_id: row.native_id ?? null, eligible: true, replay_allowed: false}, row.state);
    return {minimized: true, source_deletion: 'queued_original_identity_only', physical_erasure: false};
  });
}

/** Import/restore never carries consent, processor enablement or quality as new
 * execution authority. Original unknown operations remain unknown and fenced. */
export function revokeOptionalForRestore(k: CommerceKernel, tenant?: string, store?: string) {
  if ((tenant === undefined) !== (store === undefined)) throw new Error('OPTIONAL_INPUT_INVALID');
  if (tenant !== undefined) {id(tenant); id(store);}
  return k.transaction(() => {
    const predicate = tenant === undefined ? '' : ' WHERE tenant_id=? AND store_id=?';
    const parameters = tenant === undefined ? [] : [tenant, store!];
    k.db.prepare('UPDATE commerce_optional_configurations SET enabled=0' + predicate).run(...parameters);
    k.db.prepare("UPDATE commerce_optional_quality SET state='revoked'" + predicate).run(...parameters);
    for (const row of k.db.prepare('SELECT * FROM commerce_optional_consents' + predicate).all(...parameters) as Row[]) minimizeConsent(k, row);
    return {authority_revoked: true, effects_replayed: 0, source_deletion: 'queued_original_identity_only'};
  });
}

export class OptionalLifecycleCore {
  readonly k: CommerceKernel;
  readonly source: OptionalProviderFixtureSource;
  constructor(k: CommerceKernel, source: OptionalProviderFixtureSource) {
    if (k.db === source.db) throw new Error('OPTIONAL_SOURCE_MUST_BE_SEPARATE');
    this.k = k; this.source = source;
  }
  configure(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['expected_revision', 'enabled', 'expires_at']); integer(p.expected_revision); integer(p.expires_at);
    if (typeof p.enabled !== 'boolean' || p.expires_at <= this.k.clock() || p.expires_at > this.k.clock() + 86400000) throw new Error('OPTIONAL_INPUT_INVALID');
    return this.k.transaction(() => {
      const s = this.k.authorize(scope, 'action.configure'); optionalSourceScope(this.k, s, this.source);
      const old = this.k.db.prepare('SELECT revision FROM commerce_optional_configurations WHERE tenant_id=? AND store_id=? AND kind=?')
        .get(s.tenant_id, s.store_id, this.source.purpose) as Row | undefined;
      if ((old?.revision ?? 0) !== p.expected_revision) throw new Error('SOURCE_CONFIGURATION_CHANGED');
      const configuration = this.source.configuration();
      if (p.expires_at > configuration.body.expires_at) throw new Error('OPTIONAL_INPUT_INVALID');
      const body = {source_configuration: configuration.body, source_config_digest: configuration.digest, configured_by: s.actor_id,
        mode: 'fixture', real_partner_agreement: false, external_qualified: false};
      this.k.db.prepare(`INSERT INTO commerce_optional_configurations VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,store_id,kind)
        DO UPDATE SET revision=excluded.revision,enabled=excluded.enabled,body=excluded.body,digest=excluded.digest,expires_at=excluded.expires_at`)
        .run(s.tenant_id, s.store_id, this.source.purpose, p.expected_revision + 1, Number(p.enabled), canonical(body), contentDigest(body), p.expires_at);
      return {revision: p.expected_revision + 1, enabled: p.enabled, qualification: OPTIONAL_QUALIFICATION, external_qualified: false};
    });
  }
  configuration(scope: Scope) {return optionalConfiguration(this.k, this.k.authorize(scope, 'capability.read'), this.source);}
  consent(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['consent_id', 'resource_id', 'purpose', 'input_id', 'input_sha256', 'source_config_digest', 'product_id', 'material', 'retention_until', 'expires_at', 'acknowledgements']);
    id(p.consent_id); id(p.resource_id); id(p.input_id); integer(p.retention_until); integer(p.expires_at);
    if (!/^[a-f0-9]{64}$/.test(p.input_sha256) || !/^[a-f0-9]{64}$/.test(p.source_config_digest) ||
      !Array.isArray(p.acknowledgements) || p.acknowledgements.length !== ACKNOWLEDGEMENTS.length || [...p.acknowledgements].sort().join() !== [...ACKNOWLEDGEMENTS].sort().join()) throw new Error('INFORMED_CONSENT_REQUIRED');
    return this.k.transaction(() => {
      assertRecoveryAction(this.k, 'attachment.write');
      const verified = verifiedOptionalCustomer(this.k, scope, p.resource_id), {s} = verified, configuration = optionalConfiguration(this.k, s, this.source);
      if (p.purpose !== this.source.purpose) throw new Error('PURPOSE_DENIED');
      if (p.source_config_digest !== configuration.source.digest) throw new Error('SOURCE_CONFIGURATION_CHANGED');
      if (p.retention_until <= this.k.clock() || p.retention_until > this.k.clock() + configuration.source.body.max_retention_ms ||
        p.expires_at < p.retention_until || p.expires_at > configuration.expires_at || p.expires_at > this.k.clock() + 86400000) throw new Error('CONSENT_RETENTION_INVALID');
      if (this.source.purpose === 'try_on') {
        if (!configuration.source.body.product_ids.includes(p.product_id) || !configuration.source.body.materials.includes(p.material)) throw new Error('PRODUCT_OR_MATERIAL_UNSUPPORTED');
      } else if (p.product_id !== null || p.material !== null) throw new Error('PURPOSE_DENIED');
      const body = {...p, configuration_revision: configuration.revision, configuration_digest: configuration.digest,
        source_configuration: configuration.source.body, customer_resource_id: verified.customer.id, customer_source_version: verified.customer.source_version,
        source_kind: 'verified_customer_purpose_consent', model_access: this.source.purpose === 'try_on', biometric: false, cross_merchant_join: false};
      const old = this.k.db.prepare('SELECT * FROM commerce_optional_consents WHERE tenant_id=? AND store_id=? AND id=?')
        .get(s.tenant_id, s.store_id, p.consent_id) as Row | undefined;
      if (old) {
        if (old.state !== 'granted') throw new Error('CONSENT_WITHDRAWN');
        if (optionalChecked(old).digest !== contentDigest(body)) throw new Error('CONSENT_CONFLICT');
      } else this.k.db.prepare("INSERT INTO commerce_optional_consents VALUES(?,?,?,?,?,?,'granted',?,?,?,?)")
        .run(s.tenant_id, s.store_id, p.consent_id, p.resource_id, verified.subject_hash, this.source.purpose, canonical(body), contentDigest(body), this.k.clock(), p.expires_at);
      return {id: p.consent_id, purpose: p.purpose, state: 'granted', expires_at: p.expires_at, retention_until: p.retention_until, source_config_digest: p.source_config_digest};
    });
  }
  currentConsent(s: Row, consentId: string, resourceId: string, configuration: Row, missingAllowed = false): Row | null {
    const found = this.k.db.prepare('SELECT * FROM commerce_optional_consents WHERE tenant_id=? AND store_id=? AND id=?')
      .get(s.tenant_id, s.store_id, id(consentId)) as Row | undefined;
    if (!found && missingAllowed) return null;
    const row = optionalChecked(found, 'CONSENT_REQUIRED');
    if (row.state !== 'granted' || row.body.redacted) throw new Error('CONSENT_WITHDRAWN');
    if (row.resource_id !== resourceId || row.kind !== this.source.purpose || row.body.purpose !== this.source.purpose) throw new Error('CONSENT_CONTEXT_CHANGED');
    if (row.expires_at <= this.k.clock() || row.body.retention_until <= this.k.clock()) throw new Error('CONSENT_EXPIRED');
    if (row.body.configuration_revision !== configuration.revision || row.body.configuration_digest !== configuration.digest || row.body.source_config_digest !== configuration.source.digest ||
      contentDigest(row.body.source_configuration) !== configuration.source.digest) throw new Error('CONSENT_CONTEXT_CHANGED');
    const customer = this.k.db.prepare("SELECT * FROM commerce_resources WHERE tenant_id=? AND store_id=? AND id=? AND kind='customer'")
      .get(s.tenant_id, s.store_id, row.body.customer_resource_id) as Row | undefined;
    const order = this.k.db.prepare("SELECT * FROM commerce_resources WHERE tenant_id=? AND store_id=? AND id=? AND kind='order'")
      .get(s.tenant_id, s.store_id, resourceId) as Row | undefined;
    if (!customer || !order || customer.external_id !== order.customer_id || customer.source_system !== order.source_system || customer.source_version !== row.body.customer_source_version ||
      subjectHash(s.tenant_id, s.store_id, customer.external_id) !== row.subject_hash) throw new Error('CONSENT_CUSTOMER_CHANGED');
    assertNotErased(this.k, s, resourceId, customer.external_id);
    return row;
  }
  queue(scope: Scope, input: Row, quality: OptionalQuality) {
    const p = exact(jsonValue(input), ['operation_id', 'resource_id', 'consent_id', 'input_id', 'input_sha256', 'input', 'product_id', 'material', 'geography']);
    id(p.operation_id); id(p.resource_id);
    return this.k.transaction(() => {
      const s = this.k.authorize(scope, 'action.propose', p.resource_id); this.k.get(scope, p.resource_id);
      const configuration = optionalConfiguration(this.k, s, this.source), consent = this.currentConsent(s, p.consent_id, p.resource_id, configuration)!;
      if (p.input_id !== consent.body.input_id || p.input_sha256 !== consent.body.input_sha256 || p.product_id !== consent.body.product_id || p.material !== consent.body.material) throw new Error('CONSENT_CONTEXT_CHANGED');
      if (p.geography !== configuration.source.body.geography) throw new Error('GEOGRAPHY_DENIED');
      const readiness = quality.assertReady(scope, configuration), controls = assertExecution(this.k, s, this.source.purpose === 'try_on' ? 'model.run' : 'credential.probe');
      if (this.source.purpose === 'try_on' && (!readiness.body.product_ids.includes(p.product_id) || !readiness.body.materials.includes(p.material))) throw new Error('PRODUCT_OR_MATERIAL_UNSUPPORTED');
      const command = {...p, tenant_id: s.tenant_id, store_id: s.store_id, source_identity: this.source.identity, purpose: this.source.purpose,
        source_config_digest: configuration.source.digest, configuration: configuration.source.body, retention_until: consent.body.retention_until};
      const logical_key = contentDigest([s.tenant_id, s.store_id, this.source.purpose, p.resource_id, p.consent_id, p.input_id]);
      const existing = this.k.db.prepare('SELECT * FROM commerce_optional_operations WHERE tenant_id=? AND store_id=? AND (id=? OR logical_key=?)')
        .all(s.tenant_id, s.store_id, p.operation_id, logical_key) as Row[];
      if (existing.length) {
        if (existing.length !== 1 || existing[0].id !== p.operation_id || existing[0].logical_key !== logical_key || optionalChecked(existing[0]).body.command &&
          contentDigest(optionalChecked(existing[0]).body.command) !== contentDigest(command)) throw new Error('OPTIONAL_OPERATION_CONFLICT');
        return this.read(scope, existing[0].id);
      }
      const unknown = this.k.db.prepare(`SELECT 1 FROM commerce_optional_operations o WHERE o.tenant_id=? AND o.store_id=? AND o.resource_id=? AND o.kind=? AND o.state='unknown'
        AND NOT EXISTS(SELECT 1 FROM commerce_optional_deletions d WHERE d.tenant_id=o.tenant_id AND d.store_id=o.store_id AND d.original_operation_id=o.id AND d.source_identity=o.source_identity AND d.state='deleted')`)
        .get(s.tenant_id, s.store_id, p.resource_id, this.source.purpose);
      if (unknown) throw new Error('ORIGINAL_OPERATION_RECONCILIATION_REQUIRED');
      const body = {command, quality_id: readiness.id, quality_digest: readiness.digest, consent_digest: consent.digest,
        configuration_revision: configuration.revision, configuration_digest: configuration.digest, proposed_by: s.actor_id, control_stamp: controls.stamp, output: null, reason: null};
      this.k.db.prepare("INSERT INTO commerce_optional_operations VALUES(?,?,?,?,?,?,?,?,?,NULL,'queued',?,?,?,?)")
        .run(s.tenant_id, s.store_id, p.operation_id, p.resource_id, consent.subject_hash, this.source.purpose, p.consent_id, logical_key, this.source.identity,
          canonical(body), contentDigest(body), this.k.clock(), consent.body.retention_until);
      return this.read(scope, p.operation_id);
    });
  }
  operation(scope: Scope, ref: string, action = 'operation.read') {
    const s = this.k.require(scope); id(ref);
    const row = optionalChecked(this.k.db.prepare('SELECT * FROM commerce_optional_operations WHERE tenant_id=? AND store_id=? AND id=?')
      .get(s.tenant_id, s.store_id, ref) as Row | undefined);
    this.k.authorize(scope, action, row.resource_id); this.k.get(scope, row.resource_id); optionalSourceScope(this.k, s, this.source);
    if (row.kind !== this.source.purpose || row.source_identity !== this.source.identity) throw new Error('SOURCE_SCOPE_DENIED');
    return row;
  }
  read(scope: Scope, ref: string) {
    const row = this.operation(scope, ref);
    return {id: row.id, resource_id: row.resource_id, state: row.state, native_id: row.native_id, output: row.expires_at <= this.k.clock() ? null : row.body.output ?? null,
      reason: row.expires_at <= this.k.clock() ? 'RETENTION_EXPIRED' : row.body.reason ?? null, redacted: row.body.redacted === true, qualification: OPTIONAL_QUALIFICATION, external_qualified: false};
  }
  #current(scope: Scope, ref: string, quality: OptionalQuality) {
    const row = this.operation(scope, ref, 'action.execute');
    if (row.body.redacted) throw new Error('OPERATION_REDACTED');
    const s = this.k.authorize(scope, 'operation.dispatch', row.resource_id);
    if (this.source.purpose === 'try_on') this.k.authorize(scope, 'model.run', row.resource_id);
    else this.k.authorize(scope, 'secret.invoke', row.resource_id);
    assertRecoveryEgress(this.k);
    const configuration = optionalConfiguration(this.k, s, this.source), consent = this.currentConsent(s, row.consent_id, row.resource_id, configuration)!;
    if (row.body.consent_digest !== consent.digest || row.body.configuration_digest !== configuration.digest || row.body.configuration_revision !== configuration.revision) throw new Error('CONSENT_CONTEXT_CHANGED');
    if (!currentActor(this.k, s, row.body.proposed_by, 'action.propose', row.resource_id)) throw new Error('OPTIONAL_PROPOSAL_AUTHORITY_CHANGED');
    const currentQuality = quality.assertReady(scope, configuration);
    if (currentQuality.id !== row.body.quality_id || currentQuality.digest !== row.body.quality_digest) throw new Error('QUALITY_CONTEXT_CHANGED');
    if (this.source.purpose === 'try_on' && (!currentQuality.body.product_ids.includes(row.body.command.product_id) || !currentQuality.body.materials.includes(row.body.command.material))) throw new Error('PRODUCT_OR_MATERIAL_UNSUPPORTED');
    assertExecution(this.k, s, this.source.purpose === 'try_on' ? 'model.run' : 'credential.probe', row.body.control_stamp);
    if (row.expires_at <= this.k.clock() || row.body.command.retention_until !== row.expires_at || row.body.command.operation_id !== row.id || row.body.command.resource_id !== row.resource_id ||
      row.body.command.tenant_id !== s.tenant_id || row.body.command.store_id !== s.store_id || row.body.command.source_identity !== this.source.identity ||
      row.body.command.purpose !== this.source.purpose || row.body.command.consent_id !== row.consent_id || row.body.command.input_id !== consent.body.input_id ||
      row.body.command.input_sha256 !== consent.body.input_sha256 || row.body.command.product_id !== consent.body.product_id || row.body.command.material !== consent.body.material ||
      row.body.command.source_config_digest !== configuration.source.digest || contentDigest(row.body.command.configuration) !== configuration.source.digest ||
      row.body.command.geography !== configuration.source.body.geography) throw new Error('OPTIONAL_RECORD_INTEGRITY');
    return row;
  }
  #finish(scope: Scope, ref: string, result: Row, quality: OptionalQuality) {
    const row = this.#current(scope, ref, quality), command = row.body.command;
    if (result.operation_id !== ref || result.source_identity !== this.source.identity || result.purpose !== this.source.purpose || result.command_digest !== contentDigest(command) ||
      result.retention_until !== command.retention_until || typeof result.native_id !== 'string' || !result.native_id) throw new Error('OPTIONAL_SOURCE_INTEGRITY');
    let output: Row | null = null, state = 'applied', reason: string | null = null;
    try {output = quality.projectOutput(result, command);} catch (error) {
      if (!(error instanceof Error) || error.message !== 'UNSAFE_OUTPUT_REJECTED') throw error;
      state = 'rejected'; reason = error.message; deletionFor(this.k, {...row, native_id: result.native_id});
    }
    const body = {...row.body, output, reason};
    this.k.db.prepare('UPDATE commerce_optional_operations SET native_id=?,state=?,body=?,digest=? WHERE tenant_id=? AND store_id=? AND id=?')
      .run(result.native_id, state, canonical(body), contentDigest(body), row.tenant_id, row.store_id, ref);
    return this.read(scope, ref);
  }
  async dispatch(scope: Scope, ref: string, quality: OptionalQuality) {
    const row = this.#current(scope, ref, quality);
    if (row.state !== 'queued') return this.read(scope, ref);
    this.k.transaction(() => {const current = this.#current(scope, ref, quality); bodyWrite(this.k, 'commerce_optional_operations', current, current.body, 'unknown');});
    let result: Row;
    try {result = await this.source.apply(row.body.command, () => {this.#current(scope, ref, quality);});}
    catch (error) {
      const current = this.operation(scope, ref);
      if (error instanceof OptionalNoEffectError && !current.body.redacted) bodyWrite(this.k, 'commerce_optional_operations', current, {...current.body, reason: error.message}, 'blocked');
      return this.read(scope, ref);
    }
    try {return this.k.transaction(() => this.#finish(scope, ref, result, quality));}
    catch (error) {
      const current = this.operation(scope, ref);
      // The source may have committed before consent/authority changed. Retain
      // its original operation, withhold the output and queue eligible deletion.
      deletionFor(this.k, {...current, native_id: result.native_id ?? current.native_id});
      if (!current.body.redacted) bodyWrite(this.k, 'commerce_optional_operations', current, {...current.body, output: null, reason: 'FINAL_CONTEXT_CHANGED'}, 'unknown');
      return this.read(scope, ref);
    }
  }
  async reconcile(scope: Scope, ref: string, quality: OptionalQuality) {
    const row = this.operation(scope, ref, 'operation.reconcile'); assertRecoveryEgress(this.k);
    if (row.body.redacted) throw new Error('OPERATION_REDACTED');
    if (row.state !== 'unknown') return this.read(scope, ref);
    const result = await this.source.lookup(row.id);
    if (!result || result.state !== 'applied') return this.read(scope, ref);
    if (contentDigest(result.command) !== contentDigest(row.body.command)) throw new Error('OPTIONAL_SOURCE_INTEGRITY');
    return this.k.transaction(() => this.#finish(scope, ref, result.result, quality));
  }
  withdraw(scope: Scope, consentId: string) {
    return this.k.transaction(() => {
      assertRecoveryAction(this.k, 'attachment.write');
      const s = this.k.require(scope), row = optionalChecked(this.k.db.prepare('SELECT * FROM commerce_optional_consents WHERE tenant_id=? AND store_id=? AND id=?')
        .get(s.tenant_id, s.store_id, id(consentId)) as Row | undefined);
      if (row.kind !== this.source.purpose) throw new Error('PURPOSE_DENIED');
      verifiedOptionalCustomer(this.k, scope, row.resource_id); minimizeConsent(this.k, row);
      return {id: consentId, state: 'withdrawn', source_deletion: 'queued_original_identity_only', physical_erasure: false};
    });
  }
  async deleteEligible(scope: Scope) {
    const s = this.k.authorize(scope, 'privacy.manage'); optionalSourceScope(this.k, s, this.source);
    const expired = this.k.db.prepare("SELECT * FROM commerce_optional_consents WHERE tenant_id=? AND store_id=? AND kind=? AND state='granted'")
      .all(s.tenant_id, s.store_id, this.source.purpose) as Row[];
    this.k.transaction(() => {for (const row of expired) {
      const checked = optionalChecked(row);
      if (row.expires_at <= this.k.clock() || checked.body.retention_until <= this.k.clock()) minimizeConsent(this.k, row);
    }});
    const rows = this.k.db.prepare("SELECT * FROM commerce_optional_deletions WHERE tenant_id=? AND store_id=? AND source_identity=? AND state='pending' ORDER BY id LIMIT 100")
      .all(s.tenant_id, s.store_id, this.source.identity) as Row[];
    let deleted = 0;
    for (const row of rows) {
      optionalChecked(row); assertRecoveryEgress(this.k);
      const result = await this.source.delete(row.original_operation_id, () => {
        const current = this.k.authorize(scope, 'privacy.manage'); optionalSourceScope(this.k, current, this.source); assertRecoveryEgress(this.k);
        const request = optionalChecked(this.k.db.prepare('SELECT * FROM commerce_optional_deletions WHERE tenant_id=? AND store_id=? AND id=?')
          .get(s.tenant_id, s.store_id, row.id) as Row | undefined);
        if (request.state !== 'pending' || request.original_operation_id !== row.original_operation_id || request.source_identity !== this.source.identity || request.body.eligible !== true) throw new Error('DELETION_CONTEXT_CHANGED');
      });
      if (result.operation_id !== row.original_operation_id || result.state !== 'deleted') throw new Error('OPTIONAL_SOURCE_INTEGRITY');
      const body = {redacted: true, original_operation_id: row.original_operation_id, source_identity: this.source.identity, native_id: result.native_id,
        eligible: true, replay_allowed: false};
      this.k.db.prepare("UPDATE commerce_optional_deletions SET native_id=?,state='deleted',body=?,digest=? WHERE tenant_id=? AND store_id=? AND id=?")
        .run(result.native_id, canonical(body), contentDigest(body), s.tenant_id, s.store_id, row.id); deleted++;
    }
    return {deleted, batch_limit: 100, effects_replayed: 0, physical_erasure: false};
  }
}
