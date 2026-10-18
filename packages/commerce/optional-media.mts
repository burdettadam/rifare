import { exact, id, digest } from './kernel.mts';
import type { CommerceKernel, Scope, Row } from './kernel.mts';
import { canonical, contentDigest, jsonValue } from './configuration-values.mts';
import { assertRecoveryAction } from './data-guards.mts';
import { OptionalLifecycleCore, optionalChecked, optionalConfiguration, verifiedOptionalCustomer } from './optional-lifecycle-core.mts';
import { TryOnQualification } from './tryon-qualification.mts';
import { OptionalProviderFixtureSource, validateSyntheticMedia } from '../adapters/optional-provider-fixture-source.mts';

export function assertOptionalMediaGrant(origin: unknown, consent: Row | null): asserts consent is Row {
  if (origin !== 'customer_optional_upload') throw new Error('RETURN_EVIDENCE_REUSE_DENIED');
  if (!consent) throw new Error('CONSENT_REQUIRED');
}

export class OptionalMedia {
  readonly k: CommerceKernel;
  readonly core: OptionalLifecycleCore;
  readonly qualification: TryOnQualification;
  constructor(k: CommerceKernel, source: OptionalProviderFixtureSource, qualification?: TryOnQualification) {
    if (source.purpose !== 'try_on') throw new Error('PURPOSE_DENIED');
    if (qualification && (qualification.k !== k || qualification.source !== source)) throw new Error('QUALITY_CONTEXT_CHANGED');
    this.k = k; this.core = new OptionalLifecycleCore(k, source); this.qualification = qualification ?? new TryOnQualification(k, source);
  }
  configure(scope: Scope, input: unknown) {return this.core.configure(scope, input);}
  consent(scope: Scope, input: unknown) {return this.core.consent(scope, input);}
  upload(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['media_id', 'resource_id', 'consent_id', 'origin', 'mime', 'base64']);
    id(p.media_id); id(p.resource_id); id(p.consent_id);
    const bytes = validateSyntheticMedia(p.mime, p.base64);
    return this.k.transaction(() => {
      assertRecoveryAction(this.k, 'attachment.write');
      const verified = verifiedOptionalCustomer(this.k, scope, p.resource_id), configuration = optionalConfiguration(this.k, verified.s, this.core.source);
      let consent = this.core.currentConsent(verified.s, p.consent_id, p.resource_id, configuration, true);
      assertOptionalMediaGrant(p.origin, consent);
      if (consent.body.input_id !== p.media_id || consent.body.input_sha256 !== digest(bytes)) throw new Error('CONSENT_CONTEXT_CHANGED');
      const body = {origin: 'customer_optional_upload', purpose: 'try_on', mime: p.mime, base64: p.base64, sha256: digest(bytes),
        source_config_digest: configuration.source.digest, consent_id: p.consent_id, model_access: true, biometric: false};
      const old = this.k.db.prepare('SELECT * FROM commerce_optional_media WHERE tenant_id=? AND store_id=? AND id=?')
        .get(verified.s.tenant_id, verified.s.store_id, p.media_id) as Row | undefined;
      if (old) {
        if (old.state !== 'available') throw new Error('MEDIA_UNAVAILABLE');
        if (old.resource_id !== p.resource_id || optionalChecked(old).digest !== contentDigest(body)) throw new Error('MEDIA_CONFLICT');
      } else this.k.db.prepare("INSERT INTO commerce_optional_media VALUES(?,?,?,?,?,?,'available',?,?,?,?)")
        .run(verified.s.tenant_id, verified.s.store_id, p.media_id, p.resource_id, verified.subject_hash, p.consent_id,
          canonical(body), contentDigest(body), this.k.clock(), consent.body.retention_until);
      return {id: p.media_id, purpose: 'try_on', sha256: digest(bytes), expires_at: consent.body.retention_until, state: 'available', synthetic_only: true};
    });
  }
  queue(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['operation_id', 'resource_id', 'media_id']);
    const s = this.k.authorize(scope, 'action.propose', id(p.resource_id)); this.k.get(scope, p.resource_id);
    const row = optionalChecked(this.k.db.prepare('SELECT * FROM commerce_optional_media WHERE tenant_id=? AND store_id=? AND id=?')
      .get(s.tenant_id, s.store_id, id(p.media_id)) as Row | undefined, 'MEDIA_UNAVAILABLE');
    if (row.resource_id !== p.resource_id) throw new Error('NOT_FOUND');
    if (row.state !== 'available' || row.expires_at <= this.k.clock() || row.body.redacted) throw new Error('MEDIA_UNAVAILABLE');
    const bytes = validateSyntheticMedia(row.body.mime, row.body.base64);
    if (row.body.origin !== 'customer_optional_upload' || digest(bytes) !== row.body.sha256) throw new Error('OPTIONAL_RECORD_INTEGRITY');
    const configuration = optionalConfiguration(this.k, s, this.core.source), consent = this.core.currentConsent(s, row.consent_id, p.resource_id, configuration)!;
    if (row.body.source_config_digest !== configuration.source.digest || row.expires_at !== consent.body.retention_until) throw new Error('CONSENT_CONTEXT_CHANGED');
    return this.core.queue(scope, {operation_id: p.operation_id, resource_id: p.resource_id, consent_id: row.consent_id, input_id: row.id,
      input_sha256: row.body.sha256, input: {mime: row.body.mime, base64: row.body.base64}, product_id: consent.body.product_id,
      material: consent.body.material, geography: configuration.source.body.geography}, this.qualification);
  }
  dispatch(scope: Scope, ref: string) {return this.core.dispatch(scope, ref, this.qualification);}
  reconcile(scope: Scope, ref: string) {return this.core.reconcile(scope, ref, this.qualification);}
  read(scope: Scope, ref: string) {return this.core.read(scope, ref);}
  withdraw(scope: Scope, ref: string) {return this.core.withdraw(scope, ref);}
  deleteEligible(scope: Scope) {return this.core.deleteEligible(scope);}
}
