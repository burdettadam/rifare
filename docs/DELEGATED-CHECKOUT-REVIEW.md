# Customer checkout review

RCG-5C adds `/checkout-review` to the existing local commerce application. The
page reviews an existing proposal, saves its original preparation once, recovers
an uncertain response, observes retained history and explicitly cancels the
local preparation. It does not submit a purchase, authorize payment or prove
provider final use. This remains the plain-browser/SQLite diagnostic profile.

The page uses the unchanged [checkout API](DELEGATED-CHECKOUT-HTTP.md) and
[original preparation recovery](DELEGATED-CHECKOUT-RECOVERY.md). Native customer
proof, original identity, privacy, revision and expiry owners enforce authority.
The browser does not create sessions, previews, contexts, receipts or provider
connections. [RCG-5D receipt evidence review](DELEGATED-CHECKOUT-RECEIPT-REVIEW.md)
adds one explicit submission of an already-issued signed receipt to the same
native API. The existing Python caller remains independently usable.

## Use the page

Open `/checkout-review` on a configured local commerce server. It retains the
existing exact loopback host/origin policy. A development parent or existing
application supplies the already verified customer session and original
preview/context references through its private channel. They are not URL inputs.
The disposable test fixture supplies them privately to the test process; the
page itself exposes no fixture provisioning route.

1. Enter the existing **Customer session** and choose **Use session**. The
   password field clears and the session stays in page memory.
2. Enter the **Original preview ID** and **Original context ID**. Choose
   **Review proposal** to obtain the current native preview and its original
   totals/deadline. The original context is checked by the native preparation
   owner when preparation is requested.
3. Choose **Prepare once** to save the reviewed proposal. This retains local
   evidence and does not order or pay for anything.
4. Use **Check status** for a known intent. Use **Recover original** when the
   preparation response was lost, or when opening retained history from the
   original references. Recovery works even when live preview owners are absent.
5. To cancel, choose **Cancel preparation**, review the confirmation and choose
   **Confirm cancellation**. The request uses the exact observed ID/revision.
   **Keep preparation** dismisses the confirmation without sending cancellation.

For a current prepared original with no receipt evidence, the receipt-review
extension provides **Signed receipt** and **Check receipt**. The masked input
clears before one submission. An unconfirmed result requires explicit status and
does not enable another submission. See the separate receipt-review guide for its
data boundary and focused checks.

An unconfirmed preparation locks its original references and disables another
preparation. Recovery absence does not prove that creating a replacement is safe.
An unconfirmed cancellation or revision conflict requires explicit status. There
is no background polling, automatic mutation retry, new identity or revised
deadline. Aborting a browser request never means the server rolled it back.

**Clear this page** drops local session, references and displayed details. It
does not undo server work or revoke a server session. Typing a different session
also invalidates the previous page state. Page exit and back/forward restoration
clear the local state; no browser storage is used to resume an uncertain request.
The caller must retain the original references through its authorized channel if
it needs to recover history after leaving the page.

## Display and response boundary

The page renders current server fields as text, with exact minor-unit formatting
through the existing presentation helper and explicit UTC time presentation.
Receipt evidence is described as historical evidence, never as paid/completed
checkout. Cancelled, minimized or revoked views remove earlier purchase details.
Source failures and denied/invalid responses remove prior details and action
availability. The page does not display raw receipts or context payloads.

Requests use same-origin relative paths, omitted cookies, no-store caching and
redirect refusal. Responses have a 262144-byte bound, strict UTF-8/JSON decoding,
operation/identity/qualification checks and a ten-second request/body deadline.
Every asynchronous continuation checks the current session generation. Local
deadlines only invalidate display/actions; they do not invent a server outcome.
The existing CSP permits only local scripts, styles and connections. No external
fonts, images, telemetry or provider endpoints are added.

Dropping references is not forensic memory zeroization or recall of screenshots,
clipboard copies, browser extensions or data already returned to another caller.
Native privacy controls continue to govern later reads and retained records.

## Focused checks and the browser gate

Install the unchanged optional receipt runtime from its existing offline cache:

```sh
python3 tools/install_receipt_runtime.py --offline
python3 tools/dev_tests.py --files tests/development/delegated-checkout-review.test.mts
```

