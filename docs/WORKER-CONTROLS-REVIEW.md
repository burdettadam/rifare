# Worker controls: delegated maintainer review

Scope: M02-G18–M02-G22 from `936be5c`. ADR-0019 was committed before implementation
as `ac726f9`. The same assistant implemented and reviewed these changes under the
owner's delegated local integration authority. No independent reviewer identity,
formal milestone acceptance, payment permission or release authorization is implied.

## Findings corrected

1. A lease originally checked order identity but could target another case for
   that order. A new regression reached the gateway and demonstrated the missing
   case boundary. Exact case identity is now required before any proposal/effect.
2. Historical worker results originally validated their grant/session but not
   current resource permissions. A test narrowed the agent's permissions and
   still retrieved a prior result. Result reads now recheck case and order access.
3. Queue ownership initially selected the first case sharing an order. A two-case
   test returned the wrong case. The queue now resolves the exact source receipt.
4. Queue event sources were concatenated rather than ordered. The final timeline
   test interleaves claim, queued receipt and release times; results sort by event
   time, retaining original source records rather than rewriting receipts.
5. Narrow-screen operation identifiers widened the UI. An additive stylesheet
   wraps identifiers and controls. The unchanged 390-pixel assertion now passes.
6. An in-flight refresh could restore facts after sign-out. A held real API response
   reproduces the leak. Sign-in/sign-out now changes a UI generation; stale fetch
   and action completions cannot repaint the new session or signed-out screen.

Raw exploratory failures include two test-fixture mistakes (missing execution
envelope and a nonexistent logout helper), subsequently corrected. They are not
counted as behavioral regression evidence. The final review tests retain their
assertions, and separate controlled mutations verify the relevant boundaries.

## Controls preserved

No previous executable test file, registration, goal requirement, package input,
benchmark or accepted-goal record is weakened. Nested transactions use savepoints
so the existing gateway and durable records remain one atomic transaction. The
new migration backfills stamps for previous operations without rewriting their
payload, identity, receipt, unknown result or migration checksum.

A worker cannot approve its own proposal; existing different-actor approval is
still enforced. A global stop is not a tenant endpoint. Credential tests use only
synthetic registered probes; no network or paid model call is hidden in evidence.
Reconciliation uses the original pinned journal and never calls its send operation.
The source remains runnable without the independently implemented Python client.

## Evidence and limitations

The separate delivery evidence includes native reports, previous-controller pins,
actual subprocess lease races, browser/API bridge checks, red/green findings,
controlled mutants, demo output and restoration reports. Only runs against the
fixed final candidate count as acceptance evidence. Results from changing working
files are exploratory and marked accordingly.

Production database/admin resistance, operating-system isolation, remote OAuth,
actual credential provider cutovers and direct served-browser qualification are
not established. Bounded queue scanning reports truncation. Local maintenance
approval does not complete the M02 milestone. See WORKER-CONTROLS.md for supported
commands, finite limits and the synthetic-effect boundary.
