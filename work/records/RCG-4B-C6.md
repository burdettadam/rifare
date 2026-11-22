# RCG-4B-C6 — Public managed-machine command and request handoff

State: assigned; no implementation, test execution, independent review or publication claim yet.
Base: `c88799bdd0d3b9211be7f8dbf1d04cb7104de1c0`.
Branch: `feat/rcg4b-public-caller`.
Assignment: [ADR-0080](../../docs/decisions/0080-public-managed-machine-caller.md).

## Objective

Add a distinct Rifare client for the optional public managed-machine profile found in provider draft PR1994 at
`3c05227fe0a2da1216c8d4306a9e2ca0f9ea432a`. The first bounded integration covers original-bound START/recovery and challenge-bound retrieval of the exact signed authorization-request artifact. The artifact remains explicitly unverified.

## Source facts inspected

- Public command: `POST /v1/organizations/{organization}/delegated-use-commands`.
- Challenge request: `GET /v1/flows/instances/{challenge}/request`.
- A CHALLENGE response carries exactly one Link with relation `urn:marty:delegated-use:request`; it must bind to the same configured HTTPS origin and exact challenge path.
- The request media type is `application/oauth-authz-req+jwt`.
- Both routes are selected only by the optional default-off managed-machine profile on the provider's mandatory mTLS listener.
- The upstream Rust client expressly labels fetched request bytes unverified and requires caller-side independent signature/context verification before proof submission.

The C5 internal route and its source remain unchanged. No provider tests or deployed endpoints were accessed.

## Work sequence

1. Freeze exact provider source pins and implement the separate public transport adapter.
2. Write local real-mTLS peer tests before/alongside implementation; independently author Link parsing, request artifact and native lifecycle assertions.
3. Compose the public transport with the existing concrete native sender/journal, preserving atomic admission and recovery-only semantics.
4. Run new tests and unchanged C5/C1/C2/C3 regressions in bounded whole-file invocations.
5. Run actual negative mutations for Link origin/challenge binding and duplicate Link acceptance.
6. Complete independent authority/security and regression reviews, update controls/catalog/docs, then publish the feature branch with exact execution/equivalence evidence.

## Evidence ledger

| Item | Status |
| --- | --- |
| Provider source inspection | Complete; source-only |
| Assignment/ADR | Complete |
| Implementation | Not started |
| Local TLS tests | Not run |
| Native integration tests | Not run |
| C5 regression | Not run |
| Fault injections | Not run |
| Independent reviews | Not run |
| Publication of implementation | Not done |

No claim of functional support, provider qualification or formal acceptance is made by this assignment record.
