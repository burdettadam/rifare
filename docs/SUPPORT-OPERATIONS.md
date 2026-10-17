# Support, tracking and controlled autonomy

M05 implements a bounded SQLite diagnostic support system on the accumulated Rifare source. Start on delivered `main`. Original milestone acceptance still requires the target PostgreSQL/React environment, real merchant accounts, model qualification and independent intended-use validation. No live transport is configured by default.

## Run the actual diagnostic

```sh
npm ci --offline --ignore-scripts
python3 tools/verify.py --runtime --harness
node --experimental-strip-types tools/demo-support.mts
node --experimental-strip-types tools/demo-support.mts --serve
```

The serving command prints `/support`, `/tracking`, and an owner-only temporary session-file path. It does not print tokens. The file provides `operator`, `reviewer`, `owner`, `customer`, case `support_case`, and the two skill digests. Use the operator for the support console or the customer for the public-only tracking/chat experience. Ctrl-C closes the owned server and removes this private directory. All demonstration databases are in memory. Repeated startup creates new identities; no production service or paid model is used.

The demonstrated host is Node 22.16.0 / npm 10.9.2 / Python 3.13.5 on Linux. Browser-component checks require the already documented Playwright and Chromium. Missing tools fail rather than skip. The native cumulative suite retains its explicit 480-second process budget and the standalone runner retains 240 seconds. No new dependency input or build system is introduced.

## Architecture and supported behavior

| Goal | Boundary implemented |
| --- | --- |
| M05-G01 | Verified customer/order-bound channel links, account/native identity, ordered messages, staff visibility, duplicate handling, explicit partial history. Email resemblance alone cannot merge cases. |
| M05-G02 | Injected Chatwoot-shaped message-history, private-note and assignment adapter; scoped account paths and encrypted server-side credentials. Unknown private notes reconcile only with the operation marker; an assignment snapshot does not prove our own write occurred. |
| M05-G03 | Merchant-name/theme tracking for separate shipments, source observations, freshness, partial delivery and explicit unknown ETA. Delivery never proves inspection. |
| M05-G04 | Fixed transactional templates using the configured merchant sender, durable operation IDs, accepted/delivered/bounced/unknown states and readonly reconciliation. Resend-shaped transport is fixture-tested, not live-qualified. |
| M05-G05 | Consent by verified customer, sender, channel and purpose, with source/time/revision provenance and withdrawal precedence. SMS records can suppress but SMS delivery is not configured or qualified. |
| M05-G06 | Queueing is not send authority. Immediately before source invocation, recheck consent, current ownership/session, address facts, sender/configuration, execution stops and recovery quarantine. |
| M05-G07 | Typed priority rules, simulation, author-separated review, publication, revocation, pinned delayed jobs, explicit UTC calendars, deduplication and bounded loop depth. No arbitrary scripts or user-controlled tools. |
| M05-G08 | Modes and exact action/configuration qualification. Bounded mode still uses the original exact-preview approval gateway. Only the reversible synthetic case-plan action can qualify; real money is not enabled. Physical inspection uses receiving records, never a delivery flag. |
| M05-G09 | Atomic provider-period and optional aggregate merchant ceilings, worst-case reservations, observed usage settlement and retained unknown cost. Changed prices cannot rewrite past obligations; unsupported tokenizer bounds remain unqualified. |
| M05-G10 | Explicit merchant-approved destination identities, configuration digests, region declarations, bounded circuit cooldown and fallback. Recheck after awaits; unavailable providers leave manual context usable. Routing never restarts a business operation. |
| M05-G11 | Generation-fenced human takeover across gateway actions, outgoing messages and late model output. Existing case facts/receipts survive; takeover cannot recall an already accepted provider effect. |
| M05-G12 | Shared `support-reply` instructions, minimized untrusted content, current facts/citations, refusal of invented facts and a human handoff. Retrieved content never publishes policy. |
| M05-G13 | Shared `shipment-assistance` instructions, full-versus-partial shipment truth, unknown ETA and source-backed exceptions. Public context/resources work with a separate Python orchestrator. |
| M05-G14 | Frozen case cohorts, receipt-based handling, separate customer confirmation and ticket closure, mature/missing follow-up, declared contribution after costs and linked adjustments. Missing costs are unknown, never zero. |
| M05-G15 | Attributable return-reason and SKU/line cohorts, bounded keyword labels without raw customer text, sample/selection warnings and recommendation drafts only. No policy activation API. |
| M05-G16 | Fixed expected scenario IDs before reports, exact configuration/model/runtime/prompt/skill/action pins, numerical and critical-failure gates, current reviewer authority and revocation. Synthetic reports do not establish live model quality. |

## APIs and client independence

`startCommerceServer({ ..., support: new SupportService(kernel, reads, options) })` registers the fixed `POST /v1/support/...` routes. The default existing server does not silently provision senders, models or a helpdesk. Account identities and transports are supplied by server-side configuration. HTTP cannot select raw provider credentials, arbitrary URLs, source objects or price assertions.

