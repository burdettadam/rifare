# M03 receiving-through-completion maintainer review

## Authority

Base `79bd07e`; prior ADR-0024 records DELEGATED-LOCAL-15 before implementation.
The owner delegates local judgment and merges. This is a same-assistant maintainer
review, not separate reviewer sessions. Local diagnostic integration is distinct
from formal milestone acceptance or public release. No expected product threshold,
existing case ID or prior executable test assertion is removed or weakened.

## Findings and corrections

1. An approved but unsent disposition could execute after local cancellation.
   Dispatch now checks the current case/policy and closure again before source
   effects. The failing regression and unchanged-after-fix assertion are retained.
2. Closing local work also blocked the separate cleanup path for unused labels.
   Existing label-void quotation explicitly uses cleanup context, while replacement
   labels and new orders remain blocked. A void request remains pending until an
   explicit fixture confirmation; it is not counted as reimbursement.
3. A native receipt with no disposition could not advance when the source later
   reported restock. Monotonic one-time disposition advancement is now allowed,
   immutable identity/physical observations remain enforced, and each observation
   is appended. The current projection stays one receipt, not a second unit.
4. The portable credit branch passed an object to the existing string-ID API.
   It now uses the canonical credit quotation contract. No financial function
   was duplicated in the skill or runner.
5. Random allocation IDs produced unstable default UI ordering. The rendered
   integration check exposed the wrong initial quotation selection. Allocations
   now sort by line ID, then stable allocation ID. Changed selections also fence
   delayed quote responses.
6. Native feed validation, customer erasure and storage inventory were reviewed
   together: quotation bodies are scrubbed, source/receipt audit identifiers are
   explicitly retained, and current authority gates all new status APIs.

## Test and evidence method

Fresh fixtures have separate stores/source databases and explicit expected unit,
stock and monetary results. Real child processes exercise scan replay, source
commit followed by abrupt exit, and cancellation racing with authorization. New
rendered component checks use an explicit HTTP bridge and deny direct browser
network calls. The independent Python workflow client imports no server modules.
Two separately configured merchant stores share an identical skill hash while
inventory-buffer policy produces different supported outcomes.

The separately packaged reports bind exact commits, controller/baseline hashes,
native commands, executed IDs, red/green observations, mutation failures and archive
checks. Prior executable test files and original registrations are compared by
bytes/identity. New source-count inventory entries are enumerated, not hidden by
ignoring them. Any timed-out exploratory run is retained, never counted as green.

## Disposition

Merge only after current complete native verification and maintainer fault review.
Formal M03 acceptance is blocked by the missing connected and target-stack evidence
listed in M03-QUALIFICATION.md. No money, merchandise or real customer data was
changed by the synthetic demonstrations. Keep the old branches and source ledgers.

## Explicit control-budget adoption

ADR-0025 precedes the increase from a 240-second native process budget to
480 seconds (600-second outer command budget). The expanded exploratory run took
263.94 seconds and its genuine UI failure is retained. Old assertions, deadlines
inside product operations, native ID checks, skip rejection and benchmark targets
are unchanged. The old external controller is retained; its refusal of protected
control changes is expected. A reviewed, separately pinned controller then runs
the complete accumulated inventory rather than overriding that refusal.
