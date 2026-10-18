import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { OptionalMedia } from '../../packages/commerce/optional-media.mts';
import { IdentityPartner } from '../../packages/commerce/identity-partner.mts';
import { TryOnQualification } from '../../packages/commerce/tryon-qualification.mts';
import { Permissions } from '../../packages/commerce/authorization.mts';
import { ExecutionStops } from '../../packages/commerce/execution-stops.mts';
import { optionalExpected, usingOptional } from './growth-optional-helpers.mts';
import type { Row } from '../../packages/commerce/kernel.mts';

async function changedModule(path: string, before: string, after: string, run: (module: Row) => Promise<void>) {
  const url = new URL(path, import.meta.url), source = readFileSync(url, 'utf8');
  assert.equal(source.split(before).length, 2, 'The named fault must change its actual product guard exactly once');
  const changed = source.replace(before, after).replace(/from '([^']+)'/g, (match, specifier) => specifier.startsWith('.') ? "from '" + new URL(specifier, url).href + "'" : match);
  const directory = mkdtempSync(join(tmpdir(), 'rifare-optional-fault-'));
  try {const file = join(directory, 'changed.mts'); writeFileSync(file, changed); await run(await import(pathToFileURL(file).href));}
  finally {rmSync(directory, {recursive: true, force: true});}
}

test('CASE-M09-G12-01', () => usingOptional(async f => {
  const media = f.mediaReady();
  assert.equal(media.expires_at, f.now() + 60000); assert.equal(media.purpose, 'try_on');
  f.mediaQueue(); const result = await f.media.dispatch(f.a.scope, 'media-operation');
  assert.equal(result.state, 'applied'); assert.equal(f.mediaSource.ledger().length, 1); assert.equal(f.identitySource.ledger().length, 0);
  const native = f.mediaSource.ledger()[0];
  assert.equal(native.command.source_identity, 'tryon-fixture'); assert.equal(native.command.retention_until, media.expires_at);
  assert.equal(native.command.input_sha256, media.sha256); assert.equal(native.command.purpose, 'try_on');
  assert.equal(result.qualification, optionalExpected.qualification); assert.equal(result.external_qualified, false);
}));

test('CASE-M09-G12-02', () => usingOptional(async f => {
  assert.throws(() => f.media.upload(f.customer, f.uploadInput()), /OPTIONAL_DISABLED|CONSENT_REQUIRED/);
  f.enable(); assert.throws(() => f.media.upload(f.customer, f.uploadInput()), /CONSENT_REQUIRED/);
  assert.throws(() => f.media.consent(f.a.scope, f.consentInput()), /VERIFIED_CUSTOMER_REQUIRED/);
  assert.throws(() => f.media.consent(f.customer, f.consentInput('media', {source_config_digest: 'a'.repeat(64)})), /SOURCE_CONFIGURATION_CHANGED/);
  f.media.consent(f.customer, f.consentInput());
  assert.throws(() => f.media.upload(f.customer, f.uploadInput({base64: Buffer.from('<svg onload="grant authority">').toString('base64')})), /SYNTHETIC_MEDIA_REQUIRED/);
  f.media.upload(f.customer, f.uploadInput()); f.mediaQueue(); f.advance(60001);
  await assert.rejects(f.media.dispatch(f.a.scope, 'media-operation'), /CONSENT_EXPIRED/);
  assert.throws(() => f.mediaQueue(), /MEDIA_UNAVAILABLE|CONSENT_EXPIRED/);
  assert.equal(f.mediaSource.ledger().length, 0);
}));

test('CASE-M09-G12-03', () => usingOptional(async f => {
  f.mediaReady(); f.mediaQueue();
  f.mediaSource.beforeEffect = () => f.media.withdraw(f.customer, 'media-consent');
  const result = await f.media.dispatch(f.a.scope, 'media-operation');
  assert.ok(['blocked', 'cancelled', 'unknown'].includes(result.state));
  assert.equal(f.mediaSource.ledger().filter((r: Row) => r.state === 'applied').length, 0);
  assert.throws(() => f.mediaQueue('different-request'), /MEDIA_UNAVAILABLE|CONSENT_WITHDRAWN/);
  const row = f.db.prepare('SELECT body FROM commerce_optional_media').get() as Row;
  assert.equal(JSON.parse(row.body).redacted, true); assert.equal(JSON.stringify(row).includes(optionalExpected.media_text), false);
  await f.media.deleteEligible(f.owner);
  assert.equal(f.identitySource.ledger().length, 0);
}));