[The route contract](../packages/commerce/contracts/support-api.v1.json) lists input shapes and side-effect boundaries. Routes include context/history, verified links, incoming customer chat, takeover, queue/dispatch/reconcile, rule and qualification administration, workflow content, and receipt metrics. Authentication is the existing scoped session mechanism; remote OAuth and channel federation remain separate work.

`clients/support_case.py` is a standard-library independent deterministic orchestrator. Supply one JSON object on stdin with `url`, `token`, `case_id`, `workflow`, `skill_digest`, and `request_id`. It accepts loopback only, denies redirects, retrieves and hashes the declared skill resources, requests current facts and submits selected fact IDs. It imports no Rifare server or built-in runner modules and neither sends a customer message nor requests a financial action. A compatible AI runtime can replace this orchestration, but live model quality is not inferred from its passing tests.

## Consent, message and race semantics

An operator cannot label arbitrary promotional content as transactional: templates determine purpose. The fixed synthetic marketing template exists only for suppression tests. Sending to a newly observed address requires fresh customer verification. Revocation after queueing and before the final authorization prevents source invocation; a stop after the provider has already accepted cannot retract that effect. Sending leases or failures without proof of non-transmission become unknown. Later same-resource support work is ordered within its own channel-action stream and does not replay or wait for unrelated financial work.

Resend's documented idempotency-key lifetime is 24 hours. Rifare retains its local operation identity beyond that window and never treats expiry as permission to send an uncertain email again. A lost response with no native ID remains unknown. Chatwoot history is conservatively partial, and current assignment alone cannot establish causal success of an earlier lost assignment write.

Configured `order_service` basis and `US_TEST` jurisdiction are diagnostic settings, not a legal-compliance decision or a grant for real campaign use. Production domains, provider accounts, customer permissions, opt-out rules, mailbox policies, egress and regional data processing require separate qualification. No SMS message, real email or helpdesk write was sent.

## Model budgets and autonomy

Provider-period limits are isolated per tenant/store and provider. Optional aggregate merchant limits apply across approved providers; absence of the applicable configured period blocks new calls. Unknown provider usage holds the full reservation. Actual observations above the estimated maximum are recorded, never clipped to make a budget look healthy. The current byte-bound approximation and declared micro-USD pricing are fixtures, not verified live invoices or universally correct tokenization. No autonomous loop beyond the existing bounded read runner is added.

A model change requires new configuration pins and evaluation. Read, copilot, approval-required and bounded action settings are distinct. A passing tracking case cannot qualify a refund. Current action readiness, published policy, customer verification, exact preview approval, worker ownership and physical receipt requirements remain independent conditions.

## Metrics and privacy

The denominator is a frozen list of cases rather than tickets later selected for success. Correct handling, requested/required handoff, customer-confirmed support resolution, ticket closure and financial settlement are different outputs. Seven-day repeat contact requires mature observation and complete current channel coverage; missing coverage makes the rate unavailable. Cost statements are declared operational data, not processor-verified invoices. Return-only insight groups do not estimate purchase-population prevalence or establish causation; small samples say so explicitly.

The schema inventory includes every new table. Scoped erasure removes raw messages, verified contact addresses and attempt/delivery bodies, closes ownership, stops pending work and revokes insight drafts. Minimized identifiers, consent suppression, cost/audit references and historical records remain for reconciliation. Existing retention holds continue to block deletion. External mailboxes, helpdesks, logs, database pages and backups need their own retention handling; logical erasure is not forensic erasure or compliance certification.

## Evidence and qualification

The native suite includes actual HTTP, separate Python orchestration, two real Node processes competing for the last budget, and a process that exits after committing the source message. The browser tests render actual HTML/JS and use an explicitly declared bridge to the real local API. This is not a direct served-browser claim. Screenshots contain synthetic data and no tokens. Executed evidence, native logs, exact candidate/controller pins and restore reports are delivered separately from source.

See [maintainer review](SUPPORT-OPERATIONS-REVIEW.md) and [M05 qualification](M05-QUALIFICATION.md). The batch stops at M05-G99; M06 is not started.

## Primary protocol references

- Chatwoot create-message/private-note and bearer authorization: https://developers.chatwoot.com/api-reference/messages/create-new-message
- Chatwoot history: https://developers.chatwoot.com/api-reference/messages/get-messages
- Chatwoot assignments: https://developers.chatwoot.com/api-reference/conversation-assignments/assign-conversation
- Resend send: https://resend.com/docs/api-reference/emails/send-email
- Resend idempotency limits: https://resend.com/docs/dashboard/emails/idempotency-keys
- Resend delivery observations: https://resend.com/docs/api-reference/emails/retrieve-email

These pages establish the public wire contracts, not successful use of the user's accounts. Adapter tests inject bounded protocol responses.
