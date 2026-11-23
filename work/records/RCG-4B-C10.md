# RCG-4B-C10 - Native original payment association

State: assigned; implementation pending.
Base: `f7862128261e22f1febb02ce498cf1a8ea66409b`.
Branch: `feat/medusa-payment-binding`.
Writer/integration owner: root, existing primary Rifare checkout.
Contract: [ADR-0088](../../docs/decisions/0088-native-payment-association.md).

C9 PR8 is verified merged with the published feature checkpoint retained. Its owned
80,991-file runtime and 86-file compiler output are removed after fresh Windows
link/consumer/mount/process/delete-share checks. A normal deletion hit a verified
261-character generated path; fresh extended-path retry retired the remainder.
Windows allocated bytes measured on the retry were418877568; observed host free
space rose429719552 during that retry under concurrent unrelated activity. Raw
first/final audits, qualification receipts, installed-lock bytes and source refs
remain in existing ignored evidence. No linked checkout remains from C9.

This assignment inspected one primary/zero linked Rifare worktrees and no overlapping
payment/authority feature branch. Root keeps the primary active and starts this
branch from canonical development; no new checkout/cache/runtime is created.
The old implementation history and all prior feature refs stay preserved. Host C
free space observed62561673216 bytes before assignment, not a guest-disk estimate.

Source inspection confirms Medusa's cart/collection and region/provider link owners,
raw payment amounts, provider-enabled state and compensation behavior. The existing
cart facts intentionally exclude payment data. C10 adds only a separate native
association prerequisite; protected effects remain held. Do not treat a pending
native session or signed historical ACTIVE claim as current execution authority.

Next: implement the bounded native reader/immutable association/privacy tuple with
actual PostgreSQL tests under ADR-0088, then fixed compiled qualification and both
independent roles. Connected provider/custody and complete execution gates remain
owned separately; do not duplicate ElevenID/Supabase deployment work.
