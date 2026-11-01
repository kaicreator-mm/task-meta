# task-meta v0.4 — R #74 candidate release qualification ledger (R0, not READY)

> **Status: HOLD / RELEASE_ELIGIBLE=NO / MAIN_MERGE=NO**. This artifact records the
> release Controller's exact-source prequalification and local evidence reported
> on Issue #74. It **does not** constitute the distinct independent RQ, and must not
> be mistaken for a published release or authorization to merge `main`.

## 1. Candidate and immutable scope

| Source | Exact identity and outcome |
| --- | --- |
| Project / release Task | `kaicreator-mm/task-meta`, Issue #74 / TM-V040-R |
| Frozen candidate | `version/v0.4@f355b87e6b91a5e10ad1b0aa9d9b11e282b12f2b` |
| Candidate Git Tree | `4993d1fc0ee5e4df36320700b63131a75f57c134` |
| I #73 integration | PR #92 independent R2 PASS; merged; Issue #73 CLOSED |
| Version GitHub-bound CI | Woodpecker #49 and #50: SUCCESS on exact candidate SHA |
| Live native Task DAG | 10 Issue nodes, 12/12 `blocked_by` edges read back; 9/10 tasks CLOSED |
| Product freeze | `docs/v0.4/PRD_R2_CANDIDATE.md` blob `0af2b9cafd63ca1faa8b2fa612f7fdc5e02db067` |
| L2 freeze | `docs/v0.4/L2_ARCHITECTURE_EVIDENCE_R1.md` blob `5fc32ca154e77cb6bd34f32f4a6a91717b4b4633` |
| DAG freeze | `docs/v0.4/TASK_DAG_R3_CANDIDATE.md` blob `2ec105578b9d7e4e7f9103e59fb7773890696d93` |
| Report runtime adoption | ADS v5, qualified ADS main `718fb02e33b31f568736447b2b905883cc6fcc3a`, schema blob `7478313cc006162432649d734e59c5cd77db5106` |
| ADS governance | v4.18 design constraints. This does **not** change the separately pinned ADS v5 reporting runtime. |
| Main | `adc0a823bc2be636292fef4dd96d24076646ee20` remains unchanged at initial audit |

