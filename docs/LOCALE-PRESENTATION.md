# Locale, timezone and exact currency presentation

M07-G16 adds display preferences to the existing order-status and customer-return
diagnostic pages. It is local development preparation under ADR-0035. It does
not accept the blocked milestone prerequisites or qualify a translated production
interface.

## Supported display choices

The number/date formats are `en-US`, `en-GB`, `de-DE`, `fr-FR` and `ja-JP`.
Display zones are `UTC`, `America/Denver`, `America/New_York`, `Europe/Berlin`
and `Asia/Tokyo`. Defaults are explicitly `en-US` and `UTC`, independent of the
host and browser preferences. The controls name those choices and state that
interface and error text remain **English**. Formatting a number does not change
the document's language or claim that its instructions have been translated.

Preferences remain in memory for the current page. They are not sent to the
commerce API, retained in browser storage or attached to a customer record.
Changing them reformats the currently displayed values and does not fetch new
facts, extend snapshot expiry, recalculate eligibility or change a confirmation.
Signing out and the existing clear/expiry paths remove the associated displayed
source values. A missing optional formatter leaves the controls disabled and the
existing canonical presentation usable.

The source-controlled contract is
`packages/presentation/locale-contract.v1.json`. One pure, browser-compatible
implementation in `packages/presentation/locale-presentation.js` supplies the
formatting functions; `apps/commerce-api/locale-client.js` binds them to displayed
DOM values. The server serves only their two named static asset paths with the
existing private-page headers. No new API endpoint, dependency or schema is added.

## Exact amounts and explicit errors

Currency support is the existing money model:

| Currency | Minor-unit exponent |
| --- | ---: |
| USD, EUR, GBP, CAD | 2 |
| JPY | 0 |
| KWD, BHD | 3 |

Amounts retain their currency and signed canonical integer minor-unit string,
with the existing 36-digit bound and rejection of negative zero. Whole units are
formatted as `BigInt`; the exact fractional digits are inserted into the
formatter's currency pattern. No financial amount is converted to an imprecise
JavaScript number. ISO currency codes remain visible even where a currency symbol
would be ambiguous. No conversion rate or replacement currency is inferred.

Order status keeps its original raw source totals and adds a formatted view.
The synthetic reader's safe integer `amount_minor` and the existing adapters'
strict period-decimal source contracts are accepted explicitly. Decimal strings
with grouping, commas, exponent notation, excess precision or whitespace are
rejected for formatting; unsupported currencies and unsafe numeric minor units
are also rejected. Unavailable formatted totals are labeled beside the retained
source values. Return estimates fail closed and remain unconfirmed if an amount
or its currency exponent is inconsistent.

For example, the same `USD` / `123456` source value displays as
`USD 1,234.56` in `en-US` and `1.234,56 USD` in `de-DE`. The source remains
123456 minor units. The formatter has no localized decimal input parser. Its
strict source-decimal adapter accepts `1234.56`; it rejects `1.234,56`.

Financial submission still uses the server-issued quote ID and digest plus the
existing confirmation and request keys. It does not read text, formatted amounts
or presentation metadata from the page to calculate financial input. A locale
change after checking the review box preserves that same quote identity. The
server's existing stale-quote and authorization checks remain authoritative.

## Instants and return deadlines

An instant must be a safe integer count of epoch milliseconds or an exact UTC
string shaped as `YYYY-MM-DDTHH:mm:ss.sssZ`. The supported range is 1970 through
9999. Ambiguous dates, local wall times, implicit timezone strings, invalid dates,
leap-second text and fractional numeric milliseconds are rejected. The display
uses the Gregorian calendar, Latin digits, a 24-hour clock, milliseconds and the
actual offset for that instant.

The existing return evaluator is unchanged. Its deadline is:

```text
trusted delivered instant + policy window days × 86,400,000 milliseconds
```

The exact cutoff is inclusive; one millisecond after it is outside the window.
The policy's validated IANA zone labels that instant. It does not turn an elapsed
day into a local calendar day. The return page displays the selected-zone value,
the policy-zone value and the exact UTC cutoff together. Inconsistent deadline
fields or an unexpected cutoff semantic block presentation of the estimate.

The fixed spring fixture runs from `2026-03-07T09:30:00.000Z` to
`2026-03-08T09:30:00.000Z`: Denver changes from 02:30 at UTC−07:00 to 03:30 at
UTC−06:00. The fall fixture runs from `2026-10-31T08:30:00.000Z` to
`2026-11-01T08:30:00.000Z`: Denver changes from 02:30 at UTC−06:00 to the second
01:30 at UTC−07:00. Both windows remain exactly 24 elapsed hours. A separate
fixture crosses the UTC date boundary and retains the same millisecond instant
while its displayed local calendar date changes.

## Focused evidence

Fifteen native cases are in `tests/development/locale-presentation.test.mts`.
They were written and committed before implementation. Root runs this whole file
as part of the one bounded development selection; authoring uses syntax and
source review without running another regression campaign.

```sh
python3 tools/dev_tests.py --files tests/development/locale-presentation.test.mts
```

The four short browser scenarios in `tests/browser/locale_workflows.py` use the
installed Python Playwright and Chromium toolchain. Set `RIFARE_TEST_PYTHON` and
`RIFARE_TEST_BROWSER` only when those executables are not the existing defaults.
They render the actual static assets and use an explicit allowlisted Python
bridge to the real local commerce API. Direct browser network and WebSockets
are denied. No screenshot or old browser campaign is required.

| Case group | Observable assertion |
| --- | --- |
| `CASE-M07-G16-01` | Actual status and return screens change presentation across five locales and two display zones while preserving canonical fields, one quote and an unchecked confirmation. |
| `CASE-M07-G16-02` | Deliberately damaged copies of actual quote responses contain a localized minor amount or unsupported currency; the UI reports an explicit error and blocks submission. |
| `CASE-M07-G16-03` | Inclusive spring-DST cutoff behavior is unchanged; a temporary formatter mutant that parses a localized decimal must be detected. |
| Currency and source-total cases | Independent literal goldens, all seven existing exponents, very large and negative values, safe integers and strict canonical decimals. |
| Instant and deadline cases | Fixed offsets and calendar dates, milliseconds, spring/fall boundaries, explicit locale/zone input and unchanged decision/source objects. |
| Confirmation and fallback cases | Formatted text never becomes request input; quote identity and the approval box remain intact; omitted optional helpers retain usable canonical values. |

Native output includes minimized rendered financial-estimate text and its exact
UTC/policy-zone labels. Actual run reports, candidate/configuration pins and
independent review decisions belong to the integration evidence. This document
does not claim that an unrun source case passed.

## Limits and rollback

This scope covers two existing diagnostic screens and the named formats. It
does not qualify every currency, locale, browser engine, operating system,
merchant policy, translated error message or assistive technology. ICU/CLDR
punctuation and spacing may differ between runtimes; the numeric and deadline
oracles retain their fixed expected values. Human screen-reader and real
merchant observations, connected services and the React/PostgreSQL target remain
unqualified.

Rollback reverts the presentation helpers, their static asset entries and the
scoped HTML/client/CSS changes with native Git. No migration, financial rewrite
or stored-preference cleanup is required. Existing return policy arithmetic,
request handling, source-ledger values and financial authority remain intact.
