# Local checkout command access

RCG-4B-C4 connects the existing [native START source](DELEGATED-CHECKOUT-STARTS.md)
and [original-command journal](DELEGATED-COMMAND-CLAIMS.md) to Rifare's local
customer HTTP application and standalone Python caller. It adds a separate route
family under `/v1/delegated-checkout-commands`. Existing preview, intent, receipt
and preparation-recovery contracts remain unchanged.

The scope is assigned by [ADR-0078](decisions/0078-local-checkout-command-access.md).
Exact commits, executions, corrections and independent reviews belong in the
[C4 work record](../work/records/RCG-4B-C4.md). Every command response remains
historical unverified data with `execution_authorized: false`. Constructing or
recovering a command does not send it to a provider or execute a purchase.

## Configure the native owners

The application supplies explicit server-owned correlation and, when native
START is needed, the original same-kernel source:

```ts
const starts = new DelegatedCheckoutStarts(kernel, previews, {
  grant: originalUnverifiedGrantReference,
});
const checkout = new DelegatedCheckoutApi(kernel, {
  previews,
  receipts,
  commands: { correlation: originalLocalCorrelation, starts },
});
const server = await startCommerceServer({
  kernel, caps, customers, simulator, checkout,
});
```

`receipts` is optional and belongs to the separate receipt journey. Commands do
not need a receipt context or signing verifier. The API constructs one private
`DelegatedCommandClaims` using the existing journal owner. It never wraps journal
mutations in another transaction. C2 retains responsibility for committing the
original identity before returning success.

The command configuration cannot arrive through an HTTP request. It is checked
as data without invoking getters, and the journal detaches and validates its
correlation. Correlation partitions local history; it does not authenticate a
provider, organization, actor, grant or sender key. There is no invented default
namespace. Configuration options have these effects:

| Configuration | Available local command behavior |
| --- | --- |
| No `commands` | The static contract is readable with current customer proof; command operations are unavailable. |
| `commands: { correlation }` | Original status, unsent recovery and cancellation remain available. Native START is unavailable. |
| `commands: { correlation, starts }` | Native START is also available while its concrete source and original preview remain current. |

Replacing the server with correlation-only configuration preserves durable
history. Closing or losing the live preview/source does not reconstruct native
provenance from that history. A changed correlation intentionally selects a
different local namespace and cannot recover the old namespace's commands.

## Exact local routes

All routes use the existing native customer session in `Authorization: Bearer …`.
POST uses `Content-Type: application/json`. The versioned contract is
[delegated-checkout-commands.v1.json](../packages/commerce/contracts/delegated-checkout-commands.v1.json).

| Method and path | Exact JSON fields | Result |
| --- | --- | --- |
| `GET /contract` | None | The five-route local contract. |
| `POST /start` | `command_id`, `preview_id` | C3 constructs START_USE from the actual current preview; C2 retains the original and returns history. |
| `POST /status` | `command_id` | The original historical journal view under current native customer proof. |
| `POST /recovery` | `command_id` | An unsent RECOVER_RESULT bound to the retained original UUID and digest. |
| `POST /cancel` | `command_id`, `expected_revision` | Revision-bound local retirement, masking personal data and minimizing unheld content. |

The path prefix is `/v1/delegated-checkout-commands`. Operation names in successful
envelopes are `command-contract`, `command-start`, `command-status`,
`command-recovery` and `command-cancel`. The outer profile remains
`commerce-sqlite-diagnostic`, with `qualification: candidate_contract_only` and
`evidence_status: historical_observation`.

Nested command views retain C2's `historical_unverified_observation`,
`observation_origin: local_unverified_input`, and false `provider_authenticated`,
`receipt_signature_verified` and `execution_authorized` flags. A structurally
bound CHALLENGE or FINAL_USE in historical status remains unverified. No route
accepts a raw original command, provider response, FINALIZE request, caller grant,
actor, trusted context, receipt expectation or dispatch instruction.

`command_id` must be an explicit lower-case non-nil UUID. It is never generated
or replaced by the API or client. The selected P03 syntax does not require one
particular UUID version. Revisions are positive safe integers. All request
objects are closed, including rejection of unknown fields.

## Current proof and owner composition

The server calls the concrete native API authorization before reading a command
body. Owner, staff, worker and agent sessions cannot use this customer surface.
The actual customer/resource/contact proof must be current; C2/C3 check native
authority again after the body arrives and before committing or returning data.
Queries, route aliases, unsupported methods and cross-scope references fail.
Existing loopback host, origin and fetch-site restrictions remain in force.

The four assigned composition boundaries now check concrete native private
brands and the same kernel, then capture the intended methods. The API captures
preview preparation, revalidation and availability; the server captures actual
API entrypoints and authorization; the intent owner captures receipt binding,
verification and final assertions; the receipt owner captures actual preview
currentness and uses private availability and current-binding guards.

Copied prototypes, proxies and instance method/getter shadows cannot substitute
for these native owners. Closing the receipt owner during an asynchronous
signature check invalidates the result even when its instance availability
property is overridden. The explicit context, JOSE and quote source ports retain
their existing contracts. This corrects configuration-object integrity at these
four boundaries; it does not claim whole-process integrity or protection against
arbitrary replacement of imported prototypes. No HTTP object-installation path
was identified as part of this work.

## Original recovery and cancellation

An uncertain HTTP response can follow a committed local START. Keep the original
UUID and explicitly request status. An exact repeated START must still pass
current native source checks; historical status needs no live source. Do not
infer that transport failure means the claim was absent.