The GitHub metadata/source audit is logged at
[Issue #74 comment 6555504267](https://github.com/kaicreator-mm/task-meta/issues/74#issuecomment-6555504267).
All source identity checks must be repeated before any guarded main merge.
Legacy planning-text flags `DAG_FREEZE=NO` are not authoritative proof
against the later accepted native 12-edge admission
([Issue #64 comment 6414839535](https://github.com/kaicreator-mm/task-meta/issues/64#issuecomment-6414839535)).

## 2. Local Windows Node24 evidence (reported; not independently rerun here)

The local Host submitted
[Issue #74 comment 6555702454](https://github.com/kaicreator-mm/task-meta/issues/74#issuecomment-6555702454),
explicitly pinned to the candidate source and tree. The Controller transcribes
only the reported result, not a new Web-run physical measurement.

- Environment: Windows 10.0.26300, Node v24.21.0; Claude CLI 2.1.261,
  Codex CLI 0.166.0; ZCode CLI unavailable in PATH; capture plugin 0.3.0
  hash `8595f5b3c6b3…`.
- Exact-candidate Hook fixture paired **n=6 ON and n=6 OFF**, benchmark EXIT 0:
  Hook ON wall median 302.05 ms (range 252.6–546.6), Hook OFF median 86.5 ms
  (82.7–148.4). **Difference of these medians = 215.55 ms; not a separately
  computed paired-difference median**. Stop→Outbox median 523.05 ms
  (466.2–770.7). Each ON creates one 843-byte metadata Spool line and HELD
  Outbox, 0 public POST; all six OFF runs witnessed absent Spool/Outbox.
- Pre-change C2 source-pinned n=6 baseline in
  `docs/v0.4/evidence/C2_hook_overhead_baseline_R0.md`: ON median 384.8 ms,
  OFF median 103.6 ms, per-pair delta median 286.2 ms, Stop→Outbox 601.2 ms.
  **This baseline is not the new candidate proof and no statistical improvement
  claim is made from unmatched summary statistics.**
- Candidate source-only and fixture checks: lint EXIT 0, typecheck EXIT 0,
  `npm test` 634/634 EXIT 0, isolated recovery-negative targeted tests 40/40
  EXIT 0; privacy sweep on isolated fixture Spool/Outbox reported PASS.
  Full source CI is separately covered by the exact candidate Woodpecker receipts.
- Actual installed CLI **management surface only**: Claude `plugin validate`
  EXIT 0, `plugin list` EXIT 0 showing installed *v0.3.0* (not a candidate
  install), Codex `--help` and `plugin --help` EXIT 0.
  **REAL_AGENT_CLI session/candidate plugin activation = NOT_RUN**.
  No actual installed Agent CLI→Hook→Spool→Outbox chain has been established
  on this version. A task-meta CLI `doctor` call or simulated Hook is not it.
- REAL_HOST_GITHUB live publication = NOT_RUN (no separate clearance);
  REAL_TALLY_APP = NOT_RUN; DESKTOP_ONLY = NOT_RUN.

## 2.1 New local ZCode evidence — conflicting scope labels (2026-11-01)

Two subsequent local receipts were appended to [Issue #74](https://github.com/kaicreator-mm/task-meta/issues/74)
*after* the initial R0 Host evidence was staged:

- [#6556604986](https://github.com/kaicreator-mm/task-meta/issues/74#issuecomment-6556604986)
  records a real **standalone ZCode CLI** 3.14.3 / banner 0.16.9 check.
  The management, doctor and plugin validation commands returned exit 0, but
  every actual agent-bearing `--prompt` / `app-server` invocation failed
  EXIT=1 with `Bundled 与 Active ZCode Built-in Release 均不可用`.
  Both bundled and active CLI built-in descriptors were rejected (revision 30),
  while refresh could not reach `zcode.z.ai` from that shell. Thus
  **REAL_AGENT_CLI=NOT_RUN** and no safe-recovery negative was executed via
  a live CLI agent session. The candidate worktree's ZCode scoped tests
  reported 60/60 PASS; this is source-only evidence.
- [#6556737470](https://github.com/kaicreator-mm/task-meta/issues/74#issuecomment-6556737470)
  reports a **real ZCode Desktop Agent session** through
  `ZCode.exe` with automatically triggered candidate-byte-identical plugin
  hooks, metadata Spool, and fail-closed HELD Outbox; an isolated source
  diff was reported as EXIT 0. This is a valuable **DESKTOP_ONLY real agent
  integration** observation, not a successful standalone CLI headless run.
  The receipt itself reports `ZCode.exe --help` has no supported agent/headless
  option and no new headless CLI session was started. Its literal
  `REAL_AGENT_CLI=PASS` assertion is therefore **not accepted for the frozen
  Product A19/§7 and L2 release gate**.
  The receipt's HELD Outbox line was from an older date, with multiple-repo
  identity ambiguity; correlation to the specific live session and a
  **candidate-v0.4 executor** was not independently established. Existing
  `~/.task-meta/app` v0.3-era executor must never substitute for that proof.

Both receipts are locally self-reported, not independently rerun via Web.
The live desktop Spool observations are **not discarded**; they are
recorded in the correct DESKTOP_ONLY category, including their genuine privacy
and fail-closed observations. The source/CI/fixture gates remain qualified
at their own level; **REAL_AGENT_CLI stays NOT_RUN**.

Potential vendor remedy (diagnostic lead, not a fix already performed):
[upstream ZCode README](https://github.com/zai-org/ZCode)
lists 3.17.1 released by 2026-10-30, newer than the failing standalone
3.14.3. Its [CLI quickstart](https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/docs/usage/01-quickstart.md)
shows an actual `--prompt` Agent entrypoint, and the
[CLI source packaging notes](https://github.com/zai-org/ZCode/blob/main/README.en.md)
distinguish standalone distribution from Electron Desktop. A **read-only**
local comparison of effective `ZCODE_*_PROVIDER_CONFIG_FILE` overrides,
CLI package/bundle versions, official distribution and active descriptor
validation is the minimal next investigation. Do **not** copy Desktop's newer
descriptor into an older incompatible CLI, bypass validator, patch launcher,
overwrite the active user install, or claim that a vendor update is
guaranteed to fix the error. Any isolated candidate CLI test must bind the
exact task-meta version and use a genuinely available already-approved
model entitlement; no unapproved paid requests.

## 2.2 New headless ZCode CLI proof resolves the earlier CLI blocker (2026-11-01)

The earlier **NOT_RUN** assertions in §2.1 are a time-bounded history of the
failed CLI boot, **not the current status** after this later receipt.
[Issue #74 comment 6557497316](https://github.com/kaicreator-mm/task-meta/issues/74#issuecomment-6557497316)
reports a successful **genuine standalone/headless ZCode CLI** session
on the same frozen candidate `f355b87e…` and Windows Node v24.21.0,
using the already-authorized model quota.

- Root cause of earlier EXIT=1: a 3.14.3 CLI process inherited
  `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` pointing at a non-existent Desktop
  3.16.3 provider configuration. Removing this inherited environment override
  **for the isolated child** allowed the unchanged official 3.14.3 CLI bundle
  to perform its own provider selection. No descriptor, user config, trust
  validator, CLI launcher or plugin was rewritten.
- Positive: actual headless `bin/zcode.mjs -p` EXIT=0, model response
  `RQ_OK`; session `sess_851907fb-7fa0-4704-a782-b757ba6b9b58`.
  The real CLI automatically emitted **SessionStart×1, UserPromptSubmit×1,
  Stop×1** to append-only JCS-digested ZCode Spool through the
  candidate-byte-identical installed plugin (version 0.3.0). After normal
  settling the Outbox recorded `HELD` / `no issue reference`;
  **no unauthorized GitHub POST**. CLI-originated Hook and stop-to-outbox
  observed by the local Host, not a synthetic Hook fixture or Desktop session.
- Negative: second true CLI Agent session
  `sess_006ae812-6f64-4e89-bc8e-d823d26282f5` EXIT=0 with
  `TASK_META_AUTO_REPORT=0`; Spool captured the same three event categories,
  **no new Outbox entry** after settle. This supplies a separate isolated
  publication kill-switch negative.
- Host reports privacy-safe metadata rather than a prompt/transcript or
  secrets dump. Nonfatal provider-refresh warning
  `invalid schema at providerRules.8…access.mode` remains recorded for vendor
  follow-up; it did not prevent the observed session.

**Evidence scope:** `REAL_AGENT_CLI=REPORTED_PASS` for real ZCode headless
CLI→installed Hook→Spool→Outbox positive + kill-switch negative, based on
Host receipts; Web has **not independently reproduced** those physical events.
The actual auto-report executable/home was **not identified by exact source
SHA in the receipt**. ZCode capture.mjs chooses `TASK_META_HOME` from the
Hook process environment, otherwise plugin-local `config.json.taskMetaHome`.
The headless command shows `--cwd` at the candidate checkout, which **does
not by itself prove the detached auto-report executor used v0.4**. An
independent RQ reviewer must check this scoped currentness point before
asserting `CANDIDATE_EXECUTOR_REAL_HOST_E2E=PASS`. The source-only
and n=6 fixture-host gates remain independent.

## 2.3 Exact v0.4 auto-report executor provenance and remaining integrated-session gap (2026-11-01)

The [new local proof on Issue #74, comment 6559074967](https://github.com/kaicreator-mm/task-meta/issues/74#issuecomment-6559074967)
resolves *which program was actually spawned* and also reveals an important
isolation/configuration boundary:

- **Prior successful headless session** `sess_851907fb…` did not set
  `TASK_META_HOME`, so its Hook fell back to plugin
  `config.json.taskMetaHome=~/.task-meta/app`. The local Host verified that
  installed home is v0.3 source `9731b03e…` (and lacks `doctor --catalog`).
  The previous `HELD / no issue reference` is a real CLI-origin publication
  refusal by **v0.3**, not v0.4; its Headless Agent and Hook/Spool evidence
  nevertheless remains genuine.
- **New candidate executable positive, with a deliberate isolation mismatch:**
  an actual headless ZCode CLI Agent EXIT 0 with response `RQ_V4`,
  session `sess_f89b7c95-a9fa-4c15-8231-f6bcdf06e79b`,
  `TASK_META_HOME=<candidate checkout>`, and separate
  `TASK_META_ZCODE_SPOOL=<isolated v4-spool>`. The Host observed a **live
  OS process** PID 11688 executing that candidate's
  `src/cli.ts auto-report --agent zcode --session … --trigger stop`.
  The checkout was pinned to exact `f355b87e…`. This is concrete candidate
  executable **launch provenance**, not an inferred `--cwd` path.
- **Why this is not the full same-session successful integration:** the Hook
  writes to `TASK_META_ZCODE_SPOOL=<isolated v4-spool>`, while the
  candidate executor reads the configured `config/auto-report.json`
  `zcode.spool_dir=~/.task-meta/zcode-spool`. Consequently the candidate
  returned `HELD / no hook spool entries for this session`,
  `comment_url=null` (zero POST): a legitimate **fail-closed mismatch
  negative**. It does not prove the candidate executor consumed the three
  actual Spool events from that session.
- Earlier candidate n=6 Hook ON/OFF fixture benchmark did configure isolated
  Spool and Outbox consistently and observed candidate HELD; this is still
  **HOOK_FIXTURE**, never a real installed Agent session.

Current explicit level separation: `REAL_AGENT_CLI` Headless session and Hook
**REPORTED PASS**; `AUTO_REPORT_V04_EXECUTOR_LAUNCH` **REPORTED PASS**;
`CANDIDATE_V04_SINGLE_SESSION_HOOK_TO_OUTBOX_CONSUMPTION` **NOT_PROVEN**;
candidate real session with mismatched Spool demonstrated **safe HELD**. A
minimal remaining real Host check may reuse the isolated candidate checkout,
keep `TASK_META_HOME` pinned and **align** Hook writer/auto-report reader
Spool directories using permitted process-local environment/default paths
(no source patch, no new global install); require a unique real CLI session,
same Session ID at Spool and settled Outbox, `HELD` due only to absence of
publication clearance/issue target, JCS digest and no POST. Reuse the existing
licensed model quota if authorized, rather than rerunning unrelated tests.
Independent whole-version RQ must not call the mismatched session full PASS.

## 3. Release qualification gates

| Gate | Current state | Evidence / next action |
| --- | --- | --- |
| Frozen version SHA/tree and all native Task closeouts | PASS (source readback) | 9 upstream CLOSED; R #74 stays OPEN |
| Exact whole-version CI | PASS | #49 / #50 on `f355b87e...` |
| Product/L2/DAG and runtime adoption source pins | PASS (source readback) | Blob/pin values above |
| Candidate Windows n≥5 Hook ON/OFF | REPORTED PASS (HOOK_FIXTURE) | n=6; primary local receipt #6555702454 |
| Candidate safe recovery negative + privacy | REPORTED PASS (fixture scope) | 40/40; no real public POST |
| Genuine installed ZCode headless CLI→Hook→Spool→Outbox + kill-switch | **REPORTED PASS (real CLI origin)** | #6557497316; positive and negative sessions, no POST; independent Host-verdict review outstanding |\n| Exact v0.4 auto-report executor/home source binding | **REPORTED PASS (live process path)** | #6559074967: PID 11688 spawned candidate `src/cli.ts`, `TASK_META_HOME` pinned; prior CLI HELD was v0.3 |\n| Candidate v0.4 true same-session CLI→Spool→Outbox consumption | **NOT_PROVEN / RQ BLOCKER** | #6559074967 candidate `HELD/no hook spool entries` from isolated Hook Spool vs default executor Spool mismatch; needs aligned-path real CLI evidence |
| Independent whole-version exact-SHA RQ | **NOT_RUN / RELEASE BLOCKER** | Distinct reviewer must assess all mandatory scope |
| Real GitHub production publishing | NOT_RUN; no unapproved POST | Never infer grant from `HELD` |
| Actual Tally consumer | NOT_RUN | Explicit boundary; no synthetic Tally PASS |
| Main merge authorization | **NO** | Only after qualified independent RQ and source-currentness recheck |

## 4. Handoff and merge guard

1. Preserve the frozen candidate and current single-writer release Claim
   ([Issue #74 comment 6555475885](https://github.com/kaicreator-mm/task-meta/issues/74#issuecomment-6555475885)).
   This evidence branch is **not** the candidate SHA; merging this documentation
   would create a *new version SHA* requiring source-currentness re-evaluation.
2. Review headless ZCode receipt #6557497316 and independent candidate
   executor process-path proof #6559074967 as distinct scopes. They now
   establish actual CLI-origin Hook capture and the candidate v0.4 executable
   launch, respectively. The candidate session's intentionally isolated Hook
   Spool and default executor Spool were mismatched, yielding expected HELD.
   To qualify end-to-end same-session *consumption*, collect a minimal
   process-local, aligned-Spool real CLI receipt; never infer READY from
   either a v0.3 executor or a safe mismatch refusal.
3. Perform distinct independent whole-version exact-source RQ (P0/P1/P2,
   READY/BLOCK) against an unchanged version SHA after all required Host evidence.
4. Only a true READY may authorize a separate guarded `main` merge. Tag/public
   release is a separate subsequent gate.

The current result is **R0 PREQUALIFICATION ONLY: HOLD pending independent exact-candidate RQ and executor source qualification**.
