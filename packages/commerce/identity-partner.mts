import { exact, id } from './kernel.mts';
import type { CommerceKernel, Scope } from './kernel.mts';
import { contentDigest, jsonValue } from './configuration-values.mts';
import { OptionalLifecycleCore } from './optional-lifecycle-core.mts';
import { TryOnQualification } from './tryon-qualification.mts';
import { OptionalProviderFixtureSource, validateSyntheticIdentifier } from '../adapters/optional-provider-fixture-source.mts';

/** Optional partner preparation uses exactly one scoped source. It has no
 * provider fallback, local customer graph, cross-merchant resolver or live API. */
export class IdentityPartner {
  readonly k: CommerceKernel;
  readonly core: OptionalLifecycleCore;
  readonly qualification: TryOnQualification;
  constructor(k: CommerceKernel, source: OptionalProviderFixtureSource) {
    if (source.purpose !== 'identity_resolution') throw new Error('PURPOSE_DENIED');
    this.k = k; this.core = new OptionalLifecycleCore(k, source); this.qualification = new TryOnQualification(k, source);
  }
  configure(scope: Scope, input: unknown) {return this.core.configure(scope, input);}
  consent(scope: Scope, input: unknown) {return this.core.consent(scope, input);}
  recordReadiness(scope: Scope, input: unknown) {return this.qualification.record(scope, input);}
  revokeReadiness(scope: Scope, ref: string) {return this.qualification.revoke(scope, ref);}
  queue(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['operation_id', 'resource_id', 'consent_id', 'input_id', 'identifier', 'geography', 'cross_merchant_identifiers']);
    if (!Array.isArray(p.cross_merchant_identifiers) || p.cross_merchant_identifiers.length > 20) throw new Error('OPTIONAL_INPUT_INVALID');
    if (p.cross_merchant_identifiers.length) throw new Error('CROSS_MERCHANT_JOIN_DENIED');
    const identifier = validateSyntheticIdentifier(p.identifier); id(p.resource_id); id(p.input_id);
    return this.core.queue(scope, {operation_id: p.operation_id, resource_id: p.resource_id, consent_id: p.consent_id, input_id: p.input_id,
      input: identifier, input_sha256: contentDigest(identifier), product_id: null, material: null, geography: p.geography}, this.qualification);
  }
  dispatch(scope: Scope, ref: string) {return this.core.dispatch(scope, ref, this.qualification);}
  reconcile(scope: Scope, ref: string) {return this.core.reconcile(scope, ref, this.qualification);}
  read(scope: Scope, ref: string) {return this.core.read(scope, ref);}
  withdraw(scope: Scope, ref: string) {return this.core.withdraw(scope, ref);}
  deleteEligible(scope: Scope) {return this.core.deleteEligible(scope);}
}
