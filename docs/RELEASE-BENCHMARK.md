> Current development decision: accepted under delegated bootstrap authority; see [ADR-0004](decisions/0004-delegated-development-authority.md). Original submission/proposal wording below is retained for audit and is not the current acceptance state. No product qualification or independent review is implied.

# Rifare release benchmark — proposed revision 1

**Status: proposed; human approval pending.** Goal M00-G02 prepares an executable
measurement contract, not a product release, pilot authorization or completed
M00 milestone. Its proposed M00-G01 dependency is still awaiting acceptance.

[Machine-readable benchmark](../planning/release-benchmark.json) is canonical for
this proposal. [Scenario inventory](../planning/benchmark-scenarios.json) pins all
676 existing specification IDs and their individual content digests, including
all 67 original seeds. There are 481 v1-candidate specifications and 195 expansion
specifications. These counts are **not** executed scenarios, merchant outcomes,
or proof of the 200-product-variant gate. No existing specification is rewritten.

## Scope, categories and severity

The benchmark pins `rifare-post-purchase-v1` revision 1 and its exact source bytes.
Unknown or excluded action/context combinations cannot silently become supported
because a benchmark result looks good. A scope change needs its own accepted
decision and updated qualification. The current checker is deliberately
non-authorizing even for a structurally valid supported scenario.

The inventory assigns a category by owning milestone: governance/development,
identity/read-only, policy/action safety, returns, order editing/fulfillment,
support/tracking/autonomy, advanced returns, portability/operations, shipping,
conversion/marketing, warranty/disputes/partners, procurement, and the ecosystem.
Original case severity, layer, ownership and expected-behavior digest remain
unchanged. A scenario specification's importance is distinct from the severity
of an actual observed incident.

Observed severity uses SEV0 critical, SEV1 high, SEV2 major and SEV3 minor, with
criteria and response ownership in the benchmark. SEV0/SEV1 findings block the
affected configuration even when they occur in an excluded case. An excluded
operation should be rejected safely; its exclusion does not excuse an
unauthorized effect. Severity cannot be lowered to make a metric pass.

## Proposed gates

| Gate | Proposed threshold | Evidence boundary |
|---|---|---|
| Mandatory safety | 100% applicable mandatory assertions; zero duplicate or unauthorized effects | Actual executed assertions and source-system reconciliation, not the specification count. |
| Correct handling | At least 95% separately for each declared quality configuration | Every enrolled in-scope failure, pending case and cancellation remains in that denominator. |
| Minimum quality stratum | 20 in-scope cases per configuration | Proposed minimum for interpretable measurement, not statistical proof; requires owner decision. |
| Product coverage | At least 200 unique executed v1 product variants | Include unseen cases and targeted faults; repetitions across models do not multiply unique scenarios. |
| Pilot | Three independent real merchant profiles, 100 in-scope live outcomes, 30 consecutive calendar days | Merchant approvals, actual exposure and observation records; synthetic profiles never count. |
| Related repeat contact | Seven complete days after a resolved case; 100% coverage of mature windows | Missing mature follow-up makes the rate unavailable; younger resolutions remain visibly immature. |
| Portability | Two commerce platforms, two independent runtimes, two cloud-provider configurations and one local endpoint | Report supported subsets and quality per actual configuration. Two models in one runtime are not two agents. |
| Open findings | Zero unresolved SEV0 or SEV1 findings | Independent review on the integrated candidate, not an author-written approval field. |

The 95%, 200-variant and 3/100/30 pilot targets retain the existing roadmap.
The 20-case per-stratum minimum and concrete operational targets below are new
**proposed decisions**, not asserted approved limits or industry benchmarks.
There is no required autonomous-resolution percentage: incentives must not reward
unsafe automation or avoidance of a necessary human handoff. Aggregate correctness
cannot qualify a poorly performing configuration.

## Frozen enrollment and scoring

Keep membership separate from the outcome file. Before results are known, a
benchmark custodian freezes a versioned cohort manifest with unique case IDs,
sources, scope IDs/reasons, expected resolution/handoff/rejection, exact
platform/profile/skill/policy/runtime/model/mode strata and a UTC observation
cutoff. Each result binds that manifest's retained SHA-256. This is one bounded
cohort, not a rolling ingestion or experiment service.

Every enrolled case must have exactly one outcome record, including pending,
failed, cancelled and excluded cases. Duplicates, extra successes, absent failures,
changed scope fields, inconsistent source labels and after-the-fact enrollment
fail validation. Results do not get a field for choosing their own denominator.
A cancelled/withdrawn case is not silently removed because it is inconvenient.
An authorized data-removal obligation requires a documented cohort decision and
minimized permissible records; data need not be unlawfully retained to preserve
an experiment. That operational process remains later pilot work.

The helper never pools synthetic, connected-test and live sources. It separates
configuration strata, preserves exclusions and all-case safety findings, and
returns rational numerator/denominator values plus six-place decimal displays.
Threshold comparisons use integers, not rounded display percentages. Empty
populations are not evaluable, not 100% successful.

### Implemented arithmetic

- Correct handling includes independently correct required handoff, but handoff
  is not autonomous or completed resolution. Pending/unassessed cases contribute
  zero correct outcomes without leaving the denominator.
- Autonomous resolution needs an eligible frozen expectation, a correct resolved
  agent outcome and a compatible mode. Human completion or required handoff
  cannot be relabeled as autonomous success. Record all attempts separately.
- Related repeat contact uses all mature resolved dispositions, including an
  incorrectly closed case. Multiple related contacts count once. Incomplete
  observation is shown, not treated as no repeat contact. A repeat contact is
  reported separately from correctness of the original action.
