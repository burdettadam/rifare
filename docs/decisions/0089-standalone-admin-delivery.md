# ADR-0089 - Standalone native Admin delivery

Status: assigned; implementation and qualification pending.
Base: `5aa050e9ccdf8b8156c2e0455605ef4011a5d633` (Rifare PR9).
Branch: `feat/medusa-standalone-admin`; root is sole writer and integration owner.

## Assignment COMMERCE-ENGINE-02

Complete the next ready part of the selected Medusa migration: deliver and qualify
upstream Admin from a relocated compiled backend with its own locked production
dependencies. The earlier standalone checkpoint explicitly excluded full Admin/browser
delivery. Do not replace upstream Admin or create a second operator commerce UI.

Build Admin enabled using the pinned Medusa 2.23.0 toolchain. Preserve actual static
assets and supported deep-link routing in the standalone output; do not rely on
repository source, its dependency directory, a development Vite server or fixture
fallback. Reuse compatible source caches before allocating another runtime. Record
all generated output, owner and retirement event; check Windows host space first.

Qualify actual anonymous/login/logout and a native operator catalog journey in a
fresh isolated browser against disposable PostgreSQL. Use only synthetic development
operator/customer identities and local System payment fixtures. Inspect rendered
screens and native effects, not only HTML status or generated files. Browser reload
and a deep link must still load the same packaged Admin. Wrong/absent authentication
must not supply Admin data. Preserve customer/operator separation and server commerce
holds. Any tested catalog writes stay within task-owned synthetic data; no orders,
protected checkout, connected provider, external identity deployment or paid effect.

Keep the local profile's production refusal and existing Enterprise/cloud exclusion.
No generic OIDC implementation, new Supabase architecture, managed-machine enrollment,
release artifact/tag or distribution-rights acceptance belongs to this assignment.
The provider worker owns those deployment/custody boundaries. Latest provider main
`a18d9f0b19a9225ce5c1466187c126eacdc2c42c` was inspected read-only; selected delegated-use,
Auth and caller paths are unchanged from the earlier Rifare provider pin. The
published provider deployment record still leaves external HTTPS qualification open.

Use focused behavior checks while developing. Bind final browser, native HTTP,
compiled/dependency inputs and a meaningful static-delivery fault to the fixed
candidate. Run affected retained backend/configuration/intake and public commerce-hold
checks without weakening their assertions. Both independent authority and regression
roles review the actual fixed candidate and evidence before normal authorized merge.
Hosted Actions remain skipped under the owner's cost instruction. Retire owned
runtime/browser/database/generated output after qualification/review/integration while
preserving source, configuration, refs, screenshots, logs and qualification evidence.

This completes only local standalone Admin/browser evidence. Full connected identity,
commerce authority, legacy data porting, receiving-operator transfer and production
acceptance retain their existing requirements.
