# ADR-0074 — Receipt evidence in customer checkout review

Status: delegated bounded assignment before implementation.
Protected source base: `4ac855602b80652d76c54b6da25fcb905c57cdbe`.

## Assignment

The owner instructed: "proceed. use a free tier aws instance for development as
needed. push to github at will." Under the existing delegated development
authority, assign **RCG-5D receipt evidence review** after the independently
reviewed RCG-5C served-browser gate. Continue local development and publish to
the authorized Rifare feature branch. Use the existing authorized development
host only when the local environment cannot execute the required checks; this
assignment creates no instance, paid service, production effect or release.

The protected source is the published exact-tree checkpoint of native
`413f8493f1535c8de9696829a381322409d1d787`, tree
`0b9f76653995827b52ae2f908a17bc33ababcfbd`. Its public parent is `9336005`.
The connector publication has a distinct commit identity and does not recreate
the 47 native commits, which remain in the verified native Git bundle. New work
starts from the published checkpoint; neither history is force-replaced.

Extend `/checkout-review` with an explicit way to submit an already-issued signed
receipt to the **existing** `POST /v1/delegated-checkout/receipt` contract. The
request contains only the observed original `intent_id` and bounded
`compact_jws`. The unchanged native owners validate the receipt and return
historical evidence with `execution_authorized: false`. This extends ADR-0073's
page-only exclusion of receipt submission; every other authority and recovery
boundary remains in force. No context, receipt, key, preview, provider approval,
purchase or payment is created by this page.

## Observable behavior and privacy

Only a current, unmasked, unexpired, server-observed **prepared** original intent
without receipt evidence may expose the input. Require the existing current
customer session, no pending request, no unresolved outcome and no earlier
on-page submission attempt for that original identity. Use a labeled, masked
field with autocomplete and spellcheck disabled. Accept only the unchanged
compact format and 100000-character upper bound; never decode claims in the
browser or infer verification from their contents. Invalid local input sends
nothing and can be corrected before an attempt.

The explicit submit action freezes the original intent identity, disables another
submission and clears the field **before dispatch**. Keep raw receipt bytes only
in the transient request lifetime. Never render them, include them in messages,
URLs, browser storage, logs or generated evidence, or retain them in the sanitized
intent view. Clear the input when the session changes, the page is cleared or
restored, authority is denied, an observed deadline expires, or the current
record becomes ineligible. Do not claim physical memory zeroization.

Validate the response with the existing bounded strict decoder, exact envelope,
operation and original identity checks. A receipt success must contain the
matching native evidence state, receipt observation and monotonic revision;
no response may grant execution. Preserve the native receipt binding and current
authority checks rather than duplicating them in JavaScript.

An absent, lost, malformed, denied or late response does not establish whether
the native operation occurred. Retain the original identity and require explicit
status. Do not retry automatically, prepare a replacement, or re-enable receipt
submission merely because status reports no evidence. The native exact-token
idempotency contract remains unchanged, but this page permits at most one explicit
attempt per retained on-page identity. A deliberate local reset does not undo
server work and continues to explain that boundary. Cancellation remains bound
to the last accepted original revision and is unavailable while outcome is
unresolved. Generation fences cover both fetch and body completion. A receipt
response completed after the observed action deadline must leave details cleared
and require explicit status; it cannot repopulate an expired review.

Use the current visual system and keyboard/mobile behavior. Explain that checking
receipt evidence does not place an order, move money, consume provider authority
or prove current external approval. Keep diagnostic details secondary.

## Ownership and allowed paths

Root is integration owner and sole writer in `feat/rcg5-receipt-review` at
`rifare-rcg5-receipts`. A separate `receipt_review_impl` writer uses an isolated
branch/worktree from this committed assignment and owns only:

- `apps/commerce-api/checkout-review.html`, `checkout-review-client.js` and
  `checkout-review.css`;
- new `tests/development/delegated-checkout-receipt-review.test.mts`;
- an additive exposure of the existing ephemeral receipt values in
  `tests/development/delegated-checkout-review-helpers.mts`, with all existing
  fixture assertions and behavior preserved.

Root owns additive receipt scenarios in
`tests/browser/delegated_checkout_review.py`, the optional test input type in
`tests/development/delegated-checkout-browser-process.mts`, and new
`tests/development/delegated-checkout-receipt-browser.test.mts`. Preserve the
existing browser assertions, cases, deadlines, output bounds, Linux guardian and
cleanup requirements. Do not weaken a prior assertion to accommodate new cases.

Root also owns this ADR, `work/records/RCG-5D.md`, the new receipt-review guide,
and relevant links/current statements in `docs/PLANS.md`, `docs/ARCHITECTURE.md`,
`docs/ROADMAP.md`, `docs/DEVELOPMENT.md` and `docs/DELEGATED-CHECKOUT-REVIEW.md`.
Under ADR-0008, append
new source membership and real executable case IDs, a proposed capability, and
only `source_file_count` / `source_count_reason` in
`tests/fixtures/licensing/artifact-oracle.v1.json`. This is the exact membership
observation permitted by ADR-0008; every other oracle field remains unchanged.
`LICENSE-STATUS.md` contains no source-count field and needs no modification.
Refresh only the two existing
HTML/client pins in the privacy storage-surface contract; preserve all surfaces,
descriptions, schemas and prior paths. Update other protected pins only if their
exact assigned source changes and record the reason before the update.

No native owner, API/recovery contract, server route/CSP, Python client, process
fixture, dependency manifest, migration, durable record schema, existing test
case/behavioral oracle, acceptance ledger, workflow policy or workflow trigger changes are
authorized. Do not repair inherited catalogue or TypeScript debt here.

## Evidence and review

Write the focused behavioral tests first. Before changing application assets,
run a test against the actual native server and demonstrate that a prepared
original cannot submit receipt evidence through the existing page. A missing
runtime/import or unsupported host does not count as that behavioral red.

New controller/native HTTP cases cover the valid signed receipt, wrong binding
or signature, locally invalid/oversized input, response loss after an observed
native commit, unchanged or malformed success responses, explicit original status,
no repeat submission, stale/cleared sessions, expiry and sensitive-input removal.
Actual served-browser cases cover receipt verification, lost response and original
status recovery, refusal, a late response after local clear, and keyboard/mobile
submission. Each case independently checks original intent count/identity and
unchanged commerce/source effects. Receipts come from the already-existing
ephemeral native fixture; no successful facts or provider transport are invented.

Run focused whole files within their existing budgets. Run the unchanged RCG-5C
controller and served-browser files because these assets are shared; do not
substitute a helper-only pass for actual browser evidence. Do not add broad
unrelated regression runs. Required process cleanup remains asserted for every
browser case. Keep raw logs and signed fixture material private and ignored.

Fix the candidate for independent authority review by `next_scope_audit` and
regression review by `http_regression_review`, with at most three corrective
rounds. Neither implementation writer may author either independent review.
Bind results to actual source/runtime identities; carry later documentation-only
changes only by explicit byte equivalence. This assignment does not accept a
formal milestone, qualify full RCG-5 or turn local receipts into provider final use.

## External dependency

The current upstream inspection found continued draft work on identity directory
administration and organization approval. It still lacks published delegated
start/final-use and managed receipt-signing runtime endpoints. Rifare must consume
the normal public Gateway when those contracts exist; it must not import private
provider internals or read their database to bridge this gap. RCG-4B, remote
sender-bound access, the complete cross-service RCG-5 journey, React/PostgreSQL and
production qualification remain separate.
