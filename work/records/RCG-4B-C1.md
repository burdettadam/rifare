# RCG-4B-C1 — Delegated-use command consumer

State: bounded local development complete; formal milestone acceptance not performed.
Integration owner: root delegated maintainer.
Implementation writer: `command_consumer_impl`, separate assigned worktree.
Independent reviewers: `commerce_checkpoint_audit` (authority/security),
`receipt_regression_review` (regression).
Protected source: `ddc35b7905ce98b0ea1f172e855700eccf62bc5e`.
Integration branch: `feat/rcg4b-command-consumer`.
Assignment: [ADR-0075](../../docs/decisions/0075-delegated-command-consumer.md).

## Outcome

Implemented the pinned optional P03 START_USE, FINALIZE_USE and original-result
recovery wire contract with strict validation, original identity/digest binding,
immutable historical recovery and exact receipt-byte correlation. It reuses the
existing native JSON, digest and receipt helpers. This codec sends nothing and
grants no authority. No provider route, context source, durable claim store or
merchant operation is introduced.

## Provider observation

Protocol remains at `6126da7619e057be2ff58dd38a5d50f49891d1b3`.
Assignment inspected provider `c44579a`. During implementation, open draft
[PR #1994](https://github.com/ElevenID/marty-ui/pull/1994) advanced to
`1063f32b5f65094ca3f98351804ff4b5994fc87b`. Root and the implementation writer
independently inspected the new primary documentation; the authority reviewer
also checked it. The [runtime candidate](https://github.com/ElevenID/marty-ui/blob/1063f32b5f65094ca3f98351804ff4b5994fc87b/docs/delegated-use-runtime-candidate.md)
(blob `bccbd47bd387ade2e584de8f0c09ed89801c1b50`) and
[current milestone](https://github.com/ElevenID/marty-ui/blob/1063f32b5f65094ca3f98351804ff4b5994fc87b/docs/agent-trust-runtime-milestones.md#current-access-delegated-policy-and-authenticated-ingress-follow-on)
(blob `34ae0c71546da96115f895337dc1884719cd8419`) now document concrete internal
machine-use access, current exact-operation policy, mandatory mutual TLS and
protected Flow request/proof ingress. Existing machine/MAP, credential authority,
proof, audit and receipt owners remain in place.

No delegated-use executable or public Gateway installs these internal routers.
The next provider work is explicit default-off serving, reviewed separate
credentials, deployed source/Flow/custody qualification, certificate lifecycle,
selected required attestation, public wallet contracts and independent consumer
qualification. The human lifecycle route still rejects use commands. No provider
suite was rerun here. Public MIP/discovery and the Protocol pin are
unchanged. This refresh changes Rifare documentation only.

## Verification record

Clean native candidate: `e8c87c20cd413b2961d35e89d0f2184c9f3bb77b`.
Tree: `07fc627702007bacc2ba7107b629007cc4f5a881`.
Native assignment: `a40cb2cc1a0281ae79539f4974a4e8eeb92d5b3d`.

```sh
python3 tools/dev_tests.py --files tests/development/delegated-command-codec.test.mts tests/development/delegated-command-native.test.mts tests/development/delegated-receipt-binding.test.mts
```

| Executed scope | Actual cases | Result |
| --- | ---: | --- |
| New codec and original-result bindings | 20 | Passed |
| New native purchase/signature composition | 5 | Passed |
| Unchanged receipt binding | 17 | Passed |
| Total registered cases in this invocation | 42 | Passed in 2.344 seconds |

The normal 60-case/four-file/60-second limits were unchanged. No selected case
was skipped, cancelled, unregistered or unrun. The planner estimated 44 because
its existing static expression also counts two regex `.test` calls; actual
native XML and registered IDs establish 42. The runner was not changed.

Raw report: `evidence/development/20261121T185445.735569Z-74b1b1/report.json`.
SHA-256: `95aeb8a3d7515e240c905221e47b5520afb97696ce38ee829792c35caebc5cae`.
All 1,800 recorded source hashes match the exact clean Git candidate. Root
checked this and both reviewers independently compared the Git object bytes.
The finite source/runtime record is `evidence/rcg4bc1-verification/candidate.json`,
SHA-256 `2191698ec43530ead86ac6d3e4f1d9aeb7648ff097e6fd52f224dc705a11b494`.

Runtime was Node `v24.22.3`, executable SHA-256
`acbe4b8d9153b841ed0697cbfc4f93e767386620edb745ab9358306c0a6f31aa`, with the
existing optional JOSE `6.2.18` dependency: 80 files, installed tree SHA-256
`8247cbabe4fe086e6330038cc15353b9f5cd001dd7650916657e68de4e6cf863`.
Existing source manifests and lock integrity were unchanged. Reviewers rehashed
the actual executable and package tree. This is finite local runtime evidence,
not whole-host or deployment qualification.

The native cases use actual ephemeral ES256 and Ed25519 receipt signatures.
They preserve the original USD 68.00 preview and independent proof nonce,
reject counterfeit native provenance, show that a matching digest cannot
qualify an invalid signature, keep expired history expired and preserve signed
denial. Commerce effects remain unchanged. No browser execution graph changed;
the existing RCG-5D browser evidence is retained without claiming a new browser run.

### Supplemental original Protocol bytes

Two separate checks ran `node evidence/rcg4bc1-private-protocol/check-vectors.mts`
on the same clean candidate. Exact privately staged START_USE and FINALIZE_USE
bytes matched their original published digest manifest, including preserved
recovery identity. The original vector Git blobs are respectively
`5c59f8e245854530f4140505a0d7bc1773d1b5b5` and
`08894c1dee6eed896c141ab4dd21ec4421d3f8a6`; the manifest blob is
`e9678ad17f728b42ed7625fc46685e069f9ae630`, all from the pinned Protocol candidate.
Both reviewers independently checked provenance against the pinned upstream.

Result SHA-256: `eba73ea68348269a4ba57f2cb920be49a655c2abb00ee7c155138a3255546d36`.
Script SHA-256: `091416a6fbdcc3e9864b90e8fac7613693ff1c41808b07da67cb52282679f8c9`.
These are two supplemental compatibility observations, outside the 42 registered
cases. They do not qualify provider execution, authentication or the complete
conformance pack. Private schemas, implementation and vector bytes are not in Git.

### Exploratory writer record

The isolated writer committed only its three assigned files as
`de3344fdcb10120fe909b3f9e0f9fde09564949f`; root integrated identical source in
`0096c57`. Its exploratory unit run passed 20/20. The first run passed 19/20:
the new byte-bound test incorrectly expected a 65,536-byte whitespace-padded
document to pass the inherited 32,768-step scanner limit. The writer corrected
that new expectation and documented both limits without changing the existing
parser. Both original raw reports are retained under ignored
`evidence/rcg4bc1-writer/`; this does not replace clean integrated-candidate
verification.

Initial report SHA-256:
`155c2caf1c7faba209fcd1c4d4a99a807a97ae3e4feb4467f8cdbf5d04a32c56`.
Corrected exploratory report SHA-256:
`68d04de7a97b03bca6ad06d6d8624aba7972d3df3da44751067170ac882693f0`.

## Independent review and behavioral fault observations

Both independent roles reviewed the exact clean candidate and its actual raw
reports in round one, without writing its implementation, tests or oracle.

| Role | Reviewer | Verdict | Retained review SHA-256 |
| --- | --- | --- | --- |
| Authority/security | `commerce_checkpoint_audit` | No scoped blocker | `9adabbbc7f6c9c475ebeb2d475345575866dce588685649c1db9c599b3f7be5f` |
| Regression | `receipt_regression_review` | No scoped regression blocker | `d8251d955c4ed8493832a9fd822c1482d7169b2a94355365a71a87fe13acaa39` |

Root retained byte-identical copies under `evidence/rcg4bc1-reviews/`. Each
reviewer also executed one separate deliberate source mutant of the finished
candidate. Neither mutant changes a test or oracle or enters the product branch.

| Deliberate isolated fault | Native result | Behavioral observation |
| --- | --- | --- |
| Remove only START operation equality; `d43f2e2ba7d766171b6419820687b7e023ec4ef4` | 18 passed, 2 failed of 20 | START-BINDING and RECOVERY-BINDING report missing expected rejection of a substituted operation |
| Remove only original command-ID equality, retain digest equality; `425704152ccde767a8e4912ad41aca6786a50f50` | 19 passed, 1 failed of 20 | ENVELOPE reports missing expected rejection of the shape-valid ID-only substitution |

Operation mutant report SHA-256:
`b8dab894124e97f401f1802fe041df765aecfe5e3dfc9301bc4613e681a0ca66`.
Identity mutant report SHA-256:
`6afda42402faf183c680c525efd1edb8679b3e76bb8114b2239a37c554d02721`.
Their native XML/TAP confirms all 20 cases executed in each file with no skips.
The unchanged wrapper stops passing-case aggregation after a nonzero subprocess
and therefore records `actual_tests: 0` for these deliberate failing runs; it is
not the execution denominator. These are meaningful behavioral fault checks,
not missing-module failures or regressions in the protected implementation.

## Preservation and source equivalence

The independent synthetic oracle has SHA-256
`a01e0ce41eec664f0e4275411c1d14abbbc7433bcda7934017c66f57587f5b19`.
Both reviewers independently recomputed its canonical mutation/recovery bodies
and digests before implementation review. New registration adds 20 codec and
five native composition cases to the protected 3,634 cases and one proposed
capability to the protected 230. All 399 protected paths remain registered.

Final totals are 1,800 source paths, 3,659 registered cases and 231 capabilities.
All prior rows, component identities, obligations and acceptance records remain.
The eight new paths are exactly the assigned additions. Only the explicitly
authorized licensing source count/reason change. Privacy preserves all 355 old
runtime pins and 15 surfaces, appending the new codec pin and its membership in
existing transient process memory. Every prior runtime module, helper, parser,
test, browser asset, workflow and dependency retains its original bytes.

Repository layout, plan contracts, generated views and diff checks pass. These
are structural observations, not product acceptance or a full regression run.
The closing changes are limited to this work record and the five current guides
`ARCHITECTURE.md`, `PLANS.md`, `ROADMAP.md`, `DELEGATED-COMMAND-CONSUMER.md` and
`DELEGATED-CHECKOUT-RECEIPT-REVIEW.md`. Exact-source equivalence and both closing
review attestations must bind the final documentation tree before publication;
runtime, tests, fixtures, inventories, registrations and dependency bytes remain
those of the executed candidate. Raw reports are retained in ignored local
evidence; the committed decision and hashes do not imply remote raw-report storage.

## Publication and next development boundary

The published assignment [3256960](https://github.com/burdettadam/rifare/commit/32569608dbeab0ae658e4f2aa869599f045b48a8)
has the exact tree of native `a40cb2c` and precedes the implementation.
The published candidate [ae924a1](https://github.com/burdettadam/rifare/commit/ae924a1d9e0e45942b7ef164168df16048d6d8a4)
has the exact tree `07fc627702007bacc2ba7107b629007cc4f5a881` of native `e8c87c2`.
GitHub-authored commit identities differ; actual tests ran on the named clean
native candidate, not on a re-labeled public SHA. Native history is retained
separately. Publication uses the authorized feature branch with `[skip ci]`;
no hosted workflow dispatch, default-branch merge, release or deployment is claimed.

RCG-4B-C1 closes only the local P03 consumer prerequisite. Continue RCG-4B with
the qualified public authentication/current-state, use and original-result
contracts, durable original claims and actual transport. Preserve tenant/typed
actor binding separately from the body digest and establish the independent
receipt context through its real authority owners. Do not turn a challenge UUID
into its proof nonce or bridge the serving gap through private provider storage.
Full isolated RCG-5, connected RCG-6, merchant execution, target React/PostgreSQL,
formal milestone acceptance and production qualification remain open.
