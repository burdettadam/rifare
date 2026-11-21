# ADR-0067 — Native synthetic checkout previews

Status: authorized bounded development assignment before implementation.
Base: `933600561a989150e2a2d3c4273a57ee84cdad52` on `development`.

## Owner instruction and assignment

The owner requested an audit of implementation and the plan, then instructed
“Proceed with development.” The audit identified native checkout preparation as
the next incomplete milestone and reproduced mutable-input and clock defects in
the separately staged composer. Earlier instructions favor local development and
testing, retain a Git handoff for Codex, and explicitly permit pushing changes.

Assign `RCG-2-NATIVE-CHECKOUT` as a standalone bounded development slice, following
the standalone-assignment precedent of ADR-0066. The root development agent owns
integration and the implementation worktree `feat/rcg2-native-checkout`.
Independent authority/security and regression agents review a fixed candidate.
This assignment does not amend the frozen 949 specifications, declare a canonical
Mxx goal accepted, or bypass goal-packet requirements in formal workflow gates.

## Outcome

- Integrate a synthetic frozen checkout preview with the existing `ShoppingCart`,
  native catalog, current customer proof and canonical digest owners.
- Require explicitly sourced shipping and fee quotes, scoped to the same cart,
  customer, resource, tenant and store; missing, changed or expired quotes deny.
- Give the server ownership of preview identity and scoped lookup. Retain the
  original frozen amount, deadline and bindings across asynchronous checks.
- Capture validated configuration and dependency functions, check integral clocks
  at completion, and reject mutation or stale authority at asynchronous boundaries.
- Add behavioral and independent-source checks while retaining the existing
  shopping tests unchanged. Register additive development tests and exact source
  membership under ADR-0008; no old baseline or expectation is weakened.

## Limits

The existing shopping cart uses an order resource. A preview remains a local
synthetic observation of that supported cart; it is not a general new-order,
payment, checkout execution, stock reservation or remote authorization API.
No public route, identity-provider contract, final-use redemption, custom JOSE,
OAuth transport, live source, paid effect, release or production deployment is
included. The store is the existing merchant boundary; no new merchant registry
is introduced. Any retained preview must deny access after current customer
authority, privacy or source validity is lost.

Additive tests remain `proposed_not_accepted`. Only the authorized acceptance
owner can decide formal qualification. Local commits and an authorized remote
branch retain the development result for review and continuation.

## Privacy source review

The native privacy inventory deliberately flags new runtime files. Include only
the reviewed new runtime pins and their classification in the existing
`privacy-storage-surfaces.v1.json` and `docs/PRIVACY-COVERAGE.md` after independent
review. Preview snapshots use bounded, expiring process memory; explicit fixture
quotes use the existing synthetic-fixture category. Preserve the original fifteen
surfaces, SQL schema, table assignments and handling clauses. This source review
is not an accepted-regression-baseline update or a claim of physical erasure.

### Inherited formatting pins discovered during registration

The clean source base already has ten runtime hashes left at their values before
formatting commit `85c547ac396e6ec897d65b9093fc8353550b306d`. They are exactly the
ten paths in the existing pinned formatting manifest. For each path, the declared
hash matches that commit's parent; formatting those exact original bytes with the
repository's pinned Prettier 3.9.10 and configuration reproduces the current source
byte for byte. No existing runtime file is modified by this assignment.

Include the bounded correction of those ten stale source observations in the
privacy inventory review. Refresh them only after independent review of this
reproduction, along with the three new runtime pins. Preserve all prior handling,
schema, table mappings, accepted baselines and qualification thresholds. The
correction records source already landed in the base; it does not approve a new
commerce behavior or silently accept unrelated drift.

### Linked adapter source inventory

The native privacy regression also validates the adapter source catalog. Register
the new quote fixture as an additional source file of the existing
`shopping_catalog_source`, and append its path to the matching declarations in
`tests/fixtures/conformance/adapter-catalog.v1.json` and
`tests/fixtures/conformance/expected-coverage.v1.json`. This is source membership;
retain every adapter, operation, scope, version, native case and direct fixture.
The quote setter remains server-local fixture administration and grants no
remote operation. The new checkout owner's behavior is separately described and
tested by its additive proposed capability.

Review and refresh the catalog's duplicate pins for the nine formatted commerce
files above and its stale command-manifest pin. The command-manifest bytes already
landed in `b7102d3ffc121326a8475062eef9878c9b157893`; its only change was the
root `package.json` hash for the authorized demo commands. Do not change that
fixture, the commands, behavioral expectations or the accepted baseline. Any
additional unexplained pin drift remains a review failure.
