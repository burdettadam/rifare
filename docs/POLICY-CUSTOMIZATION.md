# Rifare — Policy and skill customization

M02-G03 through M02-G07 add structured policy versions, versioned commerce manifests,
layered settings, a no-model draft editor and restricted instruction installation.
These are SQLite diagnostic implementations, not a PostgreSQL/React release.
Source references are supplied metadata, not a claim that a remote policy was fetched.
There is no required model/provider and no new npm dependency.

## Run

```sh
npm ci --offline --ignore-scripts
python3 tools/verify.py --runtime --harness
node --experimental-strip-types tools/dev-commerce.mts
```

Open `/configuration` on the printed loopback address. Use the operator session from
the private local session file. The editor does not put sessions in browser storage.
Open/start a draft, change the return window, evidence requirement, tone or locale,
save, inspect the structured diff/provenance, run named boundary scenarios, and
request publication review. Restore the starting settings to exercise undo. Requesting
review stores a request only: it does not publish policy or change the live read profile.

```sh
node --experimental-strip-types tools/demo-customization.mts
```

This demonstration creates synthetic actors and policies in an in-memory database,
shows a rejected out-of-window return, draft diff/simulation/undo, and an explicitly
approved instruction bundle. It makes no network request and does not issue money.
Synthetic reviewer actors do not establish independent project review.

## Structured policy authority — M02-G03

`packages/commerce/policies.mts` persists immutable structured version bodies and
explicit draft, tested, reviewed, published and revoked states. Testing runs named
boundary fixtures on the server. A different actor with current review permission
must review the tested digest; publication separately requires `policy.publish`, an
owner-only action. A prose draft, customer or agent cannot publish itself.

Publication compares the expected previously published version, rejects duplicate
or non-monotonic activation times, and rechecks the reviewer's current permissions.
Future scheduled versions are not current early. Stored source hashes protect body
integrity; they are not cryptographic signatures authenticating external sources.

A request pin stores fixed diagnostic facts and either `pin_at_request` or
`current_at_quote`. The former retains that published version, the latter selects
the current published version at evaluation. Revoked pins and a revoked current
policy block evaluation; an older version is not silently selected as fallback.
Pins are bound to the actor and store. These are rule evaluations only: later return
handlers must obtain facts from authoritative orders and approvals before executing
business actions. An eligibility result never grants financial authority.

Authenticated HTTP routes include `POST /v1/policies/draft`, `/test`, `/review`,
`/publish`, `/revoke`, `/pin`, and `/evaluate`; version reads use
`GET /v1/policies/{policy_id}/{version}`. Unknown fields fail validation. State-change
operations accept exact version/digest or expected-head inputs, never prose approval.

## Manifest contract — M02-G04

The versioned schema is `packages/commerce/contracts/commerce-manifest.v2.schema.json`.
It describes a **Rifare extension**, not the Agent Skills standard. Standard
`SKILL.md` instructions stay separate. The documented loader still supports a narrow
name/description scalar frontmatter subset rather than arbitrary YAML syntax.

The extension declares action names and `[min, max_exclusive)` three-part version
ranges, engine compatibility, input/output/configuration schema resources and their
content hashes. Version comparison is numeric. Required action declarations are
requirements, not grants. Actual requests continue through server authorization.
Field-level validation rejects unknown fields, incompatible action/engine versions,
missing resources, external schema references, declared scripts and egress.

The checked-in Draft 2020-12 JSON Schema is portable documentation. The local
validator intentionally implements only its used keyword subset, not a general
JSON Schema engine. Resource schemas are checked as local object-schema references;
they do not replace the existing typed business-action validators. The current
contract catalog covers the existing read actions only.

`GET /v1/skill-manifest-schema` and `POST /v1/skill-manifest/validate` expose this
read-only contract to authenticated callers. Existing v1 local bundles and the
original order-status workflow remain compatible. New imported v2 bundles require
approval; downgrading a protected ID to a legacy bundle is denied, even after removal.

## Explicit layers — M02-G05

`profile-layers.mts` composes base, platform, industry, merchant, store, segment and
locale layers using a fixed precedence table and typed allowed paths. Equal-priority
writes to the same field are rejected, not resolved by load order. The compiler
validates store/tenant binding and normalizes sets. Reordering input files does not
change the result. No merchant-specific branches exist in core code.

Every effective field has layer, revision, source and digest provenance. Approval
metadata is matched to a separately supplied exact reviewed-layer digest; declarations
inside the layer cannot self-approve. Editor drafts have no approver. Compilation
accepts a trusted server capability inventory; layers can request but cannot supply
capabilities. Unsupported required capabilities make readiness false. Locale layers
cannot change returns or authorization. Money/approval thresholds are not editable.

The `effective_digest` hashes normalized values. The `composition_digest` additionally
binds context/provenance; a later undo restores values but correctly retains its new
revision and history. Neither digest authenticates a person or publishes the result.

## Draft editor and simulator — M02-G06

Server-side editing permits only the documented fields. Hidden form fields, stale
revisions, out-of-range windows and protected capability/authority paths are rejected.
An edit invalidates earlier simulations/requests. A publication request recomputes the
current simulation identity, including connection revision, rather than trusting a
client-supplied success report. The operator/reviewer can read drafts; customer, agent
and worker sessions cannot read this unpublished configuration surface.

Scenarios include the window boundary, one millisecond after it, missing evidence,
and the configured exclusion tags. When no exclusions exist, the exclusion fixture
has an empty tag list and correctly remains eligible. This is not a production
outcome forecast or an evaluation of a model's answer quality.

The initial UI is plain HTML/JavaScript. Keyboard and mobile component checks run in
Chromium using an explicit Python bridge to the actual local HTTP server, not canned
responses (except a deliberately hostile display fixture). They do not establish
actual browser-origin networking, React rendering or complete WCAG conformance.

## Trusted bundles — M02-G07

`skill-installer.mts` accepts a read-only directory snapshot or the bounded
`rifare-instruction-bundle-v1` JSON envelope containing `origin` and `files`.
It optionally accepts gzip-compressed JSON with a 192 KiB input/output cap. **It does
not extract tar or ZIP archives.** Unsupported formats are rejected. Files are stored
as verified text in the scoped database, not unpacked as executable code.

An owner must approve the exact origin, skill ID/version, bundle digest and expiration
before an operator installs. Current approver authority is rechecked. Expiry or
revocation makes the installed bundle unavailable. Every later resource read verifies
the stored bundle and all declared resource hashes. Cached content is not trusted
merely because installation once passed. Approval does not give the bundle shell,
network, provider, secrets, or policy-publication capabilities.

The directory reader rejects traversal, static ancestor/file symlinks, hard links,
nonregular/executable files, unexpected resources, oversized entries and deep trees.
It uses no-follow reads with bounded buffers. This is not a sandbox against a hostile
same-user process continuously renaming ancestors: installation directories and
approval records still require OS-level protection in a real deployment. No origin
is fetched automatically. The legacy `Skills.install` path remains privileged
server-local provisioning for existing v1 built-in material, not an upload endpoint.

## Qualification and sources

Full PostgreSQL/React, live platform/model, actual served-browser and independent
production reviews remain outstanding. Same-assistant delegated review permits local
integration only. No existing milestone acceptance is invented.

Format references checked 2026-10-16:
- Agent Skills specification: https://agentskills.io/specification
- JSON Schema 2020-12 validation: https://json-schema.org/draft/2020-12/json-schema-validation

The code does not treat Agent Skills' experimental `allowed-tools` guidance as a
security grant. Security enforcement belongs to the server and installed policy.
