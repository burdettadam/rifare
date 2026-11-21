# ADR-0075 — Delegated-use command consumer

Status: bounded delegated assignment before implementation.
Protected source: `ddc35b7905ce98b0ea1f172e855700eccf62bc5e`.

## Assignment and available contract

The owner requested continued development after the verified RCG-5D checkpoint.
Under the existing delegated authority, assign **RCG-4B-C1**, a local, explicitly
non-dispatching consumer of the provider's P03 use-command contract. Existing
publication authorization covers the Rifare feature branch. Root is integration
owner and sole writer in `feat/rcg4b-command-consumer` / `rifare-command-consumer`.
The separate `command_consumer_impl` writer receives only the paths below in its
own worktree. Independent reviewers remain `commerce_checkpoint_audit`
(authority/security) and `receipt_regression_review` (regression).

The pinned Protocol candidate is `6126da7619e057be2ff58dd38a5d50f49891d1b3`:

- [Command semantics](https://github.com/ElevenID/marty-protocol/blob/6126da7619e057be2ff58dd38a5d50f49891d1b3/protocol/delegated-authority/COMMANDS.md).
- [Request schema](https://github.com/ElevenID/marty-protocol/blob/6126da7619e057be2ff58dd38a5d50f49891d1b3/schemas/delegated-authority/v1/command-request.json), blob `db7ebfa638ac3d395683d8a5ecbda9f5019155a3`.
- [Response schema](https://github.com/ElevenID/marty-protocol/blob/6126da7619e057be2ff58dd38a5d50f49891d1b3/schemas/delegated-authority/v1/command-response.json), blob `91e41e2861dd31961ed6711b26368ca3bd3f9373`.
- Grant/operation definitions in `evaluation-input.json`, blob `9481f8e2e43930e5526b8e94a01f014c4ee8146b`; URI/time/digest definitions in `delegation-grant.json`, blob `0816af7e568398114cfa7a80faafc1dfdd600d13` at the same schema directory and commit.

This is an optional draft wire contract, not a hosted or qualified API. The
current provider draft at `c44579ab81b46c4b5a55be1fd0308f0464824045` has concrete
machine/MAP, credential-authority and policy-source owners in addition to retained
internal use. Its human command host and Gateway still reject use commands.
Serving, protected workload/proof ingress, selected attestation, deployment and
independent public-consumer qualification remain separate upstream work.

## Required bounded behavior

Implement original Rifare code for exactly `START_USE`, `FINALIZE_USE` and
`RECOVER_RESULT`; reject grant lifecycle commands and unknown fields. Accept
bounded original UTF-8 JSON through the existing strict parser. For object input,
take a detached descriptor-checked native snapshot before validation. Reuse
`checkoutSnapshot`, `contentDigest`, `GrantRef`/`Operation`, `receiptTimestampNs`
and `strictReceiptJson` without modifying those owners or duplicating their
canonicalization/JSON machinery. Translate parser failures to finite local
command errors without echoing input.

Use the complete validated mutation to compute `sha256:` plus the native
canonical content digest. Recovery must retain the original mutation ID/digest;
never create a replacement identity, hash a recovery request as its mutation, or
infer that absence permits another attempt. Select and document a 65,536-byte
UTF-8 limit, lowercase non-nil canonical UUIDs, positive safe-integer revisions,
bounded ASCII absolute URIs without wildcard/whitespace/invalid percent escapes,
exact SHA-256 spelling and the native calendar-valid UTC timestamp subset. Never
trim, normalize, repair, fetch or reinterpret lexical identifiers.

Bind each response's original ID/digest to the retained complete original
mutation. A START result must be `CHALLENGE` with exactly the original grant and
operation. A FINALIZE result must be `FINAL_USE` for the original challenge,
with PERMIT or DENY, original receipt reference/digest/times and `EVIDENCE_ONLY`.
An explicit recovery requires `recovered: true` and all the same original-command
and result checks. A direct mutation response may have either recovered value.
When a prior response is supplied, only the recovered flag may change; result
timestamps, deadlines, receipt and decision cannot be refreshed or substituted.
Historical expired outcomes remain readable historical data, never renewed
authority. Validate time ordering without introducing a new current clock.

Provide a bounded receipt-byte correlation check using the existing SHA-256
owner. It compares the exact original compact-JWS bytes to a FINAL_USE digest;
it does not fetch the receipt reference, decode claims, verify a signature or
authorize execution. Return frozen, explicitly unqualified/evidence-only parsed
data with `execution_authorized: false`. A schema-valid principal, grant, result
or digest is not authenticated provider evidence.

Do not turn a CHALLENGE UUID into the receipt verifier's signed proof nonce.
The protocol challenge response lacks the independent policy, status, issuer,
key, nonce and current-authority evidence needed for `ReceiptContextSource`.
No result may construct that source or become a native verified receipt object.

## Ownership and allowed changes

The implementation writer owns only new:

- `packages/adapters/delegated-commands/command-codec.mts`;
- `packages/adapters/delegated-commands/consumer-contract.v1.json`;
- `tests/development/delegated-command-codec.test.mts`.

Root owns the independent synthetic oracle at
`tests/fixtures/delegated-commands/consumer-vectors.v1.json`, new
`tests/development/delegated-command-native.test.mts`, this ADR,
`work/records/RCG-4B-C1.md`, `docs/DELEGATED-COMMAND-CONSUMER.md`, and relevant
current statements/links in `PLANS.md`, `ARCHITECTURE.md`, `ROADMAP.md` and
`DELEGATED-CHECKOUT-RECEIPT-REVIEW.md`. No proprietary schema, reference code or
vector bytes may be copied into public Rifare. The new fixture must be independently
authored and labeled synthetic; source links and hashes describe inspected inputs.

Append the eight assigned new source members, real executable case IDs and one
proposed capability through existing inventory/registry controls. Under ADR-0008,
change only the licensing oracle's `source_file_count` and `source_count_reason`
to the actual membership at each committed checkpoint. Add only the new runtime
module to the existing process-memory privacy surface; retain prior paths,
surfaces, descriptions, schema and protected pins. The public contract JSON is
documentation of this adapter's subset, not a replacement upstream schema.

No existing runtime owner, helper/parser, API route, native state/record schema,
database, migration, worker, network transport, dependency, browser asset, old
test assertion, oracle, workflow or acceptance-ledger change is assigned. No
fetch, arbitrary URI resolution, provider configuration, keys, credentials,
automatic retry, persistent command claim, purchase or payment is added.

## Verification and review

Write focused codec tests first. Their expectations must include independently
computed canonical bodies/digests, negative original-command/grant/operation/
challenge bindings, changed recovered results, exact receipt-byte correlation,
strict JSON and object-shape faults, and explicit authority limits. Root's native
tests use the existing actual checkout/receipt fixture and maintained JOSE owner
to show the same original preview/receipt facts survive composition with no
commerce effect; the codec alone must not establish cryptographic verification.

A missing new module/import is not a behavioral red. Demonstrate the assigned
targeted fault on an isolated deliberate mutation of the finished codec: remove
one original-command binding check and require the corresponding substitution
test to fail at its behavioral assertion. Preserve original tests and report
this as a mutation observation, not a failure of the prior implementation.

Use complete focused files under existing budgets (at most 60 cases/four files
and 60 seconds per normal invocation). Run applicable unchanged receipt regressions;
do not rerun browser suites when their assets and execution graph are untouched.
Bind tests, finite source/runtime records and both independent reviews to exact
candidates; later documentation-only evidence needs explicit source equivalence.
At most three corrective review rounds apply. Neither writer may author an
independent review. Keep raw evidence ignored and preserve decisions in Git.

This assignment completes only the P03 consumer prerequisite. RCG-4B transport,
current authority, durable original claims and merchant execution, full RCG-5,
connected RCG-6, formal acceptance and production qualification remain open.