test('M09-G12-LOCAL-NAMED-RETURN-EVIDENCE-REUSE-FAULT', () => usingOptional(async f => {
  f.enable();
  const input = f.uploadInput({origin: 'return_evidence', consent_id: 'absent-consent'});
  const oracle = (service: OptionalMedia) => assert.throws(() => service.upload(f.customer, input), /RETURN_EVIDENCE_REUSE_DENIED|CONSENT_REQUIRED/,
    'Return evidence cannot enter optional try-on storage without purpose-specific consent');
  oracle(f.media);
  await changedModule('../../packages/commerce/optional-media.mts',
    "assertOptionalMediaGrant(p.origin, consent);",
    "if (p.origin === 'return_evidence') consent = {body: {input_id: p.media_id, input_sha256: digest(bytes), retention_until: this.k.clock() + 60000}, expires_at: this.k.clock() + 60000}; else assertOptionalMediaGrant(p.origin, consent);",
    async module => {
      const broken = new module.OptionalMedia(f.kernel, f.mediaSource);
      assert.throws(() => oracle(broken), assert.AssertionError);
      assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_optional_media').get()?.n, 1);
    });
}));

test('M09-G13-PREP-01-GENERATED-PRODUCT-AND-RETENTION-LIMITS', () => usingOptional(async f => {
  f.mediaReady(); f.mediaQueue(); const result = await f.media.dispatch(f.a.scope, 'media-operation');
  assert.equal(result.output.generated, optionalExpected.generated); assert.equal(result.output.product_id, optionalExpected.product_id);
  assert.equal(result.output.fit_guarantee, optionalExpected.fit_guarantee); assert.equal(result.output.return_policy_change, optionalExpected.return_policy_change);
  assert.equal(result.output.retention_until, f.now() + 60000); assert.equal(result.output.kind, 'synthetic_generated_preview');
  assert.equal(result.output.external_qualified, false); assert.equal(result.output.model_id, 'fixture-vision');
}));

test('M09-G13-PREP-02-TEXT-UNSAFE-AND-UNSUPPORTED-FAIL-CLOSED', () => usingOptional(async f => {
  f.mediaSource.configure(f.configuration('try_on', {vision: false}));
  f.media.configure(f.owner, {expected_revision: 0, enabled: true, expires_at: f.now() + 120000});
  f.mediaSource.recordEvaluation(f.evaluation('try_on', {vision: false}));
  assert.throws(() => f.media.qualification.record(f.reviewer, {record_id: 'text-quality', evaluation_id: 'media-evaluation', expires_at: f.now() + 100000}), /VISION_MODEL_REQUIRED/);
  f.mediaSource.configure(f.configuration('try_on', {revision: 2}));
  f.media.configure(f.owner, {expected_revision: 1, enabled: true, expires_at: f.now() + 120000});
  f.mediaSource.recordEvaluation(f.evaluation('try_on', {id: 'safe-evaluation'}));
  f.media.qualification.record(f.reviewer, {record_id: 'safe-quality', evaluation_id: 'safe-evaluation', expires_at: f.now() + 100000});
  assert.throws(() => f.media.consent(f.customer, f.consentInput('media', {product_id: 'unsupported-garment'})), /PRODUCT_OR_MATERIAL_UNSUPPORTED/);
  assert.throws(() => f.media.consent(f.customer, f.consentInput('media', {material: 'unsafe-material'})), /PRODUCT_OR_MATERIAL_UNSUPPORTED/);
  f.media.consent(f.customer, f.consentInput()); f.media.upload(f.customer, f.uploadInput()); f.mediaQueue();
  f.mediaSource.unsafeNextOutput = true; const result = await f.media.dispatch(f.a.scope, 'media-operation');
  assert.equal(result.state, 'rejected'); assert.equal(result.output, null); assert.equal(result.reason, 'UNSAFE_OUTPUT_REJECTED');
  assert.equal(f.db.prepare("SELECT count(*) n FROM commerce_optional_deletions WHERE state='pending'").get()?.n, 1);
}));

