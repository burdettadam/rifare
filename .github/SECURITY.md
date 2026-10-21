# Rifare security handling

No production service or public reporting endpoint exists at this checkpoint. Report sensitive findings privately to the actual project owner through an established channel; do not invent an email address or publish secrets in an issue.

Use synthetic fixtures and no real credentials for starter checks. Before accepting production-facing work, follow the assigned authority, privacy, evidence and operational qualification goals. Instructions and examples grant no external-system permission.

Include the affected Rifare commit or artifact digest, the affected boundary,
reproduction steps using synthetic data, expected and observed behavior, and a
sanitized assessment of impact. Keep credentials, private merchant profiles,
customer records and complete database dumps out of public issues and Git. If a
secret was exposed, the actual authorized owner must handle revocation through
the established account process; an audit report cannot revoke it.

The recipient should retain the report privately, identify an authorized owner,
triage its severity and affected source/artifacts, and track a corrective change
with source-bound reproduction and independent closure. A critical/high release
finding blocks release until that closure is independently established. No response
time, public disclosure schedule, bounty, maintained production version or contact
address is established by this development checkpoint. Coordinate disclosure with
the actual owner through the private channel already in use.

Read [release security and provenance](../docs/RELEASE-SECURITY.md) for the executable
offline source/artifact audit, its machine-readable SBOM, scan-evidence format and
threat boundaries. Local inventory or pattern-check success does not establish
current vulnerability clearance, license rights or authorization to publish.
