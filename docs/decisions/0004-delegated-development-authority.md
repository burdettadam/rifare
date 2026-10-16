# ADR-0004 — Delegated decisions and local integration

Status: adopted by the delegated maintainer under the owner's explicit instruction.
Authority checkpoint: `ef5e9eb648082cbc59f36f20bba96772d5a45cef` (recorded before the branch merges).

## Owner instruction

> I delegate all decisions. Merge branches and continue with next goal.

This is the actual instruction in this development conversation, not a fabricated
review identity or a claim that a repository file authenticates its own author.
The implementing assistant now acts as delegated development/integration maintainer.
The owner can replace this delegation. Routine technical, product and workflow
decisions no longer wait for another owner confirmation.

## Decisions adopted

- Accept M00-G01's version-1 support envelope and charter, unchanged in substance:
  technically supported US physical-goods merchants; Shopify first; a bounded
  WooCommerce portability proof; domestic USD first; no unqualified support claims.
- Accept M00-G02's version-1 benchmark and pilot design without weakening its
  numeric gates, fixed cohorts, source separation or actual-observation requirements.
  Approval of the plan does not recruit merchants or constitute customer consent.
- Accept M00-G03's component inventory, distribution-review implementation and
  license direction: AGPL-3.0-only for the future application; Apache-2.0 for
  separable SDKs, public skill/templates and original developer/documentation
  material; preserve existing MIT-derived notices. Use inbound-matches-outbound
  and genuine DCO-1.1 certification for future outside contributions; do not
  invent or retroactively add a person's signoff or a copyright assignment.
- Keep this checkpoint local. No account, hosted remote, public artifact, release
  tag, paid service or production effect is needed for this goal.
- Adopt the existing two-reviewer / three-round workflow, model-neutral native
  Git and Python commands, one writer per worktree, and exact-candidate evidence.
  Assign M00-G04 next; do not start M00-G05 in this change.

## Bounded acceptance exception

The owner expressly requested integration of the prepared branches. There are no
independent reviewer sessions available in this execution. For M00-G01 through
M00-G04 only, the delegated maintainer authorizes **local nonrelease integration**
with passing retained checks and a disclosed author audit instead of pretending
that independent reviews happened. The exception replaces missing reviews only.
It cannot waive a failed/skipped test, multiple writers, stale evidence, known
blockers, unqualified product behavior, or a tagged/public-release approval.

The source implementation identities are M00-G01 `82c00a5`, M00-G02 `1994c44`,
and M00-G03 `5543540`; all remain preserved as branches and ancestors of main.
Their local acceptance is recorded in `work/accepted-goals.json`. The G04 record
will bind its actual candidate when it is complete. There is no independent-review
pass, signature, hosted protection or legal clearance claim.

## Historical proposals and remaining release work

The original proposal JSON and submission records remain versioned evidence of
what was proposed, including their original pending fields. This decision and
`work/accepted-goals.json` are the current development acceptance records. The
proposal-only helper reports do not authenticate or override these decisions.
No capability is runtime-qualified by accepting a planning goal.

The license **selection** is decided. Applying exact license texts and attributions
and completing a candidate-specific distribution review remain mandatory before
public distribution; the selected direction is not itself a license grant over
unreviewed code or third-party property. Any future intake must check actual
component rights; no exclusive owner of all upstream material is assumed.

## Review/control changes

This authority was supplied externally before implementation. It is not a worker
lowering its own tests. Frozen scope, benchmark, source scenarios, license proposal
and upstream notice bytes are retained. Source-inventory file counts may increase
only by explicitly recorded new paths; all previous paths must remain covered.
The next goal supplies explicit checks for candidate-bound reviews, one writer,
and the separation between local integration and tagged-release authority.
