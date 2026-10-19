# ADR-0051: M17 image-assistance recovery development

## Prior authority and actual baseline

The owner renewed the instruction "Proceed with goals until next milestone"
after being informed that the last M16 local checkpoint was unavailable.
The standing delegation authorizes bounded development and reversible recovery
work. This assignment starts from the independently restored saved roadmap
checkpoint a33c4ad57d13223c05ca985e5728404b671ab21a, tree
2cbdf523001ebebb97897bcf71d425a6e1fcb6f6, with 1755 source paths and 101 native
refs. Its archive is Rifare-M23-M25-worker-roadmap.zip, SHA-256
b84ea4092006733f263c03e5646d5e5ca0cd57bd32ed43298a4589c43483f72c.

The separately recorded later M23, M15 and M16 implementations are NOT present
in this repository. In particular, M16 commit
45c5d54ab6a8ae97cf80e1db4e171fc521d120ac has not been restored. This is an
isolated recovery branch, not a replacement or claimed continuation of that
commit. Main stays at a33c4ad. Preserve native history and label new work for
later reconciliation with the missing checkpoints. Do not recreate their
Git identities, claim their tests passed here, or infer their isolation.

M17 has no direct canonical dependency on M15, M16 or M23. The independently
reviewed scope permits M17-G01–G04 bounded local implementation, G05
qualification preparation and G99 local assessment on recovered M13/M14.
Formal M13-G99, M14-G99 and M17 acceptance remain blocked. All canonical
goal objects, cards, frozen requirements and the acceptance ledger remain
unchanged. This prior decision does not lower a qualification threshold.

## Ownership before implementation

Root alone writes the integration worktree recovery/M17-images and executes
product code. A separate image transport author uses recovery/M17-reader.
The nonauthor reviewers are /root/m17_recovery_security and
/root/m17_recovery_regression. They execute no product imports, tests, builds,
probes or installations. Both fixed-candidate reviews are required, with at
most three corrective rounds. Static read-only scope review has established
feasibility; it is not final candidate approval.

Root may create packages/commerce/image-assistance.mts, image-resources.mts,
image-privacy.mts, contracts/image-assistance.v1.json, a versioned
packages/commerce/skill-bundles/return-intake-images/ bundle, new
tests/development/image-assistance.test.mts and its helper, new
tests/fixtures/image-assistance/, M17 documentation and work records.
The versioned bundle retains the base return skill identity and text resource;
the existing bundle bytes remain unchanged.

The transport author may create packages/agent/image-reader.mts,
packages/agent/contracts/image-reader.v1.json,
tests/development/image-reader.test.mts, tests/fixtures/image-reader/,
docs/IMAGE-READER.md and work/records/M17-reader-author.md. No old runtime,
test, fixture or metadata is assigned to that author. Primary upstream
documentation research is read-only; no live provider operation is authorized.

Prior narrow old runtime scope: ReturnEvidence may call the new image-privacy
helper during individual erase and retention purge. PrivacyLifecycle may
minimize new image records for subject/gift erasure, correction, export and
restore behavior; existing privacy rules remain intact. SafeRecovery and
merchant portability may invalidate the new ephemeral image authority/records
at their existing restore/import interlock, without changing other kinds.
No new migration/table, old work-action widening, text decision contract,
text-reader branding, HTTP route or core business mutation is assigned.
Root may add exact source hashes/path coverage and refresh actually changed
hashes in component inventory, regression registry, privacy storage contract,
catalog oracle pins and licensing source-count metadata. Older objects,
requirements, tests, assertions, fixtures, boundaries and counts are protected
except exact additive path/hash/count maintenance. Any additional old runtime
change requires a concrete prior amendment.

## Bounded image path

Reuse canonical ReturnEvidence storage, strict validated PNG and quarantine.
The new workflow is disabled until explicit merchant image-purpose configuration
and exact customer evidence approval are present. Accept one image per request
within the retained 262144-byte, RGB/RGBA 8-bit, 4-million-pixel limits.
The original attachment channel and model_access:false responses remain intact.
Legacy external worker grants stay unchanged; the diagnostic execution owner is
a current authorized operator/support owner.

