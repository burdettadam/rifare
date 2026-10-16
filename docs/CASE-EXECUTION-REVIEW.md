# Review: case configuration and execution boundaries

Authority: [ADR-0017](decisions/0017-case-pins-gateway-and-inbox.md), committed
before implementation as c94509e. Base: a8bdafa. Scope: M02-G08 through M02-G12.
Same-assistant delegated maintainer review is not an independent reviewer session.
Local diagnostic integration is separate from goal/milestone/release qualification.

## Findings and corrections

1. A reviewed rollout row could change percentage without invalidating its
   evaluation digest. The digest now covers rollout, author and exact content,
   and every non-draft transition verifies it. The pre-fix test demonstrates
   reviewed 10-percent data being accepted as 100 percent; it now fails closed.
2. A rejected revoked-bundle installation could replace valid current content
   before returning its error. Revocation and approval validity now run before
   mutation and again within the transaction. The previous current digest remains.
3. Proposal, configuration and case-migration operations checked permissions before
   acquiring a write lock but not afterwards. They now recheck current authority
   after acquisition. Publication/review/rollback and installation use the same
   discipline. Deterministic interposition tests remove permission at that boundary.
4. A store disabled while a verified event waited for the database lock could
   still receive an acknowledged inbox insert. Store activity and the immutable
   route/key mapping are now checked again after the lock. The failing lifecycle
   test is retained, along with a true separate-process acknowledgement/reopen test.
5. The new standalone demonstration initially requested a nonfixture clock from
   the existing simulator and was correctly rejected. It now uses the original
   fixed seed and explicitly ingests the current diagnostic order observation.
   The simulator was not relaxed to make the demo pass.

The initial red run captured five real failing assertions. A separate lifecycle
red test caught inactive-store acknowledgement. All corrected tests passed. The fixed implementation's full suite, externally pinned regression run,
mutation checks and restoration outcomes are reported with actual counts and
commit hashes in the separate delivery report, not inferred from this document.

## Security/authority review

The synthetic action only changes a local plan marker; no provider API, arbitrary
callback, amount override or code execution enters its executor. Approval and
mutation share one transaction, with a real two-process consumption test. The
retained customer proof is checked at execution and is not called payment consent.
Source/configuration changes require a new preview. Completed receipt access is
separate from permission to execute new work.

Signature verification operates on bounded original bytes. Shopify header
routing is deliberately not considered authenticated by a body-only HMAC;
quarantined events cannot dispatch. Database errors cannot be hidden by returning
a successful acknowledgement. The process host and SQLite file remain trusted;
this is not a sandbox against native-code/database administrators.

## Regression review

No previous executable test is edited or removed. All prior registrations,
benchmarks, package inputs, goal specifications and capability contracts remain.
New test registrations and protected fixtures are additive. The source-count
fixture changes only for enumerated added paths; distribution membership is
updated explicitly. Existing read routes, skill schemas and the default diagnostic
startup retain their behavior. No accepted product status is invented.

## Decision

Integrate the reviewed diagnostic source locally after actual retained/new tests
and the pinned controller pass. Preserve original branch heads and migration
history. Do not issue a release, configure production effects, mark PostgreSQL/
React qualified, treat fixture signer events as live Shopify evidence, or count
synthetic role identities as independent human reviewers. Remaining external
qualification is visible in the implementation guide and prior milestone records.
