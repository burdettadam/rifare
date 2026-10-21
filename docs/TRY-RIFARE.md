# Try Rifare

Run a local commerce demonstration, then explore the support and tracking views. These examples use synthetic data and the existing TypeScript/Node.js + SQLite implementation. They do not connect a real store, send a real message, or move money.

## Prepare the checkout

You need Git and a Node.js version allowed by [package.json](../package.json): **24.x**, or **22.16+ within 22.x**, with npm. Python 3.10+ is needed for the separate development checks, not the demos below.

```sh
git clone --branch development https://github.com/burdettadam/rifare.git
cd rifare
node --version
npm ci --offline --ignore-scripts
```

The current root lockfile contains no third-party npm packages. The offline install checks its consistency; it does not install the future React/PostgreSQL application. Node may print an experimental SQLite or type-stripping warning, depending on its version.

Run the examples from the repository root. Each headless example finishes and closes its in-memory databases. The `--serve` examples stay running until you stop them with Ctrl-C.

## See a mixed return resolve

```sh
node --experimental-strip-types tools/demo-return-resolution.mts
```

A synthetic return divides original purchased units between a refund, store credit, and an exchange quotation. The refund source accepts an operation, but the caller loses the response. The demo retries the local dispatch and then uses read-only reconciliation to find the original source result.

| Output | What to look for |
| --- | --- |
| `outcomes` | Separate refund, store-credit, and exchange allocations against original paid units. |
| `refund.after_lost_response` | `unknown`: a failed response does not prove the source did nothing. |
| `refund.after_lookup` | `accepted`: the original operation was found. |
| `refund.send_attempts` | `1`: the second dispatch did not resend the uncertain operation. |
| `refund.after_explicit_fixture_settlement` | A separately observed synthetic settlement, after the fixture is explicitly advanced. |
| `exchange` | A quotation with its limitations; no stock reservation or replacement-order commitment. |
| `external_calls` | `0`. |
| `production_qualified` | `false`. |

Amounts ending in `_minor` use currency minor units. The example's money and source observations are synthetic. Read [return resolution](RETURN-RESOLUTION.md) for the allocation, approval, and recovery contracts.

## Open the support and tracking views

```sh
node --experimental-strip-types tools/demo-support.mts --serve
```

The output contains three useful fields: `url` for the support view, `tracking` for the shipment view, and `session_file` for a private, temporary local JSON file. It prints the file location, not its credentials.

1. Open the exact `url` in your browser.
2. Open the indicated `session_file` in your local editor. Copy its `operator` value into **Session token** and use **Case ID** `support_case`.
3. Select **Open case**. Inspect case ownership, individual shipment states, and conversation history. A partial shipment or incomplete history stays visible as such.
4. To view the shopper-facing shipment page, open the printed `tracking` URL. Use the file's `customer` value and the same `support_case` ID.
5. Use **Sign out** when finished, then press Ctrl-C in the server terminal. The demo closes its in-memory databases and removes its temporary session directory.

The session values authorize this local fixture. Keep them out of screenshots, commits, and shared notes. A new server run creates new sessions.

The support page includes synthetic message queue, dispatch, and reconciliation controls. Its fixture source records those effects locally; it is not a live mail service. Return and order changes retain their separate preview and approval paths. See [support operations](SUPPORT-OPERATIONS.md) for the full scope.

For a headless version of this support scenario:

```sh
node --experimental-strip-types tools/demo-support.mts
```

It shows tracking, a locally approved return, an uncertain message reconciled by original identity, and manual support after model access is stopped.

## Explore two design decisions

### Recover after an uncertain operation

```sh
node --experimental-strip-types tools/demo-reliability.mts
```

This example uses separate in-memory application and synthetic-source databases. It demonstrates duplicate event handling, delayed observations, a lost response after source acceptance, and reconciliation that preserves the original receipt. Read [operation reliability](OPERATION-RELIABILITY.md).

### Change policy with a reviewable draft

```sh
node --experimental-strip-types tools/demo-customization.mts
```

This example publishes a synthetic return policy through separate fixture roles, edits a profile draft, simulates it, requests review, and restores the earlier effective configuration. It also installs a pinned instruction bundle. The output labels the actors as synthetic; they are not real project reviewers. Read [policy customization](POLICY-CUSTOMIZATION.md).

## Inspect the commerce browser shell

For the read-oriented commerce diagnostic:

```sh
node --experimental-strip-types tools/dev-commerce.mts
```

Open `/status` or `/configuration` at the printed loopback `url`. The startup output identifies a private `private_run_file` holding the two synthetic-store operator sessions. Use the appropriate session for the page's authenticated controls; do not commit that file. Draft configuration changes do not publish a policy.

This command has persistent per-worktree SQLite data. It does not automatically install the additional fixture sources or execution configuration used by the dedicated return, support, and order-edit demos. Stop it with Ctrl-C in its owning terminal. See [portable reads](PORTABLE-READ-WORKFLOWS.md) and [policy customization](POLICY-CUSTOMIZATION.md).

## Run the basic process and storage smoke environment

To inspect the smaller API/worker/web environment:

```sh
npm run dev:smoke
```

Open the exact UI URL in its `ready` output. This page saves synthetic markers and queues local attachments; it is a process/storage diagnostic. Its browser shell is plain HTML/JavaScript. It is not the full commerce product or the target React interface.

Stop it from another terminal in the **same checkout/worktree**:

```sh
npm run stop:smoke
```

Ctrl-C in the owning foreground terminal also works. Data and completed attachments remain for a subsequent start. The [local environment guide](LOCAL-ENVIRONMENT.md) explains instance isolation, fixed ports, and interrupted-run recovery.

## Troubleshooting and next steps

| Observation | Meaning and next action |
| --- | --- |
| `npm run dev` exits with status 2 | Expected: that command guards the unqualified target stack. Use one of the explicit demos above. |
| Node rejects type stripping or `node:sqlite` | Check `node --version` against the supported ranges in `package.json`. |
| A served demo waits instead of exiting | Expected: open its printed URL, then use Ctrl-C when finished. |
| A session is rejected | Use the private session file from the currently running demo and the specified case ID. Sessions from another run or store do not apply. |
| A persistent diagnostic refuses startup | Inspect its own runtime and existing process using the local environment guide. Do not delete a database or take over an unknown process. |

For development, start with [docs/DEVELOPMENT.md](DEVELOPMENT.md). Routine work uses focused checks; there is no need to run the full regression suite just to explore these examples. [Current status](PROJECT-STATUS.md) separates this local preview from the remaining production and integration work.
