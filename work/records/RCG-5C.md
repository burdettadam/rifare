# RCG-5C — Customer checkout review

Assignment: [ADR-0073](../../docs/decisions/0073-customer-checkout-review.md).
Protected base: `15bd309d79b41bd4611ded8b62fd6becec07b560`.
Root writer: `feat/rcg5-checkout-review`.
Assignment committed before implementation at `ae1edc3`; host observation at
`d73a89b` before product changes.
Status: implemented local candidate; supported-host served-browser execution
passes all nine cases, with refreshed independent evidence review tracked in the
separate Git handoff. No formal acceptance or release.

Deliver the actual served local checkout review page over the unchanged native
API and recovery owners. Review existing references, prepare once, recover the
original uncertain request, observe history and cancel by observed revision.
Retain in-memory session handling, exact response binding, private-data clearing,
explicit unknown outcomes and no purchase/provider effects. Receipt upload,
preview/context creation, remote caller authority and full RCG-5 remain outside
this assignment. Independent reviews and exact source/report bindings belong in
the separate Git handoff; this work record cannot approve itself.

## Pre-implementation host observation

The initial Chromium launch fails before navigation: the execution environment
denies the startup socket. The connected browser cannot reach this workspace's
loopback server (`ERR_CONNECTION_REFUSED`). Neither is a behavioral red or a
browser pass. A separate actual native HTTP request on the assigned base observes
the missing page route (required 200, actual 403), with zero initial intents.
This supplies the missing-route behavioral red. Implementation continues under
the existing delegation; the actual served-browser gate remains required and
must be reported blocked unless run on a supported host. Preserve the failed
startup evidence and permanent served-page tests; do not weaken an old test,
substitute component mounting or claim browser qualification from HTTP alone.

## Delivered local behavior

The [customer review guide](../../docs/DELEGATED-CHECKOUT-REVIEW.md) describes the
served page and its unchanged native API composition. Existing proposals can be
reviewed and prepared once; original references freeze before preparation or
lookup. Unknown/invalid responses and recovery absence never enable replacement
preparation. Explicit status and a separate cancellation confirmation bind the
observed original ID/revision. Historical minimized/cancelled views remove earlier
purchase/receipt details. The wordmark remains static document content.

The client uses finite local messages, strict bounded UTF-8/JSON decoding,
duplicate-member refusal, exact envelope/identity/qualification checks, a
ten-second request/body deadline and generation fences through every asynchronous
continuation. Original deadlines are checked again at actions. Session changes,
local clearing and page lifecycle events remove dynamic details and local session
state. No URL/storage credential, raw receipt display, polling, retry, new provider
transport, native owner or purchase effect is introduced. Currency display uses
the existing presentation helper's seven supported exponents; other native codes
remain unavailable for display rather than receiving guessed precision.

The root integrated the separate three-file writer's `7b9c88d` and narrow markup
fix `fb4a6e0`. Root owns the static route registration, tests, guide and controls.
The implementation writer is not an independent reviewer.

## Author evidence and remaining gate

The actual native HTTP missing-route red has SHA-256
`48ca7f025304c52577bd1c3661bd3d9bee4d9f826c638d6339da009fbe1d9d2b`.
It observed required 200 versus actual 403 before the static page registration,
with zero initial intents. The separate failed Chromium startup is infrastructure
evidence only; its first raw metadata contains a truncated base field, corrected
by the full protected base in this work record and the HTTP red record.

The first author selection passed 21 actual cases in 14.253 seconds, including
the actual ten-second incomplete-body deadline. Its report is
`evidence/development/20261121T014235.244214Z-be104b/report.json`, SHA-256
`215142a422d22585bb5377f5b2781841c6e459e8343fb4a092dbfd64dc3c554f`.
This was a dirty integration checkout before the static wordmark correction and
registration refresh, not an independent final-candidate run.

The file has one actual HTTP asset case and twenty controller cases. A minimal
test DOM runs the real client/presentation code against the native server; it
does not establish browser/layout/CSP/accessibility behavior. Lost-response
faults await a real native commit before discarding delivery. Tests independently
check one original intent, revisions, unchanged native/source commerce digests,
no automatic retry, actual history startup, and empty sensitive dynamic DOM.
The separate nine-case browser file loads the actual served page. It retains its
host requirement and cannot be accepted by substituting controller evidence.

Independent authority and regression reviews must bind the fixed candidate and
distinguish observed behavior from the blocked browser gate. Their concise
records and exact evidence hashes belong in the separate Git handoff. The
preliminary TypeScript inspection reports no diagnostic in the four new test
entries; a fair complete baseline comparison is still required, and no clean
whole-project typecheck is claimed.

## Preserved controls

Retain all 1,773 old source members and append fourteen (1,787 total, inventory
revision 52), all 3,584 old case rows and thirty-three new rows (3,617 total), all 228
old capabilities plus one proposed capability, and all 949 specifications. The
nine browser rows remain obligations even when their host is unavailable.
The 347 old test source/helper paths remain, with eight new test paths. The three
owned-process cases do not launch or qualify Chromium.

