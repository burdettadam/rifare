# Rifare commerce foundation — first five product goals

## Current scope

M01-G01 through M01-G05 provide a working, local SQLite diagnostic implementation
of scoped resources, customer proofs, encrypted references, read capabilities and
a synthetic store. The source is intended for integration under ADR-0012. This is
not a waiver of the existing PostgreSQL/React or connected-provider qualification.
No model, agent runtime, external commerce account or paid service is required.

| Goal | Server module | Permanent native tests |
|---|---|---|
| M01-G01 | `packages/commerce/kernel.mts` | Resources, HTTP isolation and absolute-form URL review |
| M01-G02 | `packages/commerce/customer-access.mts` | Ownership, expiry, attempts, replay and issuance-bound review |
| M01-G03 | `packages/commerce/secrets.mts` | Encryption, handles, metadata binding, revocation, key files and rotation |
| M01-G04 | `packages/commerce/capabilities.mts` | Current scopes, context, evidence and disabled writes |
| M01-G05 | `packages/commerce/simulator.mts` | Deterministic facts, lost responses, reset/replay and real worktree servers |

The actual registry binds individual IDs to native files. The original planning
snapshot stays unchanged. These are diagnostic implementations of the fifteen
assigned scenario groups and TEST-002/TEST-033, not passing claims for all 676
planning specifications or full goal acceptance with unmet prerequisites.

## Run

Use the documented Node 22.16.0 diagnostic host, npm, Git and Python. Browser
harness checks additionally require the existing Playwright/Chromium host setup.
Dependencies and the zero-package npm lockfile are unchanged.

```sh
npm ci --offline --ignore-scripts
python3 tools/verify.py --runtime --harness
node --experimental-strip-types tools/dev-commerce.mts
```

The command prints its loopback URL and a private run-file path, not tokens. Open
the private run file locally and use the apparel or fragile operator bearer in
the page's session field. The file is mode 0600 and is ignored by Git. The page
loads orders or capability JSON through the same services used by the HTTP tests.
It stores no session in localStorage and renders response values as text.

Ctrl-C revokes this process's operator sessions, closes its server and removes
its owned run record. Starting again preserves fixture data and issues fresh
operator sessions. A second active command in the same worktree is refused; after
a crash, confirm the recorded process is absent before removing a stale owned
run record. Never kill an unknown process or reuse another worktree's database.

The command can optionally use a wrapping-key file:

```sh
node --experimental-strip-types tools/dev-commerce.mts --wrapping-key /secure/external/location/wrapping.bin --key-id local-wrap-v1
```

The key is exactly 32 random binary bytes in a private owned file outside the
checkout, supplied by the operator. It is not generated into the repository,
embedded in code, returned to the browser, or included in project archives.
Without it, ordinary synthetic reads work but vault HTTP operations fail closed.
The public diagnostic surface cannot save or resolve raw credentials; trusted
server provisioning uses `SecretVault.put`, while probes return only a boolean.
A lost wrapping key makes its records unavailable: keep separately protected
backups and rotate deliberately. No hosted KMS has been integrated.

## Diagnostic HTTP surface

| Route | Behavior |
|---|---|
| `GET /health` | Identifies the unqualified diagnostic profile. |
| `GET /v1/capabilities` | Authenticated, current per-store read/limitation descriptions. |
| `GET /v1/resources?kind=order` | Scoped operator/worker list with current capabilities. |
| `GET /v1/resources/{id}` | Scoped resource read; customers are restricted to their proved order. |
| `GET /v1/lookup?kind=order&external_id=ORD-1001` | Authenticated synthetic lookup; no arbitrary source or endpoint. |
| `POST /v1/customer/challenges` | Generic request result; proof goes to the server's local development outbox. |
| `POST /v1/customer/verify` | Single-use proof exchange for a limited session. |
| `POST /v1/session/logout` | Server-side session revocation. |
| `GET /v1/secrets` | Own-store opaque handles, never stored values. |
| `POST /v1/secrets/probe` | Installed local adapter probe, never general secret resolution. |
| `POST /v1/actions` | Reads through the same capability boundary; commerce writes denied. |

The challenge body is `{store_id, order_number, email}`. Verification is
`{store_id, challenge_id, proof}`. A delivery proof is deliberately not in the
request response. The local outbox is a private fixture facility, not an API or
mailbox. Sensitive sessions/proofs do not appear in application logs. Production
TLS, authentication providers, message delivery, distributed rate limits,
retention cleanup and timing analysis remain necessary future qualifications.

## Execution boundaries

Authenticated contexts are nonserializable and store-scoped. Every access checks
current session expiry, revocation, membership and store status. Direct SQL,
provisioning, key loading and adapter installation are trusted server operations;
an arbitrary native plugin holding those privileges is not sandboxed by a skill.

AES-256-GCM records use fresh per-record data keys, separately wrapped data keys,
random nonces, full tags and authenticated tenant/store/ref/provider/adapter
metadata. The wrapping key is never stored beside ciphertext. Mutable buffers
owned by the vault are cleared after use; JavaScript strings, host memory and
trusted adapter copies are not claimed to be securely erased.

Capability descriptions are not authorization receipts. Read execution recomputes
the store's grants, market, current contract and resource state. All real-platform
connections remain unverified. Local `native` status is explicitly bound to the
synthetic contract and never indicates production qualification. Simulator reset
and state changes are local fixture controls, absent from the HTTP route table.

The local environment is not an operating-system egress sandbox. Untrusted
agents never receive the database, wrapping key, installed adapter registry or
local provisioning methods. Real transport/MCP and agent integration remain in
their assigned goals; provider independence here is a lack of provider-owned state,
not a claim that two production agents have already been qualified.

## Retention and repair

Keep generated TAP, controller results, mutation patches and receipts outside Git.
The distributed source archive contains no runtime database, bearer, proof outbox,
wrapping key or node_modules. Restore the Git bundle, rerun the full checks and
create fresh runtime state. Use database backups for schema rollback; never hide a
changed migration checksum or delete migration history to force startup.

The next target-stack repair must retain these domain contracts and all tests.
A PostgreSQL repository adapter and React application still require real target
execution. M01-G06's native Shopify adapter must not silently label the simulator
as a real integration.

## References used in the implementation review

- [Node crypto API](https://nodejs.org/docs/latest-v22.x/api/crypto.html)
- [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP single-use token guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
- [OWASP cryptographic storage](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)

These sources guide design; they do not certify this application or replace
independent production security review.
