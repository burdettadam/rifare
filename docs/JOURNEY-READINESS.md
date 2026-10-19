# Current journey readiness

JourneyReadiness projects the existing local handlers into one fixed response.
It describes the named next step and returns execution_authorized:false on every
row. A form or current cart view does not approve a transaction. Quotes, consent,
independent approvals and native final authorization remain separate actions.

## Local interface

Construct JourneyReadiness(kernel, reads, {delivery, edits, cart}) using the
current native owners for that same kernel. Optional edit and shopping owners
may be absent. The existing SupportService exposes its projection with
post(scope, 'journey-readiness', input).

The input is exactly case_id, link_id, expected_generation, allocation_id,
cart_id and sender_id; the last three are nullable. A caller cannot submit a
previous readiness descriptor or an available flag. Every inspection checks
current authority and the current verified channel link. Staff and built-in
agent readers must own the current support generation. A customer can inspect
their own current verified context. A takeover invalidates the old generation.

| Action | Meaning of an available result |
| --- | --- |
| tracking.read | The current source-backed tracking view is available. |
| return.refund.form | The current configured refund form can be inspected. |
| return.exchange.form | The current configured exchange form can be inspected. |
| exchange.offers | The existing allocation has current browseable local offers. |
| order.edit.context | The attached native workflow and current edit source can be inspected. |
| shopping.cart.context | The original cart can be inspected against its current proposal/source. |
| followup.queue | Current sender, contact, consent, source and ownership permit this local queue step. |
| remote.continue | Unavailable until actual remote authorization and client qualification exist. |

## Unavailable states

Disabled means a current setting, permission or policy excludes the step.
Needs configuration identifies missing owners, workflow input, configuration or
required customer reverification. Unsupported identifies a step outside the
declared handler/channel/platform envelope. Temporarily unavailable identifies
stale facts, stopped execution or uncertain native outcomes. Unverified means
current qualification or retained integrity cannot be established.

Reasons and alternatives remain explicit. A missing provider history is shown
as missing history; it is never evidence that no earlier message was sent.
Source, sender, consent and permission changes affect the next inspection.
The current native owner checks them again when the caller attempts an action.

Only synthetic local qualifications are represented. In this recovered source,
M15 independent remote-client support remains missing. Built-in agent read
context does not expand its existing approved execution action list. Images,
audio, connected channels, target-host qualification and financial settlement
are not established by this projection.

An ordinary new customer session does not refresh the existing case's original
verification. If that proof expired, the affected form reports required customer
reverification. The inspector creates no replacement proof, quote, workflow pin,
approval, consent, operation, delivery or persisted readiness cache.

Restore quarantine keeps the existing common support authorization refusal.
No read is used to bypass recovery fences. Native action handlers and their
exact quote, approval and operation IDs are unchanged.
