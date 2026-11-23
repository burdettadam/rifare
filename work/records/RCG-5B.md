# RCG-5B — Original checkout preparation recovery

Assignment: [ADR-0072](../../docs/decisions/0072-original-checkout-preparation-recovery.md).
Protected base: `abcf93f57af54ec03e0179b49c1ec4f7ff0284c7`.
Root writer: `feat/rcg5-prepare-recovery`.
Assignment committed before implementation at `6f962e7`.
Status: implemented local candidate; no formal acceptance or release.

Recover an existing intent after loss of its preparation response, using the
original preview/context references and current native customer proof. Preserve
the original API/client contract, durable identity and all privacy/recovery
semantics. Add an explicit separately contracted lookup and independent caller
command; never create a replacement, restore live provenance or infer provider
authority. Final independent reviews and exact source/report bindings are retained
in the separate Git handoff; this work record cannot approve itself.

## Delivered behavior

[Original preparation recovery](../../docs/DELEGATED-CHECKOUT-RECOVERY.md) derives
the existing native tenant/store-bound identity from the original preview and
context references. Current customer/resource/contact proof precedes existence
disclosure. The complete digest must match on the same validated record used for
ordinary expiry observation, historical output, final access and unchanged-record
checks. There is no second public read that could select another record.

The new two-route `/v1/delegated-checkout-recovery` contract and explicit Python
`recovery-contract`/`lookup` commands retain the exact original seven-route API
and old command paths. The response binds the supplied original references to
the historical intent. Authorization precedes body collection, and the new route
reuses the existing strict decoder with a 4096-byte limit. Duplicate/ambiguous
JSON, malformed UTF-8 and unpaired surrogates are refused. The unchanged generic
HTTP body helper remains in use for old routes.

Lookup returns existing minimized, cancelled, held, erased or restored views
without live preview/context/verifier provenance or reconstructed personal data.
Ordinary expiry can advance the original revision. No intent, session, receipt,
provider call, challenge consumption, queue, order or payment is created. Absence
is not authority to replace or automatically retry an uncertain operation.

The separate no-argument demonstration performs eight checked observations. A
fixed owned loopback fault forwards preparation once, observes its completed 200
response privately and discards it. The copied Python caller fails without an
intent ID. The old server is killed and observed exiting; a different process
opens the original database without reseeding or reconstructing live owners.
Explicit lookup recovers the same ID, creation time, revision and binding digest.
Unknown/mixed references and foreign instances fail. Revision-bound cancellation
retains the same minimized history. One original intent, unchanged sessions
across restart and unchanged commerce/source digests remain. Owned processes and
temporary directories are cleaned. The old twelve-observation journey is intact.

## Behavioral and compatibility evidence

Before implementation, a real completed preparation response was discarded and
the server was replaced. The copied client had no intent ID. Old preparation
retry remained unavailable, while the required lookup returned 404 instead of
200. The database retained one original intent and unchanged effects. This was
an actual missing-behavior red, not an import or setup failure. Ignored
`evidence/rcg5b-targeted-red.json` has SHA-256
`c9e8e884fa4521dcdf626707e0c43c963e92af74012682ac9d27e8d45c731e2b`.

Author execution passed 17 new native cases and a separate 15-case HTTP/client
and process selection. The latter first exposed duplicate-key acceptance in the
generic parser; the assigned new recovery route now uses strict decoding and the
expanded malformed-input checks pass. Existing intent and lifecycle coverage
passed 29 unchanged cases. These observations have precommit/dirty provenance;
they are not described as independent executions on the final commit.

The exact candidate will be fixed for independent execution of all 32 registered
new cases and 51 unchanged HTTP/client/privacy cases. The final review records
must distinguish actual execution from source-graph equivalence and retain every
report hash. Count each selected case once; repeated runs and the standalone
eight-observation demo are separate evidence, not additional test cases.

The first fixed-candidate regression review passed the old 42 HTTP/client cases
but found three privacy cases failing because the new process-memory export
description exceeded the existing 3000-character field limit. The correction
restores that field's exact prior text and moves only the RCG-5B addition into
`observation_required`, within its original limit. The validator and all old tests
remain unchanged. Round-two review must bind and recheck the corrected candidate;
the first candidate and its passing/failed reports remain historical evidence.

Preliminary strict comparison found zero new or removed complete diagnostic
blocks after line/column normalization: 811 on each side. The earlier protected
27-entry comparison had 807. Four existing files newly reachable from the
recovery tests were added to both sides; they expose four inherited
merchant-portability diagnostics. Toolchain is TypeScript 7.0.2 and the same
Node/type environment. No clean whole-project typecheck or reduced debt is
claimed. The independent regression review must bind this comparison to the
fixed candidate or rerun if its source graph changes.

## Retained controls

Registration retains all 1,765 prior source members and adds eight, totaling
1,773. All 344 prior test-source files, 3,552 case rows, 227 capabilities and 949
specifications remain; 32 cases yield 3,584 rows and one proposed capability
yields 228. No formal acceptance is added.

Privacy retains all 353 source-pin paths, fifteen surfaces and the same schema;
four assigned runtime hashes are refreshed with additive transient-memory
handling. The adapter catalog retains its prior 695 oracle paths, operations,
cases and fixtures; three assigned source hashes are refreshed and the newly
imported recovery contract adds one pin. No unrelated inherited closure/count
issue is repaired. Original test/oracle obligations, dependency manifests,
migrations, record schemas, the old HTTP contract, accepted criteria, workflow
policy and acceptance ledger remain. Licensing changes only the assigned source
count/explanation. Structure and whitespace checks passed.

## Remaining work

Marty UI main is `f81bf70f867569db97f73b06dbaef7813e89118b`; its new application
image release documentation supplies no delegated runtime transport. PR #1994
remains draft/unmerged at `aec45c6176618b3fe12d7e51e6809c4ba2d87126`. No provider
current-state, final-use or uncertain-outcome contract was found in the refreshed
changes. RCG-4B and full isolated Rifare/ElevenID/merchant RCG-5 remain open.
The customer browser review page follows this recovery prerequisite and is not
delivered here. Target-stack and production qualification are unchanged.

Publication is already authorized. Fresh read-only refs retain Rifare development
at `933600561a989150e2a2d3c4273a57ee84cdad52` and no RCG feature branch. Prior
native credential and connector permission failures remain technical blockers;
no unchanged blocked write was repeated. No remote publication, PR, hosted CI,
merge or release is claimed. Keep verified native/handoff bundles and reconcile
remote refs before later publication.
