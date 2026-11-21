# Delegated-use command consumer

RCG-4B-C1 supplies Rifare's strict local consumer of the optional P03 command
contract at Protocol `6126da7619e057be2ff58dd38a5d50f49891d1b3`. It prepares
immutable command JSON, binds a parsed result to its original command, preserves
historical recovery and compares exact signed-receipt bytes with a result digest.
It sends no requests and returns `execution_authorized: false`.

The implementation is
[`command-codec.mts`](../packages/adapters/delegated-commands/command-codec.mts).
Its [local subset contract](../packages/adapters/delegated-commands/consumer-contract.v1.json)
and [assignment](decisions/0075-delegated-command-consumer.md) define the finite
scope. Actual candidates, verification and independent reviews belong in the
[work record](../work/records/RCG-4B-C1.md).

## Available operations

| Function | Input and result |
| --- | --- |
| `encodeDelegatedCommand` | Validates a closed START_USE, FINALIZE_USE or RECOVER_RESULT object or original UTF-8 bytes, returning a detached frozen request, canonical JSON and original ID/digest. |
| `createDelegatedRecovery` | Constructs recovery from the complete original validated START_USE or FINALIZE_USE mutation. It preserves that mutation's identity and digest. |
| `bindDelegatedResponse` | Validates a response against the complete original mutation. Optional recovery intent and prior response strengthen the original-result comparison. |
| `correlateDelegatedReceipt` | Performs the same result binding and compares the SHA-256 of the exact original compact-JWS bytes with the FINAL_USE receipt digest. It retains no raw receipt bytes. |

Requests carry `profile: urn:marty:delegation-command:v1`. Only these fields are
supported beyond profile and command:

| Command | Fields |
| --- | --- |
| `START_USE` | `command_id`, `grant`, `operation` |
| `FINALIZE_USE` | `command_id`, `challenge_id`, `proof_submission_id` |
| `RECOVER_RESULT` | `original_command_id`, `expected_command_digest` |

Every grant reference and operation is closed as well. Callers cannot add an
authenticated actor, tenant, trusted time, replacement grant, proof success,
approval flag or another command's fields. Grant lifecycle commands are outside
this codec. The application must retain the complete original mutation before
any future transport; this module owns no durable claims or retry policy.

## Original digest and result binding

A mutation digest is `sha256:` plus the existing native content digest of the
complete validated mutation. Rifare's existing canonicalization is appropriate
for this selected subset: object keys are fixed ASCII and the only numeric value
is a positive safe-integer revision. This is not a new arbitrary-JSON RFC 8785
implementation. Object member ordering does not change a digest; lexical URI
values and command identities do. No identifier is trimmed or normalized.

The recovery request contains the original mutation's digest. Its returned
`command_digest` continues to mean that original digest, not a hash of recovery.
The caller must still supply the complete original mutation to response binding;
a recovery request alone cannot enforce its original result kind or operation.

The response profile is `urn:marty:delegation-command-response:v1`. Its original
command ID and digest must match. START_USE requires CHALLENGE with exactly the
same grant and every operation field. FINALIZE_USE requires FINAL_USE for the
original challenge, PERMIT or DENY, and `semantics: EVIDENCE_ONLY`. A supplied
recovery request must match the same original and requires `recovered: true`.
A duplicate mutation response may also legitimately have `recovered: true`.

When a prior response is supplied, both responses are fully rebound and their
immutable results must be identical. Only the recovered flag may change. The
comparison preserves timestamp spelling, deadlines, receipt identity/reference,
digest and decision. A completed denial cannot become a permit. Missing,
in-progress, unresolved and transport errors are not successful results; none
authorizes replacement work or automatic retry.

Time values must be calendar-valid and internally ordered. An already expired
historical result may still be decoded. The codec introduces no current clock,
freshness assertion or deadline extension.

## Validation and privacy

The local UTF-8 command/response limit is 65,536 bytes. The codec reuses the
existing strict receipt JSON scanner and detached native snapshot owner. It
rejects duplicate decoded member names, invalid UTF-8, lone surrogates, unsafe
numbers, unsupported fraction/exponent number spellings, excessive depth,
accessors, non-JSON object shapes and unknown fields. Failure messages are finite
codes and do not echo inputs. The existing scanner also limits traversal to
32,768 scan steps and depth sixteen; the byte limit does not promise acceptance of
every otherwise valid whitespace-padded document below that size.

The supported scalar subset is deliberately explicit: lowercase hyphenated
non-nil UUIDs; revisions from 1 through `9007199254740991`; exact lowercase
SHA-256 references; bounded ASCII absolute URIs without wildcard, whitespace,
invalid percent escapes or parser-repaired forms; and native UTC timestamps with
calendar checks and up to nine fractional digits. Original values are preserved.
The local contract records the receipt-byte bound separately.

