# Development governance

The owner's current instruction is to simplify Rifare and remove replaced code,
even where the replacement may need later debugging. ADR-0093 records that change
to the earlier equivalence-before-deletion policy. Ordinary development does not
require maintaining the retired SQLite engine or its test/release framework.

Use one writer, normal Git and small relevant local checks. Preserve unmerged
commits, user changes, local configuration and raw evidence. Independent authority
and regression review still apply to meaningful authorization/data/effect changes.
Retired coverage is never reported as passing or as native acceptance.

The existing license terms, notices, source provenance and locked dependencies
remain applicable. The retired bespoke release checker is not replaced by a legal,
distribution or supply-chain approval from `npm run check`. Release qualification
is open. Do not fabricate DCO signoffs or external authorization.

Keep production and unqualified public commerce effects gated. User-authorized
local code retirement grants no provider enrollment, live financial authority,
release tag or production acceptance. Supabase and ElevenID deployment changes
remain owned by other workers.

Hosted Actions are unavailable for cost reasons. Use local checks and `[skip ci]`;
do not dispatch Actions. Normal authorized PR integration must still respect
actual repository review and protection requirements.

## External actions and releases

Tagged/public releases require explicit human approval. Do not publish, create external issues, contact others or spend funds merely because work appears ready. Existing authorization for a development branch does not grant release or production authority.
