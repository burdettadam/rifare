import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { commerceFixture } from './commerce-helpers.mts';
import { CustomerAccess } from '../../packages/commerce/customer-access.mts';
import { contentDigest } from '../../packages/commerce/configuration-values.mts';
import { digest } from '../../packages/commerce/kernel.mts';
import { OptionalProviderFixtureSource } from '../../packages/adapters/optional-provider-fixture-source.mts';
import { OptionalMedia } from '../../packages/commerce/optional-media.mts';
import { IdentityPartner } from '../../packages/commerce/identity-partner.mts';
import type { Row } from '../../packages/commerce/kernel.mts';

export const optionalExpected = JSON.parse(readFileSync(new URL('../fixtures/growth-optional/expected.v1.json', import.meta.url), 'utf8'));

export function optionalFixture() {
  const f = commerceFixture();
  f.kernel.provisionMember(f.a.tenant, f.a.store, 'optional-owner', 'owner');
  f.kernel.provisionMember(f.a.tenant, f.a.store, 'optional-reviewer', 'reviewer');
  const owner = f.kernel.authenticate(f.kernel.issueSession(f.a.tenant, f.a.store, 'optional-owner'));
  const reviewer = f.kernel.authenticate(f.kernel.issueSession(f.a.tenant, f.a.store, 'optional-reviewer'));
  const resource = f.seed(f.a.scope);
  f.kernel.ingest(f.a.scope, {kind: 'customer', source_system: 'synthetic', external_id: 'C-1001', source_version: 1,
    source_updated_at: f.now(), customer_id: null, payload: {email: 'optional-customer@example.invalid'}});
  f.kernel.ingest(f.b.scope, {kind: 'customer', source_system: 'synthetic', external_id: 'PRIVATE-OTHER-MERCHANT', source_version: 1,
    source_updated_at: f.now(), customer_id: null, payload: {email: 'private-other@example.invalid'}});
  const proofs: Row[] = [], access = new CustomerAccess(f.kernel, p => proofs.push(p));
  const challenge = access.request({store_id: f.a.store, order_number: 'ORD-1001', email: 'optional-customer@example.invalid'}, '127.0.0.29');
  const verified = access.complete({store_id: f.a.store, challenge_id: challenge.challenge_id, proof: proofs[0].proof});
  const customer = f.kernel.authenticate(verified.token);
  const mediaDb = new DatabaseSync(join(f.directory, 'optional-media-source.sqlite'));
  const identityDb = new DatabaseSync(join(f.directory, 'optional-identity-source.sqlite'));
  const mediaSource = new OptionalProviderFixtureSource(mediaDb, {mode: 'fixture', identity: 'tryon-fixture', purpose: 'try_on', tenant_id: f.a.tenant, store_id: f.a.store, clock: f.now});
  const identitySource = new OptionalProviderFixtureSource(identityDb, {mode: 'fixture', identity: 'identity-fixture', purpose: 'identity_resolution', tenant_id: f.a.tenant, store_id: f.a.store, clock: f.now});
  const media = new OptionalMedia(f.kernel, mediaSource), identity = new IdentityPartner(f.kernel, identitySource);
  const configuration = (purpose = 'try_on', patch: Row = {}) => ({revision: 1, provider_id: 'optional-fixture-provider', account_id: 'optional-fixture-account',
    api_version: 'fixture-v1', model_id: purpose === 'try_on' ? 'fixture-vision' : 'fixture-identity', model_version: 'v1',
    settings: {render: 'outline_v1', safety: 'strict', biometric: false}, geography: 'US_TEST', max_retention_ms: 120000,
    vision: purpose === 'try_on', product_ids: purpose === 'try_on' ? ['shirt-small'] : [], materials: purpose === 'try_on' ? ['cotton'] : [],
    provenance: 'synthetic_authorized_fixture', opt_out: true, deletion_supported: true, expires_at: f.now() + 240000, ...patch});
  const evaluation = (purpose = 'try_on', patch: Row = {}) => ({id: purpose === 'try_on' ? 'media-evaluation' : 'identity-evaluation',
    dataset_id: 'optional-fixture-dataset', dataset_sha256: digest('independently-authored-optional-fixture-v1'),
    vision: purpose === 'try_on', safe: true, product_ids: purpose === 'try_on' ? ['shirt-small'] : [], materials: purpose === 'try_on' ? ['cotton'] : [],
    purpose, provenance: 'synthetic_authorized_fixture', geography: 'US_TEST', opt_out: true, deletion_supported: true,
    observed_at: f.now(), expires_at: f.now() + 120000, ...patch});
  const enable = (which: 'media' | 'identity' = 'media', patch: Row = {}) => {
    const purpose = which === 'media' ? 'try_on' : 'identity_resolution', source = which === 'media' ? mediaSource : identitySource, service = which === 'media' ? media : identity;
    source.configure(configuration(purpose, patch));
    service.configure(owner, {expected_revision: 0, enabled: true, expires_at: f.now() + 120000});
    source.recordEvaluation(evaluation(purpose));
    if (which === 'media') media.qualification.record(reviewer, {record_id: 'media-quality', evaluation_id: 'media-evaluation', expires_at: f.now() + 100000});
    else identity.recordReadiness(reviewer, {record_id: 'identity-readiness', evaluation_id: 'identity-evaluation', expires_at: f.now() + 100000});
  };
  const bytes = Buffer.from(optionalExpected.media_text);
  const identifier = {type: 'synthetic_customer_token', value: 'fixture-subject-one'};
  const consentInput = (which: 'media' | 'identity' = 'media', patch: Row = {}) => ({consent_id: which + '-consent', resource_id: resource.id,
    purpose: which === 'media' ? 'try_on' : 'identity_resolution', input_id: which === 'media' ? 'media-one' : 'identifier-one',
    input_sha256: which === 'media' ? digest(bytes) : contentDigest(identifier),
    source_config_digest: (which === 'media' ? mediaSource : identitySource).configuration().digest,
    product_id: which === 'media' ? 'shirt-small' : null, material: which === 'media' ? 'cotton' : null,
    retention_until: f.now() + 60000, expires_at: f.now() + 90000,
    acknowledgements: ['purpose_specific', 'destination_bound', 'retention_bound', 'non_biometric', 'withdrawable', 'no_fit_or_policy_guarantee'], ...patch});
  const uploadInput = (patch: Row = {}) => ({media_id: 'media-one', resource_id: resource.id, consent_id: 'media-consent',
    origin: 'customer_optional_upload', mime: optionalExpected.mime, base64: bytes.toString('base64'), ...patch});
  const mediaReady = () => {enable(); media.consent(customer, consentInput()); return media.upload(customer, uploadInput());};
  const identityReady = () => {enable('identity'); return identity.consent(customer, consentInput('identity'));};
  const identityInput = (patch: Row = {}) => ({operation_id: 'identity-operation', resource_id: resource.id, consent_id: 'identity-consent',
    input_id: 'identifier-one', identifier, geography: 'US_TEST', cross_merchant_identifiers: [], ...patch});
  const mediaQueue = (operation_id = 'media-operation') => media.queue(f.a.scope, {operation_id, resource_id: resource.id, media_id: 'media-one'});
  return {...f, owner, reviewer, customer, resource_id: resource.id, mediaDb, identityDb, mediaSource, identitySource, media, identity,
    configuration, evaluation, enable, bytes, identifier, consentInput, uploadInput, mediaReady, identityReady, identityInput, mediaQueue,
    cleanup() {mediaDb.close(); identityDb.close(); f.cleanup();}};
}

export async function usingOptional(run: (f: ReturnType<typeof optionalFixture>) => unknown) {
  const f = optionalFixture();
  try {return await run(f);} finally {f.cleanup();}
}

/** All six canonical tables and both separate source stores contain only invented data.
 * Root's retained privacy case owns export/erasure/restore assertions. No suite runs here. */
export async function populateOptionalPrivacy(f: ReturnType<typeof optionalFixture>) {
  f.mediaReady(); f.identityReady(); f.mediaQueue();
  f.mediaSource.loseNextResponse = true;
  await f.media.dispatch(f.a.scope, 'media-operation');
  f.identity.queue(f.a.scope, f.identityInput());
  await f.identity.dispatch(f.a.scope, 'identity-operation');
  f.identity.withdraw(f.customer, 'identity-consent');
  return {resource_id: f.resource_id, customer_id: 'C-1001', unknown_operation_id: 'media-operation', deletion_operation_id: 'identity-operation',
    tables: ['commerce_optional_configurations', 'commerce_optional_consents', 'commerce_optional_media', 'commerce_optional_quality', 'commerce_optional_operations', 'commerce_optional_deletions']};
}
