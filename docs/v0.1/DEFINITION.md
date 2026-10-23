# task-meta v0.1 — Product + L2 definition and Task DAG

Status: **FROZEN for v0.1 implementation by user instruction (2026-10-23)**.
Consolidates task-meta #10 (PRD R0), #13 (L2 candidate), #14 (ADS pin), #11
(verifier semantics), #2–#6 (intake). Where older issue text conflicts, this file wins
for v0.1.

## 1. Product

task-meta v0.1 is a **passive, local-first evidence collector and ADS GitHub report
writer** for one real Agent: **ZCode** (Z.AI coding agent CLI, as used by the
kAiCreator `zcode-dispatch` workflow).

Data path: `ZCode run → adapter (metadata-only observations) → correlator →
private immutable store (content-addressed, SHA-256 readback) → ADS ads/github/v4
EXECUTION_SUMMARY report (strict schema) → [gated] GitHub Issue comment + readback`.
Tally reads GitHub only; task-meta exposes no API to Tally.

task-meta does **not** schedule tasks, route agents, declare Task PASS, train models,
or create Skills/Packages.

## 2. Scope

| Stage | v0.1 | Notes |
| --- | --- | --- |
| A Collector (ZCode adapter + correlation) | **P0, implement** | Real source probed 2026-10-23, see §3 |
| B Private immutable evidence (store + manifest + spool) | **P0, implement** | Local filesystem, no DB |
| C Report writer `ads/github/v4` EXECUTION_SUMMARY | **P0, implement** | Default profile; v5 opt-in flag |
| D GitHub publisher (readback/idempotency/429/lost ACK) | **P0 code, live run gated** | Requires explicit `--publish`; tests use a fake GitHub client. Live publication NOT_RUN in v0.1 |
| E Tally GitHub-only reader E2E | **NOT_RUN** | Depends on Tally reader + ADS #1210 |
| Claude Code / Codex adapters | Deferred (v0.2) | Capability matrix only states UNSUPPORTED |
| Cost BILLED, experience feedback, correction writer, remote object store | Deferred | Cost reported as UNKNOWN unless evidenced |

## 3. ZCode source (probed on this host, zcode v0.16+)

1. **Headless result** (`zcode -p … --json` stdout, may start with a non-JSON warning
   line): `sessionId, traceId, turnId, response, usage{source, modelRequestCount,
   inputTokens, outputTokens, totalTokens, cacheReadTokens, cacheWriteTokens,
   reasoningTokens, webFetchRequests, webSearchRequests}, eventCount, projection{…}`.
   `response` is model text → **dropped**.
2. **Model I/O rollout** `~/.zcode/cli/rollout/model-io-<sessionId>.jsonl`, one line per
   model request: `type:"model_io", sessionId, traceId, turnId, requestId, attempt,
   querySource, startedAt, completedAt, durationMs, model{modelId, providerId},
   request{body…}, response{finishReason, headers, text, toolCalls[{id,name,input}],
   usage{inputTokens, outputTokens, totalTokens, cacheReadTokens, cacheWriteTokens},
   providerMetadata…}`. Allowlist keeps ids, times, model ids, finishReason, usage,
   toolCalls[].id/name. **Dropped**: request body, response text/headers, tool input,
   providerMetadata.
3. **Dispatch run record** `run.txt` (`started=… head_before=<sha>`, `exit=… finished=…
   head_after=<sha>`) and `exit.txt` from `run-zcode.sh`: run boundary + source SHA.
4. **Verifier**: `task-check.sh` gate log with an explicit `EXIT=<code>` line; the
   collector records it as an independent verifier observation on `head_after`.

Observed gaps (honest UNKNOWN): reasoning tokens are absent from per-request rollout
usage and the headless total reports `0` that cannot be told apart from "not exposed" →
`reasoning_tokens` is UNKNOWN (null), never 0, no billed cost (coding plan) → cost UNKNOWN,
no per-tool timing (tool calls only known by id/name inside a model response),
`modelRequestCount` in the headless result may differ from rollout line count when a
session is resumed → coverage PARTIAL with a limit note, never silently reconciled.

