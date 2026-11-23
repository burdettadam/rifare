/** Explicit disposable development composition. It is not a provider emulator. */
import { DatabaseSync } from 'node:sqlite';
import { lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { CommerceKernel, digest, exact, id } from '../commerce/kernel.mts';
import type { Row } from '../commerce/kernel.mts';
import { canonical, contentDigest } from '../commerce/configuration-values.mts';
import { Capabilities } from '../commerce/capabilities.mts';
import { CustomerAccess } from '../commerce/customer-access.mts';
import type { ProofDelivery } from '../commerce/customer-access.mts';
import { StoreSimulator } from '../commerce/simulator.mts';
import { ShoppingCart } from '../commerce/shopping-cart.mts';
import { CheckoutPreviews } from '../commerce/checkout-previews.mts';
import type { FrozenCheckoutPreview } from '../commerce/checkout-preview.mts';
import { DelegatedCheckoutReceipts } from '../commerce/delegated-checkout-receipts.mts';
import type { ReceiptBindingContext } from '../commerce/delegated-checkout-receipts.mts';
import { DelegatedCheckoutApi } from '../commerce/delegated-checkout-api.mts';
import { INTENT_KIND } from '../commerce/delegated-checkout-intent-records.mts';
import { JWS_PURPOSE, JWS_TYP, ReceiptBindingDenied } from '../commerce/delegated-receipt-binding.mts';
import type { PinnedReceiptJoseVerifier } from '../adapters/delegated-receipts/jose-verifier.mts';
import { OrderEditFixtureSource } from '../adapters/order-edit-fixture-source.mts';
import { ShoppingCatalogFixtureSource } from '../adapters/shopping-catalog-fixture-source.mts';
import { CheckoutQuoteFixtureSource } from '../adapters/checkout-quote-fixture-source.mts';
import { startCommerceServer } from '../../apps/commerce-api/server.mts';

type Mode = 'fresh' | 'history';
type Pair = Readonly<{ preview_id: string; context_id: string; compact_jws: string }>;
type Credentials = Readonly<{
  bearer: string;
  preview_request: { cart_id: string; shipping_quote_id: string; fee_quote_id: string };
  primary: Pair; pending: Pair;
}>;
export type FixtureReady = Readonly<{
  event: 'checkout_fixture_ready'; schema_version: 1; mode: Mode; instance_id: string;
  pid: number; url: string; effects_digest: string; intent_count: number;
  credentials?: Credentials;
}>;
export type FixtureSnapshot = Readonly<{ effects_digest: string; intent_count: number; session_count: number }>;
type Marker = Readonly<{
  schema_version: 1; profile: 'rifare-checkout-fixture'; instance_id: string;
  tenant_id: string; store_id: string; source_identity: string;
  commerce_schema_digest: string; source_schema_digest: string;
}>;
const FILES = ['fixture.json', 'commerce.sqlite', 'source.sqlite'] as const;
const SIDECARS = ['commerce.sqlite-journal', 'source.sqlite-journal'];
const fail = (code: string): never => { throw new Error(code); };
const owned = (stat: Stats) =>
  (typeof process.getuid !== 'function' || stat.uid === process.getuid()) && (stat.mode & 0o077) === 0;

function directoryPath(directory: string, instanceId: string): void {
  id(instanceId);
  if (typeof directory !== 'string' || !isAbsolute(directory) || resolve(directory) !== directory ||
    realpathSync(directory) !== directory) fail('CHECKOUT_FIXTURE_PATH_INVALID');
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !owned(stat)) fail('CHECKOUT_FIXTURE_PATH_INVALID');
}
function privateFile(path: string, maximum = 64 * 1024 * 1024): void {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || !owned(stat) || stat.size > maximum)
    fail('CHECKOUT_FIXTURE_FILE_INVALID');
}
function names(directory: string): void {
  for (const name of readdirSync(directory)) {
    if (![...FILES, ...SIDECARS].includes(name)) fail('CHECKOUT_FIXTURE_FILE_INVALID');
    privateFile(join(directory, name), name === 'fixture.json' ? 4096 : undefined);
  }
}
function readMarker(directory: string, instanceId: string): Marker {
  directoryPath(directory, instanceId); names(directory);
  for (const name of FILES) privateFile(join(directory, name), name === 'fixture.json' ? 4096 : undefined);
  const text = readFileSync(join(directory, 'fixture.json'), 'utf8');
  const marker = exact(JSON.parse(text),
    ['schema_version', 'profile', 'instance_id', 'tenant_id', 'store_id', 'source_identity',
      'commerce_schema_digest', 'source_schema_digest']) as Marker;
  if (text !== canonical(marker) + '\n' || marker.schema_version !== 1 || marker.profile !== 'rifare-checkout-fixture' ||
    marker.instance_id !== instanceId || marker.tenant_id !== scopeId(instanceId) ||
    marker.store_id !== scopeId(instanceId) ||
    !/^[a-f0-9]{64}$/.test(marker.commerce_schema_digest) ||
    !/^[a-f0-9]{64}$/.test(marker.source_schema_digest)) fail('CHECKOUT_FIXTURE_MARKER_INVALID');
  id(marker.source_identity);
  return marker;
}
const scopeId = (instanceId: string): string => 'checkout_' + digest(instanceId).slice(0, 24);
function rows(db: DatabaseSync, sql: string): Row[] {
  const result = db.prepare(sql + ' LIMIT 4097').all() as Row[];
  if (result.length > 4096) fail('CHECKOUT_FIXTURE_SNAPSHOT_LIMIT');
  return result;
}
function schemaDigest(db: DatabaseSync): string {
  return digest(JSON.stringify(rows(db,
    "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name")));
}
function validateStores(db: DatabaseSync, source: DatabaseSync, marker: Marker): void {
  if (schemaDigest(db) !== marker.commerce_schema_digest || schemaDigest(source) !== marker.source_schema_digest)
    fail('CHECKOUT_FIXTURE_SCHEMA_CHANGED');
  const stores = db.prepare('SELECT tenant_id,store_id FROM commerce_stores').all() as Row[];
  const native = source.prepare('SELECT identity,tenant,store FROM edit_source_identity WHERE singleton=1').get() as Row;
  if (stores.length !== 1 || stores[0].tenant_id !== marker.tenant_id || stores[0].store_id !== marker.store_id ||
    !native || native.identity !== marker.source_identity || native.tenant !== marker.tenant_id || native.store !== marker.store_id)
    fail('CHECKOUT_FIXTURE_STORE_CHANGED');
  // A missing migration must not be silently initialized during history startup.
  const migrations = new URL('../../migrations/commerce/', import.meta.url);
  const expected = readdirSync(migrations).filter(name => name.endsWith('.sql')).sort();
  const applied = db.prepare('SELECT version,sha256 FROM commerce_migrations ORDER BY version').all() as Row[];
  if (expected.length !== applied.length || expected.some((name, i) =>
    applied[i].version !== name || applied[i].sha256 !== digest(readFileSync(new URL(name, migrations)))))
    fail('CHECKOUT_FIXTURE_MIGRATIONS_CHANGED');
}
function snapshot(db: DatabaseSync, source: DatabaseSync): FixtureSnapshot {
  // Observe complete synthetic source ledgers, including native order, stock,
  // fulfillment, finance and cart records. Intent evidence and sessions are separate.
  const tables = rows(source, "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  const sourceRows = tables.map(({ name }) => {
    if (typeof name !== 'string' || !/^[a-z_]+$/.test(name)) fail('CHECKOUT_FIXTURE_SCHEMA_CHANGED');
    return [name, rows(source, 'SELECT * FROM ' + name).map(row => canonical(row)).sort()];
  });
  const commerceRows = ['commerce_operations', 'commerce_shopping_carts', 'commerce_simulator_receipts']
    .map(name => [name, rows(db, 'SELECT * FROM ' + name).map(row => canonical(row)).sort()]);
  const resources = rows(db,
    "SELECT * FROM commerce_resources WHERE kind IN ('order','payment','shipment','catalog') ORDER BY tenant_id,store_id,id");
  return Object.freeze({ effects_digest: digest(JSON.stringify({ source: sourceRows, commerce: commerceRows, resources })),
    intent_count: Number((db.prepare('SELECT count(*) AS n FROM commerce_support_documents WHERE kind=?').get(INTENT_KIND) as Row).n),
    session_count: Number((db.prepare('SELECT count(*) AS n FROM commerce_sessions').get() as Row).n) });
}

