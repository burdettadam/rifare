# Receipt evidence in checkout review

RCG-5D connects the existing customer review page to Rifare's existing receipt
verification API. A customer supplies a signed receipt they already received for
the prepared original intent. Rifare verifies it through its native receipt and
intent owners and displays the resulting **historical evidence**. This remains
the local plain-browser/SQLite diagnostic profile. Checking a receipt does not
place an order, authorize payment or consume external provider authority.

The assignment is [ADR-0074](decisions/0074-checkout-receipt-review.md). Actual
source identities, verification and outstanding gates belong in the
[work record](../work/records/RCG-5D.md); the existence of this guide is not evidence
of a passing check or formal milestone acceptance.

## Use the existing original record

Start with [customer checkout review](DELEGATED-CHECKOUT-REVIEW.md). Use the
already verified customer session and original preview/context references,
review the proposal and prepare it once, or recover its original preparation.
When a current native observation shows an unexpired prepared intent with no
receipt evidence, the page offers a **Signed receipt** field and **Check receipt**.

1. Paste the already-issued compact receipt into the masked field. No file,
   provider URL, issuer key, context or expected claims are accepted.
2. Choose **Check receipt**. The field clears before the single request is sent.
   The request identifies the same native intent already observed on this page.
3. On a valid native response, the page shows **Evidence observed**, the updated
   revision and **Historical evidence observed**. It retains no raw signed receipt
   in the rendered record.
4. If the response is unconfirmed, use **Check status** explicitly. It reads that
   same original intent. Do not prepare a replacement or resubmit the receipt.

The field is unavailable for missing, expired, cancelled, revoked, minimized or
already verified records, and while another operation or outcome is pending.
Changing sessions or clearing/restoring the page removes its input and local
record. Clearing does not undo server work or revoke the server session.

## One on-page attempt and uncertain outcomes

Before dispatch, the controller records that a receipt attempt was made for this
retained on-page identity. Duplicate activation, transport failure, timeout,
invalid response, refusal and a later `prepared` status do not reset that fact.
An absent observation does not establish that the original request had no effect.
Status reads and cancellation retain their existing native owners and exact
identity rules. Cancellation uses the newest accepted revision; a receipt
observation followed by cancellation uses that observed receipt revision.

The [native API](DELEGATED-CHECKOUT-HTTP.md) still supports its existing exact-token
idempotency and conflicting-token refusal. This page's more restrictive behavior
does not alter that contract. A deliberate local reset starts a fresh page state,
so the on-page guard is not a global exactly-once claim. Durable native identity,
receipt binding and current authority checks remain authoritative.

Responses received after a local clear, session replacement or observed action
deadline cannot repopulate the prior receipt review. A deadline can make local
actions unavailable without establishing a server transition. Explicit status
can still obtain historical evidence under the server's current proof checks.

## Data and authority boundary

The unchanged request is:

```http
POST /v1/delegated-checkout/receipt
Content-Type: application/json
Authorization: Bearer <existing customer session>

{"intent_id":"<observed original intent>","compact_jws":"<already-issued receipt>"}
```

The input must preserve the exact compact bytes and fit the existing
100000-character ASCII compact bound. The browser checks only bounded syntax; it
does not decode claims, choose an issuer, provision trust or decide whether the
signature grants authority. The existing native owners repeat the relevant
current-state checks around verification.

The page uses same-origin relative paths, omitted cookies, redirect refusal and
no-store behavior. Its existing strict response decoder enforces the bounded
body, operation, original identity, revision and historical qualification. A
successful receipt response additionally requires native receipt evidence and
an advancing revision. `execution_authorized` remains false throughout.

Raw compact bytes exist only in the input and transient request lifetime. The
field clears before dispatch and whenever the current record becomes ineligible.
The page does not put the token into displayed messages, URLs, browser storage,
logs, retained views or generated reports. It does not claim physical memory
zeroization, recall of clipboard copies or control over browser extensions.

## Focused verification

Use the existing supported Node runtime and optional pinned JOSE installation:

```sh
python3 tools/install_receipt_runtime.py --offline
python3 tools/dev_tests.py --files tests/development/delegated-checkout-receipt-review.test.mts
python3 tools/dev_tests.py --files tests/development/delegated-checkout-review.test.mts
```