Privacy retains all 353 old runtime pin paths and fifteen surfaces, adding the
HTML/client paths (355 total) and refreshing the server hash. The schema and
extensions are unchanged; CSS stays in the normal source inventory. New browser
memory descriptions fit the existing 3000-character field bounds. The catalog
retains all 696 oracle pins and refreshes only the changed server pin. Prior
adapters, operations, cases, fixtures and inherited closure/count issues remain.
Licensing changes only the assigned source-count observation/explanation.

No old test, original API/recovery contract, native owner, Python caller, process
fixture/controller, dependency manifest, migration, record schema, acceptance
ledger or workflow policy is changed. Structure and whitespace checks passed
after the narrow HTML wordmark correction.

## Continuation and publication

### Review round 1 correction assignment

Both independent reviewers found that the detached Python browser helper could
outlive the development runner's whole-invocation SIGKILL deadline. The installed
Playwright driver also launches Chromium in a separate process group, so merely
removing Python detachment would move the leak. Round-one code reviews request
changes for this test-harness ownership defect; their 21 new and 51 old passing
cases, strict 811/811 comparison and nine browser startup failures remain prior
evidence. No product authority defect was found in that scope.

Assign a bounded test-only correction before implementation: a Linux child
subreaper guardian at `tests/browser/checkout_review_process.py`, a shared Node
launcher at `tests/development/delegated-checkout-browser-process.mts`, and three
focused lifecycle cases in `tests/development/delegated-checkout-browser-process.test.mts`.
The guardian receives a parent-owned stdin pipe, survives the outer Node group
termination, and reaps only its own descendants, including separate process
groups. Normal completion still uses the worker's public Playwright cleanup;
parent loss/deadline uses bounded owned-process termination. No system-wide
process scan, new service, scheduler, caller-selected command or old runner
change is authorized. Forced termination may leave owned temporary files; no
forensic erasure, OS sandbox or supported non-Linux cleanup is claimed.

Root retains integration/test ownership. A separate writer may author only the
new guardian and Node launcher in an isolated worktree from this correction
assignment. The original nine served-browser cases and their host gate stay
required. Demonstrate the old leak and the corrected actual runner timeout with
a harmless worker and separately grouped descendant; distinguish that lifecycle
evidence from Chromium execution. Append the three new source paths and actual
test IDs to existing controls without changing earlier obligations. Refresh the
fixed candidate, independent reviews and bundles after the correction.

The targeted lifecycle red used the unchanged development runner with a
two-second whole-invocation deadline and the original detached-helper pattern.
Both the harmless worker and its separately grouped descendant remained live
after the Node process group was killed (required survivors: zero; actual: two).
The reproducer then stopped both exact owned process groups. Its result has
SHA-256 `cbcda391d1fa48c5e6f60c383f291155e6d9c1c266d3de2c9a595a592dd24888`.
This is process ownership evidence, distinct from the browser startup failure.

Root implemented the assigned guardian, shared launcher and lifecycle checks.
The launcher retains the prior environment allowlist and 16384-byte output
bound; a separate bounded descriptor carries process-only metadata. The three
probe cases retain exact process start times and use pidfds for failure cleanup.
Their success assertions distinguish disappearance of the original worker and
descendant from the orphan guardian merely stopping.

The current host accepts the child-subreaper setting but does not expose its
own-task `children` interface. The guard fails closed at that prerequisite,
before spawning any worker. The lifecycle obligations remain unqualified,
and the revised browser wrapper is also refused before browser startup.
Neither refusal is a passing cleanup observation. The earlier round-one
Chromium startup failures remain evidence for the separate browser host limit.
The original review finding is mitigated in proposed source but remains
unverified; do not close it from source plausibility alone. No system-wide
process scan, host escalation, test skip or substitute browser pass is added.

### Review round 2 nested-runner correction

On clean candidate `2cf0653`, the independently executed 21 HTTP/controller
cases passed again. The first two lifecycle cases failed at the own-children
prerequisite, while the third failed earlier: the nested Node runner inherited
the enclosing test context and refused recursive `node:test` execution. Its
actual exit was 1 rather than the required intentional timeout 124. The raw
three-case report has SHA-256
`ca586127897d965e7aa69ec411fe7f51b9daa3e643e91af0968f7de5d86edd32`.
This was an additional harness defect, not a third host-prerequisite observation.

The narrow correction supplies the nested development runner only `PATH` and
the current Node executable through `RIFARE_DEV_NODE`. It preserves the actual
unchanged runner, two-second fault deadline, required native case and assertions.
Reaching the guardian's setup refusal can verify the environment correction;
it cannot verify the required descendant cleanup. The third and final independent
review round must retain that distinction and keep the original cleanup and
served-browser gates open without supported-host passing evidence.

