# Browser decision roadmap: worker handoff

This is the development handoff for the adopted M23–M25 expansion. It builds on
the reviewed M14 local checkpoint, `93769a3`, and preserves all earlier work.
The adoption added **15 worker goals, three G99 assessments, 15 requirements and
69 behavioral specifications**. Those browser scopes remain active. Completed
local plans elsewhere have since been retired under ADR-0065; the current
[planning index](../planning/README.md) describes remaining work, while all 216
requirement contracts and 949 behavioral specifications are retained.

The specifications are development instructions, not executed tests. Browser
implementation, model downloads, actual-device inference and formal acceptance
have not been performed by this planning update. Actual progress remains in
work records and candidate-bound evidence.

Read [the architecture](ARCHITECTURE.md),
[ADR-0044](decisions/0044-browser-roadmap-adoption.md),
[current M14 qualification](M14-QUALIFICATION.md), and the selected goal packet.
The [searchable catalogue](../planning/WORKER-GOALS.html),
[complete Markdown catalogue](../planning/WORKER-GOALS.md),
[canonical goals](../planning/goals.json) and
[canonical specifications](../planning/test-specifications.json) contain the
same stable goal and case identities.

## Recommended next browser batch

M23-G01 through M23-G05 form the next coherent browser implementation batch.
Keep their dependency order and assign one writer per isolated worktree with
concrete nonoverlapping paths. Begin with the model/contract evidence and
browser-safe boundary; the loader, server intake and privacy paths must agree
on those contracts before integration.

This recommendation identifies a browser lane, separate from the next commerce
increment in [the current plan](PLANS.md). M15/M16 source remains missing from
recovered history; local M17–M20 foundations now exist as mapped in the
architecture. M14's formal and connected qualification remains open. Browser
goals need their own bounded assignment under the owner's delegation.

### M23 — Browser Clef Flash with pinned Kevala Q8 text

**Outcome:** optional text/JSON shadow suggestions in an opted-in desktop
operator browser, using the complete trained decision path and separately
identified client observations.

| Goal | Worker deliverable | Evidence the worker must produce |
| --- | --- | --- |
| [M23-G01](../planning/goals/M23/M23-G01.md) | Pin the complete Clef Flash conversion and reference contract. | An exact model/head/tokenizer/runtime/converter/pack manifest; an independently fixed comparison corpus and tolerances; a useful unavailable outcome when the pack cannot actually be prepared. |
| [M23-G02](../planning/goals/M23/M23-G02.md) | Load the pinned pack in a bounded desktop browser worker. | Explicit download/cache selection, integrity checks, progress/cancellation, bounded initialization and failures, and a truthful named-device capability record. |
| [M23-G03](../planning/goals/M23/M23-G03.md) | Add a browser adapter and separate client-observation ingestion. | Browser-safe logical contracts, a server-issued preparation identity, strict result validation, minimized server-owned observations and clear client provenance. |
| [M23-G04](../planning/goals/M23/M23-G04.md) | Apply purpose, privacy, cancellation and destination rules. | Current source/session/task checks, late-result rejection, model-cache separation, application cleanup boundaries and an explicit permitted mode change for hosted fallback. |
| [M23-G05](../planning/goals/M23/M23-G05.md) | Demonstrate real desktop fidelity and case shadow behavior. | Actual controlled browser/model observations on a named profile, comparison with the fixed reference, measured resources and a synthetic commerce shadow journey. |
| [M23-G99](../planning/goals/M23/M23-G99.md) | Assess the integrated browser text capability. | All five worker outcomes, actual required browser observations and the original exit criteria; missing evidence remains blocked. |

Each worker has four stable case specifications. G99 has three assessment
specifications. Those cases describe obligations; they do not establish that a
browser, model or artifact has been exercised.

### M24 — Compact browser backend with joint-path verification

**Outcome:** a separately qualified smaller Wllama/GGUF option, with a measured
comparison and controlled replacement of the browser execution profile.

