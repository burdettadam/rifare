# RCG-4B-C8 — Native delegated receipt admission

State: assigned, implementation pending.
Base: `4d07b3aa797a794dd318e9dc95cffa04e5333692`.
Writer/integration owner: root; branch `feat/medusa-native-receipts`.
Checkout: canonical primary `rifare`; one primary, zero linked, clean at assignment.
Contract: [ADR-0086](../../docs/decisions/0086-native-delegated-receipt-admission.md).

PR6 is merged into development. The assigned local feature branches are ancestors of that
integration branch; the original implementation ref retains its distinct history.
No open Rifare PR or stash was found. Preserve branch refs.
The completed C7 linked checkout has already been removed with its evidence and
compatible source dependency cache preserved in the primary. Reuse that cache.
Host C free space was 52,764,901,376 bytes before this assignment.

The prior turn inspected current provider source and workspace audit/work records
without finding qualified endpoint/caller enrollment evidence. The ignored
`evidence/operation-journal/c7-provider-dependency-inspection.json` records its
scope. This establishes a pending connected gate, not provider deployment failure.
Current provider pin is `7254680c9491f6e79d8ca981ad71f44e9398142c`.

Independent regression scoping found the legacy-preview/native-original digest
mismatch and recommended the native receipt-context owner before an effect-fence
experiment. No existing binder or assertion may be weakened to bridge it.
Independent authority scoping of the holder/custody boundary is in progress.

Next: implement and exercise the real signature/native-context foundation, then
compose the immutable native journal observation and privacy/upgrade/recovery
qualification. Final review must bind both independent roles to actual candidate
source and evidence. No product acceptance or connected qualification is claimed.

Primary checkout remains active with root as owner until the full assigned slice
is integrated or safely parked. No verification checkout or extra build cache is
assigned. Provider and Supabase workers retain their deployment scopes.
