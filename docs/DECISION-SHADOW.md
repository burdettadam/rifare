# Return-intake decision observations

M13 adds an optional server-side observation service for a currently authorized
operator, case and read task. It reports the customer's stated problem and
requested resolution. A reported refund request is a classification of text;
the existing return workflow still owns eligibility, preview, independent
approval and execution. No observation changes assignment, policy, stock, money
or business-operation identity.

## Shared questions and current sources

The new checked `return-intake-shadow` skill contains one versioned question
resource. Two declared vocabulary variants use the existing tone/locale profile
fields: warm/en-US and formal/en-GB. Both retain the same answer IDs and required
source fields. Arbitrary merchant rubrics, thresholds and authority overrides
are rejected. Existing skill bundles, global profile defaults and archived case
pins are preserved.

`DecisionResources.snapshot` resumes the actual case, checks current resource
permission and the task's case resource, profile revision, skill approval and
composition pins, then reads the current support history. Only incoming public
customer text is included. Customer statements retain a `reported_unverified`
label; observed order status and optional shipment status remain separate facts.
Missing or stale required order status makes the request unavailable. Partial
history and absent optional shipment data remain explicit gaps.

The complete selected history and exact request are hashed with source, question,
profile and preprocessing versions. More than 100 history messages or an encoded
request above the reader's finite bound makes inference unavailable. A selected
prefix is never silently submitted. Attachments, signed media URLs, binary
evidence and extra caller input fields are rejected or excluded. The byte bound
is conservative; it does not establish a live tokenizer measurement.

## Configuration and execution

The application installs a frozen Workers AI reader in its existing `SecretVault`
and installs the same configuration in `DecisionShadow`. An owner publishes an
expiring tenant/store `decision_shadow` configuration through the existing
support-document owner. Configuration records bind purpose, shadow mode, reader
digest and immutable fixture/live kind; credentials stay in the vault.

`prepare` returns an opaque, single-use handle backed by private preparation
state. `execute` rechecks its original actor/session, current ownership generation,
execution-stop generation, case/task sources and published configuration before
and after awaiting the reader. The trusted vault envelope includes the approved
reader digest, and the actual reader must match it before dispatch. A changed
catalog entry cannot silently select an old account or old bounds in the vault.

The existing model budget must reserve the request before dispatch. Unknown usage
retains the maximum reservation. The internal positive output bound is an
accounting requirement and is never sent as a Clef parameter; reported zero output
tokens remain valid. Fixed account/model allowlists, redirect rejection, finite
deadline/response limits and default live denial are described in
[DECISION-MODELS.md](DECISION-MODELS.md).

One case/request ID owns one observation. Completed replay is a current-authorized
read. Concurrent preparations, including another current session, cannot dispatch
again or overwrite the first attempt's receipt. An unresolved attempted identity
stays held; a new inference explicitly uses a new request ID. Configuration or
authority changes during a call prevent committing the late result.

## Receipts, operator view and privacy

Receipts use `commerce_assistance_receipts` and the actual
`commerce_context_tasks` foreign key. They contain normalized answers,
provider-reported confidence, usage or unknown usage, evidence/configuration
hashes, gaps, failure phase and provenance. Raw submitted text, credentials,
headers and provider errors are absent. `view` returns the reported labels,
review status and gaps with `execution_authorized:false` and the existing manual
workflow available. This milestone adds a server service; connected interface
and browser qualification remain separate.

Dispatch records distinguish a known predispatch denial, an actual fixture/live
reader result and a generic vault failure whose transport start is unconfirmed.
A configured live reader is not evidence of live inference. Recomputed public
hashes do not authenticate a caller's copied receipt: evaluation accepts only
objects branded by a canonical, currently authorized service read/run.

The existing privacy owner exports and erases the receipt through its real
customer task. Restore suppression removes erased observations, recovery revokes
credentials, and uninstall removes the store's receipts. Another subject's
records remain intact. Source systems, provider copies, caller memory and saved
exports retain their existing separate cleanup obligations; local erasure is not
a provider-deletion attestation. No table, migration or parallel privacy owner is
introduced.

## Frozen evaluation

The protocol and independent wire fixtures were committed before execution.
Six development cases cover clear, mixed, unknown, corrected, hostile and
profile-specific messages. Six separate held-out cases stay pending. Evaluation
checks exact cohort membership and source/variant hashes, rejects fixture-to-live
relabeling, and groups observations by immutable configuration and question set.
It reuses the retained source evaluator with no allowed business actions.

The frozen successful fixture oracle expects three correct classifications and
three correct review outcomes over six development observations. A separate valid
wrong-label fixture verifies the wrong-classification metric. These are fixture
contracts, not measured model accuracy. Provider latency and cost remain unknown;
M14 owns thresholds and any later routing activation. Actual native outcomes are
recorded separately in the checkpoint evidence.
