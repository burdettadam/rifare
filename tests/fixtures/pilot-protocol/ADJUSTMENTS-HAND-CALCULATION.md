# Additional protocol calculations — synthetic only

This supplement is specified before native execution. It reuses the unchanged
twelve records and literal expectations under `tests/fixtures/release-benchmark/`.
No real merchant, charge, customer or elapsed pilot observation is represented.

The initial fixture has 12 enrolled cases, 10 in scope, six correctly handled,
four correctly resolved, four mature resolution windows, one mature related
repeat contact, one immature resolution, and 1,000 known in-scope USD minor units
of cost. The correct-resolution cost divisor is four, not six.

Append a related contact to CASE-001 on October 8 at 12:00 UTC. Its completion was
October 1 at 12:00 UTC: this is exactly the inclusive seven-day boundary. CASE-001
joins CASE-002 in the mature repeat-contact numerator. The result is **2/4 =
0.500000**, with the same four mature windows and ten in-scope cases. The original
correctness verdict remains unchanged.

Append a model-cost adjustment of **+40** USD minor units to failed CASE-004,
incurred October 3 but reported October 16 after the October 15 cutoff. The
in-scope known total is **1,000 + 40 = 1,040**. Correctly resolved cases remain
four. Cost per correctly resolved case is **1,040/4 = 260.000000** minor units.
The failed case and its extra cost remain in the frozen cohort. Removing it would
change both the enrollment and the cost result and must be detected.

Removing CASE-002's submitted follow-up event leaves its mature window in the
denominator: repeat contact is **unavailable / 4**, not 0/3. CASE-010's immature
window remains explicitly immature. A CASE-001 contact on October 9 at 12:00 UTC
is outside its seven-day window and does not fill CASE-002's missing follow-up.

Omitting CASE-004's original cost leaves cost per correct resolution unavailable
with the divisor four. It does not replace the missing cost with zero. A later
initial full cost submission can fill that previously unsubmitted cost; a delta
against a nonexistent original cost cannot.
