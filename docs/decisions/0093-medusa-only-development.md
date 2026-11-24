# ADR-0093 — Retire the replaced application and simplify development

Status: owner-authorized implementation. Date: November 24, 2026.

The owner instructed: “simplify the project so we can make quicker improvements.
remove the replaced code, even if we have to debud the new code down the road.”

This supersedes ADR-0081's equivalence-before-deletion requirement. Medusa and
PostgreSQL are the sole application target. Remove the older SQLite application,
custom commerce engine, migrations, diagnostic clients/examples and associated
implementation tests. Fix missing behavior in Medusa rather than maintain two
engines. Retain native security/privacy/payment guards and their focused tests.

Extract shared hashing, shape/ID validation and command correlation without
changing their behavior. Retain command vectors, strict JSON/JOSE, real local
mTLS, configuration, Admin-build and compiled relocation tests.

Retire the bespoke development/planning/release-check framework. Use normal npm
commands and relevant tests. Preserve historical specifications, work records,
license terms/notices, dependency locks and private evidence. npm code checks do
not replace distribution, license, supply-chain or production qualification.
Existing CI workflows/triggers are preserved; hosted Actions remain unused under
the cost restriction.

Removed features may be unavailable until implemented against Medusa. Retired
tests/gates are not passing results, and old receipts do not qualify new output.
The paused native matrix remains failed/partial. No connected provider, live
settlement, production, commercial-transfer or release acceptance is granted.
Other workers retain Supabase and ElevenID deployment ownership.

Root is sole writer on `feat/medusa-native-execution-fence`. The exact deletion
list was independently reviewed. Checkpoint `9b2fbec` is retained in normal Git
history and `recovery/pre-medusa-simplification-9b2fbec`. Only tracked files are
retired; ignored configuration, data and evidence remain untouched.
