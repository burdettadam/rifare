# Five-goal commerce implementation review

## Scope and decision

The owner assigned five further goals and had delegated local review and merging.
ADR-0012 is the prior authority checkpoint for M01-G01 through M01-G05. The
maintainer approves their tested SQLite diagnostic implementation for local
integration, while retaining target-stack and external-qualification gaps. This
is the same assistant's maintainer review, not independent reviewer sessions.
No production access, platform certification, release or publication is approved.

The reviewed code candidate is `46987fb`. Later integration records and exported
controller results identify the final complete source commit. The original M00
acceptance ledger and all goal contracts are unchanged. Implemented and merged
code is not automatically a full accepted milestone.

## Findings fixed before integration

1. **Rate-table growth after client throttling.** Requests from an already
   throttled client still inserted distinct target-rate buckets. The regression
   submitted 60 distinct targets; it observed 61 rate rows instead of the required
   21. Issuance now checks the client limit before creating any target bucket.
   `M01-G02-REVIEW-01` captures the original assertion failure and repaired result.
2. **Absolute-form URL authority.** An authenticated loopback request with an
   absolute URL naming another authority passed Host validation. The new test
   observed HTTP 200 rather than 403. The server now validates the parsed URL's
   origin as well as Host/Origin headers. `M01-G01-REVIEW-01` reproduces and guards it.

Additional review checked foreign-tenant reads, stale scopes, role boundaries,
challenge ownership/attempts/consumption, ciphertext metadata binding, key-file
handling, error/log output, capability revalidation, local replay validation,
receipt persistence, simulator resets and shutdown ownership. Arbitrary trusted
native adapter code and direct database administration remain outside the security
boundary; no model prompt or client-provided scope acquires those privileges.

## Executed evidence

The candidate passed **683 tests with no failures or skips**: all 582 previously
registered checks plus 101 new checks. Breakdown: 502 Python, 153 runtime, 15 unit
harness, 7 database harness and 6 retained browser-component cases. The six
browser-component tests are not claims about the new page or a React application.

New checks by goal: G01 21, G02 21, G03 21, G04 18 and G05 20. They include actual
HTTP requests and a fresh, offline-installed pair of linked-worktree servers.
The latter verified distinct data, stopping one without interrupting the other,
persistence after restart and revocation of the prior operator token.

Five independent temporary mutations were caught through behavioral assertions:
removing resource tenant filters, permitting consumed proof replay, dropping
ciphertext metadata binding, ignoring scope revocation, and turning an accepted
lost response into a pre-acceptance failure. Raw native reports and exact mutation
patches are in the separate evidence package. The two real review defects also
have red/green native evidence. No missing-import or syntax failure counts as proof.

All original executable tests remain byte-identical. Existing source paths,
requirements, benchmark thresholds, merchant examples, commands, lockfile and
controllers remain. Additions extend the registry; only the declared inventory
membership and permitted source-file count change among existing fixtures.
Current-state README/plan text is updated, not used to weaken a behavioral contract.

## Qualification still required

PostgreSQL/React implementation, live identity/provider delivery, actual platform
reads, served-browser interaction, distributed rate limits, host isolation,
independent production security review and applicable release controls remain.
Secrets were synthetic and all fixture payment states are explicitly simulated.
No outbound commerce request, real message, model call or payment was made.

The separately pinned controller comes from the previously reviewed main. It
must still accept the additive registration and all retained obligations against
the integrated candidate. Final source hashes and restoration results belong to
the external verification report, not a self-referential source-file hash.
