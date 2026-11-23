# COMMERCE-CONTEXT-01 — Medusa cart context

State: **implemented and independently reviewed within the local development
scope; ready_for_review.** Formal product acceptance and production remain open.

| Identity | Value |
| --- | --- |
| Protected base | `afd678f44f25396c2159f0532f48fc46a3c4f129` |
| Native assignment | `48ca8a3` / [ADR-0083](../../docs/decisions/0083-medusa-cart-context.md) |
| Tested/reviewed native candidate | `9446548e889f61def314f3331b1e351bc2fa1d38` |
| Reviewed tree | `88d7280f54a20a109b72cbea58ba0043436f0f1d` |
| Published implementation | [4550a14](https://github.com/burdettadam/rifare/commit/4550a14988a593c8fa8d59afe3637bcf24cda9b6), exact reviewed tree |
| Branch / sole writer / integration owner | `feat/medusa-cart-context` / root / root |

## Implemented boundary

Medusa owns all cart, price, promotion, tax, shipping and order behavior. Rifare
adds native bearer/customer association checks, registered-cart ownership/channel
policy, child-line membership checks and refusal of external address references.
The guards cover cart-dependent product/variant/shipping context as well as cart
routes. Known guest capability behavior remains; missing/deleted customer state
cannot downgrade a cart to guest access. Native customer transfer and all existing
protected commerce effects remain held. Authentication can refuse a transfer
before the HTTP 503 hold; no request can bypass it to obtain a transfer effect.

The separate observation endpoint returns a fixed, bounded native projection,
server-configured merchant/store context, contact commitment and canonical facts
digest. Native major-unit decimal components are retained exactly, including
fractional minor units; only the payable total is also converted to exact minor
units. There is no rounding, repricing, payment refresh, provider dispatch, order
creation or approval assertion. The native cart lock is local and cooperative;
no cross-module snapshot, durable revision or execution fence is claimed.

The [guide](../../docs/MEDUSA-CART-CONTEXT.md) specifies the endpoint, configuration,
projection, bounds, account policy and later execution requirements. The only direct
package promotion is maintained `safe-stable-stringify` 2.5.0, already in the locked
graph. All 1,015 nonroot dependency entries remain byte-equivalent. The root package
manifests, legacy packages/contracts/tests, existing native identity/commerce
verifiers, planning criteria and acceptance ledger remain unchanged.

## Actual verification

The fixed source was clean `9446548`, Node 24.22.3, Medusa 2.23.0, and the existing
explicitly disposable PostgreSQL 17.12 runtime on loopback 15473. The new native
HTTP server uses 19039; retained identity/commerce harnesses keep their original
ports. Each native wrapper had the assigned 240-second deadline. No real customer,
provider account, payment or physical effect was used.

| Verification | Actual result |
| --- | --- |
| Reset/migrate, `npm run test:cart-context` | **22 groups passed**, actual native services/HTTP plus focused projection vectors |
| Following `npm run test:identity` | **28 unchanged groups passed**, actual PostgreSQL/native HTTP and synthetic OIDC peer |
| Fresh reset/migrate, `npm run test:commerce` | **17 unchanged groups passed**, native order/inventory/fulfillment/return/refund/cancellation records and public holds |
| Focused retained configuration/preview selection | **29 cases across 3 files passed**, 1.123 seconds; no full-regression or acceptance claim |
| Existing dependency-intake selections | **8 runtime-intake + 14 receipt-intake cases passed**, separate bounded invocations |
| `NODE_ENV=development npm run build` | Backend **8.16s** and upstream Admin/frontend **10.69s**, both passed |
| Repository/distribution checks | Passed within their structural/source-inventory scope |
| Isolated ownership fault | Unchanged cross-customer HTTP assertion failed: actual **200**, expected **403** |

The initial chained command did **not** pass as a whole: after successful cart and
identity verification, the retained commerce fixture refused to reuse country
`us`, already assigned by the new fixture. Its unchanged script passed after a
fresh disposable reset and migrations. Retain both logs; do not reinterpret the
first command's nonzero exit as a whole-suite pass. Future native runs should
isolate these country-owning fixture databases or reset before commerce.

The focused command was:

```sh
python3 tools/dev_tests.py --files tests/development/external-identity-config.test.mts tests/development/commerce-backend-config.test.mts tests/development/checkout-preview.test.mts
```

Report: `evidence/development/20261122T075010.334943Z-cc5399/report.json`.
All 29 executable cases passed. Its **13 inherited unregistered IDs** are the six
identity-config and seven commerce-config cases; 16 preview cases are registered.
These files and the registry are unchanged. This is focused development evidence,
with `full_regression: false` and `goal_accepted: false`, not formal acceptance.

Native checks include owned/other/guest/deleted/stale association, operator/invalid
credentials, normalized paths and channel scope, alternate cart consumers,
foreign line/address references, positive native creation/deletion/updates, held
transfers/effects, exact native totals, independent canonical JSON comparison,
row-order invariance, configured sole-store checks, changed contacts/quantities/
credits, and completed/order-linked refusal. Repeated reads preserve the full
queried cart and native order/payment-collection/reservation counts. USD/JPY/KWD
exponent and unsupported-precision vectors are projection checks, not hosted
multi-currency payment qualification.

## Fault and evidence binding

The fault ran in a separate checkout of `9446548` with only the planned ownership
refusal removed. Its positive native owner read passed; the unchanged second check
then observed another customer's HTTP 200 instead of required 403. It is a real
behavioral failure, not a setup or syntax failure.

- Fault patch SHA-256: `fa8d6bec33173f6a0ec457a8d8d57a56bb17400bf13514771f9493c90ef67cee`.
- Identical verifier SHA-256 in clean/fault trees: `a7a5d56194458825c97bb75264d53b2d6b95fa9805decf2ab6d843efaa380d6a`.
- Fault checkpoint: `2d3622e7d5c26d20c0fa41256ad703c6437792e0`, tree `c4db772044d6465a3f5de5e5ee184fc9fdae7057`.
- That checkpoint was created **after execution**, retaining exactly the pre-run
  patch and tested bytes. The run itself was base plus the recorded patch; do not
  claim it was already committed then.
- Evidence manifest: `evidence/cart-context/manifest.json`, SHA-256
  `032f0c37a2316b1c67713fedd2a2131973532b9386530385a1c8d91613428762`.

Raw logs, patch and manifest remain ignored local evidence. The concise source,
results, qualifications and independent review decisions are retained here.

## Independent reviews

Both reviews bind the exact native candidate/tree above. Reviewers inspected
source and actual evidence; they did not rerun product tests or author product code.

| Role | Reviewer | Result |
| --- | --- | --- |
| Authority/security | `/root/c4_authority_review` | Round 1 approved within the assigned local observation scope; no blockers. Reconciled all 1,873 live tracked files, actual evidence and the fault source binding. |
| Native integration/regression | `/root/medusa_auth_review` | Round 1 passed; no blockers. Confirmed native service reuse, positive and refusal paths, protected input equivalence and meaningful fault. |

Authority review record: `evidence/cart-context/authority-review-9446548.json`,
SHA-256 `cf132b01c1b577e2e5e9269fbff0cf9691e806fc2d9b130918b2c76d81b0c2ab`.
Nonblocking guide corrections clarify that authentication may precede the transfer
hold, and that identical scalar query/body cart IDs are accepted while repeated
query values, conflicts and structured values are refused. No product correction
or further execution was required by either review.

Exploratory work before the fixed candidate corrected the native forbidden-error
mapping, an ordered native link fixture, and an overly narrow all-minor-unit
projection. Those failed explorations are not fixed-candidate passes.

## Publication and remaining integration

The published implementation was fetched back and compared with `9446548`:
identical tree, no content difference. Feature-branch publication uses `[skip ci]`.
Default `development`, provider accounts, production and hosted CI were not changed.
Documentation-only closure records these results and retains the exact reviewed
application/test/intake source; it does not create a new product verification claim.

The parallel upstream audit is recorded in the guide with exact Marty/Protocol
pins. It found a selected organization-to-machine delegation runtime and an
account-link protocol, but no qualified external issuer/subject-to-current-human/
organization consumer interface in the inspected Auth surfaces. The Supabase
branch now has a static login/consent companion; hosted qualification remains open.
Marty code and provider accounts were read-only here.

Next work must establish the supported ElevenID authority relationship and a native
PostgreSQL original-operation journal with atomic admission/currentness before C6
composition. Then bind the approved exact operation and payment amount at native
Medusa completion, retaining original order/provider recovery after uncertainty.
A shared login, observation digest or evidence-only receipt cannot replace those
checks. Hosted authentication, distributed infrastructure and production remain
separate qualification work.
