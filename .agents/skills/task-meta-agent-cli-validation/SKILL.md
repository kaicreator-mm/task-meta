---
name: task-meta-agent-cli-validation
description: Validate or troubleshoot task-meta-capture plugins in Codex CLI, Claude Code CLI or ZCode using real CLI-first workflows, Hook/Spool/Outbox evidence, version-safe installation and fail-closed GitHub publishing. Use for agent plugin installation, updates, end-to-end regression, SessionEnd correlation or host readiness; do not require a desktop UI without proven UI-only need.
---

# task-meta Agent CLI Validation — single canonical Skill

## Invocation and boundaries

When handling Codex, Claude Code, ZCode, plugin upgrades, capture Hook failures, SessionEnd, auto-report, outbox or real GitHub E2E, read this Skill **before** exploring commands again. Read root `AGENTS.md` and vendor README for the target: `plugins/{codex,claude,zcode}/task-meta-capture/README.md`. This Skill is project source and does **not** claim automatic installation into global environments. Codex and ZCode **natively discover workspace `.agents/skills`**; Claude Code loads the thin `.claude/skills` forwarding Skill. Therefore ZCode needs **no GUI import for this repository checkout**. Settings > Skills > Import > Symlink (or explicit copy with source-revision tracking) is an **optional user-scope sharing action** only when using the Skill outside this checkout. Check for a same-name user/workspace Skill shadow and confirm which source was actually loaded; do not ship a second plugin-bundled copy.

Use **5 evidence levels**, and never elevate a lower one:
- `SOURCE_ONLY`: JSON/schema, source inspection and deterministic unit tests.
- `HOOK_FIXTURE`: real `node` Hook subprocess fed *synthetic, sanitized* event data. Not Agent integration.
- `REAL_AGENT_CLI`: agent binary itself loaded/triggered the plugin in one actual session; observed private spool and authenticated tool turn. A shell-invoked Hook alone cannot qualify.
- `REAL_HOST_GITHUB`: real task-meta CLI, actually permitted isolated native Issue POST/readback, data digest, idempotency, privacy/denial; not a connector-only comment.
- `DESKTOP_ONLY`: in-app trust/activation or desktop-specific process semantics; record as a separate lane, not a surrogate for CLI.

Do not reuse an old result for a new exact SHA/Host/Agent version. Do not make an Agent run just to re-prove previously fixed facts unless relevant inputs changed. This post-release Skill is **not** permission to rewrite the v0.3.0 frozen baseline.

## Step 1 — identify actual runtime, preserve source and safety

Use a clean, approved worktree; do not mutate `~/.codex`, `~/.claude`, `~/.zcode` or plugin caches just to find features.

```sh
git rev-parse HEAD
git status --porcelain
node --version
npm --version
codex --version        # only if installed; missing => UNSUPPORTED/NOT_RUN
claude --version       # only if installed
zcode --version        # only if installed
codex --help           # feature discovery; do not infer command availability
codex plugin --help    # if unsupported, do not invent "codex plugin" actions
claude plugin --help
zcode plugins --help   # if unsupported, record, do not invent a replacement
```

Node **24.x** for project tests; `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`. For scoped regression: `node --test test/zcode-plugin*.test.ts`, `node --test test/claude-plugin.test.ts`, `node --test test/codex-plugin*.test.ts`, `node --test test/v0.3/golden.test.ts` and `node --test test/v0.3/release-metadata.test.ts`, adapted only to files physically present on that version. These commands prove `SOURCE_ONLY`/`HOOK_FIXTURE` as applicable, not real Agent. Do not run live-network mutations from source-only tests.

Freeze test subject: full 40-hex `HEAD` and Git tree, OS/build, Node, actual Agent executable `--version` output, plugin marketplace+manifest `version` and installed Hook runtime version; record all command exit codes. Preserve private evidence references, not user paths or secrets.

## Step 2 — choose Agent, verified entrypoints and limitations

### Claude Code (CLI-first)