The codec uses bounded transient process memory. It adds no file, database,
browser storage, log or network sink. Returned request/response snapshots are
frozen, but that is data integrity rather than authentication. Caller copies and
JavaScript memory reclamation remain outside any erasure claim.

## Evidence and authority remain separate

Parsed responses are labeled `unverified_protocol_data`, with
`provider_authenticated: false`, `receipt_signature_verified: false` and
`execution_authorized: false`. Even a matching digest proves only byte equality.
The existing [native receipt verifier](DELEGATED-RECEIPT-VERIFICATION.md) still owns
actual JOSE verification, exact independently established context and current
native purchase/proof checks. A codec result cannot supply its private provenance.

`CHALLENGE.challenge_id` is a server-record UUID, not the signed proof nonce in a
native receipt context. CHALLENGE lacks the independently trusted issuer/key,
policy, status, nonce, actor, domain and current-authority facts required by
`ReceiptContextSource`. No context is constructed from it. Receipt references
remain identifiers; this module never follows a URL or selects signing trust.

The command digest also cannot authenticate tenant or typed actor. A future
qualified transport must establish those independently and preserve the original
command through uncertain outcomes. Rifare remains responsible for business
permissions, budgets, reservations, merchant idempotency, execution and outcomes.

## Focused verification

The checked-in [consumer vectors](../tests/fixtures/delegated-commands/consumer-vectors.v1.json)
are independently authored synthetic values. Python's standard JSON encoding
over fixed ASCII schema keys and safe integer values, plus SHA-256, supplied
their canonical byte/digest expectations independently of the production
JavaScript helpers. No private Protocol schemas, implementation or fixture bytes
are distributed here.

Native composition tests use original checkout facts and actual ephemeral ES256
and Ed25519 receipts through the existing JOSE owner. They distinguish a matching
digest from an authentic signature, preserve historical expiry and completed
denial, and assert no changed commerce effects. The isolated deliberate binding
mutation is reported separately from these passing cases.

```sh
python3 tools/install_receipt_runtime.py --offline
python3 tools/dev_tests.py --files tests/development/delegated-command-codec.test.mts tests/development/delegated-command-native.test.mts tests/development/delegated-receipt-binding.test.mts
```

The optional JOSE runtime is only needed by native signature composition. No
browser assets or routes change in this increment. Whole browser reruns do not
replace the focused protocol and native-binding assertions.

On clean candidate `e8c87c20cd413b2961d35e89d0f2184c9f3bb77b`, all **42 cases**
passed: 20 codec, five native composition and 17 unchanged receipt-binding cases.
The single normal-budget invocation took 2.344 seconds, with no skipped,
unregistered or unrun cases. Two supplemental checks also matched the exact
privately staged upstream START_USE and FINALIZE_USE bytes against their
published digest manifest. Those two observations are separate from the 42
registered cases and do not qualify a provider service or the full conformance
pack. Detailed source/runtime pins and independent reviews are retained in the
[work record](../work/records/RCG-4B-C1.md).

## Provider and next integration

The [pinned command semantics](https://github.com/ElevenID/marty-protocol/blob/6126da7619e057be2ff58dd38a5d50f49891d1b3/protocol/delegated-authority/COMMANDS.md)
describe an optional draft intent contract. The provider advanced during this
increment to
[`1063f32b5f65094ca3f98351804ff4b5994fc87b`](https://github.com/ElevenID/marty-ui/blob/1063f32b5f65094ca3f98351804ff4b5994fc87b/docs/agent-trust-runtime-milestones.md#current-access-delegated-policy-and-authenticated-ingress-follow-on).
It now includes explicit machine-use access, current exact-operation policy,
mutual-TLS workload authentication and protected Flow request/proof ingress,
alongside the existing machine/MAP and credential-authority sources. Those
internal owners are implemented. Its [runtime candidate](https://github.com/ElevenID/marty-ui/blob/1063f32b5f65094ca3f98351804ff4b5994fc87b/docs/delegated-use-runtime-candidate.md)
still requires an explicit default-off serving executable, reviewed separate
credentials and deployed composition. No public use Gateway or selected public
wallet/consumer contract is installed; the human lifecycle route cannot be used
as a machine-use route. The Protocol pin and this codec's scope are unchanged.

Continue RCG-4B with the qualified public authentication/current-state, use and
original-outcome contracts, durable original claims and actual transport. Reuse
the landed provider owners through their eventual selected public composition.
Do not invent a route or read private provider storage. Public wallet contracts,
certificate lifecycle, selected required attestation and deployed request/receipt
custody remain provider qualification work. Full isolated cross-service RCG-5,
connected RCG-6, target React/PostgreSQL, formal acceptance and production
qualification remain separate gates.
