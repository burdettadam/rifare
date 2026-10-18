import { exact, id, integer } from './kernel.mts';
import type { CommerceKernel, Scope, Row } from './kernel.mts';
import { canonical, contentDigest, jsonValue } from './configuration-values.mts';
import { optionalConfiguration, optionalChecked, optionalSourceScope, revokeOptionalQuality, OPTIONAL_QUALIFICATION } from './optional-lifecycle-core.mts';
import { permissionDecision } from './authorization.mts';
import { OptionalProviderFixtureSource } from '../adapters/optional-provider-fixture-source.mts';

/** Intake of original synthetic source observations. This record is deliberately
 * incapable of representing a real evaluation, approved agreement or fit proof. */
export class TryOnQualification {
  readonly k: CommerceKernel;
  readonly source: OptionalProviderFixtureSource;
  constructor(k: CommerceKernel, source: OptionalProviderFixtureSource) {this.k = k; this.source = source;}
  record(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['record_id', 'evaluation_id', 'expires_at']); id(p.record_id); id(p.evaluation_id); integer(p.expires_at);
    return this.k.transaction(() => {
      const s = this.k.authorize(scope, 'action.approve'), configuration = optionalConfiguration(this.k, s, this.source);
      if (s.actor_id === configuration.body.configured_by) throw new Error('INDEPENDENT_OPTIONAL_REVIEW_REQUIRED');
      const evaluation = this.source.evaluation(p.evaluation_id);
      if (evaluation.source_identity !== this.source.identity || evaluation.tenant_id !== s.tenant_id || evaluation.store_id !== s.store_id ||
        evaluation.source_configuration_digest !== configuration.source.digest || evaluation.purpose !== this.source.purpose) throw new Error('QUALITY_CONTEXT_CHANGED');
      if (this.source.purpose === 'try_on' && (!evaluation.vision || !configuration.source.body.vision)) throw new Error('VISION_MODEL_REQUIRED');
      if (!evaluation.safe || evaluation.provenance !== 'synthetic_authorized_fixture' || evaluation.geography !== configuration.source.body.geography ||
        evaluation.opt_out !== true || evaluation.deletion_supported !== true || evaluation.real_partner_agreement !== false || evaluation.physical_fit_evaluated !== false ||
        evaluation.product_ids.some((product: string) => !configuration.source.body.product_ids.includes(product)) ||
        evaluation.materials.some((material: string) => !configuration.source.body.materials.includes(material)) ||
        this.source.purpose === 'try_on' && (!evaluation.product_ids.length || !evaluation.materials.length)) throw new Error('OPTIONAL_EVALUATION_UNQUALIFIED');
      if (p.expires_at <= this.k.clock() || p.expires_at > evaluation.expires_at || p.expires_at > configuration.expires_at || evaluation.observed_at > this.k.clock()) throw new Error('QUALITY_EXPIRED');
      const body = {evaluation_id: p.evaluation_id, evaluation_digest: contentDigest(evaluation), dataset_id: evaluation.dataset_id, dataset_sha256: evaluation.dataset_sha256,
        source_config_digest: configuration.source.digest, source_identity: this.source.identity, provider_id: configuration.source.body.provider_id,
        account_id: configuration.source.body.account_id, api_version: configuration.source.body.api_version, model_id: configuration.source.body.model_id,
        model_version: configuration.source.body.model_version, settings_digest: contentDigest(configuration.source.body.settings), purpose: this.source.purpose,
        product_ids: evaluation.product_ids, materials: evaluation.materials, geography: evaluation.geography, provenance: evaluation.provenance,
        opt_out: true, deletion_supported: true, reviewed_by: s.actor_id, reviewed_at: this.k.clock(), external_qualified: false, real_partner_agreement: false,
        qualification: OPTIONAL_QUALIFICATION};
      const old = this.k.db.prepare('SELECT * FROM commerce_optional_quality WHERE tenant_id=? AND store_id=? AND id=?')
        .get(s.tenant_id, s.store_id, p.record_id) as Row | undefined;
      if (old) throw new Error('QUALITY_RECORD_IMMUTABLE');
      this.k.db.prepare("INSERT INTO commerce_optional_quality VALUES(?,?,?,?,?,'active',?,?,?)")
        .run(s.tenant_id, s.store_id, p.record_id, this.source.purpose, configuration.source.digest, canonical(body), contentDigest(body), p.expires_at);
      return {id: p.record_id, state: 'active', qualification: OPTIONAL_QUALIFICATION, external_qualified: false, real_partner_agreement: false};
    });
  }
  assertReady(scope: Scope, supplied?: Row) {
    const s = this.k.authorize(scope, 'capability.read'); optionalSourceScope(this.k, s, this.source);
    const configuration = optionalConfiguration(this.k, s, this.source);
    if (supplied && (supplied.digest !== configuration.digest || supplied.revision !== configuration.revision || supplied.source.digest !== configuration.source.digest)) throw new Error('QUALITY_CONTEXT_CHANGED');
    const row = optionalChecked(this.k.db.prepare("SELECT * FROM commerce_optional_quality WHERE tenant_id=? AND store_id=? AND kind=? AND configuration_digest=? AND state='active' ORDER BY rowid DESC LIMIT 1")
      .get(s.tenant_id, s.store_id, this.source.purpose, configuration.source.digest) as Row | undefined, 'QUALITY_REQUIRED');
    if (row.expires_at <= this.k.clock()) throw new Error('QUALITY_EXPIRED');
    const reviewer = this.k.db.prepare('SELECT role FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND active=1')
      .get(s.tenant_id, s.store_id, row.body.reviewed_by) as Row | undefined;
    if (!reviewer || row.body.reviewed_by === configuration.body.configured_by || !permissionDecision(this.k.db, {...s, actor_id: row.body.reviewed_by, role: reviewer.role}, 'action.approve').allowed) throw new Error('QUALITY_AUTHORITY_CHANGED');
    const evaluation = this.source.evaluation(row.body.evaluation_id);
    if (contentDigest(evaluation) !== row.body.evaluation_digest || evaluation.expires_at <= this.k.clock() || row.body.source_config_digest !== configuration.source.digest ||
      row.body.settings_digest !== contentDigest(configuration.source.body.settings) || evaluation.source_configuration_digest !== configuration.source.digest) throw new Error('QUALITY_CONTEXT_CHANGED');
    return row;
  }
  revoke(scope: Scope, ref: string) {
    return this.k.transaction(() => {
      const s = this.k.authorize(scope, 'action.configure'); optionalSourceScope(this.k, s, this.source);
      const result = this.k.db.prepare("UPDATE commerce_optional_quality SET state='revoked' WHERE tenant_id=? AND store_id=? AND id=? AND kind=?")
        .run(s.tenant_id, s.store_id, id(ref), this.source.purpose);
      if (!result.changes) throw new Error('NOT_FOUND');
      revokeOptionalQuality(this.k, s.tenant_id, s.store_id, ref);
      return {id: ref, state: 'revoked', processing_authorized: false, source_deletion: 'queued_original_identity_only'};
    });
  }
  projectOutput(input: Row, command: Row) {
    const result = exact(jsonValue(input), ['native_id', 'operation_id', 'source_identity', 'purpose', 'command_digest', 'generated', 'safe', 'product_id', 'material',
      'result_ref', 'confidence', 'retention_until', 'observed_at', 'external_qualified']);
    id(result.result_ref); id(result.native_id);
    if (result.safe !== true || result.external_qualified !== false || result.purpose !== command.purpose || result.operation_id !== command.operation_id ||
      result.source_identity !== command.source_identity || result.command_digest !== contentDigest(command) || result.retention_until !== command.retention_until ||
      result.retention_until <= this.k.clock() || result.observed_at > this.k.clock() || result.product_id !== command.product_id || result.material !== command.material) throw new Error('UNSAFE_OUTPUT_REJECTED');
    if (this.source.purpose === 'try_on') {
      if (result.generated !== true || !command.configuration.vision || !command.configuration.product_ids.includes(command.product_id) ||
        !command.configuration.materials.includes(command.material)) throw new Error('UNSAFE_OUTPUT_REJECTED');
      return {kind: 'synthetic_generated_preview', generated: true, result_ref: result.result_ref, product_id: command.product_id, material: command.material,
        source_identity: command.source_identity, purpose: command.purpose, model_id: command.configuration.model_id, model_version: command.configuration.model_version,
        settings_digest: contentDigest(command.configuration.settings), retention_until: command.retention_until, fit_guarantee: false,
        return_policy_change: false, notice: 'Generated synthetic preview. It does not establish physical fit or change return policy.', external_qualified: false};
    }
    if (result.generated !== false || result.confidence !== 0.5 || command.configuration.provenance !== 'synthetic_authorized_fixture') throw new Error('UNSAFE_OUTPUT_REJECTED');
    return {kind: 'synthetic_identity_observation', result_ref: result.result_ref, source_identity: command.source_identity, purpose: command.purpose,
      provider_id: command.configuration.provider_id, account_id: command.configuration.account_id, api_version: command.configuration.api_version,
      geography: command.geography, provenance: command.configuration.provenance, confidence: result.confidence,
      confidence_limitation: 'Synthetic fixture result; no verified real-world identity.', retention_until: command.retention_until,
      cross_merchant_join: false, external_qualified: false, real_partner_agreement: false};
  }
}
