# Medusa cart ownership and observations

[ADR-0083](decisions/0083-medusa-cart-context.md) assigns the target-native cart
boundary. Medusa 2.23.0 owns carts, lines, addresses, prices, promotions, taxes,
shipping and order workflows. Rifare adds current customer-access policy and a
closed observation of persisted native facts. This does not enable checkout.

## Customer access

Registered-customer carts require a native customer bearer credential. Rifare
rechecks the current AuthIdentity association and the registered customer record;
an association retained only in a JWT is insufficient. The cart customer must equal
that actor, and the cart channel must belong to the selected publishable API key.
Operator credentials, an email address and arbitrary metadata confer no customer
authority. This is local account state, not immediate upstream provider revocation.

Native guest capability behavior remains for carts without a customer and for
customers explicitly marked `has_account: false`. Missing/deleted/ambiguous customer
state cannot turn a registered cart into a guest cart. Native email-only creation
continues to select guest customers; matching a registered email does not claim it.

The policy covers cart reads/mutations, product and variant pricing context, and
shipping-option listing/calculation that consume a cart ID. Duplicate/structured
cart identifiers are refused. Child line IDs must belong to the URL's cart before
native mutation, including when a guest cart is used as the parent. Cart creation
and updates accept inline address values; address string references, `id` and
`customer_id` fields are refused. These rules prevent a cart ID from authorizing
an unrelated line or address through the native service interfaces.

`POST /store/carts/:id/customer` remains held with HTTP 503. This profile does not
implement guest claiming or customer transfer. Create a cart while signed in to
obtain a native customer association. Existing completion, payment mutations,
public order/return and payment-hook holds remain unchanged.

## Observation API

Configure both server values in the local application's private environment:

```dotenv
RIFARE_MERCHANT_NAMESPACE=local-merchant
RIFARE_NATIVE_STORE_ID=store_YOUR_NATIVE_STORE_ID
```

The namespace is a deployment label, not an ElevenID organization claim. The store
must match the sole native Store in this merchant's isolated database. A sales
channel is not cross-merchant isolation. Neither value comes from the request.
Partial/invalid configuration fails startup. Without configuration, authenticated
observation requests are refused while the ordinary cart guards remain active.

```http
GET /store/rifare/cart-observations/:id
Authorization: Bearer <short-lived-native-customer-token>
x-publishable-api-key: <native-publishable-key>
```

No query projection, body, client totals, merchant ID or supplied digest is accepted.
The cart must belong to the current registered customer, remain uncompleted and
have no native `order_cart` linkage. Refusals do not expose an existing order ID.
Responses use `Cache-Control: no-store` and contain:

| Field | Meaning |
| --- | --- |
| `semantics` | Literal `OBSERVATION_ONLY` |
| `observed_at` | Server observation time; outside the stable facts digest |
| `facts.profile` | `urn:rifare:medusa-cart-observation:v1` |
| Merchant/store/cart/customer/channel/region | Native IDs and server-owned deployment context |
| Currency and totals | Native currency, pinned Medusa decimal digits, exact major-unit decimal strings, and separate `payable_total_minor` |
| Items | Native row/product/variant IDs, quantity, unit price, commerce flags, native totals, adjustments and tax lines |
| Shipping and credits | Native method/option IDs, amounts, totals, adjustments, taxes and credit references |
| `contact_digest` | Commitment to the fixed email/address projection, without returning its plaintext |
| `facts_digest` | SHA-256 over deterministic serialization of the entire closed facts object |

