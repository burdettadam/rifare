# Reusable local adapter conformance

M07-G05 prepares a reusable **local fixture package** for 25 declared adapters
and 123 operation entries. It runs 47 scenarios through the shared
action/resource-state/version/scope/source-record engine and executes 100 pinned,
previously existing native cases. Neither result grants a runtime capability or
qualifies an external provider account. Formal M07-G05, M05-G99, M06-G99 and
connected-service acceptance remain blocked under
[ADR-0031](decisions/0031-second-platform-local-development.md).

## Package and execution

The versioned inputs are
[adapter-catalog.v1.json](../tests/fixtures/conformance/adapter-catalog.v1.json),
[expected-coverage.v1.json](../tests/fixtures/conformance/expected-coverage.v1.json),
[contract-cases.v1.json](../tests/fixtures/conformance/contract-cases.v1.json) and
[source-inputs.v1.json](../tests/fixtures/conformance/source-inputs.v1.json).
The expected coverage and contract cases are predeclared inputs. Expected values
are never calculated from an adapter result.

Run from the repository root using the existing pinned Node 22.16.0 runtime:

```sh
node --experimental-strip-types --test --test-concurrency=1 \
  tests/development/adapter-catalog.test.mts \
  tests/development/adapter-conformance.test.mts
```

`CASE-M07-G05-01` runs the entire catalog, including all 47 common-engine
scenarios and the separate 100-case retained native subprocess. The new catalog
test file contains 19 registered native test names. The existing engine file
contains 13 names, including `CASE-M07-G05-02` and `CASE-M07-G05-03`.
The nested 100-case diagnostic run does **not** add another 100 registrations.
The complete unchanged regression gate still runs its original registered
obligations independently.

The reusable modules are
[adapter-catalog.mts](../packages/conformance/adapter-catalog.mts),
[catalog-fixtures.mts](../packages/conformance/catalog-fixtures.mts) and
[native-catalog-runner.mts](../packages/conformance/native-catalog-runner.mts).
The native implementations are bound in
[adapter-catalog-bindings.mts](../tests/development/adapter-catalog-bindings.mts).
That file uses the existing permanent fixture helpers and native adapters. The
generic `runCatalogFixtures(catalog, fixtures, factories)` entry point accepts
the factory map explicitly; it does not load a provider, enable egress, create
an approval service or select a worker runtime.

`runPinnedCatalogCases` validates the catalog before starting and after the
subprocess finishes. It runs the exact first-token ID selection with explicit
TAP output, preserves nonzero exits and raw output, rejects missing/duplicate or
unexpected IDs, and requires zero failed, cancelled, skipped and todo cases.
It removes only Node's private inherited `NODE_TEST_CONTEXT` flag so a nested
runner emits native TAP rather than a parent's V8 IPC protocol. The executable
path, Node version, executable hash, exact arguments, observed case IDs and TAP
hash are returned with the report. A missing report or zero-test process fails.

## Version, scope and support meanings

Each operation records its action, source state, minimum required fixture scopes,
support semantics, qualification, direct fixture bindings and applicable native
case names/paths/hashes. The common-engine descriptor additionally records the
actual fixture grant set. For example, a simulator order read requires
`read_orders`, while its configured fixture connection grants all five read
scopes. Empty scope arrays on server-local diagnostic sources mean there is no
external scope attestation; existing core authorization still applies.

`native` means that the named fixture adapter/source implements that operation.
`composed` describes a local workflow that combines source facts with existing
canonical Rifare records. `manual` preserves a recorded external obligation that
has not been verified as settled. `unavailable` means the catalog makes no
supported-operation claim. Every supported entry remains `sandbox-only`;
unavailable entries retain `unavailable` qualification.

The table summarizes the complete machine-readable catalog. Exact source hashes
and individual operation scopes remain in the versioned JSON. A `source-sha256`
version is the full SHA-256 of an unversioned implementation, not an invented
upstream release number. API namespace strings identify the fixture wire
contract; `external_version` and `external_account` remain null for every entry,
and `external_scopes_attested` remains false.

