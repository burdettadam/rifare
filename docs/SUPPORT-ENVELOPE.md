# Support-envelope contract and local checks

[Charter](CHARTER.md) · [Canonical JSON](../planning/support-envelope.json) ·
[Decision record](decisions/0001-first-release-support-envelope.md)

## Executable contract

`tools/check_support_envelope.py` is the standard-library executable shape and
reference validator for schema `1.0`. It checks exact required/allowed fields,
types, identifiers, uniqueness, reasons, accountable owners, condition references,
goal/target/invariant coverage, and claim-to-capability links. No external JSON
schema engine or new orchestration system is introduced.

A context has exactly `platform`, `payment`, `fulfillment`, `market`, `currency`
and `order_kind`. The action plus the complete exact tuple selects one row.
There are no wildcards, implicit inheritance or cross-product expansion.
Duplicate/ambiguous rows, duplicate JSON keys, missing evidence labels and
self-issued approval/qualification flags are invalid.

`planning/support-envelope.json` is the source of truth; do not maintain a second
hand-edited detailed table. Each row links to its owning goal and retained target
IDs. `capability_disposition` accounts for all 44 existing targets without moving
work out of its original milestone. The fixed false qualification/public-claim
flags apply to this proposal schema. Any future schema with accepted decisions
or qualification must itself be adopted through trusted review; a string edit
cannot supply that trust.

## Commands

Run from the repository root:

```sh
python3 tools/check_support_envelope.py --root .
python3 tools/check_support_envelope.py --root . \
  --scenarios tests/fixtures/support-envelope/scenarios.json
python3 -m unittest discover -s tests -p test_support_envelope.py -v
python3 tools/verify.py
```

For a single declared query:

```sh
python3 tools/check_support_envelope.py --root . \
  --query tests/fixtures/support-envelope/query-order-status.json
```

A valid query returns the planned label, reason, owner and conditions. It always
returns `execution_authorized: false`. Exit status 0 means the document/declared
check passed; it does not mean a commerce action can run. Exit 1 means a document,
scenario or baseline difference needs correction/review; exit 2 is invalid input
or an unavailable/untrusted baseline; exit 3 is an excluded or undeclared query.

## Retained contract comparison

In a future trusted review job, use an independently retrieved baseline and digest:

```sh
python3 tools/check_support_envelope.py --root . \
  --baseline /trusted/previous-support-envelope.json \
  --baseline-sha256 "$TRUSTED_SCOPE_SHA256"
```

The baseline path and expected digest must come from a maintainer-controlled
source, not the candidate branch. The checker reports additions, removals and
changes to capability rows, conditions, context definitions, claims, owners,
invariants and target dispositions. Bumping a revision does not bypass review.
A valid digest proves bytes, not reviewer identity or actual acceptance.

The bundled `baseline.SYNTHETIC.json` is only a regression fixture. It is never
an accepted Rifare scope. No hosted protections or trusted approval integration
are installed by this goal. The application-wide accepted regression baseline
remains unchanged and unaccepted.

## Permanent case bindings

| Stable goal case | Actual native test |
|---|---|
| CASE-M00-G01-01 | `test_support_envelope.SupportEnvelopeTests.test_CASE_M00_G01_01_named_scenarios_have_declared_outcomes` |
| CASE-M00-G01-02 | `test_support_envelope.SupportEnvelopeTests.test_CASE_M00_G01_02_unlisted_payment_requires_scope_decision` |
| CASE-M00-G01-03 | `test_support_envelope.SupportEnvelopeTests.test_CASE_M00_G01_03_deleted_baseline_row_blocks_same_claim` |

The first case exercises supported requests/status, conditional refunds and
explicit exclusions. The second uses a predeclared unlisted payment route. The
third removes a capability from the synthetic prior matrix without changing its
claim. The complete proposed contract has a separate frozen oracle to detect changes to
rows not covered by the named samples. Companion cases also remove both the claim and capability, bump the
revision, alter contexts/conditions, and try to turn an excluded/conditional row
into a broader promise. Expected outcomes are source-controlled fixtures, not
values computed by the resolver under test.

Raw candidate-bound output and fault traces belong in ignored `evidence/` and
separate review artifacts. Concise outcomes and review status belong in
[the work record](../work/records/M00-G01.md). A passing test suite cannot supply
the human charter decision or either independent review.