Collections are sorted by native row ID, preserving distinct lines for the same
variant. Optional text becomes explicit null; required records/fields and duplicate
IDs fail closed. The serializer is maintained `safe-stable-stringify` 2.5.0,
configured strictly with deterministic keys. It was already in the pinned graph;
making it a direct dependency adds no new transitive package. The response projection
is bounded to 200 items, 20 shipping methods, 100 credits, 50 tax/adjustment rows per
owner and 128 KiB of canonical facts. Medusa `MathBN` preserves raw monetary strings,
with no floating-point multiplication, repricing or rounding. Components such as
tax allocations may retain fractional minor units; their exact major-unit decimals
remain in the digest. Only the payable total is also converted to minor units, and
an unrepresentable payable total is refused. Nonfinite values, excessive precision
and out-of-range values are refused (signed 64-bit magnitude for minor-unit payable
totals; 100 decimal places and that magnitude in major units for components).
The contract uses strings so large exact values remain exact.

Contact commitments remain potentially identifying data, not anonymization.
Arbitrary metadata, fulfillment data, provider credentials, payment sessions and
orders are excluded. This bounded projection is deliberately not an exhaustive
purchase approval contract. Additional operation-relevant facts must be specified
and checked at the eventual execution boundary.

## Currentness and effects

The observer uses uncached native queries and the existing cart-ID locking service.
The installed locking provider is in memory and coordinates cooperating operations
in one process. Graph reads are not a cross-module serializable transaction, and
direct service/admin writers may not take that lock. A later unchanged digest can
show equality of the observed projection; it cannot establish atomic currentness
across awaited ElevenID traffic. The observer makes no durable snapshot or revision.

Medusa computes totals from persisted lines, taxes and adjustments. The read does
not reprice the catalog, calculate new tax, reserve stock or refresh payment
collections. A native refresh workflow can change payment state and therefore
does not belong inside this read-only endpoint. Future execution should reuse
native completion and its original cart/order relationship, with separately
qualified ownership, approval, payment equality and original-outcome recovery.

## ElevenID dependency

The read-only upstream audit found Marty main `284ca81`, delegated-use candidate
`3c8a938` (PR #1994 still draft/unmerged), and Supabase branch `d5e3832`. The latter
now contains a static sign-in/consent companion; hosted provider/client/browser
qualification remains open. Protocol PR #38 merged; selected content `6126da7`
is retained by merge `1952c56` without changed files.

The available selected delegation runtime is organization-to-machine KEY /
EXACT_OPERATION. Current Marty human authentication consumes its own session;
the inspected interfaces do not provide a qualified external issuer/subject to
current ElevenID identity/membership lookup. Protocol account-linking defines
bilateral proof, exact-terms confirmation, current status/revision and
`authority_inherited: false`, but does not itself implement that service.

Rifare therefore does not map shared Supabase email/subject to ElevenID permission.
C6 remains pending a selected supported authority profile, native original-operation
storage, atomic admission/currentness and approval-to-effect enforcement. These
observations neither send delegated commands nor confer approval authority.

Sources: [Marty command host](https://github.com/ElevenID/marty-ui/blob/3c8a9386da87a18d8b3c1855614b7e7c18841c09/rust/services/delegated-authority/COMMAND_HOST.md),
[account-link protocol](https://github.com/ElevenID/marty-protocol/blob/6126da7619e057be2ff58dd38a5d50f49891d1b3/protocol/agent-trust/OAUTH-ACCOUNT-LINKING-MCP.md),
[provider companion](https://github.com/ElevenID/marty-ui/blob/d5e383243edb26cd7c01b2ba85ca3d6656bf3f74/docs/supabase-auth-ui.md),
[Medusa cart links](https://docs.medusajs.com/resources/commerce-modules/cart/links-to-other-modules),
[native locking](https://docs.medusajs.com/resources/infrastructure-modules/locking).

## Verification

`npm run test:cart-context` requires the explicitly disposable local PostgreSQL
profile and uses actual native HTTP on loopback 19039. Synthetic native auth
identities are fixture setup; the retained `test:identity` separately exercises
the OIDC peer and application credential lifecycle. `test:commerce` retains the
actual native commerce workflows and public holds. See the
[work record](../work/records/COMMERCE-CONTEXT-01.md) for exact candidate-bound
results, the targeted ownership fault, independent reviews and remaining limits.