| Adapter | Fixture contract/version | API namespace or local boundary | Operations and evidence |
|---|---|---|---|
| Simulator | `simulator-read-v1` | `local-read-v1` | All five scoped resource reads; writes/history/handoff unavailable; independent predeclared source rows and actual simulator calls. |
| Shopify orders | `shopify-order-read` | `2026-10` | Exact GraphQL read and fresh cache; read-only write-scope rejection. Source wire order plus recorded request. |
| Shopify returns | Source SHA-256 | `2026-10` | Create and lookup native fixture returns; real fixture return records and fulfillment-line correlation; live create unavailable. |
| Woo orders | `woocommerce-v3-read-v1` | `wc/v3` | GET order/refunds and fresh cache; complete original wire records; tracking extension and edits unavailable. |
| Woo RMA | `woocommerce-rma-fixture-v1` | `wc/v3` | Composed source binding, approved return creation and read; independent Woo facts plus explicitly local RMA; native create/exchange/credit unavailable. |
| Woo events | Source SHA-256 | `wc/v3` | Created/updated/replayed events; raw HMAC plus independent source corroboration; no financial authority. |
| Woo refunds | `rifare-woocommerce-refund-fixture-v1` | `wc/v3` | Composed original-payment refund and lookup; manual record mode remains unsettled; actual Woo refund rows. |
| Woo gateway | `rifare-fixture-card-refund-v1` | Local original-payment fixture | Separate gateway acceptance, lookup and settlement observations; original charge and movement rows. |
| Webhook signatures | Source SHA-256 | Provider-specific fixture | Synthetic route/body, Shopify body, and Woo body verification; actual verifier functions with independently signed raw bytes. Shopify/Woo remain quarantined until their additional trust checks. |
| Support fixture | `support_fixture_v1` | `local_v1` | Email, internal note, assignment, lookup and observation against the separate support ledger. |
| Chatwoot | `chatwoot_support_v419_snapshot` | `api/v1` | Partial history, private note, assignment and correlated lookup; customer send is refused with zero wire effects. |
| Resend | `resend_email_v1_snapshot` | Unversioned email API snapshot | Accepted send and native lookup; no delivered claim from acceptance; unknown-without-native-ID retry unavailable. |
| OpenAI | `openai-status-v1` | Responses `/v1`, unversioned | Explicit local transcript, tool decoding and approved-model enforcement; injected wire fixture only. |
| Anthropic | `anthropic-status-v1` | `2023-06-01` header | Same relevant transcript/tool/model-refusal cases with Anthropic's distinct wire structure. |
| Local model | Source SHA-256 | Tags/chat API snapshot | Loopback model identity probes before and after chat; local digest enforced; remote models unavailable. |
| Synthetic journal | `synthetic-journal-v1` | Local diagnostic journal | Case/projection records, lookup and fixed-ceiling pagination; raw immutable journal rows. |
| Resolution source | Source SHA-256 | Local resolution fixture | Refund, credit, original instrument routing, additional-payment and gift credit obligations; separate money source rows. |
| Fulfillment source | Source SHA-256 | Local fulfillment fixture | Reservations, replacements, labels, void/reimbursement and carrier observations; stock/effect/native delivery records. |
| Warehouse source | Source SHA-256 | Local warehouse fixture | Restock, quarantine, disposal, supplier return and lookup; stock increments only for restock. |
| Native change source | Source SHA-256 | Local change feed | Original snapshot lookup and reconciliation; separately recorded versioned feed. |
| Order edit source | Source SHA-256 | Local edit fixture | Snapshot, readiness/holds, address/item/cancel, money stages, lookup and prevention guards; actual order, stock and stage records. |
| Exchange lineage source | Source SHA-256 | Local funded lineage | Delivered-child transfer, lookup and original-value resolution binding; source child/funding/unit records. |
| Exchange money source | Source SHA-256 | Local original paired money | Original currency pair, allocation, fee events and command binding; original paid/fee source records. |
| Instant exchange source | Source SHA-256 | Local consent/mandate fixture | Authorize/reauthorize/cancel, release, receipt, capture and lookup; source consent, mandate and capture records. |
| Return destination source | Source SHA-256 | Local qualified destination | Evaluate/select/admit/lookup against actual destination, capacity, route and label admission rows. |

Seeders, fault injectors, account qualification setters and observation setters
are fixture administration. Their presence does not authorize an application
caller to manufacture provider evidence. The catalog covers the operations
declared by the platform examples, read capability envelope, provider adapters,
support adapters and installed diagnostic sources; it does not claim that every
public fixture helper is a merchant-facing operation.