This file combines actual HTTP asset checks with explicitly labeled controller
tests. The controller runs the real client and presentation helper in a minimal
test DOM against the actual native loopback API. It is **not** a browser and
does not establish layout, CSP execution or accessibility. Real preparation and
cancellation responses are forwarded once and then discarded for the lost-response
cases. Independent native row counts/identities and source/commerce digests check
that the original intent is retained and no purchase effect occurs.

The separate actual served-browser gate requires Python Playwright **1.62.0**
and a permitted Chromium host. Existing browser test requirements are unchanged.
Select the host executable through `RIFARE_BROWSER_EXECUTABLE` when necessary:

```sh
python3 tools/dev_tests.py --files tests/development/delegated-checkout-browser.test.mts
```

Its nine cases navigate the actual server page, load the native HTML/CSS/JS and
use browser fetch against the real API. They cover the native journey, preparation
and cancellation response loss, absence, revision conflict, late clearing,
revocation and response binding. The mobile case checks overflow at 390 pixels,
the skip link and keyboard activation of cancellation; it is not a complete
keyboard-only or assistive-technology qualification. Tests block unexpected
origins/service workers, inspect storage/URL/cookies/logs and use bounded owned
process cleanup. The Linux child-subreaper guardian owns the worker and its
descendants, including Chromium's separate process group. A parent-owned pipe
detects the Node runner's termination; the guardian then terminates and reaps
only its own descendants. The same cleanup runs after normal worker completion
and a case deadline. It requires Linux subreaping and the readable
`/proc/self/task/<own-pid>/children` interface; missing prerequisites fail closed
before a worker is spawned. Forced process
termination may leave owned temporary files; this is not forensic erasure or an
OS sandbox.

## RCG-5C historical host qualification

Three separate process-lifecycle cases exercise normal completion, the case
deadline and the unchanged development runner's whole-invocation timeout using
a harmless worker and separately grouped descendant. They require the original
worker/descendant identities to disappear and the guardian to stop running.
Failed probes use retained process start times and pidfds for bounded fallback
cleanup, never a bare PID signal. Linux pidfd support is therefore also required
for these lifecycle checks:

```sh
python3 tools/dev_tests.py --files tests/development/delegated-checkout-browser-process.test.mts
```

These process checks do not launch Chromium or qualify browser behavior.
The original implementation host lacks the own-children interface and refuses
the corrected lifecycle cases before launching their workers. On the existing
authorized AWS development host, all three lifecycle cases subsequently passed
on native candidate `d060f2a`. Their exact evidence and the earlier nested-runner
correction remain in the separate Git handoff.

The initial implementation host denied Chromium's startup socket before any
navigation. Its connected browser could not reach the workspace loopback server,
and the execution policy rejected elevated execution. These are infrastructure
failures, not passing or skipped browser cases. The native missing-route red was
observed separately over HTTP before implementation. The guard also refuses the
browser cases on that original host before browser startup. Those retained
failures do not become passes because another host supports execution.

The AWS continuation uses a private Chromium library/font prefix without system
package installation. Its first actual nine-case browser run passed two and
failed seven. Bounded diagnostics identified a CSP refusal when Playwright
reevaluated a plain-expression wait during polling. The three affected waits
now use equivalent function predicates; all 48 assertions, nine test IDs,
native effect checks, budgets and the application's CSP remain intact.

The complete browser file passed **9/9** on candidate
`3db6507330486cdf3df0216601a27d4bca182778` in **48.893 seconds**, with zero failed,
skipped or cancelled cases. The run used Playwright 1.62.0 and Chrome for Testing
151.0.7922.34. Every case passed its required owned-process cleanup assertion.
The same host also passed the 21 HTTP/controller cases on `d060f2a`; their
application, fixtures and test bytes are unchanged by the browser correction.
Retain that source-equivalence distinction instead of claiming a fresh rerun.

See [ADR-0073](decisions/0073-customer-checkout-review.md) and the
[work record](../work/records/RCG-5C.md). Full RCG-5, connected provider outcomes,
remote sender-bound access, target React/PostgreSQL and production qualification
remain separate. Both final independent reviews found no scoped blocker, and
public checkpoint `4ac8556` preserves the exact source tree of native `413f849`.
The subsequent RCG-5D assignment changes shared page assets and requires fresh
focused controller and browser checks; this historical pass does not qualify
those later changes. Browser success is limited to the local diagnostic surface.
