# Compatibility and quality limits

The compatibility exporter builds a local diagnostic matrix from current adapter
declarations, original source observations, scored model observations and an
independently supplied review record. It never enables an adapter, provider,
runtime, action or external account. Every output carries
`execution_authorized: false` and `production_qualified: false`.

## Generate a report

```sh
node --experimental-strip-types tools/compatibility-matrix.mts
node --experimental-strip-types tools/compatibility-matrix.mts --input evidence/compatibility-input.json
python3 tools/dev_tests.py --files tests/development/compatibility-matrix.test.mts
```

The first command reads the installed catalog and exports its adapter/API/source
versions, operation semantics, required scopes and known gaps. It publishes no
model quality row without observations. The second accepts a versioned JSON input
of `{ "schema_version": 1, "rows": [...] }`. Neither command runs the conformance
catalog or makes a provider call. Standard output is the minimized matrix; exit
1 means an unsupported row or invalid catalog, while exit 2 means invalid command
or input. Store reports under ignored `evidence/`.

### Row contract

Each row has exactly `id`, `subject`, `requirement`, `evidence` and `review`.
Missing evidence/review may be represented by null and produces an unsupported
row. The native test file contains an executable synthetic example using the
existing source evaluation fixture and two existing native conformance bindings.
Its reviewer identities are fixture inputs, not real reviewer attestations.

| Input | Binding and required content |
| --- | --- |
| `subject` | ID; original evaluator configuration including provider, model, model digest, skill digest and profile revision; runtime ID/version, engine name/version and local source pins; platform/payment/fulfillment adapter IDs and versions; model capabilities; granted scopes; configuration, policy and prompt digests. Payment and fulfillment may be null. |
| `requirement` | ID; `read_only`, `copilot`, `approval_required` or `bounded` tier; frozen evaluator suite digest and exact case IDs; critical case IDs; minimum correct handling in parts per million; required model capabilities and exact adapter operation pairs. |
| `evidence` | ID; exact subject digest; observation/expiry times; active or revoked state; original evaluator suite/configuration/observations; unchanged `runCatalogFixtures()` report containing its actual source snapshots. |
| `review` | ID, author and different reviewer IDs, active state, review/expiry times, exact subject/requirement/evidence digests, and `allow_diagnostic_scope` decision. Any other decision leaves support disabled. |

Use `subjectDigest`, `requirementDigest` and `evidenceDigest` from
`packages/conformance/compatibility-matrix.mts` for the normalized SHA-256 pins.
The existing evaluator's `suiteDigest` preserves the original suite's exact JSON
ordering contract. The review must come after the observation and bind the exact
scored scope. Evidence/review windows cannot exceed 24 hours, include a future
start, or remain usable at or after expiry. Revoked inputs fail immediately.

These digests establish content identity. They do not authenticate the person or
system that supplied a file. The integration owner must retain the reviewed
inputs independently. Arbitrary JSON supplied by a model or downloaded from an
untrusted source is not an authenticated qualification record.

## Evidence and quality decisions

`packages/agent/evaluation.mts` recomputes source identity, expected facts, allowed
actions and required handoffs from the original observations. An input such as
`passed: true` is rejected. Exact case membership is required; failed, pending
and cancelled outcomes stay in the denominator. Correct handling must meet the
reviewed threshold, which cannot be lower than 95%, with zero critical or
authority failures. The matrix exports counts and case IDs without the original
customer facts, prompts or wire requests. Unknown cost and latency remain null.

The existing five-case status fixture still scores **2/5**: one grounded answer
and one correct handoff. Fabricated facts, an unauthorized action and a pending
result remain failures. A separately frozen one-case read-only scope can pass its
own diagnostic checks while the broader scope remains unsupported. The one-case
example demonstrates exact scope isolation; it is not sufficient evidence of
general model quality or a resolution benchmark.

Direct conformance evidence is rechecked against the existing catalog and its
pinned independent fixture. The exporter verifies adapter/API/source versions,
fixture membership, unique observations, before/after source digests, actual
record counts and the fixture's expected source fields. A response or pass label
alone cannot substitute for source observations. All direct scenarios declared
for a requested operation must be present. Operations with native-only evidence
remain unsupported by this importer; the existing native reports are retained
for their separately reviewed checkpoint and are not replayed or pooled here.

Current status evaluations cover facts and handoffs. They cannot qualify a
return-resolution action. `copilot`, `approval_required` and `bounded` rows
therefore retain `ACTION_QUALIFICATION_REQUIRED`, even if their factual score is
perfect. The existing `SupportQualification` implementation owns the separate
frozen action suite, calculated score, current reviewer authority, case pins,
approvals, inspection and monetary limits. The matrix neither copies nor replaces
that execution boundary.

## Current version and qualification envelope

The machine-readable `adapter_limits` section comes from the 25-adapter,
123-operation catalog. The examples below are descriptions of local declared
contracts, not independently observed external API compatibility.

| Component | Declared API/contract | Limit |
| --- | --- | --- |
| Shopify order and return fixtures | `2026-10` | Local wire/source fixtures; configured account and real API qualification absent. |
| WooCommerce orders, events, local RMA and refund fixtures | `wc/v3` | Local RMA has no native Woo return ID; manual refund record does not prove settlement. |
| Woo payment gateway fixture | `local-original-payment-v1` | Separate synthetic original-payment source; acceptance and settlement observation remain distinct. |
| Resolution payment source | `local-resolution-source` | Exact source SHA-256 version; synthetic refund, credit and payment obligations only. |
| Fulfillment source | `local-fulfillment-source` | Exact source SHA-256 version; no carrier, warehouse, delivery or physical service qualification. |
| OpenAI adapter | `responses/v1-unversioned` | Injected wire transcript; no actual model quality is inferred. |
| Anthropic adapter | `2023-06-01` header | Provider-specific injected transcript; no cross-provider result copying. |
| Local model adapter | `api-tags-chat-snapshot` | Exact adapter source digest; no installed model weights or inference qualification is inferred. |
| Return runtimes | Pinned TypeScript or Python client source and explicit engine version | Evidence is for the named runtime only; changing source, engine or configuration requires fresh reviewed observations. |

Unavailable catalog operations stay unavailable. Required scopes cannot be
inferred from a similar adapter, and a missing model capability invalidates the
row. Changing provider/model/weights, runtime/engine, platform/payment/fulfillment
version, skill/profile, configuration, policy or prompt invalidates the exact
subject binding. Changing a pinned runtime file or catalog source independently
invalidates the result even if someone updates the surrounding report hashes.

## Runtime readiness and rollback

Call `compatibilityReadiness(row, context)` with fresh current configuration,
evidence and review inputs when a local diagnostic is requested. It recomputes
readiness; it does not consume an earlier matrix's supported label. Its
`diagnostic_ready` result applies only to the exact read-only diagnostic scope.
It always returns `execution_authorized: false`. Existing permission checks,
support qualification, ownership, approval and gateway execution stay authoritative.

This change adds no schema or persistent customer-data table. Rollback removes
the additive exporter, module, test and guide after retaining source and evidence.
Formal M05/M06/M07 acceptance, connected accounts, real model performance,
independent-machine and target-stack qualification remain open under ADR-0033.