## Independent records and exact boundaries

The shared engine compares response status and required response fields with
independently observed source counts, fields and correlated native references.
For writes, bindings query the actual fixture source's SQLite tables after the
adapter call. Read-only wire fixtures are seeded before invocation; transport
reads those rows and records the actual nonsecret request separately. A request
record alone cannot establish a financial, stock or customer-delivery effect.
The relevant financial, fulfillment and support tests inspect their distinct
effect records. No authorization headers or credentials enter catalog reports.

The Woo RMA scenario has two explicitly different records: an original Woo
source snapshot in the independent source database and the canonical local RMA
in the core database. The latter is identified as `composed_local_rma` with
`native_return_id: null`. The independent Woo row must remain unchanged and the
retained native tests require zero native return creation. A Woo refund record,
gateway acceptance and gateway settlement movement are also separate records.
The manual scenario requires `refunded_payment: false` and pending settlement.

The 296 oracle pins include existing native test/helper bytes, transitive source
imports, all 31 commerce migrations, consumed fixed skill/fixture resources,
commerce contracts and the new independent expected fixtures. Adapter source
discovery also refuses an undeclared `.mts` implementation. Protected test IDs,
test paths, capability labels and the expected selected-case set cannot be
silently removed or reassigned. A reviewed source change requires deliberately
refreshed catalog pins and new evidence; updating a catalog hash is not an
acceptance decision.

Optional author capture sets `RIFARE_CATALOG_EVIDENCE` to an owned output
directory outside Git. It writes `direct-source-observations.json`,
`retained-native.tap` and `retained-native.json`. Those contain synthetic
fixture observations and runner identity. They are evidence outputs, never
inputs that can make a future run pass.

## Author mapping audit closure

A read-only author-assistance session found the following gaps before the
catalog source checkpoint. It did not grant independent acceptance. All fixes
remain in the same owned catalog/binding paths; existing native tests were not
edited or weakened.

| Finding | Correction and executable proof |
|---|---|
| Replacement fulfillment had only an unfulfilled-creation assertion | Added the already-selected positive `M06-G06-NATIVE-DELIVERY-REQUIRED`, which actually fulfills and delivers the fixture replacement. |
| Descendant resolution had only invalid-binding rejection | Added `CASE-M06-G06-01`, including a valid descendant refund and settlement. |
| Paired-money command had only a dropped-final-binding refusal | Added `CASE-M06-G08-01`; `CASE-M06-G07-01` also explicitly covers allocation binding. |
| Woo gateway settlement had only forged-stage rejection | Added `CASE-M07-G02-01`, which performs fixture settlement and checks its independent movement. |
| Shopify and Woo fresh cache success was unproven | Added `shopify_cached` and `woo_cached` common-engine scenarios; retained refresh evidence is attached to the actual refresh operation. |
| OpenAI transcript/model-refusal entries pointed at Anthropic-only cases | Added separate OpenAI and Anthropic stateless/unapproved scenarios and `M07-G05-CATALOG-PROVIDER-TRANSCRIPTS-01`; no provider thread IDs or unapproved-model wire calls. |
| Simulator declared every grant as a minimum requirement | Each read now requires its own `READS` scope; binding descriptors separately expose the actual configured grants. |
| Four unversioned sources had catalog-invented release labels | Shopify returns, Woo events, local model and signature helpers use their actual source SHA-256 as the version. |

## Evidence and remaining qualification

Permanent tests reject source-free success, forged native references, missing
adapters/operations/fixtures/bindings, altered source/test pins, changed exact
case IDs, version/API/scope drift and unsupported capability upgrades. The
root-owned engine also retains the goal's HTTP-200-only fault obligation.
The catalog author captures an additional version/scope validator mutant after
committing source, retaining exact mutant bytes and the repaired control.

The final candidate still needs the unchanged complete native gate and the two
separate nonauthor reviews. No connected store, gateway, helpdesk, sender or
model account has been authorized or qualified. External API/account/scopes,
provider behavior, delivery, settlement, physical inventory, target host and
target PostgreSQL/React qualification remain unperformed. The preparation here
does not publish a package to a registry, send real messages, charge a payment,
enable production or accept a formal milestone.

Rollback removes only these additive catalog modules/tests/fixtures/docs after
their source and evidence are retained. It requires no migration, capability
change, data rewrite or modification of an existing adapter.
