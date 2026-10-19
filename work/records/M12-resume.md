# M12 continuation after handoff recovery

The owner requested: "Proceed processing goals until next milestone."
The supplied M10 archive was followed by the recovered completed M11 checkpoint
at `e36dbcd7cf392d04f21d082e834698bbc6a1ac79` and the unfinished M12 source at
`08a9884a09e4caf2941c72919b355f3b28a86e5a`. Both are retained in native history.
This continuation completes the existing ADR-0041 local assignment through its
M12 assessment. It does not replace the earlier work or assign a later milestone.

## Ownership and remaining work

- Integration owner and writer: current root, branch `goal/M12-resume` in an
  isolated restored repository. The original worktrees are read-only sources.
- Protected milestone base: `e36dbcd7cf392d04f21d082e834698bbc6a1ac79`.
- Current authority/security review: current `/root/m11_scope`, a nonauthor.
- Current regression review: current `/root/m12_regression`, a nonauthor.
- Privacy correction author: current `/root/m12_privacy_fix`, isolated branch
  `fix/M12-privacy`; owns `packages/commerce/ecosystem-storage.mts` and the
  associated extension/agency recovery helpers only after confirming actual
  source paths with the integration owner. Any test change needs a concrete
  independent-oracle explanation and regression review.
- Root owns shared metadata, documentation, native test execution, preservation
  records, exact-candidate reviews, local integration and cumulative packaging.

## Retained evidence and focused verification

The recovered `evidence/recovered-m12/` tree preserves both interrupted-run
reports and prior reviews with their original source and environment paths.
At the recovered source, the 12 agency, 14 extension and nine assurance cases
passed. Three of the nine retained privacy cases failed on retirement-record
minimization and approval revocation. Those failures are the behavioral red
evidence for this correction, not a passing milestone result.

The existing 60-case/four-whole-file/60-second limits remain unchanged. Run the
affected privacy file after the correction and repeat other files only for
consequential changes identified in review. Every carried pass retains its
actual executed candidate and requires both reviewers to assess the exact delta.
No broad regression, connected-provider or formal milestone campaign is implied.

Fresh independent reviews must resolve the actual candidate's findings before
root records a local nonrelease integration. Original goal acceptance remains
blocked as documented in `docs/M12-QUALIFICATION.md`; code mode stays disabled,
and contributor/human/external observations are not fabricated.
