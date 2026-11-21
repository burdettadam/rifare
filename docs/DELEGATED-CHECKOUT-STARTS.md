# Native checkout START_USE construction

RCG-4B-C3 connects the existing current checkout preview owner to the local
original-command journal. Its scope is assigned in
[ADR-0077](decisions/0077-native-checkout-start-claims.md); exact implementation
commits, executions and independent reviews belong in the
[work record](../work/records/RCG-4B-C3.md).

The native method constructs the purchase portion of a P03 START_USE from an
actual owner-created preview and checks it again inside the journal transaction.
It uses the existing diagnostic SQLite checkout and synthetic source profile;
this does not establish a live merchant purchase or target-stack deployment.
It does not authenticate the provider, confirm a current grant, send a request or
authorize business execution. The grant and C2 correlation are explicit local
expectations. Existing raw journal operations retain their original unverified
contract.

## Composition

The server supplies the actual kernel and preview owner plus a closed grant
reference configuration. A method caller supplies only the original command
UUID and the ID of an existing native preview:

```ts
const starts = new DelegatedCheckoutStarts(kernel, previews, {
  grant: originalUnverifiedGrantRef,
});
const commands = new DelegatedCommandClaims(kernel, correlation, starts);
const retained = commands.claimCheckoutStart(scope, {
  command_id: originalCommandId,
  preview_id: originalPreviewId,
});
```

The configured `GrantRef` is detached, descriptor-checked and immutable. Its
schema validity is not proof of current grant, actor, organization or sender-key
authority. The configured correlation still partitions local history only.
An actual authenticated namespace/current-grant source remains integration work.

The native request profile uses these fixed values:

| P03 operation field | Source |
| --- | --- |
| `action` | `urn:rifare:action:purchase:v1` |
| `resource_id` | `urn:rifare:resource:` plus the native resource ID |
| `audience` | `urn:rifare:store:` plus the native store ID |
| `request_profile` | `urn:rifare:checkout-preview:v1` |
| `request_digest` | `sha256:` plus the complete native preview digest |

These are the explicitly selected Rifare request-profile mappings. They do not
declare a provider endpoint or expand the provider's selected serving profile.
The complete preview digest already binds scope, cart, quantities, prices, tax,
shipping, fees, terms, quote/source revisions and original validity. The command
source reuses it without adding a price calculator or a second digest scheme.
C1 remains the P03 canonicalization and validation owner.

## Current native provenance

`DelegatedCheckoutStarts` requires an actual `CheckoutPreviews` for the same
kernel and captures its concrete methods. `prepare` returns a frozen binding
with `preview_id`, `preview_digest` and `encoded` command data. Its WeakMap ties
the binding to the actual original preview object and opaque originating Scope.
`assertCurrent` rechecks that provenance and calls the actual native preview
owner again.

Copied JSON, another source's binding, another Scope and an object with matching
fields cannot supply that provenance. An expired, unavailable or changed native
preview fails. The underlying owner also enforces current customer/resource
proof, cart/source/quote state and recovery restrictions. Closing an owner or
losing its process removes current use; storing or copying the returned data
does not recreate it. Caller-held objects can retain data until disposal or
garbage collection; no forensic memory erasure is claimed.

## Durable claim and the final check

The additive `claimCheckoutStart` method owns the same top-level transaction as
the existing journal. It rejects a caller-owned transaction before database
work, prepares the native START, then reuses the original identity/digest and
insertion rules. It runs current native access, the concrete START currentness
check, the recovery-egress fence and finally the inert journal SQL fence. A late
purchase change or a reentrant journal change therefore prevents the transaction
from returning a successful committed claim.

The returned value is the existing historical `CommandClaimView`. It contains
no live purchase capability or authenticated-provider flag. Exact repeats require
the same current native checks and preserve the original UUID, request, times and
observation. A changed request with an occupied UUID conflicts. No replacement
UUID, automatic retry, transport permission or business idempotency key is created.

The original canonical request remains readable through ordinary journal history
under its existing current-proof rules. C2 can derive an unsent RECOVER_RESULT
from that retained original even when the old process-local preview is gone.
That historical recovery does not recreate native preview provenance or permit
the dedicated native method to bypass current source checks.

## Privacy and other owners

The C2 stored body remains version 1 with exactly its existing fields. Only the
canonical START enters its existing personal projection; there is no persisted
binding handle or extra preview copy. The existing typed privacy, hold, erasure,
uninstall, safe-recovery and merchant-import handlers own that projection.
Minimization retains refusal identities, and restored history is retired and
minimized without becoming live authority.

After native callbacks, the START source also checks the existing exact-subject
`erasure_held` privacy event. Retaining bytes under a hold does not preserve
permission to use them for fresh native construction. A hold alone is allowed;
releasing or expiring it does not withdraw a prior erasure request. This is an
inert negative check over the existing privacy owner, with no new state or
changes to historical C2 read permissions.

The optional native source does not change raw `claim`, `read`, `observe`,
`recovery` or `cancel`. Their observations remain unverified. The later native
receipt and checkout-intent owners also remain unchanged. A P03 challenge UUID
is not the signed proof nonce; START construction cannot manufacture their
independently established `ReceiptContextSource`.

## Focused verification and continuation

The assigned checks cover new native construction and lifecycle cases, existing
checkout/journal behavior, process durability, native receipt separation and
privacy/catalog controls. Each ordinary invocation retains the normal 60-case,
four-file and 60-second limits. The work record identifies actual executions;
this guide does not imply broad regression or formal acceptance.

The provider snapshot inspected for the assignment is
[`0a1ef66`](https://github.com/ElevenID/marty-ui/blob/0a1ef66a4b832e0fd8d67a57940425af379e2254/docs/delegated-use-runtime-candidate.md).
It adds protected original-receipt recovery and an offline receipt consumer to
its default-off internal host. The selected public Gateway/wallet/client contract
and deployed qualification remain open. These are source observations, not new
provider test executions.

Continue with authenticated namespace/current-grant binding and selected public
transport, then independently established FINALIZE/proof/context composition.
Preserve Rifare's business permission, budgets, reservations, original outcomes
and execution owners. Full RCG-5/6, target React/PostgreSQL and production
qualification remain separate.
