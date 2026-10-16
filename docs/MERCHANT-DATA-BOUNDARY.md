# Merchant material and source-distribution boundary

The public source candidate must not contain customer identities, order details,
conversations, attachments, merchant settings, keys, tokens, partner contracts,
database backups or operational evidence. These remain under merchant control and
separate access/retention rules. The proposed source license is not permission to
publish any of those inputs.

## Safe examples versus private instances

The current `.env.example`, configuration schema, evaluation example, platform
examples and three merchant profiles are synthetic design fixtures. Their exact
bytes and paths are pinned in `planning/licensing-policy.json`. Changing one, adding
another, or moving a profile into a different component requires review. A directory
called examples, an `is_synthetic` flag or redacting one customer name does not prove
privacy. Examples are not real merchant accounts or qualified deployments.

Actual tenant profiles belong outside source control, preferably in the later
approved configuration store. Local private directories and credentials are ignored
as a convenience, not a security boundary. A force-added ignored file still appears
in the source inventory and fails. A staged package is walked independently of Git
ignore rules and rejects unexpected files and prohibited directories. Use separate
private artifacts for authorized evidence; never hide them inside a source archive.

## Necessary human review

Check values as well as paths: copied prompts, emails, logs, unique IDs, warehouse
addresses, secrets in URLs, encoded payloads and document metadata can expose private
information under ordinary filenames. The helper catches known paths, undeclared
members, changed pinned fixtures, links and content substitutions; it is not a
universal secret/PII detector and cannot determine whether arbitrary text is private.

Before publication, inspect every included Git ref and reachable historical blob,
reflogs/attachments as relevant, releases, packages and external evidence stores.
Removing a current file does not remove its history. Rotate exposed credentials and
coordinate any authorized history rewrite without destroying other workers' source.
This checkpoint performs no account operation or history rewrite.

## Code and data are separate review questions

Keep confidential settings and data separate from public templates. Do not claim
that calling executable business logic a merchant profile or plugin exempts it from
license obligations. Review whether an extension is a separate work, contains copied
code or forms a covered combined work. Meet any corresponding-source duties without
publishing credentials or customer data; unresolved boundaries block publication.

Read [the licensing proposal](LICENSING.md) and [distribution review](DISTRIBUTION-REVIEW.md).
