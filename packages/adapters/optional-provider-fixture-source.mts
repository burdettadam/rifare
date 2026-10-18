import type { DatabaseSync } from 'node:sqlite';
import { exact, id, integer, digest } from '../commerce/kernel.mts';
import { canonical, contentDigest, jsonValue, stringSet } from '../commerce/configuration-values.mts';
import type { Row } from '../commerce/kernel.mts';

export const OPTIONAL_PURPOSES = ['try_on', 'identity_resolution'] as const;
export type OptionalPurpose = typeof OPTIONAL_PURPOSES[number];
export class OptionalNoEffectError extends Error {
  readonly effect_not_started = true;
  constructor(reason: string) {super(reason);}
}
function hash(value: unknown) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('OPTIONAL_INPUT_INVALID');
  return value;
}
function checked(row: Row | undefined, error = 'OPTIONAL_SOURCE_NOT_FOUND') {
  if (!row) throw new Error(error);
  const body = jsonValue(JSON.parse(row.body));
  if (contentDigest(body) !== row.digest) throw new Error('OPTIONAL_SOURCE_INTEGRITY');
  return body;
}
export function validateSyntheticMedia(mime: unknown, base64: unknown) {
  if (mime !== 'application/x-rifare-synthetic-media' || typeof base64 !== 'string' || base64.length > 344) throw new Error('SYNTHETIC_MEDIA_REQUIRED');
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.toString('base64') !== base64 || !/^rifare-fixture-media:v1:[A-Za-z0-9_-]{1,80}$/.test(bytes.toString('utf8'))) throw new Error('SYNTHETIC_MEDIA_REQUIRED');
  return bytes;
}
export function validateSyntheticIdentifier(input: unknown) {
  const p = exact(jsonValue(input), ['type', 'value']);
  if (p.type !== 'synthetic_customer_token' || typeof p.value !== 'string' || !/^fixture-[A-Za-z0-9_-]{1,72}$/.test(p.value)) throw new Error('SYNTHETIC_IDENTIFIER_REQUIRED');
  return p;
}

/** Server-local, separately stored, inert source. There is no network, provider
 * SDK, credential path, default account, biometric processing or identity graph. */
