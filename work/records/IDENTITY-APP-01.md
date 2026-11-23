# IDENTITY-APP-01 — External customer identity

State: **implemented and independently reviewed within the local development
scope; ready_for_review.** Formal product acceptance and production remain open.

| Identity | Value |
| --- | --- |
| Protected base | `62350ad824bf05aae1cbea56335150030d752ae2` |
| Assignment commit | `8aedefeb803bb7a199bb156ad135c3230ad3c77b` |
| Initial implementation | `549df565d98c1fe6e3ce4dfba8300f872bb8765c` |
| Intermediate native candidate | `073bc0cfbc20794fe9e2e7a650a00e287f00def9` |
| Corrected verification/review candidate | `8e1f7270cfac748b55a82d81430b21a07ec05080` |
| Reviewed source tree | `a4d1e090f4e75f5ed5e269b69fb6cb26bc4daa38` |
| Published implementation | [`003d558`](https://github.com/burdettadam/rifare/commit/003d558b580b43a03b1b37015c21b2d6d7f79d9a), identical reviewed tree |
| Branch / sole writer / integration owner | `feat/supabase-identity` / root / root |
| Assignment | [ADR-0082](../../docs/decisions/0082-external-customer-identity.md) |

## Implemented boundary

The owner selected a shared external authentication provider, using separate
Rifare and ElevenID clients. Rifare uses maintained `openid-client` 6.9.1 through
Medusa's public Auth extension. Native services own identity/customer persistence,
association, tokens, cache and locking. The adapter adds exact provider/client/
callback/algorithm configuration, S256 PKCE, state/nonce, explicit JWKS signature
verification, browser/actor binding and stable verified issuer-plus-subject keys.

Only issuer/subject and usable verified email enter identity metadata. Provider
tokens and arbitrary roles/merchant IDs are not persisted. Email never links an
existing account. Native customer creation is followed by reauthentication;
provider-email changes do not reassign or rewrite a customer. Five-minute customer
JWTs cannot become native sessions or be extended through refresh/MFA. Associated
development operators retain native login, refresh, sessions and logout. Operator
MFA routing is preserved, but enrollment lacks an encryption key and is unqualified.
The [guide](../../docs/EXTERNAL-CUSTOMER-IDENTITY.md) describes exact routes and limits.

The parallel Marty branch at `f7f05e76a6c33c4d67d3e303e5e4b832ab4238e0` already
supports external OIDC and separately configured managed PostgreSQL. Read-only
alignment confirmed its existing `client_secret_post` selector/default. Another
conversation owns Marty changes; no ElevenID repository or provider account was
modified. Shared login alone does not implement the ElevenID identity/trust/
delegation-to-commerce dependency. All existing protected commerce holds remain.

## Actual verification

Fresh executions used clean `8e1f727`, Node 24.22.3/npm 11.19.1, Medusa 2.23.0 and
the explicitly disposable PostgreSQL 17.12 database on loopback 15473. The independent
Node-crypto OIDC peer used 19036; Medusa used 19037 and a separate development logger
process used 19038. Native wrapper commands had the assigned 240-second bound.
Installation hooks remained disabled; no real customer/payment/provider account
was used. The layers below retain separate denominators.

| Verification | Actual result |
| --- | --- |
| Disposable reset, `npm run db:migrate`, `npm run test:identity` | **28 identity observation groups passed**, actual Medusa HTTP and PostgreSQL, synthetic OIDC peer. |
| Following `npm run test:commerce` | **17 unchanged commerce groups passed**, including native order/inventory/fulfillment/return/refund/cancellation records and public-route holds. |
| Focused development | **29 cases in three files passed**: six new external config, seven retained commerce config, 16 retained checkout-preview; 1.475 seconds within the 60-second bound. |
| Existing dependency intake | **8 runtime-intake + 14 receipt-intake tests passed**, separate bounded invocations. |
| `NODE_ENV=development npm run build` | Backend and upstream Admin/frontend passed, 8.29 and 10.56 seconds. |
| Repository / distribution checks | Passed within structural/source-intake scope; no release or binary qualification inferred. |
| `npm audit --omit=dev --json` | Zero reported vulnerabilities in this observation; not a permanent guarantee. |
| Isolated browser-binding fault | Unchanged wrong-browser assertion failed at actual HTTP **200** where **401** was required. |

Identity observations cover signed exchange/discovery/JWKS, browser binding,
ambiguous inputs/actor substitution, replay/concurrency, invalid signature/algorithm/
issuer/audience/nonce/expiry, absent/unverified claims, native customer association,
email collision/change, expiry and credential-renewal restrictions, and commerce
holds. Operator verification consumes its cookie for Admin and refresh, performs
DELETE logout, and rejects reuse. The separate development process starts with
`LOG_LEVEL=http`, observes native startup logging and HTTP 401, then confirms that
unique code/state/description/secret markers are absent from captured logs.

The focused command was:

```sh
python3 tools/dev_tests.py --files tests/development/external-identity-config.test.mts tests/development/commerce-backend-config.test.mts tests/development/checkout-preview.test.mts
```

Actual report: `evidence/development/20261122T071131.645860Z-a3cc9a/report.json`.
It binds clean source to `8e1f727`, with no unrun selected cases, and retains
`full_regression: false` and `goal_accepted: false`. Existing tests/oracles, root
dependencies, capability targets and acceptance-ledger entries are unchanged.

## Failures, corrections and independent reviews

The initial build lacked the new worktree's private configuration; setup was fixed
before the passing build. The first native callback failed because the independent
peer compared raw Basic credentials without OAuth form decoding. Its expectation
was corrected without changing library encoding. The next run reached customer
collision and observed upstream's actual `DUPLICATE_ERROR` HTTP 422, not the new
test's expected 400. The corrected oracle uses the independently inspected native
mapping and additionally checks error type and absent customer association.

Round-one security review found the inspected Supabase implementation itself does
not form-decode Basic credentials before UUID parsing. The corrected adapter uses
explicit maintained `ClientSecretPost`, requires discovery support and binds the
method into state. The peer independently form-decodes a UUID client and secret
containing `+`/`:`. There is no custom Basic encoder or automatic method fallback.
The exact upstream source limitation does not identify a hosted project's build.

The same review found callback URL exposure in Medusa's default development HTTP
logger. Bootstrap and configuration now use the supported native `info` level;
the separate non-test HTTP process verifies the actual suppression. Temporary
diagnostic logging was removed before the corrected candidate. Regression review
also prompted real operator cookie use/refresh/logout and narrowed the MFA claim.

Independent reviewers `supabase_provider_research` (authority/security) and
`medusa_auth_review` (regression) authored/edited nothing, ran no product tests and
inspected source, upstream contracts and actual evidence read-only. Their round-two
reports concluded **no remaining scoped blocker** on `8e1f727` / tree `a4d1e090`.
Both inspected the intended fault outcome and identical verifier. Actual reports
were delivered through the collaboration session; this record does not impersonate
an externally signed approval or claim independent re-execution. Formal acceptance
remains unchanged. `elevenid_supabase_alignment` performed read-only Marty alignment.

The reviewer noted a nonblocking usability limit: an existing browser cookie's
expiry is not renewed, so a later attempt may fail closed before its new state's
300-second maximum. The guide retains this for browser qualification.

## Targeted fault and retained evidence

A detached checkout of `8e1f727` changed only the state key from
`rifare-oidc:${state}:${digest(browser)}` to `rifare-oidc:${state}`. It reused the
read-only installed graph and unchanged verifier. The wrong browser completed the
native callback with HTTP 200, failing the expected 401 assertion after real startup
and code-flow setup. A setup failure was not counted as fault detection.

Identical clean/fault verifier SHA-256:
`b5dde733e26c4b0da8f0ca1ea90d537369f5014d2f86d40a08e28d68ae518a51`.
Raw evidence remains ignored/local; these hashes and the exact source retain the
observed outcome without claiming remote retention of raw logs.

| Evidence under `evidence/identity-app/` | SHA-256 |
| --- | --- |
| `native-round2.log` | `79c6a13c88335fa21a3abdad082ee65a912865331e5acbf3ff20d9bce9cbac5d` |
| `fault-browser-binding.log` | `ff79c3fae5fb2a3a94cb02c0b8a3d171917e561f711912ea51a7b9985c556ad8` |
| `fault-browser-binding.patch` | `387370e2eeb80b8a035f96e7455ea74321fb50219f2bb197457f2aa1f8f38240` |
| `build-8e1f727.log` | `c1568c7ad205728faaa6a664740800470be6cee3341cd144c30e01ebd6f1c284` |
| `audit-8e1f727.json` | `696995a735e95c19eac8a125cfab4bf6dd84d51d6d6de7879164c45b3b7ff833` |

## Publication and remaining work

The authorized feature branch uses `[skip ci]`. Connector-created `003d558` was
fetched and compared with native `8e1f727`: identical tree `a4d1e090`. The default
`development` branch was observed at `933600561a989150e2a2d3c4273a57ee84cdad52`
and was not updated. Closing edits are only current status/guidance and this record;
product, test and dependency inputs remain exactly the reviewed candidate. No PR,
hosted CI dispatch, tag, paid service, production migration or account change occurred.

Real provider/client setup, login/consent and storefront token delivery, hosted email
assurance, disabled-account/recovery/logout/key-rotation qualification, distributed
state and production HTTPS/cookie/proxy configuration remain open. Supabase OAuth
Server is documented as beta. No immediate provider revocation, forced fresh login
or step-up is claimed; application JWT expiry is not a synchronized provider session.

Next connect supported ElevenID identity/trust/delegation evidence to the exact
current Medusa customer/merchant/cart and approved effect, preserving original
operation identity and unknown-outcome recovery. Reconsider the public commerce
holds only after that integration is implemented and qualified.