Next, run the served-browser gate on a permitted host, resolve findings and
refresh independent review before expanding the customer flow. No full RCG-5,
provider final-use/reconciliation, remote sender-bound, React/PostgreSQL or
production qualification is supplied. This increment does not refresh external
provider refs; the last reviewed provider-contract limits remain visible.

Publication remains authorized. Prior native Git credential and GitHub connector
permission failures are still technical limits; no identical blocked write is
repeated without new access evidence. Preserve verified native/handoff Git
bundles and reconcile remote refs before later publication. No hosted push, PR,
CI result, merge or release is claimed by this work record.

### Supported-host browser diagnosis assignment

The existing authorized AWS development host now runs the unchanged candidate
`d060f2ae2d669e9eb733c5cac41ab0bd2f186b67` with a private, verified Chromium
runtime. The first actual served-browser run executes all nine cases: two pass,
seven fail, with zero skips or cancellations. Absence and invalid-binding cases
pass; the ordinary preparation journeys and late-clear case fail. This is an
actual browser red, not the previous startup prerequisite refusal. The original
runtime and red evidence archive has SHA-256
`dd58e46badfc8be4d7b9b75e523f3bb11273c8efaed369012521c9467fecaded`.
Its raw failure logs remain private because a Playwright listener traceback can
include a short-lived synthetic loopback fixture session header.

Under the owner's continuing development instruction, assign a bounded test-only
diagnostic correction before implementation. Root owns the existing browser
worker and related source-pin refresh. Capture the primary failure before
cleanup, using only finite operation labels, allowlisted error classes and a
worker-local line number. Retain cleanup and route-listener failures separately
and keep either failing. Do not emit exception messages, call logs, request
bodies, headers, input values, arbitrary paths or tracebacks. No product change
is assigned until this diagnostic identifies a concrete defect.

Preserve the nine case IDs, original assertions, native effects checks, guardian,
runtime identity, browser options and time/output budgets. Keep the first red
and the three earlier review rounds unchanged. A focused diagnostic run may
locate the first failure; qualification still requires the entire unchanged
nine-case obligation and independent authority/regression review of the fixed
candidate. This continuation does not reset an unresolved review finding,
claim acceptance, or expand the product scope.

### Browser wait correction assignment

The focused actual `RCG5C-BROWSER-NATIVE-JOURNEY` diagnostic on `dd0c296`
reached the cancelled-state wait after successful preparation, status and
cancellation actions. Its primary failure is at that wait, with no callback or
cleanup failure. A second source-bound diagnostic on `b921ad0` identifies the
finite `csp_eval_blocked` category at the same step. Both preserve the original
source and runtime before and after execution; neither is a nine-case pass.

The installed Playwright 1.62.0 driver caches function predicates, while plain
expression predicates are evaluated again during polling. The three remaining
plain-expression waits observe late clearing, revocation and cancellation. The
page's unchanged policy refuses the later string evaluation. Assign only the
equivalent `() =>` function form for those three existing predicates. Preserve
their exact conditions, every assertion, all nine case IDs, route faults, native
effects checks, existing deadlines and the page's content security policy.
No application or native API change is needed for this observed harness defect.
Run the full nine-case file on the fixed candidate and retain all earlier reds;
independent review still determines whether the evidence closes this gate.

### Supported-host passing execution

The complete browser file passes all nine cases on fixed candidate
`3db6507330486cdf3df0216601a27d4bca182778`, tree
`dee126d1b5536a9e023bdaa79c54259c704287b1`. The unchanged development runner uses
its normal 60-second whole-file budget; elapsed time is 48.893 seconds, with
zero failures, skips, cancellations or diagnostic callback/cleanup failures.
Each passing case also completes its original native intent-count and unchanged
commerce-effects assertions. All nine required owned-process cleanup assertions
pass. No independent guardian PID trace was retained beyond those assertions.

The original source hashes and 99 recorded runtime-file hashes match before and
after execution. The raw final archive, including both focused diagnostic reds,
installed wait implementation observations and the full passing report, has
SHA-256 `8d38ac8c033c9d46bbccb0cbfd6015caa48ac24fbaec20bde9634e9b893bc2ab`.
It remains private generated evidence. The earlier 2/7 red and every setup
failure remain separate retained records. No test skip, deadline expansion,
CSP bypass, application change or native owner change supplied this pass.

The same host previously passed three lifecycle and 21 HTTP/controller cases
on `d060f2a`. Their application, native fixtures, guardian, launcher and test-entry
bytes are unchanged by this correction. The outer-timeout lifecycle case copies
the changed browser worker into its temporary Git fixture for source inventory;
its unchanged `probe-hold` path executes the guardian's inline probe instead of
that worker. Carry forward the prior lifecycle execution with that explicit
copied-source distinction. Current documentation advances only the recorded
state; it is not a fresh execution on a later documentation-only commit.
Independent authority/regression findings, exact review hashes and durable
restore instructions belong in the separate Git handoff. Full RCG-5, provider
final use/reconciliation, React/PostgreSQL and formal acceptance remain open.