test('M09-G13-PREP-03-CHANGED-QUALIFICATION-AND-FINAL-AUTHORITY', () => usingOptional(async f => {
  f.mediaReady(); f.mediaQueue();
  f.mediaSource.configure(f.configuration('try_on', {revision: 2, model_version: 'v2', settings: {render: 'outline_v2', safety: 'strict', biometric: false}}));
  await assert.rejects(f.media.dispatch(f.a.scope, 'media-operation'), /SOURCE_CONFIGURATION_CHANGED/);
  f.media.configure(f.owner, {expected_revision: 1, enabled: true, expires_at: f.now() + 120000});
  assert.throws(() => f.mediaQueue('new-operation'), /SOURCE_CONFIGURATION_CHANGED|CONSENT_CONTEXT_CHANGED|QUALITY_REQUIRED/);
  assert.equal(f.mediaSource.ledger().length, 0);
  new ExecutionStops(f.kernel).set(f.owner, {action: '*', expected_revision: 0, stopped: true, reason: 'incident'});
  await assert.rejects(f.media.dispatch(f.a.scope, 'media-operation'), /EXECUTION_STOPPED|SOURCE_CONFIGURATION_CHANGED/);
  new Permissions(f.kernel).change(f.owner, {actor_id: 'operator', expected_revision: 0, role: 'operator', actions: ['resource.read'], resource_ids: [f.resource_id]});
  await assert.rejects(f.media.dispatch(f.a.scope, 'media-operation'), /ACCESS_DENIED/);
}));

test('M09-G13-PREP-04-NAMED-SUCCESS-IS-NOT-FIT-FAULT', () => usingOptional(async f => {
  f.mediaReady();
  const oracle = (output: Row) => {assert.equal(output.generated, true); assert.equal(output.fit_guarantee, false, 'A successful synthetic image operation cannot establish garment fit');};
  await changedModule('../../packages/commerce/tryon-qualification.mts', 'fit_guarantee: false,', 'fit_guarantee: true,', async module => {
    const brokenQuality = new module.TryOnQualification(f.kernel, f.mediaSource);
    const broken = new OptionalMedia(f.kernel, f.mediaSource, brokenQuality);
    broken.queue(f.a.scope, {operation_id: 'media-operation', resource_id: f.resource_id, media_id: 'media-one'});
    const result = await broken.dispatch(f.a.scope, 'media-operation');
    assert.equal(result.state, 'applied'); assert.throws(() => oracle(result.output), assert.AssertionError);
    const clean = new TryOnQualification(f.kernel, f.mediaSource).projectOutput(f.mediaSource.ledger()[0].result, f.mediaSource.ledger()[0].command);
    oracle(clean);
  });
}));

test('M09-G14-PREP-01-SCOPED-SYNTHETIC-IDENTITY-RECEIPT', () => usingOptional(async f => {
  f.identityReady(); f.identity.queue(f.a.scope, f.identityInput());
  f.identitySource.loseNextResponse = true;
  const unknown = await f.identity.dispatch(f.a.scope, 'identity-operation'); assert.equal(unknown.state, 'unknown');
  const result = await f.identity.reconcile(f.a.scope, 'identity-operation');
  assert.equal(result.state, 'applied'); assert.equal(result.output.purpose, 'identity_resolution'); assert.equal(result.output.source_identity, 'identity-fixture');
  assert.equal(result.output.confidence, optionalExpected.identity_confidence); assert.equal(result.output.confidence_limitation, optionalExpected.identity_limitation);
  assert.equal(result.output.retention_until, f.now() + 60000); assert.equal(result.external_qualified, false);
  assert.equal(result.output.geography, 'US_TEST'); assert.equal(result.output.cross_merchant_join, false);
  const replay = await f.identity.dispatch(f.a.scope, 'identity-operation');
  assert.equal(replay.native_id, result.native_id); assert.equal(f.identitySource.calls.apply, 1); assert.equal(f.identitySource.calls.lookup, 1);
}));

