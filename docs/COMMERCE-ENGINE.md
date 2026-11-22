# Rifare commerce engine

The next target-native slice is [Medusa cart context](MEDUSA-CART-CONTEXT.md),
assigned by [ADR-0083](decisions/0083-medusa-cart-context.md). It protects registered
cart ownership and projects native persisted values for observation. It retains
all protected effects and adds a hold on unqualified native customer transfer.

Rifare's selected commerce application is now **Medusa 2.23.0 with PostgreSQL**,
under [`apps/commerce-backend`](../apps/commerce-backend/). The application uses
upstream modules, Store/Admin APIs and workflows. It does not introduce another
catalog, pricing calculator, cart database, stock counter or order state machine.
[ADR-0081](decisions/0081-upstream-commerce-engine.md) records the owner's decision
to replace commodity implementations and reduce custom code.

This is a runnable **local development profile**. The upstream Admin builds, and
the native commerce verification exercises a real PostgreSQL database and local
HTTP server. The existing ElevenID/delegated-checkout implementation still uses
its diagnostic source owners; it is not connected to this new database yet.

## What moves upstream

| Capability | Selected owner | Current migration evidence |
| --- | --- | --- |
| Products, variants and prices | Medusa Product/Pricing modules and workflows | Native product/variant creation and major-unit prices used by the cart. |
| Cart items, promotions, shipping and tax totals | Medusa Cart, Promotion, Fulfillment and Tax workflows | Exact independent totals and rejection of caller-supplied Store API prices. |
| Stock, reservations and cancellation | Medusa Inventory and order workflows | Insufficient-stock refusal, reservation on cart completion, stock consumption on fulfillment and release on cancellation. |
| Orders and payment records | Medusa cart-completion and Payment workflows | One native order for repeated completion of the same cart; manual-provider capture/refund records. No real payment provider is configured. |
| Ordinary returns and receiving | Medusa Order return workflows | Requested return, confirmed receipt and restocking of exactly the received unit. No physical handoff is claimed. |
| Generic merchant administration | Upstream Medusa Admin | Frontend and backend build; full served-browser/operator qualification remains open. |
| Exchanges, claims and order edits | Reuse the existing upstream Order capabilities | Available upstream, but not yet mapped against all retained Rifare scenarios. Do not keep duplicate engines by default. |
| Loyalty, credit and growth | Assess upstream modules/plugins before extending | Specific scope, license and scenario equivalence remain to be assessed. |

Rifare retains product-specific agent/task interfaces, merchant policies, approval
composition, cross-system evidence and unknown-outcome handling where these are
not supplied by the selected upstream workflow. ElevenID supplies identity,
credentials, trust and delegated identity/consent evidence through supported
interfaces. Merchant business permission remains at the commerce action boundary.

## Run the local application

Use Node 24 or a supported Node 22 release at least 22.22.0, npm and a local
PostgreSQL database dedicated to this application. The observed validation host
uses Node 24.22.3 and PostgreSQL 17.12. The root's older `.node-version` remains a
diagnostic-profile input; it is not the new application's minimum version.

From the repository root:

```sh
npm ci --prefix apps/commerce-backend --ignore-scripts
cp apps/commerce-backend/config.example.env apps/commerce-backend/.env
```

Set `DATABASE_URL` to the owned local database and supply two independently
generated session secrets of at least 32 characters. Keep `.env` private and out
of Git. `RIFARE_COMMERCE_PROFILE=local-medusa` selects this profile explicitly.
Then run:

```sh
npm --prefix apps/commerce-backend run db:migrate
npm --prefix apps/commerce-backend run build
npm run dev
```

The standard root development command now starts the Medusa application when
its dependencies are installed. Missing prerequisites fail; there is no SQLite
fallback. The backend binds to `127.0.0.1:9000`, with Admin at `/app`. Create a
local development operator using Medusa's existing `user` command; the available
options are shown by `npm --prefix apps/commerce-backend run user -- --help`.
Do not reuse a real production password for this local account.

The supported launcher fixes loopback binding, disables upstream telemetry before
CLI initialization, disables the Cloud plugin, and rejects ambient Cloud inputs.
An explicit HMR port avoids upstream network-interface enumeration on restricted
hosts. `RIFARE_HMR_PORT` defaults to 9001; use a different port and separate
database/configuration for another instance. Sales channels do not establish
independent merchant security boundaries.

Production/staging startup is refused. The first profile uses upstream local
event-bus, locking and workflow defaults; their cross-process durability is not
qualified. No Stripe, external mail or carrier integration is configured. The
installed upstream dependency graph contains optional providers, which is
different from enabling or qualifying them.

## Public access while identity is being connected

Public catalog and guest-cart preparation use Medusa's normal APIs. These guest
carts are capability-style development resources, not verified ElevenID customer
accounts. Customer authentication is disabled by default. The explicit
[external identity profile](EXTERNAL-CUSTOMER-IDENTITY.md) adds customer OIDC login
while retaining these commerce holds. Local operator email/password access remains
separate and restricted to the development profile.

