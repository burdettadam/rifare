# Policy customization review

Base: ddfcbb6. Prior authority: ADR-0016, commit 214db94.
Review method: same-assistant delegated maintainer, not independent reviewer sessions.
Scope: M02-G03 through M02-G07, local nonrelease integration only.

## Observed findings and corrections

1. The draft diff compared normalized outcome sets against an unnormalized base.
   An unchanged set appeared modified and undo showed a residual diff. The exact
   failing boundary/diff/undo assertions were retained and passed after comparing
   both sides through the same canonical compiler.
2. Scheduled versions could activate out of sequence, allowing an older scheduled
   version to supersede a newer one. The regression first failed with a missing
   exception. Publication now requires monotonic activation times in addition to
   expected-head checks. Scheduling changes require a future explicit lifecycle.
3. Replacing a trusted v2 skill with legacy v1 could bypass its import approval.
   The downgrade regression first failed. Protected IDs now reject legacy replacement;
   removal does not erase their approval history as a downgrade bypass.
4. Installation checked approval expiration/revocation but not current approver
   authority. A demoted approver reproduction first failed. Installation and resource
   access now recheck active membership and the current approval action permission.
5. The draft surface needed stricter visibility than published read profiles.
   Unpublished drafts are limited to operator/owner/reviewer sessions, retaining the
   old public profile behavior. A worker-read negative case protects this boundary.

## Canonical boundaries retained

One policy evaluator serves testing and pinned decisions; one scenario builder serves
simulation and request validation; one configuration compiler normalizes diff and undo.
One skill store serves legacy/current read interfaces. The new installer supplies
scoped approval, not a replacement agent framework. Existing source tests and stable
IDs remain unchanged. New native tests are separately registered with explicit goals.
No source of money, permissions or approval authority is derived from model text.

Native tests cover role/tenant separation, current permission revocation, policy and
profile races, serialization, field provenance, immutable expectations, hostile input,
resource integrity, decompression limits, directory links and downgrade denial.
The browser component uses a real loopback API via an explicit bridge; actual served
navigation remains a separate unqualified condition. Local example actors are synthetic.

## Integration decision and evidence

Final integration requires the existing full suite, the previous external regression
baseline, behavioral fault demonstrations, clean candidate identities and restore
verification. Expected hashes and controller outputs are retained outside source.
This record does not stand in for a passing report. See the delivered verification
and evidence packages for executed commands, exact commits, failures and results.

Accept useful diagnostic source for local integration after passing checks under
DELEGATED-LOCAL-07. Leave full goal/milestone acceptance, production posture, native
PostgreSQL/React and connected qualification unresolved. Do not create a release tag,
remote publication, actual store change or payment operation.

## Bounded native-suite timeout adjustment

The expanded unsharded native suite exceeded the old local wrapper's 120-second
process limit. That failed attempt is retained; it is not a passing test run.
The delegated maintainer authorizes changing only `tools/test_runtime.py`'s process
limit to 240 seconds, matching the existing separately pinned controller's suite
limit. Per-case assertions, zero/skip/failure checks and product latency targets do
not change. New helper tests explicitly check the bound and rejection of misleading
results. The old baseline must report this protected-path change before a reviewed
baseline is adopted; no candidate flag may bypass that response.
