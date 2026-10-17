# Rifare plans and current state

## Current integrated development

M03-G06 through M03-G10 add mixed outcome allocation, original paid-value refund
quotations, synthetic refund execution/reconciliation, native-credit fixtures and
variant exchange quotes. Read [the guide](docs/RETURN-RESOLUTION.md) and
[review](docs/RETURN-RESOLUTION-REVIEW.md). All earlier source, tests, model-neutral
interfaces and benchmark contracts remain in place.

## Remaining qualification and next work

M02-G99 and target-stack qualification remain blocked. SQLite and separate native
source fixtures do not establish live financial authority, PostgreSQL/React behavior
or production security/privacy. The next goal is M03-G11, inventory reservation
under concurrency. Preserve existing unknown effects and conservative unit claims;
no changed key, model or repeated request authorizes another effect.

## Source of truth

Original planning JSON and test specifications retain their meaning. Work records
are separate from acceptance assertions. Use ordinary Git and the existing project
commands and skills; no mandatory model or scheduler is introduced.