export class OptionalProviderFixtureSource {
  readonly db: DatabaseSync;
  readonly identity: string;
  readonly tenant_id: string;
  readonly store_id: string;
  readonly purpose: OptionalPurpose;
  readonly clock: () => number;
  readonly calls = {apply: 0, lookup: 0, delete: 0};
  beforeEffect: (() => unknown | Promise<unknown>) | null = null;
  loseNextResponse = false;
  unsafeNextOutput = false;
  constructor(db: DatabaseSync, options: {mode: 'fixture'; identity: string; tenant_id: string; store_id: string; purpose: OptionalPurpose; clock?: () => number}) {
    if (options.mode !== 'fixture' || !OPTIONAL_PURPOSES.includes(options.purpose)) throw new Error('OPTIONAL_SOURCE_UNAVAILABLE');
    this.db = db; this.identity = id(options.identity); this.tenant_id = id(options.tenant_id); this.store_id = id(options.store_id); this.purpose = options.purpose; this.clock = options.clock ?? Date.now;
    db.exec(`CREATE TABLE IF NOT EXISTS optional_source_binding (id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS optional_source_configuration (id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS optional_source_evaluations (id TEXT PRIMARY KEY,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS optional_source_operations (operation_id TEXT PRIMARY KEY,native_id TEXT NOT NULL,state TEXT NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;`);
    const binding = {identity: this.identity, tenant_id: this.tenant_id, store_id: this.store_id, purpose: this.purpose, mode: 'fixture'};
    const old = db.prepare('SELECT * FROM optional_source_binding WHERE id=1').get() as Row | undefined;
    if (old && contentDigest(checked(old)) !== contentDigest(binding)) throw new Error('SOURCE_SCOPE_DENIED');
    if (!old) db.prepare('INSERT INTO optional_source_binding VALUES(1,?,?)').run(canonical(binding), contentDigest(binding));
  }
  configure(input: unknown) {
    const p = exact(jsonValue(input), ['revision', 'provider_id', 'account_id', 'api_version', 'model_id', 'model_version', 'settings', 'geography', 'max_retention_ms',
      'vision', 'product_ids', 'materials', 'provenance', 'opt_out', 'deletion_supported', 'expires_at']);
    for (const field of ['provider_id', 'account_id', 'api_version', 'model_id', 'model_version']) id(p[field]);
    integer(p.revision, 1); integer(p.max_retention_ms, 1); integer(p.expires_at);
    const settings = exact(p.settings, ['render', 'safety', 'biometric']);
    if (!['outline_v1', 'outline_v2'].includes(settings.render) || settings.safety !== 'strict' || settings.biometric !== false || p.geography !== 'US_TEST' ||
      p.max_retention_ms > 3600000 || p.expires_at <= this.clock() || p.expires_at > this.clock() + 86400000 || typeof p.vision !== 'boolean' ||
      p.provenance !== 'synthetic_authorized_fixture' || p.opt_out !== true || p.deletion_supported !== true) throw new Error('OPTIONAL_SOURCE_CONFIGURATION_INVALID');
    const product_ids = stringSet(p.product_ids, 'product_ids'), materials = stringSet(p.materials, 'materials');
    if (this.purpose === 'identity_resolution' && (product_ids.length || materials.length || p.vision)) throw new Error('OPTIONAL_SOURCE_CONFIGURATION_INVALID');
    const body = {...p, settings, product_ids, materials, source_identity: this.identity, tenant_id: this.tenant_id, store_id: this.store_id, purpose: this.purpose,
      mode: 'fixture', external_qualified: false, cross_merchant_join: false};
    const old = this.db.prepare('SELECT * FROM optional_source_configuration WHERE id=1').get() as Row | undefined;
    if (old && p.revision <= checked(old).revision) throw new Error('SOURCE_CONFIGURATION_CHANGED');
    this.db.prepare('INSERT INTO optional_source_configuration VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,digest=excluded.digest').run(canonical(body), contentDigest(body));
    return this.configuration();
  }
  configuration() {
    const body = checked(this.db.prepare('SELECT * FROM optional_source_configuration WHERE id=1').get() as Row | undefined, 'OPTIONAL_DISABLED');
    return {body, digest: contentDigest(body)};
  }
  recordEvaluation(input: unknown) {
    const p = exact(jsonValue(input), ['id', 'dataset_id', 'dataset_sha256', 'vision', 'safe', 'product_ids', 'materials', 'purpose', 'provenance', 'geography',
      'opt_out', 'deletion_supported', 'observed_at', 'expires_at']);
    id(p.id); id(p.dataset_id); hash(p.dataset_sha256); integer(p.observed_at); integer(p.expires_at);
    if (p.purpose !== this.purpose || p.provenance !== 'synthetic_authorized_fixture' || p.geography !== 'US_TEST' || p.opt_out !== true || p.deletion_supported !== true ||
      typeof p.vision !== 'boolean' || typeof p.safe !== 'boolean' || p.observed_at > this.clock() || p.expires_at <= this.clock() || p.expires_at > this.clock() + 86400000) throw new Error('OPTIONAL_EVALUATION_INVALID');
    const configuration = this.configuration();
    const body = {...p, product_ids: stringSet(p.product_ids, 'product_ids'), materials: stringSet(p.materials, 'materials'),
      source_identity: this.identity, tenant_id: this.tenant_id, store_id: this.store_id, source_configuration_digest: configuration.digest,
      generated_output_only: true, physical_fit_evaluated: false, real_partner_agreement: false, qualification: 'synthetic_local_preparation_only'};
    const old = this.db.prepare('SELECT * FROM optional_source_evaluations WHERE id=?').get(p.id) as Row | undefined;
    if (old) {if (contentDigest(checked(old)) !== contentDigest(body)) throw new Error('OPTIONAL_EVALUATION_CONFLICT'); return checked(old);}
    this.db.prepare('INSERT INTO optional_source_evaluations VALUES(?,?,?)').run(p.id, canonical(body), contentDigest(body));
    return body;
  }
  evaluation(ref: string) {return checked(this.db.prepare('SELECT * FROM optional_source_evaluations WHERE id=?').get(id(ref)) as Row | undefined);}
  #command(input: unknown) {
    const c = exact(jsonValue(input), ['operation_id', 'resource_id', 'tenant_id', 'store_id', 'source_identity', 'purpose', 'source_config_digest', 'configuration',
      'consent_id', 'input_id', 'input_sha256', 'input', 'product_id', 'material', 'retention_until', 'geography']);
    for (const field of ['operation_id', 'resource_id', 'tenant_id', 'store_id', 'source_identity', 'consent_id', 'input_id']) id(c[field]);
    hash(c.source_config_digest); hash(c.input_sha256); integer(c.retention_until);
    if (c.source_identity !== this.identity || c.tenant_id !== this.tenant_id || c.store_id !== this.store_id || c.purpose !== this.purpose) throw new Error('SOURCE_SCOPE_DENIED');
    if (contentDigest(c.configuration) !== c.source_config_digest || this.configuration().digest !== c.source_config_digest) throw new Error('SOURCE_CONFIGURATION_CHANGED');
    if (c.retention_until <= this.clock() || c.retention_until > this.clock() + c.configuration.max_retention_ms || c.geography !== c.configuration.geography) throw new Error('OPTIONAL_RETENTION_OR_GEOGRAPHY_DENIED');
    if (this.purpose === 'try_on') {
      const media = exact(c.input, ['mime', 'base64']), bytes = validateSyntheticMedia(media.mime, media.base64);
      if (digest(bytes) !== c.input_sha256 || !c.configuration.vision || !c.configuration.product_ids.includes(c.product_id) || !c.configuration.materials.includes(c.material)) throw new Error('OPTIONAL_MEDIA_UNQUALIFIED');
    } else if (contentDigest(validateSyntheticIdentifier(c.input)) !== c.input_sha256 || c.product_id !== null || c.material !== null) throw new Error('OPTIONAL_IDENTIFIER_INVALID');
    return c;
  }
  async apply(input: unknown, finalGuard: () => void) {
    this.calls.apply++;
    let c: Row;
    try {
      c = this.#command(input);
      if (this.beforeEffect) await this.beforeEffect();
      finalGuard(); c = this.#command(input);
    } catch (error) {throw new OptionalNoEffectError(error instanceof Error ? error.message : 'OPTIONAL_FINAL_CHECK_FAILED');}
    const old = this.db.prepare('SELECT * FROM optional_source_operations WHERE operation_id=?').get(c.operation_id) as Row | undefined;
    if (old) {
      const row = checked(old);
      if (row.state === 'deleted') throw new OptionalNoEffectError('OPTIONAL_SOURCE_DELETED');
      if (row.command_digest !== contentDigest(c)) throw new OptionalNoEffectError('OPTIONAL_OPERATION_CONFLICT');
      return row.result;
    }
    const native_id = 'optional_native_' + digest(this.identity + ':' + c.operation_id).slice(0, 32);
    const unsafe = this.unsafeNextOutput; this.unsafeNextOutput = false;
    const result = {native_id, operation_id: c.operation_id, source_identity: this.identity, purpose: this.purpose, command_digest: contentDigest(c),
      generated: this.purpose === 'try_on', safe: !unsafe, product_id: c.product_id, material: c.material,
      result_ref: 'fixture_result_' + digest(native_id).slice(0, 24), confidence: this.purpose === 'identity_resolution' ? 0.5 : null,
      retention_until: c.retention_until, observed_at: this.clock(), external_qualified: false};
    const body = {operation_id: c.operation_id, native_id, state: 'applied', command: c, command_digest: contentDigest(c), result};
    this.db.prepare('INSERT INTO optional_source_operations VALUES(?,?,?,?,?)').run(c.operation_id, native_id, 'applied', canonical(body), contentDigest(body));
    if (this.loseNextResponse) {this.loseNextResponse = false; throw new Error('OPTIONAL_RESPONSE_LOST');}
    return result;
  }
  async lookup(operationId: string) {
    this.calls.lookup++;
    const row = this.db.prepare('SELECT * FROM optional_source_operations WHERE operation_id=?').get(id(operationId)) as Row | undefined;
    return row ? checked(row) : null;
  }
  async delete(operationId: string, finalGuard: () => void) {
    this.calls.delete++; id(operationId); finalGuard();
    const old = this.db.prepare('SELECT * FROM optional_source_operations WHERE operation_id=?').get(operationId) as Row | undefined;
    const previous = old ? checked(old) : null;
    const native_id = previous?.native_id ?? 'optional_native_' + digest(this.identity + ':' + operationId).slice(0, 32);
    const body = {operation_id: operationId, native_id, state: 'deleted', command: null, result: null, replay_allowed: false};
    this.db.prepare('INSERT INTO optional_source_operations VALUES(?,?,?,?,?) ON CONFLICT(operation_id) DO UPDATE SET state=excluded.state,body=excluded.body,digest=excluded.digest')
      .run(operationId, native_id, 'deleted', canonical(body), contentDigest(body));
    return {operation_id: operationId, native_id, state: 'deleted', qualification: 'synthetic_local_preparation_only', physical_erasure: false};
  }
  ledger() {return (this.db.prepare('SELECT * FROM optional_source_operations ORDER BY operation_id').all() as Row[]).map(row => checked(row));}
}
