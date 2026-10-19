# Agency operations: scoped local development

ADR-0041 assigns M12-G01–G03 preparation. The implementation uses the original
CommerceKernel, permission table, profile service, case pins, support metrics
and native message delivery. It does not establish a global agency role or
qualify production, human ownership, M07-G99 or formal M12 acceptance.

## Store delegation

`AgencyAccess.grant(ownerScope, {agency_id, actor_id, role, actions,
resource_ids, expected_revision})` creates a managed membership or renews its
explicit permissions. Only a current store owner can grant or revoke access.
Every requested action must already exist for the selected operator/reviewer
role and appear in the narrower delegation allowlist. Authority management,
owner status, account or secret administration and budget configuration are
excluded. Existing unrelated memberships cannot be adopted as agency members.

Grant renewal revokes all prior sessions for that actor in this store. The
existing server-local `issueSession` and `authenticate` operations establish a
new store session. This facade never authenticates an agency ID or returns a
global session. Identical actor names in two stores confer no shared authority.

`revoke(ownerScope, {agency_id, actor_id, expected_revision})` clears canonical
permissions, deactivates the store membership and revokes its sessions. All
existing kernel services observe this immediately. The original SupportDelivery
queue retains its owner's session hash and reconstructs/rechecks that principal
at final send. An authorized dispatcher cannot deliver a revoked agency owner's
queued message. The tests exercise that actual path and confirm zero native
message effects, plus denied execution under the old agency scope. Separately
approved operations owned by another authorized principal retain their original
rules; no blanket cancellation or effect reversal is claimed.

## Shared presentation templates

`SharedTemplates.publish(scope, {template_id, expected_version, values})` accepts
only `{tone, locale}` with the existing profile enums. It stores an immutable
manifest and returns `{publication, manifest}`. `publication` identifies the
publishing tenant/store, template ID, version and digest. Publication changes no
active profile. A digest identifies content; it does not grant permission.

`offer(destinationScope, {offer_id, publication, profile_id,
expected_profile_revision})` captures the current local profile and proposer
permission revision. `accept(ownerScope, {offer_id, expected_digest,
expected_profile_revision})` requires fresh owner and proposer authority and an
unchanged local profile before calling the original Profiles.put. `reject`
takes `{offer_id, expected_digest}` and activates nothing. Template input cannot
change policy, skill, action, data scope, secret, source or budget fields.

`rollback(ownerScope, {offer_id, expected_digest, expected_profile_revision})`
requires that the accepted configuration still be current. It writes a new
increasing profile revision with the previous tone/locale. A later unrelated
profile change prevents rollback from overwriting that work. Every decision
retains its before/after profile pins. Another store can reject or advance
independently. Original cases retain their captured profile/policy/skill pins
and approval semantics. New cases use the newly activated profile. Existing
task revalidation and explicit case migration behavior remain unchanged.

## Aggregate reports

`AgencyReports.report(agency_id, [{scope, cohort_id}])` accepts at most twenty
explicit store selections. Each existing scope must match current membership,
canonical permissions and the agency delegation. Unauthorized selections are
excluded without returning hidden store identifiers. Duplicate permitted stores
are rejected, including different cohorts that could double-count a store.

The report calls SupportMetrics for each permitted store. A fixed projection
includes counts, cohort denominators, unavailable/pending counts and repeat
contact follow-up maturity. Rates use summed numerators and denominators. A
missing follow-up denominator remains missing. Original customer confirmation
and ticket-closure meanings remain distinct. Customer/case/resource identifiers,
credentials, financial observations and operating cost rows never enter this
aggregate projection. No aggregate is persisted or cached; every refresh checks
current authority. `drilldown(scope, agency_id, cohort_id)` additionally requires
store-wide case, support and resource read rights, then uses the existing report.

## Storage, erasure and recovery

Migration 045 adds four scoped tables: commerce_agency_grants,
commerce_shared_templates, commerce_template_offers and commerce_template_decisions.
They hold merchant administration and presentation only, with no customer facts.
Grant resource filters are administrative references; subject erasure removes
matching references rather than exporting a merchant grant to a customer.

`exportAgencySubject` returns empty arrays for these four tables.
`eraseAgencySubject` reapplies field-specific nested allowlists even for repeated
hash-only erasure. Unknown fields and malformed primitive values in enum,
identifier, digest, time, action and profile slots are minimized. Malformed
affected grants lose their canonical authority; affected offers/decisions are
revoked and malformed template manifests become inert. Valid unrelated merchant
history is preserved.

`revokeAgencyForRestore(kernel, tenant?, store?)` requires both scope coordinates
or neither. Import, restore and uninstall must call it even without tombstones.
It sanitizes all four tables, revokes grants/offers/decisions and old agency
sessions, and leaves valid published presentation manifests inert with respect
to execution. It creates no member, session or permission; absent imported
members are handled normally. An unrelated owner is never demoted. Previously
activated presentation and original case/approval pins remain unchanged. Explicit
new owner delegation and new template choices are needed for new activity.

## Evidence and limits

The twelve native cases and independent known-answer fixture were committed
before implementation in `2cf57ce`. They include the original nine local
obligations, PORT-032, the later TEST-002 path, stale canonical-authority guards,
and three named isolated faults inside existing cases. One fault copies store A's
role/actions into store B's canonical membership, another makes real publication
write both store profiles, and the third reuses a real aggregate after
revocation. The additional authority fault was committed in `42245af` before
implementation. Their behavioral oracles must actually fail during root's run.
There is no nested native runner and no author execution or preclaimed pass.

Root owns the coherent bounded native run, canonical privacy integration,
independent reviews and local integration decision. The existing 60-case,
four-file, single-60-second development ceiling remains. Browser, full-regression,
external contributor, supplier, production and human qualification evidence is
not inferred from these local APIs or fixtures.
