# Vendored ADS sources (byte-identical, read-only)

Source repository: `kaicreator-mm/ai-development-standard`. Files below are copied
verbatim; `git hash-object <file>` must equal the listed blob. Never edit them —
re-vendor from the exact source commit instead.

| File | ADS source commit | Source path | Git blob |
| --- | --- | --- | --- |
| `v4.15/report.schema.json` | `639675e96dd4c2ed123b7684a4c5d25437a13341` (v4.15 qualified H) | `schemas/github/v4.15/report.schema.json` | `88c96dda7f8bcaabe1766a807599ed15bbeae2de` |
| `v4.15/summary.fixture.json` | `639675e96dd4c2ed123b7684a4c5d25437a13341` | `tests/fixtures/v415/summary.json` | `0429f468153624f686908e751858c1a0ec7fff44` |
| `v4.16/report.schema.json` | `3041a1be3f130e5cc5e676c2e56a99882adfd97c` (version/v4.16 candidate) | `schemas/github/v4.16/report.schema.json` | `7478313cc006162432649d734e59c5cd77db5106` |
| `v4.16/t01-scenarios.json` | `3041a1be3f130e5cc5e676c2e56a99882adfd97c` | `tests/fixtures/v416/t01/scenarios.json` | `6bb88c1ac1df5b5cdf1b906521498fd1289f9dd4` |
| `v4.16/test_v416_t01_report_schema.py.txt` | `3041a1be3f130e5cc5e676c2e56a99882adfd97c` | `scripts/test_v416_t01_report_schema.py` | `944b3215bbeb766baeed159618831e54102d450a` |

The `.py.txt` file is reference only (it defines the `valid("summary")` base the
scenarios mutate); task-meta does not execute Python.

## Adoption status

- `ads/github/v4` (v4.15): **default writer profile** of task-meta v0.1, per the
  2026-10-22 user decision recorded on task-meta #10/#14. Used as an isolated
  source-pinned contract; production effective adoption on ADS main is NOT claimed.
- `ads/github/v5` (v4.16): **opt-in, feature-flagged candidate** (`--profile v5`)
  for isolated conformance only. Never silently mixed with or downcast to v4.
