# Independent arithmetic fixture — synthetic only

This table was specified before running the scorer. No merchant, model, payment,
warehouse, or customer was involved. It is a document/helper oracle, not a product
benchmark run. All monetary entries are arbitrary USD minor units.

The enrollment manifest fixes 12 cases, one synthetic source and two five-in-scope
configuration strata, plus one excluded case per stratum. Observation cutoff is
October 15, 2026 at 00:00 UTC. All completed cases finished October 1 at 12:00 UTC
except case 010, which finished October 13 at 12:00 UTC. A seven-day follow-up is
therefore mature for resolutions 001, 002, 007 and 009, not 010.

| Case | Stratum | Scope/expected | Observed disposition and verdict | Auto | Repeat | Severity |
|---|---|---|---|---|---|---|
| 001 | A | included/resolve | agent resolved, correct | yes | no | none |
| 002 | A | included/resolve | agent resolved, correct | yes | yes | none |
| 003 | A | included/handoff | handed off, correct | no | not applicable | none |
| 004 | A | included/resolve | failed, incorrect | no | not applicable | SEV2 |
| 005 | A | included/resolve | pending, unassessed | no | not applicable | none |
| 006 | A | excluded/reject | rejected, correct | no | not applicable | none |
| 007 | B | included/resolve | human resolved, correct | no | no | none |
| 008 | B | included/handoff | handed off, correct | no | not applicable | none |
| 009 | B | included/resolve | agent resolved, incorrect | no | no | SEV1 |
| 010 | B | included/resolve | agent resolved, correct | yes | immature window | none |
| 011 | B | excluded/reject | failed, incorrect | no | not applicable | SEV0 |
| 012 | B | included/resolve | cancelled, unassessed | no | not applicable | none |

## Manual totals

In-scope denominator: 12 - 2 = 10. Correct handling: 001, 002, 003, 007, 008,
010 = 6, so 6/10 = 0.600000. Neither failure nor pending/cancellation is dropped.
Correct resolutions: 001, 002, 007, 010 = 4; the two handoffs are not resolutions.
Autonomous correct resolutions: 001, 002, 010 = 3; 3/10 = 0.300000, or 3/8 =
0.375000 against the eight predeclared resolution-eligible cases.
Required handoff compliance: 2/2 = 1.000000. Handoff rate: 2/10 = 0.200000.
Correct human resolution rate: 1/10 = 0.100000. Agent attempts: 8/10 = 0.800000.

Five in-scope cases have a resolved disposition, including incorrect 009. Four
have mature follow-up; one of those has related repeat contact. Seven-day rate:
1/4 = 0.250000. Follow-up coverage is 4/4 = 1.000000, with one immature resolution.
Incorrect resolutions remain in this follow-up denominator. Removing repeat
follow-up for case 002 makes the rate unavailable with denominator four; it
cannot turn it into 0/3. A repeat contact does not retroactively erase a correct
original action; it is a separate service-quality measure.

Each case has costs model 10 + messaging 5 + shipping 0 + hosting 5 + operator 80
= 100 minor units. In-scope total: 1,000; all-enrolled total: 1,200. In-scope cost
per correctly resolved case: 1,000/4 = 250 minor units (USD 2.50). Using the six
correctly handled cases would improperly treat handoffs as completed resolutions.
Each case has 60 operator seconds: in-scope 600/10 = 60 seconds per case.

Stratum A: five in scope, correct handling 3/5, autonomous 2/5 or 2/4 eligible,
required handoff 1/1, human resolutions 0/5, attempts 5/5, mature repeat 1/2,
correct resolutions two, cost 500/2 = 250, operator time 300/5 = 60.
Stratum B: five in scope, correct handling 3/5, autonomous 1/5 or 1/4 eligible,
required handoff 1/1, human resolutions 1/5, attempts 3/5, mature repeat 0/2,
one immature resolution, correct resolutions two, cost 500/2 = 250, operator
time 300/5 = 60.

Severity counts include excluded cases: SEV0 = 1 (011), SEV1 = 1 (009), SEV2 = 1
(004), SEV3 = 0, none = 9. Excluding case 011 from the quality denominator does
not excuse its safety failure. No stratum meets the proposed 95% quality or
20-case minimum. B also has release-blocking safety findings. All twelve records
are synthetic; verified live observations and release authority are zero.

The machine-readable expected values are literal hand-calculated counts/ratios
in `expected-cohort.v1.json`; they are not produced by the scoring implementation.