Recovery derives its request from the complete retained canonical original.
Its `command_digest` is the original mutation's digest, not a digest of the
RECOVER_RESULT request. It creates no replacement UUID or journal row and makes
no provider call. Recovery retains the existing active-work egress fence;
historical reads and cancellation keep their existing exceptions.

Cancellation needs the currently observed revision. It permanently retires the
original and masks its canonical request and response. A hold may require the
privacy owner to retain personal bytes while ordinary command views stay masked.
An unheld cancellation minimizes them. The command UUID and any FINALIZE
challenge refusal identity remain occupied. Cancellation cannot revoke or prove
the outcome of an external provider action.

## Independent Python caller

The single file [delegated_checkout.py](../clients/delegated_checkout.py) uses
Python's standard library. Supply `RIFARE_BEARER` privately through the process
environment, and replace the example port, UUID and preview ID with the existing
application values:

```sh
python3 clients/delegated_checkout.py --base-url http://127.0.0.1:8080 command-contract
python3 clients/delegated_checkout.py --base-url http://127.0.0.1:8080 command-start --command-id 12345678-1234-4234-8234-123456789abc --preview-id PREVIEW_ID
python3 clients/delegated_checkout.py --base-url http://127.0.0.1:8080 command-status --command-id 12345678-1234-4234-8234-123456789abc
python3 clients/delegated_checkout.py --base-url http://127.0.0.1:8080 command-recovery --command-id 12345678-1234-4234-8234-123456789abc
python3 clients/delegated_checkout.py --base-url http://127.0.0.1:8080 command-cancel --command-id 12345678-1234-4234-8234-123456789abc --expected-revision 1
```

The commands use the exact literal loopback URL only. They use no environment
proxy, redirect, cookie, alternate authentication or automatic retry. The caller
independently checks the response's profile, operation, original UUID, canonical
request/digest binding, historical state, minimization and authority flags before
printing it. A self-consistent valid response for another original UUID is
rejected. Finite local error codes do not echo server error bodies or credentials.

## Bounds and verification

The command body reuses the strict preparation-recovery reader: 4,096 bytes,
duplicate-key rejection, strict UTF-8 and Unicode validation, and finite failure
responses. Announced oversized input is rejected before collection. Responses
use `cache-control: no-store`; server logs contain only finite event, status and
code fields. The Python caller limits responses to 262,144 bytes and rejects
unexpected encodings, duplicate keys and nonfinite numbers.

The assigned focused selections are separate ordinary invocations, each retaining
the default 60-case, four-file and 60-second limits:

```sh
python3 tools/install_receipt_runtime.py --offline
python3 tools/dev_tests.py --files tests/development/delegated-checkout-commands.test.mts tests/development/delegated-checkout-http.test.mts tests/development/delegated-checkout-recovery-http.test.mts
python3 tools/dev_tests.py --files tests/development/delegated-checkout-command-client.test.mts tests/development/delegated-checkout-client.test.mts tests/development/delegated-command-claims.test.mts
python3 tools/dev_tests.py --files tests/development/delegated-checkout-owner-binding.test.mts tests/development/delegated-receipt-native.test.mts tests/development/delegated-checkout-intents.test.mts
python3 tools/dev_tests.py --files tests/development/delegated-checkout-starts.test.mts tests/development/delegated-command-process.test.mts tests/development/privacy-coverage.test.mts tests/development/delegated-command-catalog.test.mts
```

New caller tests copy only the Python file into an isolated directory and run it
against actual native owners and the loopback server. Local stubs independently
exercise response corruption and transport uncertainty. A relay deliberately
loses a response after the native HTTP START commits, then the caller explicitly
looks up the same original after server replacement. That is HTTP response-loss
evidence; existing C2 tests separately exercise actual process loss. The new held
erasure route check seeds the exact existing native marker; prior C3 lifecycle
evidence records execution of the actual typed privacy owner.

All 200 cases passed freshly on clean candidate `ecc34e5`: 44 new and 156 existing
cases across thirteen whole files. The four selections ran in 10.897, 16.223,
10.742 and 20.114 seconds. Both independent reviewers found no scoped blocker.
The twelve owner assertions also preserve their original meaningful failures
against the protected implementation and pass unchanged after the correction.

The isolated authorization fault caused the intended 413-versus-404 failure in
one of twenty unchanged HTTP cases. The isolated UUID fault made the caller accept
a complete valid second original and failed one of twelve unchanged client cases.
Neither fault produced import or setup failures. Public `6000723` has the exact
reviewed implementation tree; the final documentation retains those executions
through explicit unchanged-source/runtime/report checks. Exact hashes and native
denominators are recorded in the C4 work record. This focused scope does not imply a full regression run,
formal acceptance, external provider execution, public wallet qualification or
the target React/PostgreSQL deployment.

## Next integration boundary

The provider snapshot inspected for this assignment is Marty UI draft PR1994 at
[`37b7fdc`](https://github.com/ElevenID/marty-ui/blob/37b7fdc3d3f1c223613ad98fe601d7d86e6a3600/docs/delegated-use-runtime-candidate.md);
Protocol draft PR38 remains `6126da7`. The provider source now includes an actual
internal executable lifecycle with managed issuance/signing and an independent
offline receipt consumer. Those source observations are not provider executions
performed by Rifare. Its internal mandatory-mTLS host does not select the public
Gateway/wallet/client transport.

Continue with authenticated provider namespace, current grant/actor authority
and the selected public transport. Then compose FINALIZE with independently
established proof and receipt context. Preserve original unknown-outcome recovery
and Rifare's business permissions, budgets, reservations, idempotency and execution
owners. Full cross-service RCG-5, connected RCG-6 and production qualification
remain separate work.
