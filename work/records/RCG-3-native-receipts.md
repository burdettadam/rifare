# RCG-3-NATIVE-RECEIPTS — Local signature verification and receipt evidence

State: ready_for_review; local implementation and registration complete
Writer/integration owner: root development agent
Branch/worktree: `feat/rcg3-native-receipts`, `rifare-rcg3-native`
Base: `9bf387278a496c71bcca327873dc5233fe004ca6`
Assignment: [ADR-0068](../../docs/decisions/0068-native-receipt-verification.md)
Independent fixed-candidate review roles: `/root/rcg3_authority_review` and `/root/rcg3_regression_review`
Dependency implementation: `/root/rcg3_jose_dependency`
Upstream protocol/source reconnaissance: `/root/rcg3_provider_contract`
Formal acceptance: not requested or inferred

## Outcome and bounded paths

Verify real compact signatures against configured issuer/purpose keys and bind
the authenticated claims to an original native checkout and server-resolved
context. Current context, trust, customer, source and deadline checks must survive
asynchronous cryptography. Output remains non-executing evidence. No public
Gateway route, provider final use, durable receipt redemption or merchant effect.

Allowed paths and the prior narrow dependency-intake exception are recorded in
ADR-0068. Root package/lock, command manifests, frozen licensing controls, old
tests, behavioral oracles, acceptance ledger and original goal criteria remain
unchanged. The separately supplied protocol vectors are not redistributed.

## Starting observations

- Both published synthetic signatures independently verify using public keys;
  altered signatures and signing inputs deny. Protocol profile is still draft.
- Staged binder can return expired evidence when its final digest advances time
  after the completion sample. Preserve the reproduction and add a named test.
- Native operation receipts are customer notes and operation queues dispatch
  work; neither is repurposed as a delegated authorization store.
- Current Git publication is blocked by missing CLI credentials and connector
  HTTP 403. New local commits remain preservable as a Git bundle.

## Evidence and review

Implementation candidate: this runtime/source-registration commit; exact SHA
and subsequent independent review disposition are preserved in the Codex handoff.

Focused native checks (each within ordinary 60-case/four-file/60-second budget):

- 44 receipt claim/hardening cases passed, including all 43 earlier obligations
  and a new final-hashing expiry regression. Local report
  `evidence/development/20261120T025904.691800Z-f71719/report.json`.
- 36 JOSE/native receipt cases passed (14 signature/encoding/trust cases and
  22 native integration cases). Local report
  `evidence/development/20261120T030840.040253Z-5e7a0a/report.json`, rerun after
  the final optional installation layout was integrated.
- All 57 unchanged RCG-2 checkout/composer/shopping cases passed. Local report
  `evidence/development/20261120T030335.781361Z-e56436/report.json`.
- Strict TypeScript comparison retains exactly the base's 557 diagnostics,
  with zero added or removed diagnostic lines. This is no-new-diagnostics
  evidence, not a successful whole-project typecheck.
- Both pinned upstream ES256/EdDSA vectors independently verified with Python
  cryptography; altered input/signature rejected. Native tests use maintained
  JOSE and separate original synthetic checkout claims. Proprietary vector
  bytes and local raw logs remain outside source exports.
- 13 optional installer, 14 optional intake and all 8 unchanged root intake
  cases passed together with all 9 unchanged privacy cases. Local report
  `evidence/development/20261120T030838.861202Z-7bed96/report.json`.
- All 78 unchanged distribution cases passed in one deliberate 78-case
  selection for the modified checker (one file, 12.060 seconds, unchanged
  60-second deadline). Local report
  `evidence/development/20261120T030639.079443Z-5af67f/report.json`.
- Plan criteria, generated views, repository and distribution checks pass;
  1,737 source members retain all 1,715 prior members. The registry adds only
  this proposed capability and its 80 runtime/27 Python cases.
- The actual cached optional installation succeeded with 80 JOSE files and
  retained tree digest
  `8247cbabe4fe086e6330038cc15353b9f5cd001dd7650916657e68de4e6cf863`.
  Original upstream package/license pins are checked. Root and optional
  manifests remain unchanged by installation. No nested dependency remains
  below the first-party runtime source roots.

Meaningful pre-fix failures were demonstrated for final hashing after the expiry
sample, asynchronous trust assertions treated as complete, and raw signed
fractional revision tokens rounding to an expected integer. Each now has a
named passing native regression. No cryptographic primitive was implemented.

Preliminary independent privacy inspection assigned the four runtime additions
to existing process memory: no new SQL table, durable context/receipt map,
network or logging sink. Registration adds four pins and updates the existing
checkout owner, retaining all fifteen surfaces and every prior handling/schema
field. All nine original privacy cases pass with 347 runtime source pins;
privacy and deployment qualification remain false. Final fixed-candidate
authority/regression review is pending.

The additive catalog validates at 46 adapters, 221 operations, 308 unique native
case bindings and 47 retained direct fixtures. All old adapter/case/operation
objects are retained. Direct fixture validation additionally exposes an
**inherited** `destination` version mismatch: fixture
`source-sha256:b1207f123a954b32262f4dc989db32563bcacf4f18bed4def8510f7043302cd1`
versus catalog
`source-sha256:ef0aace5d1163b3736f01e5746c42e190ca2ea4a041266a6c126f923aed11b38`.
The same mismatch exists at base `9bf3872`. The broader catalog test also retains
its already-stale 38/199/262 expectations. These pre-existing controls were not
rewritten and no full-catalog or full-regression pass is claimed.

Publication: not attempted for this increment; the observed missing CLI
credentials and connector HTTP 403 write block remain. Local commits require a
durable incremental Git bundle and the handoff must report publication accurately.

Integration assignment supplement: ADR-0068 now also authorizes a bounded locked
optional-install helper and one additive local diagnostic catalog declaration.
These resolve discovered integration obligations while retaining the existing
privacy observer, adapter discovery, root manifests and all old catalog rows.
