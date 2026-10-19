# Calibrated decision routing and replacement

M14 adds a decision-specific qualification and routing layer using the existing
versioned support documents, rule owner, task-linked assistance receipts, current
case/profile/skill sources, credentials, model budgets and work controls. The
current checkpoint implements local diagnostic behavior. Connected model quality
and formal milestone acceptance require separate actual evidence.

## Frozen task and qualification

`DecisionRouting.freeze` captures a named task, question/resource/profile and
preprocessing pins, exact serving configuration, limits and confidence semantics.
The protocol fixes every cohort ID, source-text hash, reference labels, handling,
role and stratum before inference. It permits only damaged/refund and size-fit/
exchange classification to request the existing `draft_return` manual work; other
inputs request `handoff_request`. No classification approves a financial action.

The protocol uses at least sixty calibration and sixty held-out observations for
qualification, with at least thirty held-out routed cases. The lowest predeclared
threshold passing calibration is evaluated on held-out data without retuning.
Wrong routing must be at most 5% of routed cases and its one-sided 95% Wilson
upper bound at most 10%. Incorrect review is at most 10% of all enrolled role
cases; routing coverage is at least 50%. Every missing, unavailable or malformed
case remains in its role denominator. The twelve local reference cases are
explicitly insufficient for these gates. See the frozen fixture protocol and
its independent expected-outcome README for the complete denominator definitions.

Provider confidence and selected-option probability are separate numbers. M14
uses the minimum selected-option probability across the two questions as a
configuration-specific statistic. A probability field does not transfer a
calibrated threshold to another question vocabulary, locale, model or backend.

Protocols use lossless cohort tuples inside the existing 32 KiB document bound.
The returned `decoded_view:true` value contains a readable semantic protocol;
its document `digest` still binds the stored tuple encoding. `protocol_digest`
and `qualification_identity` bind the validated semantic protocol and pins.
Every read revalidates both. The 120-case persisted envelope is a native check.

`measure` accepts only cohort IDs plus actual case/observation references. It
reads canonical observations itself and rejects unknown or duplicate cohort IDs,
reused receipt identities, pre-freeze observations, changed text hashes and
mismatched configuration/source pins. Caller labels, reports and provenance flags
are not accepted. Shared qualification documents store configuration metadata,
source hashes and aggregate measurements; they do not store customer case IDs,
observation IDs, messages or credentials. Measured cost and latency remain null
when the current observation contract provides no measured values.

A numeric-only score has `authorizes_routing:false`. A full live cohort passing
its frozen gate may become eligible for independent review. An approved report
and current independently reviewed publication are both needed for a scoped
route. Synthetic transport receipts remain diagnostic, including a caller copy
whose flags have been edited to claim live success. Existing generative support
qualification and skill instruction canaries retain their original meanings.

## Publication and guarded routing

Qualification and publication require different author and reviewer actors,
current `policy.review` authority and exact record digests. Publications bind
configuration identity, two exact published rule IDs/versions/digests, an expiry
and a 25%, 50% or 100% rollout. The initial activation is complete; a smaller
canary needs a still-current explicitly published fallback. Deterministic case
buckets select one publication. Failed replacement leaves the active revision
unchanged. Rollback can select only a previously published, still-current target.

Routing starts with an opaque one-use preparation handle. It binds the original
actor/session, case/task input and evidence, ownership/work generation, model
stop generation, active publication, qualification and actual serving identity.
These remain current before dispatch, after the awaited observation and in the
transaction that applies the selected rule. Replaying a route is an authorized
read, with current model/recovery/stop checks, and creates no second action.

`SupportRules.applySelected` checks the exact active reviewed rule and current
reviewer, owner and work fence. It accepts only immediately due `draft_return`
or `handoff_request` rules triggered by a return request. It inserts/completes
that one existing job in the guarded transaction. The broad `schedule` method
keeps its original fan-out behavior and is not called by decision routing.
Delayed rules, tracking messages, financial actions and unrecognized fields are
rejected. This creates a durable request for manual work; it does not complete
a return or change a financial/physical stage. Ordinary manual case workflows
remain available after model or qualification disablement.

Observation and route receipts have distinct IDs and are linked by the original
observation digest, publication version and actual completed rule job. Both use
the real context-task foreign key. Existing export/erasure/restore suppression
and uninstall owners therefore reach them. Shared configuration records retain
only minimized hashes/aggregate metadata. Provider deletion is still external
and no local erasure result claims it.

## Replacement and confidence evidence

Cloudflare and SystemOne share the existing logical request/result contract,
current source snapshots and vault invocation. SystemOne has a separate exact
approved endpoint, immutable reader configuration, budget provider and metadata.
Historical observations preserve their original serving pins and distributions.
A new backend creates new observations, qualification identities and publications.
The original M13 verifier remains scoped to Cloudflare so its historical evaluator
cannot label a SystemOne result as Cloudflare. M14 uses the canonical two-backend
receipt verifier.

Configured and actually reported model revisions are distinct. An unknown hosted
revision stays null and requires a fresh six-case canary selected in the frozen
protocol. Canary observations must be later than the measured report and any
previous canary record; old observations cannot refresh it. The canary uses the
existing threshold and expected handling/labels, never retunes a model.

Compatibility reports separate implemented transports, eligible measured
configurations, currently published scoped routes, actually exercised backend
pairs, numerical/quality summaries and pending self-hosted work. Two fixtures or
a settings switch do not establish portability. Supplied self-hosted artifact
hashes/load claims establish attestation completeness only. Optional actual
self-hosting, inherited PostgreSQL/React/security/product gates, deployment and
release approval remain separate.

## Local commands and recovery

Root alone runs the selected native files under `tools/dev_tests.py`, at most
60 actual cases, four whole files and one total 60-second deadline. The retained
M13 shadow and privacy files cover the touched observation owner and current
privacy pins. No nested catalog, broad controller or restore campaign is implied.
The native report and two independent reviews, rather than this document, record
what was observed on the exact integrated candidate.

For a bad publication, revoke it or disable its active revision; an in-flight
result then cannot create a rule job. Rollback requires an explicit prior
publication, a current qualification and matching case/configuration pins. Keep
all observations and completed rule receipts. A credential/configuration failure
uses review/manual handling without automatic provider fallback, paid retries
or any change to the case's skill/policy identity.
