# Synthetic example commands

Run from the Rifare repository root. These retained values identify this example,
not independent owner approval. A qualification workflow must obtain trusted
baseline/enrollment identities outside the candidate it evaluates.

```sh
python3 tools/check_release_benchmark.py --root . \
  --baseline tests/fixtures/release-benchmark/expected-benchmark.v1.json \
  --baseline-sha256 4b53de08f4af8b915eead29394fa0467d257beb30047347f8fd793648fd9d5ed \
  --manifest tests/fixtures/release-benchmark/cohort.manifest.SYNTHETIC.json \
  --manifest-sha256 8e710c8f1efd5bab3c6b2d48906a8874456922078738d5536b37a00dfc11de83 \
  --results tests/fixtures/release-benchmark/cohort.results.SYNTHETIC.json
```

A zero exit confirms structurally valid inputs and arithmetic, not a passing
release. Expect 6/10 correct handling, 3/10 autonomous resolution, 1/4 mature
repeat contact and `release_qualified: false`. A malformed cohort, missing case,
changed retained manifest or unapproved benchmark difference returns nonzero.

[The hand calculation](HAND-CALCULATION.md) and [literal expected output](expected-cohort.v1.json)
are independent of the scoring code. No provider or live service is called.