## 4. Contracts (L2)

- Shared types: `src/model.ts` (ObservationRecord, AttemptSummary, …). Canonical JSON
  and digest: `src/canonical.ts` (RFC 8785 JCS + SHA-256).
- Identity: `observation_id = "zcode:" + source_event_id`; model request
  `source_event_id = requestId + "#" + attempt`; `logical_call_ref = requestId`,
  `physical_attempt_ref = requestId#attempt`. Same id + same canonical digest =
  duplicate delivery (dropped); same id + different digest = new `source_revision`
  (kept, flagged). Distinct `attempt` values are real retries (all kept, counted once each).
- Correlation: `task_ref = "<repo>#<issue>"`, `run_ref = sessionId`,
  `attempt_ref = sessionId` (one ZCode session = one leaf attempt; a resumed session is a
  new run segment of the same attempt), `step_ref = turnId`.
- Metrics (sum over unique physical model requests): `model_requests`, `input_tokens`,
  `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `tool_calls`,
  `model_wall_ms` (union of request intervals — overlaps never double counted),
  `run_wall_ms` (run.txt boundaries). Missing source → value null + UNKNOWN.
- Verifier: only from an independent gate log (`EXIT=` line) bound to an exact SHA;
  agent `response` text never sets verifier status. EXIT=0 → checked=[gate], status
  PASS for that gate only, `unchecked` lists task acceptance not covered by the gate.
- Store: `<root>/objects/sha256/<aa>/<digest>` immutable files (write tmp → fsync →
  rename; existing digest = verify bytes, never overwrite); `<root>/manifests/` manifest
  JSON listing object digests; `<root>/spool/` append-only JSONL outbox with per-line
  digest for crash replay. Readback re-hashes every object.
- Report: `<!-- ads:github -->` first line + one fenced `yaml` block with exactly
  `schema`, `kind`, `data`; strict ajv Draft 2020-12 validation against the vendored
  schema before output; `data_digest = sha256(JCS(data))` kept outside the data.
  `report_id = "task-meta:<attempt_ref>"`, `publisher_namespace = "task-meta:<repo>"`.
- Publisher identity `(issue, publisher_namespace, report_id, revision, report_kind)`;
  paginate all Issue comments before and after POST; same identity+digest = already
  published; different digest = CONFLICT (no write); lost ACK → readback reconciles.

## 5. Privacy

Metadata-only allowlist at adapter ingress. Forbidden anywhere in store or report:
prompt/system text, model response text, tool input/output, HTTP headers/cookies,
tokens/keys, absolute local paths. A guard test scans every produced store object and
report for forbidden keys and for sentinel secrets planted in fixtures.

## 6. Task DAG (v0.1)

| Task | Depends on | Delivers |
| --- | --- | --- |
| T0 bootstrap | — | scaffold, vendored ADS pins, `src/model.ts`, `src/canonical.ts`, this doc |
| T1 ZCode adapter + correlator | T0 | `src/adapters/zcode/*`, `src/correlate.ts`, capability profile, fixtures, tests |
| T2 private immutable store | T0 | `src/store/*`, tests (crash/replay/tamper) |
| T3 report writer v4 (+v5 opt-in) | T0 | `src/report/*`, schema tests incl. vendored fixtures/scenarios |
| T4 GitHub publisher (gated) | T3 | `src/publish/*`, fake-client tests: pagination, dup, conflict, 429, lost ACK |
| T5 CLI + real-run E2E | T1–T4 | `src/cli.ts`, E2E on a real ZCode session → store → report (dry run) |

## 7. Acceptance for v0.1

1. Real ZCode session from this host → observations → store readback OK → schema-valid
   v4 report (dry run) with honest UNKNOWNs. Evidence recorded in the release PR.
2. Negative tests: duplicate delivery, real retry, overlapping intervals, missing
   rollout, conflicting revision, tampered object, crash mid-write replay, forbidden
   key/secret leak, schema-invalid report refused, v4/v5 mismatch, GitHub dup/conflict/
   429/lost ACK/pagination.
3. `tools/task-check.sh` green (lint, typecheck, test) on every PR.
4. Not claimed: live GitHub publication, Tally E2E, ADS production adoption, billed cost.

## 8. v0.1 R2 amendment (2026-10-23, user instruction)

R1 (sections 1–7, merged in #18) stays valid. R2 adds the ADS v4.16 follow-up and the
intake issues filed after R1 (#9 delta, #11 delta, #15, #16, #17) to v0.1.

### 8.1 ADS v4.16 (`ads/github/v5`) follow-up

Readback 2026-10-23: ADS `main` = v4.14.0 (`584512e`); `version/v4.16` = `3041a1b` (T01 v5
wire integrated; T02 #1266 / T03 #1267 / T07 #1271 open; no v4.16 main merge or tag).
ADS §16.7: a normal writer may emit `ads/github/v5` only after a qualified **main** v4.16
adoption SHA; `version/v4.16` is CANDIDATE_ONLY and never a second concurrent default.

Therefore v0.1 R2:
- Completes the v5 producer: per-metric identity (`metric_id`, `observation_id`,
  `logical_call_ref`, `physical_attempt_ref`, `adapter_id`, `provider_run_ref`=null,
  `measurement_kind`, `window_id`, `source_revision`), `PROVIDER_REPORTED` cost basis,
  `publication` clearance (`--clearance-ref` from the source owner; absent ⇒ report HELD,
  nothing rendered for posting), `projection_digest` = JCS SHA-256 of `data` without
  `publication`.
- Profile selection: `--profile v5` requires `--ads-pin <sha>`. Pin = vendored candidate
  `3041a1b` ⇒ CANDIDATE: dry run only, `--publish` refused. Pin = an ADS **main** SHA listed
  in `config/ads-adoption.json` ⇒ v5 allowed to publish. Default profile stays v4 until
  that file lists an adopted main SHA, then flips to v5 (one-line change, tested).
- Never downcast v5→v4 or mix profiles for one report identity.

### 8.2 Intake added to v0.1 (private diagnostics; GitHub only where the schema has a field)

| Issue | v0.1 R2 slice | Not in v0.1 |
| --- | --- | --- |
| #11 verifier semantics + qualifiers | `VerifierRecord` per gate/CI log (id/version/contract/subject SHA/env/case counts/exit), currentness vs attempt SHA (STALE), `OutcomeClass` (STRICT_TERMINAL_SUCCESS only when declared required scope fully passed on current SHA), conflicts (two verdicts same SHA; run exit≠gate), qualifiers when source exposes them else UNKNOWN | verifier grading, oracle challenge execution |
| #15 Version-State/Transition | lineage from run segments + read-only git (`--git-dir`): versions per commit, parents, per-segment transitions with shortstat + diff digest, NO_CHANGE / ADVANCE / REVISIT (A→B→A) / INCOMPLETE (unfinished or uncommitted); duplicate SHAs never create new versions | branch DAG across attempts, cross-host clocks |
| #16 behaviour labels | deterministic rule labeler v1 (no LLM): ACTION_CATEGORY per tool call from tool name, EDIT_MAGNITUDE per transition, LOOP_CLUSTER (≥3 consecutive same-category model turns with no new version and no verifier improvement), REVISIT_CANDIDATE from #15, FAILURE_CLASS_CANDIDATE (#9 taxonomy) only from observed verifier/env facts; labeler name/version/rules digest; small hand-labelled golden set with confusion matrix test | LLM/small-model labeler, intent inference |
| #17 diagnostic aggregates | `eligible_attempts`, `strict_verified_attempts`, `partial_or_unknown_attempts`, `labeled_transitions`, `unknown_transitions`, `revisit_candidates`, `loop_clusters`, `verifier_coverage` with numerator/denominator/coverage/derivation; `publication_field=null` (no ADS field) ⇒ private, and one bounded public limit string names the gap (ADS #1258) | cross-task comparability, leaderboards |
| #9 experience usage | ZCode exposes no experience/recommendation exposure ⇒ capability `experience_exposure: unsupported`, `learning.state=NONE_MATERIAL`; failure taxonomy candidates via #16 | ExperienceIndex/Usage views |

All R2 records are stored as manifest objects (`verifier`, `lineage`, `labels`,
`aggregates`) and pass the privacy guard. No new public fields are invented.

### 8.3 R2 Task DAG

| Task | Depends on | Delivers |
| --- | --- | --- |
| R2-0 | — | this section + `src/model.ts` R2 types (controller) |
| T6 v5 producer + pin guard | R2-0 | `src/report/*`, `src/correlate.ts` metric identity, `config/ads-adoption.json` |
| T7 verifier semantics (#11) | R2-0 | `src/verifier/*` |
| T8 version lineage (#15) | R2-0 | `src/lineage/*` |
| T9 labels + aggregates (#16 #17 #9) | T7, T8 | `src/labels/*`, `src/aggregates/*` |
| T10 CLI integration + real E2E R2 | T6–T9 | `src/cli.ts`, real dh-i1264 rerun incl. lineage/labels, evidence |

### 8.4 R2 status

Implemented: v5 producer with pin guard (candidate pins refuse `--publish`, exit 2) and clearance HOLD (exit 8);
verifier assessment (#11, multiple `--gate-log file[@sha]`, mtime-inferred subject as INFERRED); lineage from
run segments + read-only `--git-dir` (#15); rule labels v1 (#16); diagnostic aggregates (#17); Bash
`input_class`. The manifest carries seven roles. The legacy single-gate path no longer decides the verdict.

Real run (domain-harness #1264, 8 segments, dry run): 209 model requests, 207 tool calls, 7 committed versions
(6 ADVANCE, 1 NO_CHANGE, 1 INCOMPLETE), 207 action labels (28.5% UNKNOWN), 3 test-rerun clusters, outcome_class
PARTIAL_PROGRESS (gate subjects only INFERRED; one log inside the unfinished segment). v4 rerun was byte-idempotent;
privacy sweep clean. v5 (candidate pin) exits 6 for this attempt because v5 has no PARTIAL verifier status; with an
operator-stated `@sha` binding it renders. Not run: live publication, Tally reader, billed cost, ADS v4.16 main adoption.

### 8.5 E2E test-subject publication, v5 verifier projection, gate-recorded subject (T12)

- `config/ads-adoption.json` `e2e_test_subjects` allowlists `{repository, ads_pin, profile, report_schema_blob}`.
  The candidate pin (`3041a1b`) plus `--publish` is allowed only when `--repo` and the pin match an entry (and the
  blob equals the vendored schema): mode `E2E_TEST_SUBJECT`. Any other repository stays `CANDIDATE_NOT_PUBLISHABLE`.
  This is not production adoption: the effective default stays v4 unless `adopted` lists a v5 main entry. The report
  carries the public limit "ADS v4.16 candidate 3041a1b used as isolated E2E test subject; not production adoption".
- v5 has no PARTIAL verifier status. A PARTIAL verifier is projected as `status` UNKNOWN, `subject_sha` null, empty
  `checked`/`failed`, epistemic and currentness UNKNOWN, `skipped`/`unchecked` kept, coverage PARTIAL, plus the limit
  "verifier partial progress not representable in ads/github/v5; detail in private manifest". Never PASS.
  `VERIFIER_PARTIAL_UNREPRESENTABLE_IN_V5` is removed; v4 is unchanged.
- Gate logs may carry `GATE_SUBJECT_SHA=<40hex>` and `GATE_TREE_CLEAN=yes|no`. A valid recorded SHA is the subject
  with binding OBSERVED (preferred over mtime inference). `GATE_TREE_CLEAN=no` adds qualifier `working_tree_dirty`
  and the record cannot support STRICT_TERMINAL_SUCCESS. A supplied `@sha` that differs from the recorded one is a
  `subject_conflict`: the record is UNKNOWN and the outcome UNVERIFIED; it is never silently overridden.
