# C2 — Windows Node24 real Hook ON/OFF paired overhead baseline (R0)

```ini
TASK=TM-V040-C2
ISSUE=71
CLAIM=6426562456 (SINGLE_WRITER_ADMISSION)
MEASURED_SOURCE_SHA=8686618f2ab383910859846603f48617c5840585
MEASURED_SOURCE_PINNING=git archive --format=tar 8686618f… (pre-change baseline, independent of branch HEAD)
PLUGIN=zcode task-meta-capture capture.mjs (sha256 8595f5b3c6b3e1379e319b349ccd577fd8083d239eb9d4b82333f7f4b30a0ae6, PLUGIN_VERSION=0.3.0)
BENCH_SCRIPT=scripts/bench-task-meta-hook-pair.ts
BASELINE_KIND=PRE_CHANGE_BASELINE_ONLY
NATIVE_DAG_ADMITTED=YES (12/12, Issue #64 comment 6414839535)
```

**This is a pre-change baseline only.** It measures the current `version/v0.4` Hook chain as
frozen at `8686618f…`. It does NOT qualify any candidate; I (#73) consumes it as a
provenance/baseline input, and R (#74) performs a separate exact candidate remeasurement.

## 1. Environment receipts (all witnessed)

| Field | Value |
|---|---|
| Date (local) | 2026-10-27 04:35–04:39 (+08:00; NDJSON ISO timestamps are UTC 2026-10-26T20:3x) |
| Host | `Nilar`, Windows 10.0.26300, x64 |
| CPU | AMD Ryzen 7 7840HS w/ Radeon 780M Graphics, 16 logical CPUs |
| Node | v24.21.0 (`C:\Users\15549\AppData\Local\fnm_multishells\…\node.exe`) |
| Measured source | `8686618f2ab383910859846603f48617c5840585` (`version/v0.4` HEAD), installed via `git archive` |
| Capture plugin | `plugins/zcode/task-meta-capture/scripts/capture.mjs`, sha256 `8595f5b3…`, version `0.3.0`; install copy bytes == worktree bytes (both sha256 recorded, equal) |
| Fixture template | `test/fixtures/zcode-hooks/stop.json`, sha256 `e8567f5dfb2725c9…` |
| Isolation dirs | `C:\xDev\kAiCreator\_tmp\tm-v040-c2-bench\runs\{install,spool,outbox,store}` (note: workspace `_tmp` auto-cleans after 7 days; this document carries the durable record) |

## 2. What was measured (chain definition)

- **Hook ON run** — the real synchronous Stop-hook chain exactly as the host runs it:
  `node <install>/plugins/zcode/task-meta-capture/scripts/capture.mjs` receives the Stop
  payload on stdin → JCS-canonicalize + sha256 → append one metadata line to
  `<spool>/<session>.jsonl` → `gitFields(cwd)` executes real git commands against the cwd →
  spawn detached `node <install>/src/cli.ts auto-report --agent zcode --session <id> --trigger stop`
  → runner collects the spool session, resolves binding (GIT_REMOTE OBSERVED), resolves
  profile (v5 adopted main) → hits fail-closed clearance guard (`clearance_ref=""` ⇒
  `PUBLICATION_CLEARANCE_REQUIRED` path) → **outbox entry `HELD` appended**. No network, no
  POST, no public report write at any point (verified by design readback of
  `src/autoreport/*` + observed HELD outcomes; publication is fail-closed).
- **Hook OFF run** — identical invocation shape (`node <root>/noop.mjs`, same node binary,
  same stdin bytes, same spawn options) into a null sink: the host workload with the capture
  hook absent. Negative control: spool/outbox entry counts before/after are asserted
  unchanged (`absence_witnessed=true` in all 6 OFF runs).

Isolation & fairness:

- Measured source pinned via `git archive 8686618f…`; bench script and docs live only on the
  bench branch and never enter the measured tree.
- Install copy's `config/auto-report.json` repointed to bench-local spool/outbox/store and
  `settle_seconds: 0` (removes the 180s settle wait; the settle wait is wall-clock idle time,
  not hook work). `node_modules` mirrored from the lockfile-exact worktree install (ESM
  ignores NODE_PATH). `TASK_META_HOME` env selects the install copy; `TASK_META_ZCODE_SPOOL`
  points at the same bench spool dir the runner reads from config.
- Fixture: template bytes with two overrides per run — `sessionId` made unique
  (`sess-bench-<base>-<seq>-<ON|OFF>`; required so runs share no spool file, lock, or
  revision) and `cwd` set to the real bench worktree so `gitFields()` runs its true git
  commands (a sentinel cwd would understate ON-side cost). All other fields identical.
- **Alternate order**: pair 1 ON→OFF, pair 2 OFF→ON, pair 3 ON→OFF, pair 4 OFF→ON,
  pair 5 ON→OFF, pair 6 OFF→ON.
- Warmup: one uncounted smoke pair ran first in the same root (primes OS file-scanner/module
  cache so first-touch cost does not land in counted runs); warmup records remain in
  `runs.ndjson` and are excluded from the table below.
- Metrics: `hook_wall_ms` = wall time spawn→exit of the synchronous hook invocation
  (comparable ON vs OFF). `stop_to_outbox_ms` (ON only) = capture spawn start → first outbox
  entry for the session observed (100ms poll). `exit_code` = raw child exit. Spool bytes/lines
  = actual file. **CPU/RSS: N/A — win32 Node exposes no child rusage and the auto-report
  child is detached; not witnessed, not estimated** (per dispatch: unsupported counters are
  N/A with witness, never fabricated).

## 3. Counted paired runs (6 pairs, alternate order, raw exits)

| Pair | Order | Side | Exit | hook_wall_ms | stop_to_outbox_ms | Spool bytes/lines | Outbox | Session |
|---|---|---|---|---|---|---|---|---|
| 1 | ON→OFF | ON | 0 | 401.5 | 620.2 | 842 / 1 | HELD | sess-bench-20261026203602-01-ON |
| 1 | | OFF | 0 | 99.1 | N/A (absent) | 0 / 0 (witnessed) | absent | sess-bench-20261026203602-02-OFF |
| 2 | OFF→ON | OFF | 0 | 92.5 | N/A (absent) | 0 / 0 (witnessed) | absent | sess-bench-20261026203602-03-OFF |
| 2 | | ON | 0 | 368.1 | 582.1 | 842 / 1 | HELD | sess-bench-20261026203602-04-ON |
| 3 | ON→OFF | ON | 0 | 447.3 | 669.2 | 842 / 1 | HELD | sess-bench-20261026203602-05-ON |
| 3 | | OFF | 0 | 87.7 | N/A (absent) | 0 / 0 (witnessed) | absent | sess-bench-20261026203602-06-OFF |
| 4 | OFF→ON | OFF | 0 | 149.5 | N/A (absent) | 0 / 0 (witnessed) | absent | sess-bench-20261026203602-07-OFF |
| 4 | | ON | 0 | 446.2 | 662.1 | 842 / 1 | HELD | sess-bench-20261026203602-08-ON |
| 5 | ON→OFF | ON | 0 | 348.0 | 572.7 | 842 / 1 | HELD | sess-bench-20261026203602-09-ON |
| 5 | | OFF | 0 | 113.7 | N/A (absent) | 0 / 0 (witnessed) | absent | sess-bench-20261026203602-10-OFF |
| 6 | OFF→ON | OFF | 0 | 108.1 | N/A (absent) | 0 / 0 (witnessed) | absent | sess-bench-20261026203602-11-OFF |
| 6 | | ON | 0 | 311.7 | 534.7 | 842 / 1 | HELD | sess-bench-20261026203602-12-ON |

## 4. Summary (n=6 per side; median = average of the two middle values)

| Metric | Hook OFF | Hook ON | ON−OFF delta (per pair) |
|---|---|---|---|
| hook invocation wall (ms) | min 87.7 / median 103.6 / max 149.5 | min 311.7 / median 384.8 / max 447.3 | min 203.6 / **median 286.2** / max 359.6 (mean 278.7) |
| Stop→Outbox wall (ms) | N/A — no outbox by design, absence witnessed ×6 | min 534.7 / median 601.2 / max 669.2 | — |
| Spool | none | 842 bytes / 1 line, every ON run | — |
| Outbox state | none | `HELD` ×6 (fail-closed, no POST) | — |
| Exit codes | 0 ×6 | 0 ×6 | — |

Per-pair hook-wall deltas: P1 302.4, P2 275.6, P3 359.6, P4 296.7, P5 234.3, P6 203.6.
Read: on this host the synchronous Stop-hook invocation adds a median ≈286ms over the
hook-absent null sink (dominated by a second Node process start plus JCS/hash, git-field
collection and the detached auto-report spawn), and the full Stop→Outbox chain completes in
a median ≈601ms with `settle_seconds=0`. Both distributions are stable (no run crossed the
5s host hook timeout budget in `hooks.json`; max ON invocation 447.3ms).

## 5. Raw receipts (verbatim, from `runs.ndjson` counted segment)

Environment record (one line, abbreviated to fit):

```json
{"bench_started_at":"2026-10-26T20:35:55…","node":"v24.21.0","platform":"win32","os_release":"10.0.26300","arch":"x64","hostname":"Nilar","cpu_count":16,"cpu_model":"AMD Ryzen 7 7840HS w/ Radeon 780M Graphics","source_sha":"8686618f2ab383910859846603f48617c5840585","worktree_head":"8686618f2ab383910859846603f48617c5840585","capture_mjs_sha256":"8595f5b3c6b3e1379e319b349ccd577fd8083d239eb9d4b82333f7f4b30a0ae6","fixture_template_sha256":"e8567f5dfb2725c9c270f9d44e03ad04d7d782a5ccdc2a9894ae359d8156e94d","plugin_version":"0.3.0","install_config.settle_seconds":0,"install_config.clearance_ref":""}
```

Sample spool line (ON run 1; metadata-only entry):

```json
{"d":"2b4394899b5a65bcc704cf3f04c580efb2c6b2d143baf9a3b05a588d1a6723af","e":{"agent_name":"main","cwd_digest":"5d55bb05…","event":"Stop","git_dirty":true,"git_head":"8686618f2ab383910859846603f48617c5840585","git_remote_repo":"kaicreator-mm/task-meta","hook_ts":"2026-10-22T13:11:00.000Z","plugin_version":"0.3.0","received_at":"2026-10-26T20:36:02.589Z","schema":"task-meta/zcode-hook/v1","session_id":"sess-bench-20261026203602-01-ON","tool_call_count":3,"worktree_refs":[{"kind":"REPO","repo":"task-meta","source":"WORKTREE"}]}}
```

Sample outbox entry (the Stop→Outbox product; fail-closed HELD, no POST):

```json
{"d":"84fa17ca…","e":{"agent":"zcode","at":"2026-10-26T20:36:03.083Z","binding":{"evidence":[{"epistemic":"OBSERVED","kind":"GIT_REMOTE","value":"kaicreator-mm/task-meta"},{"epistemic":"INFERRED","kind":"WORKTREE_NAME","value":"kaicreator-mm/task-meta"}],"issue_number":null,"pr_number":null,"reasons":["no issue reference"],"repository":"kaicreator-mm/task-meta","state":"UNRESOLVED"},"comment_url":null,"data_digest":null,"reasons":["no issue reference"],"session":"sess-bench-20261026203602-01-ON","state":"HELD"}}
```

## 6. Reproduce

```bash
node scripts/bench-task-meta-hook-pair.ts --pairs 6 \
  --root <abs bench root> \
  --source-sha 8686618f2ab383910859846603f48617c5840585
# optional --smoke runs one uncounted warmup pair first
```

## 7. Honest limits

- CPU/RSS per run: N/A (not witnessed) — win32 gives no child rusage; the auto-report child
  is detached by design. Not estimated anywhere in this document.
- `stop_to_outbox_ms` includes outbox-poll granularity (100ms) and the runner's own
  cold-start; it is a wall-clock witness of the real detached chain, not a pure CPU cost.
- Synthetic Stop fixture: metadata-only real hook code and real git/CLI work; not a
  REAL_AGENT_CLI session and NOT candidate release evidence (R remeasures separately).
- Uncounted runs: two harness-bringup smoke pairs (`runs-smoke`, `runs-smoke2`) and one
  warmup pair in the counted root ran before the counted 12; their raw records remain in
  their respective `runs.ndjson` files and none is counted in the table above. The warmup
  exists so OS first-touch/module-cache cost does not land in counted ON runs.
