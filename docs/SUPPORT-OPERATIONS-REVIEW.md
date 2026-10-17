# M05 delegated maintainer review

Authority: ADR-0027 / DELEGATED-LOCAL-17, recorded before implementation. Review is by the same assistant under the owner's delegated authority, not independent reviewer sessions. Local integration does not accept a production milestone or authorize publication.

## Actual review findings and corrections

1. **Native runner success state:** approved-provider routing originally expected `answered`, while the canonical runner returns `grounded_read`. A failing test demonstrated valid results being discarded. Routing now checks the real state, current source digest, model/configuration identity and pinned skill; no fabricated output is accepted.
2. **Revoked reviewer authority:** rule publication originally retained approval after the reviewer lost `policy.review`. The new failing reproduction changed actual permissions. Publication now binds and rechecks the authority revision with the exact rule digest.
3. **Late closure authority:** receipt creation validated the operator before acquiring the transaction. A controlled permission change at the write boundary demonstrated a stale closure write. Current case/actor authorization now runs under the transaction for closures and customer confirmation.
4. **Hidden signed-out context:** generation fencing prevented a late response from rendering, but ownership and summary strings remained in hidden DOM nodes. The new browser assertion failed. Clearing a session/error now removes those nodes and sender options, as well as messages and shipment cards.
5. **Uncooperative transports:** adapter deadlines now race both the request and response-body read, rather than relying solely on AbortSignal compliance. Separate tests never resolve each stage and require a bounded timeout.
6. **Component random IDs:** the explicit component environment does not expose `crypto.randomUUID`. The UI uses cryptographic random bytes for local request IDs; no test shim changes production behavior. Tokens still remain in memory only.

Initial SQL/fixture/API-shape mistakes were corrected before acceptance; these are not represented as adversarial proof. No original test was changed to accommodate them.

## Review scope and invariants

Checks cover exact case/account links, customer-versus-staff visibility, immutable message identities, suppressed marketing, final send authorization, lost-result reconciliation, no default egress, grant/revocation races, fixed model destinations, budget oversubscription, delayed-rule pins, configuration-specific qualification, raw-text minimization, retained denominators, and legacy return/edit gateways.

Actual separate processes prove one final-budget reservation and recovery after a source commit with no local acknowledgment. The source effect remains one. Human takeover prevents later output/actions but cannot undo accepted delivery. A separately installed helpdesk or payment system is not simulated into a qualified deployment.

New test IDs/source paths are additive to the prior registry. Original sources may be extended only at the necessary authority, runner, gateway, durable-stream and privacy seams. Prior executable test bytes, specifications, numeric thresholds, package inputs and branch heads remain intact. Source inventory changes enumerate the new files; no ignored dependency is introduced. The preceding controller and protected-baseline comparison are used before any explicit post-review refresh.

## Deliberate regression proof

The separate evidence delivery records candidate-bound temporary variants for final-send suppression, human takeover, budget exhaustion, qualification pin drift, ticket-closure metrics and rule loop/duplication checks. Each required failure must be a behavioral assertion with a complete native run, not a missing import or syntax error. The broken variants are never merged. A prior protected assertion must also remain blocked by the external baseline.

## Decision

Integrate the verified bounded implementation locally after the complete applicable suite succeeds. Leave M05-G99 formally blocked on the missing target environment, connected helpdesk/sender/model evidence, direct served-browser qualification and independent intended-use validation. Do not create a tag, push a remote, send live data, download a model or start M06.

The evidence archive contains exact run metadata and restoration results; this document does not self-authenticate a review or predict passing results.
