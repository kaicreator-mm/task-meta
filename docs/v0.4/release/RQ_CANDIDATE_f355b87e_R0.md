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

## 3. Release qualification gates

| Gate | Current state | Evidence / next action |
| --- | --- | --- |
| Frozen version SHA/tree and all native Task closeouts | PASS (source readback) | 9 upstream CLOSED; R #74 stays OPEN |
| Exact whole-version CI | PASS | #49 / #50 on `f355b87e...` |
| Product/L2/DAG and runtime adoption source pins | PASS (source readback) | Blob/pin values above |
| Candidate Windows n≥5 Hook ON/OFF | REPORTED PASS (HOOK_FIXTURE) | n=6; primary local receipt #6555702454 |
| Candidate safe recovery negative + privacy | REPORTED PASS (fixture scope) | 40/40; no real public POST |
| Installed candidate Agent CLI session/Hook→Spool→Outbox | **NOT_RUN / RELEASE BLOCKER** | Do not substitute Claude plugin validate or Codex help |
| Independent whole-version exact-SHA RQ | **NOT_RUN / RELEASE BLOCKER** | Distinct reviewer must assess all mandatory scope |
| Real GitHub production publishing | NOT_RUN; no unapproved POST | Never infer grant from `HELD` |
| Actual Tally consumer | NOT_RUN | Explicit boundary; no synthetic Tally PASS |
| Main merge authorization | **NO** | Only after qualified independent RQ and source-currentness recheck |

## 4. Handoff and merge guard

1. Preserve the frozen candidate and current single-writer release Claim
   ([Issue #74 comment 6555475885](https://github.com/kaicreator-mm/task-meta/issues/74#issuecomment-6555475885)).
   This evidence branch is **not** the candidate SHA; merging this documentation
   would create a *new version SHA* requiring source-currentness re-evaluation.
2. Resolve REAL_AGENT_CLI using a genuinely installed, candidate-qualified
   Agent session with metadata-only event receipts and a fail-closed HELD Outbox,
   under a separately valid model-use policy and explicitly authorized installation
   changes, **or** obtain a specifically scoped release-owner waiver where
   permitted by the frozen Product/L2 acceptance. Absent that, do not claim READY.
3. Perform distinct independent whole-version exact-source RQ (P0/P1/P2,
   READY/BLOCK) against an unchanged version SHA after all required Host evidence.
4. Only a true READY may authorize a separate guarded `main` merge. Tag/public
   release is a separate subsequent gate.

The current result is **R0 PREQUALIFICATION ONLY: HOLD**.
