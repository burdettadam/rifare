# Portfolio presentation refresh

State: ready_for_review

Assigned scope: the owner's request to generate Rifare logo/art, make the README
marketing and user facing, and track the improvements in Git for portfolio use
and an easy handoff. This is a bounded presentation assignment; it assigns no
additional commerce milestone.

Integration owner and asset writer: root presentation agent.
README and guide writer: independent `readme` agent on `docs/portfolio-readme`.
Review roles: independent authority/security and regression/preservation agents.
Base: `c299065241b3bdf4928a83f9ff4decf749c6afaa` from `origin/development`.
Branch: `docs/portfolio-branding`.

Allowed paths: `README.md`, `docs/TRY-RIFARE.md`, `docs/PROJECT-STATUS.md`,
`docs/BRAND.md`, `docs/PORTFOLIO-HANDOFF.md`, `docs/assets/`,
`planning/component-inventory.json`, and this record.

## Outcome

- Replaced the historical milestone-log landing page with a product promise,
  source-backed user workflows, runnable demo instructions, current status, and
  clear documentation navigation.
- Added a transparent wordmark and standalone mark, README hero, matching social
  artwork, sub-1-MB JPEG upload export, generation prompts, and exact asset manifest.
- Kept all earlier feature detail in its existing guides and Git history.
- Kept the local/synthetic and unfinished-license status visible. Conceptual art
  is identified as artwork rather than a screenshot or integration evidence.
- Retained every existing source-inventory member; only new presentation files
  are added to the same component. Component obligations and policies are unchanged.

## Verification scope

Node.js `v24.19.0` on this Linux host. The commands documented in the primary tour
ran once, with exit status 0:

```sh
npm ci --offline --ignore-scripts
node --experimental-strip-types tools/demo-return-resolution.mts
node --experimental-strip-types tools/demo-reliability.mts
node --experimental-strip-types tools/demo-customization.mts
```

The return demo produced `unknown` after a lost response, `accepted` after lookup,
and exactly one refund send attempt. Its separate synthetic settlement and
unsupported exchange-price difference remained visible. Each demo reported zero
external calls and no production qualification. No product test suite, full
regression, model, or connected-provider call was run for this refresh.

The served support demo was started on loopback using its existing private
temporary session file. The initial sandbox denied loopback binding; an approved
host execution started the same source successfully. The support page returned
HTTP 200; operator and customer context requests each returned 200 with the
expected respective role. The operator view contained two shipments and retained
the fixture's incomplete-history indication. Session values were not printed or
added to source. The server was stopped and its private temporary session removed.

Actual browser capture was unavailable: the installed Playwright package had no
browser executable, and its browser download returned invalid archives. No
browser-rendering pass or product screenshot is claimed. The README illustrates
the brand with generated art and provides the actual supported local commands.

Raw local command output stays in ignored evidence. Concise final static checks,
review outcomes, and any remaining tooling limitations are recorded at closure.

## Handoff and acceptance boundary

The documentation commit from the independent writer is `f398f64`, integrated as
`073b48d`. Asset and final review commits follow on the presentation branch.
This change advances no product acceptance, production readiness, license grant,
or release status. See [the handoff guide](../../docs/PORTFOLIO-HANDOFF.md) for
asset use, Git review, and repository profile preparation.
