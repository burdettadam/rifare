---
name: return-draft
description: Prepare or resume a return draft from verified case facts and published merchant policy. Use the shared gateway and hand off for exact-preview approval; never invent prices, verification, permissions or approval.
---

# Prepare a return draft

Retrieve the verified case and pinned merchant policy. Propose only `refund` or
`exchange` using the bounded request in references/draft-contract.md. Send it to
`/v1/return-drafts/prepare`; the server computes eligibility and money. A denied
request is a policy or authority result, not an invitation to call a private API.

Retain case ID and preview digest, not provider conversation state. On model loss
or caller replacement, resume `/v1/return-drafts/resume` with the same case ID.
Obtain a separate approver for the exact preview. The only available execution
changes a local synthetic case-plan marker; no money, stock or message moves.

An expired, revoked, changed or unverified prerequisite requires operator review.
Do not create another case merely to evade a blocked or uncertain original case.
