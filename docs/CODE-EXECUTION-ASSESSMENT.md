# Code execution need assessment and current deferral

Code execution remains disabled. M12-G08 requires an explicit human decision;
the current development instruction supplies no such go decision. M12-G09
therefore remains deferred. This slice builds a bounded assessment protocol and
exercises the existing typed gateway's refusal of unknown code tools. It builds
no sandbox, interpreter, package loader or code-execution service.

The implementation is `packages/security/code-execution-decision.mts`, with its
contract in `packages/security/contracts/code-execution-decision.v1.json`.
`codeExecutionStatus()` returns a fresh informational value with `enabled: false`,
`implementation: "absent"`, `human_decision_authenticated: false` and
`sandbox_qualified: false`. `requestCodeExecution()` always refuses before
inspecting its input. A claimed approval, callback, getter or modified status
copy cannot activate it.

## Concrete task comparison

The local native fixture measures two existing typed-service workflows. The
expected outcomes are independently fixed in
`tests/fixtures/ecosystem-assurance/typed-task-oracle.v1.json`.

| Named task | Actual service sequence used by the native fixture | Fixed expected outcome |
| --- | --- | --- |
| `typed_resolution_state` | `ActionGateway.state` | Initial local case plan: no resolution, revision zero, no financial effect. |
| `typed_approved_resolution` | Preview, a distinct synthetic reviewer approves that exact preview, execute, inspect state | Local case-plan refund marker at revision one, approval consumed, no financial effect. |

The first task has one action and the second has four. The native fixture records
actual elapsed time with the monotonic performance clock and a digest of each
returned result. The result projection excludes customer, tenant, order,
preview and approval identifiers. Its one `M12_TYPED_WORKFLOW_MEASUREMENTS` TAP
diagnostic preserves measured task times, action counts and source/oracle/binding
digests in the root's normal native output log. No extra demo or benchmark
invocation is required.

These are two diagnostic case-plan tasks, not a survey of every merchant
workflow or evidence of financial settlement. The source holds their executable
specification; actual observations exist only after the integrated native run.
Their distinct synthetic action approval is not a human decision about code
execution.

The proposed code alternative is explicitly unexecuted. Its execution flag must
be false, and observed results, estimated benefit and latency remain null. The
assessor refuses invented successful code measurements.

| Option prepared for human review | Current basis and resulting recommendation |
| --- | --- |
| Continue with typed actions | When both declared task observations match their fixed oracles, this sample contains no demonstrated unmet need. Recommend retaining typed actions pending the human decision. |
| Extend a typed action for a concrete missing workflow | Preserve as an alternative for a newly specified need, with the normal authority, preview, approval and source-effect checks. No extra action is authorized by this assessment. |
| Add constrained code execution | No implementation or measured benefit exists. Requires a separately approved need and threat decision followed by its own isolation and adversarial qualification. |

Parity-only proposals return `reject_parity_only`. A valid safe proposal for the
measured sample returns `retain_typed_actions_pending_human_decision`. Neither
is a fabricated approved no-go, an approved exclusion, or an implemented code
capability. A different unmet workflow requires its own fixed task/oracle and
reviewed assessment scope.

## Threat and resource proposal

The assessment records the complete proposed trust and resource boundary:

| Boundary | Required proposal for this deferred design | Result when widened |
| --- | --- | --- |
| Input trust | Untrusted facts scoped to the current task | Reject ambient host trust. |
| Credentials | No ambient credentials | Reject credential access. |
| Network | None | Reject allowlisted or unrestricted egress in this unimplemented design. |
| Filesystem and packages | No filesystem or packages | Reject host/isolated filesystem or package requests until a new design is reviewed. |
| Processes | No child processes | Reject process creation. |
| Business actions | Existing typed gateway only | Reject direct adapter access. |
| Proposed resource limits | Positive CPU, wall time, memory and output bounds within the fixed protocol ceilings | Reject zero, excessive or incoherent limits. |

The proposed ceilings are 5,000 ms CPU, 5,000 ms wall time, 128 MiB memory and
64 KiB output. These are inputs to a future design decision. They are **not
enforced sandbox limits**, because no sandbox exists. The fixture proposes
stricter CPU, wall-time and memory values. Any unsafe boundary produces
`reject_unsafe_design` while execution remains disabled.

`assessCodeExecutionNeed(packet, context)` verifies the separately supplied
protocol/oracle hashes, exact task denominator, current allowlisted source
bytes, observation identity/order, allowed action sequences, fixed outcomes and
finite nonnegative measured times. Observations must be no more than one day
old and cannot be future-dated. Missing, duplicate, changed-source or mismatched
observations fail without a favorable assessment.

The assessment binding covers the protocol, oracle, source pins, observations
and full proposal. Changed task evidence, source, threats or limits produce a
different binding; a supplied previous binding then adds
`DECISION_BINDING_CHANGED`. Every assessment still requires human review. A
decision reference is only a reference, never authentication or approval.

The assessor is a reader of caller-owned measurements. It reports
`observation_authenticity: "caller_owned_unverified"` and does not authenticate
outside observations by comparing their hashes. The actual native test calls
provide the bounded local execution evidence, separately retained by root.

## Existing execution authority

The deferred-boundary native case obtains a real scoped `ActionMcp` grant and
initializes it normally. Calls named `execute_code`, `eval`, `run_shell` and
`adapter_write` receive the existing unavailable-tool error. A `code.execute`
proposal also fails in `ActionGateway`. The test checks that the original case
state and source effect/receipt counts remain unchanged.

This proves those actual typed interfaces do not expose arbitrary execution.
It does not prove process, filesystem, network, memory or escape isolation.
There is no adversarial sandbox corpus or runtime-upgrade campaign in this
development scope. Original `CASE-M12-G09-01` through `CASE-M12-G09-03` remain
unperformed, as do the original human-decision G08 cases.

## Evidence, storage and future decision

The assurance file contains four distinct M12-G08 PREP cases and two G09
deferred checks, alongside the three G07 PREP cases. The nine-case specification
and independent expectations were committed before implementation. Authors
and reviewers run zero product tests; root supplies coherent native results and
independent review within the reduced development profile.

No new database tables, merchant state, permissions, secrets, caches or external
effects are introduced. The assessor retains no caller packet. Restoring a
report or modifying its status cannot recreate code authority.

M07-G99, the actual authorized human G08 decision and formal qualification
remain open. A future explicit go would authorize only its concrete design
scope; G09 implementation, isolation tests, independent security review and
current typed authority would still be required before enabling any runtime.