| Goal | Worker deliverable | Evidence the worker must produce |
| --- | --- | --- |
| [M24-G01](../planning/goals/M24/M24-G01.md) | Verify or repair Wllama's complete Clef joint path. | Exact supported joint-request behavior, trained-head/token/span handling, and a comparison that detects substitution with a generic text-generation path. |
| [M24-G02](../planning/goals/M24/M24-G02.md) | Package and load a verified compact Q4 candidate. | Pinned GGUF/runtime/converter identities, integrity and resource bounds, exact artifact availability and honest loading failures. |
| [M24-G03](../planning/goals/M24/M24-G03.md) | Normalize compact results through the browser observation boundary. | The same finite logical contract and untrusted client provenance, explicit numerical normalization, and unchanged server source/authority checks. |
| [M24-G04](../planning/goals/M24/M24-G04.md) | Run a predeclared paired browser evaluation. | A fixed same-task comparison reporting unavailable cases, memory, latency, numerical agreement and task-quality evidence separately. |
| [M24-G05](../planning/goals/M24/M24-G05.md) | Demonstrate controlled browser replacement and rollback. | Current-version activation, cancelled/stale work rejection, explicit profile switching, revoked-profile handling and rollback to the correct reviewed profile. |
| [M24-G99](../planning/goals/M24/M24-G99.md) | Assess the integrated compact browser capability. | Original exit criteria and actual comparison/qualification evidence, without treating smaller artifacts or plausible probabilities as acceptance. |

M24 preserves M14-G04's existing SystemOne endpoint transport. A browser runtime
is a separate execution profile; an endpoint or model name does not prove the
compact browser path works. Changed precision, runtime or preprocessing requires
its own comparison and applicable recalibration.

### M25 — Browser image evidence with a qualified vision decision path

**Outcome:** scoped browser image assistance over the existing M17 intake and
privacy owners, using an actually supported vision companion and decision API.

| Goal | Worker deliverable | Evidence the worker must produce |
| --- | --- | --- |
| [M25-G01](../planning/goals/M25/M25-G01.md) | Bind browser image scope to existing intake and privacy owners. | Purpose-specific exact-version media access, current permission/quarantine checks and rejection of evidence excluded from model access. |
| [M25-G02](../planning/goals/M25/M25-G02.md) | Qualify a compatible vision companion and decision API path. | Matching model/vision/preprocessing identities and an actual image-to-decision path; generic vision or chat support is insufficient. |
| [M25-G03](../planning/goals/M25/M25-G03.md) | Process exact authorized image bytes under explicit bounds. | Bounded preprocessing, source hashes, image/question alignment, explicit overflow/unsupported results and no silent source substitution. |
| [M25-G04](../planning/goals/M25/M25-G04.md) | Extend media privacy and cancellation through browser memory. | Current erasure and retention checks, application cleanup, cancellation, late-result rejection and no media leakage into model caches or telemetry. |
| [M25-G05](../planning/goals/M25/M25-G05.md) | Demonstrate scoped image evidence assistance on a real browser. | Named-device inference and measured image-task behavior using allowed media, with cannot-assess/manual outcomes and honest provenance. |
| [M25-G99](../planning/goals/M25/M25-G99.md) | Assess the integrated browser image capability. | M17/M23 prerequisites, all five component outcomes and actual required image-path evidence against the original exits. |

M25 does not require all of M24. The selected vision implementation must prove
its own runtime and image-path prerequisites. Browser-local image permission
does not permit hosted upload, and image qualification does not enable audio,
video, identity verification, fraud findings or financial decisions.

## Dependencies and assignment

The canonical cards retain both component dependencies and formal milestone
gates. Local preparation can be separately assigned using the current project
evidence; it cannot accept a missing prerequisite or redefine the exit criteria.

| Assessment | Required component goals | Additional formal prerequisites |
| --- | --- | --- |
| M23-G99 | M23-G01–G05 | M13-G99 |
| M24-G99 | M24-G01–G05 | M23-G99 and M14-G99 |
| M25-G99 | M25-G01–G05 | M17-G99 and M23-G99 |

