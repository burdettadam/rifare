# RCG-5A — Local checkout process lifecycle

Assignment: [ADR-0071](../../docs/decisions/0071-delegated-checkout-process-lifecycle.md).
Protected base: `3872996279120ae75c8a7762815a079f7e5c1519`.
Branch: `feat/rcg5-process-lifecycle`; root integration writer.
Assignment committed before implementation at `fd32321`.
Status: implemented local candidate; no formal acceptance or release.

Deliver a disposable native server and copied-client journey, real process
restart over original SQLite evidence, and two-instance isolation. Preserve all
existing checkout owners and contracts. Provider final use and the complete
isolated cross-service deployment journey remain open.

## Delivered behavior

The no-argument [demonstration](../../docs/DELEGATED-CHECKOUT-LIFECYCLE.md) starts
two actual native HTTP processes and runs the existing Python client from a
copied isolated directory. The independent client creates original intents,
captures synthetic signed evidence and checks exact retry. A bounded one-use
loopback response-loss fault discards a completed receipt response; explicit
status recovers the same original intent. The command then kills the server,
observes its exit and starts a new process over the same native database.

History startup validates original fixture/schema/store/migration identity and
does not reseed or issue new sessions, load signing keys, or recreate
preview/context/verifier provenance. Original current-proof history remains
readable; a prepared uncaptured intent stays unavailable for new receipt capture.
Revision-bound cancellation remains available. The second instance continues
independently and rejects foreign bearers and intent IDs. Native economic/source
ledgers retain their original digests. The parent owns bounded process lifetimes,
output collection and temporary-directory cleanup.

All fixtures are invented local data. No native checkout owner, public server,
HTTP contract/parser, independent client, provider adapter, migration or dependency
manifest changed. Ephemeral signing uses the already pinned maintained JOSE
implementation. Private pipes and transient environments are not an OS sandbox
or zeroization guarantee. Forced parent termination can leave owned temporary
files requiring operator cleanup.

## Behavioral and compatibility evidence

Before implementation, the original `dev-commerce.mts` completed an actual
customer challenge (202) and proof verification (200), then failed the expected
checkout preview with HTTP 503 `CHECKOUT_UNAVAILABLE`. The recorded fault is a
missing runnable composition, not an import or setup failure. Its exact report
and log are retained under ignored `evidence/rcg5-targeted-red.*`.

The new focused selection passed 22 cases: 16 fixture/runtime cases and six
process/controller cases. It includes real process loss, retained identity,
independent copied execution, isolated databases and ports, lost-response
recovery, current proof and revoked sessions, file/link/schema/marker refusals,
bounded startup, parent disconnection, interruption and owned cleanup. Unchanged
native intent/receipt coverage passed 45 cases. These author observations precede
the fixed review commit; final reviews bind exact source bytes and independently
rerun the new selection and relevant old HTTP/client/privacy selections.

Fresh strict comparison uses the same 21 existing entry files, TypeScript 7.0.2
and current Node type environment. It establishes 807 inherited baseline
diagnostic blocks. Ten additions in the new fixture's type annotations/narrowing
were corrected before fixing this candidate. The independent regression review
must confirm zero new complete diagnostic blocks; no clean whole-project
typecheck or reduction from differently scoped historical counts is claimed.

Registration retains 1,756 original source members, all 342 existing test sources,
3,530 old case rows, 226 capabilities and 949 specifications. Nine new sources
produce 1,765 members; 22 cases produce 3,552 rows and one proposed capability
produces 227. Privacy preserves all 351 old pins, the same fifteen surfaces and
schema, adding two development sources and explicit transient-memory/owned
synthetic-storage handling. The original adapter catalog remains byte-identical.
Existing accepted criteria, dependency manifests, workflow policy and ledger are
unchanged. Repository structure and whitespace checks passed.

## Review and remaining boundaries

Independent authority/security and regression reviews are required on the fixed
final candidate. The separate Git-tracked handoff retains exact reviewer records,
final commit/tree, focused report provenance and restoration instructions. This
work record cannot approve itself. Preserve original author versus independent
execution distinctions and do not count repeated cases twice.

Marty UI main advanced to `c1e4399ae0e1c36cbb673c3c324e38e547ea56be`, while
delegated PR #1994 remains draft/unmerged at
`aec45c6176618b3fe12d7e51e6809c4ba2d87126`. Inspection covered the frozen
400-entry route inventory and additional runtime/native registrations separately;
no delegated final-use or uncertain-outcome transport was found. RCG-4B and the
complete RCG-5 cross-service deployment remain open.

Publication remains authorized. Fresh native Git push failed for unavailable
credentials; the connector rejected the actual tracked API-contract blob write
with HTTP 403 `Resource not accessible by integration`. No remote publication,
PR, hosted CI or release is claimed. Preserve verified Git bundles and reconcile
actual remote refs before a later successful push.
