# Rifare plans and current state

## Current integrated development

M03-G11 through M03-G15 add replacement reservations, approved replacement orders,
rate previews/purchase, independent label lifecycle/reimbursement, and carrier
tracking. Read [the guide](docs/RETURN-FULFILLMENT.md) and
[review](docs/RETURN-FULFILLMENT-REVIEW.md). Existing source, tests, provider-neutral
interfaces and benchmark contracts remain in place.

## Remaining qualification and next work

M02-G99 and target-stack qualification remain blocked. Separate SQLite fixture
ledgers are not live inventory/carrier/warehouse or settlement evidence. The next
goal is M03-G16, warehouse receiving. Preserve unknown outcomes and original IDs;
no changed key, model, agent or repeated request authorizes another effect.

## Source of truth

Original planning JSON and test specifications retain their meaning. Work records
are separate from acceptance assertions. Use ordinary Git and existing project
commands and skills; no mandatory model or scheduler is introduced.
