# Three return policy packs, one core

M06-G14 records and evaluates versioned packs against the existing published
policy, profile, case, return eligibility and skill engines. Recording a pack does
not publish a policy, activate a profile, approve a return or grant a capability.
The pack retains the actual published policy digest, profile digest and archived
skill digest. A changed profile requires a new pack revision and a fresh matching
case configuration; revoked policy or skill authority blocks evaluation.

The synthetic fixture publishes these distinct values through the existing
draft/test/separate review/publish path and installs one unchanged `handle-return`
instruction bundle for every merchant:

| Pack | Window | Evidence | Outcomes | Locale | Review guidance | Destination restriction |
|---|---:|---|---|---|---|---|
| Apparel | 30 days | Normal policy evidence | Refund or exchange | en-US | Standard review | apparel-hub |
| Fragile goods | 14 days | Clean evidence required | Refund or exchange | fr-CA | Specialist review recommended | fragile-hub |
| Clearance | 7 days | Normal policy evidence | Store credit | en-GB | Policy-exception review recommended | clearance-hub |

All three exclude final-sale goods. Clearance also excludes goods tagged
`clearance`. Review guidance can recommend additional human attention; it cannot
reverse an exclusion, reduce the existing separate action-approval requirement or
turn a risk indicator into a denial. Actual evidence and override decisions still
use the existing scoped return-review controls.

The fixed matrix in
[scenarios.v1.json](../tests/fixtures/return-policy-packs/scenarios.v1.json) covers
ordinary day-three requests, day fifteen, final-sale goods and clearance tags.
It declares outcomes independently of the implementation. The fourth synthetic
merchant uses a different store and a renamed pack with the apparel data; neither
eligibility nor shared skill/core code changes with its identity.

## Server contract

`ReturnPolicyPacks.put` requires current configuration authority. Its exact input
contains `id`, `expected_revision`, published `profile_id`/`policy_id`, a list of
`required_capabilities`, destination restrictions and review guidance. Revisions
are append-only in `commerce_return_policy_packs`; historical rows retain their
configuration provenance. No customer data belongs in a pack.

`get` is a scoped staff configuration read. `evaluate` takes `pack_id`, the normal
return selection and an optional existing `request_id`. It obtains verified case
identity, current source facts, evidence state, unit reservations and eligibility
from the original `intakeEvaluation` function. It checks the exact pack/case pins
and reports the original policy rights independently from capability readiness.
It creates no receipt, purchase, refund, edit or label.

When destination routing is required, readiness needs an existing return request
and at least one currently eligible native destination within the pack's allowed
IDs. The pack cannot create a destination contract or replace G12's current
purchase-time validation. Unknown or unsupported capability names remain missing
even when profile guidance requests them. A case assessment is a preview;
current execution authorization remains in the canonical action gateway.

## Verification and recovery

Run the registered native `tests/development/return-policy-packs.test.mts` cases
with the repository's Node runtime and normal test flags. The suite checks all
three profiles, fourth-store identity invariance, publication/skill pins, strict
inputs, tenant/customer boundaries, revision conflicts, revocation, capability
denial and absence of financial/physical effects. The accompanying evidence
retains a temporary merchant-ID fault and its unchanged failing assertion.

Migration 029 is additive. Restore it with the preceding canonical schema and
preserve pack history alongside published policies and skill archives. Missing
M03/M04/M05 gates, component acceptance and connected service qualification remain
open; these synthetic evaluations do not accept M06 or qualify a real merchant.
