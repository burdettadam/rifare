# Reviewable risk assistance

The local fixture service shows source discrepancies and preserves their reasons,
uncertainty and history. It does not classify customers as fraudulent and has no
automatic denial action. Published return policy, customer verification, approval
and execution remain in the existing commerce services.

## Source and reviewer journey

`RiskAssistance.assess` reads an existing case and return quote, the current order
revision and the selected evidence scanner records. Indicators cite exact record
IDs, versions, digests, quantities and states. It can show unusable evidence, a
conflict between an order evidence flag and a scanner result, a changed order,
an unavailable selected quantity, or missing evidence under the pinned policy.
These observations do not establish intent or a fraud probability.

The quote's policy and complete configuration digest must match the current case
pins. Migrating either the policy or profile requires a fresh return quote before
another assessment; an old quote produces `RISK_CONFIGURATION_CHANGED` without
writing an assessment. Existing assessments remain readable with their original
policy, decision and configuration provenance after migration.

The reviewer can request evidence, dismiss an unsupported indicator, or invoke
the existing bounded return-window override. Evidence requests and window
overrides delegate to `ReturnReview` with its normal permissions, separate
reviewer, quote, reason and expiry checks. Dismissing an indicator grants no new
return or payment right. No method sends a customer message.

An authenticated customer can ask for human review or cite more evidence from
the same case. The customer view uses neutral language and omits private risk
indicators, model proposals, staff history and source scanner records. The
existing evidence API remains the way to submit attachments.

## Optional model proposal

The manual path uses no model. An optional, bounded fixture proposal may cite
only indicator codes already found in the captured source set. It must include
the matching source digest and provider/model/revision labels. These labels
describe a supplied fixture proposal; they do not attest that a provider ran.
Unknown fields, opaque scores, proposed outcomes, unsupported classifications
and public prose are rejected. Only the proposal digest is retained for a
rejected proposal; its raw text is neither stored nor published.

The normal `model.run` permission and model stop apply when a proposal is
supplied. A stopped model does not disable deterministic manual assistance.
Neither accepted nor rejected proposals modify policy or execute an action.
Historical assessments retain the original policy, source and model provenance
when a later assessment uses other signals or model labels.

## Contract and privacy

The methods accept strict input shapes:

| Method | Input fields | Authority |
| --- | --- | --- |
| `assess` | `case_id`, `quote_id`, `model` | Scoped `support.reply`; optional `model.run` |
| `read` | `case_id`, nullable `assessment_id` | Scoped case and return read |
| `review` | `assessment_id`, `assessment_digest`, `action`, `reason`, nullable `expires_at` | Existing `return.review`; no self review |
| `appeal` | `assessment_id`, `reason`, `evidence_ids` | Actual authenticated customer for that case |

Case access is checked on every read and write. Private histories remain blocked
after erasure, permission loss or store changes. The new core assessment and
review tables must be included in the integrated privacy export/erasure inventory.
Their source references retain minimized provenance; they contain no evidence
image bytes, raw return note or model-provider credential.

## Verification and limits

The permanent cases are in `tests/development/risk-assistance.test.mts` and the
independent known-answer data is in
`tests/fixtures/assistance/risk-golden.v1.json`. They preserve policy results under
unsupported model accusations and changed signals, check source-backed reviewer
controls and customer appeals, exercise permissions, restart and erasure guards,
and require the absence of paid-goods or financial effects.

This is synthetic discrepancy assistance. There is no live risk-model evaluation,
fraud classifier qualification, externally calibrated score, provider connection
or merchant pilot. Formal milestone prerequisites and goal acceptance remain
open. Rollback must retain the new historical records for later reviewed recovery;
restoring older source does not authorize losing recorded appeals or reviewer
decisions.