For each worker, the maintainer binds the current base commit, one writer,
branch/worktree, actual allowed paths, shared-interface owner and independent
reviewers. Each new card includes inspected reuse paths and proposed future
paths. A proposed path is an implementation suggestion, not an existing module
or permission to overwrite its owner. Recheck those bindings against the actual
checkout before work begins.

Use the existing `work-goal` and `worktree-flow` skills, native Git and the work
record template. The catalogue and dependency waves are static planning views;
they are not a worker scheduler or live acceptance ledger.

## Invariants that every browser worker preserves

- The server remains the authority for tenant, store, actor/session, case/task,
  source access, configuration, purpose, approvals and effects.
- Client outputs, probabilities, timings and runtime claims remain client
  observations. An authenticated submission or server-issued observation receipt
  does not attest that a model ran or activate automatic routing.
- M13's hosted inference provenance and M14's known Workers AI/SystemOne server
  readers, fixed evaluation rules, routing fences and rollout controls remain
  intact. Browser-safe extraction preserves validation on both sides.
- Public model assets and private case content have different storage rules.
  Prompts, media, outputs and task tensors stay outside persistent model caches
  by default. Application cleanup cannot promise forensic deletion from an
  operator-controlled device.
- A failed local model preserves manual work. Hosted fallback requires its own
  permitted purpose/provider configuration and an explicit mode change.
- Cancellation, logout, tenant change, source replacement, erasure, takeover and
  configuration revocation invalidate late work. Observations and business
  effects retain their own original identities.

## Verification and handoff evidence

Write focused behavioral tests and independent fixtures before implementation.
Bind the stable `CASE-M23-*`, `CASE-M24-*` or `CASE-M25-*` specifications to real
native cases when the owning files exist. The proposed first slice in each card
is deliberately small. Select affected whole files for a coherent batch and use
the existing development runner after inspecting its plan.

The routine ceiling remains **60 actual cases, four whole files and one total
60-second deadline**. One designated executor runs the coherent selection;
authors and reviewers must not duplicate broad campaigns. Repeat affected files
only for a concrete failure or consequential correction. No full application
regression or model/browser campaign is required merely to update planning.

Model acquisition/conversion and actual browser qualification are separately
scoped work with recorded resources and a named execution profile. Do not hide
a long model load inside the short unit-test budget or substitute fixtures for
required actual inference. Preserve all failed, unavailable and deferred results.

Keep these evidence levels distinct:

| Evidence | What it can establish |
| --- | --- |
| Contract and fixture tests | Validation, authority, lifecycle and failure behavior exercised by those exact tests. |
| Controlled browser/model observations | Execution and numerical fidelity of a particular pinned build on a named browser/device. |
| Representative task evaluation | Quality and calibration for the frozen corpus, purpose and execution profile. |
| Formal milestone/release evidence | The original integrated exits and applicable deployment, privacy, security and external prerequisites. |

Every handoff records current candidate/base/tree identities, exact commands and
case counts, observed failures and corrections, runtime/model/pack/configuration
pins, independent reviews, concrete remaining blockers, and rollback/recovery.
Workers report ready for review, blocked or needs changes. The integration owner
records local outcomes separately from formal acceptance and release authority.

## Source preservation

The supplied old M13–M22 archive and the recovered expanded revision are preserved
as separate inputs in the cumulative checkpoint. The new revision's historical
M13 inspection is not a restore target. Canonical M00–M22 records and individual
cards retain their earlier bytes/objects; current M14 implementation, tests,
fixtures, history and accepted-goal ledger remain protected.

Requirement validation uses the exact union of the original 151, the separately
frozen 50 M13–M22 additions, and the newly frozen 15 M23–M25 additions. Browser
clarifications for M13, M14 and M17 are additive cross-references. They do not
replace an existing goal, lower its criteria, change a prior test ID or turn an
unperformed browser experiment into product evidence.
