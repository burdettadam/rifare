# Licensing Rifare

Rifare applies the component terms selected in ADR-0004 under the owner's
[publication-readiness approval](decisions/0066-publication-readiness.md).
The complete grant, path exceptions, and attribution notice are in
[LICENSES/README.md](../LICENSES/README.md); the root [LICENSE](../LICENSE)
contains the complete AGPL version 3 text.

## Applied scope

| Surface | Terms |
| --- | --- |
| Application and in-process business implementation, including migrations | AGPL-3.0-only |
| Separable clients and protocol schemas | Apache-2.0 |
| Public workflow skills, synthetic templates, and examples | Apache-2.0 |
| Original development helpers, tests, documentation, and original brand/demo media | Apache-2.0, only to the extent of the licensors' rights |
| Identified upstream instruction text | Retained MIT terms; original Rifare modifications are Apache-2.0 |

The [machine-readable application record](../LICENSES/application.json) lists
the exact exceptions to the default application license. It does not declare
unknown third-party material first-party. Existing upstream notices retain their
own copyright owners and terms. The license documents and DCO text retain their
authors' stated copying permissions.

Application code copied into a separately named SDK does not acquire a permissive
license through its directory name. Preserve the license of copied material and
review its integration. Merchant data, credentials, private configuration, and
provider logs are excluded from source distribution; a source license is not
permission to redistribute them. No commercial relicensing rights or copyright
assignment are assumed.

## Contributions

Original contributions use the license already applicable to the affected file.
The project adopts [DCO 1.1](../.github/DCO.txt), with the contributor personally
certifying the provenance of the submitted work. Contributors retain their
rights. Sign off only your own submission after checking that you can make the
certification, including for AI-assisted or employer-owned work. Do not sign for
another person, fabricate a human signoff, or amend old commits to suggest a
certification that did not occur. See [Contributing](../.github/CONTRIBUTING.md).

## History and verification

`planning/licensing-policy.json`, the pending component dispositions in
`planning/component-inventory.json`, and `tests/fixtures/licensing/` retain the
original M00 proposal and regression contract. Their fields protect historical
notice/privacy obligations; they are not the current source-license decision.
The current application record deliberately sits beside these preserved inputs.

```sh
python3 tools/check_distribution.py --root . --licenses
python3 tools/check_distribution.py --root .
```

The first command checks installed texts, scope, attribution, and the recorded
authority reference. The second also checks exact source membership, preserved
notices, synthetic inputs, and reviewed development dependencies. Neither
authenticates an owner's identity, proves all external rights, grants a license,
or authorizes a product release. The grant is in the license notice and the
owner's actual instruction. [Distribution review](DISTRIBUTION-REVIEW.md)
explains the remaining artifact and release boundaries.

## License sources

- [GNU AGPL version 3](https://www.gnu.org/licenses/agpl-3.0.html).
- [Apache License, version 2.0](https://www.apache.org/licenses/LICENSE-2.0.txt).
- [Developer Certificate of Origin 1.1](https://developercertificate.org/).
- Verbatim AGPL and Apache text copies are pinned to the SPDX license-list-data
  revision recorded in [the application record](../LICENSES/application.json).

Source-code licensing and operating a hosted commerce service are separate
questions. Required corresponding-source, attribution, privacy, integration,
and release duties depend on the actual artifact and deployment. This document
does not claim a legal opinion or production qualification.