- Cost categories are integer USD minor units for model, messaging, shipping,
  hosting and operator costs. Report in-scope and all-enrolled known cost totals.
  Cost per correctly resolved case excludes handoffs from the divisor, but keeps
  failed/pending-case costs in the numerator. Missing costs or operator time make
  the corresponding full-population average unavailable, not zero.

The benchmark also specifies contribution margin, financial reconciliation,
appeals and satisfaction. Their accounting/instrumentation is **not implemented**
in this document helper. Later pilot and commerce goals must bind real native
records, cost allocation and outcome attestations.

### Independent arithmetic example

[Hand calculation](../tests/fixtures/release-benchmark/HAND-CALCULATION.md) defines
12 entirely synthetic records, ten in scope across two configurations. Correct
handling is 6/10, autonomous resolution is 3/10 (or 3/8 eligible), handoff compliance
is 2/2 and mature repeat contact is 1/4. Five resolutions include one immature
window. Four are correct resolutions, yielding cost 1,000/4 = 250 USD minor units,
not 1,000/6. The example fails quality/sample-size targets and contains explicit
synthetic safety findings. It is not product performance.

[The literal expected fixture](../tests/fixtures/release-benchmark/expected-cohort.v1.json)
is independent of the scorer; its values are not generated from the tested code.

## Proposed load and recovery profile

| Dimension | Proposed reference target |
|---|---|
| Application | 4 vCPU, 8 GiB RAM |
| Database | 4 vCPU, 16 GiB RAM, 100 GiB storage |
| Data | 10 stores, 100,000 orders, 1,000,000 events, 100 concurrent sessions |
| Sustained traffic | 20 HTTP requests/second and 50 ingested events/second |
| Run shape | Five-minute warm-up, 30-minute measurement, five-minute 2x burst |
| Local response p95 | Reads 250 ms; durable write acceptance 500 ms, excluding external waiting |
| Reconciliation | Normal target five minutes; alert unresolved obligations at 15 minutes |
| Retry budget | At most five reconciliation attempts per 30-minute window, backoff capped at five minutes |
| Recovery | 15-minute ordinary-state RPO, 15-minute backup interval, 60-minute restore RTO |
| Restored writes | Zero live writes until required native reconciliation and fencing complete |

These are an owner-reviewable starting deployment class, **not measured capacity
or an SLA**. Qualify hardware, storage/network, data shape, provider limits, errors,
timeouts and nearest-rank p95 under M07's recovery/load goals. Show end-to-end
latency separately. A local durable acceptance is not provider settlement or
warehouse fulfillment. Retry budgets concern reconciliation; a timeout does not
permit blind repetition of an irreversible operation. Restoring a database alone
does not meet the RTO or authorize live workers.

## Actual commands and test bindings

```sh
python3 tools/check_release_benchmark.py --root .
python3 -m unittest discover -s tests -p test_release_benchmark.py -v
python3 tools/verify.py
```

The first command validates proposal structure and source pins. It does not
compare an external accepted baseline unless that baseline and its independently
retained digest are explicitly supplied. The full helper suite additionally
compares the local frozen proposal fixture; local fixture equality is regression
protection, not authenticated approval.

```sh
python3 tools/check_release_benchmark.py --root . \
  --baseline tests/fixtures/release-benchmark/expected-benchmark.v1.json \
  --baseline-sha256 <independently-retained-benchmark-sha256> \
  --manifest tests/fixtures/release-benchmark/cohort.manifest.SYNTHETIC.json \
  --manifest-sha256 <independently-retained-enrollment-sha256> \
  --results tests/fixtures/release-benchmark/cohort.results.SYNTHETIC.json
```

See [the fixture commands](../tests/fixtures/release-benchmark/COMMANDS.md) for
literal digests for this illustrative revision. In real qualification, do not
ask the candidate under test to supply its own trusted digests.

| Stable requirement | Actual executable test |
|---|---|
| CASE-M00-G02-01 | `ReleaseBenchmarkTests.test_CASE_M00_G02_01_hand_calculated_cohort_matches_every_aggregate_value` |
| CASE-M00-G02-02 | `ReleaseBenchmarkTests.test_CASE_M00_G02_02_missing_in_scope_failure_invalidates_cohort` plus the required-handoff classification checks |
| CASE-M00-G02-03 | `ReleaseBenchmarkTests.test_CASE_M00_G02_03_frozen_gate_change_or_false_live_label_requires_review` plus CLI frozen-manifest checks |

The declared fault is dropping a failed in-scope case from scoring. Additional
regression probes cover handoff inflation, weakened gates, false source labels,
missing follow-up and ignoring excluded safety failures. Actual fault results
and candidate-bound reports live in the separate ignored evidence package.

## Trust and limitations

The CLI verifies and parses the same retained bytes. It rejects duplicate JSON
keys, invalid shapes, mismatched digests and incomplete enrollment. Hashes provide
identity, not truthful observations or authenticated human authority. A fabricated
oracle reference and consistently fabricated input files require independent
source review to detect; this helper is not an attestation or signature service.
Its Python scoring API assumes the caller has performed the same verified-input
loading used by the CLI. Never expose it as an unchecked production endpoint.

Even an arithmetic report meeting every displayed numerical target has
`release_qualified: false`, `pilot_authorized: false` and
`verified_live_observations: 0`. Labeling declared input as live does not make it
attested live evidence. Original product test statuses remain `not_run`.

Threshold, formula, inventory, scope, source and stratum changes require review
under the previous accepted controls. A revision bump is not permission to lower
a gate. Accepted data intake, signing, stored-pilot instrumentation, infrastructure,
load execution, commerce actions and release decisions remain their later goals.