The first file exercises the page controller against the actual native loopback
API with real ephemeral signed fixture receipts. It covers successful verification
and cancellation at the new revision, local invalid/oversized input, wrong
binding/signature, actual committed response loss, no-effect uncertainty,
malformed success, late clear/session replacement, action and body expiry, and
page-lifecycle clearing. Controller tests do not qualify a served browser.

On a permitted Linux Chromium/Playwright host, run each browser file separately
under its unchanged invocation budget:

```sh
python3 tools/dev_tests.py --files tests/development/delegated-checkout-receipt-browser.test.mts
python3 tools/dev_tests.py --files tests/development/delegated-checkout-browser.test.mts
```

The new five-case file navigates the actual served assets and native API. It
covers receipt capture and revision-bound cancellation, a real committed response
discarded before delivery, wrong binding, a late response after clearing, and
keyboard submission at a 390-pixel viewport. Each case checks one original intent,
expected native state/revision, unchanged commerce/source effects, no external
requests or storage disclosure, and the existing guardian's cleanup result.
The original nine cases and all 48 original worker assertions remain applicable
to their original scenarios. The guardian, process budgets and application CSP
are unchanged. These cases are not comprehensive accessibility qualification.

The current gate is complete on clean candidate
`40fc9738743fd6555ded780b4e5457e2e72f965f`: all 33 controller/native HTTP cases,
five new receipt browser cases and nine existing browser cases passed with zero
skips or failures. The browser invocations took 23.219 and 37.446 seconds under
their unchanged 60-second budgets. Both independent reviews found no scoped
blocker. The [work record](../work/records/RCG-5D.md) identifies original reports,
runtime capture limits, protected-base red, independent supplemental probes and
documentation-only source equivalence. This completes the bounded local check;
formal milestone acceptance and the full cross-service journey remain open.

## Provider dependency remains separate

The refreshed upstream inspection on 2026-11-21 observed Marty UI main
[`f662bb3`](https://github.com/ElevenID/marty-ui/tree/f662bb326bd0a83eb8191dc002bc3db57ec08cc3)
and open draft [PR #1994](https://github.com/ElevenID/marty-ui/pull/1994) at
`f226585513c7ca57148cab1dd1af7a68cab7591b`. Its
[runtime candidate](https://github.com/ElevenID/marty-ui/blob/f226585513c7ca57148cab1dd1af7a68cab7591b/docs/delegated-use-runtime-candidate.md)
contains retained internal `START_USE`/`FINALIZE_USE`, authenticated internal HTTP,
actual nested JWT-VC issuer/holder verification, durable machine audit and receipt
linkage, and concrete Flow/proof/nonce/receipt transaction ownership. Managed
receipt signing now has a reported passing disposable TLS OpenBao/Redis gate for
Ed25519 and ES256. These internal components should not be rebuilt in Rifare.

The [internal use router](https://github.com/ElevenID/marty-ui/blob/f226585513c7ca57148cab1dd1af7a68cab7591b/rust/services/delegated-authority/USE_HTTP.md)
is explicitly assembled; no delegated-use executable or public Gateway installs
it, and the human command host still rejects start/final use. Independently
qualified full-machine/MAP, issuer/status, attestation and current policy sources,
authenticated wallet/proof ingress, reviewed serving roles and the outer deployed
HTTPS receipt adapter/production custody remain open. Public consumer contracts
and unresolved-claim reconciliation also require qualification. Public MIP remains
0.5.0, with support/discovery unchanged. These are source-inspected provider
claims; this Rifare continuation did not rerun the provider's suites.

All provider `FINAL_USE` results remain `EVIDENCE_ONLY`. Rifare continues to own
orchestration, domain permissions, budgets, reservations, business idempotency,
provider execution and outcomes. A provider decision does not establish merchant
acceptance or payment. No provider source or private vectors are copied here.

RCG-4B requires the published authenticated current-state/final-use/original-outcome
contracts and their qualified runtime. Consume them through the normal public
Gateway; do not invent routes or read private provider storage. Full RCG-5 still
requires the actual isolated Rifare/provider/merchant journey, followed by the
connected RCG-6 profile. Remote sender binding, managed trust, merchant execution,
React/PostgreSQL and production qualification remain open.
