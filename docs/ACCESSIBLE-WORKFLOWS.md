# Accessible customer and operator workflows

The current diagnostic service presents six critical workflows with native HTML
controls: `/status`, `/returns`, `/order-edits`, `/execution`, `/support` and
`/exceptions`. Their shared accessibility helper makes no API call, reads no
credential or browser storage, and cannot approve or execute an operation.

## Implemented behavior

Each page has a named main landmark, one main heading, a keyboard skip link and
an English document language. Inputs retain explicit or wrapping labels. Inline
validation identifies the affected field, associates the error with
`aria-describedby`, marks it invalid and moves focus to the first invalid field.
The error remains until that field is edited or the session is cleared. Existing
descriptions are retained. Server errors use an assertive announcement and a
focusable summary associated with the submitted form. Successful status updates
use polite announcements.

| Workflow | Focus and confirmation behavior |
| --- | --- |
| Order status | A successful read focuses the order heading; source timestamps and original currency values remain visible. |
| Return request | Loading focuses item selection; the estimate focuses its heading; submission retains the explicit consent checkbox and focuses the saved request status. |
| Order edit | Open and preview focus their headings; a separate reviewer still approves the exact server preview. Results and errors focus the status summary. |
| Execution preview | Preview focuses its heading, approval focuses the newly enabled execution button, and execution focuses the result announcement. |
| Support handoff | Ownership and refreshed case status are announced and focus the summary after the server decision. |
| Recovery exceptions | Each action references its exception heading. Reconciliation focuses the summary when its old card is removed; unknown work retains disabled retry. |

Signing out clears inline errors and returns focus to the session input. Client
generation checks, stale-response suppression, confirmation steps, API payloads,
server permissions and receipt semantics remain unchanged. The shared styles
provide visible focus, usable touch controls, wrapping content at narrow widths,
and reduced-motion preferences. No modal or custom keyboard trap is introduced.

## Focused automated observation

`tests/development/accessibility-workflows.test.mts` has eight native cases. The
new browser fixture exercises Chromium with keyboard events and an explicit
loopback bridge to the actual diagnostic API. It does not navigate to a public
site. Outbound browser requests and WebSockets are denied. Six cases traverse the
status, return, edit, approval, handoff and recovery paths; one checks validation
and page semantics across all six screens; one deliberately removes the final
approval's accessible name and keyboard reachability and requires both faults to
be detected. Native records also check a single synthetic execution/return and
no repeated recovery effect where applicable.

Select this file explicitly when editing these workflows:

```sh
python3 tools/dev_tests.py --files tests/development/accessibility-workflows.test.mts
```

The host needs Python Playwright and Chromium. `RIFARE_TEST_PYTHON` selects an
already installed Python runtime and `RIFARE_TEST_BROWSER` selects an already
installed Chromium executable. No dependency installation occurs in the test.
The batch's four-file focused run includes this one file; it does not launch the
existing browser campaign. Exact browser/runtime versions, observed call stages,
native IDs and source pins accompany the checkpoint's evidence.

## Remaining qualification

Automated DOM, focus and keyboard observations do not establish a human
screen-reader experience, a comprehensive accessibility standard audit, real
touch-device use or the planned React/PostgreSQL stack. A nonauthor human must
still exercise these six journeys with the declared screen-reader/browser/device
matrix, including error recovery, amounts, live-region verbosity, navigation and
zoom. Record actual tool versions, barriers and successful completion separately;
do not infer this observation from a source-authored pass report.

Formal M07-G15 acceptance and the original prerequisite gates remain open. This
development implementation does not extend commerce permissions or enable live
financial, fulfillment or customer-message effects.