The application holds the following native routes with an explicit 503 response:

- Cart completion and payment-collection mutations.
- Public return routes.
- Public order reads and mutations, including transfer operations.
- Payment webhook routes.

Some native upstream routes otherwise use possession of an order identifier or
transfer token. Holding them prevents an unconnected commerce route from becoming
an alternative to Rifare's future verified subject/merchant/approval boundary.
There is no header, caller assertion or environment switch that lifts the hold.
Trusted internal test setup can exercise the underlying workflows with synthetic
providers; it is not exposed as an application checkout endpoint.

The [identity application contract](IDENTITY-APPLICATION-CONTRACT.md) is the next
integration boundary. The existing delegated-use sender and receipt verifier were
not loosened or connected to unverified Medusa snapshots.

## Verify the engine

Use a **fresh disposable database** with the same local configuration, run its
migrations, then execute:

```sh
NODE_ENV=test RIFARE_COMMERCE_VERIFY=disposable npm --prefix apps/commerce-backend run test:commerce
```

The script creates synthetic fixtures through upstream workflows and starts a
local Medusa HTTP server on port 19035. Allow up to 240 seconds for the complete
database/application invocation. It stops its own server and emits
`RIFARE_MEDUSA_RESULT` only after all assertions pass. This is a separate native
application verification, not a replacement for Rifare's retained regression gate.
No production data or real provider credentials belong in this database.

The checks cover prices, tax, promotion, shipping, stock rejection, HTTP price
tampering, protected-route refusal, cart completion, original order reuse,
reservation/fulfillment, return receiving, manual-provider refund and cancellation.
The payable-cart fixture makes removal of the public completion hold observable
as a real native order creation, rather than an unrelated setup failure.

The money oracle is explicit: two USD 12.50 items, 10% item promotion, USD 5.00
shipping and a synthetic 10% tax produce USD 30.25. Medusa's `discount_subtotal`
is 2.50; `discount_total` is 2.75 including the associated tax reduction. These
are major currency units. A later bridge to Rifare's minor-unit decimal strings
must perform exact, currency-aware conversion and preserve the original total.

Relevant existing regression commands remain:

```sh
python3 tools/dev_tests.py --files tests/development/commerce-backend-config.test.mts tests/development/config.test.mts tests/development/checkout-preview.test.mts
python3 tools/check_distribution.py --root .
```

The fixture helper excludes installed npm trees, generated Medusa/cache files and
private dotenv files; assertions and retained synthetic fixtures are unchanged.
The [work record](../work/records/COMMERCE-ENGINE-01.md) records exact candidates,
executions, the behavioral fault, independent reviews and outstanding qualification.

## Dependency and license boundary

The direct Medusa dependencies are pinned to 2.23.0, with an exact npm lock and
installation hooks disabled. `@swc/core`, TypeScript and ts-node are separately
pinned. The root diagnostic dependency graph remains empty.

Medusa is open core. Its ordinary commerce implementation is MIT licensed, while
the installed release also contains separately licensed Enterprise materials,
including OIDC SSO, RBAC and audit functionality. Their presence in the npm graph
does not grant permission to enable them. This application does not configure
Enterprise providers, and verification checks that RBAC and audit modules are
not loaded. Container placeholder keys do not count as loaded modules. See the [exact upstream license](https://github.com/medusajs/medusa/blob/v2.23.0/LICENSE)
and [Enterprise file scope](https://github.com/medusajs/medusa/blob/v2.23.0/ENTERPRISE-LICENSE.md).
The customer identity adapter uses the generic Auth provider extension with
MIT-licensed `openid-client` 6.9.1 and `cookie` 2.0.2. It neither copies Enterprise
code nor disables upstream controls. The exact graph contains 1,015 dependency
entries plus its root record; native Express/session cookie versions are retained.

The first audit found Ajv 8.13.0 through an upstream tool dependency. The lock now
uses an explicit Ajv 8.20.0 override for
[GHSA-2g4f-4pwh-qvx6](https://github.com/advisories/GHSA-2g4f-4pwh-qvx6).
This is a same-major dependency substitution requiring the retained fresh build,
migration and workflow checks. Remove it when the upstream graph normally selects
a patched version. Audit observations are dated evidence, not a perpetual security
guarantee.

The lock includes platform-specific optional packages and six bundled WASM helper
entries whose bytes are covered by their parent tarball. Some packages omit the
license metadata field; source and included license texts must be retained for
an actual distribution. The source checker pins this exact development graph;
it does not approve a binary/container distribution or grant Enterprise rights.

## Retirement rule

The existing SQLite commerce modules and synthetic sources remain available to
their diagnostic tests. No legacy file is claimed deleted by this checkpoint.
They are not imported by the Medusa target and are not a second production system
of record. Stop extending commodity behavior in those modules. For each next
feature, map retained scenarios to the upstream API/workflow, add only a proven
Rifare-specific gap, and remove the obsolete application implementation once its
callers and behavior are migrated. Preserve regression expectations as black-box
tests of the replacement.