/** Caller first proves its child stopped. This function never constructs a kernel or source owner. */
export function readCheckoutFixtureSnapshot(directory: string, instanceId: string): FixtureSnapshot {
  const marker = readMarker(directory, instanceId);
  const db = new DatabaseSync(join(directory, 'commerce.sqlite'), { readOnly: true });
  let source: DatabaseSync | undefined;
  try {
    source = new DatabaseSync(join(directory, 'source.sqlite'), { readOnly: true });
    validateStores(db, source, marker);
    return snapshot(db, source);
  } finally { source?.close(); db.close(); }
}

/** Only a development parent supplies an empty owned directory and receives transient credentials. */
export async function openCheckoutFixture(directory: string, instanceId: string, mode: Mode): Promise<{
  ready: FixtureReady; close(): Promise<void>;
}> {
  if (mode !== 'fresh' && mode !== 'history') fail('CHECKOUT_FIXTURE_MODE_INVALID');
  directoryPath(directory, instanceId);
  let marker: Marker | undefined;
  if (mode === 'fresh') {
    if (readdirSync(directory).length) fail('CHECKOUT_FIXTURE_NOT_EMPTY');
    for (const name of ['commerce.sqlite', 'source.sqlite'])
      writeFileSync(join(directory, name), '', { flag: 'wx', mode: 0o600 });
  } else {
    marker = readMarker(directory, instanceId);
    readCheckoutFixtureSnapshot(directory, instanceId);
  }
  let db: DatabaseSync | undefined, source: DatabaseSync | undefined;
  let server: Awaited<ReturnType<typeof startCommerceServer>> | undefined;
  let previews: CheckoutPreviews | undefined, receipts: DelegatedCheckoutReceipts | undefined;
  let quotes: CheckoutQuoteFixtureSource | undefined, verifier: PinnedReceiptJoseVerifier | undefined;
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return; closed = true;
    try { await server?.close(); }
    finally { receipts?.close(); previews?.close(); quotes?.close(); verifier?.close(); source?.close(); db?.close(); }
  };
  try {
    db = new DatabaseSync(join(directory, 'commerce.sqlite'));
    source = new DatabaseSync(join(directory, 'source.sqlite'), { readOnly: mode === 'history' });
    if (marker) validateStores(db, source, marker);
    const kernel = new CommerceKernel(db), caps = new Capabilities(kernel), simulator = new StoreSimulator(kernel, caps);
    let delivery: ProofDelivery | undefined;
    const customers = new CustomerAccess(kernel, value => { if (mode === 'fresh') delivery = value; });
    let credentials: Credentials | undefined, checkout: DelegatedCheckoutApi | undefined;
    if (mode === 'fresh') {
      const tenant = scopeId(instanceId), store = scopeId(instanceId);
      kernel.provisionStore(tenant, store); kernel.provisionMember(tenant, store, 'fixture-operator');
      const operator = kernel.authenticate(kernel.issueSession(tenant, store, 'fixture-operator'));
      simulator.reset(operator);
      const order = kernel.lookup(operator, 'order', 'synthetic', 'ORD-1001') as Row;
      const challenge = customers.request({ store_id: store, order_number: 'ORD-1001', email: 'shopper-apparel@example.invalid' }, '127.0.0.1');
      if (!delivery) throw new Error('CHECKOUT_FIXTURE_PROOF_MISSING');
      const bearer = customers.complete({ store_id: store, challenge_id: challenge.challenge_id, proof: delivery.proof }).token;
      delivery = undefined;
      const customer = kernel.authenticate(bearer), native = new OrderEditFixtureSource(source,
        { mode: 'fixture', identity: 'checkout-fixture-source', tenant, store });
      const now = Date.now();
      native.seed({ tenant_id: tenant, store_id: store, resource_id: order.id, customer_id: order.customer_id,
        version: 1, created_at: now - 1000, currency: 'USD', shipping_minor: '0', total_minor: '6800',
        net_paid_minor: '6800', balance_due_minor: '0', financial_state: 'paid', cancelled: false,
        address: { name: 'Synthetic Customer', line1: '1 Test Street', city: 'Provo', state: 'UT', postal: '84601', country: 'US' },
        lines: [{ id: 'line-one', variant_id: 'basic', product_id: 'desk_lamp', warehouse_id: 'warehouse-one', quantity: 1,
          unit_minor: '6800', discount_minor: '0', tax_minor: '0', tax_bps: 0, status: 'unfulfilled', subscription: false }] },
      [{ id: 'basic', product_id: 'desk_lamp', unit_minor: '6800', stock: 10, currency: 'USD', tax_bps: 0,
        subscription: false, excluded: false, available: true }]);
      const catalog = new ShoppingCatalogFixtureSource(native);
      catalog.fixtureListing({ variant_id: 'basic', expected_revision: 0, title: 'Synthetic desk lamp',
        description: 'Desk lamp.', approved_descriptions: ['Desk lamp.'],
        terms: { id: 'standard', revision: 1, text: 'No promotional discount.' } });
      const carts = new ShoppingCart(kernel, catalog);
      const cart = carts.propose(operator, { cart_id: 'fixture-cart', resource_id: order.id, items: [{ variant_id: 'basic', quantity: 1 }] });
      await carts.confirm(customer, { cart_id: cart.cart_id, preview_digest: cart.preview_digest });
      kernel.revoke(operator);
      quotes = new CheckoutQuoteFixtureSource(catalog);
      for (const kind of ['shipping', 'fee'] as const) quotes.fixtureQuote({ quote_id: kind + '-quote', kind,
        cart_id: cart.cart_id, expected_revision: 0, amount_minor: '0', currency: 'USD', explicit_zero: true, expires_at: Date.now() + 90000 });
      previews = new CheckoutPreviews(kernel, carts, quotes);
      const request = { cart_id: cart.cart_id, shipping_quote_id: 'shipping-quote', fee_quote_id: 'fee-quote' };
      const requireReceipt = createRequire(new URL('../adapters/delegated-receipts/package.json', import.meta.url));
      const jose = await import(requireReceipt.resolve('jose'));
      const pair = await jose.generateKeyPair('ES256');
      const issuer = { type: 'SERVICE_ACCOUNT' as const, id: 'urn:rifare:synthetic:receipt-issuer' };
      const organization = '11111111-2222-4333-8444-555555555555';
      const key = { issuer, purpose: JWS_PURPOSE, key_id: 'synthetic-' + instanceId, algorithm: 'ES256' as const,
        public_jwk: await jose.exportJWK(pair.publicKey) };
      const { PinnedReceiptJoseVerifier: Verifier } = await import('../adapters/delegated-receipts/jose-verifier.mts');
      verifier = new Verifier([key]);
      const contexts = new Map<string, ReceiptBindingContext>();
      const makePair = async (label: string): Promise<Pair> => {
        const preview: FrozenCheckoutPreview = await previews!.prepare(customer, request);
        const at = Date.now(), time = (offset: number) => new Date(at + offset).toISOString();
        const sha = (value: unknown) => 'sha256:' + contentDigest(value);
        const context: ReceiptBindingContext = {
          context_id: 'context-' + label, revision: 1, valid_until: preview.expires_at,
          tenant_id: tenant, store_id: store, resource_id: order.id, customer_id: order.customer_id,
          preview_id: preview.preview_id, preview_digest: preview.preview_digest,
          delegated_ceiling: { currency: 'USD', maximum_minor: '8000' }, issuer, organization_id: organization,
          actor: { type: 'SERVICE_ACCOUNT', id: 'urn:rifare:synthetic:delegate' },
          subject: { type: 'USER', id: 'urn:rifare:synthetic:represented-customer' }, status_issuer: issuer,
          binding: { method: 'KEY', key_thumbprint: sha(['synthetic-sender', instanceId]) },
          grant: { id: randomUUID(), revision: 1, terms_digest: sha(['synthetic-terms', instanceId, label]) },
          operation: { action: 'urn:rifare:action:purchase:v1', resource_id: 'urn:rifare:resource:' + order.id,
            audience: 'urn:rifare:store:' + store, request_profile: 'urn:rifare:checkout-preview:v1' },
          policy: { id: 'urn:rifare:synthetic:policy', version_digest: sha('synthetic policy version 1') },
          challenge: 'synthetic_' + randomUUID().replaceAll('-', ''), require_domain_evidence: false,
        };
        contexts.set(context.context_id, context);
        const payload = { profile: 'urn:marty:delegated-decision-receipt:v1', id: randomUUID(), issuer,
          decision: 'PERMIT', policy: context.policy, issued_at: time(-500), expires_at: new Date(preview.expires_at).toISOString(),
          evaluation: { profile: 'urn:marty:delegated-evaluation:v1', organization_id: organization,
            grant: context.grant, actor: context.actor, subject: context.subject, binding: context.binding,
            operation: { ...context.operation, request_digest: 'sha256:' + preview.preview_digest },
            approval_evidence_ref: 'urn:rifare:synthetic:approval', authority_evidence_ref: 'urn:rifare:synthetic:authority',
            proof_evidence_ref: 'urn:rifare:synthetic:proof', challenge: context.challenge,
            proof_verified_at: time(-3000), proof_valid_until: time(90000), evaluated_at: time(-1000),
            status: { issuer, grant: context.grant, state: 'ACTIVE', checked_at: time(-2000),
              valid_until: time(90000), evidence_ref: 'urn:rifare:synthetic:status' } } };
        const compact = await new jose.CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
          .setProtectedHeader({ typ: JWS_TYP, alg: 'ES256', kid: key.key_id }).sign(pair.privateKey);
        return Object.freeze({ preview_id: preview.preview_id, context_id: context.context_id, compact_jws: compact });
      };
      const primary = await makePair('primary'), pending = await makePair('pending');
      receipts = new DelegatedCheckoutReceipts(kernel, previews, { jose: verifier,
        trust: { issuer, organization_id: organization, allowed_algorithms: ['ES256'], trusted_key_ids: [key.key_id] },
        contexts: {
          resolve(_scope, _preview, contextId) { return contexts.get(contextId); },
          assertCurrent(_scope, context) {
            const current = contexts.get(context.context_id);
            if (!current || contentDigest(current) !== contentDigest(context)) throw new ReceiptBindingDenied('RECEIPT_CONTEXT_CHANGED');
          },
        } });
      checkout = new DelegatedCheckoutApi(kernel, { previews, receipts });
      credentials = Object.freeze({ bearer, preview_request: request, primary, pending });
      marker = { schema_version: 1, profile: 'rifare-checkout-fixture', instance_id: instanceId,
        tenant_id: tenant, store_id: store, source_identity: native.identity,
        commerce_schema_digest: '', source_schema_digest: '' };
    }
    server = await startCommerceServer({ kernel, caps, customers, simulator, checkout, log: () => {} });
    if (mode === 'fresh') {
      marker = { ...marker!, commerce_schema_digest: schemaDigest(db), source_schema_digest: schemaDigest(source) };
      writeFileSync(join(directory, 'fixture.json'), canonical(marker) + '\n', { flag: 'wx', mode: 0o600 });
    }
    names(directory);
    const state = snapshot(db, source);
    if (mode === 'fresh' && state.intent_count !== 0) fail('CHECKOUT_FIXTURE_INTENTS_NOT_EMPTY');
    const ready: FixtureReady = Object.freeze({ event: 'checkout_fixture_ready', schema_version: 1, mode,
      instance_id: instanceId, pid: process.pid, url: server.url, effects_digest: state.effects_digest,
      intent_count: state.intent_count, ...(credentials ? { credentials } : {}) });
    return { ready, close };
  } catch (error) { await close(); throw error; }
}