test('M09-G14-PREP-02-NO-PARTNER-NO-SHADOW-GRAPH', () => usingOptional(async f => {
  assert.throws(() => f.identity.queue(f.a.scope, f.identityInput()), /OPTIONAL_DISABLED/);
  assert.throws(() => f.identity.queue(f.a.scope, f.identityInput({cross_merchant_identifiers: ['PRIVATE-OTHER-MERCHANT']})), /CROSS_MERCHANT_JOIN_DENIED/);
  f.identityReady();
  assert.throws(() => f.identity.queue(f.a.scope, f.identityInput({geography: 'UNAPPROVED'})), /GEOGRAPHY_DENIED/);
  assert.throws(() => f.identity.queue(f.b.scope, f.identityInput()), /NOT_FOUND|SOURCE_SCOPE_DENIED|OPTIONAL_DISABLED/);
  assert.equal(f.identitySource.ledger().length, 0); assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_optional_operations').get()?.n, 0);
}));

test('M09-G14-PREP-03-REVOKED-READINESS-WITHDRAWAL-AND-UNKNOWN-DELETION', () => usingOptional(async f => {
  f.identityReady(); f.identity.queue(f.a.scope, f.identityInput());
  f.identitySource.beforeEffect = () => f.identity.revokeReadiness(f.owner, 'identity-readiness');
  const refused = await f.identity.dispatch(f.a.scope, 'identity-operation');
  assert.ok(['blocked', 'cancelled', 'unknown'].includes(refused.state)); assert.equal(f.identitySource.ledger().filter((r: Row) => r.state === 'applied').length, 0);
  assert.equal(refused.redacted, true);
  await f.identity.deleteEligible(f.owner);
  f.identitySource.beforeEffect = null;
  f.identity.recordReadiness(f.reviewer, {record_id: 'renewed-readiness', evaluation_id: 'identity-evaluation', expires_at: f.now() + 100000});
  f.identity.consent(f.customer, f.consentInput('identity', {consent_id: 'identity-consent-two', input_id: 'identifier-two'}));
  f.identity.queue(f.a.scope, f.identityInput({operation_id: 'second-operation', input_id: 'identifier-two', consent_id: 'identity-consent-two'}));
  f.identitySource.loseNextResponse = true;
  const unknown = await f.identity.dispatch(f.a.scope, 'second-operation'); assert.equal(unknown.state, 'unknown');
  f.identity.withdraw(f.customer, 'identity-consent-two');
  const original = f.db.prepare("SELECT id,state,body FROM commerce_optional_operations WHERE id='second-operation'").get() as Row;
  assert.equal(original.id, 'second-operation'); assert.equal(original.state, 'unknown'); assert.equal(JSON.parse(original.body).redacted, true);
  await f.identity.deleteEligible(f.owner);
  const native = f.identitySource.ledger().find((r: Row) => r.operation_id === 'second-operation');
  assert.equal(native.state, 'deleted'); assert.equal(native.command, null);
  assert.equal(f.db.prepare("SELECT count(*) n FROM commerce_optional_deletions WHERE original_operation_id='second-operation' AND state='deleted'").get()?.n, 1);
  await assert.rejects(f.identity.dispatch(f.a.scope, 'second-operation'), /CONSENT_WITHDRAWN|OPERATION_REDACTED/);
  assert.equal(f.identitySource.calls.apply, 2);
}));

test('M09-G14-PREP-04-NAMED-PRIVATE-CROSS-MERCHANT-GRAPH-FAULT', () => usingOptional(async f => {
  const input = f.identityInput({cross_merchant_identifiers: ['PRIVATE-OTHER-MERCHANT']});
  const oracle = (service: IdentityPartner) => assert.throws(() => service.queue(f.a.scope, input), /CROSS_MERCHANT_JOIN_DENIED|OPTIONAL_DISABLED/,
    'Absent partner readiness cannot be replaced by a private cross-merchant identity graph');
  oracle(f.identity);
  await changedModule('../../packages/commerce/identity-partner.mts',
    "if (p.cross_merchant_identifiers.length) throw new Error('CROSS_MERCHANT_JOIN_DENIED');",
    "if (p.cross_merchant_identifiers.length) return {state: 'resolved', shadow_graph: this.k.db.prepare(\"SELECT tenant_id,store_id,external_id,payload FROM commerce_resources WHERE kind='customer'\").all()};",
    async module => {const broken = new module.IdentityPartner(f.kernel, f.identitySource); assert.throws(() => oracle(broken), assert.AssertionError);
      const leaked = broken.queue(f.a.scope, input); assert.ok(leaked.shadow_graph.some((r: Row) => r.external_id === 'PRIVATE-OTHER-MERCHANT'));
      assert.equal(f.identitySource.calls.apply, 0);
    });
}));