Use an explicit versioned media envelope around unchanged logical decision
validation. Pin tenant/store, actor/session, case/task/profile/skill, exact
image/hash/scan status/expiry, customer approval, provider-purpose configuration,
ownership generation and execution-stop generation. Recheck before bytes leave
the canonical store, immediately before transport, and after asynchronous work
before canonical persistence/return. Unknown attempts retain their original
budget/observation identity. No automatic retry or provider fallback.

The initial transformation is restricted_png_identity_v1: validate the original
complete PNG and create a bounded in-memory copy, preserving the exact source
hash and bytes. Metadata is rejected, not silently stripped. No thumbnail,
persistent derivative, remote URL fetch, arbitrary decoder, model-selected
attachment or new OS isolation is introduced. Managed M16 isolation is absent.
Drop owned transient references promptly; do not claim forensic deletion of
JavaScript strings, caller copies, operating-system snapshots or provider data.

Reuse support documents for versioned merchant configuration and assistance
receipts for task-bound approval, observations and bounded disagreement records.
Extend individual-image deletion and retention to every new receipt kind.
Subject/gift privacy and restored-backup checks use existing canonical owners.
Image-specific erase has no independently portable suppression ledger; its
backup-erasure qualification stays pending. A subject erasure with the existing
suppression checkpoint must fence processing and restore. Restore/import must
never reactivate saved image approvals or observations.

The same base return skill gains an optional versioned image question resource
for item visibility, clarity, requested detail and cannot-assess. Preserve all
required text and corrections; reject an oversized combined request without
truncation. Observations are advisory and cannot establish authenticity, fraud,
eligibility, approval, receipt, refund or inventory authority.

## Provider and qualification boundaries

Use a separately installed Cloudflare Clef-Omni image transport with a fixed
account/model allowlist, explicit no-redirect/no-retry behavior, bounded response,
timeout and cancellation. The hosted API is documented, but this assignment
permits only synthetic wire execution. Live transport remains unavailable in
this diagnostic implementation; a new qualified activation is required.
Do not add a live-enable flag that mistakes local fixtures for media qualification.
Server credentials remain inside SecretVault; use ModelBudgets and a separately
branded media receipt. Leave old text-only capabilities and receipts unchanged.

Freeze an image-evaluation protocol before implementation/evaluation: purpose,
question IDs and options, cohort roles/strata, references, preprocessing,
denominators, metrics, thresholds and cannot-assess/review treatment. Only actual
authorized image inference can satisfy its quality gate. Synthetic wire answers
are not accuracy measurements. Audio/video stay explicitly disabled/deferred;
text DLP is not claimed to inspect encoded media. External retention/deletion,
target-host isolation and formal acceptance remain pending.

## Focused evidence and recovery delivery

Tests and independent fixture expectations precede implementation. Plan 20 new
service cases and 10 transport cases, plus retained return-evidence (20) and
privacy-coverage (9): 59 cases in four whole files, one 60-second deadline.
The existing 60/4/60 defaults remain unchanged. Root runs the coherent candidate
and repeats only affected whole files for a concrete failure or consequential
correction. Capture a valid targeted fault on a separate ref, never integrate it.
No broad/full regression, model inference, browser or historical replay campaign
is assigned. Git/archive integrity verification is not product execution.

Preserve 3048 old registration objects, 206 capabilities, 482 protected paths,
1755 old source paths, 297 runtime pins, 262 tables, 37 catalog adapters,
569 catalog oracle pins, all original migrations and the canonical plan.
New diagnostic capabilities must be clearly proposed/unaccepted.
Any resulting checkpoint states its recovered base and reconciliation gap.
No release, remote push, publication, paid effect, customer media processing or
third-party message is authorized. The previously rejected complete M16/archive
upload is not retried or bypassed by this recovery assignment.

## Hold-preservation clarification before integration

The independent privacy design review identified that unconditional deletion of
image records during a held uninstall, restore, or consent withdrawal would
discard retained evidence. Existing hold rules remain authoritative. Uninstall
revokes every image configuration version and preserves held image receipts.
Consent withdrawal preserves held receipts and marks the approval revoked with
an integrity-protected timestamp; an unheld withdrawal can delete linked image
records. Restore/import with held image content fails closed for separate local
retention administration, rather than silently dropping that content. These
behaviors do not activate any saved approval or add a new table/authority kind.
Gift image consent/inference remains unavailable; the gift privacy test creates
a canonical gift case and seeds explicitly labeled historical/imported residue.
