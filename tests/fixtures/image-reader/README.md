# M17 image reader fixtures

These fixtures are authored synthetic transport examples. No image model was
called, no customer image is included, and the declared answers are not visual
accuracy observations. The tiny image is an original 2-by-2 RGBA color grid.
The larger original RGBA raster uses fixed row colors and uncompressed zlib
blocks to exercise the byte boundary without external image assets.

`request.json`, `expected-wire.json`, the two provider examples and their two
hand-declared normalized examples freeze a narrow usability vocabulary before
implementation. The ambiguous example retains `cannot_assess`; neither example
grants inspection, authenticity, eligibility, approval or financial authority.
The expected wire is independently declared rather than produced by the reader.

`image.json` pins the complete source bytes and their SHA-256. `large-image.json`
pins `large-rgba.png` (261463 bytes, 256 by 255 pixels). `rejected-pngs.json`
contains independently constructed checksum, excessive-dimension, metadata and
trailing-data violations, each with a matching byte hash so that hash validation
alone cannot satisfy the parser checks. All fixtures are project-authored and
carry the repository's licensing terms.

The one native test file contains exactly ten stable cases, `M17-IMAGE-WIRE-01`
through `M17-IMAGE-AUTHORITY-10`. The author commits tests and fixtures first,
executes no product code, and delegates actual behavioral/fault observation to
the coordinating worker under ADR-0051. A missing-module failure at this tests
checkpoint is not behavioral evidence.
