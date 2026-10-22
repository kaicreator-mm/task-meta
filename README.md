# task-meta

Passive, source-qualified Agent Task execution evidence collector. It captures
metadata-only observations from a real Agent run (v0.1: ZCode), keeps them as private
immutable content-addressed evidence, and writes a strict ADS `ads/github/v4`
`EXECUTION_SUMMARY` report for the owning GitHub Issue. Consumers such as Tally read
GitHub only.

- v0.1 definition, scope and Task DAG: [docs/v0.1/DEFINITION.md](docs/v0.1/DEFINITION.md)
- Vendored ADS contracts: [vendor/ads/PINS.md](vendor/ads/PINS.md)

```bash
npm ci
npm run lint && npm run typecheck && npm test
```

## Usage

```bash
node src/cli.ts collect --repo <owner/name> --issue <n> --headless <result.json> \
  [--model-io <file> | --zcode-rollout-dir <dir>] [--run <run.txt>] \
  [--gate-log <file> --gate-sha <40hex>] \
  --store <dir> --out <report.md> [--operator-id zcode] [--role builder] [--profile v4|v5] [--publish]
```

`collect` reads the ZCode run artifacts (metadata only), stores three content-addressed
objects (`observations`, `summary`, `capability`) plus a manifest (revision 1) in `--store`,
verifies the store, renders an `ads/github/v4` `EXECUTION_SUMMARY` comment to `--out`, and
reads the Issue comments back. **Without `--publish` nothing is written to GitHub** (dry run;
the readback is a read-only `gh api` call). stdout is one JSON line
`{outcome, attempt_ref, manifest, data_digest, capture_coverage, limits_count}`.

- `--zcode-rollout-dir` resolves `model-io-<sessionId>.jsonl` from the headless session id;
  a missing file is recorded as a limit.
- A gate log is bound only to the explicit `--gate-sha` (both flags are required together).
- Re-running with identical inputs is idempotent (same manifest digest). A changed input
  for an existing attempt is refused (exit 4): v0.1 has no revisions/supersedes.

Exit codes: 0 DRY_RUN/PUBLISHED/ALREADY_PUBLISHED, 1 failure, 2 usage, 3 privacy guard,
4 conflicting revision 1, 5 store verification, 6 report not representable, 7 CONFLICT/NOT_PUBLISHED.