- Repo installer/validator contract: `claude plugin validate plugins/claude/task-meta-capture`, `claude plugin marketplace add <approved-local-path-to-plugins/claude>` and `claude plugin install task-meta-capture@dev-task-meta`. First verify `claude plugin --help` because installed client versions differ. Do not silently modify current-user marketplace/install state without the user's permission.
- One real bounded `claude` headless/CLI session against a nonsecret test Task (use actual invocation options reported by `claude --help`); capture an actual tool turn and real SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop and SessionEnd when emitted. A model-auth failure is *not* a model-success PASS; it can still prove Hook activation if evidenced.
- Installed Hook spec: `plugins/claude/task-meta-capture/hooks/hooks.json`; launcher `scripts/capture.mjs` receives JSON stdin; `TASK_META_CLAUDE_SPOOL` overrides `~/.task-meta/claude-spool/<sessionId>.jsonl`. SessionEnd git metadata is limited by ~1.5 s host deadline; do not overstate.
- `Stop` waits default 180 s settle; `SessionEnd` immediate. Capture actual outbox `HELD`/`PUBLISHED` and reason. Explicit `TASK_META_AUTO_REPORT=0` disables auto-report for negative/mock runs.
- Fixed evidence: [PR #54 independent RQ](https://github.com/kaicreator-mm/task-meta/pull/54#issuecomment-6382732452) observed Claude v0.3.0 Hook Spool; model inference failed on expired OAuth, so `MODEL_RESULT=NOT_QUALIFIED`.

### ZCode (CLI-first where actually supported)

- Real repo source: `plugins/zcode/marketplace.json` and `plugins/zcode/task-meta-capture/hooks/hooks.json` with `scripts/capture.mjs`; `TASK_META_ZCODE_SPOOL` overrides `~/.task-meta/zcode-spool/<sessionId>.jsonl`.
- Repo release RQ observed `zcode plugins validate` and a real headless ZCode session; re-run **only if the installed `zcode plugins --help` provides it**. Do not assume `zcode plugins install` or `zcode exec` exists: inspect `--help` for this exact binary. If unavailable, validate Hook source via Node/test and mark real ZCode CLI auto-hook activation `NOT_RUN`, rather than calling an ad hoc Hook subprocess an Agent E2E.
- ZCode's client may default `hooks.enabled=false`. Determine the effective setting via supported CLI/config; only use a UI fallback when no supported CLI path exists, and report that as `DESKTOP_ONLY`. Avoid arbitrary config edits or turning on unattended agent effects.
- Six Hook events are SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure and Stop. **Do not require SessionEnd from the ZCode v0.3.0 hook set.** Stop→auto-report with 180 s settle; verify GitHub Target/Attempt binding and privacy.
- Fixed evidence: [PR #54](https://github.com/kaicreator-mm/task-meta/pull/54#issuecomment-6382732452) reported real headless v0.3.0 ZCode Spool (5 events, version 0.3.0), but use fresh evidence for a changed Host.
- Windows headless failure `Error: Bundled 与 Active ZCode Built-in Release 均不可用` (exit 1, `-p`/`tui` only; `plugins`/`--version` still work): a desktop-app shell exports `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` / `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` pointing at the desktop's provider config keyed by the desktop app version, while the CLI runtime bundle is a different version and its derived per-version config directory does not exist (agent bundle resolves `<home>/.zcode/v2/runtime/provider/<platform>/<bundle-version>/endpoint-<hash>/zcode-builtin.json`). Remedy: strip both inherited variables for the headless run (`env -u ZCODE_BUILTIN_PROVIDER_CONFIG_FILE -u ZCODE_PERSONAL_PROVIDER_CONFIG_FILE zcode -p …`); do not hand-edit `~/.zcode` config trees. Observed on zcode CLI bundle 0.16.9 with desktop app 3.14.3/3.16.3, win32; A/B verified both directions (same root cause class as workspace zcode-dispatch ZCODE_* stripping).
- Run headless prompts via `node <home>/.zcode/runtime/current/agent/zcode.cjs -p "<prompt>"`, not `cmd /c zcode.cmd -p "<prompt>"`: the cmd.exe re-quoting layer can truncate a quoted prompt to its first word (observed: an 84-byte prompt arrived as 4 bytes "Use", so the model ran no tool and only SessionStart/UserPromptSubmit/Stop spooled). The direct node entry preserves argv intact and produced the full 5-event capture (PreToolUse/PostToolUse Bash included).
- Stop→auto-report reads the spool dir from `config/auto-report.json` (`zcode.spool_dir`), **not** from `TASK_META_ZCODE_SPOOL`; that env var only redirects where the plugin hook writes. A session captured into an isolated spool therefore settles to outbox `HELD / "no hook spool entries"` — expected, and still valid fail-closed evidence (no `comment_url`, no POST). `TASK_META_HOME` is plugin-side only (locates the task-meta CLI); the CLI's own config path is fixed and must not be edited for a test.

### Codex (CLI-first with desktop-only trust exception)

- Source: `plugins/codex/.agents/plugins/marketplace.json` and `plugins/codex/task-meta-capture/.codex-plugin/plugin.json`; inline **7** Hook events: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Interrupt, Stop, SessionEnd; `scripts/run.cjs` dispatches to `scripts/capture.cjs`. `TASK_META_CODEX_SPOOL` overrides `~/.task-meta/codex-spool/<sessionId>.jsonl`.
- Check `codex --help`, `codex plugin --help` and `codex exec --help` on actual installed binary; **Codex desktop plugin load is not proof that the CLI loads the identical plugin/hooks**. Use CLI plugin install/enable/headless command **only if documented in the binary's help and confirmed on that Host**. Never hand-write fake `trusted_hash` values, disable trust guard, patch launcher or edit another app's config to force an apparent PASS.
- A **real CLI Hook** must show auto-invoked plugin event in the real Codex CLI session, same stable session ID, v0.3.0 spool and digest; independent of direct `node scripts/run.cjs` fixture. If the CLI has no plugin support, report `REAL_AGENT_CLI=UNSUPPORTED/NOT_RUN` and refer any missing feature to the Codex vendor; desktop compatibility remains separately qualified.
- For the **desktop-only fallback**, approved 0.3.0 in-app trust/7 Hook approval and first Spool are witnessed in [Issue #46 comment 6383354474](https://github.com/kaicreator-mm/task-meta/issues/46#issuecomment-6383354474). Actual Windows Stop→auto-report `HELD / PUBLICATION_CLEARANCE_REQUIRED` (no POST) and privacy sweep PASS; 5 events (SessionStart → UserPromptSubmit → PreToolUse → PostToolUse → Stop) all 0.3.0. Historical first SessionEnd receipt used a **different Host ID**. A newer [five-path actual desktop exit probe](https://github.com/kaicreator-mm/task-meta/issues/46#issuecomment-6384041266) observed **zero SessionEnd events** for new chat, tab/window close and graceful ChatGPT quit, with unchanged Spool digest on quit. Thus same-session SessionEnd correlation is **NOT_QUALIFIED**, and host-vs-plugin root cause **UNKNOWN**. Stop/Outbox PASS does not imply SessionEnd PASS.
- Windows desktop Codex can kill child processes in its job object; v0.2.4+ plugin starts an independent `watch` via WMI (`Win32_Process.Create`) on SessionStart. Detached Stop/SessionEnd child alone may die: inspect watcher/outbox to separate job-object failure from task-meta logic. `TASK_META_AUTO_REPORT=0` may not propagate to the WMI watcher; use documented `config/auto-report.json` `enabled:false` or private outbox `STOP` file for a deliberate kill-switch test, not blind repeated POSTs.

## Step 3 — one bounded real E2E (when authorized)

1. In an approved isolated repo/Issue (currently `kaicreator-mm/task-meta-e2e#9` was v0.3's sink, **do not reuse it as permission to post new comments without a new task scope**), run exactly one real Agent task. Capture source-declared Task/Attempt/Session and one real tool call; verify Hook writes `{"d": "<sha256 of JCS(e)>", "e": <metadata>}` lines with correct agent, session, `plugin_version` and complete digest. Validate actual schema and JCS with existing project tests/helper; plain JSON reserialization is **not** equivalent to JCS.
2. Verify only allowed metadata in private Spool/Outbox: never persist prompt, reasoning, assistant/model text, tool arguments/responses, transcript path, local absolute path, Authorization/cookies/tokens or hidden grader. Measure sizes/normalized Issue refs only where supported. Keep sentinels private; public GitHub comments contain only safe source refs and digests.
3. Observe Stop/SessionEnd settlement, lock/idempotent replay, source resolver and outbox `HELD` vs `PUBLISHED`. `HELD / PUBLICATION_CLEARANCE_REQUIRED` proves fail-closed *only*, not publication failure nor Report PASS; `AMBIGUOUS` cannot be guessed or force-published.
4. **Dry-run first.** For collector entrypoints only (`node src/cli.ts collect`, `collect-codex`, `collect-claude`), optional `--publish` is the actual GitHub-post mode; use it **only** after verifying the exact ADS adoption pin/schema, original/public source, test repo allowlist, own Issue permission, applicable source-owned clearance and safe projection. **Do not pass `--publish` to `auto-report`**: that entrypoint uses governed config/admission, with separate `--dry-run` and `--retry` options where confirmed by the installed CLI help/source. A dry-run/report rendering result is not a native POST result. For authorized publication read back actual GitHub comment ID/URL and canonical Report `data_digest`; retry same identity only via reconciled idempotency. Never spam 403/429 or use ordinary repos for test negatives. Real task-meta stdout and `gh api` readback both required for `REAL_HOST_GITHUB=PASS`.
5. Keep `SOURCE_ONLY` Golden, `REAL_AGENT_CLI` Hook activation, `REAL_HOST_GITHUB` write/readback, `DESKTOP_ONLY` trust, CI, Linux, Tally consumer and independent reviewer results separate. No synthetic/desktop/connector observation is promoted to a stronger gate.

## Step 4 — failure triage: do not rediscover known cases

| Symptom | First diagnosis | Required disposition |
| --- | --- | --- |
| No Spool | Effective plugin enabled/trusted? correct CLI vs desktop app? `node` PATH? Hook root expansion? `_errors.log` has only error class | `NOT_RUN` until actual Agent auto-hook witness |
| Spool but no Outbox | Stop vs SessionEnd, 180 s settle, watcher WMI, config/STOP switch, task-meta executable location; actual session ID | Record `HELD/UNKNOWN`, never pretend POST |
| Outbox HELD | Source binding ambiguity, zero clearance or unavailable qualified source | Expected fail-closed, no bypass |
| Duplicate/changed GitHub comment | Bounded paginated readback, ID/URL/digest, lost ACK and revision conflict | `ALREADY_PUBLISHED` or typed `CONFLICT/NOT_PUBLISHED`; no blind POST |
| Missing model usage or Claude auth expired | Agent/version cannot provide that measurement | `PARTIAL/UNKNOWN`, not zero or model PASS |
| Codex SessionEnd wrong ID **or no event** | Check real session IDs, append-only Spool before/after closing chat/tab/window or graceful app quit; compare file digests. [Five exit paths with zero SessionEnd](https://github.com/kaicreator-mm/task-meta/issues/46#issuecomment-6384041266); don't assume the Host emitted an event or blame the plugin without evidence | `NOT_QUALIFIED` / `ROOT_CAUSE=UNKNOWN`, never count missing event as PASS |
| ZCode/Claude/Codex CLI subcommand missing | Re-check binary `--help`; may be unsupported/version mismatch | `UNSUPPORTED/NOT_RUN`, not an invented workaround |
| ZCode headless `Bundled 与 Active ZCode Built-in Release 均不可用` | Inherited desktop `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE`/`ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` vs CLI bundle version mismatch; also `cmd /c` quoting may truncate `-p` prompt | Strip both env vars and run via `node …/agent/zcode.cjs -p`; `NOT_RUN` until a real session spools |
| GitHub CI absent | Source Host tests are distinct from CI | `CI_UNAVAILABLE_WAIVER` only if owning Release authorizes |

## Exact-SHA evidence output (always)

```ini
PROJECT=kaicreator-mm/task-meta
SOURCE_SHA=<40-hex>
SOURCE_TREE=<40-hex>
OS_NODE_AGENT_CLI_PLUGIN=<actual observed versions>
TEST_SCOPE=SOURCE_ONLY|HOOK_FIXTURE|REAL_AGENT_CLI|REAL_HOST_GITHUB|DESKTOP_ONLY
INSTALL_AND_TRUST=<actual receipt or NOT_RUN>
CLI_COMMAND_EXIT_CODES=<actual>
SESSION_ID_AND_HOOK_EVENTS=<actual metadata only>
SPOOL_COUNT_PLUGIN_VERSION_JCS_SHA256=<actual>
STOP_SESSIONEND_CORRELATION=PASS|NOT_QUALIFIED|NOT_RUN
OUTBOX_AND_REASON=<actual>
GH_NATIVE_ID_URL_DIGEST_OR_NONE=<actual>
PRIVACY_SWEEP=PASS|FAIL|NOT_RUN
CI_AND_PLATFORM_GAPS=<truthful, scoped>
P0_P1_P2_AND_INDEPENDENT_REVIEW=<distinct review or NOT_RUN>
```

Record a useful discovery once with its exact binary/version/OS, path/source proof, exit code and failure remedy in the Skill PR or a subsequent small Skill-only PR. Reuse prior evidence when exact subject is unchanged; **never repeatedly explore GUI or invent CLI abilities**. Before modifying this Skill, independently check its two Agent discovery entrypoints, the live plugin manifests and the frozen ADS policy.