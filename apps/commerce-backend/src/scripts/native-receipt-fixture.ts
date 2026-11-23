import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { configure } from "safe-stable-stringify";
import { ContainerRegistrationKeys, Modules, ProductStatus } from "@medusajs/framework/utils";
import { createCartWorkflow, createProductsWorkflow, createRegionsWorkflow, createSalesChannelsWorkflow, updateStoresWorkflow } from "@medusajs/medusa/core-flows";
import { readLockedCartFacts } from "../modules/operation-journal/cart-facts";
import { operationJournalModule } from "../modules/operation-journal";
import type OperationJournalService from "../modules/operation-journal/service";

const stringify = configure({ deterministic: true, strict: true, bigint: false });
export const bytes = (value: unknown) => Buffer.from(stringify(value)!);

/** Test-only native Medusa setup and independently generated request/receipt
 * signatures. No product constructor selects these keys or claims. */
export async function nativeReceiptFixture(container: any, requestOrigin = "https://authority.example.invalid", preservePrivacyKey = false) {
  const journal = container.resolve(operationJournalModule) as OperationJournalService;
  const postgres = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const clock = async (): Promise<number> => (await postgres.raw("select clock_timestamp() as now")).rows[0].now.getTime();
  const suffix = randomUUID(), stores = container.resolve(Modules.STORE), auth = container.resolve(Modules.AUTH);
  const [store] = await stores.listStores();
  const merchant = { merchant_namespace: "synthetic-receipt", store_id: store.id };
  const { result: channels } = await createSalesChannelsWorkflow(container).run({ input: { salesChannelsData: [{ name: "C8 " + suffix }] } });
  await updateStoresWorkflow(container).run({ input: { selector: { id: store.id }, update: {
    supported_currencies: [{ currency_code: "usd", is_default: true }], default_sales_channel_id: channels[0].id,
  } } });
  const { result: regions } = await createRegionsWorkflow(container).run({ input: { regions: [{ name: "C8 " + suffix,
    currency_code: "usd", countries: ["us"], automatic_taxes: false, payment_providers: ["pp_system_default"] }] } });
  const { result: products } = await createProductsWorkflow(container).run({ input: { products: [{ title: "C8 " + suffix,
    status: ProductStatus.PUBLISHED, sales_channels: [{ id: channels[0].id }], options: [{ title: "Size", values: ["One"] }],
    variants: [{ title: "One", options: { Size: "One" }, manage_inventory: false, prices: [{ currency_code: "usd", amount: 12.5 }] }] }] } });
  const customer = await container.resolve(Modules.CUSTOMER).createCustomers({ email: "c8-" + suffix + "@example.invalid", has_account: true });
  const identity = await auth.createAuthIdentities({ app_metadata: { customer_id: customer.id } });
  const operator = await container.resolve(Modules.USER).createUsers({ email: "c8-operator-" + suffix + "@example.invalid" });
  const operatorIdentity = await auth.createAuthIdentities({ app_metadata: { user_id: operator.id } });
  const privacyActor = { actor_type: "user" as const, actor_id: operator.id, auth_identity_id: operatorIdentity.id };
  process.env.RIFARE_MERCHANT_NAMESPACE = merchant.merchant_namespace; process.env.RIFARE_NATIVE_STORE_ID = store.id;
  if (preservePrivacyKey || process.env.RIFARE_C8_RESTORE_PHASE === "seed") assert.match(process.env.RIFARE_JOURNAL_PRIVACY_KEY ?? "", /^[A-Za-z0-9_-]{43}$/);
  else process.env.RIFARE_JOURNAL_PRIVACY_KEY = randomBytes(32).toString("base64url");
  process.env.RIFARE_JOURNAL_PRIVACY_OPERATOR_ID = operator.id;
  const context = { actor: { actor_type: "customer" as const, actor_id: customer.id, auth_identity_id: identity.id }, salesChannelIds: [channels[0].id] };
  const requestKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" }), receiptKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const correlation = { actor: { type: "MACHINE_IDENTITY", id: "urn:rifare:synthetic:machine" }, organization_id: randomUUID(), provider_ref: "synthetic-provider" };
  const requestTrust = { profile: "urn:rifare:managed-authorization-request-trust:v1", ...correlation,
    origin: requestOrigin, verifier_did: "did:web:verifier.example.invalid", client_id: "decentralized_identifier:did:web:verifier.example.invalid",
    key_id: "did:web:verifier.example.invalid#request", key_purpose: "oid4vp_request_signing", algorithm: "ES256", public_jwk: requestKey.publicKey.export({ format: "jwk" }),
    max_lifetime_seconds: 300, dcql_query: { credentials: [{ id: "machine", format: "jwt_vc_json", require_cryptographic_holder_binding: true,
      meta: { marty_securing_profile: "marty_nested_vc2_jwt_v1", type_values: [["MachineCredential"]] } }] }, client_metadata: { vp_formats_supported: {
      jwt_vc_json: { alg_values_supported: ["ES256", "ES384", "EdDSA", "RS256"] }, jwt_vp: { alg_values_supported: ["ES256", "ES384", "EdDSA", "RS256"] },
    } } };
  const issuer = { type: "ORGANIZATION", id: "did:web:receipt.example.invalid" };
  const trust = { profile: "urn:rifare:native-delegated-receipt-trust:v1", ...correlation, issuer, status_issuer: issuer,
    subject: { type: "ORGANIZATION", id: "urn:rifare:synthetic:represented-subject" }, binding: { method: "KEY", key_thumbprint: "sha256:" + "b".repeat(64) },
    policy: { id: "synthetic-policy", version_digest: "sha256:" + "c".repeat(64) }, delegated_ceiling: { currency: "usd", maximum_minor: "999999" },
    key: { issuer, purpose: "urn:marty:delegated-decision:jws-v1", key_id: issuer.id + "#receipt", algorithm: "ES256", public_jwk: receiptKey.publicKey.export({ format: "jwk" }) } };
  const requestVerifier = await journal.createAuthorityRequestVerifier(bytes(requestTrust));
  const verifier = await journal.createAuthorityReceiptVerifier(bytes(trust));
  const signed = (header: unknown, payload: unknown, key: typeof receiptKey.privateKey) => {
    const input = bytes(header).toString("base64url") + "." + bytes(payload).toString("base64url");
    return Buffer.from(input + "." + sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" }).toString("base64url"));
  };
  const makeOriginal = async (retainRequest = true, requestLifetime = 120) => {
    const { result: cart } = await createCartWorkflow(container).run({ input: { customer_id: customer.id, region_id: regions[0].id,
      sales_channel_id: channels[0].id, items: [{ variant_id: products[0].variants[0].id, quantity: 1 }] } });
    const facts = await postgres.transaction(tx => readLockedCartFacts(tx, cart.id, merchant, context), { isolationLevel: "serializable" });
    const command = { cart_facts_digest: facts.factsDigest, cart_id: cart.id, command_id: randomUUID(), currency: "usd", currency_exponent: 2,
      kind: "prepare_purchase", payable_minor_units: facts.facts.payable_total_minor, profile: "urn:rifare:medusa-original-operation:v1" };
    const admitted = await journal.admitForAuthority(bytes(command), context);
    const descriptor = { correlation, grant: { id: randomUUID(), revision: 1, terms_digest: "sha256:" + "a".repeat(64) } };
    const start = await journal.retainAuthorityStart(command.command_id, admitted.send_ticket!, bytes(descriptor), context);
    const now = await clock(), challenge = randomUUID(), nonce = "synthetic-provider-nonce-" + randomUUID();
    const original = JSON.parse(start.command_bytes), until = now + 120000;
    await journal.observeAuthorityResponse(command.command_id, bytes({ profile: "urn:marty:delegation-command-response:v1",
      original_command_id: command.command_id, command_digest: start.command_digest, recovered: false, result: { kind: "CHALLENGE", challenge_id: challenge,
        grant: original.grant, operation: original.operation, created_at: new Date(now - 1000).toISOString(), expires_at: new Date(until).toISOString() } }), false, context);
    const artifact = signed({ alg: "ES256", kid: requestTrust.key_id, typ: "oauth-authz-req+jwt" }, { aud: "https://self-issued.me/v2",
      client_id: requestTrust.client_id, iss: requestTrust.client_id, iat: Math.floor(now / 1000), exp: Math.floor((now + requestLifetime * 1000) / 1000), nonce, state: challenge,
      response_type: "vp_token", response_mode: "direct_post", response_uri: requestTrust.origin + "/v1/flows/instances/" + challenge + "/submit",
      dcql_query: requestTrust.dcql_query, client_metadata: requestTrust.client_metadata }, requestKey.privateKey);
    if (retainRequest) await journal.verifyAuthorityRequest(command.command_id, artifact, context, requestVerifier);
    const receipt = async (receiptId = randomUUID(), lifetime = 60000, overrides: Record<string, any> = {}) => {
      const time = await clock(), issued = new Date(time - 5).toISOString(), expiry = new Date(Math.min(time + lifetime, until)).toISOString();
      return signed({ typ: "mip-delegated-decision+jws", alg: "ES256", kid: trust.key.key_id }, {
        profile: "urn:marty:delegated-decision-receipt:v1", id: receiptId, issuer, decision: "PERMIT", policy: trust.policy, issued_at: issued, expires_at: expiry,
        evaluation: { profile: "urn:marty:delegated-evaluation:v1", organization_id: correlation.organization_id, grant: descriptor.grant,
          actor: correlation.actor, subject: trust.subject, binding: trust.binding, operation: original.operation,
          approval_evidence_ref: "urn:synthetic:approval", authority_evidence_ref: "urn:synthetic:authority", proof_evidence_ref: "urn:synthetic:proof",
          challenge: nonce, proof_verified_at: issued, proof_valid_until: new Date(until).toISOString(),
          status: { issuer, grant: descriptor.grant, state: "ACTIVE", checked_at: issued, valid_until: new Date(until).toISOString(), evidence_ref: "urn:synthetic:status" },
          evaluated_at: issued }, ...overrides }, receiptKey.privateKey);
    };
    return { command, descriptor, cart, artifact, nonce, challenge, receipt, row: () => postgres("rifare_operation").where({ original_command_uuid: command.command_id }).first() };
  };
  return { journal, postgres, clock, merchant, customer, context, privacyActor, identity, auth, trust, requestTrust, verifier, requestVerifier, makeOriginal };
}
