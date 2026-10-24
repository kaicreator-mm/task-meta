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
  [--gate-log <file>[@<40hex>]]... [--git-dir <dir>] \
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
- `--gate-log <file>@<sha>` (repeatable) binds a gate log to that commit: subject binding OBSERVED.
  The legacy pair `--gate-log <file> --gate-sha <sha>` (one log) still means `file@sha`.
  Without `@sha` the subject is inferred from the log file mtime (after a finished run segment's
  `finished_at` and before the next segment starts => that segment's `head_after`, binding INFERRED,
  recorded as a limit); otherwise it is unbound (UNKNOWN). Inferred/unbound logs never yield
  STRICT_TERMINAL_SUCCESS. All logs go through the #11 verifier assessment, which is the only verdict source.
- `--git-dir <dir>` (optional, read-only) lets lineage (#15) read parents and per-transition diffstat.
- Beyond the three original objects the manifest also holds `verifier`, `lineage`, `labels`
  and `aggregates` (private; only a bounded outcome-class limit and the ADS gap limit reach the report).
  stdout additionally carries `outcome_class`, `versions`, `transitions` (count by kind),
  `labels` (count by kind), `profile` and `mode` (`dry-run`|`publish`).
- Re-running with identical inputs is idempotent (same manifest digest). A changed input
  for an existing attempt is refused (exit 4): v0.1 has no revisions/supersedes.

Exit codes: 0 DRY_RUN/PUBLISHED/ALREADY_PUBLISHED, 1 failure, 2 usage, 3 privacy guard,
4 conflicting revision 1, 5 store verification, 6 report not representable, 7 CONFLICT/NOT_PUBLISHED.

`--run` is repeatable: a resumed ZCode session has one `run.txt` per segment. Segments are
sorted by start time; `run_wall_ms` is the union of finished segments, `source_sha` the last
finished segment's `head_after`, and an unfinished segment, a broken head chain or model
requests outside all segment windows make the capture PARTIAL with a specific limit.

## Agent plugin validation (CLI-first)

For reproducible Codex, Claude Code and ZCode plugin setup/debugging, read the
[repository validation rules](AGENTS.md) and use the single canonical
[task-meta-agent-cli-validation Skill](.agents/skills/task-meta-agent-cli-validation/SKILL.md).
Claude Code discovers the forwarding entry at
[.claude/skills/task-meta-agent-cli-validation](.claude/skills/task-meta-agent-cli-validation/SKILL.md);
ZCode can import the Codex Skill using Settings > Skills > Import > Symlink.
Always distinguish direct Hook fixture checks from real Agent CLI auto-trigger,
real authenticated GitHub readback and desktop-only trust. In a new Host,
unsupported CLI commands and unrun platform lanes remain NOT_RUN; do not
recreate v0.3 release evidence or infer CLI support from desktop observations.
