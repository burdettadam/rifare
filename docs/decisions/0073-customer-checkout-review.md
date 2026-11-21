# ADR-0073 — Customer checkout review

Status: delegated bounded assignment before implementation.
Protected base: `15bd309d79b41bd4611ded8b62fd6becec07b560`.

## Assignment and outcome

The owner's instruction, "proceed with next milestone," assigns **RCG-5C customer
checkout review**, following reviewed RCG-5B original preparation recovery.
Continue authorized local development, Git integration and publication. Formal
acceptance, release tags, production and paid effects remain separate.

Serve `/checkout-review` through the existing diagnostic commerce server. With
an already verified customer session and existing preview/context references,
the page reviews the original proposal, explicitly prepares it once, observes
the original intent, recovers an uncertain preparation and cancels by the last
server-observed revision. This is a local customer review surface; it does not
place an order or establish provider approval, payment or final use.

Reuse the existing native API and recovery contracts without modifying either.
No preview creation, receipt/JWS upload, source/trust/context provisioning,
endpoint configuration, automatic polling/retry or provider transport is added.
The diagnostic session entry is a password input; credentials stay in memory.
Original references never go into URLs, history, browser storage or logs.

## Unknown outcomes and private presentation

Freeze original references before preparation and immediately disable another
preparation. A timeout, aborted fetch, invalid response or other unconfirmed
result leaves an unknown outcome; aborting a request is not rollback. Only an
explicit lookup may recover the same identity. Absence never enables a replacement
or retries preparation. Lock reference changes while this identity is retained;
explicit local clearing explains that server work is not undone.

Cancellation binds the exact last accepted intent ID and revision. Conflicts or
unconfirmed cancellation require explicit status; never retry automatically.
No client-derived revision, refreshed deadline or replacement identity is allowed.
Validate and bound response envelopes, operation, false execution authority,
historical qualification, identity, revision/state, amounts and timestamps.
Invalid or denied responses clear prior personal details and disable actions.

Generation fences and aborts cover fetch, body reading and every continuation.
Clearing/changing a session invalidates pending results, clears references and
personal DOM, and removes the input credential. Page exit/back-forward restoration
must not restore private data. Rendering uses text nodes, current server fields
and finite local messages. Minimized, cancelled and revoked views never retain
an earlier preview's purchase details. Expiry invalidates local action availability
without claiming a server transition. Use keyboard-accessible, responsive markup
with clear loading, empty, unknown and unavailable states.

## Writers and allowed paths

Root integration writer owns `feat/rcg5-checkout-review` in its isolated worktree,
the static asset registration in `apps/commerce-api/server.mts`, new
`tests/development/delegated-checkout-browser.test.mts`, any new focused test-only
helper under `tests/development/`, and
`tests/browser/delegated_checkout_review.py`. A separate implementation writer
owns only three new files on an isolated branch from this committed assignment:
`apps/commerce-api/checkout-review.html`, `checkout-review-client.js` and
`checkout-review.css`. Root integrates that writer's commits; the implementation
writer cannot author either independent review.

Root adds `docs/DELEGATED-CHECKOUT-REVIEW.md`, this ADR and
`work/records/RCG-5C.md`, and updates relevant architecture, development, current
plan and roadmap links. Under ADR-0008, append source membership, real test IDs
and a proposed capability, and update only the licensing source-count observation
and its explanation. Refresh only assigned privacy/catalog source hashes and add
required new page/runtime pins with bounded privacy descriptions. Retain every
prior path, surface, schema, adapter, operation, case, fixture and obligation.

Preserve all old test and oracle bytes, the original API/recovery contracts,
native owners, Python client, existing process fixtures/controllers, dependency
manifests, migrations, record schemas, acceptance ledger and workflow policy.
Do not repair unrelated inherited catalogue closure/count or TypeScript debt.

## Evidence and review

Before implementation, navigate an actual local Chromium browser to the missing
route on this assignment's protected application and record its non-200 response
against the required served page. A missing import/runtime is not this red.
Permanent tests must navigate the actual served HTML/CSS/JS and actual loopback
native API, not mount copied component source or substitute successful facts.
Use the existing fresh fixture with zero initial intents. For a lost response,
forward exactly once to the real route, observe its successful commit, then
discard delivery. Independently assert original identity/count and unchanged
commerce/source effects. Bound host work/output and clean owned resources.

Cover ordinary review/prepare/status/cancel, preparation and cancellation response
loss, absence without retry, stale revision, invalid/late responses, session
clearing/revocation, cross-reference refusal, masked history, keyboard/mobile
presentation, credential non-persistence and no extra network/effects. Actual
served Chromium evidence is limited to this local plain-browser surface; it does
not qualify React/PostgreSQL, connected providers, an OS sandbox or full RCG-5.

Run focused whole files within the documented default budgets. Fix the candidate
for independent authority review by `next_scope_audit` and regression review by
`http_regression_review`, with at most three corrective rounds. Bind commands,
reports and retained controls to exact sources; distinguish author execution,
independent execution and source-equivalence observations. Raw evidence stays
ignored; concise review records and restore instructions go into the separate
Git handoff. Publication is authorized, but prior credential/connector write
failures remain technical limits; require new access evidence before repeating
the same blocked write. Preserve verified bundles when publication is unavailable.
